import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { BibEntry } from '@shared/types'
import { useProjectStore } from '../state/project-store'
import { flattenFiles } from '../lib/tree'
import { dirname, kindOf } from '../lib/paths'
import {
  CITE_COMMANDS,
  DOCUMENT_CLASSES,
  FILE_COMMANDS,
  LATEX_COMMANDS,
  LATEX_ENVIRONMENTS,
  LATEX_PACKAGES,
  REF_COMMANDS
} from './data'

const Kind = monaco.languages.CompletionItemKind
const SNIPPET = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet

/** Matches "\command[opt]{partial" immediately before the cursor. */
const ARGUMENT_RE = /\\([a-zA-Z@]+)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)$/
/** Matches a partially typed command. */
const COMMAND_RE = /\\([a-zA-Z@]*)$/

interface Context {
  model: monaco.editor.ITextModel
  position: monaco.Position
  linePrefix: string
  lineSuffix: string
}

function replaceRange(
  context: Context,
  partialLength: number,
  consumeClosingBrace: boolean
): monaco.IRange {
  const { position, lineSuffix } = context
  const endColumn =
    consumeClosingBrace && lineSuffix.startsWith('}')
      ? position.column + 1
      : position.column
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: position.column - partialLength,
    endColumn
  }
}

function describeEntry(entry: BibEntry): string {
  const authors = formatAuthors(entry.fields.author ?? entry.fields.editor)
  const year = entry.fields.year ?? entry.fields.date?.slice(0, 4) ?? ''
  return [authors, year && `(${year})`].filter(Boolean).join(' ')
}

function formatAuthors(raw: string | undefined): string {
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

/* ------------------------------------------------------------------ */
/* Suggestion builders                                                 */
/* ------------------------------------------------------------------ */

function environmentSuggestions(
  context: Context,
  partial: string,
  command: string
): monaco.languages.CompletionItem[] {
  const range = replaceRange(context, partial.length, true)
  const index = useProjectStore.getState().index
  const custom = new Map<string, string>()
  for (const environment of index?.environments ?? []) {
    custom.set(environment.name, `Defined in ${environment.file}`)
  }

  const items: monaco.languages.CompletionItem[] = []

  if (command === 'end') {
    // Suggest the environments that are currently open above the cursor.
    const open = openEnvironmentsAt(context.model, context.position)
    open.forEach((name, order) => {
      items.push({
        label: name,
        kind: Kind.Snippet,
        detail: 'Close this environment',
        insertText: `${name}}`,
        range,
        sortText: `0${order}`
      })
    })
  }

  const seen = new Set(items.map((item) => item.label as string))

  for (const [name, detail] of custom) {
    if (seen.has(name)) continue
    seen.add(name)
    items.push({
      label: name,
      kind: Kind.Class,
      detail,
      insertText:
        command === 'begin' ? `${name}}\n\t$0\n\\end{${name}}` : `${name}}`,
      insertTextRules: SNIPPET,
      range,
      sortText: `1${name}`
    })
  }

  for (const environment of LATEX_ENVIRONMENTS) {
    if (seen.has(environment.name)) continue
    const body = environment.body ?? '\t$0'
    items.push({
      label: environment.name,
      kind: Kind.Class,
      detail: environment.detail,
      insertText:
        command === 'begin'
          ? `${environment.name}}\n${body}\n\\end{${environment.name}}`
          : `${environment.name}}`,
      insertTextRules: SNIPPET,
      range,
      sortText: `2${environment.name}`
    })
  }

  return items
}

/** Names of \begin blocks that are still open at a position. */
function openEnvironmentsAt(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): string[] {
  const stack: string[] = []
  const beginRe = /\\begin\s*\{([^}]*)\}/g
  const endRe = /\\end\s*\{([^}]*)\}/g

  for (let line = 1; line <= position.lineNumber; line += 1) {
    const text =
      line === position.lineNumber
        ? model.getLineContent(line).slice(0, position.column - 1)
        : model.getLineContent(line)
    const commentIndex = text.search(/(^|[^\\])%/)
    const usable = commentIndex === -1 ? text : text.slice(0, commentIndex + 1)

    const events: { index: number; type: 'begin' | 'end'; name: string }[] = []
    beginRe.lastIndex = 0
    endRe.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = beginRe.exec(usable)) !== null) {
      events.push({ index: match.index, type: 'begin', name: match[1] })
    }
    while ((match = endRe.exec(usable)) !== null) {
      events.push({ index: match.index, type: 'end', name: match[1] })
    }
    events.sort((a, b) => a.index - b.index)

    for (const event of events) {
      if (event.type === 'begin') stack.push(event.name)
      else {
        const at = stack.lastIndexOf(event.name)
        if (at !== -1) stack.splice(at, 1)
        else stack.pop()
      }
    }
  }

  return stack.reverse()
}

