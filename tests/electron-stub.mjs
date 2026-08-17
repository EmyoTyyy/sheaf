/**
 * Minimal stand-in for the Electron module so the main-process services can be
 * exercised outside of a running Electron application.
 */
import os from 'node:os'
import path from 'node:path'

// Resolved on each call: tests point it at a fresh directory as they run.
const userData = () => process.env.SHEAF_TEST_USERDATA ?? path.join(os.tmpdir(), 'sheaf-test-userdata')

export const app = {
  getPath: (name) => {
    if (name === 'userData') return userData()
    if (name === 'home') return os.homedir()
    if (name === 'downloads') return path.join(os.homedir(), 'Downloads')
    return os.tmpdir()
  },
  getVersion: () => '0.0.0-test',
  getName: () => 'Sheaf',
  getAppPath: () => process.cwd(),
  isPackaged: false,
  on: () => undefined,
  whenReady: () => Promise.resolve(),
  quit: () => undefined,
  requestSingleInstanceLock: () => true
}

export const shell = {
  trashItem: async () => undefined,
  showItemInFolder: () => undefined,
  openPath: async () => '',
  openExternal: async () => undefined
}

export const ipcMain = { handle: () => undefined, on: () => undefined }
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined })
}
export const BrowserWindow = {
  getAllWindows: () => [],
  getFocusedWindow: () => undefined
}
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: () => undefined }
export const session = { defaultSession: { webRequest: { onHeadersReceived: () => undefined } } }

export default { app, shell, ipcMain, dialog, BrowserWindow, Menu, session }
