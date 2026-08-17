import path from 'node:path'
import type { Diagnostic, DiagnosticSeverity } from '@shared/types'
import { relativeToProject, toPosix } from './paths'

export interface ParseContext {
  /** Absolute project root, used to make log paths project-relative. */
  root: string
  /** Directory the engine ran in (its cwd). */
  cwd: string
  /** Project-relative main document, used when the file stack is empty. */
  mainFile: string | null
}

/* ------------------------------------------------------------------ */
/* File stack                                                          */
/* ------------------------------------------------------------------ */

const PATH_TOKEN = /^[^\s()[\]{}]+$/

function looksLikePath(token: string): boolean {
  if (!token || !PATH_TOKEN.test(token)) return false
  if (!token.includes('.') && !token.includes('/') && !token.includes('\\')) return false
  // Reject pure numbers and version-like tokens: "3.14", "2023/12/01".
  if (/^[\d./-]+$/.test(token)) return false
  return true
}

/**
 * TeX prints "(./chapters/intro.tex" when it opens a file and ")" when it
 * closes one. Tracking that stack gives a file for messages that do not carry
 * one themselves (most warnings).
 */
function buildFileStack(lines: string[], mainFile: string | null): (string | null)[] {
  const stack: string[] = mainFile ? [mainFile] : []
  const perLine: (string | null)[] = new Array(lines.length)

  for (let index = 0; index < lines.length; index += 1) {
    perLine[index] = stack.length > 0 ? stack[stack.length - 1] : mainFile
    const line = lines[index]

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]
      if (char === '(') {
        let end = i + 1
        while (end < line.length && !'()[]{} '.includes(line[end])) end += 1
        const token = line.slice(i + 1, end)
        if (looksLikePath(token)) {
          stack.push(token)
          i = end - 1
        } else {
          // Not a file open; push a marker so the matching ')' still balances.
          stack.push(stack.length > 0 ? stack[stack.length - 1] : (mainFile ?? ''))
        }
      } else if (char === ')') {
        stack.pop()
      }
    }
  }

  return perLine
}

/* ------------------------------------------------------------------ */
/* Path normalisation                                                  */
/* ------------------------------------------------------------------ */

