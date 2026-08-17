import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { app, shell } from 'electron'
import type { OpenedProject, ProjectRef, ProjectSettings, TemplateId } from '@shared/types'
import { fail } from './errors'
import { JsonStore, deepMerge, type DeepPartial } from './json-store'
import {
  SHEAF_DIR,
  SHEAF_SETTINGS_FILE,
  assertValidName,
  isIgnoredDirectory,
  pathExists,
  projectIdFor,
  relativeToProject,
  resolveInProjectStrict,
  toPosix,
  uniquePath
} from './paths'
import { copyDirectory, readTree } from './fs-service'
import { defaultProjectSettings, getSettings } from './settings-service'
import { buildTemplateFiles } from './templates'

interface RecentStore {
  projects: Omit<ProjectRef, 'exists'>[]
}

let recentStore: JsonStore<RecentStore> | null = null

function getRecentStore(): JsonStore<RecentStore> {
  if (!recentStore) {
    recentStore = new JsonStore<RecentStore>(
      path.join(app.getPath('userData'), 'projects.json'),
      { projects: [] }
    )
  }
  return recentStore
}

/** Projects the renderer currently has open, keyed by project id. */
const openProjects = new Map<string, ProjectRef>()

export function getOpenProject(projectId: string): ProjectRef {
  const ref = openProjects.get(projectId)
  if (!ref) {
    fail(
      'PROJECT_NOT_FOUND',
      'Project is not open',
      'The project this action refers to is no longer open.',
      'Reopen it from the dashboard.'
    )
  }
  return ref
}

export function listOpenProjects(): ProjectRef[] {
  return [...openProjects.values()]
}

export function forgetOpenProject(projectId: string): void {
  openProjects.delete(projectId)
}

/* ------------------------------------------------------------------ */
/* Recent projects                                                     */
/* ------------------------------------------------------------------ */

export async function listRecentProjects(): Promise<ProjectRef[]> {
  const store = await getRecentStore().read()
  const refs = await Promise.all(
    store.projects.map(async (entry) => ({
      ...entry,
      exists: await pathExists(entry.path)
    }))
  )
  return refs.sort((a, b) => b.lastOpened - a.lastOpened)
}

async function rememberProject(ref: ProjectRef): Promise<void> {
  const store = getRecentStore()
  const current = await store.read()
  const others = current.projects.filter((entry) => entry.id !== ref.id)
  const next = [{ id: ref.id, name: ref.name, path: ref.path, lastOpened: ref.lastOpened }, ...others]
  await store.write({ projects: next.slice(0, 50) })
}

export async function forgetProject(projectId: string): Promise<void> {
  const store = getRecentStore()
  const current = await store.read()
  await store.write({ projects: current.projects.filter((entry) => entry.id !== projectId) })
  openProjects.delete(projectId)
}

/* ------------------------------------------------------------------ */
/* Project settings (.sheaf/settings.json)                             */
/* ------------------------------------------------------------------ */

export async function readProjectSettings(root: string): Promise<ProjectSettings> {
  const defaults = defaultProjectSettings(await getSettings())
  try {
    const raw = await fs.readFile(path.join(root, SHEAF_SETTINGS_FILE), 'utf8')
    return deepMerge(defaults, JSON.parse(raw) as unknown)
  } catch {
    return defaults
  }
}

export async function writeProjectSettings(
  root: string,
  settings: ProjectSettings
): Promise<ProjectSettings> {
  const dir = path.join(root, SHEAF_DIR)
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(root, SHEAF_SETTINGS_FILE)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8')
  await fs.rename(tmp, target)
  await ensureGitIgnoreEntry(root)
  return settings
}

export async function updateProjectSettings(
  projectId: string,
  patch: DeepPartial<ProjectSettings>
): Promise<ProjectSettings> {
  const ref = getOpenProject(projectId)
  const current = await readProjectSettings(ref.path)
  return writeProjectSettings(ref.path, deepMerge(current, patch))
}

/** Keeps build output out of version control without touching user rules. */
async function ensureGitIgnoreEntry(root: string): Promise<void> {
  const gitDir = path.join(root, '.git')
  if (!(await pathExists(gitDir))) return
  const ignorePath = path.join(root, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(ignorePath, 'utf8')
  } catch {
    // No .gitignore yet: create one with just our entry.
  }
  if (content.split(/\r?\n/).some((line) => line.trim() === `${SHEAF_DIR}/build/`)) return
  const suffix = content && !content.endsWith('\n') ? '\n' : ''
  await fs.writeFile(
    ignorePath,
    `${content}${suffix}# Sheaf build output\n${SHEAF_DIR}/build/\n`,
    'utf8'
  )
}

/* ------------------------------------------------------------------ */
/* Open / create                                                       */
/* ------------------------------------------------------------------ */