function labelSuggestions(context: Context, partial: string): monaco.languages.CompletionItem[] {
  const index = useProjectStore.getState().index
  if (!index) return []
  const range = replaceRange(context, partial.length, false)
  return index.labels.map((label) => ({
    label: label.name,
    kind: Kind.Reference,
    detail: label.context || label.file,
    documentation: { value: `\`${label.file}\` line ${label.line}` },
    insertText: label.name,
    range
  }))
}

function citationSuggestions(context: Context, partial: string): monaco.languages.CompletionItem[] {
  const index = useProjectStore.getState().index
  if (!index) return []
  // Only the key after the last comma is being completed.
  const lastComma = partial.lastIndexOf(',')
  const active = lastComma === -1 ? partial : partial.slice(lastComma + 1)
  const range = replaceRange(context, active.length, false)

  return index.bibEntries.map((entry) => {
    const title = entry.fields.title ?? ''
    return {
      label: entry.key,
      kind: Kind.Value,
      detail: describeEntry(entry),
      documentation: {
        value: [
          title ? `**${title}**` : '',
          entry.fields.author ? `${entry.fields.author}` : '',
          entry.fields.journal ?? entry.fields.booktitle ?? entry.fields.publisher ?? '',
          `\n\n\`@${entry.type}\` in \`${entry.file}\``
        ]
          .filter(Boolean)
          .join('\n\n')
      },
      insertText: entry.key,
      filterText: `${entry.key} ${title} ${entry.fields.author ?? ''}`,
      range
    }
  })
}

function packageSuggestions(context: Context, partial: string): monaco.languages.CompletionItem[] {
  const lastComma = partial.lastIndexOf(',')
  const active = lastComma === -1 ? partial : partial.slice(lastComma + 1)
  const range = replaceRange(context, active.length, false)
  return LATEX_PACKAGES.map((pkg) => ({
    label: pkg.name,
    kind: Kind.Module,
    detail: pkg.detail,
    insertText: pkg.name,
    range
  }))
}

function classSuggestions(context: Context, partial: string): monaco.languages.CompletionItem[] {
  const range = replaceRange(context, partial.length, false)
  return DOCUMENT_CLASSES.map((entry) => ({
    label: entry.name,
    kind: Kind.Module,
    detail: entry.detail,
    insertText: entry.name,
    range
  }))
}

function fileSuggestions(
  context: Context,
  partial: string,
  command: string
): monaco.languages.CompletionItem[] {
  const { tree } = useProjectStore.getState()
  const files = flattenFiles(tree)
  const range = replaceRange(context, partial.length, false)

  const wanted = (path: string): boolean => {
    const kind = kindOf(path)
    if (command === 'includegraphics') return kind === 'image' || kind === 'pdf'
    if (command === 'bibliography' || command === 'addbibresource') return kind === 'bib'
    if (command === 'includepdf') return kind === 'pdf'
    if (command === 'input' || command === 'include' || command === 'subfile') return kind === 'tex'
    return true
  }

  return files.filter((file) => wanted(file.path)).map((file) => {
    // \input and \includegraphics conventionally omit the extension.
    const dropExtension =
      command === 'input' ||
      command === 'include' ||
      command === 'subfile' ||
      command === 'bibliography'
    const value = dropExtension ? file.path.replace(/\.(tex|bib)$/i, '') : file.path
    return {
      label: value,
      kind: Kind.File,
      detail: dirname(file.path) || 'project root',
      insertText: value,
      range,
      sortText: `${file.path.split('/').length}${value}`
    }
  })
}

