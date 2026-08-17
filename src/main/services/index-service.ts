import fs from 'node:fs/promises'
import path from 'node:path'
import type { BibEntry, Diagnostic, FileIndex, ProjectIndex } from '@shared/types'
import { walkTextFiles } from './fs-service'
import { parseBib } from './bib-parser'
import { parseTex } from './tex-parser'
import { detectMainDocument, getOpenProject, readProjectSettings } from './project-service'
import { toPosix } from './paths'

interface BibFileIndex {
  path: string
  mtimeMs: number
  entries: BibEntry[]
  diagnostics: Diagnostic[]
}

interface ProjectCache {
  tex: Map<string, FileIndex>
  bib: Map<string, BibFileIndex>
  index: ProjectIndex | null
  building: Promise<ProjectIndex> | null
}

const caches = new Map<string, ProjectCache>()

function cacheFor(projectId: string): ProjectCache {
  let cache = caches.get(projectId)
  if (!cache) {
    cache = { tex: new Map(), bib: new Map(), index: null, building: null }
    caches.set(projectId, cache)
  }
  return cache
}

export function invalidateProjectIndex(projectId: string, relativePath?: string): void {
  const cache = caches.get(projectId)
  if (!cache) return
  if (relativePath) {
    cache.tex.delete(relativePath)
    cache.bib.delete(relativePath)
  } else {
    cache.tex.clear()
    cache.bib.clear()
  }
  cache.index = null
}

export function dropProjectIndex(projectId: string): void {
  caches.delete(projectId)
}

/** Returns the cached index, building it if this is the first request. */
export async function getProjectIndex(projectId: string): Promise<ProjectIndex> {
  const cache = cacheFor(projectId)
  if (cache.index) return cache.index
  return buildProjectIndex(projectId)
}

export async function buildProjectIndex(projectId: string): Promise<ProjectIndex> {
  const cache = cacheFor(projectId)
  if (cache.building) return cache.building

  cache.building = (async () => {
    try {
      const ref = getOpenProject(projectId)
      const settings = await readProjectSettings(ref.path)
      const root = ref.path

      const seenTex = new Set<string>()
      const seenBib = new Set<string>()

      for await (const file of walkTextFiles(root)) {
        const extension = path.extname(file.relative).toLowerCase()

        if (extension === '.tex' || extension === '.ltx' || extension === '.latex') {
          seenTex.add(file.relative)
          const cached = cache.tex.get(file.relative)
          // Only re-read what actually changed; large projects stay responsive.
          if (cached && cached.mtimeMs === file.mtimeMs) continue
          const content = await fs.readFile(file.absolute, 'utf8').catch(() => null)
          if (content === null) continue
          cache.tex.set(
            file.relative,
            parseTex(content, { path: file.relative, mtimeMs: file.mtimeMs })
          )
        } else if (extension === '.bib') {
          seenBib.add(file.relative)
          const cached = cache.bib.get(file.relative)
          if (cached && cached.mtimeMs === file.mtimeMs) continue
          const content = await fs.readFile(file.absolute, 'utf8').catch(() => null)
          if (content === null) continue
          const parsed = parseBib(content, file.relative)
          cache.bib.set(file.relative, {
            path: file.relative,
            mtimeMs: file.mtimeMs,
            entries: parsed.entries,
            diagnostics: parsed.diagnostics
          })
        }
      }

      for (const key of [...cache.tex.keys()]) {
        if (!seenTex.has(key)) cache.tex.delete(key)
      }
      for (const key of [...cache.bib.keys()]) {
        if (!seenBib.has(key)) cache.bib.delete(key)
      }

      const mainDocument = await detectMainDocument(root, settings.mainDocument)
      const index = assemble(projectId, cache, mainDocument)
      cache.index = index
      return index
    } finally {
      cache.building = null
    }
  })()

  return cache.building
}

