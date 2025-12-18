import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const KB_PATH = join(process.cwd(), "kb");

export interface Citation {
  file: string;
  snippet: string;
}

export interface GroundingResult {
  grounded: boolean;
  citations: Citation[];
  ungroundedNumbers: string[];
  failReason?: "no_sources" | "ungrounded_numbers";
}

// --- Number Extraction & Normalization ---

/**
 * Extracts all number-like tokens from text.
 * Matches: integers, decimals (comma or dot), percentages, dates, phone numbers.
 */
export function extractNumbers(text: string): string[] {
  // Pattern matches:
  // - Phone numbers: +46 70 123 45 67, 08-123 45 67
  // - Dates: 2025-12-12
  // - Percentages: 50%
  // - Decimals: 12.5, 12,5
  // - Integers: 123
  const pattern = /\+?[\d][\d\s\-.,:%]*/g;
  const matches = text.match(pattern) || [];

  return matches
    .map((m) => m.trim())
    .filter((m) => m.length > 0 && /\d/.test(m));
}

/**
 * Normalizes a number string for comparison.
 * - Replaces comma with dot for decimals
 * - Removes spaces
 * - Preserves other characters (%, -, :, +)
 */
export function normalizeNumber(num: string): string {
  return num
    .replace(/,/g, ".")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Checks if two number strings are equivalent after normalization.
 */
export function numbersMatch(a: string, b: string): boolean {
  return normalizeNumber(a) === normalizeNumber(b);
}

// --- Knowledge Base Retrieval ---

interface KBDocument {
  file: string;
  content: string;
}

/**
 * Loads all markdown files from the knowledge base.
 */
export function loadKnowledgeBase(): KBDocument[] {
  const files = readdirSync(KB_PATH).filter((f) => f.endsWith(".md"));

  return files.map((file) => ({
    file: `kb/${file}`,
    content: readFileSync(join(KB_PATH, file), "utf-8"),
  }));
}

/**
 * Simple keyword-based retrieval. Returns documents containing any query terms.
 */
export function retrieveDocuments(
  query: string,
  documents: KBDocument[]
): KBDocument[] {
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter((t) => t.length > 2);

  if (terms.length === 0) {
    return [];
  }

  return documents.filter((doc) => {
    const contentLower = doc.content.toLowerCase();
    return terms.some((term) => contentLower.includes(term));
  });
}

/**
 * Extracts a snippet (1-3 lines) around a matching term or number.
 */
export function extractSnippet(content: string, searchTerm: string): string | null {
  const lines = content.split("\n");
  const searchLower = searchTerm.toLowerCase();
  const searchNormalized = normalizeNumber(searchTerm);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineLower = line.toLowerCase();

    // Check for direct match or normalized number match
    if (lineLower.includes(searchLower)) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 2);
      return lines.slice(start, end).join("\n").trim();
    }

    // Check for normalized number match
    const lineNumbers = extractNumbers(line);
    for (const num of lineNumbers) {
      if (normalizeNumber(num) === searchNormalized) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        return lines.slice(start, end).join("\n").trim();
      }
    }
  }

  return null;
}

// --- Grounding Verification ---

/**
 * Finds citations for numbers in the response text.
 * Returns citations where the number appears in the snippet.
 */
export function findCitationsForNumber(
  num: string,
  documents: KBDocument[]
): Citation[] {
  const citations: Citation[] = [];
  const normalizedNum = normalizeNumber(num);

  for (const doc of documents) {
    const docNumbers = extractNumbers(doc.content);
    const hasMatch = docNumbers.some(
      (docNum) => normalizeNumber(docNum) === normalizedNum
    );

    if (hasMatch) {
      const snippet = extractSnippet(doc.content, num);
      if (snippet) {
        citations.push({ file: doc.file, snippet });
      }
    }
  }

  return citations;
}

/**
 * Main grounding function. Verifies that all numbers in responseText
 * can be cited from the knowledge base.
 *
 * Fail-closed policy:
 * - If no sources found for query: grounded=false, failReason="no_sources"
 * - If any number lacks citation: grounded=false, failReason="ungrounded_numbers"
 */
export function verifyGrounding(
  userQuery: string,
  responseText: string,
  documents?: KBDocument[]
): GroundingResult {
  const docs = documents ?? loadKnowledgeBase();
  const relevantDocs = retrieveDocuments(userQuery, docs);

  // Fail-closed: no sources found
  if (relevantDocs.length === 0) {
    return {
      grounded: false,
      citations: [],
      ungroundedNumbers: [],
      failReason: "no_sources",
    };
  }

  const responseNumbers = extractNumbers(responseText);

  // No numbers in response = grounded (nothing to verify)
  if (responseNumbers.length === 0) {
    return {
      grounded: true,
      citations: [],
      ungroundedNumbers: [],
    };
  }

  const allCitations: Citation[] = [];
  const ungroundedNumbers: string[] = [];

  for (const num of responseNumbers) {
    const citations = findCitationsForNumber(num, relevantDocs);

    if (citations.length === 0) {
      ungroundedNumbers.push(num);
    } else {
      // Deduplicate citations
      for (const citation of citations) {
        const exists = allCitations.some(
          (c) => c.file === citation.file && c.snippet === citation.snippet
        );
        if (!exists) {
          allCitations.push(citation);
        }
      }
    }
  }

  // Fail-closed: ungrounded numbers found
  if (ungroundedNumbers.length > 0) {
    return {
      grounded: false,
      citations: allCitations,
      ungroundedNumbers,
      failReason: "ungrounded_numbers",
    };
  }

  return {
    grounded: true,
    citations: allCitations,
    ungroundedNumbers: [],
  };
}
