import { WebSocketServer, WebSocket } from "ws";
import { streamResponse } from "../mock_llm";
import { verifyGrounding, Citation } from "./grounding";

const PORT = 8787;

// --- Message Types ---

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
  text: string;
  citations: Citation[];
}

interface ActionSuggestionMessage {
  type: "action_suggestion";
  suggestionId: string;
  action: string;
  payload: Record<string, unknown>;
}

interface ActionExecutedMessage {
  type: "action_executed";
  suggestionId: string;
  result: { success: boolean } | { ignored: true };
}

type OutgoingMessage =
  | StreamMessage
  | StreamEndMessage
  | ResponseMessage
  | ActionSuggestionMessage
  | ActionExecutedMessage;

// --- Action Types ---

type ActionType = "schedule_callback" | "send_sms" | "create_ticket";

interface PendingAction {
  action: ActionType;
  payload: Record<string, unknown>;
  createdAt: number;
}

interface ExecutedAction {
  executedAt: number;
}

// --- Connection State ---

interface ConnectionState {
  abortController: AbortController | null;
  pendingActions: Map<string, PendingAction>;
  executedActions: Map<string, ExecutedAction>;
}

const connectionStates = new WeakMap<WebSocket, ConnectionState>();

// --- Triggers (as per assignment.md) ---

const ACTION_TRIGGERS: Array<{ patterns: string[]; action: ActionType }> = [
  { patterns: ["ring mig", "ring upp"], action: "schedule_callback" },
  { patterns: ["skicka sms", "sms:a"], action: "send_sms" },
  { patterns: ["skapa ärende", "öppna ticket"], action: "create_ticket" },
];

// Fail-closed messages: EXACTLY as per assignment.md
const FAIL_CLOSED_MESSAGES: Record<string, string> = {
  no_sources: "Jag hittar inget stöd i kunskapsbasen.",
  ungrounded_numbers: "Jag kan inte verifiera det.",
};

// Idempotency window in milliseconds
const IDEMPOTENCY_WINDOW_MS = 30000;

function getState(ws: WebSocket): ConnectionState {
  let state = connectionStates.get(ws);
  if (!state) {
    state = {
      abortController: null,
      pendingActions: new Map(),
      executedActions: new Map(),
    };
    connectionStates.set(ws, state);
  }
  return state;
}

function send(ws: WebSocket, message: OutgoingMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function generateSuggestionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function detectTrigger(text: string): ActionType | null {
  const lowerText = text.toLowerCase();
  for (const trigger of ACTION_TRIGGERS) {
    for (const pattern of trigger.patterns) {
      if (lowerText.includes(pattern)) {
        return trigger.action;
      }
    }
  }
  return null;
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
    // Send response message with text and citations (only when not cancelled)
    send(ws, { type: "response", text: responseToStream, citations });

    // Step 5: Check for action triggers in user's original message
    const detectedAction = detectTrigger(userText);
    if (detectedAction) {
      const suggestionId = generateSuggestionId();
      const payload: Record<string, unknown> = {};

      // Store pending action
      state.pendingActions.set(suggestionId, {
        action: detectedAction,
        payload,
        createdAt: Date.now(),
      });

      // Send action suggestion
      send(ws, {
        type: "action_suggestion",
        suggestionId,
        action: detectedAction,
        payload,
      });
    }
  }

  state.abortController = null;
}

function handleConfirmAction(ws: WebSocket, suggestionId: string): void {
  const state = getState(ws);
  const now = Date.now();

  // Check idempotency: was this already executed within 30s?
  const executed = state.executedActions.get(suggestionId);
  if (executed && now - executed.executedAt < IDEMPOTENCY_WINDOW_MS) {
    // Already executed within window - ignore
    send(ws, {
      type: "action_executed",
      suggestionId,
      result: { ignored: true },
    });
    return;
  }

  // Check if this is a valid pending action
  const pending = state.pendingActions.get(suggestionId);
  if (!pending) {
    // Unknown or expired suggestion - ignore silently
    return;
  }

  // Execute the action (mock execution)
  state.pendingActions.delete(suggestionId);
  state.executedActions.set(suggestionId, { executedAt: now });

  // Clean up old executed actions (older than 30s)
  for (const [id, exec] of state.executedActions) {
    if (now - exec.executedAt >= IDEMPOTENCY_WINDOW_MS) {
      state.executedActions.delete(id);
    }
  }

  // Send action executed confirmation
  send(ws, {
    type: "action_executed",
    suggestionId,
    result: { success: true },
  });
}

function handleCancel(ws: WebSocket): void {
  const state = getState(ws);

  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
    // Cancel: send stream_end cancelled and do NOTHING else (no response, no action_suggestion)
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
      } else if (msg.type === "confirm_action" && typeof msg.suggestionId === "string") {
        handleConfirmAction(ws, msg.suggestionId);
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
