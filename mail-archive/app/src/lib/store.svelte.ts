import type { LibraryStatus, SearchResults } from "./api";

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
  /** Latest library_status (null until the first one arrives). */
  status: null as LibraryStatus | null,
  /** Why the status could not be read (not set for "busy", which is retried). */
  statusError: null as string | null,
  /** Bumped to make SearchBox re-run the current query (after an import or rebuild). */
  refresh: 0,
});
