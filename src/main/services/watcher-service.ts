import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FileEvent, FileEventType } from '@shared/types'
import { SHEAF_DIR, classifyFile, isAuxFile, toPosix } from './paths'

/**
 * Watches a project directory and reports individual changes, so the explorer
 * can patch its tree instead of reloading the whole project on every save.
 */

interface Watch {
  watcher: FSWatcher
  projectId: string
  pending: Map<string, FileEvent>
  timer: NodeJS.Timeout | null
}

const watches = new Map<string, Watch>()
const DEBOUNCE_MS = 120

export type FileEventListener = (events: FileEvent[]) => void

let listener: FileEventListener | null = null

export function setFileEventListener(next: FileEventListener | null): void {
  listener = next
}

export function watchProject(projectId: string, root: string): void {
  if (watches.has(projectId)) return

  const watcher = chokidar.watch(root, {
    ignored: (target: string) => {
      const base = path.basename(target)
      if (base.startsWith('.') && base !== '.' && base !== '.gitignore' && base !== '.gitkeep') {
        return true
      }
      if (isAuxFile(base)) return true
      const relative = path.relative(root, target)
      if (!relative) return false
      const segments = relative.split(path.sep)
      return segments.some(
        (segment) =>
          segment === 'node_modules' ||
          segment === '.git' ||
          segment === SHEAF_DIR ||
          segment === '__pycache__'
      )
    },
    ignoreInitial: true,
    persistent: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 40 }
  })

  const watch: Watch = { watcher, projectId, pending: new Map(), timer: null }
  watches.set(projectId, watch)

  const push = (type: FileEventType, absolute: string, stats?: { size: number; mtimeMs: number }) => {
    const relative = toPosix(path.relative(root, absolute))
    if (!relative || relative.startsWith('..')) return
    const event: FileEvent = {
      projectId,
      type,
      path: relative,
      kind: type === 'addDir' || type === 'unlinkDir' ? undefined : classifyFile(relative),
      size: stats?.size,
      mtimeMs: stats?.mtimeMs
    }
    // A later event for the same path replaces the earlier one.
    watch.pending.set(`${type}:${relative}`, event)
    if (watch.timer) return
    watch.timer = setTimeout(() => {
      const events = [...watch.pending.values()]
      watch.pending.clear()
      watch.timer = null
      if (events.length > 0) listener?.(events)
    }, DEBOUNCE_MS)
  }

  watcher
    .on('add', (file, stats) => push('add', file, stats && { size: stats.size, mtimeMs: stats.mtimeMs }))
    .on('change', (file, stats) =>
      push('change', file, stats && { size: stats.size, mtimeMs: stats.mtimeMs })
    )
    .on('unlink', (file) => push('unlink', file))
    .on('addDir', (dir) => push('addDir', dir))
    .on('unlinkDir', (dir) => push('unlinkDir', dir))
    .on('error', (error) => {
      console.error('[sheaf] watcher error', error)
    })
}

export async function unwatchProject(projectId: string): Promise<void> {
  const watch = watches.get(projectId)
  if (!watch) return
  if (watch.timer) clearTimeout(watch.timer)
  watches.delete(projectId)
  await watch.watcher.close()
}

export async function unwatchAll(): Promise<void> {
  await Promise.all([...watches.keys()].map((projectId) => unwatchProject(projectId)))
}
