# Mini Realtime Agent - Claude Code Instructions

## Project Context
WebSocket server for a customer service AI agent with built-in hallucination guardrails. The agent streams responses token-by-token while ensuring all facts/numbers are grounded in a knowledge base.

## Key Architecture Decisions
- **Buffer-then-verify-then-stream**: Never stream unverified content to client
- **Fail-closed**: When in doubt, refuse rather than hallucinate
- **Deterministic triggers**: Keyword-based action detection, no LLM interpretation

## File Structure
```
src/server.ts    - WebSocket server, message handling, action flow
src/grounding.ts - KB retrieval, number extraction, verification
mock_llm.ts      - Fake LLM with intentional hallucinations for testing
kb/              - Knowledge base (5 markdown files)
tests/           - Grounding tests
```

## Running the Project
```bash
npm install
npm start        # ws://localhost:8787
npm test         # Run grounding tests
```

## WebSocket Protocol
IN:  message, cancel, confirm_action
OUT: stream, stream_end, response, action_suggestion, action_executed

## Grounding Rules
1. Extract all numbers from LLM response (integers, decimals, %, phone numbers)
2. Normalize formats (12,5 ↔ 12.5, spacing in phone numbers)
3. Every number must exist in cited KB snippets
4. Fail-closed messages:
   - No sources: "Jag hittar inget stöd i kunskapsbasen."
   - Ungrounded numbers: "Jag kan inte verifiera det."

## Action Triggers
- "ring mig", "ring upp" → schedule_callback
- "skicka sms", "sms:a" → send_sms
- "skapa ärende", "öppna ticket" → create_ticket

## Testing Guardrails
The mock_llm.ts intentionally produces hallucinated numbers to test that grounding catches them. Run `npm test` to verify guardrails work.

## Constraints
- Swedish language for user-facing messages
- 30-second idempotency window for actions
- Cancel always wins (no partial responses)
