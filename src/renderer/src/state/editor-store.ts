import { create } from 'zustand'
import type { FileKind } from '@shared/types'
import { api, attempt, toAppError, unwrap } from '../lib/ipc'
import { basename, isEditable, isImage, kindOf } from '../lib/paths'
import {
  disposeAllModels,
  disposeModel,
  ensureModel,
  getModel,
  renameModel,
  replaceModelContent
} from '../lib/models'
import { reportError, useUiStore } from './ui-store'

export interface Tab {
  path: string
  name: string
  kind: FileKind
  /** Text tabs are backed by a Monaco model; binary ones carry a data URL. */
  editable: boolean
  dirty: boolean
  mtimeMs: number
  /** Monaco version id at the last save, used to compute the dirty flag. */
  savedVersionId: number
  dataUrl?: string
  size?: number
}

export interface RevealRequest {
  path: string
  line: number
  column: number
  /** Highlights the whole line rather than placing a bare cursor. */
  highlight?: boolean
  /** Increments so repeated reveals of the same spot still fire. */
  nonce: number
}

interface EditorState {
  projectId: string | null
  tabs: Tab[]
  activePath: string | null
  reveal: RevealRequest | null
  loading: Set<string>

  setProject: (projectId: string | null) => void
  openFile: (path: string, options?: { line?: number; column?: number; highlight?: boolean }) => Promise<void>
  activate: (path: string) => void
  closeTab: (path: string) => Promise<void>
  closeOthers: (path: string) => Promise<void>
  closeAll: () => Promise<void>
  markDirty: (path: string) => void
  save: (path: string, options?: { force?: boolean }) => Promise<boolean>
  saveAll: () => Promise<void>
  reload: (path: string) => Promise<void>
  handleExternalChange: (path: string, mtimeMs: number) => Promise<void>
  handleExternalDelete: (path: string) => void
  handleRename: (from: string, to: string) => void
  consumeReveal: () => void
  hasUnsaved: () => boolean
}

