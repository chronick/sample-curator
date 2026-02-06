/**
 * Query bar that parses SQL-ish query syntax into SearchFilters.
 *
 * Syntax: type:kick bpm:>120 tag:dark pack:"Techno Essentials" score:>70 bright
 * - key:value / key:>value / key:<value / key:N-M for structured filters
 * - Bare words = text search on filename
 * - Auto-complete dropdown: field names after space, field values after ':'
 * - Committed tokens render as colored pills
 * - On Enter or selecting an autocomplete option, parse and call onFiltersChange
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { SearchFilters, Pack } from "../api/types";

interface QueryBarProps {
  filters: SearchFilters;
  onFiltersChange: (filters: Partial<SearchFilters>) => void;
  allTags: string[];
  packs: Pack[];
}

const FIELD_NAMES = ["bpm", "tag", "pack", "score", "key"] as const;

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

interface AutocompleteOption {
  label: string;
  value: string;
}

export function QueryBar({
  filters,
  onFiltersChange,
  allTags,
  packs,
}: QueryBarProps) {
  const [input, setInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Build the display string from current filters on mount
  useEffect(() => {
    const parts: string[] = [];

    if (filters.min_bpm != null && filters.max_bpm != null) {
      parts.push(`bpm:${filters.min_bpm}-${filters.max_bpm}`);
    } else if (filters.min_bpm != null) {
      parts.push(`bpm:>${filters.min_bpm}`);
    } else if (filters.max_bpm != null) {
      parts.push(`bpm:<${filters.max_bpm}`);
    }
    if (filters.min_score != null) parts.push(`score:>${filters.min_score}`);
    if (filters.max_score != null) parts.push(`score:<${filters.max_score}`);
    if (filters.pack_id != null) parts.push(`pack:${filters.pack_id}`);
    if (filters.tags) {
      for (const tag of filters.tags) {
        parts.push(`tag:${tag.includes(" ") ? `"${tag}"` : tag}`);
      }
    }
    if (filters.query) parts.push(filters.query);

    setInput(parts.join(" "));
    // Only sync from filters on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute autocomplete options based on current input
  const options = useMemo((): AutocompleteOption[] => {
    if (!input) return [];

    const cursorWord = input.split(" ").pop() || "";

    // If the current word has a colon, suggest values for that field
    const colonIndex = cursorWord.indexOf(":");
    if (colonIndex !== -1) {
      const field = cursorWord.slice(0, colonIndex).toLowerCase();
      const partial = cursorWord.slice(colonIndex + 1).toLowerCase();

      switch (field) {
        case "tag":
          return allTags
            .filter((t) => t.toLowerCase().startsWith(partial))
            .slice(0, 10)
            .map((t) => ({
              label: `tag:${t}`,
              value: `tag:${t.includes(" ") ? `"${t}"` : t}`,
            }));
        case "pack":
          return packs
            .filter((p) =>
              p.name.toLowerCase().startsWith(partial) ||
              String(p.id).startsWith(partial)
            )
            .slice(0, 10)
            .map((p) => ({
              label: `pack:${p.name}`,
              value: `pack:${p.id}`,
            }));
        case "bpm":
          return [
            { label: "bpm:>N (min)", value: "bpm:>" },
            { label: "bpm:<N (max)", value: "bpm:<" },
            { label: "bpm:N-M (range)", value: "bpm:" },
          ];
        case "score":
          return [
            { label: "score:>N (min)", value: "score:>" },
            { label: "score:<N (max)", value: "score:<" },
          ];
        default:
          return [];
      }
    }

    // Otherwise suggest field names
    if (cursorWord) {
      return FIELD_NAMES.filter((f) => f.startsWith(cursorWord.toLowerCase())).map(
        (f) => ({ label: `${f}:`, value: `${f}:` })
      );
    }

    // After a space with no text, show all field names
    if (input.endsWith(" ")) {
      return FIELD_NAMES.map((f) => ({ label: `${f}:`, value: `${f}:` }));
    }

    return [];
  }, [input, allTags, packs]);

  // Reset selected index when options change
  useEffect(() => {
    setSelectedIndex(0);
  }, [options]);

  const applyFilters = useCallback(() => {
    const parsed = parseQuery(input);
    onFiltersChange(parsed);
    setShowDropdown(false);
  }, [input, onFiltersChange]);

  const selectOption = useCallback(
    (option: AutocompleteOption) => {
      const words = input.split(" ");
      words[words.length - 1] = option.value;
      const newInput = words.join(" ");
      setInput(newInput);
      setShowDropdown(false);
      inputRef.current?.focus();

      // If the option is a complete value (not ending with : or > or <), apply filters
      if (
        !option.value.endsWith(":") &&
        !option.value.endsWith(">") &&
        !option.value.endsWith("<")
      ) {
        const parsed = parseQuery(newInput);
        onFiltersChange(parsed);
      }
    },
    [input, onFiltersChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown && options.length > 0) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < options.length - 1 ? prev + 1 : 0
          );
          return;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : options.length - 1
          );
          return;
        case "Tab":
          e.preventDefault();
          selectOption(options[selectedIndex]);
          return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (showDropdown && options.length > 0) {
        selectOption(options[selectedIndex]);
      } else {
        applyFilters();
      }
    }

    if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder='Search samples... (type:kick bpm:>120 tag:dark)'
          className="w-full pl-9 pr-3 py-1.5 bg-surface-raised border border-surface-border rounded text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-accent"
        />
      </div>

      {/* Autocomplete dropdown */}
      {showDropdown && options.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-20 w-full mt-1 bg-surface-raised border border-surface-border rounded shadow-lg max-h-48 overflow-y-auto"
        >
          {options.map((option, index) => (
            <button
              key={option.value + index}
              onClick={() => selectOption(option)}
              className={`w-full px-3 py-1.5 text-left text-sm ${
                index === selectedIndex
                  ? "bg-surface-hover text-white"
                  : "text-gray-300 hover:bg-surface-hover"
              }`}
            >
              <span className="text-accent">{option.label.split(":")[0]}</span>
              {option.label.includes(":") && (
                <span className="text-gray-400">
                  :{option.label.split(":").slice(1).join(":")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default QueryBar;
