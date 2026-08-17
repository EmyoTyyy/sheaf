import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { EVENTS, IPC } from '@shared/ipc'
import type { BuildResult, FileEvent, ProjectIndex, SearchQuery, Settings } from '@shared/types'
import type { DeepPartial } from '@shared/types'
import { guard } from './services/errors'
import * as fsService from './services/fs-service'
import * as gitService from './services/git-service'
import * as projectService from './services/project-service'
import * as searchService from './services/search-service'
import * as synctexService from './services/synctex-service'
import * as terminalService from './services/terminal-service'
import * as watcherService from './services/watcher-service'
import * as archiveService from './services/archive-service'
import * as osIntegration from './services/os-integration'
import { build, cancelBuild, cleanBuild, readPdf } from './services/latex-compile'
import { detectLatex, invalidateLatexCache } from './services/latex-detect'
import {
  buildProjectIndex,
  dropProjectIndex,
  getProjectIndex,
  invalidateProjectIndex
} from './services/index-service'
import { getSettings, resetSettings, updateSettings } from './services/settings-service'
import { TEMPLATES } from './services/templates'

/* ------------------------------------------------------------------ */
/* Event broadcasting                                                  */
/* ------------------------------------------------------------------ */

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/* ------------------------------------------------------------------ */
/* Index refresh scheduling                                            */
/* ------------------------------------------------------------------ */

const indexTimers = new Map<string, NodeJS.Timeout>()

function scheduleIndexRefresh(projectId: string, delay = 400): void {
  const existing = indexTimers.get(projectId)
  if (existing) clearTimeout(existing)
  indexTimers.set(
    projectId,
    setTimeout(() => {
      indexTimers.delete(projectId)
      buildProjectIndex(projectId)
        .then((index: ProjectIndex) => broadcast(EVENTS.indexUpdated, index))
        .catch(() => undefined)
    }, delay)
  )
}

