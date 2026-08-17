import { create } from 'zustand'
import type { AppError } from '@shared/types'

export type BottomTab = 'problems' | 'log' | 'terminal'
export type SidebarTab = 'files' | 'search' | 'git' | 'outline'
export type LayoutMode = 'split' | 'editor' | 'pdf'

export interface Toast {
  id: string
  severity: 'error' | 'warning' | 'info' | 'success'
  title: string
  detail?: string
  action?: string
  /** Optional button that runs something when clicked. */
  actionLabel?: string
  onAction?: () => void
  timeoutMs?: number
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  resolve: (confirmed: boolean) => void
}

export interface PromptRequest {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  placeholder?: string
  resolve: (value: string | null) => void
}

interface UiState {
  explorerVisible: boolean
  bottomVisible: boolean
  layout: LayoutMode
  distractionFree: boolean
  sidebarTab: SidebarTab
  bottomTab: BottomTab
  settingsOpen: boolean
  quickOpenOpen: boolean
  shortcutsOpen: boolean
  toasts: Toast[]
  confirmRequest: ConfirmRequest | null
  promptRequest: PromptRequest | null

  toggleExplorer: (value?: boolean) => void
  toggleBottom: (value?: boolean) => void
  setLayout: (layout: LayoutMode) => void
  toggleDistractionFree: (value?: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  setBottomTab: (tab: BottomTab) => void
  setSettingsOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void

  pushToast: (toast: Omit<Toast, 'id'>) => string
  reportError: (error: AppError) => void
  dismissToast: (id: string) => void

  confirm: (request: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>
  resolveConfirm: (confirmed: boolean) => void
  prompt: (request: Omit<PromptRequest, 'resolve'>) => Promise<string | null>
  resolvePrompt: (value: string | null) => void
}

let toastCounter = 0

export const useUiStore = create<UiState>((set, get) => ({
  explorerVisible: true,
  bottomVisible: true,
  layout: 'split',
  distractionFree: false,
  sidebarTab: 'files',
  bottomTab: 'problems',
  settingsOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  toasts: [],
  confirmRequest: null,
  promptRequest: null,

  toggleExplorer: (value) =>
    set((state) => ({ explorerVisible: value ?? !state.explorerVisible })),
  toggleBottom: (value) => set((state) => ({ bottomVisible: value ?? !state.bottomVisible })),
  setLayout: (layout) => set({ layout }),
  toggleDistractionFree: (value) =>
    set((state) => {
      const next = value ?? !state.distractionFree
      return next
        ? { distractionFree: true, explorerVisible: false, bottomVisible: false, layout: 'editor' }
        : { distractionFree: false, explorerVisible: true, bottomVisible: true, layout: 'split' }
    }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab, explorerVisible: true }),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomVisible: true }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setQuickOpenOpen: (quickOpenOpen) => set({ quickOpenOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  pushToast: (toast) => {
    toastCounter += 1
    const id = `toast-${toastCounter}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    const timeout = toast.timeoutMs ?? (toast.severity === 'error' ? 12_000 : 5000)
    if (timeout > 0) {
      setTimeout(() => get().dismissToast(id), timeout)
    }
    return id
  },

  reportError: (error) => {
    get().pushToast({
      severity: 'error',
      title: error.title,
      detail: error.detail,
      action: error.action
    })
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  confirm: (request) =>
    new Promise<boolean>((resolve) => {
      set({ confirmRequest: { ...request, resolve } })
    }),

  resolveConfirm: (confirmed) => {
    const request = get().confirmRequest
    set({ confirmRequest: null })
    request?.resolve(confirmed)
  },

  prompt: (request) =>
    new Promise<string | null>((resolve) => {
      set({ promptRequest: { ...request, resolve } })
    }),

  resolvePrompt: (value) => {
    const request = get().promptRequest
    set({ promptRequest: null })
    request?.resolve(value)
  }
}))

/** Convenience for non-React code that needs to surface a failure. */
export function reportError(error: AppError): void {
  useUiStore.getState().reportError(error)
}
