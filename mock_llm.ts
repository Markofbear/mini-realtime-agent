/**
 * Mock LLM that streams tokens and sometimes hallucinates numbers.
 * Used for testing grounding/guardrails.
 */

export interface StreamOptions {
  signal?: AbortSignal;
  delayMs?: number;
}

type TokenCallback = (token: string) => void;

const RESPONSES: Record<string, string[]> = {
  pricing: [
    "Vårt standardpaket kostar 299 kr/månad.", // correct: 299
    "Vårt standardpaket kostar 349 kr/månad.", // hallucinated: 349
    "Premium kostar 599 kr/månad med 20% rabatt första året.", // correct: 599, 20
  ],
  returns: [
    "Ni har 14 dagars ångerrätt enligt lag.", // correct: 14
    "Ni har 30 dagars ångerrätt enligt lag.", // hallucinated: 30
    "Ångerrätten gäller i 14 dagar från leverans.", // correct: 14
  ],
  contact: [
    "Ring oss på 08-123 45 67.", // correct: 08-123 45 67
    "Ring oss på 08-999 88 77.", // hallucinated phone
    "Vår support nås på support@example.com.", // no numbers
  ],
  default: [
    "Jag kan hjälpa dig med det.",
    "Låt mig kolla det åt dig.",
    "Tyvärr har jag inte den informationen just nu.",
  ],
};

function pickResponse(text: string): string {
  const lower = text.toLowerCase();

  let category: keyof typeof RESPONSES = "default";
  if (lower.includes("pris") || lower.includes("kost")) {
    category = "pricing";
  } else if (lower.includes("ånger") || lower.includes("retur")) {
    category = "returns";
  } else if (lower.includes("kontakt") || lower.includes("telefon") || lower.includes("ring")) {
    category = "contact";
  }

  const options = RESPONSES[category];
  const index = Math.floor(Math.random() * options.length);
  return options[index]!;
}

function tokenize(text: string): string[] {
  // Split on whitespace boundaries, preserving spaces
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

export async function streamResponse(
  userText: string,
  onToken: TokenCallback,
  options: StreamOptions = {}
): Promise<boolean> {
  const { signal, delayMs = 50 } = options;

  const response = pickResponse(userText);
  const tokens = tokenize(response);

  for (const token of tokens) {
    if (signal?.aborted) {
      return false;
    }

    onToken(token);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, delayMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new Error("Aborted"));
        },
        { once: true }
      );
    }).catch(() => {});

    if (signal?.aborted) {
      return false;
    }
  }

  return true;
}
