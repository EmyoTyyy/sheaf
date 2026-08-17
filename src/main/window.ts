import path from 'node:path'
import { BrowserWindow, Menu, app, session, shell } from 'electron'
import { buildApplicationMenu } from './menu'

let mainWindow: BrowserWindow | null = null

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function applySecurityPolicy(): void {
  // Only in packaged builds: the dev server needs inline scripts and a socket.
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    })
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  applySecurityPolicy()

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#16181c',
    title: 'Sheaf',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Enables Chromium's built-in PDF viewer, used when a .pdf asset from
      // the project is opened in a preview tab.
      plugins: true
    }
  })

  mainWindow = window
  Menu.setApplicationMenu(buildApplicationMenu())

  window.once('ready-to-show', () => {
    window.show()
  })

  // Never let the renderer navigate away from the application itself.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const devUrl = process.env.ELECTRON_RENDERER_URL
    const isDevServer = devUrl ? url.startsWith(devUrl) : false
    if (target.protocol !== 'file:' && !isDevServer) {
      event.preventDefault()
    }
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // In development, renderer warnings and errors are easy to miss inside the
  // window, so they are mirrored to the terminal.
  if (!app.isPackaged) {
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level < 2) return
      const label = level === 2 ? 'warn' : 'error'
      console.log(`[renderer:${label}] ${message} (${sourceId}:${line})`)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[sheaf] renderer process gone:', details.reason)
    })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    window.loadURL(rendererUrl)
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}