function commandSuggestions(
  context: Context,
  partial: string
): monaco.languages.CompletionItem[] {
  const index = useProjectStore.getState().index
  const range: monaco.IRange = {
    startLineNumber: context.position.lineNumber,
    endLineNumber: context.position.lineNumber,
    // Include the backslash in the replacement range.
    startColumn: context.position.column - partial.length - 1,
    endColumn: context.position.column
  }

  const items: monaco.languages.CompletionItem[] = []
  const seen = new Set<string>()

  for (const command of index?.commands ?? []) {
    if (seen.has(command.name)) continue
    seen.add(command.name)
    const args = Array.from({ length: command.args }, (_, i) => `{$${i + 1}}`).join('')
    items.push({
      label: `\\${command.name}`,
      kind: Kind.Function,
      detail: `Defined in ${command.file}`,
      insertText: `\\${command.name}${args}`,
      insertTextRules: SNIPPET,
      range,
      sortText: `0${command.name}`
    })
  }

  for (const command of LATEX_COMMANDS) {
    if (seen.has(command.name)) continue
    seen.add(command.name)
    items.push({
      label: `\\${command.name}`,
      kind: Kind.Keyword,
      detail: command.detail,
      documentation: command.documentation,
      insertText: `\\${command.snippet ?? command.name}`,
      insertTextRules: command.snippet ? SNIPPET : undefined,
      range,
      sortText: `1${command.name}`
    })
  }

  return items
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

let registered = false

export function registerCompletionProviders(): void {
  if (registered) return
  registered = true

  monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\', '{', ',', '/'],
    provideCompletionItems: (model, position) => {
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })
      const lineSuffix = model.getLineContent(position.lineNumber).slice(position.column - 1)

      // Never complete inside a comment.
      const commentIndex = linePrefix.search(/(^|[^\\])%/)
      if (commentIndex !== -1) return { suggestions: [] }

      const context: Context = { model, position, linePrefix, lineSuffix }

      const argument = linePrefix.match(ARGUMENT_RE)
      if (argument) {
        const command = argument[1]
        const partial = argument[2]

        if (command === 'begin' || command === 'end') {
          return { suggestions: environmentSuggestions(context, partial, command) }
        }
        if (REF_COMMANDS.has(command)) {
          return { suggestions: labelSuggestions(context, partial) }
        }
        if (CITE_COMMANDS.has(command)) {
          return { suggestions: citationSuggestions(context, partial) }
        }
        if (command === 'usepackage' || command === 'RequirePackage') {
          return { suggestions: packageSuggestions(context, partial) }
        }
        if (command === 'documentclass' || command === 'LoadClass') {
          return { suggestions: classSuggestions(context, partial) }
        }
        if (FILE_COMMANDS.has(command)) {
          return { suggestions: fileSuggestions(context, partial, command) }
        }
        return { suggestions: [] }
      }

      const command = linePrefix.match(COMMAND_RE)
      if (command) {
        return { suggestions: commandSuggestions(context, command[1]) }
      }

      return { suggestions: [] }
    }
  })

  // Hovering a citation shows the bibliography entry it points at.
  monaco.languages.registerHoverProvider('latex', {
    provideHover: (model, position) => {
      const line = model.getLineContent(position.lineNumber)
      const index = useProjectStore.getState().index
      if (!index) return null

      const citation = findEnclosingArgument(line, position.column, CITE_COMMANDS)
      if (citation) {
        const key = pickKeyAt(citation.value, position.column - citation.start)
        const entry = index.bibEntries.find((candidate) => candidate.key === key)
        if (!entry) return null
        const fields = ['author', 'title', 'journal', 'booktitle', 'publisher', 'year']
          .filter((field) => entry.fields[field])
          .map((field) => `**${field}**: ${entry.fields[field]}`)
        return {
          contents: [
            { value: `\`@${entry.type}{${entry.key}}\`` },
            { value: fields.join('\n\n') },
            { value: `_${entry.file}, line ${entry.line}_` }
          ]
        }
      }

      const reference = findEnclosingArgument(line, position.column, REF_COMMANDS)
      if (reference) {
        const label = index.labels.find((candidate) => candidate.name === reference.value.trim())
        if (!label) {
          return {
            contents: [{ value: `No \`\\label{${reference.value}}\` was found in this project.` }]
          }
        }
        return {
          contents: [
            { value: `\`\\label{${label.name}}\`` },
            { value: label.context ? `In: ${label.context}` : '' },
            { value: `_${label.file}, line ${label.line}_` }
          ]
        }
      }

      return null
    }
  })
}

interface EnclosingArgument {
  command: string
  value: string
  start: number
}

/** Finds a "\cmd{...}" whose braces surround the given column. */
function findEnclosingArgument(
  line: string,
  column: number,
  commands: ReadonlySet<string>
): EnclosingArgument | null {
  const re = /\\([a-zA-Z@]+)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    if (!commands.has(match[1])) continue
    const valueStart = match.index + match[0].indexOf('{') + 2
    const valueEnd = valueStart + match[2].length
    if (column >= valueStart && column <= valueEnd) {
      return { command: match[1], value: match[2], start: valueStart }
    }
  }
  return null
}

/** In "a,b,c" returns the key covering the given offset. */
function pickKeyAt(value: string, offset: number): string {
  let cursor = 0
  for (const part of value.split(',')) {
    const end = cursor + part.length
    if (offset <= end + 1) return part.trim()
    cursor = end + 1
  }
  return value.trim()
}
