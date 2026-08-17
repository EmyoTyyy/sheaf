import type { FileKind } from '@shared/types'

/** Project-relative paths always use forward slashes. */

export function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  return index === -1 ? filePath : filePath.slice(index + 1)
}

export function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  return index === -1 ? '' : filePath.slice(0, index)
}

export function extname(filePath: string): string {
  const name = basename(filePath)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index).toLowerCase()
}

export function stem(filePath: string): string {
  const name = basename(filePath)
  const index = name.lastIndexOf('.')
  return index <= 0 ? name : name.slice(0, index)
}

export function joinPath(...segments: string[]): string {
  return segments.filter(Boolean).join('/').replace(/\/+/g, '/')
}

const KINDS: Record<string, FileKind> = {
  '.tex': 'tex',
  '.ltx': 'tex',
  '.latex': 'tex',
  '.tikz': 'tex',
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
  '.json': 'data',
  '.yml': 'data',
  '.yaml': 'data',
  '.toml': 'data',
  '.csv': 'data',
  '.tsv': 'data',
  '.xml': 'data'
}

export function kindOf(filePath: string): FileKind {
  return KINDS[extname(filePath)] ?? 'binary'
}

const TEXT_KINDS: FileKind[] = ['tex', 'bib', 'sty', 'cls', 'bst', 'text', 'data']

export function isEditable(filePath: string): boolean {
  return TEXT_KINDS.includes(kindOf(filePath))
}

export function isImage(filePath: string): boolean {
  return kindOf(filePath) === 'image'
}

const EXTRA_LANGUAGES: Record<string, string> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.sh': 'shell',
  '.py': 'python',
  '.cfg': 'ini',
  '.toml': 'ini'
}

/** Monaco language id for a project file. */
export function languageFor(filePath: string): string {
  const kind = kindOf(filePath)
  if (kind === 'tex' || kind === 'sty' || kind === 'cls' || kind === 'bst') return 'latex'
  if (kind === 'bib') return 'bibtex'
  return EXTRA_LANGUAGES[extname(filePath)] ?? 'plaintext'
}

/**
 * Shortens a long path from the middle, keeping both ends readable. CSS
 * ellipsis can only trim one end, and the right-to-left trick that fakes it
 * moves leading slashes to the wrong side.
 */
export function middleTruncate(text: string, max = 62): string {
  if (text.length <= max) return text
  const keepEnd = Math.max(12, Math.floor((max - 3) * 0.62))
  const keepStart = max - 3 - keepEnd
  return `${text.slice(0, keepStart)}...${text.slice(-keepEnd)}`
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
