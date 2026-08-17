/**
 * Types shared between the main process, the preload bridge and the renderer.
 * This file must stay free of any Node or DOM imports.
 */

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AppErrorCode =
  | 'NO_LATEX'
  | 'COMPILER_MISSING'
  | 'COMPILE_TIMEOUT'
  | 'COMPILE_FAILED'
  | 'NO_MAIN_DOCUMENT'
  | 'NO_PDF_PRODUCED'
  | 'PROJECT_NOT_FOUND'
  | 'PATH_ESCAPE'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  | 'CONFLICT'
  | 'IS_BINARY'
  | 'TOO_LARGE'
  | 'GIT_MISSING'
  | 'GIT_FAILED'
  | 'SYNCTEX_UNAVAILABLE'
  | 'SYNCTEX_NO_MATCH'
  | 'IMPORT_FAILED'
  | 'EXPORT_FAILED'
  | 'CANCELLED'
  | 'UNKNOWN'

/** A failure that is safe and useful to show to a human. */
export interface AppError {
  code: AppErrorCode
  /** Short headline, e.g. "LaTeX compiler not found". */
  title: string
  /** Explanation of what happened. */
  detail: string
  /** What the user can do about it. */
  action?: string
  /** Raw underlying message, for the log / advanced users. */
  raw?: string
}

/** Every IPC call resolves to this; nothing throws across the bridge. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

/** Recursive partial, used for settings patches. Arrays are replaced whole. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

/* ------------------------------------------------------------------ */
/* Files & projects                                                    */
/* ------------------------------------------------------------------ */

export type FileKind =
  | 'tex'
  | 'bib'
  | 'sty'
  | 'cls'
  | 'bst'
  | 'image'
  | 'pdf'
  | 'text'
  | 'data'
  | 'binary'

export interface FileNode {
  name: string
  /** Project-relative path with forward slashes. '' for the root. */
  path: string
  type: 'file' | 'directory'
  kind?: FileKind
  size?: number
  mtimeMs?: number
  children?: FileNode[]
}

export type CompilerName = 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk' | 'tectonic'

export type BibTool = 'auto' | 'biber' | 'bibtex' | 'none'

export interface ProjectSettings {
  /** Project-relative path of the root .tex file, or null to auto-detect. */
  mainDocument: string | null
  compiler: CompilerName
  /** Extra CLI arguments appended to the engine invocation. */
  extraArgs: string[]
  bibTool: BibTool
  /** Project-relative directory for .aux/.log/.pdf. Empty string = next to sources. */
  outputDirectory: string
  autoCompile: boolean
  autoCompileDelayMs: number
  compileTimeoutMs: number
  /** Max engine passes when resolving cross-references (ignored by latexmk). */
  maxPasses: number
  /** Snippet template used when an image is dropped into the editor. */
  figureTemplate: string
}

export interface ProjectRef {
  /** Stable identifier derived from the absolute path. */
  id: string
  name: string
  /** Absolute path of the project directory. */
  path: string
  lastOpened: number
  /** False when the directory has been moved or deleted since it was recorded. */
  exists: boolean
}

export interface OpenedProject {
  ref: ProjectRef
  settings: ProjectSettings
  tree: FileNode
}

export type TemplateId =
  | 'blank'
  | 'article'
  | 'report'
  | 'book'
  | 'thesis'
  | 'beamer'
  | 'letter'

export interface TemplateInfo {
  id: TemplateId
  name: string
  description: string
}

/* ------------------------------------------------------------------ */
/* LaTeX toolchain                                                     */
/* ------------------------------------------------------------------ */

export interface LatexTool {
  name: string
  /** Absolute path to the executable. */
  path: string
  version: string | null
}

export interface LatexEnvironment {
  /** True when at least one TeX engine was found. */
  detected: boolean
  /** e.g. "TeX Live 2024", "MiKTeX 24.1", or null when unidentified. */
  distribution: string | null
  tools: Record<string, LatexTool>
  /** Directories that were probed, for the diagnostics panel. */
  searchedPaths: string[]
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  id: string
  severity: DiagnosticSeverity
  message: string
  /** Project-relative path when it could be resolved, else null. */
  file: string | null
  line: number | null
  column: number | null
  /** Actionable follow-up, e.g. "Install the package with tlmgr". */
  hint?: string
  /** Excerpt of the log this was parsed from. */
  raw?: string
}

export type BuildStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled' | 'timeout'

export interface BuildPass {
  label: string
  /** Executable plus arguments, shown for transparency. Never shell-interpreted. */
  command: string
  exitCode: number | null
  durationMs: number
}

export interface BuildResult {
  id: string
  status: BuildStatus
  diagnostics: Diagnostic[]
  log: string
  /** Absolute path of the produced PDF, or null when none was produced. */
  pdfPath: string | null
  /** Milliseconds since epoch when the PDF was written; used to bust caches. */
  pdfMtimeMs: number | null
  durationMs: number
  passes: BuildPass[]
  error?: AppError
}

export interface BuildProgress {
  buildId: string
  projectId: string
  phase: string
  chunk?: string
}

/* ------------------------------------------------------------------ */
/* Project index (drives autocomplete and diagnostics)                 */
/* ------------------------------------------------------------------ */

