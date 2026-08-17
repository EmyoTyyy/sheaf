import { useEffect, useRef, useState } from 'react'
import type { OpenFileRequest } from '@shared/types'
import { api } from './lib/ipc'
import { handleKeyDown, runCommand } from './lib/commands'
import { useBuildStore } from './state/build-store'
import { useEditorStore } from './state/editor-store'
import { useProjectStore } from './state/project-store'
import { useSettingsStore } from './state/settings-store'
import { Dashboard } from './components/Dashboard'
import { QuickOpen } from './components/QuickOpen'
import { SettingsDialog } from './components/SettingsDialog'
import { Workbench } from './components/Workbench'
import { ConfirmDialog, PromptDialog, Toasts } from './components/common/Overlays'

export function App(): JSX.Element {
  const projectRef = useProjectStore((state) => state.ref)
  const loadSettings = useSettingsStore((state) => state.load)
  const detectLatex = useBuildStore((state) => state.detectLatex)
  const [booted, setBooted] = useState(false)
  const dropDepth = useRef(0)
  const [osDragging, setOsDragging] = useState(false)

  /* ---------------- boot ---------------- */

  useEffect(() => {
    const boot = async (): Promise<void> => {
      await loadSettings()
      void detectLatex()
      await useProjectStore.getState().loadRecent()

      const settings = useSettingsStore.getState().settings
      const recent = useProjectStore.getState().recent
      const last = recent.find((entry) => entry.exists)
      if (settings?.app.restoreLastProject && last) {
        const ref = await useProjectStore.getState().open(last.path)
        if (ref) {
          useEditorStore.getState().setProject(ref.id)
          void useBuildStore.getState().loadExistingPdf()
        }
      }
      setBooted(true)
    }
    void boot()
  }, [loadSettings, detectLatex])

  /* ---------------- main process events ---------------- */

  useEffect(() => {
    const offFiles = api.fs.onFileEvent((events) => {
      useProjectStore.getState().applyEvents(events)
      const current = useProjectStore.getState().ref
      if (!current) return
      for (const event of events) {
        if (event.projectId !== current.id) continue
        if (event.type === 'change' && event.mtimeMs) {
          void useEditorStore.getState().handleExternalChange(event.path, event.mtimeMs)
        } else if (event.type === 'unlink') {
          useEditorStore.getState().handleExternalDelete(event.path)
        }
      }
    })

    const offProgress = api.latex.onProgress((progress) => {
      useBuildStore.getState().applyProgress(progress.phase, progress.chunk)
    })

    const offIndex = api.index.onUpdated((index) => {
      useProjectStore.getState().setIndex(index)
    })

    const offSettings = api.settings.onChanged((settings) => {
      useSettingsStore.getState().applyExternal(settings)
    })

    const offGit = api.git.onChanged(({ projectId }) => {
      if (useProjectStore.getState().ref?.id === projectId) {
        void useProjectStore.getState().refreshGit()
      }
    })

    const offMenu = api.menu.onCommand((command) => runCommand(command))

    const offOpenFile = api.os.onOpenFileRequest((request: OpenFileRequest) => {
      void openFromOs(request)
    })

    return () => {
      offFiles()
      offProgress()
      offIndex()
      offSettings()
      offGit()
      offMenu()
      offOpenFile()
    }
  }, [])

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      const overrides = useSettingsStore.getState().settings?.keybindings ?? {}
      handleKeyDown(event, overrides)
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  /* ---------------- warn before closing with unsaved work ---------------- */

  useEffect(() => {
    const listener = (event: BeforeUnloadEvent): void => {
      if (!useEditorStore.getState().hasUnsaved()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [])

  /* ---------------- files dropped from the OS ---------------- */

  useEffect(() => {
    const onDragEnter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      dropDepth.current += 1
      setOsDragging(true)
    }
    const onDragLeave = (): void => {
      dropDepth.current = Math.max(0, dropDepth.current - 1)
      if (dropDepth.current === 0) setOsDragging(false)
    }
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      dropDepth.current = 0
      setOsDragging(false)
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return
      // Files dropped inside the explorer are handled there, as an import.
      if (event.target instanceof HTMLElement && event.target.closest('.explorer')) return
      event.preventDefault()
      const paths: string[] = []
      for (const file of Array.from(files)) {
        const withPath = file as File & { path?: string }
        if (withPath.path) paths.push(withPath.path)
      }
      void openDroppedFiles(paths)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!booted) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <>
      {projectRef ? <Workbench /> : <Dashboard />}
      {osDragging ? (
        <div className="os-drop-hint">Drop LaTeX files to open them in their project</div>
      ) : null}
      <QuickOpen />
      <SettingsDialog />
      <ConfirmDialog />
      <PromptDialog />
      <Toasts />
    </>
  )
}

/** Opens a file the operating system handed to us, in its own project. */
async function openFromOs(request: OpenFileRequest): Promise<void> {
  const current = useProjectStore.getState().ref
  const separator = request.projectPath.includes('\\') ? '\\' : '/'

  if (!current || current.path !== request.projectPath) {
    const ref = await useProjectStore.getState().open(request.projectPath)
    if (!ref) return
    useEditorStore.getState().setProject(ref.id)
    void useBuildStore.getState().loadExistingPdf()
  }

  if (request.filePath === request.projectPath) return
  const prefix = request.projectPath.endsWith(separator)
    ? request.projectPath
    : request.projectPath + separator
  if (!request.filePath.startsWith(prefix)) return
  const relative = request.filePath.slice(prefix.length).split('\\').join('/')
  await useEditorStore.getState().openFile(relative)
}

async function openDroppedFiles(paths: string[]): Promise<void> {
  for (const filePath of paths) {
    const result = await api.projects.detectRoot(filePath)
    if (!result.ok) continue
    await openFromOs({ filePath, projectPath: result.value })
  }
}
