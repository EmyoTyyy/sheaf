import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileNode } from '@shared/types'
import { fail } from './errors'
import {
  assertValidName,
  classifyFile,
  isAuxFile,
  isIgnoredDirectory,
  isTextKind,
  pathExists,
  relativeToProject,
  resolveInProject,
  resolveInProjectStrict,
  toPosix,
  uniquePath
} from './paths'

/** Guard rails so a stray huge directory cannot lock up the explorer. */
const MAX_TREE_ENTRIES = 20_000
const MAX_TREE_DEPTH = 12
const MAX_TEXT_FILE_BYTES = 12 * 1024 * 1024

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf'
}

export interface ReadTextResult {
  content: string
  mtimeMs: number
  size: number
}

export interface WriteResult {
  mtimeMs: number
  size: number
}

export interface ReadBinaryResult {
  data: Uint8Array
  mime: string
  size: number
  mtimeMs: number
}

/**
 * Builds the project tree. Aux artefacts and VCS/tooling directories are
 * skipped so the explorer shows the document, not the build noise.
 */
export async function readTree(root: string): Promise<FileNode> {
  const counter = { count: 0 }
  const children = await readDirectory(root, '', 0, counter)
  return {
    name: path.basename(root),
    path: '',
    type: 'directory',
    children
  }
}