export interface BibEntry {
  key: string
  /** article, book, inproceedings, ... */
  type: string
  fields: Record<string, string>
  file: string
  line: number
}

export interface LabelDef {
  name: string
  file: string
  line: number
  /** Nearest preceding \caption / \section text, for the completion detail. */
  context: string
}

export interface CommandDef {
  name: string
  file: string
  line: number
  args: number
}

export interface Occurrence {
  key: string
  file: string
  line: number
  column: number
}

export interface FileIndex {
  path: string
  mtimeMs: number
  labels: LabelDef[]
  refs: Occurrence[]
  citations: Occurrence[]
  commands: CommandDef[]
  environments: CommandDef[]
  inputs: { target: string; line: number }[]
  bibResources: string[]
  graphicsPaths: string[]
  hasDocumentClass: boolean
  documentClass: string | null
  packages: string[]
}

export interface ProjectIndex {
  projectId: string
  updatedAt: number
  mainDocument: string | null
  files: Record<string, FileIndex>
  labels: LabelDef[]
  commands: CommandDef[]
  environments: CommandDef[]
  bibEntries: BibEntry[]
  bibFiles: string[]
  /** Malformed BibTeX, undefined references / citations, unused entries. */
  diagnostics: Diagnostic[]
  /** Files reachable from the main document via \input / \include. */
  included: string[]
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface SearchQuery {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Comma-separated globs, e.g. "*.tex,*.bib". Empty = all text files. */
  include: string
  exclude: string
}

export interface SearchMatch {
  line: number
  column: number
  length: number
  /** The full source line, trimmed to a sane width. */
  preview: string
  previewOffset: number
}

export interface SearchFileResult {
  file: string
  matches: SearchMatch[]
}

export interface SearchResults {
  files: SearchFileResult[]
  totalMatches: number
  filesSearched: number
  truncated: boolean
  durationMs: number
}

/* ------------------------------------------------------------------ */
/* SyncTeX                                                             */
/* ------------------------------------------------------------------ */

/** Source -> PDF. Coordinates are PDF points from the top-left of the page. */
export interface SyncForwardResult {
  page: number
  x: number
  y: number
  width: number
  height: number
}

/** PDF -> source. */
export interface SyncInverseResult {
  /** Project-relative when resolvable. */
  file: string
  line: number
  column: number
}

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

export type GitFileState =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'ignored'

export interface GitFileStatus {
  path: string
  state: GitFileState
  staged: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  files: GitFileStatus[]
  hasRemote: boolean
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

export interface TerminalChunk {
  sessionId: string
  stream: 'stdout' | 'stderr'
  data: string
}

export interface TerminalExit {
  sessionId: string
  exitCode: number | null
  signal: string | null
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type ThemePreference = 'system' | 'light' | 'dark'
export type AutosaveMode = 'off' | 'afterDelay' | 'onFocusChange'
export type PdfPanelPosition = 'right' | 'left' | 'bottom'
export type ZoomBehavior = 'fit-width' | 'fit-page' | 'actual'

export interface EditorSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  tabSize: number
  insertSpaces: boolean
  wordWrap: boolean
  minimap: boolean
  lineNumbers: boolean
  renderWhitespace: boolean
  bracketPairColorization: boolean
  autoClosingBrackets: boolean
}

export interface LatexSettings {
  defaultCompiler: CompilerName
  /** Directory holding the TeX binaries. Empty = use PATH + standard locations. */
  texBinDirectory: string
  /** Explicit executable overrides, keyed by tool name. */
  toolPaths: Record<string, string>
  autoCompile: boolean
  autoCompileDelayMs: number
  compileTimeoutMs: number
  bibTool: BibTool
  outputDirectory: string
  maxPasses: number
}

export interface PdfSettings {
  zoomBehavior: ZoomBehavior
  position: PdfPanelPosition
  autoRefresh: boolean
  highlightSync: boolean
  invertInDarkMode: boolean
}

export interface ApplicationSettings {
  theme: ThemePreference
  autosave: AutosaveMode
  autosaveDelayMs: number
  projectsDirectory: string
  restoreLastProject: boolean
  figureTemplate: string
}

export interface Settings {
  editor: EditorSettings
  latex: LatexSettings
  pdf: PdfSettings
  app: ApplicationSettings
  /** Command id -> accelerator, overriding the defaults. */
  keybindings: Record<string, string>
}

/* ------------------------------------------------------------------ */
/* Filesystem events                                                   */
/* ------------------------------------------------------------------ */

export type FileEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FileEvent {
  projectId: string
  type: FileEventType
  path: string
  kind?: FileKind
  size?: number
  mtimeMs?: number
}

/* ------------------------------------------------------------------ */
/* OS integration                                                      */
/* ------------------------------------------------------------------ */

export interface OpenFileRequest {
  /** Absolute path of a file the OS asked us to open. */
  filePath: string
  /** Detected project root for that file. */
  projectPath: string
}

export interface DefaultAppStatus {
  supported: boolean
  isDefault: boolean
  /** Extensions we can register for on this platform. */
  extensions: string[]
  detail?: string
}
