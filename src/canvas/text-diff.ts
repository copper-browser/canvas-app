const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * The smallest single splice turning `prev` into `next`: strip the common
 * prefix and suffix, replace what is left. Applied to a Y.Text as
 * delete(index, remove) + insert(index, insert), so concurrent edits elsewhere
 * in the text merge instead of being clobbered by a whole-string replace.
 *
 * Neither end of the splice falls just after a high surrogate (the first half
 * of an emoji or any other character outside the BMP): Y.Text splits its
 * string there and turns both halves into U+FFFD, here and at every peer. So
 * the prefix gives back a high surrogate it ends on, and the suffix gives back
 * a low surrogate it starts on or one that a high surrogate precedes — as
 * lib0's simpleDiffString does, and also for a lone surrogate already in the
 * text. Whole characters move into the splice; the result is still `next`.
 */
export function textSplice(prev: string, next: string): { index: number; remove: number; insert: string } {
  let start = 0
  const max = Math.min(prev.length, next.length)
  while (start < max && prev[start] === next[start]) start++
  while (start > 0 && isHigh(prev.charCodeAt(start - 1))) start--
  let end = 0
  while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++
  while (end > 0 && (isLow(prev.charCodeAt(prev.length - end)) || isHigh(prev.charCodeAt(prev.length - end - 1)))) end--
  return {
    index: start,
    remove: prev.length - start - end,
    insert: next.slice(start, next.length - end),
  }
}

/** Whether `index` falls between the two halves of a surrogate pair in `text`. */
export const insidePair = (text: string, index: number) =>
  index > 0 && index < text.length && isHigh(text.charCodeAt(index - 1)) && isLow(text.charCodeAt(index))

/** Where a caret at `caret` in `prev` lands once `prev` becomes `next`; never inside a pair. */
export function shiftCaret(prev: string, next: string, caret: number): number {
  const { index, remove, insert } = textSplice(prev, next)
  const at = caret <= index ? caret : caret >= index + remove ? caret - remove + insert.length : index + insert.length
  return insidePair(next, at) ? at - 1 : at
}

