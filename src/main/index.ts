import path from 'node:path'
import fs from 'node:fs'
import { BrowserWindow, app } from 'electron'
import { EVENTS } from '@shared/ipc'
import type { OpenFileRequest } from '@shared/types'
import { registerIpcHandlers } from './ipc'
import { createMainWindow, getMainWindow } from './window'
import { detectProjectRoot } from './services/project-service'
import { killAllSessions } from './services/terminal-service'
import { unwatchAll } from './services/watcher-service'

/** Extensions Sheaf will open when handed a file by the operating system. */
const OPENABLE_EXTENSIONS = new Set([
  '.tex',
  '.ltx',
  '.latex',
  '.bib',
  '.sty',
  '.cls',
  '.bst',
  '.txt',
  '.md'
])

/** Files handed to us before the window was ready to receive them. */
const pendingFiles: string[] = []
let rendererReady = false

function isOpenableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate)
    if (stat.isDirectory()) return true
    return OPENABLE_EXTENSIONS.has(path.extname(candidate).toLowerCase())
  } catch {
    return false
  }
}

/**
 * Extracts file paths from a command line. Electron passes its own switches in
 * argv, and in development the application directory is an argument too.
 */
export function filePathsFromArgv(argv: string[], packaged: boolean): string[] {
  const args = argv.slice(packaged ? 1 : 2)
  const files: string[] = []
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue
    const resolved = path.resolve(arg)
    if (isOpenableFile(resolved)) files.push(resolved)
  }
  return files
}

async function deliverFile(filePath: string): Promise<void> {
  const window = getMainWindow()
  if (!window || !rendererReady) {
    pendingFiles.push(filePath)
    return
  }
  const projectPath = await detectProjectRoot(filePath)
  const payload: OpenFileRequest = { filePath, projectPath }
  window.webContents.send(EVENTS.openFileRequest, payload)
  if (window.isMinimized()) window.restore()
  window.focus()
}

async function flushPendingFiles(): Promise<void> {
  const queued = pendingFiles.splice(0, pendingFiles.length)
  for (const file of queued) {
    await deliverFile(file)
  }
}

/* ------------------------------------------------------------------ */
/* Single instance                                                     */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  // Another Sheaf is already running; it will receive our arguments.
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const window = getMainWindow()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
    for (const file of filePathsFromArgv(argv, app.isPackaged)) {
      void deliverFile(file)
    }
  })

  // macOS delivers files through this event rather than through argv.
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    void deliverFile(filePath)
  })

  app.whenReady().then(() => {
    registerIpcHandlers()
    const window = createMainWindow()

    window.webContents.on('did-finish-load', () => {
      rendererReady = true
      void flushPendingFiles()
    })

    for (const file of filePathsFromArgv(process.argv, app.isPackaged)) {
      pendingFiles.push(file)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    killAllSessions()
    void unwatchAll()
  })
}

// A renderer crash must never take the whole application down silently.
process.on('uncaughtException', (error) => {
  console.error('[sheaf] uncaught exception in main process', error)
})
