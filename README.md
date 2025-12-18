# Mini Realtime Agent

WebSocket-server som streamar AI-svar med inbyggda guardrails mot hallucinationer.

## Snabbstart

```bash
# Installera dependencies
npm install

# Starta servern
npm start

# Kör tester
npm test
```

Servern startar på `ws://localhost:8787`

## Projektstruktur

```
├── src/
│   ├── server.ts      # WebSocket-server, message handling, actions
│   ├── grounding.ts   # Hallucinationsskydd, KB-sökning, citations
│   └── types.ts       # TypeScript interfaces
├── mock_llm.ts        # Fake LLM som streamar och hallucinerar
├── kb/                # Kunskapsbas (5 markdown-filer)
│   ├── pricing.md     # Priser och rabatter
│   ├── policies.md    # Ångerrätt, garantier
│   ├── contact.md     # Telefon, email
│   ├── opening-hours.md
│   └── faq.md
├── tests/
│   └── grounding.test.ts
└── docs/
    ├── assignment.md  # Uppgiftsbeskrivning
    └── decisions.md   # Designbeslut och förkastade alternativ
```

## WebSocket API

### Meddelanden IN

| Type | Payload | Beskrivning |
|------|---------|-------------|
| `message` | `{ type: "message", id: string, text: string }` | Användarmeddelande |
| `cancel` | `{ type: "cancel" }` | Avbryt pågående stream |
| `confirm_action` | `{ type: "confirm_action", suggestionId: string }` | Bekräfta föreslagen action |

### Meddelanden UT

| Type | Payload | Beskrivning |
|------|---------|-------------|
| `stream` | `{ type: "stream", delta: string }` | Token i streamen |
| `stream_end` | `{ type: "stream_end", reason: "done" \| "cancelled" }` | Stream avslutad |
| `response` | `{ type: "response", text: string, citations: [...] }` | Fullständigt svar med källor |
| `action_suggestion` | `{ type: "action_suggestion", suggestionId, action, payload }` | Föreslagen action |
| `action_executed` | `{ type: "action_executed", suggestionId, result }` | Action utförd |

## Designval

### 1. Buffer-then-Verify-then-Stream

LLM-output buffras helt innan något streamas till klient. Grounding körs på hela svaret, sedan streamas endast verifierat innehåll. Detta garanterar att inga hallucinerade siffror når användaren.

### 2. Fail-Closed Policy

- **Inga källor:** `"Jag hittar inget stöd i kunskapsbasen."` (citations: [])
- **Ogrundade siffror:** `"Jag kan inte verifiera det."` (citations visar top hits)

### 3. Sifferverifiering

Alla siffror i svaret (heltal, decimaler, procent, telefonnummer) måste finnas i citerade KB-snippets. Normalisering hanterar:
- `12,5` ↔ `12.5`
- `08-123 45 67` ↔ `08-1234567`
- `20%` ↔ `20 %`

### 4. Deterministiska Action-Triggers

Keyword-baserad detection istället för LLM-tolkning:
- `"ring mig"`, `"ring upp"` → `schedule_callback`
- `"skicka sms"`, `"sms:a"` → `send_sms`
- `"skapa ärende"`, `"öppna ticket"` → `create_ticket`

### 5. Idempotency

Samma `suggestionId` inom 30 sekunder ignoreras och returnerar `{ ignored: true }`.

### 6. Cancel Wins

Cancel avbryter omedelbart oavsett fas (LLM-buffring, grounding, streaming). Ingen response skickas för avbruten request.

## Innovation: Retrieve-First, Answer-Second

Implementerat enligt assignment alternativ 1: Agenten buffrar hela LLM-svaret och kör grounding innan något streamas. Detta ger modellen mindre chans att leverera hallucinationer till användaren.

## Tester

```bash
npm test
```

Testar:
- Siffernormalisering (comma/dot, spacing)
- Number extraction (heltal, decimaler, procent, telefon)
- Fail-closed: no_sources
- Fail-closed: ungrounded_numbers
- Grounded responses med korrekta citations
- Citation-format och deduplicering

## Dependencies

- `ws` - WebSocket server
- `tsx` - TypeScript execution
- `jest` + `ts-jest` - Testing
