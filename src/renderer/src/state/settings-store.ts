import { create } from 'zustand'
import type { DeepPartial, Settings } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { reportError } from './ui-store'

interface SettingsState {
  settings: Settings | null
  resolvedTheme: 'light' | 'dark'
  load: () => Promise<void>
  update: (patch: DeepPartial<Settings>) => Promise<void>
  reset: () => Promise<void>
  applyExternal: (settings: Settings) => void
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolveTheme(settings: Settings | null): 'light' | 'dark' {
  const preference = settings?.app.theme ?? 'system'
  return preference === 'system' ? systemTheme() : preference
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  resolvedTheme: systemTheme(),

  load: async () => {
    const settings = await attempt(api.settings.get(), reportError)
    if (!settings) return
    const theme = resolveTheme(settings)
    applyTheme(theme)
    set({ settings, resolvedTheme: theme })
  },

  update: async (patch) => {
    const settings = await attempt(api.settings.update(patch), reportError)
    if (!settings) return
    get().applyExternal(settings)
  },

  reset: async () => {
    const settings = await attempt(api.settings.reset(), reportError)
    if (!settings) return
    get().applyExternal(settings)
  },

  applyExternal: (settings) => {
    const theme = resolveTheme(settings)
    applyTheme(theme)
    set({ settings, resolvedTheme: theme })
  }
}))

// Follow the operating system when the user has not chosen a fixed theme.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  const { settings, applyExternal } = useSettingsStore.getState()
  if (settings && settings.app.theme === 'system') applyExternal(settings)
})
