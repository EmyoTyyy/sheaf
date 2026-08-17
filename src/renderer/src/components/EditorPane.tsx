import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { Diagnostic } from '@shared/types'
import { setupMonaco } from '../latex/monaco-setup'
import { getModel, readViewState, saveViewState } from '../lib/models'
import { setActiveEditor } from '../lib/editor-ref'
import { forwardSync } from '../lib/commands'
import { insertFigureSnippet } from '../lib/figure'
import { isImage } from '../lib/paths'
import { useAllDiagnostics, useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { useSettingsStore } from '../state/settings-store'
import { useUiStore } from '../state/ui-store'
import { ContextMenu, useContextMenu } from './common/ContextMenu'
import { Icon, fileIconFor } from './common/Icon'
import './EditorPane.css'

setupMonaco()

const SEVERITY_MAP: Record<Diagnostic['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info
}

export function EditorPane(): JSX.Element {
  const tabs = useEditorStore((state) => state.tabs)
  const activePath = useEditorStore((state) => state.activePath)

  return (
    <div className="editor-pane">
      <TabBar />
      <div className="editor-pane__body">
        {tabs.length === 0 ? <EmptyEditor /> : null}
        <MonacoHost hidden={tabs.length === 0 || !isTextTab(tabs, activePath)} />
        {activePath && !isTextTab(tabs, activePath) ? <BinaryPreview path={activePath} /> : null}
      </div>
    </div>
  )
}

function isTextTab(tabs: ReturnType<typeof useEditorStore.getState>['tabs'], path: string | null): boolean {
  if (!path) return false
  return tabs.find((tab) => tab.path === path)?.editable ?? false
}

function EmptyEditor(): JSX.Element {
  const index = useProjectStore((state) => state.index)
  const openFile = useEditorStore((state) => state.openFile)
  const main = index?.mainDocument

  return (
    <div className="empty-state editor-pane__empty">
      <h3>No file open</h3>
      <p>
        Pick a file in the explorer, or press <span className="kbd">Ctrl</span>{' '}
        <span className="kbd">P</span> to jump to one by name.
      </p>
      {main ? (
        <button className="btn" onClick={() => void openFile(main)}>
          <Icon name="file-tex" />
          Open {main}
        </button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function TabBar(): JSX.Element | null {
  const tabs = useEditorStore((state) => state.tabs)
  const activePath = useEditorStore((state) => state.activePath)
  const activate = useEditorStore((state) => state.activate)
  const closeTab = useEditorStore((state) => state.closeTab)
  const closeOthers = useEditorStore((state) => state.closeOthers)
  const closeAll = useEditorStore((state) => state.closeAll)
  const setMainDocument = useProjectStore((state) => state.setMainDocument)
  const { menu, openMenu, closeMenu } = useContextMenu()
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const active = barRef.current?.querySelector('.tab--active')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath])

  if (tabs.length === 0) return null

  return (
    <div className="tabbar" ref={barRef}>
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`tab${tab.path === activePath ? ' tab--active' : ''}`}
          title={tab.path}
          onMouseDown={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              void closeTab(tab.path)
            } else if (event.button === 0) {
              activate(tab.path)
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            openMenu(event, [
              { id: 'close', label: 'Close', onSelect: () => void closeTab(tab.path) },
              { id: 'close-others', label: 'Close others', onSelect: () => void closeOthers(tab.path) },
              { id: 'close-all', label: 'Close all', onSelect: () => void closeAll() },
              { id: 'sep', separator: true },
              {
                id: 'main',
                label: 'Set as main document',
                disabled: !tab.path.toLowerCase().endsWith('.tex'),
                onSelect: () => void setMainDocument(tab.path)
              },
              {
                id: 'copy',
                label: 'Copy relative path',
                onSelect: () => void navigator.clipboard.writeText(tab.path)
              }
            ])
          }}
        >
          <Icon name={fileIconFor(tab.path)} size={13} className="tab__icon" />
          <span className="tab__name">{tab.name}</span>
          <button
            className="tab__close"
            title={tab.dirty ? 'Unsaved changes' : 'Close'}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              void closeTab(tab.path)
            }}
          >
            {tab.dirty ? <span className="tab__dot" /> : <Icon name="close" size={11} />}
          </button>
        </div>
      ))}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Monaco host                                                         */
/* ------------------------------------------------------------------ */

