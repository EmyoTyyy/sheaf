import type { BibEntry, Diagnostic } from '@shared/types'

export interface BibParseResult {
  entries: BibEntry[]
  diagnostics: Diagnostic[]
}

const ENTRY_START = /@([A-Za-z]+)\s*[{(]/g

/** Fields worth showing in the citation completion list, in priority order. */
export const DISPLAY_FIELDS = ['author', 'title', 'year', 'journal', 'booktitle', 'publisher']

let counter = 0

function nextId(): string {
  counter += 1
  return `bib${counter}`
}

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

/**
 * A pragmatic BibTeX parser: it reads entry types, keys and fields, tolerates
 * the usual real-world sloppiness, and reports what it cannot make sense of.
 */
export function parseBib(source: string, file: string): BibParseResult {
  const entries: BibEntry[] = []
  const diagnostics: Diagnostic[] = []
  const seenKeys = new Map<string, number>()

  ENTRY_START.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = ENTRY_START.exec(source)) !== null) {
    const type = match[1].toLowerCase()
    const openChar = source[match.index + match[0].length - 1]
    const closeChar = openChar === '{' ? '}' : ')'
    const bodyStart = match.index + match[0].length
    const startLine = lineOf(source, match.index)

    if (type === 'comment' || type === 'preamble' || type === 'string') {
      const end = findClosing(source, bodyStart, openChar, closeChar)
      if (end !== -1) ENTRY_START.lastIndex = end + 1
      continue
    }

    const end = findClosing(source, bodyStart, openChar, closeChar)
    if (end === -1) {
      diagnostics.push({
        id: nextId(),
        severity: 'error',
        message: `Entry @${type} is never closed.`,
        file,
        line: startLine,
        column: null,
        hint: 'Add the missing closing brace at the end of the entry.'
      })
      break
    }

    const body = source.slice(bodyStart, end)
    ENTRY_START.lastIndex = end + 1

    const commaIndex = body.indexOf(',')
    const key = (commaIndex === -1 ? body : body.slice(0, commaIndex)).trim()

    if (!key) {
      diagnostics.push({
        id: nextId(),
        severity: 'error',
        message: `Entry @${type} has no citation key.`,
        file,
        line: startLine,
        column: null,
        hint: 'The key is the first item inside the braces, before the first comma.'
      })
      continue
    }
    if (/[\s,{}]/.test(key)) {
      diagnostics.push({
        id: nextId(),
        severity: 'error',
        message: `Citation key "${key}" contains characters that BibTeX will not accept.`,
        file,
        line: startLine,
        column: null,
        hint: 'Keys cannot contain spaces, commas or braces.'
      })
      continue
    }

    const previous = seenKeys.get(key)
    if (previous !== undefined) {
      diagnostics.push({
        id: nextId(),
        severity: 'warning',
        message: `Duplicate citation key "${key}" (first defined on line ${previous}).`,
        file,
        line: startLine,
        column: null,
        hint: 'BibTeX will keep only one of the two entries.'
      })
    } else {
      seenKeys.set(key, startLine)
    }

    const fields = commaIndex === -1 ? {} : parseFields(body.slice(commaIndex + 1))
    entries.push({ key, type, fields, file, line: startLine })

    if (Object.keys(fields).length === 0) {
      diagnostics.push({
        id: nextId(),
        severity: 'warning',
        message: `Entry "${key}" has no fields.`,
        file,
        line: startLine,
        column: null
      })
    }
  }

  return { entries, diagnostics }
}

function findClosing(source: string, from: number, open: string, close: string): number {
  let depth = 1
  let inQuotes = false
  for (let i = from; i < source.length; i += 1) {
    const char = source[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (char === '"' && open === '{') inQuotes = !inQuotes
    if (inQuotes) continue
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0

  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i += 1
    const nameStart = i
    while (i < body.length && /[A-Za-z0-9_:-]/.test(body[i])) i += 1
    const name = body.slice(nameStart, i).trim().toLowerCase()
    if (!name) break

    while (i < body.length && /\s/.test(body[i])) i += 1
    if (body[i] !== '=') {
      // Not a field assignment; skip to the next comma at depth zero.
      i = skipToComma(body, i)
      continue
    }
    i += 1
    while (i < body.length && /\s/.test(body[i])) i += 1

    let value = ''
    if (body[i] === '{') {
      const end = findClosing(body, i + 1, '{', '}')
      if (end === -1) break
      value = body.slice(i + 1, end)
      i = end + 1
    } else if (body[i] === '"') {
      let end = i + 1
      while (end < body.length && !(body[end] === '"' && body[end - 1] !== '\\')) end += 1
      value = body.slice(i + 1, end)
      i = end + 1
    } else {
      const end = skipToComma(body, i)
      value = body.slice(i, end)
      i = end
    }

    fields[name] = cleanValue(value)
    i = skipToComma(body, i)
    i += 1
  }

  return fields
}

function skipToComma(body: string, from: number): number {
  let depth = 0
  for (let i = from; i < body.length; i += 1) {
    const char = body[i]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === ',' && depth <= 0) return i
  }
  return body.length
}

/** Turns BibTeX markup into something readable in a completion popup. */
function cleanValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\["'`^~=.]/g, '')
    .replace(/\\&/g, '&')
    .trim()
}

/** "Lamport, Leslie and Knuth, Donald" -> "Lamport & Knuth" */
export function formatAuthors(raw: string | undefined): string {
  if (!raw) return ''
  const authors = raw
    .split(/\s+and\s+/i)
    .map((name) => {
      const trimmed = name.trim()
      if (trimmed.includes(',')) return trimmed.split(',')[0].trim()
      const parts = trimmed.split(/\s+/)
      return parts[parts.length - 1]
    })
    .filter(Boolean)

  if (authors.length === 0) return ''
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  return `${authors[0]} et al.`
}

export function describeEntry(entry: BibEntry): string {
  const authors = formatAuthors(entry.fields.author ?? entry.fields.editor)
  const year = entry.fields.year ?? entry.fields.date?.slice(0, 4) ?? ''
  const title = entry.fields.title ?? ''
  return [authors, year && `(${year})`, title].filter(Boolean).join(' ')
}