function assemble(
  projectId: string,
  cache: ProjectCache,
  mainDocument: string | null
): ProjectIndex {
  const files: Record<string, FileIndex> = {}
  const labels: FileIndex['labels'] = []
  const commands: FileIndex['commands'] = []
  const environments: FileIndex['environments'] = []

  for (const [key, value] of cache.tex) {
    files[key] = value
    labels.push(...value.labels)
    commands.push(...value.commands)
    environments.push(...value.environments)
  }

  const bibEntries: BibEntry[] = []
  const bibDiagnostics: Diagnostic[] = []
  for (const value of cache.bib.values()) {
    bibEntries.push(...value.entries)
    bibDiagnostics.push(...value.diagnostics)
  }

  const included = mainDocument ? collectIncluded(cache.tex, mainDocument) : Object.keys(files)
  const diagnostics = [...bibDiagnostics, ...crossFileDiagnostics(cache, labels, bibEntries)]

  return {
    projectId,
    updatedAt: Date.now(),
    mainDocument,
    files,
    labels,
    commands,
    environments,
    bibEntries,
    bibFiles: [...cache.bib.keys()],
    diagnostics,
    included
  }
}

/** Follows \input / \include from the main document. */
function collectIncluded(tex: Map<string, FileIndex>, mainDocument: string): string[] {
  const visited = new Set<string>()
  const queue = [mainDocument]

  while (queue.length > 0) {
    const current = queue.shift() as string
    if (visited.has(current)) continue
    visited.add(current)
    const entry = tex.get(current)
    if (!entry) continue
    for (const input of entry.inputs) {
      const resolved = resolveInput(tex, current, input.target)
      if (resolved && !visited.has(resolved)) queue.push(resolved)
    }
  }

  return [...visited]
}

function resolveInput(
  tex: Map<string, FileIndex>,
  from: string,
  target: string
): string | null {
  const candidates: string[] = []
  const withExtension = /\.(tex|ltx|latex)$/i.test(target) ? target : `${target}.tex`
  candidates.push(toPosix(path.posix.normalize(withExtension)))
  const fromDir = path.posix.dirname(from)
  if (fromDir && fromDir !== '.') {
    candidates.push(toPosix(path.posix.normalize(path.posix.join(fromDir, withExtension))))
  }
  for (const candidate of candidates) {
    if (tex.has(candidate)) return candidate
  }
  return null
}

let diagnosticCounter = 0

function nextId(): string {
  diagnosticCounter += 1
  return `idx${diagnosticCounter}`
}

/**
 * Problems that only become visible once the whole project is known:
 * references without a label, citations without an entry, duplicate labels
 * and bibliography entries nothing cites.
 */
function crossFileDiagnostics(
  cache: ProjectCache,
  labels: FileIndex['labels'],
  bibEntries: BibEntry[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  const labelNames = new Set(labels.map((label) => label.name))
  const labelCounts = new Map<string, number>()
  for (const label of labels) {
    labelCounts.set(label.name, (labelCounts.get(label.name) ?? 0) + 1)
  }
  for (const label of labels) {
    if ((labelCounts.get(label.name) ?? 0) > 1) {
      diagnostics.push({
        id: nextId(),
        severity: 'warning',
        message: `Label "${label.name}" is defined more than once.`,
        file: label.file,
        line: label.line,
        column: null,
        hint: 'LaTeX keeps the last definition, so references may point at the wrong place.'
      })
    }
  }

  const bibKeys = new Set(bibEntries.map((entry) => entry.key))
  const citedKeys = new Set<string>()

  for (const file of cache.tex.values()) {
    for (const ref of file.refs) {
      if (labelNames.has(ref.key)) continue
      diagnostics.push({
        id: nextId(),
        severity: 'warning',
        message: `Reference "${ref.key}" has no matching \\label.`,
        file: file.path,
        line: ref.line,
        column: ref.column,
        hint: 'Add \\label{' + ref.key + '} where you want the reference to point.'
      })
    }
    for (const citation of file.citations) {
      citedKeys.add(citation.key)
      if (bibKeys.size === 0 || bibKeys.has(citation.key) || citation.key === '*') continue
      diagnostics.push({
        id: nextId(),
        severity: 'warning',
        message: `Citation "${citation.key}" is not in any .bib file of this project.`,
        file: file.path,
        line: citation.line,
        column: citation.column,
        hint: 'Check the key, or add the entry to the bibliography.'
      })
    }
  }

  if (citedKeys.size > 0) {
    for (const entry of bibEntries) {
      if (citedKeys.has(entry.key)) continue
      diagnostics.push({
        id: nextId(),
        severity: 'info',
        message: `Bibliography entry "${entry.key}" is never cited.`,
        file: entry.file,
        line: entry.line,
        column: null,
        hint: 'Unused entries do not appear in the output unless \\nocite{*} is used.'
      })
    }
  }

  return diagnostics
}