export async function openProject(absolutePath: string): Promise<OpenedProject> {
  const root = path.resolve(absolutePath)
  const stat = await fs.stat(root).catch(() => null)
  if (!stat) {
    fail(
      'PROJECT_NOT_FOUND',
      'Project folder not found',
      `Nothing exists at ${root}.`,
      'It may have been moved or deleted. Remove it from the recent list, or open it from its new location.'
    )
  }
  if (!stat.isDirectory()) {
    fail('PROJECT_NOT_FOUND', 'Not a folder', `${root} is a file, not a project directory.`)
  }

  const ref: ProjectRef = {
    id: projectIdFor(root),
    name: path.basename(root) || root,
    path: root,
    lastOpened: Date.now(),
    exists: true
  }
  openProjects.set(ref.id, ref)
  await rememberProject(ref)

  const settings = await readProjectSettings(root)
  const tree = await readTree(root)
  return { ref, settings, tree }
}

export interface CreateProjectOptions {
  name: string
  /** Parent directory; defaults to the configured projects directory. */
  directory?: string
  template: TemplateId
}

export async function createProject(options: CreateProjectOptions): Promise<OpenedProject> {
  const name = options.name.trim()
  assertValidName(name)
  const settings = await getSettings()
  const parent = options.directory?.trim() || settings.app.projectsDirectory
  await fs.mkdir(parent, { recursive: true })

  const folderName = await uniquePath(parent, name)
  const root = path.join(parent, folderName)
  await fs.mkdir(root, { recursive: false })

  const files = buildTemplateFiles(options.template, name)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, 'utf8')
  }

  const projectSettings = defaultProjectSettings(settings)
  projectSettings.mainDocument = files['main.tex'] !== undefined ? 'main.tex' : null
  await writeProjectSettings(root, projectSettings)

  return openProject(root)
}

export async function renameProject(projectId: string, newName: string): Promise<ProjectRef> {
  const ref = getOpenProject(projectId)
  const trimmed = newName.trim()
  assertValidName(trimmed)
  const parent = path.dirname(ref.path)
  const destination = path.join(parent, trimmed)
  if (destination === ref.path) return ref
  if (await pathExists(destination)) {
    fail(
      'ALREADY_EXISTS',
      'Name already taken',
      `A folder called "${trimmed}" already exists next to this project.`
    )
  }
  await fs.rename(ref.path, destination)
  await forgetProject(projectId)
  const opened = await openProject(destination)
  return opened.ref
}

export async function duplicateProject(projectId: string, newName?: string): Promise<ProjectRef> {
  const ref = getOpenProject(projectId)
  const parent = path.dirname(ref.path)
  const desired = newName?.trim() || `${ref.name} copy`
  assertValidName(desired)
  const folderName = await uniquePath(parent, desired)
  const destination = path.join(parent, folderName)
  await copyProjectTree(ref.path, destination)
  const opened = await openProject(destination)
  return opened.ref
}

/** Copies sources and project settings, but not build artefacts or .git. */
async function copyProjectTree(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === SHEAF_DIR) {
        // Keep settings.json, drop the build directory.
        await fs.mkdir(to, { recursive: true })
        const settingsPath = path.join(from, 'settings.json')
        if (await pathExists(settingsPath)) {
          await fs.copyFile(settingsPath, path.join(to, 'settings.json'))
        }
        continue
      }
      if (isIgnoredDirectory(entry.name)) continue
      await copyDirectory(from, to)
    } else if (entry.isFile()) {
      await fs.copyFile(from, to)
    }
  }
}

export interface DeleteProjectOptions {
  projectId: string
  /** When false the folder is moved to the OS trash instead of being erased. */
  permanent: boolean
}

export async function deleteProject(options: DeleteProjectOptions): Promise<void> {
  const ref = getOpenProject(options.projectId)
  if (options.permanent) {
    await fs.rm(ref.path, { recursive: true, force: true })
  } else {
    const error = await shell.trashItem(ref.path).then(
      () => null,
      (e: unknown) => e
    )
    if (error) {
      fail(
        'PERMISSION_DENIED',
        'Could not move the project to the trash',
        `${ref.path} could not be moved to the system trash.`,
        'Delete it permanently instead, or remove it manually.',
        String(error)
      )
    }
  }
  await forgetProject(options.projectId)
}

/* ------------------------------------------------------------------ */
/* Main document detection (spec section 17)                           */
/* ------------------------------------------------------------------ */