function handleFileEvents(events: FileEvent[]): void {
  broadcast(EVENTS.fileEvent, events)

  const touched = new Set<string>()
  for (const event of events) {
    const extension = path.extname(event.path).toLowerCase()
    if (['.tex', '.bib', '.ltx', '.latex', '.sty', '.cls'].includes(extension)) {
      invalidateProjectIndex(event.projectId, event.path)
      touched.add(event.projectId)
    }
    broadcast(EVENTS.gitChanged, { projectId: event.projectId })
  }
  for (const projectId of touched) scheduleIndexRefresh(projectId)
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function registerIpcHandlers(): void {
  watcherService.setFileEventListener(handleFileEvents)

  /* ---------------- system ---------------- */

  ipcMain.handle(IPC.system.info, () => ({
    platform: process.platform,
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    homeDirectory: app.getPath('home'),
    isPackaged: app.isPackaged
  }))

  ipcMain.handle(
    IPC.system.showItemInFolder,
    guard(async (_event, absolutePath: string) => {
      shell.showItemInFolder(absolutePath)
    })
  )

  ipcMain.handle(
    IPC.system.openPath,
    guard(async (_event, absolutePath: string) => {
      await shell.openPath(absolutePath)
    })
  )

  ipcMain.handle(
    IPC.system.openExternal,
    guard(async (_event, url: string) => {
      // Only ever open real web links, never arbitrary schemes.
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Refusing to open ${parsed.protocol} links.`)
      }
      await shell.openExternal(url)
    })
  )

  /* ---------------- settings ---------------- */

  ipcMain.handle(
    IPC.settings.get,
    guard(async () => getSettings())
  )

  ipcMain.handle(
    IPC.settings.update,
    guard(async (_event, patch: DeepPartial<Settings>) => {
      const next = await updateSettings(patch)
      if (patch.latex?.texBinDirectory !== undefined || patch.latex?.toolPaths !== undefined) {
        invalidateLatexCache()
      }
      broadcast(EVENTS.settingsChanged, next)
      return next
    })
  )

  ipcMain.handle(
    IPC.settings.reset,
    guard(async () => {
      const next = await resetSettings()
      invalidateLatexCache()
      broadcast(EVENTS.settingsChanged, next)
      return next
    })
  )

  /* ---------------- projects ---------------- */

  ipcMain.handle(
    IPC.projects.listRecent,
    guard(async () => projectService.listRecentProjects())
  )

  ipcMain.handle(
    IPC.projects.templates,
    guard(async () => TEMPLATES)
  )

  ipcMain.handle(
    IPC.projects.create,
    guard(async (_event, options: Parameters<typeof projectService.createProject>[0]) => {
      const project = await projectService.createProject(options)
      afterOpen(project.ref.id, project.ref.path)
      return project
    })
  )

  ipcMain.handle(
    IPC.projects.open,
    guard(async (_event, absolutePath: string) => {
      const project = await projectService.openProject(absolutePath)
      afterOpen(project.ref.id, project.ref.path)
      return project
    })
  )

  ipcMain.handle(
    IPC.projects.openDialog,
    guard(async () => {
      const window = focusedWindow()
      const result = window
        ? await dialog.showOpenDialog(window, {
            title: 'Open LaTeX project',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) return null
      const project = await projectService.openProject(result.filePaths[0])
      afterOpen(project.ref.id, project.ref.path)
      return project
    })
  )

  ipcMain.handle(
    IPC.projects.close,
    guard(async (_event, projectId: string) => {
      await watcherService.unwatchProject(projectId)
      terminalService.killProjectSessions(projectId)
      cancelBuild(projectId)
      dropProjectIndex(projectId)
      projectService.forgetOpenProject(projectId)
    })
  )

  ipcMain.handle(
    IPC.projects.rename,
    guard(async (_event, projectId: string, name: string) => {
      await watcherService.unwatchProject(projectId)
      const ref = await projectService.renameProject(projectId, name)
      afterOpen(ref.id, ref.path)
      return ref
    })
  )

  ipcMain.handle(
    IPC.projects.duplicate,
    guard(async (_event, projectId: string, name?: string) =>
      projectService.duplicateProject(projectId, name)
    )
  )

  ipcMain.handle(
    IPC.projects.remove,
    guard(async (_event, projectId: string, permanent: boolean) => {
      await watcherService.unwatchProject(projectId)
      terminalService.killProjectSessions(projectId)
      dropProjectIndex(projectId)
      await projectService.deleteProject({ projectId, permanent })
    })
  )

  ipcMain.handle(
    IPC.projects.forget,
    guard(async (_event, projectId: string) => {
      await watcherService.unwatchProject(projectId)
      await projectService.forgetProject(projectId)
    })
  )

  ipcMain.handle(
    IPC.projects.importZip,
    guard(async () => {
      const window = focusedWindow()
      const picked = await dialog.showOpenDialog(window!, {
        title: 'Import LaTeX project from ZIP',
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) return null

      const settings = await getSettings()
      const destination = await archiveService.importProjectZip(
        picked.filePaths[0],
        settings.app.projectsDirectory
      )
      const project = await projectService.openProject(destination)
      afterOpen(project.ref.id, project.ref.path)
      return project
    })
  )

  ipcMain.handle(
    IPC.projects.exportZip,
    guard(async (_event, projectId: string) => {
      const ref = projectService.getOpenProject(projectId)
      const window = focusedWindow()
      const picked = await dialog.showSaveDialog(window!, {
        title: 'Export project as ZIP',
        defaultPath: path.join(app.getPath('downloads'), `${ref.name}.zip`),
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
      })
      if (picked.canceled || !picked.filePath) return null
      return archiveService.exportProjectZip(ref.path, picked.filePath)
    })
  )

  ipcMain.handle(
    IPC.projects.exportPdf,
    guard(async (_event, projectId: string) => {
      const ref = projectService.getOpenProject(projectId)
      const settings = await projectService.readProjectSettings(ref.path)
      const window = focusedWindow()
      const picked = await dialog.showSaveDialog(window!, {
        title: 'Export PDF',
        defaultPath: path.join(app.getPath('downloads'), `${ref.name}.pdf`),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      })
      if (picked.canceled || !picked.filePath) return null
      return archiveService.exportPdf(ref.path, settings, picked.filePath)
    })
  )

  ipcMain.handle(
    IPC.projects.getSettings,
    guard(async (_event, projectId: string) => {
      const ref = projectService.getOpenProject(projectId)
      return projectService.readProjectSettings(ref.path)
    })
  )

  ipcMain.handle(
    IPC.projects.updateSettings,
    guard(async (_event, projectId: string, patch: DeepPartial<Settings>) => {
      const next = await projectService.updateProjectSettings(projectId, patch as never)
      scheduleIndexRefresh(projectId, 50)
      return next
    })
  )

  ipcMain.handle(
    IPC.projects.detectRoot,
    guard(async (_event, filePath: string) => projectService.detectProjectRoot(filePath))
  )

  /* ---------------- filesystem ---------------- */

  const withRoot = <T>(projectId: string, fn: (root: string) => Promise<T> | T): Promise<T> => {
    const ref = projectService.getOpenProject(projectId)
    return Promise.resolve(fn(ref.path))
  }

  ipcMain.handle(
    IPC.fs.readTree,
    guard(async (_event, projectId: string) => withRoot(projectId, fsService.readTree))
  )

  ipcMain.handle(
    IPC.fs.readFile,
    guard(async (_event, projectId: string, file: string) =>
      withRoot(projectId, (root) => fsService.readTextFile(root, file))
    )
  )

  ipcMain.handle(
    IPC.fs.readBinary,
    guard(async (_event, projectId: string, file: string) =>
      withRoot(projectId, (root) => fsService.readBinaryFile(root, file))
    )
  )

  ipcMain.handle(
    IPC.fs.writeFile,
    guard(
      async (
        _event,
        projectId: string,
        file: string,
        content: string,
        expectedMtimeMs: number | null
      ) =>
        withRoot(projectId, async (root) => {
          const result = await fsService.writeTextFile(root, file, content, expectedMtimeMs)
          invalidateProjectIndex(projectId, file)
          scheduleIndexRefresh(projectId)
          return result
        })
    )
  )

  ipcMain.handle(
    IPC.fs.createFile,
    guard(async (_event, projectId: string, parent: string, name: string, content: string) =>
      withRoot(projectId, (root) => fsService.createFile(root, parent, name, content))
    )
  )

  ipcMain.handle(
    IPC.fs.createDirectory,
    guard(async (_event, projectId: string, parent: string, name: string) =>
      withRoot(projectId, (root) => fsService.createDirectory(root, parent, name))
    )
  )

  ipcMain.handle(
    IPC.fs.rename,
    guard(async (_event, projectId: string, file: string, newName: string) =>
      withRoot(projectId, async (root) => {
        const next = await fsService.renameEntry(root, file, newName)
        invalidateProjectIndex(projectId)
        scheduleIndexRefresh(projectId)
        return next
      })
    )
  )

  ipcMain.handle(
    IPC.fs.move,
    guard(async (_event, projectId: string, file: string, targetDirectory: string) =>
      withRoot(projectId, async (root) => {
        const next = await fsService.moveEntry(root, file, targetDirectory)
        invalidateProjectIndex(projectId)
        scheduleIndexRefresh(projectId)
        return next
      })
    )
  )

  ipcMain.handle(
    IPC.fs.remove,
    guard(async (_event, projectId: string, file: string) =>
      withRoot(projectId, async (root) => {
        await fsService.removeEntry(root, file)
        invalidateProjectIndex(projectId, file)
        scheduleIndexRefresh(projectId)
      })
    )
  )

  ipcMain.handle(
    IPC.fs.importFiles,
    guard(async (_event, projectId: string, targetDirectory: string) =>
      withRoot(projectId, async (root) => {
        const window = focusedWindow()
        const picked = await dialog.showOpenDialog(window!, {
          title: 'Add files to the project',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: 'LaTeX project files',
              extensions: [
                'tex', 'bib', 'sty', 'cls', 'bst',
                'png', 'jpg', 'jpeg', 'gif', 'svg', 'eps', 'pdf',
                'csv', 'txt', 'md'
              ]
            },
            { name: 'All files', extensions: ['*'] }
          ]
        })
        if (picked.canceled || picked.filePaths.length === 0) return []
        return fsService.importExternalFiles(root, targetDirectory, picked.filePaths)
      })
    )
  )

  ipcMain.handle(
    IPC.fs.importExternal,
    guard(async (_event, projectId: string, targetDirectory: string, paths: string[]) =>
      withRoot(projectId, (root) => fsService.importExternalFiles(root, targetDirectory, paths))
    )
  )

  /* ---------------- LaTeX ---------------- */

  ipcMain.handle(
    IPC.latex.detect,
    guard(async (_event, force: boolean) => {
      if (force) invalidateLatexCache()
      return detectLatex(force)
    })
  )

  ipcMain.handle(
    IPC.latex.build,
    guard(async (_event, projectId: string) => {
      const ref = projectService.getOpenProject(projectId)
      const settings = await projectService.readProjectSettings(ref.path)
      const result: BuildResult = await build({
        projectId,
        root: ref.path,
        settings,
        onProgress: (progress) => broadcast(EVENTS.buildProgress, progress)
      })
      broadcast(EVENTS.buildResult, { ...result, projectId })
      return result
    })
  )

  ipcMain.handle(
    IPC.latex.cancel,
    guard(async (_event, projectId: string) => cancelBuild(projectId))
  )

  ipcMain.handle(
    IPC.latex.readPdf,
    guard(async (_event, projectId: string) => {
      const ref = projectService.getOpenProject(projectId)
      const settings = await projectService.readProjectSettings(ref.path)
      return readPdf(ref.path, settings)
    })
  )

  ipcMain.handle(
    IPC.latex.clean,
    guard(async (_event, projectId: string) => {
      const ref = projectService.getOpenProject(projectId)
      const settings = await projectService.readProjectSettings(ref.path)
      return cleanBuild(ref.path, settings)
    })
  )

  /* ---------------- index ---------------- */

  ipcMain.handle(
    IPC.index.get,
    guard(async (_event, projectId: string) => getProjectIndex(projectId))
  )

  ipcMain.handle(
    IPC.index.refresh,
    guard(async (_event, projectId: string) => {
      invalidateProjectIndex(projectId)
      const index = await buildProjectIndex(projectId)
      broadcast(EVENTS.indexUpdated, index)
      return index
    })
  )

  /* ---------------- search ---------------- */

  ipcMain.handle(
    IPC.search.run,
    guard(async (_event, projectId: string, query: SearchQuery) =>
      withRoot(projectId, (root) => searchService.searchProject(root, query))
    )
  )

  ipcMain.handle(
    IPC.search.cancel,
    guard(async () => searchService.cancelSearch())
  )

  /* ---------------- SyncTeX ---------------- */

  ipcMain.handle(
    IPC.sync.forward,
    guard(async (_event, projectId: string, file: string, line: number, column: number) => {
      const ref = projectService.getOpenProject(projectId)
      const settings = await projectService.readProjectSettings(ref.path)
      return synctexService.forwardSearch(ref.path, settings, file, line, column)
    })
  )

  ipcMain.handle(
    IPC.sync.inverse,
    guard(async (_event, projectId: string, page: number, x: number, y: number) => {
      const ref = projectService.getOpenProject(projectId)
      const settings = await projectService.readProjectSettings(ref.path)
      return synctexService.inverseSearch(ref.path, settings, page, x, y)
    })
  )

  /* ---------------- git ---------------- */

  ipcMain.handle(
    IPC.git.status,
    guard(async (_event, projectId: string) => withRoot(projectId, gitService.getStatus))
  )

  ipcMain.handle(
    IPC.git.diff,
    guard(async (_event, projectId: string, file: string, staged: boolean) =>
      withRoot(projectId, (root) => gitService.getDiff(root, file, staged))
    )
  )

  ipcMain.handle(
    IPC.git.stage,
    guard(async (_event, projectId: string, paths: string[]) =>
      withRoot(projectId, async (root) => {
        await gitService.stage(root, paths)
        broadcast(EVENTS.gitChanged, { projectId })
      })
    )
  )

  ipcMain.handle(
    IPC.git.unstage,
    guard(async (_event, projectId: string, paths: string[]) =>
      withRoot(projectId, async (root) => {
        await gitService.unstage(root, paths)
        broadcast(EVENTS.gitChanged, { projectId })
      })
    )
  )

  ipcMain.handle(
    IPC.git.commit,
    guard(async (_event, projectId: string, message: string) =>
      withRoot(projectId, async (root) => {
        const output = await gitService.commit(root, message)
        broadcast(EVENTS.gitChanged, { projectId })
        return output
      })
    )
  )

  ipcMain.handle(
    IPC.git.pull,
    guard(async (_event, projectId: string) =>
      withRoot(projectId, async (root) => {
        const output = await gitService.pull(root)
        broadcast(EVENTS.gitChanged, { projectId })
        return output
      })
    )
  )

  ipcMain.handle(
    IPC.git.push,
    guard(async (_event, projectId: string) =>
      withRoot(projectId, async (root) => {
        const output = await gitService.push(root)
        broadcast(EVENTS.gitChanged, { projectId })
        return output
      })
    )
  )

  ipcMain.handle(
    IPC.git.init,
    guard(async (_event, projectId: string) =>
      withRoot(projectId, async (root) => {
        await gitService.init(root)
        broadcast(EVENTS.gitChanged, { projectId })
      })
    )
  )

  ipcMain.handle(
    IPC.git.log,
    guard(async (_event, projectId: string, limit: number) =>
      withRoot(projectId, (root) => gitService.log(root, limit))
    )
  )

  /* ---------------- terminal ---------------- */

  ipcMain.handle(
    IPC.terminal.run,
    guard(async (_event, projectId: string, command: string) =>
      withRoot(projectId, (root) =>
        terminalService.runCommand(projectId, root, command, {
          onData: (chunk) => broadcast(EVENTS.terminalData, chunk),
          onExit: (exit) => broadcast(EVENTS.terminalExit, exit)
        })
      )
    )
  )

  ipcMain.handle(
    IPC.terminal.kill,
    guard(async (_event, sessionId: string) => terminalService.killSession(sessionId))
  )

  /* ---------------- OS integration ---------------- */

  ipcMain.handle(
    IPC.os.defaultAppStatus,
    guard(async () => osIntegration.getDefaultAppStatus())
  )

  ipcMain.handle(
    IPC.os.setAsDefault,
    guard(async () => {
      const result = await osIntegration.setAsDefaultApplication()
      return { changed: result.changed, failed: result.failed }
    })
  )
}

/** Starts watching and indexing a project that has just been opened. */
function afterOpen(projectId: string, root: string): void {
  watcherService.watchProject(projectId, root)
  scheduleIndexRefresh(projectId, 30)
}
