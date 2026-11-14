import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyOps } from '../../ops'
import { MAX_NOTE, setRowLabel, setRowNote, setTitle } from '../checklist'
import { CanvasStore, HOST } from '../doc'
import { clipText, shiftCaret, textSplice } from '../text-diff'

const FFFD = '\uFFFD'
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff
const insidePair = (s: string, i: number) => i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) && isLow(s.charCodeAt(i))

/** What a peer reads after the text crossed the wire: a lone surrogate is UTF-8-encoded as U+FFFD. */
const wellFormed = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, FFFD)

/** Y.Text splits its string at a splice end; just after a high surrogate that destroys two characters. */
const safeEnd = (prev: string, at: number) => at === 0 || at === prev.length || !isHigh(prev.charCodeAt(at - 1))

/** What people do in a sticky or text shape: the textarea's value before and after. */
const ROWS: [string, string, string][] = [
  ['select 😀, type 😁 (same high surrogate)', 'a😀b', 'a😁b'],
  ['paste-replace 😀 with 😁', 'x😀y', 'x😁y'],
  ['replace 😀 with 🤖', 'a😀b', 'a🤖b'],
  ['replace 𠮷 with 𠮶 (astral CJK)', 'a𠮷b', 'a𠮶b'],
  ['backspace the second of 😁😀', '😁😀', '😁'],
  ['backspace the first of 😁😀', '😁😀', '😀'],
  ['forward-delete the first of 😀😀😁', '😀😀😁', '😀😁'],
  ['backspace a ZWJ family after text', 'a👨‍👩‍👧b', 'ab'],
  ['backspace the last member of a ZWJ family', '👨‍👩‍👧', '👨‍👩‍'],
  ['backspace one flag of 🇺🇸🇬🇧', '🇺🇸🇬🇧', '🇬🇧'],
  ['backspace the skin tone of 👍🏽', '👍🏽', '👍'],
  ['backspace the first of 👍🏽👍🏿', '👍🏽👍🏿', '👍🏿'],
  ['backspace the first of 𠮷𠮶', '𠮷𠮶', '𠮶'],
  ['type x between 😀😀', '😀😀', '😀x😀'],
  ['type 😁 between 😀😀', '😀😀', '😀😁😀'],
  ['type 😀 between 😁😁', '😁😁', '😁😀😁'],
  ['type x inside a ZWJ family', '👨‍👩‍👧', '👨x‍👩‍👧'],
  ['type 👦 at the end of a ZWJ family', '👨‍👩‍👧', '👨‍👩‍👧👦'],
  ['IME commits 日本 after 😀', '😀', '😀日本'],
  ['IME commits に before 😀', '😀', 'に😀'],
  ['emoji picker re-pick 😀 → 😁', '😀', '😁'],
]

/** A sticky made by one Canvas, edited by another, and the update the edit sends back. */
function editAtPeer(before: string, after: string) {
  const author = new CanvasStore(new Y.Doc())
  const id = author.create({ type: 'sticky', id: 's', text: before })
  const editor = new CanvasStore(new Y.Doc())
  Y.applyUpdate(editor.doc, Y.encodeStateAsUpdate(author.doc), HOST)
  const sv = Y.encodeStateVector(editor.doc)
  editor.setText(id, after)
  Y.applyUpdate(author.doc, Y.encodeStateAsUpdate(editor.doc, sv), HOST)
  const third = new CanvasStore(new Y.Doc())
  Y.applyUpdate(third.doc, Y.encodeStateAsUpdate(author.doc), HOST)
  return { editor: editor.get(id)!.text, author: author.get(id)!.text, third: third.get(id)!.text }
}