const DOCUMENTCLASS_RE = /^\s*\\documentclass\s*(\[[^\]]*\])?\s*\{/m
const MAX_MAIN_SCAN_BYTES = 64 * 1024

/**
 * Resolution order: the configured main document, then a .tex file declaring
 * \documentclass (preferring main.tex and shallow paths), then main.tex.
 */
export async function detectMainDocument(
  root: string,
  configured: string | null
): Promise<string | null> {
  if (configured) {
    const absolute = path.join(root, configured)
    if (await pathExists(absolute)) return toPosix(configured)
  }

  const candidates: { relative: string; score: number }[] = []
  for await (const file of iterateTexFiles(root)) {
    const head = await readHead(file.absolute, MAX_MAIN_SCAN_BYTES)
    if (!DOCUMENTCLASS_RE.test(head)) continue
    const depth = file.relative.split('/').length - 1
    const base = path.basename(file.relative).toLowerCase()
    let score = 100 - depth * 10
    if (base === 'main.tex') score += 50
    else if (base === 'thesis.tex' || base === 'report.tex' || base === 'paper.tex') score += 20
    if (/\\begin\s*\{document\}/.test(head)) score += 25
    candidates.push({ relative: file.relative, score })
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative))
    return candidates[0].relative
  }

  if (await pathExists(path.join(root, 'main.tex'))) return 'main.tex'
  return null
}

async function readHead(absolute: string, bytes: number): Promise<string> {
  const handle = await fs.open(absolute, 'r').catch(() => null)
  if (!handle) return ''
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function* iterateTexFiles(
  root: string,
  relative = '',
  depth = 0
): AsyncGenerator<{ relative: string; absolute: string }> {
  if (depth > 6) return
  const absolute = relative ? path.join(root, relative) : root
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) continue
      yield* iterateTexFiles(root, childRelative, depth + 1)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) {
      yield { relative: toPosix(childRelative), absolute: path.join(absolute, entry.name) }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Project root detection for files opened from the OS (spec 31)       */
/* ------------------------------------------------------------------ */

interface RootCandidate {
  directory: string
  score: number
  depth: number
}

/**
 * Given a file path, works out which directory should be treated as its
 * project. Walks up from the file, scoring each ancestor on LaTeX-project
 * indicators, and falls back to the containing directory.
 */
export async function detectProjectRoot(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath)
  const stat = await fs.stat(absolute).catch(() => null)
  const startDir = stat?.isDirectory() ? absolute : path.dirname(absolute)

  const home = os.homedir()
  const candidates: RootCandidate[] = []
  let current = startDir
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push({ directory: current, score: await scoreProjectRoot(current), depth })
    const parent = path.dirname(current)
    if (parent === current) break
    // Never climb above the home directory or into filesystem roots.
    if (current === home || parent === path.dirname(home)) break
    current = parent
  }

  const best = candidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.depth - b.depth)[0]

  return best?.directory ?? startDir
}

async function scoreProjectRoot(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => null)
  if (!entries) return 0

  let score = 0
  let texFiles = 0
  const names = new Set<string>()

  for (const entry of entries) {
    names.add(entry.name.toLowerCase())
    if (entry.isDirectory()) continue
    const lower = entry.name.toLowerCase()
    if (lower.endsWith('.tex')) texFiles += 1
    else if (lower.endsWith('.bib')) score += 12
    else if (lower.endsWith('.sty') || lower.endsWith('.cls')) score += 8
    else if (lower === 'latexmkrc' || lower === '.latexmkrc' || lower === 'makefile') score += 6
  }

  if (names.has(SHEAF_DIR)) score += 200
  if (texFiles > 0) score += 10
  if (names.has('main.tex')) score += 40
  for (const marker of ['chapters', 'sections', 'images', 'figures', 'fig', 'img']) {
    if (names.has(marker)) score += 6
  }

  // A directory only counts as a root if it holds a document class somewhere
  // at its top level; otherwise chapters/ would beat the real root.
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.tex')) continue
    const head = await readHead(path.join(directory, entry.name), MAX_MAIN_SCAN_BYTES)
    if (DOCUMENTCLASS_RE.test(head)) {
      score += 60
      break
    }
  }

  return score
}

/**
 * Opens the project a file belongs to and returns the file's project-relative
 * path, so the renderer can open it in a tab.
 */
export async function openFileAsProject(
  filePath: string
): Promise<{ project: OpenedProject; relativePath: string | null }> {
  const absolute = path.resolve(filePath)
  const root = await detectProjectRoot(absolute)
  const project = await openProject(root)
  const stat = await fs.stat(absolute).catch(() => null)
  const relativePath = stat?.isDirectory() ? null : relativeToProject(root, absolute)
  return { project, relativePath }
}

/** Resolves an absolute path for a project-relative file, with safety checks. */
export async function resolveProjectFile(projectId: string, relative: string): Promise<string> {
  const ref = getOpenProject(projectId)
  return resolveInProjectStrict(ref.path, relative)
}
