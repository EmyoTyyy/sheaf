import { useEffect, useState } from 'react'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { documentSymbols } from '../latex/monaco-setup'
import { api } from '../lib/ipc'
import { getModel } from '../lib/models'
import { createFileIn, createFolderIn, formatAccelerator, runCommand } from '../lib/commands'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { useUiStore, type SidebarTab } from '../state/ui-store'
import { Explorer } from './Explorer'
import { GitPanel } from './GitPanel'
import { SearchPanel } from './SearchPanel'
import { ContextMenu, useContextMenu, type MenuItem } from './common/ContextMenu'
import { Icon } from './common/Icon'
import './Sidebar.css'

const TABS: { id: SidebarTab; icon: string; title: string }[] = [
  { id: 'files', icon: 'files', title: 'Explorer' },
  { id: 'search', icon: 'search', title: 'Search in project' },
  { id: 'outline', icon: 'outline', title: 'Outline' },
  { id: 'git', icon: 'git', title: 'Source control' }
]

export function Sidebar(): JSX.Element {
  const tab = useUiStore((state) => state.sidebarTab)
  const setTab = useUiStore((state) => state.setSidebarTab)
  const toggleExplorer = useUiStore((state) => state.toggleExplorer)
  const projectRef = useProjectStore((state) => state.ref)
  const git = useProjectStore((state) => state.git)
  const { menu, openMenu, closeMenu } = useContextMenu()

  const changeCount = git?.files.length ?? 0

  // Everything that applies to the project as a whole, including leaving it.
  // Closing was only ever in the application menu, which Linux keeps hidden
  // behind Alt, so from inside the window there was no way back out.
  const projectMenu = (): MenuItem[] => [
    {
      id: 'collapse',
      label: 'Collapse folders',
      icon: 'collapse-all',
      onSelect: () => window.dispatchEvent(new CustomEvent('sheaf:collapse-explorer'))
    },
    {
      id: 'reveal',
      label: 'Show in file manager',
      icon: 'external-link',
      disabled: !projectRef,
      onSelect: () => {
        if (projectRef) void api.system.showItemInFolder(projectRef.path)
      }
    },
    { id: 'sep1', separator: true },
    {
      id: 'open-project',
      label: 'Open another project...',
      icon: 'folder_open',
      shortcut: formatAccelerator('CmdOrCtrl+O'),
      onSelect: () => runCommand('open-project')
    },
    {
      id: 'import-zip',
      label: 'Import from ZIP...',
      icon: 'upload',
      onSelect: () => runCommand('import-zip')
    },
    { id: 'sep2', separator: true },
    {
      id: 'close-project',
      label: 'Close project',
      icon: 'close',
      onSelect: () => runCommand('close-project')
    }
  ]

  return (
    <div className="sidebar">
      <div className="sidebar__rail">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={`sidebar__rail-button${tab === entry.id ? ' sidebar__rail-button--active' : ''}`}
            title={entry.title}
            onClick={() => setTab(entry.id)}
          >
            <Icon name={entry.icon} size={17} />
            {entry.id === 'git' && changeCount > 0 ? (
              <span className="sidebar__rail-badge">{changeCount > 99 ? '99+' : changeCount}</span>
            ) : null}
          </button>
        ))}
        <div className="sidebar__rail-spacer" />
        <button
          className="sidebar__rail-button"
          title="Settings"
          onClick={() => runCommand('settings')}
        >
          <Icon name="settings" size={17} />
        </button>
      </div>

      <div className="sidebar__panel">
        <div className="sidebar__header">
          {tab === 'files' ? (
            <button
              className="sidebar__title sidebar__title--project"
              title={projectRef ? `${projectRef.path}\nProject actions` : 'Project actions'}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                openMenu({ clientX: rect.left, clientY: rect.bottom + 2 }, projectMenu())
              }}
            >
              <span className="truncate">{projectRef?.name ?? 'Explorer'}</span>
              <Icon name="chevron-down" size={11} />
            </button>
          ) : (
            <span className="sidebar__title truncate">
              {TABS.find((t) => t.id === tab)?.title}
            </span>
          )}
          {tab === 'files' ? (
            <>
              <button
                className="btn btn--ghost btn--icon"
                title="New file"
                onClick={() => void createFileIn('')}
              >
                <Icon name="new-file" size={13} />
              </button>
              <button
                className="btn btn--ghost btn--icon"
                title="New folder"
                onClick={() => void createFolderIn('')}
              >
                <Icon name="new-folder" size={13} />
              </button>
            </>
          ) : null}
          <button
            className="btn btn--ghost btn--icon"
            title="Hide sidebar"
            onClick={() => toggleExplorer(false)}
          >
            <Icon name="chevron-left" size={13} />
          </button>
        </div>

        <div className="sidebar__content">
          {tab === 'files' ? <Explorer /> : null}
          {tab === 'search' ? <SearchPanel /> : null}
          {tab === 'outline' ? <OutlinePanel /> : null}
          {tab === 'git' ? <GitPanel /> : null}
        </div>
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Outline                                                             */
/* ------------------------------------------------------------------ */

