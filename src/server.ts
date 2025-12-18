import { WebSocketServer, WebSocket } from "ws";

const PORT = 8787;

interface StreamMessage {
  type: "stream";
  delta: string;
}

interface StreamEndMessage {
  type: "stream_end";
  reason: "done" | "cancelled";
}

type OutgoingMessage = StreamMessage | StreamEndMessage;

interface ConnectionState {
  abortController: AbortController | null;
}

const connectionStates = new WeakMap<WebSocket, ConnectionState>();

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

async function streamTokens(
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

async function handleMessage(ws: WebSocket, text: string): Promise<void> {
  const state = getState(ws);

  if (state.abortController) {
    state.abortController.abort();
  }

  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  const echoText = `You said: "${text}"`;
  const completed = await streamTokens(ws, echoText, signal);

  if (completed) {
    send(ws, { type: "stream_end", reason: "done" });
  }

  state.abortController = null;
}

function handleCancel(ws: WebSocket): void {
  const state = getState(ws);

  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
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
