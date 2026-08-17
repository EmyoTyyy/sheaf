import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import type { LatexEnvironment, LatexTool } from '@shared/types'
import { getSettings } from './settings-service'

/** Tools Sheaf knows how to use. Order matters for distribution detection. */
export const KNOWN_TOOLS = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'latexmk',
  'tectonic',
  'biber',
  'bibtex',
  'makeindex',
  'synctex',
  'kpsewhich'
] as const

export type ToolName = (typeof KNOWN_TOOLS)[number]

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : ''

/**
 * Directories probed in addition to PATH. These are the documented install
 * locations of TeX Live and MiKTeX, not hard-coded compiler paths: whatever is
 * found here is still verified by executing it.
 */
function standardDirectories(): string[] {
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return [
        '/Library/TeX/texbin',
        '/usr/texbin',
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/local/texlive/*/bin/*',
        path.join(home, 'Library/TinyTeX/bin/*'),
        path.join(home, '.TinyTeX/bin/*')
      ]
    case 'win32': {
      const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
      const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
      const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
      return [
        'C:\\texlive\\*\\bin\\*',
        path.join(programFiles, 'MiKTeX', 'miktex', 'bin', 'x64'),
        path.join(programFiles, 'MiKTeX 2.9', 'miktex', 'bin', 'x64'),
        path.join(programFilesX86, 'MiKTeX', 'miktex', 'bin'),
        path.join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
        path.join(home, 'AppData', 'Local', 'Programs', 'MiKTeX 2.9', 'miktex', 'bin', 'x64')
      ]
    }
    default:
      return [
        '/usr/bin',
        '/usr/local/bin',
        '/usr/local/texlive/*/bin/*',
        '/opt/texlive/*/bin/*',
        '/opt/texbin',
        '/snap/bin',
        path.join(home, '.TinyTeX/bin/*'),
        path.join(home, 'bin'),
        path.join(home, '.local/bin')
      ]
  }
}

/** Expands the single-level '*' segments used in the candidate list. */
async function expandDirectory(pattern: string): Promise<string[]> {
  if (!pattern.includes('*')) return [pattern]
  const segments = pattern.split(path.sep === '\\' ? /[\\/]/ : '/')
  let roots = [segments[0] === '' ? path.sep : segments[0]]
  for (const segment of segments.slice(1)) {
    if (segment === '') continue
    const next: string[] = []
    for (const root of roots) {
      if (segment === '*') {
        const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          if (entry.isDirectory()) next.push(path.join(root, entry.name))
        }
      } else {
        next.push(path.join(root, segment))
      }
    }
    roots = next
    if (roots.length === 0) break
  }
  return roots
}

async function candidateDirectories(): Promise<string[]> {
  const settings = await getSettings()
  const dirs: string[] = []

  if (settings.latex.texBinDirectory.trim()) {
    dirs.push(settings.latex.texBinDirectory.trim())
  }

  const pathVar = process.env.PATH ?? ''
  dirs.push(...pathVar.split(path.delimiter).filter(Boolean))

  for (const pattern of standardDirectories()) {
    dirs.push(...(await expandDirectory(pattern)))
  }

  return [...new Set(dirs)]
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    await fs.access(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function runVersion(executable: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      executable,
      ['--version'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 256 },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          resolve(null)
          return
        }
        const output = (stdout || stderr || '').trim()
        resolve(output || null)
      }
    )
  })
}

function parseVersion(raw: string | null): string | null {
  if (!raw) return null
  const firstLine = raw.split(/\r?\n/)[0].trim()
  return firstLine.length > 160 ? firstLine.slice(0, 157) + '...' : firstLine
}

function parseDistribution(versionOutputs: string[]): string | null {
  const joined = versionOutputs.join('\n')
  const texlive = joined.match(/TeX Live (\d{4})/)
  if (texlive) return `TeX Live ${texlive[1]}`
  const miktex = joined.match(/MiKTeX[- ]([\d.]+)/i)
  if (miktex) return `MiKTeX ${miktex[1]}`
  if (/tectonic/i.test(joined)) return 'Tectonic'
  if (/TeX Live/i.test(joined)) return 'TeX Live'
  if (/MiKTeX/i.test(joined)) return 'MiKTeX'
  return null
}

let cached: LatexEnvironment | null = null
let inFlight: Promise<LatexEnvironment> | null = null

export async function detectLatex(force = false): Promise<LatexEnvironment> {
  if (!force && cached) return cached
  if (inFlight) return inFlight

  inFlight = (async () => {
    const settings = await getSettings()
    const directories = await candidateDirectories()
    const tools: Record<string, LatexTool> = {}
    const versionOutputs: string[] = []

    for (const name of KNOWN_TOOLS) {
      const override = settings.latex.toolPaths[name]?.trim()
      let resolved: string | null = null

      if (override) {
        resolved = (await isExecutable(override)) ? override : null
      } else {
        for (const dir of directories) {
          const candidate = path.join(dir, `${name}${EXE_SUFFIX}`)
          if (await isExecutable(candidate)) {
            resolved = candidate
            break
          }
        }
      }

      if (!resolved) continue

      const rawVersion = await runVersion(resolved)
      if (rawVersion) versionOutputs.push(rawVersion)
      tools[name] = { name, path: resolved, version: parseVersion(rawVersion) }
    }

    const engines = ['pdflatex', 'xelatex', 'lualatex', 'tectonic']
    const environment: LatexEnvironment = {
      detected: engines.some((engine) => engine in tools),
      distribution: parseDistribution(versionOutputs),
      tools,
      searchedPaths: directories
    }
    cached = environment
    inFlight = null
    return environment
  })()

  return inFlight
}

export function invalidateLatexCache(): void {
  cached = null
}

export async function getTool(name: ToolName): Promise<LatexTool | null> {
  const environment = await detectLatex()
  return environment.tools[name] ?? null
}
