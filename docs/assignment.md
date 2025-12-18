Koduppgift: Mini Realtime Agent
Tid: 2–3 timmar  |  Stack: Node 18+, TypeScript, WebSocket
Bakgrund
Vi bygger AI-agenter som pratar med användare i realtid – tänk en kundtjänst-bot som kan svara på frågor, boka möten och skapa ärenden. En av de största utmaningarna är hallucinationer: när modellen hittar på fakta som inte stämmer.
I produktion är detta kritiskt. Om agenten säger "ni har 14 dagars ångerrätt" när det egentligen är 30 dagar, eller hittar på ett telefonnummer, kan det få juridiska och affärsmässiga konsekvenser.
Den här uppgiften testar hur du bygger en agent med inbyggda guardrails – säkerhetsmekanismer som fångar och blockerar felaktig information innan den når användaren.
Syfte
Vi vill se hur du bygger, tänker och använder AI-verktyg. Du ska använda Claude Code (eller liknande CLI-baserat AI-verktyg som Codex CLI) för att lösa uppgiften.
Vi bedömer både slutresultatet och din process – hur du promptar, itererar, och instruerar agenten. Därför kräver vi en terminalinspelning (se nedan).
Vad du ska bygga
En WebSocket-server som:
    • Streamar svar – token för token, med möjlighet att avbryta mitt i
    • Groundar svar mot en kunskapsbas – alla fakta och siffror måste kunna beläggas
    • Föreslår actions som kräver bekräftelse – t.ex. "boka samtal" eller "skicka SMS"
    • Fail-closed – hellre "jag vet inte" än felaktig information
Du ska också skapa:
    • mock_llm.ts – en fake LLM som streamar tokens och ibland hittar på siffror (för att testa dina guardrails)
    • kb/ – en kunskapsbas med minst 5 markdown-filer (t.ex. priser, policies, kontaktinfo)
    • Tester – som visar att dina guardrails fungerar
Krav
1. WebSocket-server
Starta på ws://localhost:8787
Meddelanden IN:
    • { type: "message", id: string, text: string }
    • { type: "cancel" }
    • { type: "confirm_action", suggestionId: string }
Meddelanden UT:
    • { type: "stream", delta: string }
    • { type: "stream_end", reason: "done" | "cancelled" }
    • { type: "response", text, citations: Array<{ file, snippet }> }
    • { type: "action_suggestion", suggestionId, action, payload }
    • { type: "action_executed", suggestionId, result }
2. Grounding (hallucinationsskydd)
Definition av "siffra"
    • Siffra = 0-9-sekvenser inkl. decimaler och procent: 12, 12.5, 12,5, 50%, 2025-12-12, +46...
    • Normalisering: behandla 12,5 och 12.5 som samma
    • Regel: om en siffra finns i slutsvaret måste exakt token (normaliserat) förekomma i minst en citerad snippet
Citatformat
    • snippet = 1–3 rader kontext som faktiskt innehåller stödtexten (inkl. siffror)
    • file = sökväg till kb-fil, t.ex. kb/pricing.md
Fail-closed policy
    • Om retrieval ger 0 källor → svara: "Jag hittar inget stöd i kunskapsbasen." med citations: []
    • Om sifferregel bryts → svara: "Jag kan inte verifiera det." och citations ska visa top hits (utan siffran)
3. Actions med bekräftelse
Agenten kan föreslå actions: schedule_callback, send_sms, create_ticket
Triggers (för testbarhet)
Agenten får bara föreslå action om användartext matchar enkla triggers:
    • "ring mig", "ring upp" → schedule_callback
    • "skicka sms", "sms:a" → send_sms
    • "skapa ärende", "öppna ticket" → create_ticket
Flöde
    1. Agent skickar action_suggestion med suggestionId, action, payload
    2. Klient skickar confirm_action med samma suggestionId
    3. Server exekverar och skickar action_executed
Idempotency
Samma suggestionId inom 30 sekunder = ignorera. Skicka { type: "action_executed", suggestionId, result: { ignored: true } }
4. Cancel
När klienten skickar { type: "cancel" }:
    • Avbryt pågående streaming omedelbart
    • Skicka { type: "stream_end", reason: "cancelled" }
    • Skicka inte response för den avbrutna requesten
    • Servern ska vara redo för nästa message direkt
