import { useEffect, useMemo, useRef, useState } from 'react'
import type { Diagnostic, TerminalChunk, TerminalExit } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { formatDuration } from '../lib/paths'
import { useAllDiagnostics, useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { reportError, useUiStore, type BottomTab } from '../state/ui-store'
import { Icon } from './common/Icon'
import './BottomPanel.css'

const SEVERITY_ICON: Record<Diagnostic['severity'], string> = {
  error: 'error',
  warning: 'warning',
  info: 'info'
}

export function BottomPanel(): JSX.Element {
  const tab = useUiStore((state) => state.bottomTab)
  const setTab = useUiStore((state) => state.setBottomTab)
  const toggleBottom = useUiStore((state) => state.toggleBottom)
  const diagnostics = useAllDiagnostics()

  const counts = useMemo(() => {
    let errors = 0
    let warnings = 0
    let infos = 0
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === 'error') errors += 1
      else if (diagnostic.severity === 'warning') warnings += 1
      else infos += 1
    }
    return { errors, warnings, infos }
  }, [diagnostics])

  const tabs: { id: BottomTab; label: string }[] = [
    { id: 'problems', label: 'Problems' },
    { id: 'log', label: 'Raw Log' },
    { id: 'terminal', label: 'Terminal' }
  ]

  return (
    <div className="bottom-panel">
      <div className="bottom-panel__tabs">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            className={`bottom-panel__tab${tab === entry.id ? ' bottom-panel__tab--active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'problems' && diagnostics.length > 0 ? (
              <span className="bottom-panel__counts">
                {counts.errors > 0 ? (
                  <span className="severity-error">{counts.errors}</span>
                ) : null}
                {counts.warnings > 0 ? (
                  <span className="severity-warning">{counts.warnings}</span>
                ) : null}
                {counts.errors === 0 && counts.warnings === 0 && counts.infos > 0 ? (
                  <span className="severity-info">{counts.infos}</span>
                ) : null}
              </span>
            ) : null}
          </button>
        ))}
        <div className="bottom-panel__spacer" />
        <BuildSummary />
        <button
          className="btn btn--ghost btn--icon"
          title="Hide panel"
          onClick={() => toggleBottom(false)}
        >
          <Icon name="chevron-down" />
        </button>
      </div>

      <div className="bottom-panel__body">
        {tab === 'problems' ? <ProblemsList diagnostics={diagnostics} /> : null}
        {tab === 'log' ? <RawLog /> : null}
        {tab === 'terminal' ? <Terminal /> : null}
      </div>
    </div>
  )
}

function BuildSummary(): JSX.Element | null {
  const result = useBuildStore((state) => state.result)
  const status = useBuildStore((state) => state.status)
  const phase = useBuildStore((state) => state.phase)

  if (status === 'running') {
    return (
      <span className="bottom-panel__summary">
        <span className="spinner" />
        {phase || 'Compiling'}
      </span>
    )
  }
  if (!result) return null

  return (
    <span className="bottom-panel__summary">
      {result.status === 'success' ? (
        <Icon name="check" size={12} className="severity-info" />
      ) : (
        <Icon name="error" size={12} className="severity-error" />
      )}
      {result.status === 'success' ? 'Compiled' : 'Failed'} in {formatDuration(result.durationMs)}
      {result.passes.length > 1 ? ` (${result.passes.length} passes)` : ''}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Problems                                                            */
/* ------------------------------------------------------------------ */

function ProblemsList({ diagnostics }: { diagnostics: Diagnostic[] }): JSX.Element {
  const openFile = useEditorStore((state) => state.openFile)
  const result = useBuildStore((state) => state.result)
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const visible = useMemo(
    () => (filter === 'all' ? diagnostics : diagnostics.filter((d) => d.severity === filter)),
    [diagnostics, filter]
  )

  if (diagnostics.length === 0) {
    return (
      <div className="problems__empty">
        {result?.error ? (
          <div className="problems__error-card">
            <Icon name="error" size={16} className="severity-error" />
            <div>
              <strong>{result.error.title}</strong>
              <p>{result.error.detail}</p>
              {result.error.action ? <p className="problems__action">{result.error.action}</p> : null}
            </div>
          </div>
        ) : (
          <p>No problems detected.</p>
        )}
      </div>
    )
  }

  return (
    <div className="problems">
      <div className="problems__filters">
        {(['all', 'error', 'warning', 'info'] as const).map((value) => (
          <button
            key={value}
            className={`problems__filter${filter === value ? ' problems__filter--active' : ''}`}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? 'All' : value === 'error' ? 'Errors' : value === 'warning' ? 'Warnings' : 'Info'}
          </button>
        ))}
        <span className="problems__count">{visible.length} shown</span>
      </div>

      <div className="problems__list">
        {visible.map((diagnostic) => (
          <div key={diagnostic.id} className="problem">
            <button
              className="problem__row"
              onClick={() => {
                if (diagnostic.file) {
                  void openFile(diagnostic.file, {
                    line: diagnostic.line ?? 1,
                    column: diagnostic.column ?? 1,
                    highlight: true
                  })
                }
                setExpanded((current) => (current === diagnostic.id ? null : diagnostic.id))
              }}
            >
              <Icon
                name={SEVERITY_ICON[diagnostic.severity]}
                size={13}
                className={`severity-${diagnostic.severity}`}
              />
              <span className="problem__location mono">
                {diagnostic.file ? (
                  <>
                    {diagnostic.file}
                    {diagnostic.line ? `:${diagnostic.line}` : ''}
                    {diagnostic.column ? `:${diagnostic.column}` : ''}
                  </>
                ) : (
                  'general'
                )}
              </span>
              <span className="problem__message">{diagnostic.message}</span>
              {diagnostic.hint || diagnostic.raw ? (
                <Icon
                  name={expanded === diagnostic.id ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  className="problem__expand"
                />
              ) : null}
            </button>
            {expanded === diagnostic.id ? (
              <div className="problem__detail">
                {diagnostic.hint ? <p className="problem__hint">{diagnostic.hint}</p> : null}
                {diagnostic.raw ? <pre className="problem__raw">{diagnostic.raw}</pre> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Raw log                                                             */
/* ------------------------------------------------------------------ */

function RawLog(): JSX.Element {
  const result = useBuildStore((state) => state.result)
  const liveLog = useBuildStore((state) => state.liveLog)
  const status = useBuildStore((state) => state.status)
  const preRef = useRef<HTMLPreElement>(null)
  const [follow, setFollow] = useState(true)

  const text = status === 'running' ? liveLog : (result?.log ?? liveLog)

  useEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [text, follow])

  return (
    <div className="raw-log">
      <div className="raw-log__bar">
        {result?.passes.map((pass, index) => (
          <span key={index} className="raw-log__pass mono" title={pass.command}>
            {pass.label}
            <span className={pass.exitCode === 0 ? 'severity-info' : 'severity-warning'}>
              {' '}
              exit {pass.exitCode ?? '-'}
            </span>
          </span>
        ))}
        <div className="bottom-panel__spacer" />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          Follow output
        </label>
        <button
          className="btn btn--ghost btn--icon"
          title="Copy log"
          onClick={() => void navigator.clipboard.writeText(text)}
          disabled={!text}
        >
          <Icon name="copy" />
        </button>
      </div>
      <pre className="raw-log__text mono" ref={preRef}>
        {text || 'The compiler output appears here after the first build.'}
      </pre>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

interface TerminalLine {
  id: number
  kind: 'command' | 'stdout' | 'stderr' | 'exit'
  text: string
}

function Terminal(): JSX.Element {
  const projectRef = useProjectStore((state) => state.ref)
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [running, setRunning] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const counter = useRef(0)

  const append = (kind: TerminalLine['kind'], text: string): void => {
    counter.current += 1
    setLines((current) => [...current.slice(-800), { id: counter.current, kind, text }])
  }

  useEffect(() => {
    const offData = api.terminal.onData((chunk: TerminalChunk) => {
      append(chunk.stream, chunk.data)
    })
    const offExit = api.terminal.onExit((exit: TerminalExit) => {
      setRunning((current) => (current === exit.sessionId ? null : current))
      append(
        'exit',
        exit.signal
          ? `[stopped: ${exit.signal}]`
          : `[exit code ${exit.exitCode ?? 0}]`
      )
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [lines])

  const submit = async (): Promise<void> => {
    if (!projectRef || !command.trim() || running) return
    const text = command.trim()
    append('command', `$ ${text}`)
    setHistory((current) => [text, ...current.filter((entry) => entry !== text)].slice(0, 50))
    setHistoryIndex(-1)
    setCommand('')
    const sessionId = await attempt(api.terminal.run(projectRef.id, text), reportError)
    if (sessionId) setRunning(sessionId)
  }

  return (
    <div className="terminal">
      <div className="terminal__output mono" ref={outputRef}>
        {lines.length === 0 ? (
          <div className="terminal__intro">
            Commands run in <span className="mono">{projectRef?.path}</span>. This is a command
            runner rather than a full terminal: output is streamed, but programs that need an
            interactive prompt will not work here.
          </div>
        ) : null}
        {lines.map((line) => (
          <span key={line.id} className={`terminal__line terminal__line--${line.kind}`}>
            {line.text}
          </span>
        ))}
      </div>
      <div className="terminal__input">
        <span className="terminal__prompt mono">$</span>
        <input
          className="input mono"
          value={command}
          placeholder="latexmk -pdf main.tex"
          disabled={!projectRef}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
            else if (event.key === 'ArrowUp') {
              event.preventDefault()
              const next = Math.min(historyIndex + 1, history.length - 1)
              if (next >= 0) {
                setHistoryIndex(next)
                setCommand(history[next])
              }
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              const next = historyIndex - 1
              setHistoryIndex(next)
              setCommand(next >= 0 ? history[next] : '')
            }
          }}
        />
        {running ? (
          <button
            className="btn btn--danger"
            onClick={() => {
              void api.terminal.kill(running)
            }}
          >
            <Icon name="stop" filled size={11} />
            Stop
          </button>
        ) : (
          <button className="btn" onClick={() => void submit()} disabled={!command.trim()}>
            Run
          </button>
        )}
        <button
          className="btn btn--ghost btn--icon"
          title="Clear"
          onClick={() => setLines([])}
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  )
}