function normaliseLogPath(raw: string | null, context: ParseContext): string | null {
  if (!raw) return null
  let candidate = raw.trim().replace(/^"+|"+$/g, '')
  if (!candidate) return null
  candidate = candidate.replace(/^\.\//, '')
  const absolute = path.isAbsolute(candidate)
    ? candidate
    : path.resolve(context.cwd, candidate)
  const relative = relativeToProject(context.root, absolute)
  if (!relative) return null
  return toPosix(relative)
}

/* ------------------------------------------------------------------ */
/* Hints                                                               */
/* ------------------------------------------------------------------ */

const MISSING_FILE_RE = /File\s+[`'"]([^`'"]+)[`'"]\s+not found/i

function hintFor(message: string): string | undefined {
  const missingFile = message.match(MISSING_FILE_RE)
  if (missingFile) {
    const file = missingFile[1]
    const ext = path.extname(file).toLowerCase()
    if (ext === '.sty' || ext === '.cls') {
      const pkg = path.basename(file, ext)
      return `The package "${pkg}" is not installed. On TeX Live run "tlmgr install ${pkg}"; on MiKTeX let the package manager install it on demand.`
    }
    return `Sheaf could not find "${file}". Check the path is correct and the file is inside the project.`
  }
  if (/Undefined control sequence/i.test(message)) {
    return 'The command does not exist. Check the spelling, or add the package that defines it.'
  }
  if (/Missing \$ inserted/i.test(message)) {
    return 'A maths-only command was used outside maths mode. Wrap it in $...$ or an equation environment.'
  }
  if (/Missing \\begin\{document\}/i.test(message)) {
    return 'Text appeared before \\begin{document}, often a stray character in the preamble.'
  }
  if (/Environment .* undefined/i.test(message)) {
    return 'The environment is not defined. It usually comes from a package that is not loaded.'
  }
  if (/Runaway argument|Paragraph ended before/i.test(message)) {
    return 'A brace or environment was probably left unclosed above this point.'
  }
  if (/Emergency stop|Fatal error occurred/i.test(message)) {
    return 'The engine gave up. Fix the first error above; the rest are usually consequences of it.'
  }
  if (/There were undefined references/i.test(message)) {
    return 'Compile again so cross-references can settle, or check the \\label spelling.'
  }
  if (/Please \(?re\)?run Biber|run BibTeX/i.test(message)) {
    return 'The bibliography needs rebuilding. Sheaf normally handles this automatically.'
  }
  if (/Unicode character/i.test(message)) {
    return 'The character is not available in the current font encoding. Try compiling with XeLaTeX or LuaLaTeX.'
  }
  return undefined
}

/* ------------------------------------------------------------------ */
/* Main parser                                                         */
/* ------------------------------------------------------------------ */

// "./main.tex:42: Undefined control sequence." (-file-line-error)
const FILE_LINE_ERROR_RE = /^(?:\s*)((?:[A-Za-z]:)?[^:\n]*?\.[A-Za-z0-9]+):(\d+):\s*(.*)$/
// "! Undefined control sequence."
const BANG_ERROR_RE = /^!\s+(.*)$/
// "l.42 \badcommand"
const LINE_MARKER_RE = /^l\.(\d+)\s?(.*)$/
const LATEX_WARNING_RE = /^(?:LaTeX|Package|Class|LaTeX Font)\s*(?:([\w@.-]+)\s+)?(Warning|Info):\s*(.*)$/
const CONTINUATION_RE = /^\(([\w@.-]+)\)\s{2,}(.*)$/
const ON_INPUT_LINE_RE = /on input line (\d+)/
const BOX_WARNING_RE =
  /^(Overfull|Underfull)\s+\\([hv])box\s*\((.*?)\)(?:\s+in paragraph)?(?:\s+at lines? (\d+)(?:--(\d+))?)?/
const NO_FILE_RE = /^No file (.+)\.$/
const MISSING_CHAR_RE = /^Missing character: There is no (.+?) in font (.+?)!$/

let diagnosticCounter = 0

function makeDiagnostic(
  severity: DiagnosticSeverity,
  message: string,
  file: string | null,
  line: number | null,
  raw?: string,
  column: number | null = null
): Diagnostic {
  diagnosticCounter += 1
  return {
    id: `d${diagnosticCounter}`,
    severity,
    message: message.trim(),
    file,
    line,
    column,
    hint: hintFor(message),
    raw
  }
}

export function parseLatexLog(log: string, context: ParseContext): Diagnostic[] {
  const lines = log.split(/\r?\n/)
  const fileStack = buildFileStack(lines, context.mainFile)
  const diagnostics: Diagnostic[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue

    const currentFile = normaliseLogPath(fileStack[index], context) ?? context.mainFile

    // 1. file:line: message  (the most precise form)
    const fileLine = line.match(FILE_LINE_ERROR_RE)
    if (fileLine && !line.startsWith('!')) {
      const [, rawPath, lineNumber, rest] = fileLine
      const resolved = normaliseLogPath(rawPath, context)
      const isWarning = /warning/i.test(rest)
      const message = rest.replace(/^LaTeX Error:\s*/, '')
      if (message) {
        diagnostics.push(
          makeDiagnostic(
            isWarning ? 'warning' : 'error',
            message,
            resolved,
            Number(lineNumber),
            collectContext(lines, index)
          )
        )
        continue
      }
    }

    // 2. "! message" — the classic TeX error, line number follows on "l.NN"
    const bang = line.match(BANG_ERROR_RE)
    if (bang) {
      const message = bang[1].replace(/^LaTeX Error:\s*/, '')
      let lineNumber: number | null = null
      let column: number | null = null
      for (let look = index + 1; look < Math.min(index + 12, lines.length); look += 1) {
        const marker = lines[look].match(LINE_MARKER_RE)
        if (marker) {
          lineNumber = Number(marker[1])
          // The text after "l.NN" is what TeX had read; its length is the column.
          column = marker[2] ? marker[2].length + 1 : null
          break
        }
      }
      diagnostics.push(
        makeDiagnostic(
          'error',
          message,
          currentFile,
          lineNumber,
          collectContext(lines, index),
          column
        )
      )
      continue
    }

    // 3. LaTeX / package warnings, which may continue over several lines
    const warning = line.match(LATEX_WARNING_RE)
    if (warning) {
      const [, source, kind, head] = warning
      let message = head
      let last = index
      for (let look = index + 1; look < Math.min(index + 8, lines.length); look += 1) {
        const continuation = lines[look].match(CONTINUATION_RE)
        if (!continuation) break
        message += ' ' + continuation[2].trim()
        last = look
      }

      // "Info" lines are the engine narrating itself: fonts being loaded,
      // primitives being available, images being placed. A real document emits
      // dozens of them and none are actionable, so they stay in the raw log
      // rather than burying the problems that matter.
      if (kind !== 'Warning') {
        index = last
        continue
      }

      const onLine = message.match(ON_INPUT_LINE_RE)
      const label = source ? `${source}: ` : ''
      diagnostics.push(
        makeDiagnostic(
          'warning',
          `${label}${message}`,
          currentFile,
          onLine ? Number(onLine[1]) : null,
          lines.slice(index, last + 1).join('\n')
        )
      )
      index = last
      continue
    }

    // 4. Overfull / underfull boxes are informational
    const box = line.match(BOX_WARNING_RE)
    if (box) {
      const [, kind, direction, detail, startLine] = box
      diagnostics.push(
        makeDiagnostic(
          'info',
          `${kind} \\${direction}box (${detail})`,
          currentFile,
          startLine ? Number(startLine) : null,
          line
        )
      )
      continue
    }

    // 5. Missing input file
    const noFile = line.match(NO_FILE_RE)
    if (noFile) {
      diagnostics.push(
        makeDiagnostic('warning', `No file ${noFile[1]}.`, currentFile, null, line)
      )
      continue
    }

    // 6. Characters missing from the font
    const missingChar = line.match(MISSING_CHAR_RE)
    if (missingChar) {
      diagnostics.push(
        makeDiagnostic(
          'info',
          `Missing character: ${missingChar[1]} is not available in ${missingChar[2]}`,
          currentFile,
          null,
          line
        )
      )
    }
  }

  return dedupe(diagnostics)
}

/** A few lines of surrounding log, shown when a diagnostic is expanded. */
function collectContext(lines: string[], index: number): string {
  return lines.slice(index, Math.min(index + 6, lines.length)).join('\n').trimEnd()
}

function dedupe(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const result: Diagnostic[] = []
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}|${diagnostic.file}|${diagnostic.line}|${diagnostic.message}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }
  return result
}

