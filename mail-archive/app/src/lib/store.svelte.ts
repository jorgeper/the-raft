import type { SearchResults } from "./api";

/** Shared UI state. `query` is the text in the search box. */
export const store = $state({
  query: "",
  /** Latest accepted search response (null until the first one arrives). */
  results: null as SearchResults | null,
  /** The exact query text `results` was computed for (chip spans index into it). */
  resultsQuery: "",
  /** True while the library is busy (import running); shown quietly, not as an error. */
  busy: false,
  /** Last non-busy search error text. */
  error: null as string | null,
});
