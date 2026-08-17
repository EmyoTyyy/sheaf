import fs from 'node:fs/promises'
import type { SearchFileResult, SearchMatch, SearchQuery, SearchResults } from '@shared/types'
import { walkTextFiles } from './fs-service'
import { fail } from './errors'

const MAX_MATCHES = 5000
const MAX_MATCHES_PER_FILE = 200
const PREVIEW_LIMIT = 240

/** Translates a comma-separated glob list into one regular expression. */
function globsToRegExp(globs: string): RegExp | null {
  const patterns = globs
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (patterns.length === 0) return null

  const parts = patterns.map((pattern) => {
    const normalised = pattern.replace(/\\/g, '/')
    let out = ''
    for (let i = 0; i < normalised.length; i += 1) {
      const char = normalised[i]
      if (char === '*') {
        if (normalised[i + 1] === '*') {
          out += '.*'
          i += 1
          if (normalised[i + 1] === '/') i += 1
        } else {
          out += '[^/]*'
        }
      } else if (char === '?') {
        out += '[^/]'
      } else if ('.+^${}()|[]\\'.includes(char)) {
        out += '\\' + char
      } else {
        out += char
      }
    }
    // A bare pattern such as "*.tex" should match at any depth.
    return normalised.includes('/') ? `^${out}$` : `(^|/)${out}$`
  })

  return new RegExp(parts.join('|'))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildMatcher(query: SearchQuery): RegExp {
  let source = query.regex ? query.query : escapeRegExp(query.query)
  if (query.wholeWord) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, query.caseSensitive ? 'g' : 'gi')
  } catch (error) {
    fail(
      'INVALID_NAME',
      'Invalid regular expression',
      (error as Error).message,
      'Check the pattern, or turn regular expressions off.'
    )
  }
}

let currentToken = 0

export function cancelSearch(): void {
  currentToken += 1
}

export async function searchProject(
  root: string,
  query: SearchQuery
): Promise<SearchResults> {
  const startedAt = Date.now()
  if (!query.query) {
    return { files: [], totalMatches: 0, filesSearched: 0, truncated: false, durationMs: 0 }
  }

  currentToken += 1
  const token = currentToken

  const matcher = buildMatcher(query)
  const include = globsToRegExp(query.include)
  const exclude = globsToRegExp(query.exclude)

  const files: SearchFileResult[] = []
  let totalMatches = 0
  let filesSearched = 0
  let truncated = false

  for await (const file of walkTextFiles(root)) {
    if (token !== currentToken) {
      truncated = true
      break
    }
    if (include && !include.test(file.relative)) continue
    if (exclude && exclude.test(file.relative)) continue

    const content = await fs.readFile(file.absolute, 'utf8').catch(() => null)
    if (content === null) continue
    filesSearched += 1

    const matches = findMatches(content, matcher)
    if (matches.length === 0) continue

    files.push({ file: file.relative, matches })
    totalMatches += matches.length

    if (totalMatches >= MAX_MATCHES) {
      truncated = true
      break
    }
  }

  files.sort((a, b) => a.file.localeCompare(b.file))

  return {
    files,
    totalMatches,
    filesSearched,
    truncated,
    durationMs: Date.now() - startedAt
  }
}

function findMatches(content: string, matcher: RegExp): SearchMatch[] {
  const matches: SearchMatch[] = []
  const lines = content.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.length > 20_000) continue
    matcher.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = matcher.exec(line)) !== null) {
      const column = match.index + 1
      const { preview, offset } = makePreview(line, match.index)
      matches.push({
        line: index + 1,
        column,
        length: match[0].length || 1,
        preview,
        previewOffset: offset
      })
      if (match[0].length === 0) matcher.lastIndex += 1
      if (matches.length >= MAX_MATCHES_PER_FILE) return matches
    }
  }

  return matches
}

/** Trims long lines around the hit so the results list stays readable. */
function makePreview(line: string, matchIndex: number): { preview: string; offset: number } {
  if (line.length <= PREVIEW_LIMIT) {
    const leading = line.length - line.trimStart().length
    return { preview: line.trim(), offset: leading }
  }
  const start = Math.max(0, matchIndex - 60)
  const end = Math.min(line.length, start + PREVIEW_LIMIT)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < line.length ? '...' : ''
  return {
    preview: `${prefix}${line.slice(start, end)}${suffix}`,
    offset: start - prefix.length
  }
}
