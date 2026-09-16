import { Tag, tags as t } from '@lezer/highlight'

export const obiTags = {
  wikiLink: Tag.define(),
  wikiMark: Tag.define(),
  hashtag: Tag.define(),
  highlight: Tag.define(),
  highlightMark: Tag.define(),
  frontmatter: Tag.define(),
  mathInline: Tag.define(),
}

const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1‐-‧]/

// [[target|alias]] and ![[embed]]
export const WikiLinkExt = {
  defineNodes: [
    { name: 'WikiLink', style: obiTags.wikiLink },
    { name: 'WikiEmbed', style: obiTags.wikiLink },
    { name: 'WikiMark', style: obiTags.wikiMark },
    { name: 'WikiTarget' },
    { name: 'WikiPipe', style: obiTags.wikiMark },
    { name: 'WikiAlias' },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      parse(cx, next, pos) {
        let open = pos
        let embed = false
        if (next === 33 && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91) {
          embed = true
          open = pos + 1
        } else if (!(next === 91 && cx.char(pos + 1) === 91)) return -1
        for (let i = open + 2; i < cx.end - 1; i++) {
          const c = cx.char(i)
          if (c === 10) return -1
          if (c === 91 && cx.char(i + 1) === 91) return -1
          if (c === 93 && cx.char(i + 1) === 93) {
            if (i === open + 2) return -1
            const children = [cx.elt('WikiMark', pos, open + 2)]
            const inner = cx.slice(open + 2, i)
            const pipe = inner.indexOf('|')
            if (pipe >= 0) {
              children.push(cx.elt('WikiTarget', open + 2, open + 2 + pipe))
              children.push(cx.elt('WikiPipe', open + 2 + pipe, open + 3 + pipe))
              children.push(cx.elt('WikiAlias', open + 3 + pipe, i))
            } else {
              children.push(cx.elt('WikiTarget', open + 2, i))
            }
            children.push(cx.elt('WikiMark', i, i + 2))
            return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'WikiLink', pos, i + 2, children))
          }
        }
        return -1
      },
      before: 'Link',
    },
  ],
}

// #tags
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u
const TAG_LETTER = /[\p{L}_\-/]/u
export const HashtagExt = {
  defineNodes: [{ name: 'Hashtag', style: obiTags.hashtag }],
  parseInline: [
    {
      name: 'Hashtag',
      parse(cx, next, pos) {
        if (next !== 35) return -1
        if (pos > cx.offset) {
          const prev = cx.slice(pos - 1, pos)
          if (!/[\s(,;]/.test(prev)) return -1
        }
        let end = pos + 1
        let hasLetter = false
        while (end < cx.end) {
          const ch = cx.slice(end, end + 1)
          // handle surrogate pairs
          const code = cx.char(end)
          let s = ch
          if (code >= 0xd800 && code <= 0xdbff) s = cx.slice(end, end + 2)
          if (!TAG_CHAR.test(s)) break
          if (TAG_LETTER.test(s)) hasLetter = true
          end += s.length
        }
        if (end === pos + 1 || !hasLetter) return -1
        return cx.addElement(cx.elt('Hashtag', pos, end))
      },
      before: 'Emphasis',
    },
  ],
}

// ==highlight==
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }
export const HighlightExt = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': obiTags.highlight } },
    { name: 'HighlightMark', style: obiTags.highlightMark },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        const pBefore = Punctuation.test(before)
        const pAfter = Punctuation.test(after)
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter))
      },
      after: 'Emphasis',
    },
  ],
}

// YAML frontmatter at the very start of the document
export const FrontmatterExt = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: obiTags.frontmatter },
    { name: 'FrontmatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      parse(cx, line) {
        if (cx.lineStart !== 0 || cx.depth > 1 || !/^---\s*$/.test(line.text)) return false
        const from = cx.lineStart
        const children = [cx.elt('FrontmatterMark', from, from + line.text.length)]
        let end = from + line.text.length
        let closed = false
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            children.push(cx.elt('FrontmatterMark', cx.lineStart, end))
            closed = true
            cx.nextLine()
            break
          }
        }
        void closed
        cx.addElement(cx.elt('Frontmatter', from, end, children))
        return true
      },
      before: 'HorizontalRule',
    },
  ],
}

export const obiMarkdownExtensions = [WikiLinkExt, HashtagExt, HighlightExt, FrontmatterExt]