/* ------------------------------------------------------------------ */
/* BibTeX / Biber logs                                                 */
/* ------------------------------------------------------------------ */

const BIBTEX_WARNING_RE = /^Warning--(.*)$/
const BIBTEX_ERROR_RE = /^(.*)---line (\d+) of file (.*)$/
const BIBER_LINE_RE = /^(?:INFO|WARN|ERROR)\s+-\s+(.*)$/

export function parseBibLog(log: string, context: ParseContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const lines = log.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue

    const bibtexError = line.match(BIBTEX_ERROR_RE)
    if (bibtexError) {
      diagnostics.push(
        makeDiagnostic(
          'error',
          bibtexError[1].trim(),
          normaliseLogPath(bibtexError[3], context),
          Number(bibtexError[2]),
          line
        )
      )
      continue
    }

    const bibtexWarning = line.match(BIBTEX_WARNING_RE)
    if (bibtexWarning) {
      diagnostics.push(makeDiagnostic('warning', bibtexWarning[1].trim(), null, null, line))
      continue
    }

    const biber = line.match(BIBER_LINE_RE)
    if (biber) {
      const severity: DiagnosticSeverity = line.startsWith('ERROR')
        ? 'error'
        : line.startsWith('WARN')
          ? 'warning'
          : 'info'
      if (severity === 'info') continue
      diagnostics.push(makeDiagnostic(severity, `Biber: ${biber[1]}`, null, null, line))
    }
  }

  return dedupe(diagnostics)
}

/* ------------------------------------------------------------------ */
/* Build control signals                                               */
/* ------------------------------------------------------------------ */

const RERUN_PATTERNS = [
  /Rerun to get cross-references right/i,
  /Rerun to get outlines right/i,
  /Label\(s\) may have changed/i,
  /Rerun LaTeX/i,
  /Please rerun LaTeX/i,
  /Table widths have changed/i,
  /Rerun to get citations correct/i
]

export function needsRerun(log: string): boolean {
  return RERUN_PATTERNS.some((pattern) => pattern.test(log))
}

export function mentionsUndefinedCitations(log: string): boolean {
  return /Citation [`'][^`']+' on page \d+ undefined|There were undefined citations/i.test(log)
}

/** True when the log shows the run produced no usable output at all. */
export function isFatal(log: string): boolean {
  return /Emergency stop|Fatal error occurred|no output PDF file produced/i.test(log)
}
