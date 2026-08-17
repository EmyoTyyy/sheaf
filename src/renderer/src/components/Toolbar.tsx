import type { CompilerName } from '@shared/types'
import { runCommand } from '../lib/commands'
import { useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'
import { Icon } from './common/Icon'
import './Toolbar.css'

const COMPILERS: CompilerName[] = ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'tectonic']

export function Toolbar(): JSX.Element {
  const projectRef = useProjectStore((state) => state.ref)
  const settings = useProjectStore((state) => state.settings)
  const index = useProjectStore((state) => state.index)
  const updateSettings = useProjectStore((state) => state.updateSettings)
  const status = useBuildStore((state) => state.status)
  const phase = useBuildStore((state) => state.phase)
  const latex = useBuildStore((state) => state.latex)
  const dirtyCount = useEditorStore((state) => state.tabs.filter((tab) => tab.dirty).length)

  const explorerVisible = useUiStore((state) => state.explorerVisible)
  const bottomVisible = useUiStore((state) => state.bottomVisible)
  const layout = useUiStore((state) => state.layout)
  const setLayout = useUiStore((state) => state.setLayout)
  const toggleExplorer = useUiStore((state) => state.toggleExplorer)
  const toggleBottom = useUiStore((state) => state.toggleBottom)

  const running = status === 'running'
  const available = latex?.tools ?? {}
  const mainDocument = index?.mainDocument ?? settings?.mainDocument

  return (
    <div className="toolbar">
      <button
        className={`btn btn--ghost btn--icon${explorerVisible ? ' btn--on' : ''}`}
        title="Toggle explorer (Ctrl+B)"
        onClick={() => toggleExplorer()}
      >
        <Icon name="panel-left" />
      </button>
      <button
        className={`btn btn--ghost btn--icon${bottomVisible ? ' btn--on' : ''}`}
        title="Toggle bottom panel (Ctrl+J)"
        onClick={() => toggleBottom()}
      >
        <Icon name="panel-bottom" />
      </button>

      <div className="divider" />

      <span className="toolbar__project truncate" title={projectRef?.path}>
        {projectRef?.name}
      </span>

      <div className="divider" />

      {running ? (
        <button className="btn btn--danger toolbar__compile" onClick={() => runCommand('stop-compile')}>
          <Icon name="stop" size={11} filled />
          Stop
        </button>
      ) : (
        <button
          className="btn btn--primary toolbar__compile"
          onClick={() => runCommand('compile')}
          title="Compile the document (Ctrl+Enter)"
          disabled={!projectRef}
        >
          <Icon name="play" size={11} filled />
          Compile
        </button>
      )}

      <select
        className="select toolbar__select"
        value={settings?.compiler ?? 'pdflatex'}
        title="Compilation engine for this project"
        onChange={(event) => void updateSettings({ compiler: event.target.value as CompilerName })}
      >
        {COMPILERS.map((compiler) => (
          <option key={compiler} value={compiler} disabled={!available[compiler]}>
            {compiler}
            {available[compiler] ? '' : ' (not installed)'}
          </option>
        ))}
      </select>

      <label className="checkbox toolbar__auto" title="Compile automatically after you stop typing">
        <input
          type="checkbox"
          checked={settings?.autoCompile ?? false}
          onChange={(event) => void updateSettings({ autoCompile: event.target.checked })}
        />
        Auto
      </label>

      {phase && running ? <span className="toolbar__phase truncate">{phase}</span> : null}

      <div className="toolbar__spacer" />

      {mainDocument ? (
        <span className="toolbar__main truncate" title="Main document">
          <Icon name="file-tex" size={12} />
          {mainDocument}
        </span>
      ) : null}

      {dirtyCount > 0 ? (
        <button className="btn btn--ghost toolbar__unsaved" onClick={() => runCommand('save-all')}>
          <Icon name="save" size={12} />
          {dirtyCount} unsaved
        </button>
      ) : null}

      <div className="divider" />

      <div className="toolbar__layout">
        <button
          className={`btn btn--ghost btn--icon${layout === 'editor' ? ' btn--on' : ''}`}
          title="Editor only"
          onClick={() => setLayout('editor')}
        >
          <Icon name="file" />
        </button>
        <button
          className={`btn btn--ghost btn--icon${layout === 'split' ? ' btn--on' : ''}`}
          title="Editor and PDF"
          onClick={() => setLayout('split')}
        >
          <Icon name="panel-right" />
        </button>
        <button
          className={`btn btn--ghost btn--icon${layout === 'pdf' ? ' btn--on' : ''}`}
          title="PDF only"
          onClick={() => setLayout('pdf')}
        >
          <Icon name="file-pdf" />
        </button>
      </div>

      <button
        className="btn btn--ghost btn--icon"
        title="Settings (Ctrl+,)"
        onClick={() => runCommand('settings')}
      >
        <Icon name="settings" />
      </button>
    </div>
  )
}
