import { useEffect, useMemo, useState } from 'react'
import type { ProjectRef, TemplateId, TemplateInfo } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { useProjectStore } from '../state/project-store'
import { useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { middleTruncate } from '../lib/paths'
import { reportError, useUiStore } from '../state/ui-store'
import { ContextMenu, useContextMenu } from './common/ContextMenu'
import { Icon } from './common/Icon'
import { Modal } from './common/Modal'
import './Dashboard.css'

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(timestamp).toLocaleDateString()
}

export function Dashboard(): JSX.Element {
  const recent = useProjectStore((state) => state.recent)
  const loadRecent = useProjectStore((state) => state.loadRecent)
  const openProject = useProjectStore((state) => state.open)
  const openDialog = useProjectStore((state) => state.openDialog)
  const importZip = useProjectStore((state) => state.importZip)
  const busy = useProjectStore((state) => state.busy)
  const latex = useBuildStore((state) => state.latex)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const confirm = useUiStore((state) => state.confirm)
  const promptFor = useUiStore((state) => state.prompt)
  const pushToast = useUiStore((state) => state.pushToast)

  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const { menu, openMenu, closeMenu } = useContextMenu()

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  useEffect(() => {
    const onNewProject = (): void => setCreating(true)
    window.addEventListener('sheaf:new-project', onNewProject)
    return () => window.removeEventListener('sheaf:new-project', onNewProject)
  }, [])

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return recent
    return recent.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle)
    )
  }, [recent, filter])

  const open = async (project: ProjectRef): Promise<void> => {
    const ref = await openProject(project.path)
    if (ref) useEditorStore.getState().setProject(ref.id)
  }

  /**
   * Dashboard actions need a project handle in the main process, but must not
   * adopt it into the store: that would navigate away from the dashboard.
   */
  const withHandle = async <T,>(
    project: ProjectRef,
    action: (projectId: string) => Promise<T>
  ): Promise<T | null> => {
    const opened = await attempt(api.projects.open(project.path), reportError)
    if (!opened) return null
    try {
      return await action(opened.ref.id)
    } finally {
      await api.projects.close(opened.ref.id)
      await loadRecent()
    }
  }

  const buildMenu = (project: ProjectRef): Parameters<typeof openMenu>[1] => [
    { id: 'open', label: 'Open project', icon: 'folder', onSelect: () => void open(project) },
    {
      id: 'reveal',
      label: 'Show in file manager',
      icon: 'external-link',
      onSelect: () => void api.system.showItemInFolder(project.path)
    },
    { id: 'sep1', separator: true },
    {
      id: 'rename',
      label: 'Rename...',
      icon: 'pencil',
      disabled: !project.exists,
      onSelect: async () => {
        const name = await promptFor({
          title: 'Rename project',
          label: 'New folder name',
          initialValue: project.name,
          confirmLabel: 'Rename'
        })
        if (!name || name === project.name) return
        await withHandle(project, async (projectId) => {
          const renamed = await attempt(api.projects.rename(projectId, name), reportError)
          if (renamed) {
            // Renaming reopens the project at its new location.
            await api.projects.close(renamed.id)
            pushToast({ severity: 'success', title: `Renamed to ${renamed.name}` })
          }
        })
      }
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      disabled: !project.exists,
      onSelect: async () => {
        await withHandle(project, async (projectId) => {
          const copy = await attempt(api.projects.duplicate(projectId), reportError)
          if (copy) {
            await api.projects.close(copy.id)
            pushToast({ severity: 'success', title: `Duplicated as ${copy.name}` })
          }
        })
      }
    },
    { id: 'sep2', separator: true },
    {
      id: 'forget',
      label: 'Remove from this list',
      icon: 'close',
      onSelect: async () => {
        await api.projects.forget(project.id)
        await loadRecent()
      }
    },
    {
      id: 'delete',
      label: 'Move to trash...',
      icon: 'trash',
      danger: true,
      disabled: !project.exists,
      onSelect: async () => {
        const confirmed = await confirm({
          title: `Move "${project.name}" to the trash?`,
          message: `The folder ${project.path} and everything inside it will be moved to the system trash.`,
          confirmLabel: 'Move to trash',
          danger: true
        })
        if (!confirmed) return
        await withHandle(project, async (projectId) => {
          const removed = await attempt(api.projects.remove(projectId, false), reportError)
          if (removed !== null) {
            pushToast({ severity: 'success', title: 'Project moved to the trash' })
          }
        })
      }
    }
  ]

  return (
    <div className="dashboard">
      <div className="dashboard__inner">
        <header className="dashboard__header">
          <div className="dashboard__brand">
            <SheafMark />
            <div>
              <h1>Sheaf</h1>
              <p>A local-first LaTeX editor. Your files stay on your disk.</p>
            </div>
          </div>
          <button className="btn btn--ghost" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
            Settings
          </button>
        </header>

        {latex && !latex.detected ? (
          <div className="dashboard__banner">
            <Icon name="warning" size={15} />
            <div>
              <strong>No LaTeX distribution detected.</strong> You can create and edit projects, but
              compiling needs TeX Live, MiKTeX or Tectonic installed.
              <button className="dashboard__banner-link" onClick={() => setSettingsOpen(true)}>
                Configure the compiler path
              </button>
            </div>
          </div>
        ) : null}

        <div className="dashboard__actions">
          <button className="dashboard__action" onClick={() => setCreating(true)} disabled={busy}>
            <Icon name="plus" size={16} />
            <span className="dashboard__action-title">New project</span>
            <span className="dashboard__action-detail">Start from a template</span>
          </button>
          <button
            className="dashboard__action"
            disabled={busy}
            onClick={async () => {
              const ref = await openDialog()
              if (ref) useEditorStore.getState().setProject(ref.id)
            }}
          >
            <Icon name="folder" size={16} />
            <span className="dashboard__action-title">Open folder</span>
            <span className="dashboard__action-detail">Use an existing LaTeX directory</span>
          </button>
          <button
            className="dashboard__action"
            disabled={busy}
            onClick={async () => {
              const ref = await importZip()
              if (ref) useEditorStore.getState().setProject(ref.id)
            }}
          >
            <Icon name="upload" size={16} />
            <span className="dashboard__action-title">Import ZIP</span>
            <span className="dashboard__action-detail">Unpack an archived project</span>
          </button>
        </div>

        <section className="dashboard__recent">
          <div className="dashboard__recent-header">
            <h2>Recent projects</h2>
            {recent.length > 6 ? (
              <input
                className="input dashboard__filter"
                placeholder="Filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <div className="dashboard__empty">
              {recent.length === 0
                ? 'No projects yet. Create one, or open a folder that already contains LaTeX files.'
                : 'No project matches that filter.'}
            </div>
          ) : (
            <ul className="dashboard__list">
              {filtered.map((project) => (
                <li key={project.id}>
                  <button
                    className={`dashboard__project${project.exists ? '' : ' dashboard__project--missing'}`}
                    onDoubleClick={() => void open(project)}
                    onClick={() => void open(project)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      openMenu(event, buildMenu(project))
                    }}
                  >
                    <Icon name={project.exists ? 'folder' : 'warning'} size={15} />
                    <span className="dashboard__project-name">{project.name}</span>
                    <span className="dashboard__project-path" title={project.path}>
                      {middleTruncate(project.path)}
                    </span>
                    <span className="dashboard__project-time">
                      {project.exists ? relativeTime(project.lastOpened) : 'Folder is missing'}
                    </span>
                    <span
                      className="dashboard__project-more"
                      onClick={(event) => {
                        event.stopPropagation()
                        openMenu(event, buildMenu(project))
                      }}
                    >
                      <Icon name="more" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {creating ? <NewProjectDialog onClose={() => setCreating(false)} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  )
}

function SheafMark(): JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="dashboard__mark" aria-hidden="true">
      <rect x="0.5" y="0.5" width="33" height="33" rx="6" fill="var(--bg-elevated)" stroke="var(--border-strong)" />
      <path d="M9 22.5 17 8l8 14.5" stroke="var(--accent)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <path d="M12 22.5h10" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17 8v14.5" stroke="var(--text-faint)" strokeWidth="1.2" />
    </svg>
  )
}

function NewProjectDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const create = useProjectStore((state) => state.create)
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [name, setName] = useState('Untitled Project')
  const [template, setTemplate] = useState<TemplateId>('article')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void attempt(api.projects.templates()).then((list) => {
      if (list) setTemplates(list)
    })
  }, [])

  const submit = async (): Promise<void> => {
    if (!name.trim() || creating) return
    setCreating(true)
    const ref = await create({ name: name.trim(), template })
    setCreating(false)
    if (ref) {
      useEditorStore.getState().setProject(ref.id)
      onClose()
      // Open the generated main document straight away.
      void useEditorStore.getState().openFile('main.tex')
    }
  }

  return (
    <Modal
      title="New project"
      subtitle="A folder of ordinary .tex files is created on your disk."
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={!name.trim() || creating}>
            {creating ? 'Creating...' : 'Create project'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Project name</span>
        <input
          className="input"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </label>

      <div className="field">
        <span className="field__label">Template</span>
        <div className="template-grid">
          {templates.map((entry) => (
            <button
              key={entry.id}
              className={`template${template === entry.id ? ' template--selected' : ''}`}
              onClick={() => setTemplate(entry.id)}
            >
              <span className="template__name">{entry.name}</span>
              <span className="template__detail">{entry.description}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
