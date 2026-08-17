import { create } from 'zustand'
import type {
  DeepPartial,
  FileEvent,
  FileNode,
  GitStatus,
  OpenedProject,
  ProjectIndex,
  ProjectRef,
  ProjectSettings,
  TemplateId
} from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { applyFileEvents } from '../lib/tree'
import { reportError } from './ui-store'

interface ProjectState {
  ref: ProjectRef | null
  settings: ProjectSettings | null
  tree: FileNode | null
  index: ProjectIndex | null
  git: GitStatus | null
  recent: ProjectRef[]
  busy: boolean

  loadRecent: () => Promise<void>
  open: (absolutePath: string) => Promise<ProjectRef | null>
  openDialog: () => Promise<ProjectRef | null>
  create: (options: {
    name: string
    directory?: string
    template: TemplateId
  }) => Promise<ProjectRef | null>
  importZip: () => Promise<ProjectRef | null>
  close: () => Promise<void>
  refreshTree: () => Promise<void>
  refreshIndex: () => Promise<void>
  refreshGit: () => Promise<void>
  applyEvents: (events: FileEvent[]) => void
  setIndex: (index: ProjectIndex) => void
  updateSettings: (patch: DeepPartial<ProjectSettings>) => Promise<void>
  setMainDocument: (path: string | null) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  ref: null,
  settings: null,
  tree: null,
  index: null,
  git: null,
  recent: [],
  busy: false,

  loadRecent: async () => {
    const recent = await attempt(api.projects.listRecent(), reportError)
    if (recent) set({ recent })
  },

  open: async (absolutePath) => {
    set({ busy: true })
    const project = await attempt(api.projects.open(absolutePath), reportError)
    set({ busy: false })
    if (!project) return null
    adopt(set, project)
    void get().loadRecent()
    void get().refreshGit()
    return project.ref
  },

  openDialog: async () => {
    set({ busy: true })
    const project = await attempt(api.projects.openDialog(), reportError)
    set({ busy: false })
    if (!project) return null
    adopt(set, project)
    void get().loadRecent()
    void get().refreshGit()
    return project.ref
  },

  create: async (options) => {
    set({ busy: true })
    const project = await attempt(api.projects.create(options), reportError)
    set({ busy: false })
    if (!project) return null
    adopt(set, project)
    void get().loadRecent()
    return project.ref
  },

  importZip: async () => {
    set({ busy: true })
    const project = await attempt(api.projects.importZip(), reportError)
    set({ busy: false })
    if (!project) return null
    adopt(set, project)
    void get().loadRecent()
    return project.ref
  },

  close: async () => {
    const ref = get().ref
    if (ref) await api.projects.close(ref.id)
    set({ ref: null, settings: null, tree: null, index: null, git: null })
    void get().loadRecent()
  },

  refreshTree: async () => {
    const ref = get().ref
    if (!ref) return
    const tree = await attempt(api.fs.readTree(ref.id), reportError)
    if (tree) set({ tree })
  },

  refreshIndex: async () => {
    const ref = get().ref
    if (!ref) return
    const index = await attempt(api.index.refresh(ref.id))
    if (index) set({ index })
  },

  refreshGit: async () => {
    const ref = get().ref
    if (!ref) return
    const git = await attempt(api.git.status(ref.id))
    set({ git: git ?? null })
  },

  applyEvents: (events) => {
    const ref = get().ref
    if (!ref) return
    const relevant = events.filter((event) => event.projectId === ref.id)
    if (relevant.length === 0) return
    set((state) => ({ tree: applyFileEvents(state.tree, relevant) }))
  },

  setIndex: (index) => {
    const ref = get().ref
    if (!ref || index.projectId !== ref.id) return
    set({ index })
  },

  updateSettings: async (patch) => {
    const ref = get().ref
    if (!ref) return
    const settings = await attempt(api.projects.updateSettings(ref.id, patch), reportError)
    if (settings) set({ settings })
  },

  setMainDocument: async (path) => {
    await get().updateSettings({ mainDocument: path })
    await get().refreshIndex()
  }
}))

function adopt(
  set: (partial: Partial<ProjectState>) => void,
  project: OpenedProject
): void {
  set({
    ref: project.ref,
    settings: project.settings,
    tree: project.tree,
    index: null,
    git: null
  })
}
