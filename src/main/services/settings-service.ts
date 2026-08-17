import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import type { ProjectSettings, Settings } from '@shared/types'
import { JsonStore, deepMerge, type DeepPartial } from './json-store'
import { DEFAULT_OUTPUT_DIR } from './paths'

export const DEFAULT_FIGURE_TEMPLATE = [
  '\\begin{figure}[ht]',
  '    \\centering',
  '    \\includegraphics[width=0.8\\textwidth]{${path}}',
  '    \\caption{${caption}}',
  '    \\label{fig:${label}}',
  '\\end{figure}'
].join('\n')

export const DEFAULT_SETTINGS: Settings = {
  editor: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', Menlo, Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.5,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
    renderWhitespace: false,
    bracketPairColorization: true,
    autoClosingBrackets: true
  },
  latex: {
    defaultCompiler: 'pdflatex',
    texBinDirectory: '',
    toolPaths: {},
    autoCompile: false,
    autoCompileDelayMs: 1500,
    compileTimeoutMs: 120_000,
    bibTool: 'auto',
    outputDirectory: DEFAULT_OUTPUT_DIR,
    maxPasses: 3
  },
  pdf: {
    zoomBehavior: 'fit-width',
    position: 'right',
    autoRefresh: true,
    highlightSync: true,
    invertInDarkMode: false
  },
  app: {
    theme: 'system',
    autosave: 'afterDelay',
    autosaveDelayMs: 1000,
    projectsDirectory: path.join(os.homedir(), 'Documents', 'Sheaf Projects'),
    restoreLastProject: true,
    figureTemplate: DEFAULT_FIGURE_TEMPLATE
  },
  keybindings: {}
}

let store: JsonStore<Settings> | null = null

function getStore(): JsonStore<Settings> {
  if (!store) {
    store = new JsonStore<Settings>(
      path.join(app.getPath('userData'), 'settings.json'),
      DEFAULT_SETTINGS
    )
  }
  return store
}

export async function getSettings(): Promise<Settings> {
  return getStore().read()
}

export async function updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const store = getStore()
  const merged = deepMerge(await store.read(), patch)
  // Keybindings are replaced rather than merged: merging would make it
  // impossible to remove an override once it had been written.
  if (patch.keybindings) {
    merged.keybindings = { ...(patch.keybindings as Record<string, string>) }
  }
  return store.write(merged)
}

export async function resetSettings(): Promise<Settings> {
  return getStore().reset()
}

/** Project settings inherit from the application defaults at creation time. */
export function defaultProjectSettings(settings: Settings): ProjectSettings {
  return {
    mainDocument: null,
    compiler: settings.latex.defaultCompiler,
    extraArgs: [],
    bibTool: settings.latex.bibTool,
    outputDirectory: settings.latex.outputDirectory,
    autoCompile: settings.latex.autoCompile,
    autoCompileDelayMs: settings.latex.autoCompileDelayMs,
    compileTimeoutMs: settings.latex.compileTimeoutMs,
    maxPasses: settings.latex.maxPasses,
    figureTemplate: settings.app.figureTemplate
  }
}