Innovation (valfritt men meriterande)
Grundkraven stoppar hallucinationer i slutet (efter att modellen genererat ett svar). Men hur designar du flödet så modellen har mindre chans att hitta på från början?
Välj minst 1 av följande (fler = bättre signal):
    1. Retrieve-first, answer-second: Agenten börjar inte streama svar förrän retrieval är klar och top-k snippets är valda.
    2. Query rewriting: Agenten gör en "search query" (max 12 ord) av user text innan retrieval – bättre träffar även vid slarviga frågor.
    3. Evidence budget: Prompta LLM med "Use ONLY facts from provided snippets. If missing, ask a clarifying question."
    4. Strukturerat svar först: LLM genererar JSON med claims + evidence, servern renderar text + citations från det.
    5. Verifier-pass: Kör ett andra pass som plockar ut claims/siffror ur draft, checkar mot citations, och re-writer vid mismatch.
    6. Confidence/refusal policy: Returnera confidence: low|med|high baserat på evidens-täckning.

Inlämning
Skapa ett GitHub-repo med följande:
Kod
    • src/ – din implementation
    • mock_llm.ts – din fake LLM som streamar och ibland hallucinerar
    • kb/ – din kunskapsbas (minst 5 markdown-filer)
    • README.md – hur man kör + dina designval
    • npm test ska köra och visa att grundläggande krav fungerar
Process – terminalinspelning
Du måste använda Claude Code (eller liknande CLI-verktyg) för att lösa uppgiften. Vi bedömer hur du instruerar agenten – dina prompts, iterationer och beslut.
För att vi ska kunna se din process kräver vi en terminalinspelning med asciinema. Det är ett verktyg som spelar in allt som händer i terminalen – kommandon, output, och dina interaktioner med Claude Code.
Installera asciinema
# macOS
brew install asciinema
# Ubuntu/Debian
sudo apt install asciinema
# Windows (via pip)
pip install asciinema
Så här spelar du in
    1. Starta inspelningen innan du börjar jobba:
asciinema rec session.cast
    2. Jobba som vanligt – starta Claude Code, prompta, iterera
    3. När du är klar, skriv exit för att avsluta inspelningen
    4. Inkludera session.cast i ditt repo
Tips: Vi kan spela upp inspelningen i webbläsaren och scrubba igenom den. Du behöver inte prata – vi ser allt du skriver.
Övriga processfiler
    • .claude/ – inkludera hela mappen (CLAUDE.md, settings.json, etc.) så vi ser dina instruktioner till agenten
    • DECISIONS.md – minst 2 exempel på lösningar/förslag du valde bort och varför
Bedömning
Område	Godkänd	Bra	Stark
Streaming + cancel	Funkar	Rensar state korrekt	Hanterar edge cases (cancel under action)
Grounding	Sifferkoll finns	Citations korrekt format	Fail-closed, tydliga felmeddelanden
Actions	Confirm-flöde funkar	Idempotency + triggers	Bra error handling, timeout
Kod	Läsbar	Typad, strukturerad	Testbar, separerade concerns
AI-process	session.cast + .claude finns	Visar iteration + beslut	Smarta instruktioner, reflekterar
Innovation	–	1 metod implementerad	Verifier-loop + claim→evidence
Kom igång
mkdir realtime-agent && cd realtime-agent
git init
npm init -y
asciinema rec session.cast   # starta inspelning
claude                        # starta Claude Code
# ... jobba ...
exit                          # avsluta inspelningen
Tips
    • Börja med WebSocket + streaming, lägg till grounding sen
    • Din mock_llm ska hallucinera med flit – det är så du testar dina guardrails
    • Konfigurera .claude/CLAUDE.md med projektspecifika instruktioner – vi tittar på detta!
    • Hellre fungerande MVP än halvfärdig "perfekt" lösning
Frågor?
Maila oss – vi svarar inom några timmar på arbetstid.
Lycka till!