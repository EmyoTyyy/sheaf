import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileNode } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { createFileIn, createFolderIn } from '../lib/commands'
import { dirname, isImage } from '../lib/paths'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { reportError, useUiStore } from '../state/ui-store'
import { ContextMenu, useContextMenu, type MenuItem } from './common/ContextMenu'
import { Icon, fileIconFor } from './common/Icon'
import { insertFigureSnippet } from '../lib/figure'
import './Explorer.css'

const INDENT = 12

export function Explorer(): JSX.Element {
  const tree = useProjectStore((state) => state.tree)
  const projectRef = useProjectStore((state) => state.ref)
  const settings = useProjectStore((state) => state.settings)
  const index = useProjectStore((state) => state.index)
  const git = useProjectStore((state) => state.git)
  const refreshTree = useProjectStore((state) => state.refreshTree)
  const setMainDocument = useProjectStore((state) => state.setMainDocument)
  const openFile = useEditorStore((state) => state.openFile)
  const activePath = useEditorStore((state) => state.activePath)
  const confirm = useUiStore((state) => state.confirm)
  const promptFor = useUiStore((state) => state.prompt)
  const pushToast = useUiStore((state) => state.pushToast)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState<string | null>(null)
  const { menu, openMenu, closeMenu } = useContextMenu()

  // Expand the folders on the path to the file being edited.
  useEffect(() => {
    if (!activePath) return
    setExpanded((current) => {
      const next = new Set(current)
      const segments = activePath.split('/')
      segments.pop()
      let prefix = ''
      for (const segment of segments) {
        prefix = prefix ? `${prefix}/${segment}` : segment
        next.add(prefix)
      }
      return next
    })
  }, [activePath])

  // The header button folds the whole tree back up. Which folders are open is
  // this component's business, so it is asked rather than told.
  useEffect(() => {
    const collapse = (): void => setExpanded(new Set())
    window.addEventListener('sheaf:collapse-explorer', collapse)
    return () => window.removeEventListener('sheaf:collapse-explorer', collapse)
  }, [])

  const mainDocument = index?.mainDocument ?? settings?.mainDocument ?? null

  const gitStates = useMemo(() => {
    const map = new Map<string, string>()
    for (const file of git?.files ?? []) map.set(file.path, file.state)
    return map
  }, [git])

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleRename = async (node: FileNode): Promise<void> => {
    if (!projectRef) return
    const name = await promptFor({
      title: `Rename ${node.type === 'directory' ? 'folder' : 'file'}`,
      label: 'New name',
      initialValue: node.name,
      confirmLabel: 'Rename'
    })
    if (!name || name === node.name) return
    const next = await attempt(api.fs.rename(projectRef.id, node.path, name), reportError)
    if (!next) return
    useEditorStore.getState().handleRename(node.path, next)
    await refreshTree()
  }

  const handleDelete = async (node: FileNode): Promise<void> => {
    if (!projectRef) return
    const confirmed = await confirm({
      title: `Delete ${node.name}?`,
      message:
        node.type === 'directory'
          ? `The folder "${node.path}" and everything inside it will be permanently deleted from disk.`
          : `"${node.path}" will be permanently deleted from disk.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!confirmed) return
    const removed = await attempt(api.fs.remove(projectRef.id, node.path), reportError)
    if (removed === null) return
    useEditorStore.getState().handleExternalDelete(node.path)
    await refreshTree()
  }

  const handleMove = async (source: string, targetDirectory: string): Promise<void> => {
    if (!projectRef) return
    if (dirname(source) === targetDirectory) return
    const next = await attempt(api.fs.move(projectRef.id, source, targetDirectory), reportError)
    if (!next) return
    useEditorStore.getState().handleRename(source, next)
    await refreshTree()
  }

  const handleExternalDrop = async (files: FileList, targetDirectory: string): Promise<void> => {
    if (!projectRef) return
    const paths: string[] = []
    for (const file of Array.from(files)) {
      const withPath = file as File & { path?: string }
      if (withPath.path) paths.push(withPath.path)
    }
    if (paths.length === 0) return
    const imported = await attempt(
      api.fs.importExternal(projectRef.id, targetDirectory, paths),
      reportError
    )
    if (!imported) return
    await refreshTree()
    pushToast({
      severity: 'success',
      title: imported.length === 1 ? 'File added' : `${imported.length} files added`,
      detail: imported.join(', ')
    })
  }

  const menuFor = (node: FileNode | null): MenuItem[] => {
    const isDirectory = node === null || node.type === 'directory'
    const parent = node === null ? '' : isDirectory ? node.path : dirname(node.path)
    const items: MenuItem[] = [
      { id: 'new-file', label: 'New file...', icon: 'new-file', onSelect: () => void createFileIn(parent) },
      {
        id: 'new-folder',
        label: 'New folder...',
        icon: 'new-folder',
        onSelect: () => void createFolderIn(parent)
      },
      {
        id: 'import',
        label: 'Add files from disk...',
        icon: 'upload',
        onSelect: async () => {
          if (!projectRef) return
          const imported = await attempt(api.fs.importFiles(projectRef.id, parent), reportError)
          if (imported && imported.length > 0) await refreshTree()
        }
      }
    ]

    if (!node) return items

    items.push({ id: 'sep1', separator: true })

    if (node.type === 'file') {
      items.push({
        id: 'open',
        label: 'Open',
        icon: 'file',
        onSelect: () => void openFile(node.path)
      })
      if (node.path.toLowerCase().endsWith('.tex')) {
        items.push({
          id: 'main',
          label:
            mainDocument === node.path ? 'Main document (current)' : 'Set as main document',
          icon: 'check',
          disabled: mainDocument === node.path,
          onSelect: () => void setMainDocument(node.path)
        })
      }
      if (isImage(node.path)) {
        items.push({
          id: 'insert-figure',
          label: 'Insert as figure',
          icon: 'file-image',
          onSelect: () => insertFigureSnippet(node.path)
        })
      }
    }

    items.push(
      { id: 'sep2', separator: true },
      { id: 'rename', label: 'Rename...', icon: 'pencil', onSelect: () => void handleRename(node) },
      {
        id: 'copy-path',
        label: 'Copy relative path',
        icon: 'copy',
        onSelect: () => void navigator.clipboard.writeText(node.path)
      },
      {
        id: 'reveal',
        label: 'Show in file manager',
        icon: 'external-link',
        onSelect: () => {
          if (projectRef) void api.system.showItemInFolder(`${projectRef.path}/${node.path}`)
        }
      },
      { id: 'sep3', separator: true },
      { id: 'delete', label: 'Delete...', icon: 'trash', danger: true, onSelect: () => void handleDelete(node) }
    )

    return items
  }

  const renderNode = (node: FileNode, depth: number): JSX.Element => {
    const isDirectory = node.type === 'directory'
    const isExpanded = expanded.has(node.path)
    const isActive = activePath === node.path
    const gitState = gitStates.get(node.path)

    return (
      <div key={node.path}>
        <div
          className={[
            'explorer__row',
            isActive ? 'explorer__row--active' : '',
            dragOver === node.path ? 'explorer__row--drop' : '',
            gitState ? `explorer__row--git-${gitState}` : ''
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: depth * INDENT + 6 }}
          draggable
          title={node.path}
          onClick={() => (isDirectory ? toggle(node.path) : void openFile(node.path))}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openMenu(event, menuFor(node))
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData('application/sheaf-path', node.path)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            if (!isDirectory) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDragOver(node.path)
          }}
          onDragLeave={() => setDragOver((current) => (current === node.path ? null : current))}
          onDrop={(event) => {
            if (!isDirectory) return
            event.preventDefault()
            event.stopPropagation()
            setDragOver(null)
            const source = event.dataTransfer.getData('application/sheaf-path')
            if (source) void handleMove(source, node.path)
            else if (event.dataTransfer.files.length > 0) {
              void handleExternalDrop(event.dataTransfer.files, node.path)
            }
          }}
        >
          <span className="explorer__twisty">
            {isDirectory ? (
              <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
            ) : null}
          </span>
          <Icon
            name={isDirectory ? 'folder' : fileIconFor(node.path)}
            size={14}
            className="explorer__icon"
          />
          <span className="explorer__name truncate">{node.name}</span>
          {mainDocument === node.path ? (
            <span className="explorer__badge" title="Main document">
              main
            </span>
          ) : null}
        </div>
        {isDirectory && isExpanded
          ? (node.children ?? []).map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    )
  }

  if (!tree) {
    return <div className="explorer explorer--empty">Loading project...</div>
  }

  return (
    <div
      className={`explorer${dragOver === '' ? ' explorer--drop' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        openMenu(event, menuFor(null))
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver('')
      }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(null)
        const source = event.dataTransfer.getData('application/sheaf-path')
        if (source) void handleMove(source, '')
        else if (event.dataTransfer.files.length > 0) {
          void handleExternalDrop(event.dataTransfer.files, '')
        }
      }}
    >
      {(tree.children ?? []).map((node) => renderNode(node, 0))}
      {(tree.children ?? []).length === 0 ? (
        <div className="explorer__hint">
          This project is empty. Right-click to add a file, or drop files here.
        </div>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  )
}
