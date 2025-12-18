import { WebSocketServer, WebSocket } from "ws";
import { streamResponse } from "../mock_llm";
import { verifyGrounding, Citation } from "./grounding";

const PORT = 8787;

interface StreamMessage {
  type: "stream";
  delta: string;
}

interface StreamEndMessage {
  type: "stream_end";
  reason: "done" | "cancelled";
}

interface ResponseMessage {
  type: "response";
  citations: Citation[];
}

type OutgoingMessage = StreamMessage | StreamEndMessage | ResponseMessage;

interface ConnectionState {
  abortController: AbortController | null;
}

const connectionStates = new WeakMap<WebSocket, ConnectionState>();

// Fail-closed messages: EXACTLY as per assignment.md
const FAIL_CLOSED_MESSAGES: Record<string, string> = {
  no_sources: "Jag hittar inget stöd i kunskapsbasen.",
  ungrounded_numbers: "Jag kan inte verifiera det.",
};

function getState(ws: WebSocket): ConnectionState {
  let state = connectionStates.get(ws);
  if (!state) {
    state = { abortController: null };
    connectionStates.set(ws, state);
  }
  return state;
}

function send(ws: WebSocket, message: OutgoingMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function streamTokensToClient(
  ws: WebSocket,
  text: string,
  signal: AbortSignal
): Promise<boolean> {
  const tokens = text.split(/(?<=\s)|(?=\s)/);

  for (const token of tokens) {
    if (signal.aborted) {
      return false;
    }

    send(ws, { type: "stream", delta: token });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 50);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new Error("Aborted"));
        },
        { once: true }
      );
    }).catch(() => {});

    if (signal.aborted) {
      return false;
    }
  }

  return true;
}

async function handleMessage(ws: WebSocket, userText: string): Promise<void> {
  const state = getState(ws);

  // Abort any existing stream
  if (state.abortController) {
    state.abortController.abort();
  }

  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  // Step 1: Buffer ALL LLM output before streaming anything to client
  const tokens: string[] = [];
  await streamResponse(
    userText,
    (token) => {
      tokens.push(token);
    },
    { signal }
  );

  // Cancel overrides everything: if cancelled, do NOTHING
  if (signal.aborted) {
    state.abortController = null;
    return;
  }

  const bufferedResponse = tokens.join("");

  // Step 2: Run grounding verification on the full buffered response
  const groundingResult = verifyGrounding(userText, bufferedResponse);

  // Cancel overrides everything: if cancelled during grounding, do NOTHING
  if (signal.aborted) {
    state.abortController = null;
    return;
  }

  // Step 3: Determine what to stream and citations
  let responseToStream: string;
  let citations: Citation[];

  if (groundingResult.grounded) {
    responseToStream = bufferedResponse;
    citations = groundingResult.citations;
  } else if (groundingResult.failReason === "no_sources") {
    // No sources: empty citations
    responseToStream = FAIL_CLOSED_MESSAGES.no_sources;
    citations = [];
  } else {
    // Ungrounded numbers: show top hits (without the ungrounded number)
    responseToStream = FAIL_CLOSED_MESSAGES.ungrounded_numbers;
    citations = groundingResult.citations;
  }

  // Step 4: Stream verified content to client
  const streamCompleted = await streamTokensToClient(ws, responseToStream, signal);

  // Cancel overrides everything: if cancelled during streaming, do NOTHING
  if (signal.aborted) {
    state.abortController = null;
    return;
  }

  if (streamCompleted) {
    send(ws, { type: "stream_end", reason: "done" });
    // Send response message with citations (only when not cancelled)
    send(ws, { type: "response", citations });
  }

  state.abortController = null;
}

function handleCancel(ws: WebSocket): void {
  const state = getState(ws);

  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
    // Cancel: send stream_end cancelled and do NOTHING else (no response message)
    send(ws, { type: "stream_end", reason: "cancelled" });
  }
}

function startServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: PORT });

  wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }

      const msg = parsed as Record<string, unknown>;

      if (msg.type === "message" && typeof msg.text === "string") {
        handleMessage(ws, msg.text);
      } else if (msg.type === "cancel") {
        handleCancel(ws);
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      const state = connectionStates.get(ws);
      if (state?.abortController) {
        state.abortController.abort();
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  console.log(`WebSocket server started on ws://localhost:${PORT}`);
  return wss;
}

startServer();

export { startServer, PORT };
