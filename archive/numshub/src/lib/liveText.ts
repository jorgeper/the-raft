// Local-agreement stabilizer for live transcription (SPEC3 FR-L4, U6).
//
// Successive re-transcription passes wobble at the tail (the engine changes
// its mind as context grows). Words that two consecutive passes agree on are
// promoted to `stable`; stable text NEVER shrinks and NEVER rewrites — the
// UI renders stable solid and the still-changing tail dimmed.

export interface LiveText {
  stable: string;
  tentative: string;
}

export const EMPTY_LIVE: LiveText = { stable: "", tentative: "" };

/** Case- and punctuation-insensitive word identity for agreement checks. */
function norm(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function join(list: string[]): string {
  return list.join(" ");
}

/** A pass is noise if it contains no word-like content (e.g. "" or "."). */
function isNoise(list: string[]): boolean {
  return list.every((w) => norm(w) === "");
}

export function stabilize(prev: LiveText, nextRaw: string): LiveText {
  const nextWords = words(nextRaw);
  if (isNoise(nextWords)) {
    return prev; // never regress on an empty/noise pass
  }

  const stableWords = words(prev.stable);
  const prevAll = [...stableWords, ...words(prev.tentative)];

  // Longest agreeing prefix between the previous pass's full text and this one.
  let agree = 0;
  while (
    agree < prevAll.length &&
    agree < nextWords.length &&
    norm(prevAll[agree]) !== "" &&
    norm(prevAll[agree]) === norm(nextWords[agree])
  ) {
    agree++;
  }

  // Stable never shrinks; agreed words beyond it are promoted. Promoted words
  // keep their first-seen rendering (from the previous pass); the tentative
  // tail always shows the newest rendering.
  const stableCount = Math.max(stableWords.length, agree);
  const stable = join([...stableWords, ...prevAll.slice(stableWords.length, stableCount)]);
  const tentative = join(nextWords.slice(stableCount));

  return { stable, tentative };
}
