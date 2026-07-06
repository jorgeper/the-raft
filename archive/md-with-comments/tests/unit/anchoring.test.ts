import { describe, expect, test } from 'vitest';
import { CONTEXT_LENGTH, createAnchor, reanchor } from '../../src/lib/anchoring';

const DOC = [
  'Alpha section opens the document with some introductory prose that runs long enough',
  'to give every anchor plenty of surrounding context. The anchoring cascade resolves',
  'positions in four steps and this paragraph exists to feed it realistic text.',
  '',
  'Beta section holds the target sentence. The quick brown fox jumps over the lazy dog',
  'while the narrator keeps writing filler sentences about margins and highlights.',
  '',
  'Gamma section closes the document with a final paragraph mentioning sidecar files,',
  'pretty printed JSON, and the resolved comments drawer at the bottom of the panel.',
].join('\n');

describe('createAnchor', () => {
  test('captures exact text with 32 chars of prefix and suffix context', () => {
    const start = DOC.indexOf('quick brown fox');
    const end = start + 'quick brown fox'.length;
    const anchor = createAnchor(DOC, start, end);
    expect(anchor.exact).toBe('quick brown fox');
    expect(anchor.start).toBe(start);
    expect(anchor.end).toBe(end);
    expect(anchor.prefix).toBe(DOC.slice(start - CONTEXT_LENGTH, start));
    expect(anchor.suffix).toBe(DOC.slice(end, end + CONTEXT_LENGTH));
    expect(anchor.prefix.length).toBe(CONTEXT_LENGTH);
    expect(anchor.suffix.length).toBe(CONTEXT_LENGTH);
  });

  test('clamps prefix and suffix at the document boundaries', () => {
    const anchor = createAnchor(DOC, 0, 5);
    expect(anchor.prefix).toBe('');
    expect(anchor.exact).toBe(DOC.slice(0, 5));
    const tail = createAnchor(DOC, DOC.length - 6, DOC.length);
    expect(tail.suffix).toBe('');
  });
});

describe('reanchor cascade', () => {
  test('U1: exact-offset re-anchor succeeds after no edit', () => {
    const start = DOC.indexOf('The quick brown fox');
    const anchor = createAnchor(DOC, start, start + 'The quick brown fox'.length);
    const match = reanchor(anchor, DOC);
    expect(match).not.toBeNull();
    expect(match!.start).toBe(start);
    expect(match!.end).toBe(anchor.end);
    expect(match!.strategy).toBe('exact');
    expect(DOC.slice(match!.start, match!.end)).toBe(anchor.exact);
  });

  test('U2: quote-search re-anchor succeeds after text inserted before the anchor', () => {
    const target = 'The quick brown fox jumps over the lazy dog';
    const start = DOC.indexOf(target);
    const anchor = createAnchor(DOC, start, start + target.length);
    const inserted = 'A brand new opening paragraph was inserted at the very top.\n\n';
    const edited = inserted + DOC;
    const match = reanchor(anchor, edited);
    expect(match).not.toBeNull();
    expect(match!.start).toBe(start + inserted.length);
    expect(edited.slice(match!.start, match!.end)).toBe(target);
    expect(match!.strategy).toBe('quote');
  });

  test('U3: prefix/suffix disambiguates when exact appears 3+ times in the document', () => {
    const phrase = 'a repeated landmark phrase';
    const doc = [
      `First occurrence sits here: ${phrase}, inside the opening paragraph of the file.`,
      `Second occurrence sits here: ${phrase}, nested in the middle where we anchored it.`,
      `Third occurrence sits here: ${phrase}, wrapping up near the end of the document.`,
      `Fourth occurrence sits here: ${phrase}, for good measure beyond the third one.`,
    ].join('\n');
    const second = doc.indexOf(phrase, doc.indexOf(phrase) + 1);
    const anchor = createAnchor(doc, second, second + phrase.length);
    const inserted = 'Noise noise noise at the top of the file.\n';
    const edited = inserted + doc;
    const match = reanchor(anchor, edited);
    expect(match).not.toBeNull();
    // Must land on the SECOND occurrence in the edited doc, not the first or third.
    const expected = edited.indexOf(phrase, edited.indexOf(phrase) + 1);
    expect(match!.start).toBe(expected);
    expect(edited.slice(match!.start, match!.end)).toBe(phrase);
    // Confirm its surrounding context is the one we anchored.
    expect(edited.slice(match!.start - 30, match!.start)).toContain('Second occurrence');
  });

  test('U4: fuzzy re-anchor succeeds after a 1-2 character typo edit inside the anchored text', () => {
    const target = 'The quick brown fox jumps over the lazy dog';
    const start = DOC.indexOf(target);
    const anchor = createAnchor(DOC, start, start + target.length);
    // Typo inside the anchored range: "jumps" -> "jmups" (2-char transposition).
    const edited = DOC.replace('jumps over', 'jmups over');
    expect(edited.indexOf(target)).toBe(-1); // exact + quote search must fail
    const match = reanchor(anchor, edited);
    expect(match).not.toBeNull();
    expect(match!.strategy).toBe('fuzzy');
    const found = edited.slice(match!.start, match!.end);
    expect(found).toContain('quick brown fox');
    expect(found).toContain('lazy dog');
  });

  test('U5: orphaning triggers when the anchored text is fully deleted', () => {
    const target = 'The quick brown fox jumps over the lazy dog';
    const start = DOC.indexOf(target);
    const anchor = createAnchor(DOC, start, start + target.length);
    const edited = DOC.replace(`${target}\nwhile the narrator keeps writing filler sentences about margins and highlights.`, 'Nothing to see here.');
    const match = reanchor(anchor, edited);
    expect(match).toBeNull();
  });

  test('short anchors still fuzzy-match after a typo', () => {
    const target = 'sidecar files';
    const start = DOC.indexOf(target);
    const anchor = createAnchor(DOC, start, start + target.length);
    const edited = DOC.replace('sidecar files', 'sidecarr files');
    const match = reanchor(anchor, edited);
    expect(match).not.toBeNull();
    expect(edited.slice(match!.start, match!.end)).toContain('sidecar');
  });
});
