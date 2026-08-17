import { create } from 'zustand'
import type { BuildResult, BuildStatus, Diagnostic, LatexEnvironment } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { reportError, useUiStore } from './ui-store'
import { useEditorStore } from './editor-store'
import { useProjectStore } from './project-store'
import { useSettingsStore } from './settings-store'

interface BuildState {
  status: BuildStatus
  phase: string
  result: BuildResult | null
  liveLog: string
  diagnostics: Diagnostic[]
  latex: LatexEnvironment | null
  /** PDF bytes of the last successful build; kept when a build fails. */
  pdf: Uint8Array | null
  pdfVersion: number
  /** A newer PDF exists on disk that the viewer has not loaded yet. */
  pdfStale: boolean
  lastBuiltAt: number | null

  detectLatex: (force?: boolean) => Promise<void>
  compile: (options?: { silent?: boolean }) => Promise<void>
  cancel: () => Promise<void>
  clean: () => Promise<void>
  loadExistingPdf: () => Promise<void>
  noteEdit: () => void
  applyProgress: (phase: string, chunk?: string) => void
  reset: () => void
}

let autoCompileTimer: ReturnType<typeof setTimeout> | null = null

export const useBuildStore = create<BuildState>((set, get) => ({
  status: 'idle',
  phase: '',
  result: null,
  liveLog: '',
  diagnostics: [],
  latex: null,
  pdf: null,
  pdfVersion: 0,
  pdfStale: false,
  lastBuiltAt: null,

  detectLatex: async (force) => {
    const latex = await attempt(api.latex.detect(force), reportError)
    if (latex) set({ latex })
  },

  compile: async (options) => {
    const ref = useProjectStore.getState().ref
    if (!ref) return
    if (get().status === 'running') return

    await useEditorStore.getState().saveAll()

    set({ status: 'running', phase: 'Starting', liveLog: '' })
    const result = await attempt(api.latex.build(ref.id))

    if (!result) {
      set({ status: 'error', phase: '' })
      return
    }

    set({
      status: result.status,
      phase: '',
      result,
      diagnostics: result.diagnostics,
      lastBuiltAt: Date.now()
    })

    if (result.error && result.status !== 'cancelled') {
      // A build failure is shown in the Problems panel; only surface a toast
      // for problems the panel cannot explain on its own.
      if (result.diagnostics.length === 0 && !options?.silent) {
        useUiStore.getState().reportError(result.error)
      }
      useUiStore.getState().setBottomTab('problems')
    }

    if (result.status === 'success' || result.pdfPath) {
      // With auto-refresh off the viewer keeps showing the previous version
      // until the reader asks for the new one.
      if (useSettingsStore.getState().settings?.pdf.autoRefresh !== false) {
        await get().loadExistingPdf()
      } else {
        set({ pdfStale: true })
      }
    }

    void useProjectStore.getState().refreshIndex()
  },

  cancel: async () => {
    const ref = useProjectStore.getState().ref
    if (!ref) return
    await api.latex.cancel(ref.id)
    set({ status: 'cancelled', phase: '' })
  },

  clean: async () => {
    const ref = useProjectStore.getState().ref
    if (!ref) return
    const removed = await attempt(api.latex.clean(ref.id), reportError)
    if (removed !== null) {
      set({ pdf: null, pdfVersion: get().pdfVersion + 1, pdfStale: false, result: null, diagnostics: [] })
      useUiStore.getState().pushToast({
        severity: 'success',
        title: 'Build files removed',
        detail: 'Auxiliary files and the compiled PDF were deleted. Sources are untouched.'
      })
    }
  },

  loadExistingPdf: async () => {
    const ref = useProjectStore.getState().ref
    if (!ref) return
    const payload = await attempt(api.latex.readPdf(ref.id))
    if (!payload) return
    set((state) => ({ pdf: payload.data, pdfVersion: state.pdfVersion + 1, pdfStale: false }))
  },

  /** Called on every editor edit; drives the auto-compile debounce. */
  noteEdit: () => {
    const settings = useProjectStore.getState().settings
    if (!settings?.autoCompile) return
    if (autoCompileTimer) clearTimeout(autoCompileTimer)
    autoCompileTimer = setTimeout(() => {
      autoCompileTimer = null
      const current = useProjectStore.getState().settings
      if (!current?.autoCompile) return
      if (useBuildStore.getState().status === 'running') return
      void useBuildStore.getState().compile({ silent: true })
    }, Math.max(300, settings.autoCompileDelayMs))
  },

  applyProgress: (phase, chunk) =>
    set((state) => ({
      phase,
      liveLog: chunk ? (state.liveLog + chunk).slice(-200_000) : state.liveLog
    })),

  reset: () => {
    if (autoCompileTimer) clearTimeout(autoCompileTimer)
    autoCompileTimer = null
    set({
      status: 'idle',
      phase: '',
      result: null,
      liveLog: '',
      diagnostics: [],
      pdf: null,
      pdfVersion: 0,
      pdfStale: false,
      lastBuiltAt: null
    })
  }
}))

/** Build diagnostics plus the index's static analysis, sorted for the panel. */
export function useAllDiagnostics(): Diagnostic[] {
  const buildDiagnostics = useBuildStore((state) => state.diagnostics)
  const index = useProjectStore((state) => state.index)

  const severityRank: Record<Diagnostic['severity'], number> = {
    error: 0,
    warning: 1,
    info: 2
  }

  const seen = new Set<string>()
  const merged: Diagnostic[] = []
  for (const diagnostic of [...buildDiagnostics, ...(index?.diagnostics ?? [])]) {
    const key = `${diagnostic.severity}|${diagnostic.file}|${diagnostic.line}|${diagnostic.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(diagnostic)
  }

  return merged.sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity]
    if (bySeverity !== 0) return bySeverity
    const byFile = (a.file ?? '').localeCompare(b.file ?? '')
    if (byFile !== 0) return byFile
    return (a.line ?? 0) - (b.line ?? 0)
  })
}
