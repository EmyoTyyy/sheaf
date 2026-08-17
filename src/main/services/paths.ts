import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import type { FileKind } from '@shared/types'
import { fail } from './errors'

/** Application metadata directory inside every project. Never holds sources. */
export const SHEAF_DIR = '.sheaf'
export const SHEAF_SETTINGS_FILE = `${SHEAF_DIR}/settings.json`
export const DEFAULT_OUTPUT_DIR = `${SHEAF_DIR}/build`

/** Directories that are never shown in the explorer, indexed or searched. */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.venv',
  '__pycache__',
  '.DS_Store',
  SHEAF_DIR
])

const EXTENSION_KINDS: Record<string, FileKind> = {
  '.tex': 'tex',
  '.ltx': 'tex',
  '.latex': 'tex',
  '.bib': 'bib',
  '.sty': 'sty',
  '.cls': 'cls',
  '.bst': 'bst',
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.eps': 'image',
  '.txt': 'text',
  '.md': 'text',
  '.markdown': 'text',
  '.json': 'data',
  '.yml': 'data',
  '.yaml': 'data',
  '.toml': 'data',
  '.csv': 'data',
  '.tsv': 'data',
  '.xml': 'data',
  '.def': 'text',
  '.cfg': 'text',
  '.clo': 'text',
  '.ins': 'text',
  '.dtx': 'text',
  '.tikz': 'tex',
  '.pgf': 'tex',
  '.Rnw': 'tex',
  '.sh': 'text',
  '.py': 'text',
  '.gnuplot': 'text',
  '.gp': 'text'
}

/** Extensions treated as text for reading, searching and indexing. */
const TEXT_KINDS: ReadonlySet<FileKind> = new Set<FileKind>([
  'tex',
  'bib',
  'sty',
  'cls',
  'bst',
  'text',
  'data'
])

/** Build artefacts hidden from the explorer when they sit next to sources. */
export const AUX_EXTENSIONS = new Set([
  '.aux',
  '.log',
  '.out',
  '.toc',
  '.lof',
  '.lot',
  '.fls',
  '.fdb_latexmk',
  '.synctex',
  '.gz',
  '.bbl',
  '.blg',
  '.bcf',
  '.run.xml',
  '.nav',
  '.snm',
  '.vrb',
  '.idx',
  '.ilg',
  '.ind',
  '.acn',
  '.acr',
  '.alg',
  '.glo',
  '.gls',
  '.glg',
  '.xdv'
])

export function classifyFile(name: string): FileKind {
  const ext = path.extname(name).toLowerCase()
  return EXTENSION_KINDS[ext] ?? 'binary'
}

export function isTextKind(kind: FileKind): boolean {
  return TEXT_KINDS.has(kind)
}

export function isTextFile(name: string): boolean {
  return isTextKind(classifyFile(name))
}

export function isAuxFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.synctex.gz') || lower.endsWith('.run.xml')) return true
  return AUX_EXTENSIONS.has(path.extname(lower))
}

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name)
}

/** Normalises any path to forward slashes, as used for project-relative paths. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

export function fromPosix(p: string): string {
  return p.split('/').join(path.sep)
}

/** Stable per-directory identifier; survives restarts, unlike a counter. */
export function projectIdFor(absolutePath: string): string {
  const normalised = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
  return crypto.createHash('sha1').update(normalised).digest('hex').slice(0, 16)
}

const INVALID_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/
const RESERVED_WINDOWS_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** Validates a single path segment typed by the user. */
export function assertValidName(name: string): void {
  if (!name || !name.trim()) {
    fail('INVALID_NAME', 'Invalid name', 'The name cannot be empty.')
  }
  if (name === '.' || name === '..') {
    fail('INVALID_NAME', 'Invalid name', `"${name}" is not a usable file name.`)
  }
  if (name.includes('/') || name.includes('\\')) {
    fail(
      'INVALID_NAME',
      'Invalid name',
      'The name cannot contain a path separator.',
      'Create the folder first, then create the file inside it.'
    )
  }
  if (INVALID_NAME_CHARS.test(name)) {
    fail('INVALID_NAME', 'Invalid name', 'The name contains characters that are not allowed.')
  }
  if (RESERVED_WINDOWS_NAMES.test(name)) {
    fail(
      'INVALID_NAME',
      'Reserved name',
      `"${name}" is reserved by Windows and cannot be used as a file name.`
    )
  }
  if (name.length > 255) {
    fail('INVALID_NAME', 'Name too long', 'File names are limited to 255 characters.')
  }
}

/**
 * Resolves a project-relative path against the project root and guarantees the
 * result stays inside it. This is the single choke point for every filesystem
 * operation driven by the renderer.
 */
export function resolveInProject(root: string, relative: string): string {
  if (typeof relative !== 'string') {
    fail('PATH_ESCAPE', 'Invalid path', 'A file path was expected.')
  }
  // A leading separator is read as "from the project root", not as an absolute
  // filesystem path, so "/main.tex" and "main.tex" mean the same file.
  const cleaned = relative.replace(/^[/\\]+/, '')
  if (path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    fail(
      'PATH_ESCAPE',
      'Path outside the project',
      'Absolute paths are not accepted for project files.'
    )
  }
  const rootResolved = path.resolve(root)
  const target = path.resolve(rootResolved, fromPosix(cleaned))
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    fail(
      'PATH_ESCAPE',
      'Path outside the project',
      `"${relative}" resolves outside of the project directory.`,
      'Only files inside the project directory can be modified.'
    )
  }
  return target
}

/**
 * Same guarantee as resolveInProject, but also follows symlinks so a link
 * pointing outside the project cannot be used to escape it.
 */
export async function resolveInProjectStrict(root: string, relative: string): Promise<string> {
  const target = resolveInProject(root, relative)
  const rootReal = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root))
  let real: string
  try {
    real = await fs.realpath(target)
  } catch {
    // Target does not exist yet (creating a file): validate its parent instead.
    const parent = path.dirname(target)
    const parentReal = await fs.realpath(parent).catch(() => parent)
    if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
      fail(
        'PATH_ESCAPE',
        'Path outside the project',
        `"${relative}" resolves outside of the project directory through a symbolic link.`
      )
    }
    return target
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    fail(
      'PATH_ESCAPE',
      'Path outside the project',
      `"${relative}" points outside of the project directory through a symbolic link.`,
      'Sheaf only edits files that live inside the project.'
    )
  }
  return target
}

/** Absolute path -> project-relative POSIX path. Returns null when outside. */
export function relativeToProject(root: string, absolute: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(absolute))
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return toPosix(rel)
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/** Appends " 2", " 3", ... until the path is free. */
export async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  let counter = 2
  while (await pathExists(path.join(dir, candidate))) {
    candidate = `${base} ${counter}${ext}`
    counter += 1
  }
  return candidate
}
