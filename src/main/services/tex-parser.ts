import type { CommandDef, FileIndex, LabelDef, Occurrence } from '@shared/types'

const REF_COMMANDS = [
  'ref',
  'eqref',
  'pageref',
  'autoref',
  'nameref',
  'cref',
  'Cref',
  'crefrange',
  'vref',
  'labelcref'
]

const CITE_COMMANDS = [
  'cite',
  'citep',
  'citet',
  'citeal',
  'citealp',
  'citealt',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'nocite',
  'parencite',
  'textcite',
  'autocite',
  'footcite',
  'fullcite',
  'supercite',
  'Textcite',
  'Parencite',
  'Autocite'
]

const INPUT_COMMANDS = ['input', 'include', 'subfile', 'subfileinclude', 'includeonly']

const SECTION_RE =
  /\\(chapter|section|subsection|subsubsection|paragraph|caption)\*?\s*(?:\[[^\]]*\])?\s*\{/g

/** Blanks out comments so they never contribute labels, refs or citations. */
function stripComments(source: string): string {
  let result = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (char === '\\' && i + 1 < source.length) {
      result += char + source[i + 1]
      i += 1
      continue
    }
    if (char === '%') {
      // Keep the newline so line numbers stay correct.
      while (i < source.length && source[i] !== '\n') i += 1
      result += '\n'
      continue
    }
    result += char
  }
  return result
}

/** Reads a balanced {...} group starting at the opening brace. */
function readGroup(source: string, openIndex: number): { content: string; end: number } | null {
  if (source[openIndex] !== '{') return null
  let depth = 1
  for (let i = openIndex + 1; i < source.length; i += 1) {
    const char = source[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { content: source.slice(openIndex + 1, i), end: i }
    }
  }
  return null
}

function buildLineTable(source: string): number[] {
  const offsets = [0]
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1)
  }
  return offsets
}

function positionAt(lineOffsets: number[], index: number): { line: number; column: number } {
  let low = 0
  let high = lineOffsets.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (lineOffsets[mid] <= index) low = mid
    else high = mid - 1
  }
  return { line: low + 1, column: index - lineOffsets[low] + 1 }
}

export interface ParseTexOptions {
  /** Project-relative path of the file being parsed. */
  path: string
  mtimeMs: number
}

