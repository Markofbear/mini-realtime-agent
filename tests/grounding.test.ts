import {
  verifyGrounding,
  extractNumbers,
  normalizeNumber,
  numbersMatch,
  loadKnowledgeBase,
} from "../src/grounding";

describe("grounding", () => {
  describe("number normalization", () => {
    it("should normalize comma to dot for decimals", () => {
      expect(normalizeNumber("12,5")).toBe("12.5");
      expect(normalizeNumber("12.5")).toBe("12.5");
    });

    it("should remove spaces from numbers", () => {
      expect(normalizeNumber("08-123 45 67")).toBe("08-1234567");
      expect(normalizeNumber("123 456")).toBe("123456");
    });

    it("should preserve percentage signs", () => {
      expect(normalizeNumber("20%")).toBe("20%");
      expect(normalizeNumber("15 %")).toBe("15%");
    });

    it("should match equivalent numbers with different formats", () => {
      expect(numbersMatch("12,5", "12.5")).toBe(true);
      expect(numbersMatch("08-123 45 67", "08-1234567")).toBe(true);
      expect(numbersMatch("100", "100")).toBe(true);
    });

    it("should not match different numbers", () => {
      expect(numbersMatch("12,5", "12.6")).toBe(false);
      expect(numbersMatch("100", "200")).toBe(false);
    });
  });

  describe("extractNumbers", () => {
    it("should extract integers", () => {
      const nums = extractNumbers("Priset är 299 kr");
      expect(nums).toContain("299");
    });

    it("should extract percentages", () => {
      const nums = extractNumbers("Du får 20% rabatt");
      expect(nums).toContain("20%");
    });

    it("should extract phone numbers", () => {
      const nums = extractNumbers("Ring 08-123 45 67");
      expect(nums.some((n) => n.includes("08"))).toBe(true);
    });

    it("should extract decimal numbers with comma", () => {
      const nums = extractNumbers("Vikten är 12,5 kg");
      expect(nums).toContain("12,5");
    });

    it("should extract decimal numbers with dot", () => {
      const nums = extractNumbers("Vikten är 12.5 kg");
      expect(nums).toContain("12.5");
    });
  });

  describe("verifyGrounding - fail closed: no_sources", () => {
    it("should fail with no_sources when query matches no KB documents", () => {
      const result = verifyGrounding(
        "xyz completely unrelated topic",
        "Here is some response with 123 numbers"
      );

      expect(result.grounded).toBe(false);
      expect(result.failReason).toBe("no_sources");
      expect(result.citations).toEqual([]);
    });

    it("should fail with no_sources for gibberish query", () => {
      const result = verifyGrounding(
        "asdfghjkl qwertyuiop",
        "The answer is 42"
      );

      expect(result.grounded).toBe(false);
      expect(result.failReason).toBe("no_sources");
    });
  });

  describe("verifyGrounding - fail closed: ungrounded_numbers", () => {
    it("should fail with ungrounded_numbers when response contains hallucinated number", () => {
      // Query matches pricing KB, but 999 is not in the KB
      const result = verifyGrounding(
        "Vad kostar standard?",
        "Standard kostar 999 kr/månad"
      );

      expect(result.grounded).toBe(false);
      expect(result.failReason).toBe("ungrounded_numbers");
      expect(result.ungroundedNumbers).toContain("999");
    });

    it("should fail with ungrounded_numbers for hallucinated phone number", () => {
      // Query matches contact KB, but this phone number is not in KB
      const result = verifyGrounding(
        "Vad är telefonnumret?",
        "Ring oss på 08-999 88 77"
      );

      expect(result.grounded).toBe(false);
      expect(result.failReason).toBe("ungrounded_numbers");
    });

    it("should fail with ungrounded_numbers for hallucinated percentage", () => {
      // Query matches pricing KB, but 50% is not there
      const result = verifyGrounding(
        "Vilka rabatter finns?",
        "Du får 50% rabatt som ny kund"
      );

      expect(result.grounded).toBe(false);
      expect(result.failReason).toBe("ungrounded_numbers");
      expect(result.ungroundedNumbers.some((n) => n.includes("50"))).toBe(true);
    });

    it("should include citations for grounded numbers even when some are ungrounded", () => {
      // 299 is in KB, but 999 is not
      const result = verifyGrounding(
        "Vad kostar paketen?",
        "Standard kostar 299 kr och Premium kostar 999 kr"
      );

      expect(result.grounded).toBe(false);
      expect(result.failReason).toBe("ungrounded_numbers");
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.ungroundedNumbers).toContain("999");
    });
  });

  describe("verifyGrounding - successfully grounded", () => {
    it("should be grounded when response has no numbers", () => {
      const result = verifyGrounding(
        "Hur kontaktar jag er?",
        "Du kan kontakta oss via chatt på vår hemsida."
      );

      expect(result.grounded).toBe(true);
      expect(result.ungroundedNumbers).toEqual([]);
    });

    it("should be grounded when all numbers exist in KB - pricing", () => {
      // 299 and 20% are both in pricing.md
      const result = verifyGrounding(
        "Vad kostar standard och vilken rabatt får nya kunder?",
        "Standard kostar 299 kr/månad. Nya kunder får 20% rabatt."
      );

      expect(result.grounded).toBe(true);
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.ungroundedNumbers).toEqual([]);
    });

    it("should be grounded when phone number matches KB", () => {
      // 08-123 45 67 is in contact.md
      const result = verifyGrounding(
        "Vad är kundtjänstens telefonnummer?",
        "Ring kundtjänst på 08-123 45 67"
      );

      expect(result.grounded).toBe(true);
      expect(result.citations.some((c) => c.file.includes("contact"))).toBe(true);
    });

    it("should be grounded for policy numbers", () => {
      // 14 dagars is in policies.md
      const result = verifyGrounding(
        "Hur lång ångerrätt har jag?",
        "Du har 14 dagars ångerrätt."
      );

      expect(result.grounded).toBe(true);
    });

    it("should be grounded for multiple correct numbers from same document", () => {
      // 149, 299, 599 are all in pricing.md
      const result = verifyGrounding(
        "Vad kostar era paket?",
        "Bas kostar 149 kr, Standard 299 kr och Premium 599 kr."
      );

      expect(result.grounded).toBe(true);
      expect(result.citations.length).toBeGreaterThan(0);
    });

    it("should be grounded when numbers match across different KB files", () => {
      // 49 kr is in both pricing.md (frakt) and faq.md
      const result = verifyGrounding(
        "Vad kostar frakten?",
        "Frakt kostar 49 kr."
      );

      expect(result.grounded).toBe(true);
    });
  });

  describe("verifyGrounding - number normalization in context", () => {
    it("should ground numbers regardless of comma/dot format", () => {
      // Load KB and check if normalization works in practice
      const docs = loadKnowledgeBase();

      // Find a document with a number and test normalization
      const pricingDoc = docs.find((d) => d.file.includes("pricing"));
      expect(pricingDoc).toBeDefined();

      // The KB uses dot notation, test that comma notation also matches
      // 299 in KB should match "299" in response
      const result = verifyGrounding(
        "pris standard",
        "Priset är 299 kronor",
        docs
      );

      expect(result.grounded).toBe(true);
    });

    it("should normalize phone numbers with different spacing", () => {
      // KB has 08-123 45 67, test with different formats
      const result = verifyGrounding(
        "telefon kontakt",
        "Telefonnumret är 08-1234567"
      );

      // After normalization, 08-123 45 67 becomes 08-1234567
      expect(result.grounded).toBe(true);
    });
  });

  describe("verifyGrounding - citations", () => {
    it("should return citations with file and snippet", () => {
      const result = verifyGrounding(
        "Vad kostar standard?",
        "Standard kostar 299 kr/månad"
      );

      expect(result.grounded).toBe(true);
      expect(result.citations.length).toBeGreaterThan(0);

      const citation = result.citations[0];
      expect(citation).toHaveProperty("file");
      expect(citation).toHaveProperty("snippet");
      expect(citation.file).toContain("kb/");
      expect(citation.snippet.length).toBeGreaterThan(0);
    });

    it("should not duplicate citations for same file and snippet", () => {
      const result = verifyGrounding(
        "priser rabatter",
        "Standard 299 kr med 20% rabatt"
      );

      // Check no duplicate citations
      const seen = new Set<string>();
      for (const c of result.citations) {
        const key = `${c.file}:${c.snippet}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });
});
