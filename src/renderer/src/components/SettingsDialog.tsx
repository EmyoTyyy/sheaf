import { useEffect, useState } from 'react'
import type {
  AutosaveMode,
  BibTool,
  CompilerName,
  DefaultAppStatus,
  PdfPanelPosition,
  ThemePreference,
  ZoomBehavior
} from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { COMMANDS, acceleratorFor, formatAccelerator, isModifierOnly } from '../lib/commands'
import { useBuildStore } from '../state/build-store'
import { useProjectStore } from '../state/project-store'
import { useSettingsStore } from '../state/settings-store'
import { reportError, useUiStore } from '../state/ui-store'
import { Icon } from './common/Icon'
import { Modal } from './common/Modal'
import './SettingsDialog.css'

type Section = 'editor' | 'latex' | 'pdf' | 'app' | 'project' | 'shortcuts'

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'editor', label: 'Editor', icon: 'file-code' },
  { id: 'latex', label: 'LaTeX', icon: 'book' },
  { id: 'pdf', label: 'PDF', icon: 'file-pdf' },
  { id: 'project', label: 'Project', icon: 'folder' },
  { id: 'app', label: 'Application', icon: 'settings' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'outline' }
]

export function SettingsDialog(): JSX.Element | null {
  const open = useUiStore((state) => state.settingsOpen)
  const setOpen = useUiStore((state) => state.setSettingsOpen)
  const [section, setSection] = useState<Section>('editor')

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail
      if (detail) setSection(detail as Section)
    }
    window.addEventListener('sheaf:settings-section', handler)
    return () => window.removeEventListener('sheaf:settings-section', handler)
  }, [])

  if (!open) return null

  return (
    <Modal title="Settings" onClose={() => setOpen(false)} width={840} tall>
      <div className="settings">
        <nav className="settings__nav">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              className={`settings__nav-item${section === entry.id ? ' settings__nav-item--active' : ''}`}
              onClick={() => setSection(entry.id)}
            >
              <Icon name={entry.icon} size={13} />
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="settings__content">
          {section === 'editor' ? <EditorSection /> : null}
          {section === 'latex' ? <LatexSection /> : null}
          {section === 'pdf' ? <PdfSection /> : null}
          {section === 'project' ? <ProjectSection /> : null}
          {section === 'app' ? <ApplicationSection /> : null}
          {section === 'shortcuts' ? <ShortcutsSection /> : null}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

function EditorSection(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  if (!settings) return <div />

  const editor = settings.editor

  return (
    <section>
      <h3>Editor</h3>
      <div className="field-grid">
        <label className="field-grid__label">Font family</label>
        <input
          className="input"
          value={editor.fontFamily}
          onChange={(event) => void update({ editor: { fontFamily: event.target.value } })}
        />

        <label className="field-grid__label">Font size</label>
        <div className="field__row">
          <input
            className="input settings__number"
            type="number"
            min={8}
            max={32}
            value={editor.fontSize}
            onChange={(event) =>
              void update({ editor: { fontSize: Number(event.target.value) || 14 } })
            }
          />
          <span className="settings__unit">px</span>
        </div>

        <label className="field-grid__label">Line height</label>
        <div className="field__row">
          <input
            className="input settings__number"
            type="number"
            min={1}
            max={3}
            step={0.1}
            value={editor.lineHeight}
            onChange={(event) =>
              void update({ editor: { lineHeight: Number(event.target.value) || 1.5 } })
            }
          />
          <span className="settings__unit">x font size</span>
        </div>

        <label className="field-grid__label">Tab size</label>
        <input
          className="input settings__number"
          type="number"
          min={1}
          max={8}
          value={editor.tabSize}
          onChange={(event) => void update({ editor: { tabSize: Number(event.target.value) || 2 } })}
        />

        <label className="field-grid__label">Indentation</label>
        <select
          className="select"
          value={editor.insertSpaces ? 'spaces' : 'tabs'}
          onChange={(event) =>
            void update({ editor: { insertSpaces: event.target.value === 'spaces' } })
          }
        >
          <option value="spaces">Spaces</option>
          <option value="tabs">Tabs</option>
        </select>
      </div>

      <div className="settings__checks">
        <Toggle
          label="Word wrap"
          checked={editor.wordWrap}
          onChange={(value) => void update({ editor: { wordWrap: value } })}
        />
        <Toggle
          label="Minimap"
          checked={editor.minimap}
          onChange={(value) => void update({ editor: { minimap: value } })}
        />
        <Toggle
          label="Line numbers"
          checked={editor.lineNumbers}
          onChange={(value) => void update({ editor: { lineNumbers: value } })}
        />
        <Toggle
          label="Show whitespace"
          checked={editor.renderWhitespace}
          onChange={(value) => void update({ editor: { renderWhitespace: value } })}
        />
        <Toggle
          label="Colour matching brackets"
          checked={editor.bracketPairColorization}
          onChange={(value) => void update({ editor: { bracketPairColorization: value } })}
        />
        <Toggle
          label="Close brackets automatically"
          checked={editor.autoClosingBrackets}
          onChange={(value) => void update({ editor: { autoClosingBrackets: value } })}
        />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function LatexSection(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const latex = useBuildStore((state) => state.latex)
  const detect = useBuildStore((state) => state.detectLatex)
  const [scanning, setScanning] = useState(false)
  const [showPaths, setShowPaths] = useState(false)

  if (!settings) return <div />

  return (
    <section>
      <h3>LaTeX installation</h3>

      <div className={`settings__status${latex?.detected ? '' : ' settings__status--warn'}`}>
        <Icon name={latex?.detected ? 'check' : 'warning'} size={15} />
        <div>
          {latex?.detected ? (
            <>
              <strong>{latex.distribution ?? 'A LaTeX distribution'} was found.</strong>
              <div className="settings__tools">
                {Object.values(latex.tools).map((tool) => (
                  <div key={tool.name} className="settings__tool">
                    <span className="settings__tool-name mono">{tool.name}</span>
                    <span className="settings__tool-path mono truncate" title={tool.path}>
                      {tool.path}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <strong>No LaTeX distribution was detected.</strong>
              <p>
                Install TeX Live, MiKTeX or Tectonic, then rescan. On Debian and Ubuntu:{' '}
                <code className="mono">sudo apt install texlive-latex-recommended</code>. If it is
                already installed somewhere unusual, set the bin directory below.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="field__row settings__row-actions">
        <button
          className="btn"
          disabled={scanning}
          onClick={async () => {
            setScanning(true)
            await detect(true)
            setScanning(false)
          }}
        >
          {scanning ? <span className="spinner" /> : <Icon name="refresh" size={12} />}
          Rescan for LaTeX
        </button>
        <button className="btn btn--ghost" onClick={() => setShowPaths((value) => !value)}>
          {showPaths ? 'Hide' : 'Show'} searched locations
        </button>
      </div>

      {showPaths ? (
        <pre className="settings__paths mono">{latex?.searchedPaths.join('\n')}</pre>
      ) : null}

      <h3>Defaults for new projects</h3>
      <div className="field-grid">
        <label className="field-grid__label">Compiler</label>
        <select
          className="select"
          value={settings.latex.defaultCompiler}
          onChange={(event) =>
            void update({ latex: { defaultCompiler: event.target.value as CompilerName } })
          }
        >
          {(['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'tectonic'] as CompilerName[]).map(
            (compiler) => (
              <option key={compiler} value={compiler}>
                {compiler}
              </option>
            )
          )}
        </select>

        <label className="field-grid__label">TeX bin directory</label>
        <input
          className="input mono"
          placeholder="Leave empty to search PATH and standard locations"
          value={settings.latex.texBinDirectory}
          onChange={(event) => void update({ latex: { texBinDirectory: event.target.value } })}
        />

        <label className="field-grid__label">Bibliography tool</label>
        <select
          className="select"
          value={settings.latex.bibTool}
          onChange={(event) => void update({ latex: { bibTool: event.target.value as BibTool } })}
        >
          <option value="auto">Automatic (biber when the document needs it)</option>
          <option value="biber">Always biber</option>
          <option value="bibtex">Always bibtex</option>
          <option value="none">Never run a bibliography tool</option>
        </select>

        <label className="field-grid__label">Build output directory</label>
        <input
          className="input mono"
          value={settings.latex.outputDirectory}
          onChange={(event) => void update({ latex: { outputDirectory: event.target.value } })}
        />

        <label className="field-grid__label">Compile timeout</label>
        <div className="field__row">
          <input
            className="input settings__number"
            type="number"
            min={5}
            max={1800}
            value={Math.round(settings.latex.compileTimeoutMs / 1000)}
            onChange={(event) =>
              void update({ latex: { compileTimeoutMs: (Number(event.target.value) || 120) * 1000 } })
            }
          />
          <span className="settings__unit">seconds</span>
        </div>

        <label className="field-grid__label">Maximum passes</label>
        <input
          className="input settings__number"
          type="number"
          min={1}
          max={8}
          value={settings.latex.maxPasses}
          onChange={(event) =>
            void update({ latex: { maxPasses: Number(event.target.value) || 3 } })
          }
        />
      </div>
      <p className="field__hint">
        These are the defaults applied to newly created projects. Each project keeps its own copy in
        <code className="mono"> .sheaf/settings.json</code>, editable under Project.
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function PdfSection(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  if (!settings) return <div />

  return (
    <section>
      <h3>PDF preview</h3>
      <div className="field-grid">
        <label className="field-grid__label">Default zoom</label>
        <select
          className="select"
          value={settings.pdf.zoomBehavior}
          onChange={(event) =>
            void update({ pdf: { zoomBehavior: event.target.value as ZoomBehavior } })
          }
        >
          <option value="fit-width">Fit width</option>
          <option value="fit-page">Fit page</option>
          <option value="actual">Actual size</option>
        </select>

        <label className="field-grid__label">Panel position</label>
        <select
          className="select"
          value={settings.pdf.position}
          onChange={(event) =>
            void update({ pdf: { position: event.target.value as PdfPanelPosition } })
          }
        >
          <option value="right">Right of the editor</option>
          <option value="left">Left of the editor</option>
          <option value="bottom">Below the editor</option>
        </select>
      </div>

      <div className="settings__checks">
        <Toggle
          label="Refresh automatically after a successful build"
          checked={settings.pdf.autoRefresh}
          onChange={(value) => void update({ pdf: { autoRefresh: value } })}
        />
        <Toggle
          label="Highlight the matching position after a forward search"
          checked={settings.pdf.highlightSync}
          onChange={(value) => void update({ pdf: { highlightSync: value } })}
        />
        <Toggle
          label="Invert page colours in dark mode"
          checked={settings.pdf.invertInDarkMode}
          onChange={(value) => void update({ pdf: { invertInDarkMode: value } })}
        />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function ProjectSection(): JSX.Element {
  const projectRef = useProjectStore((state) => state.ref)
  const settings = useProjectStore((state) => state.settings)
  const index = useProjectStore((state) => state.index)
  const update = useProjectStore((state) => state.updateSettings)
  const tree = useProjectStore((state) => state.tree)

  if (!projectRef || !settings) {
    return (
      <section>
        <h3>Project</h3>
        <p className="field__hint">Open a project to change its build settings.</p>
      </section>
    )
  }

  const texFiles: string[] = []
  const collect = (node: { path: string; type: string; children?: unknown[] }): void => {
    if (node.type === 'file' && node.path.toLowerCase().endsWith('.tex')) texFiles.push(node.path)
    for (const child of (node.children ?? []) as typeof node[]) collect(child)
  }
  if (tree) collect(tree as never)

  const buildCommand = [
    settings.compiler,
    settings.compiler === 'tectonic' ? '--synctex --keep-logs' : '-synctex=1',
    settings.compiler === 'tectonic' ? '' : '-interaction=nonstopmode -file-line-error',
    settings.compiler === 'latexmk' ? '-pdf' : '',
    settings.outputDirectory
      ? settings.compiler === 'latexmk'
        ? `-outdir=${settings.outputDirectory}`
        : settings.compiler === 'tectonic'
          ? `--outdir ${settings.outputDirectory}`
          : `-output-directory=${settings.outputDirectory}`
      : '',
    ...settings.extraArgs,
    index?.mainDocument ?? settings.mainDocument ?? 'main.tex'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section>
      <h3>{projectRef.name}</h3>
      <p className="field__hint settings__path mono">{projectRef.path}</p>

      <div className="field-grid">
        <label className="field-grid__label">Main document</label>
        <select
          className="select"
          value={settings.mainDocument ?? ''}
          onChange={(event) => void update({ mainDocument: event.target.value || null })}
        >
          <option value="">
            Detect automatically{index?.mainDocument ? ` (${index.mainDocument})` : ''}
          </option>
          {texFiles.map((file) => (
            <option key={file} value={file}>
              {file}
            </option>
          ))}
        </select>

        <label className="field-grid__label">Compiler</label>
        <select
          className="select"
          value={settings.compiler}
          onChange={(event) => void update({ compiler: event.target.value as CompilerName })}
        >
          {(['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'tectonic'] as CompilerName[]).map(
            (compiler) => (
              <option key={compiler} value={compiler}>
                {compiler}
              </option>
            )
          )}
        </select>

        <label className="field-grid__label">Extra arguments</label>
        <input
          className="input mono"
          placeholder="-shell-escape"
          value={settings.extraArgs.join(' ')}
          onChange={(event) =>
            void update({ extraArgs: event.target.value.split(/\s+/).filter(Boolean) })
          }
        />

        <label className="field-grid__label">Build command</label>
        <code className="settings__command mono">{buildCommand}</code>

        <label className="field-grid__label">Bibliography tool</label>
        <select
          className="select"
          value={settings.bibTool}
          onChange={(event) => void update({ bibTool: event.target.value as BibTool })}
        >
          <option value="auto">Automatic</option>
          <option value="biber">Always biber</option>
          <option value="bibtex">Always bibtex</option>
          <option value="none">Never</option>
        </select>

        <label className="field-grid__label">Output directory</label>
        <input
          className="input mono"
          value={settings.outputDirectory}
          onChange={(event) => void update({ outputDirectory: event.target.value })}
        />

        <label className="field-grid__label">Auto compile delay</label>
        <div className="field__row">
          <input
            className="input settings__number"
            type="number"
            min={300}
            max={20000}
            step={100}
            value={settings.autoCompileDelayMs}
            onChange={(event) =>
              void update({ autoCompileDelayMs: Number(event.target.value) || 1500 })
            }
          />
          <span className="settings__unit">ms after the last keystroke</span>
        </div>

        <label className="field-grid__label">Compile timeout</label>
        <div className="field__row">
          <input
            className="input settings__number"
            type="number"
            min={5}
            max={1800}
            value={Math.round(settings.compileTimeoutMs / 1000)}
            onChange={(event) =>
              void update({ compileTimeoutMs: (Number(event.target.value) || 120) * 1000 })
            }
          />
          <span className="settings__unit">seconds</span>
        </div>

        <label className="field-grid__label">Maximum passes</label>
        <input
          className="input settings__number"
          type="number"
          min={1}
          max={8}
          value={settings.maxPasses}
          onChange={(event) => void update({ maxPasses: Number(event.target.value) || 3 })}
        />

        <label className="field-grid__label field-grid__full">Figure template</label>
        <textarea
          className="textarea field-grid__full"
          rows={6}
          value={settings.figureTemplate}
          onChange={(event) => void update({ figureTemplate: event.target.value })}
        />
      </div>

      <p className="field__hint">
        Placeholders in the figure template: <code className="mono">{'${path}'}</code>,{' '}
        <code className="mono">{'${caption}'}</code>, <code className="mono">{'${label}'}</code>.
      </p>

      <div className="settings__checks">
        <Toggle
          label="Compile automatically after editing"
          checked={settings.autoCompile}
          onChange={(value) => void update({ autoCompile: value })}
        />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function ApplicationSection(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const reset = useSettingsStore((state) => state.reset)
  const confirm = useUiStore((state) => state.confirm)
  const pushToast = useUiStore((state) => state.pushToast)
  const [defaultApp, setDefaultApp] = useState<DefaultAppStatus | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void attempt(api.os.defaultAppStatus()).then((status) => setDefaultApp(status))
  }, [])

  if (!settings) return <div />

  return (
    <section>
      <h3>Application</h3>
      <div className="field-grid">
        <label className="field-grid__label">Theme</label>
        <select
          className="select"
          value={settings.app.theme}
          onChange={(event) =>
            void update({ app: { theme: event.target.value as ThemePreference } })
          }
        >
          <option value="system">Follow the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>

        <label className="field-grid__label">Autosave</label>
        <select
          className="select"
          value={settings.app.autosave}
          onChange={(event) =>
            void update({ app: { autosave: event.target.value as AutosaveMode } })
          }
        >
          <option value="afterDelay">After a short pause</option>
          <option value="onFocusChange">When the file loses focus</option>
          <option value="off">Off, save manually</option>
        </select>

        <label className="field-grid__label">Autosave delay</label>
        <div className="field__row">
          <input
            className="input settings__number"
            type="number"
            min={200}
            max={10000}
            step={100}
            disabled={settings.app.autosave !== 'afterDelay'}
            value={settings.app.autosaveDelayMs}
            onChange={(event) =>
              void update({ app: { autosaveDelayMs: Number(event.target.value) || 1000 } })
            }
          />
          <span className="settings__unit">ms</span>
        </div>

        <label className="field-grid__label">Projects directory</label>
        <input
          className="input mono"
          value={settings.app.projectsDirectory}
          onChange={(event) => void update({ app: { projectsDirectory: event.target.value } })}
        />
      </div>

      <div className="settings__checks">
        <Toggle
          label="Reopen the last project on start"
          checked={settings.app.restoreLastProject}
          onChange={(value) => void update({ app: { restoreLastProject: value } })}
        />
      </div>

      <h3>File associations</h3>
      <div className="settings__status">
        <Icon name={defaultApp?.isDefault ? 'check' : 'info'} size={15} />
        <div>
          {defaultApp?.isDefault ? (
            <strong>Sheaf is the default application for .tex files.</strong>
          ) : (
            <strong>Sheaf is not currently the default application for .tex files.</strong>
          )}
          <p>{defaultApp?.detail}</p>
          <p className="field__hint">
            Setting this makes double-clicking a <code className="mono">.tex</code> file open it
            here, in the project it belongs to. Sheaf runs as a single instance, so a second file
            opens in a new tab rather than a second window.
          </p>
        </div>
      </div>
      {defaultApp?.supported ? (
        <button
          className="btn"
          disabled={working}
          onClick={async () => {
            setWorking(true)
            const result = await attempt(api.os.setAsDefault(), reportError)
            const status = await attempt(api.os.defaultAppStatus())
            setDefaultApp(status)
            setWorking(false)
            if (result) {
              pushToast({
                severity: result.changed.length > 0 ? 'success' : 'warning',
                title:
                  result.changed.length > 0
                    ? 'Sheaf registered for LaTeX files'
                    : 'The system refused the registration',
                detail:
                  result.changed.length > 0
                    ? `Registered for: ${result.changed.join(', ')}`
                    : 'Your desktop environment did not accept the change.'
              })
            }
          }}
        >
          Set as the default LaTeX editor
        </button>
      ) : null}

      <h3>Reset</h3>
      <button
        className="btn btn--danger"
        onClick={async () => {
          const confirmed = await confirm({
            title: 'Reset all settings?',
            message:
              'Every application setting goes back to its default. Project settings and your files are not affected.',
            confirmLabel: 'Reset settings',
            danger: true
          })
          if (confirmed) await reset()
        }}
      >
        Reset settings to defaults
      </button>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function ShortcutsSection(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const [recording, setRecording] = useState<string | null>(null)

  const overrides = settings?.keybindings ?? {}

  const grouped = COMMANDS.reduce<Record<string, typeof COMMANDS>>((accumulator, command) => {
    accumulator[command.category] = accumulator[command.category] ?? []
    accumulator[command.category].push(command)
    return accumulator
  }, {})

  const assign = (commandId: string, accelerator: string | null): void => {
    const next = { ...overrides }
    if (accelerator === null) delete next[commandId]
    else next[commandId] = accelerator
    // The whole map is replaced so a removed override really disappears.
    void update({ keybindings: next })
    setRecording(null)
  }

  const conflictFor = (commandId: string, accelerator: string): string | null => {
    for (const command of COMMANDS) {
      if (command.id === commandId) continue
      const binding = overrides[command.id] ?? command.keybinding
      if (binding === accelerator) return command.title
    }
    return null
  }

  return (
    <section>
      <h3>Keyboard shortcuts</h3>
      <p className="field__hint">
        Click a shortcut and press the keys you want. Press Escape to cancel, or Backspace to
        remove the shortcut entirely.
      </p>

      {Object.entries(grouped).map(([category, commands]) => (
        <div key={category} className="shortcuts__group">
          <h4>{category}</h4>
          <table className="shortcuts">
            <tbody>
              {commands.map((command) => {
                const binding = overrides[command.id] ?? command.keybinding
                const isRecording = recording === command.id
                const conflict = binding ? conflictFor(command.id, binding) : null
                return (
                  <tr key={command.id}>
                    <td>
                      {command.title}
                      {conflict ? (
                        <span className="shortcuts__conflict"> also bound to {conflict}</span>
                      ) : null}
                    </td>
                    <td className="shortcuts__key">
                      <button
                        className={`shortcuts__button${isRecording ? ' shortcuts__button--recording' : ''}`}
                        onClick={() => setRecording(isRecording ? null : command.id)}
                        onBlur={() => setRecording((current) => (current === command.id ? null : current))}
                        onKeyDown={(event) => {
                          if (!isRecording) return
                          event.preventDefault()
                          event.stopPropagation()
                          const native = event.nativeEvent
                          if (native.key === 'Escape') {
                            setRecording(null)
                            return
                          }
                          if (native.key === 'Backspace') {
                            assign(command.id, null)
                            return
                          }
                          if (isModifierOnly(native)) return
                          assign(command.id, acceleratorFor(native))
                        }}
                      >
                        {isRecording ? (
                          'Press keys...'
                        ) : binding ? (
                          <span className="kbd">{formatAccelerator(binding)}</span>
                        ) : (
                          <span className="shortcuts__none">not bound</span>
                        )}
                      </button>
                      {overrides[command.id] ? (
                        <button
                          className="shortcuts__reset"
                          title="Restore the default"
                          onClick={() => assign(command.id, null)}
                        >
                          <Icon name="refresh" size={11} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      <p className="field__hint">
        Shortcuts inside the editor itself (undo, redo, multi-cursor, find and replace) follow the
        usual conventions and are handled by the editor.
      </p>
    </section>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label className="checkbox settings__toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}
