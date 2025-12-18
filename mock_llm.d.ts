/**
 * Mock LLM that streams tokens and sometimes hallucinates numbers.
 * Used for testing grounding/guardrails.
 */
export interface StreamOptions {
    signal?: AbortSignal;
    delayMs?: number;
}
type TokenCallback = (token: string) => void;
export declare function streamResponse(userText: string, onToken: TokenCallback, options?: StreamOptions): Promise<boolean>;
export {};
//# sourceMappingURL=mock_llm.d.ts.map