export function parseTex(rawSource: string, options: ParseTexOptions): FileIndex {
  const source = stripComments(rawSource)
  const lineOffsets = buildLineTable(source)
  const at = (index: number): { line: number; column: number } => positionAt(lineOffsets, index)

  const labels: LabelDef[] = []
  const refs: Occurrence[] = []
  const citations: Occurrence[] = []
  const commands: CommandDef[] = []
  const environments: CommandDef[] = []
  const inputs: { target: string; line: number }[] = []
  const bibResources: string[] = []
  const graphicsPaths: string[] = []
  const packages: string[] = []
  let documentClass: string | null = null

  // Section and caption titles, used as the context shown next to a label.
  const headings: { index: number; text: string }[] = []
  SECTION_RE.lastIndex = 0
  let heading: RegExpExecArray | null
  while ((heading = SECTION_RE.exec(source)) !== null) {
    const group = readGroup(source, SECTION_RE.lastIndex - 1)
    if (!group) continue
    headings.push({ index: heading.index, text: group.content.replace(/\s+/g, ' ').trim() })
  }

  const contextFor = (index: number): string => {
    let best = ''
    for (const entry of headings) {
      if (entry.index > index) break
      best = entry.text
    }
    return best
  }

  const commandRe = /\\([A-Za-z@]+)\*?/g
  let match: RegExpExecArray | null

  while ((match = commandRe.exec(source)) !== null) {
    const name = match[1]
    let cursor = commandRe.lastIndex

    // Skip optional [...] arguments before the first mandatory group.
    const optionals: string[] = []
    while (source[cursor] === '[' || /\s/.test(source[cursor] ?? '')) {
      if (source[cursor] === '[') {
        const close = source.indexOf(']', cursor)
        if (close === -1) break
        optionals.push(source.slice(cursor + 1, close))
        cursor = close + 1
      } else {
        if (source[cursor] === '\n' && source[cursor + 1] === '\n') break
        cursor += 1
      }
    }

    const group = source[cursor] === '{' ? readGroup(source, cursor) : null

    if (name === 'label' && group) {
      const position = at(cursor + 1)
      labels.push({
        name: group.content.trim(),
        file: options.path,
        line: position.line,
        context: contextFor(match.index)
      })
    } else if (REF_COMMANDS.includes(name) && group) {
      for (const key of splitKeys(group.content)) {
        const position = at(cursor + 1)
        refs.push({ key, file: options.path, line: position.line, column: position.column })
      }
    } else if (CITE_COMMANDS.includes(name) && group) {
      for (const key of splitKeys(group.content)) {
        const position = at(cursor + 1)
        citations.push({ key, file: options.path, line: position.line, column: position.column })
      }
    } else if (INPUT_COMMANDS.includes(name) && group) {
      for (const target of splitKeys(group.content)) {
        inputs.push({ target, line: at(match.index).line })
      }
    } else if ((name === 'bibliography' || name === 'addbibresource') && group) {
      for (const target of splitKeys(group.content)) {
        bibResources.push(target)
      }
    } else if (name === 'graphicspath' && group) {
      const inner = group.content.match(/\{([^{}]*)\}/g) ?? []
      for (const entry of inner) {
        graphicsPaths.push(entry.slice(1, -1))
      }
    } else if (name === 'documentclass' && group) {
      documentClass = group.content.trim()
    } else if (name === 'usepackage' && group) {
      packages.push(...splitKeys(group.content))
    } else if ((name === 'newcommand' || name === 'renewcommand' || name === 'providecommand') && group) {
      const commandName = group.content.trim().replace(/^\\/, '')
      if (/^[A-Za-z@]+$/.test(commandName)) {
        let args = 0
        let after = group.end + 1
        while (/\s/.test(source[after] ?? '')) after += 1
        if (source[after] === '[') {
          const close = source.indexOf(']', after)
          if (close !== -1) args = Number.parseInt(source.slice(after + 1, close), 10) || 0
        }
        commands.push({
          name: commandName,
          file: options.path,
          line: at(match.index).line,
          args
        })
      }
    } else if (name === 'DeclareMathOperator' && group) {
      const commandName = group.content.trim().replace(/^\\/, '')
      if (/^[A-Za-z@]+$/.test(commandName)) {
        commands.push({ name: commandName, file: options.path, line: at(match.index).line, args: 0 })
      }
    } else if ((name === 'newenvironment' || name === 'renewenvironment') && group) {
      const envName = group.content.trim()
      if (/^[A-Za-z@*]+$/.test(envName)) {
        let args = 0
        let after = group.end + 1
        while (/\s/.test(source[after] ?? '')) after += 1
        if (source[after] === '[') {
          const close = source.indexOf(']', after)
          if (close !== -1) args = Number.parseInt(source.slice(after + 1, close), 10) || 0
        }
        environments.push({ name: envName, file: options.path, line: at(match.index).line, args })
      }
    } else if (name === 'def') {
      const defMatch = /^\\([A-Za-z@]+)/.exec(source.slice(commandRe.lastIndex))
      if (defMatch) {
        commands.push({
          name: defMatch[1],
          file: options.path,
          line: at(match.index).line,
          args: 0
        })
      }
    }
  }

  return {
    path: options.path,
    mtimeMs: options.mtimeMs,
    labels,
    refs,
    citations,
    commands,
    environments,
    inputs,
    bibResources,
    graphicsPaths,
    hasDocumentClass: documentClass !== null,
    documentClass,
    packages
  }
}

function splitKeys(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.includes('\\'))
}

/** Environments used in a file, for \end completion and folding hints. */
export function findEnvironments(source: string): string[] {
  const names = new Set<string>()
  const re = /\\begin\s*\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    names.add(match[1].trim())
  }
  return [...names]
}