async function readDirectory(
  root: string,
  relative: string,
  depth: number,
  counter: { count: number }
): Promise<FileNode[]> {
  if (depth > MAX_TREE_DEPTH) return []
  const absolute = relative ? path.join(root, relative) : root
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (counter.count >= MAX_TREE_ENTRIES) break
    const name = entry.name
    const childRelative = relative ? `${relative}/${name}` : name

    if (entry.isDirectory()) {
      if (isIgnoredDirectory(name)) continue
      counter.count += 1
      nodes.push({
        name,
        path: childRelative,
        type: 'directory',
        children: await readDirectory(root, childRelative, depth + 1, counter)
      })
      continue
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    if (name.startsWith('.') && name !== '.gitignore' && name !== '.gitkeep') continue
    if (isAuxFile(name)) continue

    counter.count += 1
    let size: number | undefined
    let mtimeMs: number | undefined
    try {
      const stat = await fs.stat(path.join(absolute, name))
      if (stat.isDirectory()) continue
      size = stat.size
      mtimeMs = stat.mtimeMs
    } catch {
      continue
    }

    nodes.push({
      name,
      path: childRelative,
      type: 'file',
      kind: classifyFile(name),
      size,
      mtimeMs
    })
  }

  return sortNodes(nodes)
}

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export async function readTextFile(root: string, relative: string): Promise<ReadTextResult> {
  const absolute = await resolveInProjectStrict(root, relative)
  const stat = await fs.stat(absolute)
  if (stat.isDirectory()) {
    fail('NOT_FOUND', 'Not a file', `"${relative}" is a directory.`)
  }
  if (stat.size > MAX_TEXT_FILE_BYTES) {
    fail(
      'TOO_LARGE',
      'File too large to edit',
      `"${relative}" is ${(stat.size / 1024 / 1024).toFixed(1)} MB, above the ${
        MAX_TEXT_FILE_BYTES / 1024 / 1024
      } MB editing limit.`,
      'Open it with an external editor if you need to change it.'
    )
  }
  const buffer = await fs.readFile(absolute)
  if (buffer.includes(0)) {
    fail(
      'IS_BINARY',
      'Binary file',
      `"${relative}" contains binary data and cannot be opened in the text editor.`
    )
  }
  return {
    content: stripBom(buffer.toString('utf8')),
    mtimeMs: stat.mtimeMs,
    size: stat.size
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

export async function readBinaryFile(root: string, relative: string): Promise<ReadBinaryResult> {
  const absolute = await resolveInProjectStrict(root, relative)
  const stat = await fs.stat(absolute)
  const buffer = await fs.readFile(absolute)
  return {
    data: new Uint8Array(buffer),
    mime: MIME_TYPES[path.extname(relative).toLowerCase()] ?? 'application/octet-stream',
    size: stat.size,
    mtimeMs: stat.mtimeMs
  }
}

/**
 * Writes a text file. When expectedMtimeMs is supplied and no longer matches,
 * the write is refused so an external change is never silently overwritten.
 */
export async function writeTextFile(
  root: string,
  relative: string,
  content: string,
  expectedMtimeMs?: number | null
): Promise<WriteResult> {
  const absolute = await resolveInProjectStrict(root, relative)
  if (expectedMtimeMs != null) {
    try {
      const stat = await fs.stat(absolute)
      // Filesystems differ in mtime resolution; allow a millisecond of slack.
      if (Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
        fail(
          'CONFLICT',
          'File changed on disk',
          `"${relative}" was modified outside Sheaf since it was opened.`,
          'Reload the file to see the external changes, or overwrite them.'
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content, 'utf8')
  const stat = await fs.stat(absolute)
  return { mtimeMs: stat.mtimeMs, size: stat.size }
}

export async function createFile(
  root: string,
  parentRelative: string,
  name: string,
  content = ''
): Promise<string> {
  assertValidName(name)
  const relative = parentRelative ? `${parentRelative}/${name}` : name
  const absolute = await resolveInProjectStrict(root, relative)
  if (await pathExists(absolute)) {
    fail('ALREADY_EXISTS', 'File already exists', `"${relative}" already exists in the project.`)
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' })
  return relative
}

export async function createDirectory(
  root: string,
  parentRelative: string,
  name: string
): Promise<string> {
  assertValidName(name)
  const relative = parentRelative ? `${parentRelative}/${name}` : name
  const absolute = await resolveInProjectStrict(root, relative)
  if (await pathExists(absolute)) {
    fail('ALREADY_EXISTS', 'Folder already exists', `"${relative}" already exists in the project.`)
  }
  await fs.mkdir(absolute, { recursive: true })
  return relative
}

export async function renameEntry(
  root: string,
  relative: string,
  newName: string
): Promise<string> {
  assertValidName(newName)
  const absolute = await resolveInProjectStrict(root, relative)
  const parent = path.dirname(absolute)
  const target = path.join(parent, newName)
  resolveInProject(root, relativeToProject(root, target) ?? '')
  if (target === absolute) return relative
  if (await pathExists(target)) {
    fail('ALREADY_EXISTS', 'Name already taken', `"${newName}" already exists in this folder.`)
  }
  await fs.rename(absolute, target)
  return relativeToProject(root, target) ?? relative
}

/** Moves an entry into another directory of the same project. */
export async function moveEntry(
  root: string,
  relative: string,
  targetDirRelative: string
): Promise<string> {
  const absolute = await resolveInProjectStrict(root, relative)
  const targetDir = await resolveInProjectStrict(root, targetDirRelative || '')
  if (!(await pathExists(targetDir))) {
    fail('NOT_FOUND', 'Destination missing', `"${targetDirRelative}" no longer exists.`)
  }
  const stat = await fs.stat(absolute)
  if (stat.isDirectory() && (targetDir === absolute || targetDir.startsWith(absolute + path.sep))) {
    fail(
      'INVALID_NAME',
      'Cannot move a folder into itself',
      `"${relative}" cannot be moved inside its own subtree.`
    )
  }
  const name = path.basename(absolute)
  const destination = path.join(targetDir, name)
  if (destination === absolute) return relative
  if (await pathExists(destination)) {
    fail(
      'ALREADY_EXISTS',
      'Name already taken',
      `"${name}" already exists in the destination folder.`
    )
  }
  await fs.rename(absolute, destination)
  return relativeToProject(root, destination) ?? relative
}

export async function removeEntry(root: string, relative: string): Promise<void> {
  if (!relative) {
    fail('INVALID_NAME', 'Cannot delete the project root', 'Delete the project from the dashboard instead.')
  }
  const absolute = await resolveInProjectStrict(root, relative)
  await fs.rm(absolute, { recursive: true, force: false })
}

/** Copies files from anywhere on disk into the project (import / drag & drop). */
export async function importExternalFiles(
  root: string,
  targetDirRelative: string,
  sources: string[]
): Promise<string[]> {
  const targetDir = await resolveInProjectStrict(root, targetDirRelative || '')
  await fs.mkdir(targetDir, { recursive: true })
  const imported: string[] = []
  for (const source of sources) {
    const stat = await fs.stat(source).catch(() => null)
    if (!stat) continue
    const name = await uniquePath(targetDir, path.basename(source))
    const destination = path.join(targetDir, name)
    if (stat.isDirectory()) {
      await copyDirectory(source, destination)
    } else {
      await fs.copyFile(source, destination)
    }
    const rel = relativeToProject(root, destination)
    if (rel) imported.push(rel)
  }
  return imported
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name) && entry.name !== '.sheaf') continue
      await copyDirectory(from, to)
    } else if (entry.isFile()) {
      await fs.copyFile(from, to)
    }
  }
}

/** Walks every text file of the project; used by search and the indexer. */
export async function* walkTextFiles(
  root: string,
  relative = '',
  depth = 0
): AsyncGenerator<{ relative: string; absolute: string; size: number; mtimeMs: number }> {
  if (depth > MAX_TREE_DEPTH) return
  const absolute = relative ? path.join(root, relative) : root
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) continue
      yield* walkTextFiles(root, childRelative, depth + 1)
      continue
    }
    if (!entry.isFile()) continue
    if (isAuxFile(entry.name)) continue
    if (!isTextKind(classifyFile(entry.name))) continue
    try {
      const stat = await fs.stat(path.join(absolute, entry.name))
      if (stat.size > MAX_TEXT_FILE_BYTES) continue
      yield {
        relative: toPosix(childRelative),
        absolute: path.join(absolute, entry.name),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      }
    } catch {
      continue
    }
  }
}