describe('text edits next to emoji and other surrogate pairs', () => {
  it.each(ROWS)('%s: the splice never ends inside a pair', (_, before, after) => {
    const d = textSplice(before, after)
    expect(before.slice(0, d.index) + d.insert + before.slice(d.index + d.remove)).toBe(after)
    expect(safeEnd(before, d.index) && safeEnd(before, d.index + d.remove)).toBe(true)
    expect(insidePair(after, d.index) || insidePair(after, d.index + d.insert.length)).toBe(false)
  })

  it.each(ROWS)('%s: the editor, the author and a third Canvas all read the new text', (_, before, after) => {
    const seen = editAtPeer(before, after)
    expect(seen).toEqual({ editor: after, author: after, third: after })
    expect(Object.values(seen).some(s => s.includes(FFFD))).toBe(false)
  })

  it('renames a checklist row and its title, and writes a comment, next to emoji', () => {
    const a = new CanvasStore(new Y.Doc())
    const id = a.create({ type: 'sticky', id: 'n', view: 'checklist', text: '### 🎉 Party 😀\n- [ ] 😀 cake\n  > bring 😁' })
    const b = new CanvasStore(new Y.Doc())
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), HOST)
    const sv = Y.encodeStateVector(b.doc)
    setTitle(b, id, '🎊 Party 😁')
    setRowLabel(b, id, 't0', '😁 cake')
    setRowNote(b, id, 't0', 'bring 😀', { name: 'Ann', id: 'u-ann' })
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, sv), HOST)
    const want = '### 🎊 Party 😁\n- [ ] 😁 cake\n  > bring 😀'
    expect(b.get(id)!.text).toBe(want)
    expect(a.get(id)!.text).toBe(want)
  })
})

describe('length caps on text kept in the canvas', () => {
  it('clipText never keeps half a pair', () => {
    expect(clipText('ab😀', 3)).toBe('ab')
    expect(clipText('ab😀', 4)).toBe('ab😀')
    expect(clipText('a😀b', 2)).toBe('a')
    expect(clipText('a😀b', 3)).toBe('a😀')
    expect(clipText('abc', 0)).toBe('')
  })

  it('a comment, a title and an agent-written title cut at an emoji reach a peer with no U+FFFD', () => {
    const a = new CanvasStore(new Y.Doc())
    const id = a.create({ type: 'sticky', id: 'n', view: 'checklist', text: '### T\n- [ ] row' })
    const b = new CanvasStore(new Y.Doc())
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), HOST)
    const sv = Y.encodeStateVector(b.doc)
    setRowNote(b, id, 't0', `${'c'.repeat(MAX_NOTE - 1)}😀 and more`, { name: 'Ann', id: 'u-ann' })
    setTitle(b, id, `${'t'.repeat(499)}😀`)
    const r = applyOps({ store: b, viewportCenter: () => ({ x: 0, y: 0 }) }, { ops: [{ op: 'add', shape: { type: 'frame', id: 'f', title: `${'f'.repeat(499)}😀` } }] })
    expect(r.errors).toEqual([])
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, sv), HOST)
    for (const s of [a, b]) {
      const note = s.get(id)!
      expect(note.text).toBe(`### ${'t'.repeat(499)}\n- [ ] row\n  > ${'c'.repeat(MAX_NOTE - 1)}`)
      expect(s.get('f')!.title).toBe('f'.repeat(499))
    }
  })
})

describe('shiftCaret next to surrogate pairs', () => {
  it('keeps a caret after a peer replaced the emoji before it', () => {
    expect(shiftCaret('😀😀x', '😁😀x', 4)).toBe(4)
    expect(shiftCaret('a😀b', 'a😁b', 3)).toBe(3)
  })

  it('puts a caret that was in a replaced span after the new character, never inside it', () => {
    expect(shiftCaret('a😀b', 'a😁b', 2)).toBe(3)
    expect(shiftCaret('😀😀', '😀😁😀', 2)).toBe(2)
  })

  it('never answers a position inside a pair', () => {
    for (const [, before, after] of ROWS)
      for (let c = 0; c <= before.length; c++) {
        if (insidePair(before, c)) continue
        const at = shiftCaret(before, after, c)
        expect(at >= 0 && at <= after.length && !insidePair(after, at)).toBe(true)
      }
  })
})

// ---- properties over random text -----------------------------------------------------------------

/** A small seeded generator, so a failure names the case that broke. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x1_0000_0000
  }
}

const PIECES = {
  ascii: ['a', 'b', 'x', ' ', '\n', '-', '#'],
  bmp: ['é', '日', '本', 'に', '中', '\u00a0'],
  astral: ['😀', '😁', '🤖', '𠮷', '𠮶', '🎉', '👍'],
  zwj: ['👨‍👩‍👧', '👩‍💻', '\u200d'],
  flag: ['🇺🇸', '🇬🇧', '🇺', '🇸'],
  skin: ['👍🏽', '👍🏿', '🏽'],
  combining: ['e\u0301', '\u0301', 'n\u0303'],
}
const LONE = ['\uD83D', '\uDE00', '\uD842']
const WELL: string[] = Object.values(PIECES).flat()

function text(rand: () => number, pieces: readonly string[], max = 8): string {
  let out = ''
  const n = Math.floor(rand() * max)
  for (let i = 0; i < n; i++) out += pieces[Math.floor(rand() * pieces.length)]!
  return out
}

/** Code-point boundaries of `s`: where a person's caret can be. */
function stops(s: string): number[] {
  const out = [0]
  let at = 0
  for (const ch of s) out.push((at += ch.length))
  return out
}

