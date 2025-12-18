// Incoming messages from client
export type ClientMessage =
  | { type: "message"; id: string; text: string }
  | { type: "cancel" }
  | { type: "confirm_action"; suggestionId: string };

// Outgoing messages to client
export type ServerMessage =
  | { type: "stream"; delta: string }
  | { type: "stream_end"; reason: "done" | "cancelled" }
  | { type: "response"; text: string; citations: Citation[] }
  | { type: "action_suggestion"; suggestionId: string; action: ActionType; payload: unknown }
  | { type: "action_executed"; suggestionId: string; result: ActionResult };

export interface Citation {
  file: string;
  snippet: string;
}

export type ActionType = "schedule_callback" | "send_sms" | "create_ticket";

export interface ActionResult {
  success?: boolean;
  ignored?: boolean;
  error?: string;
}