interface OutlineEntry {
  name: string
  detail: string
  line: number
  depth: number
}

function flattenSymbols(
  symbols: monaco.languages.DocumentSymbol[],
  depth = 0,
  output: OutlineEntry[] = []
): OutlineEntry[] {
  for (const symbol of symbols) {
    output.push({
      name: symbol.name,
      detail: symbol.detail ?? '',
      line: symbol.range.startLineNumber,
      depth
    })
    if (symbol.children?.length) flattenSymbols(symbol.children, depth + 1, output)
  }
  return output
}

function OutlinePanel(): JSX.Element {
  const activePath = useEditorStore((state) => state.activePath)
  const tabs = useEditorStore((state) => state.tabs)
  const openFile = useEditorStore((state) => state.openFile)
  const index = useProjectStore((state) => state.index)
  const [entries, setEntries] = useState<OutlineEntry[]>([])

  useEffect(() => {
    if (!activePath) {
      setEntries([])
      return
    }
    const model = getModel(activePath)
    if (!model) {
      setEntries([])
      return
    }
    const update = (): void => setEntries(flattenSymbols(documentSymbols(model)))
    update()

    // Recomputed on a timer so typing stays smooth.
    let timer: number | undefined
    const subscription = model.onDidChangeContent(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 400)
    })
    return () => {
      window.clearTimeout(timer)
      subscription.dispose()
    }
  }, [activePath, tabs.length])

  const labels = (index?.labels ?? []).filter((label) => label.file === activePath)

  if (!activePath) {
    return <div className="outline__empty">Open a file to see its structure.</div>
  }

  return (
    <div className="outline">
      {entries.length === 0 ? (
        <div className="outline__empty">
          No sections in this file yet. Headings such as \section appear here.
        </div>
      ) : (
        entries.map((entry, position) => (
          <button
            key={`${entry.line}-${position}`}
            className="outline__row"
            style={{ paddingLeft: 8 + entry.depth * 12 }}
            onClick={() => void openFile(activePath, { line: entry.line, column: 1 })}
          >
            <span className="outline__kind">{entry.detail.replace(/^sub/, 'sub ').slice(0, 3)}</span>
            <span className="truncate">{entry.name}</span>
          </button>
        ))
      )}

      {labels.length > 0 ? (
        <>
          <div className="outline__section">Labels in this file</div>
          {labels.map((label) => (
            <button
              key={`${label.name}-${label.line}`}
              className="outline__row outline__row--label"
              onClick={() => void openFile(activePath, { line: label.line, column: 1 })}
            >
              <Icon name="sync" size={11} />
              <span className="truncate mono">{label.name}</span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  )
}
