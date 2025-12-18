# Design Decisions

## Integration Strategy (What We Built)

- LLM output is buffered fully before any client streaming.
- Grounding runs on the full buffered response.
- Only verified content is streamed to the client.
- Fail-closed responses are server-generated, not LLM-generated.
- Cancel always wins: no response is sent if cancel is received at any stage.

---

## Rejected Alternatives

### 1. Real-time Streaming with Per-Token Grounding

**Considered:** Stream tokens directly to client as they arrive from LLM, running grounding checks incrementally.

**Rejected because:**
- Numbers often span multiple tokens (e.g., "2", "99" arriving separately for "299")
- Cannot reliably detect hallucinated numbers until full response is available
- Would require complex rollback mechanism if hallucination detected mid-stream
- User would see partial hallucinated content before it gets blocked
- Violates fail-closed principle: user sees unverified content

**Chosen instead:** Buffer-then-verify-then-stream. Slightly higher latency but guarantees no hallucinated numbers reach the client.

---

### 2. LLM-Based Intent Detection for Action Triggers

**Considered:** Use the LLM to detect user intent (e.g., "I think the user wants to schedule a callback") instead of keyword matching.

**Rejected because:**
- Adds latency: requires additional LLM call before action detection
- Introduces hallucination risk in the detection itself (LLM might "detect" intent that wasn't there)
- Assignment specifies exact trigger phrases for testability
- Simple keyword matching is deterministic, fast, and testable
- No false positives: "ring mig" always means schedule_callback

**Chosen instead:** Deterministic keyword triggers as specified in assignment. Predictable, fast, zero hallucination risk.

---

### 3. External Storage (Redis) for Idempotency State

**Considered:** Use Redis or similar external store for tracking executed actions and pending suggestions.

**Rejected because:**
- Adds infrastructure complexity for a single-server demo
- 30-second idempotency window is short; in-memory is sufficient
- WeakMap automatically garbage-collects when WebSocket closes
- No horizontal scaling requirement in assignment
- Keeps deployment simple: single `npm start`

**Chosen instead:** In-memory Maps per connection with WeakMap for automatic cleanup. Appropriate for single-server scope.

---

### 4. RAG with Context Injection (Prompt Stuffing)

**Considered:** Inject retrieved KB snippets into LLM prompt so it generates grounded responses from the start.

**Rejected because:**
- Mock LLM doesn't support dynamic prompting (fixed responses for testing)
- Still requires post-verification (LLM can ignore injected context)
- Doesn't eliminate hallucination, only reduces it
- Assignment focuses on guardrails that catch hallucinations, not prevention
- Post-verification is the actual safety net regardless of prompting strategy

**Chosen instead:** Post-generation verification as the authoritative check. Even with perfect prompting, verification is required for fail-closed guarantee.

---

### 5. NLP-Based Entity Extraction for Numbers

**Considered:** Use NLP library (compromise, natural) to extract numeric entities with semantic understanding.

**Rejected because:**
- Adds heavy dependencies for a focused task
- Regex handles all specified formats: integers, decimals, percentages, phone numbers, dates
- NLP libraries may miss domain-specific formats or introduce false positives
- Normalization logic (comma/dot, spacing) is straightforward with regex
- Easier to debug and test deterministic regex patterns

**Chosen instead:** Regex-based extraction with explicit normalization. Covers all assignment cases, zero external dependencies, fully testable.