/** An edit a person could make: replace a span between two caret positions with new text. */
function edit(rand: () => number, s: string, pieces: readonly string[]): string {
  const at = stops(s)
  const i = at[Math.floor(rand() * at.length)]!
  const j = at[Math.floor(rand() * at.length)]!
  const [a, b] = i <= j ? [i, j] : [j, i]
  return s.slice(0, a) + text(rand, pieces, 3) + s.slice(b)
}

describe('textSplice properties', () => {
  it('any two texts, lone surrogates included: the splice gives next, ends outside pairs, and Y.Text agrees', () => {
    const rand = rng(0x5eed)
    const pieces = [...WELL, ...LONE]
    for (let n = 0; n < 4000; n++) {
      const before = text(rand, pieces, 10)
      const after = rand() < 0.5 ? edit(rand, before, pieces) : text(rand, pieces, 10)
      const d = textSplice(before, after)
      const where = JSON.stringify({ n, before, after, d })
      expect(before.slice(0, d.index) + d.insert + before.slice(d.index + d.remove), where).toBe(after)
      expect(safeEnd(before, d.index) && safeEnd(before, d.index + d.remove), where).toBe(true)

      // The text as one Y.Text item, so every splice end inside it splits the item.
      const doc = new Y.Doc()
      const t = doc.getText('t')
      t.insert(0, before)
      const sv = Y.encodeStateVector(doc)
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
      doc.transact(() => {
        if (d.remove) t.delete(d.index, d.remove)
        if (d.insert) t.insert(d.index, d.insert)
      })
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc, sv))
      expect(t.toString(), where).toBe(after)
      expect(peer.getText('t').toString(), where).toBe(wellFormed(after))
    }
  })

  it('well-formed edits at a second Canvas create no U+FFFD anywhere', () => {
    const rand = rng(0xc0ffee)
    for (let n = 0; n < 3000; n++) {
      const before = text(rand, WELL, 10)
      const after = edit(rand, before, WELL)
      const seen = editAtPeer(before, after)
      expect(seen, JSON.stringify({ n, before, after })).toEqual({ editor: after, author: after, third: after })
    }
  })

  it('two Canvases editing next to the same emoji at once converge with no U+FFFD', () => {
    const rand = rng(0xface)
    const near = ['😀', '😁', '🇺🇸', '👍🏽', '𠮷', 'x', '👨‍👩‍👧']
    for (let n = 0; n < 2000; n++) {
      const start = text(rand, near, 6)
      const a = new CanvasStore(new Y.Doc())
      const id = a.create({ type: 'sticky', id: 's', text: start })
      const b = new CanvasStore(new Y.Doc())
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), HOST)
      const nextA = edit(rand, start, near)
      const nextB = edit(rand, start, near)
      a.setText(id, nextA)
      b.setText(id, nextB)
      expect(a.get(id)!.text).toBe(nextA)
      expect(b.get(id)!.text).toBe(nextB)
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), HOST)
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), HOST)
      const where = JSON.stringify({ n, start, nextA, nextB })
      const merged = a.get(id)!.text
      expect(b.get(id)!.text, where).toBe(merged)
      expect(merged.includes(FFFD), where).toBe(false)
      expect(merged, where).toBe(wellFormed(merged))
    }
  })

  it('the hand-picked concurrent cases', () => {
    const cases: [string, string, string][] = [
      ['a😀b', 'ax😀b', 'a😀yb'],
      ['a😀b', 'a😁b', 'a😀yb'],
      ['😀😀', '😀x😀', '😁😀'],
      ['😁😀', '😀', '😁😀z'],
      ['🇺🇸🇬🇧', '🇬🇧', '🇺🇸🇬🇧🇫🇷'],
    ]
    for (const [start, nextA, nextB] of cases) {
      const a = new CanvasStore(new Y.Doc())
      const id = a.create({ type: 'sticky', id: 's', text: start })
      const b = new CanvasStore(new Y.Doc())
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), HOST)
      a.setText(id, nextA)
      b.setText(id, nextB)
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), HOST)
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), HOST)
      expect(a.get(id)!.text).toBe(b.get(id)!.text)
      expect(a.get(id)!.text.includes(FFFD)).toBe(false)
    }
  })
})
