import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import type { DefaultAppStatus } from '@shared/types'
import { run } from './process-runner'

/** MIME types Sheaf can claim on Linux. */
export const LATEX_MIME_TYPES = [
  'text/x-tex',
  'text/x-latex',
  'application/x-tex',
  'application/x-latex',
  'text/x-bibtex'
]

export const LATEX_EXTENSIONS = ['.tex', '.bib', '.sty', '.cls', '.ltx', '.latex']

const DESKTOP_FILE_NAME = 'sheaf.desktop'

function desktopFilePath(): string {
  return path.join(os.homedir(), '.local', 'share', 'applications', DESKTOP_FILE_NAME)
}

/**
 * The command the desktop entry should run. In a packaged build this is the
 * AppImage or installed binary; during development it is the Electron binary
 * plus the project directory, which still works for testing the integration.
 */
function launchCommand(): string {
  const appImage = process.env.APPIMAGE
  if (appImage) return `"${appImage}" %F`
  if (app.isPackaged) return `"${process.execPath}" %F`
  return `"${process.execPath}" "${app.getAppPath()}" %F`
}

async function writeDesktopEntry(): Promise<string> {
  const target = desktopFilePath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const contents = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Sheaf',
    'GenericName=LaTeX Editor',
    'Comment=Local-first LaTeX editor',
    `Exec=${launchCommand()}`,
    'Icon=sheaf',
    'Terminal=false',
    'Categories=Office;Publishing;TextEditor;Development;',
    `MimeType=${LATEX_MIME_TYPES.join(';')};`,
    'StartupWMClass=Sheaf',
    'StartupNotify=true',
    ''
  ].join('\n')
  await fs.writeFile(target, contents, 'utf8')
  await fs.chmod(target, 0o755).catch(() => undefined)
  return target
}

async function xdgQueryDefault(mime: string): Promise<string | null> {
  const result = await run('xdg-mime', ['query', 'default', mime], {
    cwd: os.homedir(),
    timeoutMs: 5000
  })
  if (result.spawnError || result.exitCode !== 0) return null
  return result.stdout.trim() || null
}

export async function getDefaultAppStatus(): Promise<DefaultAppStatus> {
  if (process.platform === 'linux') {
    const current = await xdgQueryDefault('text/x-tex')
    if (current === null) {
      return {
        supported: false,
        isDefault: false,
        extensions: LATEX_EXTENSIONS,
        detail:
          'xdg-mime is not available on this system, so Sheaf cannot register itself automatically.'
      }
    }
    return {
      supported: true,
      isDefault: current === DESKTOP_FILE_NAME,
      extensions: LATEX_EXTENSIONS,
      detail: current
        ? `.tex files currently open with ${current.replace(/\.desktop$/, '')}.`
        : 'No application is registered for .tex files yet.'
    }
  }

  if (process.platform === 'win32') {
    return {
      supported: false,
      isDefault: false,
      extensions: LATEX_EXTENSIONS,
      detail:
        'On Windows the file associations are registered by the Sheaf installer. Re-run it, or use "Open with > Choose another app" and tick "Always use this app".'
    }
  }

  return {
    supported: false,
    isDefault: false,
    extensions: LATEX_EXTENSIONS,
    detail:
      'On macOS the document types are declared in the application bundle. Select a .tex file in Finder, press Command-I, choose Sheaf under "Open with" and click "Change All".'
  }
}

export interface SetDefaultResult {
  changed: string[]
  failed: string[]
  desktopFile: string | null
}

/** Registers Sheaf as the handler for LaTeX MIME types on Linux. */
export async function setAsDefaultApplication(): Promise<SetDefaultResult> {
  if (process.platform !== 'linux') {
    return { changed: [], failed: [], desktopFile: null }
  }

  const desktopFile = await writeDesktopEntry()
  const applicationsDir = path.dirname(desktopFile)

  await run('update-desktop-database', [applicationsDir], {
    cwd: os.homedir(),
    timeoutMs: 10_000
  })

  const changed: string[] = []
  const failed: string[] = []

  for (const mime of LATEX_MIME_TYPES) {
    const result = await run('xdg-mime', ['default', DESKTOP_FILE_NAME, mime], {
      cwd: os.homedir(),
      timeoutMs: 5000
    })
    if (!result.spawnError && result.exitCode === 0) changed.push(mime)
    else failed.push(mime)
  }

  return { changed, failed, desktopFile }
}
