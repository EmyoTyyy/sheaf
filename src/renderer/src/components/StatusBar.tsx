import { useEffect, useState } from 'react'
import { runCommand } from '../lib/commands'
import { getActiveEditor } from '../lib/editor-ref'
import { formatDuration } from '../lib/paths'
import { useAllDiagnostics, useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { useSettingsStore } from '../state/settings-store'
import { useUiStore } from '../state/ui-store'
import { Icon } from './common/Icon'
import './StatusBar.css'

export function StatusBar(): JSX.Element {
  const status = useBuildStore((state) => state.status)
  const result = useBuildStore((state) => state.result)
  const phase = useBuildStore((state) => state.phase)
  const latex = useBuildStore((state) => state.latex)
  const diagnostics = useAllDiagnostics()
  const activePath = useEditorStore((state) => state.activePath)
  const tabs = useEditorStore((state) => state.tabs)
  const git = useProjectStore((state) => state.git)
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.update)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const setSidebarTab = useUiStore((state) => state.setSidebarTab)

  const [cursor, setCursor] = useState({ line: 1, column: 1 })

  useEffect(() => {
    const editor = getActiveEditor()
    if (!editor) return
    const subscription = editor.onDidChangeCursorPosition((event) => {
      setCursor({ line: event.position.lineNumber, column: event.position.column })
    })
    return () => subscription.dispose()
  }, [activePath])

  const errors = diagnostics.filter((entry) => entry.severity === 'error').length
  const warnings = diagnostics.filter((entry) => entry.severity === 'warning').length
  const activeTab = tabs.find((tab) => tab.path === activePath)

  return (
    <div className="statusbar">
      <button className="statusbar__item" onClick={() => setBottomTab('problems')}>
        <Icon name="error" size={11} className={errors > 0 ? 'severity-error' : ''} />
        {errors}
        <Icon name="warning" size={11} className={warnings > 0 ? 'severity-warning' : ''} />
        {warnings}
      </button>

      {git?.isRepo ? (
        <button className="statusbar__item" onClick={() => setSidebarTab('git')}>
          <Icon name="git" size={11} />
          {git.branch ?? 'detached'}
          {git.files.length > 0 ? ` (${git.files.length})` : ''}
        </button>
      ) : null}

      <div className="statusbar__spacer" />

      {status === 'running' ? (
        <span className="statusbar__item">
          <span className="spinner" />
          {phase || 'Compiling'}
        </span>
      ) : result ? (
        <button className="statusbar__item" onClick={() => setBottomTab('log')}>
          <Icon
            name={result.status === 'success' ? 'check' : 'error'}
            size={11}
            className={result.status === 'success' ? '' : 'severity-error'}
          />
          {result.status === 'success' ? 'Compiled' : 'Build failed'} in{' '}
          {formatDuration(result.durationMs)}
        </button>
      ) : null}

      <button
        className="statusbar__item"
        title={
          latex?.detected
            ? Object.values(latex.tools)
                .map((tool) => tool.path)
                .join('\n')
            : 'No LaTeX distribution detected'
        }
        onClick={() => runCommand('latex-status')}
      >
        <Icon name="book" size={11} className={latex?.detected ? '' : 'severity-warning'} />
        {latex?.detected ? (latex.distribution ?? 'LaTeX ready') : 'No LaTeX'}
      </button>

      {activeTab ? (
        <>
          <span className="statusbar__item">
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <button
            className="statusbar__item"
            title="Toggle word wrap"
            onClick={() =>
              void updateSettings({ editor: { wordWrap: !settings?.editor.wordWrap } })
            }
          >
            Wrap: {settings?.editor.wordWrap ? 'on' : 'off'}
          </button>
          <span className="statusbar__item">
            {settings?.editor.insertSpaces ? 'Spaces' : 'Tabs'}: {settings?.editor.tabSize}
          </span>
          <span className="statusbar__item">{activeTab.dirty ? 'Unsaved' : 'Saved'}</span>
        </>
      ) : null}
    </div>
  )
}