let revealNonce = 0

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  tabs: [],
  activePath: null,
  reveal: null,
  loading: new Set(),

  setProject: (projectId) => {
    if (get().projectId === projectId) return
    disposeAllModels()
    set({ projectId, tabs: [], activePath: null, reveal: null })
  },

  openFile: async (path, options) => {
    const { projectId, tabs } = get()
    if (!projectId) return

    const existing = tabs.find((tab) => tab.path === path)
    if (existing) {
      set({ activePath: path })
      if (options?.line) {
        revealNonce += 1
        set({
          reveal: {
            path,
            line: options.line,
            column: options.column ?? 1,
            highlight: options.highlight,
            nonce: revealNonce
          }
        })
      }
      return
    }

    if (isEditable(path)) {
      const file = await attempt(api.fs.readFile(projectId, path), reportError)
      if (!file) return
      const model = ensureModel(path, file.content)
      const tab: Tab = {
        path,
        name: basename(path),
        kind: kindOf(path),
        editable: true,
        dirty: false,
        mtimeMs: file.mtimeMs,
        savedVersionId: model.getAlternativeVersionId(),
        size: file.size
      }
      revealNonce += 1
      set((state) => ({
        tabs: [...state.tabs, tab],
        activePath: path,
        reveal: options?.line
          ? {
              path,
              line: options.line,
              column: options.column ?? 1,
              highlight: options.highlight,
              nonce: revealNonce
            }
          : state.reveal
      }))
      return
    }

    // Images and PDFs open in a read-only preview tab.
    const binary = await attempt(api.fs.readBinary(projectId, path), reportError)
    if (!binary) return
    // Copy into a plain ArrayBuffer: the bytes arrive over IPC and Blob needs
    // ownership of a buffer it can keep.
    const buffer = new ArrayBuffer(binary.data.byteLength)
    new Uint8Array(buffer).set(binary.data)
    const dataUrl = URL.createObjectURL(new Blob([buffer], { type: binary.mime }))
    const tab: Tab = {
      path,
      name: basename(path),
      kind: kindOf(path),
      editable: false,
      dirty: false,
      mtimeMs: binary.mtimeMs,
      savedVersionId: 0,
      dataUrl,
      size: binary.size
    }
    set((state) => ({ tabs: [...state.tabs, tab], activePath: path }))
  },

  activate: (path) => set({ activePath: path }),

  closeTab: async (path) => {
    const { tabs, activePath } = get()
    const tab = tabs.find((entry) => entry.path === path)
    if (!tab) return

    if (tab.dirty) {
      const confirmed = await useUiStore.getState().confirm({
        title: `Close ${tab.name}?`,
        message: 'This file has unsaved changes. Closing it will discard them.',
        confirmLabel: 'Discard changes',
        danger: true
      })
      if (!confirmed) return
    }

    if (tab.dataUrl) URL.revokeObjectURL(tab.dataUrl)
    disposeModel(path)

    const remaining = tabs.filter((entry) => entry.path !== path)
    let nextActive = activePath
    if (activePath === path) {
      const index = tabs.findIndex((entry) => entry.path === path)
      nextActive = remaining[Math.min(index, remaining.length - 1)]?.path ?? null
    }
    set({ tabs: remaining, activePath: nextActive })
  },

  closeOthers: async (path) => {
    const others = get().tabs.filter((tab) => tab.path !== path)
    for (const tab of others) {
      await get().closeTab(tab.path)
    }
  },

  closeAll: async () => {
    for (const tab of [...get().tabs]) {
      await get().closeTab(tab.path)
    }
  },

  markDirty: (path) => {
    const model = getModel(path)
    if (!model) return
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path
          ? { ...tab, dirty: model.getAlternativeVersionId() !== tab.savedVersionId }
          : tab
      )
    }))
  },

  save: async (path, options) => {
    const { projectId, tabs } = get()
    const tab = tabs.find((entry) => entry.path === path)
    if (!projectId || !tab || !tab.editable) return false
    const model = getModel(path)
    if (!model) return false
    if (!tab.dirty && !options?.force) return true

    const content = model.getValue()
    const versionId = model.getAlternativeVersionId()

    try {
      const result = await unwrap(
        api.fs.writeFile(projectId, path, content, options?.force ? null : tab.mtimeMs)
      )
      set((state) => ({
        tabs: state.tabs.map((entry) =>
          entry.path === path
            ? {
                ...entry,
                mtimeMs: result.mtimeMs,
                size: result.size,
                savedVersionId: versionId,
                dirty: getModel(path)?.getAlternativeVersionId() !== versionId
              }
            : entry
        )
      }))
      return true
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code === 'CONFLICT') {
        const overwrite = await useUiStore.getState().confirm({
          title: `${tab.name} changed on disk`,
          message:
            'This file was modified outside Sheaf since you opened it. Overwrite the version on disk with your changes, or discard yours and reload?',
          confirmLabel: 'Overwrite on disk',
          danger: true
        })
        if (overwrite) return get().save(path, { force: true })
        await get().reload(path)
        return false
      }
      reportError(appError)
      return false
    }
  },

  saveAll: async () => {
    for (const tab of get().tabs) {
      if (tab.dirty) await get().save(tab.path)
    }
  },

  reload: async (path) => {
    const { projectId } = get()
    if (!projectId) return
    const file = await attempt(api.fs.readFile(projectId, path), reportError)
    if (!file) return
    const model = getModel(path)
    if (!model) return
    replaceModelContent(model, file.content)
    const versionId = model.getAlternativeVersionId()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path
          ? { ...tab, mtimeMs: file.mtimeMs, savedVersionId: versionId, dirty: false }
          : tab
      )
    }))
  },

  /**
   * A file changed on disk. If the tab has no unsaved edits we quietly adopt
   * the new content; otherwise the user is asked, so nothing is lost.
   */
  handleExternalChange: async (path, mtimeMs) => {
    const tab = get().tabs.find((entry) => entry.path === path)
    if (!tab || !tab.editable) return
    if (Math.abs(tab.mtimeMs - mtimeMs) < 2) return

    if (!tab.dirty) {
      await get().reload(path)
      return
    }

    const reload = await useUiStore.getState().confirm({
      title: `${tab.name} changed on disk`,
      message:
        'The file was modified by another program, and you also have unsaved changes here. Reload from disk and lose your edits?',
      confirmLabel: 'Reload from disk',
      danger: true
    })
    if (reload) await get().reload(path)
    else set((state) => ({
      tabs: state.tabs.map((entry) => (entry.path === path ? { ...entry, mtimeMs } : entry))
    }))
  },

  handleExternalDelete: (path) => {
    const tab = get().tabs.find((entry) => entry.path === path)
    if (!tab) return
    if (tab.dirty) {
      useUiStore.getState().pushToast({
        severity: 'warning',
        title: `${tab.name} was deleted`,
        detail: 'The tab still holds your unsaved changes. Saving it will recreate the file.'
      })
      return
    }
    void get().closeTab(path)
  },

  handleRename: (from, to) => {
    const tab = get().tabs.find((entry) => entry.path === from)
    if (!tab) return
    renameModel(from, to)
    set((state) => ({
      tabs: state.tabs.map((entry) =>
        entry.path === from
          ? { ...entry, path: to, name: basename(to), kind: kindOf(to) }
          : entry
      ),
      activePath: state.activePath === from ? to : state.activePath
    }))
  },

  consumeReveal: () => set({ reveal: null }),

  hasUnsaved: () => get().tabs.some((tab) => tab.dirty)
}))

export function isPreviewable(path: string): boolean {
  return isImage(path) || path.toLowerCase().endsWith('.pdf')
}
