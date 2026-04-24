/**
 * SQL-ish query string parser for SearchFilters.
 *
 * Syntax: type:kick bpm:>120 tag:dark pack:"Techno Essentials" score:>70 bright
 * - key:value / key:>value / key:<value / key:N-M for structured filters
 * - Bare words = text search on filename
 */

import type { SearchFilters } from "../api/types";

/**
 * Split input by spaces while respecting quoted strings.
 */
export function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (inQuote && ch === quoteChar) {
      inQuote = false;
      current += ch;
      quoteChar = "";
    } else if (!inQuote && ch === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Strip surrounding quotes from a value.
 */
export function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a query string into SearchFilters.
 */
export function parseQuery(input: string): Partial<SearchFilters> {
  const tokens = splitTokens(input.trim());
  const filters: Partial<SearchFilters> = {};
  const bareWords: string[] = [];

  for (const token of tokens) {
    const colonIndex = token.indexOf(":");
    if (colonIndex === -1) {
      bareWords.push(token);
      continue;
    }

    const field = token.slice(0, colonIndex).toLowerCase();
    const rawValue = token.slice(colonIndex + 1);
    const value = unquote(rawValue);

    switch (field) {
      case "bpm": {
        if (value.startsWith(">")) {
          filters.min_bpm = Number(value.slice(1));
        } else if (value.startsWith("<")) {
          filters.max_bpm = Number(value.slice(1));
        } else if (value.includes("-")) {
          const [min, max] = value.split("-");
          filters.min_bpm = Number(min);
          filters.max_bpm = Number(max);
        }
        break;
      }

      case "tag":
        if (!filters.tags) {
          filters.tags = [];
        }
        filters.tags.push(value);
        break;

      case "pack":
        // Accept numeric pack_id or pack name
        if (/^\d+$/.test(value)) {
          filters.pack_id = Number(value);
        }
        break;

      case "score": {
        if (value.startsWith(">")) {
          filters.min_score = Number(value.slice(1));
        } else if (value.startsWith("<")) {
          filters.max_score = Number(value.slice(1));
        }
        break;
      }

      default:
        // Unknown field, treat as bare word
        bareWords.push(token);
        break;
    }
  }

  if (bareWords.length > 0) {
    filters.query = bareWords.join(" ");
  }

  return filters;
}