function MonacoHost({ hidden }: { hidden: boolean }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const currentPathRef = useRef<string | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)

  const activePath = useEditorStore((state) => state.activePath)
  const reveal = useEditorStore((state) => state.reveal)
  const consumeReveal = useEditorStore((state) => state.consumeReveal)
  const settings = useSettingsStore((state) => state.settings)
  const theme = useSettingsStore((state) => state.resolvedTheme)
  const diagnostics = useAllDiagnostics()

  // Create the editor once.
  useLayoutEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'latex',
      automaticLayout: true,
      theme: 'sheaf-dark',
      fontLigatures: true,
      smoothScrolling: false,
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 24 },
      suggestSelection: 'first',
      snippetSuggestions: 'inline',
      unicodeHighlight: { ambiguousCharacters: false },
      quickSuggestions: { other: true, comments: false, strings: true },
      acceptSuggestionOnEnter: 'off',
      multiCursorModifier: 'alt',
      occurrencesHighlight: 'singleFile',
      bracketPairColorization: { enabled: true }
    })

    editorRef.current = editor
    decorationsRef.current = editor.createDecorationsCollection()
    setActiveEditor(editor)

    // Ctrl+Alt+click jumps from the source to the matching PDF position.
    editor.onMouseDown((event) => {
      if (!event.event.ctrlKey && !event.event.metaKey) return
      if (!event.event.altKey) return
      void forwardSync()
    })

    editor.onDidChangeModelContent(() => {
      const path = currentPathRef.current
      if (!path) return
      useEditorStore.getState().markDirty(path)
      useBuildStore.getState().noteEdit()

      const mode = useSettingsStore.getState().settings?.app.autosave ?? 'afterDelay'
      if (mode !== 'afterDelay') return
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      const delay = useSettingsStore.getState().settings?.app.autosaveDelayMs ?? 1000
      autosaveTimer.current = setTimeout(() => {
        autosaveTimer.current = null
        const current = currentPathRef.current
        if (current) void useEditorStore.getState().save(current)
      }, Math.max(200, delay))
    })

    editor.onDidBlurEditorText(() => {
      const mode = useSettingsStore.getState().settings?.app.autosave
      const path = currentPathRef.current
      if (mode === 'onFocusChange' && path) void useEditorStore.getState().save(path)
    })

    return () => {
      setActiveEditor(null)
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // Swap the model when the active tab changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const previous = currentPathRef.current
    if (previous && previous !== activePath) {
      saveViewState(previous, editor.saveViewState())
      const mode = useSettingsStore.getState().settings?.app.autosave
      if (mode === 'onFocusChange') void useEditorStore.getState().save(previous)
    }

    currentPathRef.current = activePath
    if (!activePath) {
      editor.setModel(null)
      return
    }

    const model = getModel(activePath)
    if (!model) return
    if (editor.getModel() !== model) {
      editor.setModel(model)
      const state = readViewState(activePath)
      if (state) editor.restoreViewState(state)
    }
    if (!hidden) editor.focus()
  }, [activePath, hidden])

  // Apply editor settings.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !settings) return
    editor.updateOptions({
      fontFamily: settings.editor.fontFamily,
      fontSize: settings.editor.fontSize,
      lineHeight: Math.round(settings.editor.fontSize * settings.editor.lineHeight),
      tabSize: settings.editor.tabSize,
      insertSpaces: settings.editor.insertSpaces,
      wordWrap: settings.editor.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.editor.minimap },
      lineNumbers: settings.editor.lineNumbers ? 'on' : 'off',
      renderWhitespace: settings.editor.renderWhitespace ? 'all' : 'selection',
      bracketPairColorization: { enabled: settings.editor.bracketPairColorization },
      autoClosingBrackets: settings.editor.autoClosingBrackets ? 'languageDefined' : 'never'
    })
    const model = editor.getModel()
    model?.updateOptions({
      tabSize: settings.editor.tabSize,
      insertSpaces: settings.editor.insertSpaces
    })
  }, [settings])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'light' ? 'sheaf-light' : 'sheaf-dark')
  }, [theme])

  // Publish diagnostics as Monaco markers, per open model.
  useEffect(() => {
    const byFile = new Map<string, Diagnostic[]>()
    for (const diagnostic of diagnostics) {
      if (!diagnostic.file) continue
      const list = byFile.get(diagnostic.file) ?? []
      list.push(diagnostic)
      byFile.set(diagnostic.file, list)
    }

    for (const tab of useEditorStore.getState().tabs) {
      const model = getModel(tab.path)
      if (!model) continue
      const items = byFile.get(tab.path) ?? []
      monaco.editor.setModelMarkers(
        model,
        'sheaf',
        items
          .filter((diagnostic) => diagnostic.line !== null)
          .map((diagnostic) => {
            const line = Math.min(Math.max(1, diagnostic.line as number), model.getLineCount())
            const maxColumn = model.getLineMaxColumn(line)
            const column = diagnostic.column
              ? Math.min(Math.max(1, diagnostic.column), maxColumn)
              : 1
            return {
              severity: SEVERITY_MAP[diagnostic.severity],
              message: diagnostic.hint
                ? `${diagnostic.message}\n\n${diagnostic.hint}`
                : diagnostic.message,
              startLineNumber: line,
              startColumn: column,
              endLineNumber: line,
              endColumn: diagnostic.column ? Math.min(column + 1, maxColumn) : maxColumn,
              source: 'sheaf'
            }
          })
      )
    }
  }, [diagnostics])

  // Scroll to a requested position (problems panel, search results, SyncTeX).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !reveal || reveal.path !== activePath) return
    const model = editor.getModel()
    if (!model) return

    const line = Math.min(Math.max(1, reveal.line), model.getLineCount())
    const column = Math.max(1, Math.min(reveal.column, model.getLineMaxColumn(line)))
    editor.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Immediate)
    editor.setPosition({ lineNumber: line, column })
    editor.focus()

    if (reveal.highlight) {
      decorationsRef.current?.set([
        {
          range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
          options: { isWholeLine: true, className: 'sheaf-reveal-line' }
        }
      ])
      setTimeout(() => decorationsRef.current?.clear(), 1600)
    }

    consumeReveal()
  }, [reveal, activePath, consumeReveal])

  return (
    <div
      className="editor-host"
      style={{ display: hidden ? 'none' : 'block' }}
      ref={containerRef}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/sheaf-path')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        const path = event.dataTransfer.getData('application/sheaf-path')
        if (!path) return
        event.preventDefault()
        event.stopPropagation()
        if (isImage(path)) {
          insertFigureSnippet(path)
        } else {
          const editor = editorRef.current
          const selection = editor?.getSelection()
          if (editor && selection) {
            const command = path.toLowerCase().endsWith('.tex')
              ? `\\input{${path.replace(/\.tex$/i, '')}}`
              : `\\includegraphics{${path}}`
            editor.executeEdits('sheaf.drop', [{ range: selection, text: command }])
          }
        }
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Image and PDF preview tabs                                          */
/* ------------------------------------------------------------------ */

function BinaryPreview({ path }: { path: string }): JSX.Element {
  const tab = useEditorStore((state) => state.tabs.find((entry) => entry.path === path))
  const pushToast = useUiStore((state) => state.pushToast)
  const [zoom, setZoom] = useState(1)

  if (!tab?.dataUrl) {
    return (
      <div className="empty-state">
        <p>This file cannot be shown here.</p>
      </div>
    )
  }

  const isPdf = path.toLowerCase().endsWith('.pdf')

  return (
    <div className="preview">
      <div className="preview__toolbar">
        <span className="preview__name truncate">{path}</span>
        <div className="preview__spacer" />
        {!isPdf ? (
          <>
            <button className="btn btn--ghost btn--icon" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))} title="Zoom out">
              <Icon name="zoom-out" />
            </button>
            <span className="preview__zoom">{Math.round(zoom * 100)}%</span>
            <button className="btn btn--ghost btn--icon" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} title="Zoom in">
              <Icon name="zoom-in" />
            </button>
            <div className="divider" />
          </>
        ) : null}
        <button
          className="btn btn--ghost"
          onClick={() => {
            insertFigureSnippet(path)
            pushToast({ severity: 'success', title: 'Figure inserted', detail: path })
          }}
        >
          <Icon name="plus" />
          Insert as figure
        </button>
      </div>
      <div className="preview__canvas">
        {isPdf ? (
          <object data={tab.dataUrl} type="application/pdf" className="preview__pdf">
            <p>This PDF cannot be displayed inline.</p>
          </object>
        ) : (
          <img
            src={tab.dataUrl}
            alt={path}
            style={{ transform: `scale(${zoom})` }}
            className="preview__image"
          />
        )}
      </div>
    </div>
  )
}
