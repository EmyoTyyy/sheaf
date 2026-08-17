import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENTS, IPC } from '@shared/ipc'
import type { SheafApi, Unsubscribe } from '@shared/api'

/**
 * The only bridge between the renderer and the operating system. Everything is
 * an explicit, named call; no Node module or raw ipcRenderer handle is exposed.
 */

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: SheafApi = {
  system: {
    info: () => invoke(IPC.system.info),
    showItemInFolder: (absolutePath) => invoke(IPC.system.showItemInFolder, absolutePath),
    openPath: (absolutePath) => invoke(IPC.system.openPath, absolutePath),
    openExternal: (url) => invoke(IPC.system.openExternal, url)
  },

  settings: {
    get: () => invoke(IPC.settings.get),
    update: (patch) => invoke(IPC.settings.update, patch),
    reset: () => invoke(IPC.settings.reset),
    onChanged: (callback) => subscribe(EVENTS.settingsChanged, callback)
  },

  projects: {
    listRecent: () => invoke(IPC.projects.listRecent),
    templates: () => invoke(IPC.projects.templates),
    create: (options) => invoke(IPC.projects.create, options),
    open: (absolutePath) => invoke(IPC.projects.open, absolutePath),
    openDialog: () => invoke(IPC.projects.openDialog),
    close: (projectId) => invoke(IPC.projects.close, projectId),
    rename: (projectId, name) => invoke(IPC.projects.rename, projectId, name),
    duplicate: (projectId, name) => invoke(IPC.projects.duplicate, projectId, name),
    remove: (projectId, permanent) => invoke(IPC.projects.remove, projectId, permanent),
    forget: (projectId) => invoke(IPC.projects.forget, projectId),
    importZip: () => invoke(IPC.projects.importZip),
    exportZip: (projectId) => invoke(IPC.projects.exportZip, projectId),
    exportPdf: (projectId) => invoke(IPC.projects.exportPdf, projectId),
    getSettings: (projectId) => invoke(IPC.projects.getSettings, projectId),
    updateSettings: (projectId, patch) => invoke(IPC.projects.updateSettings, projectId, patch),
    detectRoot: (filePath) => invoke(IPC.projects.detectRoot, filePath)
  },

  fs: {
    readTree: (projectId) => invoke(IPC.fs.readTree, projectId),
    readFile: (projectId, path) => invoke(IPC.fs.readFile, projectId, path),
    readBinary: (projectId, path) => invoke(IPC.fs.readBinary, projectId, path),
    writeFile: (projectId, path, content, expectedMtimeMs) =>
      invoke(IPC.fs.writeFile, projectId, path, content, expectedMtimeMs ?? null),
    createFile: (projectId, parentPath, name, content) =>
      invoke(IPC.fs.createFile, projectId, parentPath, name, content ?? ''),
    createDirectory: (projectId, parentPath, name) =>
      invoke(IPC.fs.createDirectory, projectId, parentPath, name),
    rename: (projectId, path, newName) => invoke(IPC.fs.rename, projectId, path, newName),
    move: (projectId, path, targetDirectory) =>
      invoke(IPC.fs.move, projectId, path, targetDirectory),
    remove: (projectId, path) => invoke(IPC.fs.remove, projectId, path),
    importFiles: (projectId, targetDirectory) =>
      invoke(IPC.fs.importFiles, projectId, targetDirectory),
    importExternal: (projectId, targetDirectory, paths) =>
      invoke(IPC.fs.importExternal, projectId, targetDirectory, paths),
    onFileEvent: (callback) => subscribe(EVENTS.fileEvent, callback)
  },

  latex: {
    detect: (force) => invoke(IPC.latex.detect, force ?? false),
    build: (projectId) => invoke(IPC.latex.build, projectId),
    cancel: (projectId) => invoke(IPC.latex.cancel, projectId),
    readPdf: (projectId) => invoke(IPC.latex.readPdf, projectId),
    clean: (projectId) => invoke(IPC.latex.clean, projectId),
    onProgress: (callback) => subscribe(EVENTS.buildProgress, callback),
    onResult: (callback) => subscribe(EVENTS.buildResult, callback)
  },

  index: {
    get: (projectId) => invoke(IPC.index.get, projectId),
    refresh: (projectId) => invoke(IPC.index.refresh, projectId),
    onUpdated: (callback) => subscribe(EVENTS.indexUpdated, callback)
  },

  search: {
    run: (projectId, query) => invoke(IPC.search.run, projectId, query),
    cancel: () => invoke(IPC.search.cancel)
  },

  sync: {
    forward: (projectId, file, line, column) =>
      invoke(IPC.sync.forward, projectId, file, line, column),
    inverse: (projectId, page, x, y) => invoke(IPC.sync.inverse, projectId, page, x, y)
  },

  git: {
    status: (projectId) => invoke(IPC.git.status, projectId),
    diff: (projectId, path, staged) => invoke(IPC.git.diff, projectId, path, staged),
    stage: (projectId, paths) => invoke(IPC.git.stage, projectId, paths),
    unstage: (projectId, paths) => invoke(IPC.git.unstage, projectId, paths),
    commit: (projectId, message) => invoke(IPC.git.commit, projectId, message),
    pull: (projectId) => invoke(IPC.git.pull, projectId),
    push: (projectId) => invoke(IPC.git.push, projectId),
    init: (projectId) => invoke(IPC.git.init, projectId),
    log: (projectId, limit) => invoke(IPC.git.log, projectId, limit ?? 20),
    onChanged: (callback) => subscribe(EVENTS.gitChanged, callback)
  },

  terminal: {
    run: (projectId, command) => invoke(IPC.terminal.run, projectId, command),
    kill: (sessionId) => invoke(IPC.terminal.kill, sessionId),
    onData: (callback) => subscribe(EVENTS.terminalData, callback),
    onExit: (callback) => subscribe(EVENTS.terminalExit, callback)
  },

  os: {
    defaultAppStatus: () => invoke(IPC.os.defaultAppStatus),
    setAsDefault: () => invoke(IPC.os.setAsDefault),
    onOpenFileRequest: (callback) => subscribe(EVENTS.openFileRequest, callback)
  },

  menu: {
    onCommand: (callback) => subscribe(EVENTS.menuCommand, callback)
  }
}

contextBridge.exposeInMainWorld('sheaf', api)
