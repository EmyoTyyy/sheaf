import { api, attempt } from './ipc'
import { getActiveEditor, runEditorAction } from './editor-ref'
import { dirname } from './paths'
import { useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { reportError, useUiStore } from '../state/ui-store'

export interface CommandDefinition {
  id: string
  title: string
  /** Shown in the shortcut reference. */
  category: string
  keybinding?: string
  run: () => void | Promise<void>
}

/* ------------------------------------------------------------------ */
/* File creation helpers                                               */
/* ------------------------------------------------------------------ */

/** Directory that new files should land in, based on what is selected. */
function targetDirectory(): string {
  const activePath = useEditorStore.getState().activePath
  return activePath ? dirname(activePath) : ''
}

export async function createFileIn(parent: string): Promise<void> {
  const ref = useProjectStore.getState().ref
  if (!ref) return
  const name = await useUiStore.getState().prompt({
    title: 'New file',
    label: parent ? `Name of the new file in ${parent}/` : 'Name of the new file',
    initialValue: '',
    placeholder: 'chapter.tex',
    confirmLabel: 'Create'
  })
  if (!name) return
  const created = await attempt(api.fs.createFile(ref.id, parent, name, ''), reportError)
  if (!created) return
  await useProjectStore.getState().refreshTree()
  await useEditorStore.getState().openFile(created)
}

export async function createFolderIn(parent: string): Promise<void> {
  const ref = useProjectStore.getState().ref
  if (!ref) return
  const name = await useUiStore.getState().prompt({
    title: 'New folder',
    label: parent ? `Name of the new folder in ${parent}/` : 'Name of the new folder',
    initialValue: '',
    placeholder: 'chapters',
    confirmLabel: 'Create'
  })
  if (!name) return
  const created = await attempt(api.fs.createDirectory(ref.id, parent, name), reportError)
  if (created) await useProjectStore.getState().refreshTree()
}

/* ------------------------------------------------------------------ */
/* SyncTeX                                                             */
/* ------------------------------------------------------------------ */

export async function forwardSync(): Promise<void> {
  const ref = useProjectStore.getState().ref
  const editorState = useEditorStore.getState()
  const editor = getActiveEditor()
  if (!ref || !editorState.activePath || !editor) return

  const position = editor.getPosition()
  if (!position) return

  const result = await api.sync.forward(
    ref.id,
    editorState.activePath,
    position.lineNumber,
    position.column
  )
  if (!result.ok) {
    useUiStore.getState().pushToast({
      severity: 'info',
      title: result.error.title,
      detail: result.error.detail,
      action: result.error.action
    })
    return
  }
  // The PDF pane listens for this and scrolls to the highlighted box.
  window.dispatchEvent(new CustomEvent('sheaf:sync-forward', { detail: result.value }))
}

/* ------------------------------------------------------------------ */
/* Command table                                                       */
/* ------------------------------------------------------------------ */

export const COMMANDS: CommandDefinition[] = [
  {
    id: 'save',
    title: 'Save',
    category: 'File',
    keybinding: 'CmdOrCtrl+S',
    run: () => {
      const { activePath, save } = useEditorStore.getState()
      if (activePath) void save(activePath)
    }
  },
  {
    id: 'save-all',
    title: 'Save All',
    category: 'File',
    keybinding: 'CmdOrCtrl+Alt+S',
    run: () => useEditorStore.getState().saveAll()
  },
  {
    id: 'new-file',
    title: 'New File',
    category: 'File',
    keybinding: 'CmdOrCtrl+N',
    run: () => createFileIn(targetDirectory())
  },
  {
    id: 'new-folder',
    title: 'New Folder',
    category: 'File',
    run: () => createFolderIn(targetDirectory())
  },
  {
    id: 'new-project',
    title: 'New Project',
    category: 'File',
    keybinding: 'CmdOrCtrl+Shift+N',
    run: () => window.dispatchEvent(new CustomEvent('sheaf:new-project'))
  },
  {
    id: 'open-project',
    title: 'Open Project',
    category: 'File',
    keybinding: 'CmdOrCtrl+O',
    run: async () => {
      const ref = await useProjectStore.getState().openDialog()
      if (ref) useEditorStore.getState().setProject(ref.id)
    }
  },
  {
    id: 'import-zip',
    title: 'Import Project from ZIP',
    category: 'File',
    run: async () => {
      const ref = await useProjectStore.getState().importZip()
      if (ref) useEditorStore.getState().setProject(ref.id)
    }
  },
  {
    id: 'close-project',
    title: 'Close Project',
    category: 'File',
    run: async () => {
      const editor = useEditorStore.getState()
      if (editor.hasUnsaved()) {
        const confirmed = await useUiStore.getState().confirm({
          title: 'Close project?',
          message: 'Some files have unsaved changes. Save them before closing?',
          confirmLabel: 'Save and close'
        })
        if (confirmed) await editor.saveAll()
      }
      await useProjectStore.getState().close()
      editor.setProject(null)
      useBuildStore.getState().reset()
    }
  },
  {
    id: 'close-tab',
    title: 'Close Tab',
    category: 'File',
    keybinding: 'CmdOrCtrl+W',
    run: () => {
      const { activePath, closeTab } = useEditorStore.getState()
      if (activePath) void closeTab(activePath)
    }
  },
  {
    id: 'export-pdf',
    title: 'Export PDF',
    category: 'File',
    run: async () => {
      const ref = useProjectStore.getState().ref
      if (!ref) return
      const target = await attempt(api.projects.exportPdf(ref.id), reportError)
      if (target) {
        useUiStore.getState().pushToast({
          severity: 'success',
          title: 'PDF exported',
          detail: target,
          actionLabel: 'Show in folder',
          onAction: () => void api.system.showItemInFolder(target)
        })
      }
    }
  },
  {
    id: 'export-zip',
    title: 'Export Project as ZIP',
    category: 'File',
    run: async () => {
      const ref = useProjectStore.getState().ref
      if (!ref) return
      const target = await attempt(api.projects.exportZip(ref.id), reportError)
      if (target) {
        useUiStore.getState().pushToast({
          severity: 'success',
          title: 'Project exported',
          detail: target,
          actionLabel: 'Show in folder',
          onAction: () => void api.system.showItemInFolder(target)
        })
      }
    }
  },
  {
    id: 'compile',
    title: 'Compile',
    category: 'Build',
    keybinding: 'CmdOrCtrl+Enter',
    run: () => useBuildStore.getState().compile()
  },
  {
    id: 'stop-compile',
    title: 'Stop Compilation',
    category: 'Build',
    run: () => useBuildStore.getState().cancel()
  },
  {
    id: 'toggle-auto-compile',
    title: 'Toggle Auto Compile',
    category: 'Build',
    run: () => {
      const settings = useProjectStore.getState().settings
      if (!settings) return
      void useProjectStore.getState().updateSettings({ autoCompile: !settings.autoCompile })
    }
  },
  {
    id: 'clean',
    title: 'Clean Build Files',
    category: 'Build',
    run: async () => {
      const confirmed = await useUiStore.getState().confirm({
        title: 'Delete build files?',
        message:
          'Auxiliary files and the compiled PDF will be removed. Your LaTeX sources are not touched.',
        confirmLabel: 'Delete build files'
      })
      if (confirmed) await useBuildStore.getState().clean()
    }
  },
  {
    id: 'sync-forward',
    title: 'Jump to PDF Position',
    category: 'Build',
    keybinding: 'CmdOrCtrl+Alt+J',
    run: forwardSync
  },
  {
    id: 'find',
    title: 'Find',
    category: 'Edit',
    keybinding: 'CmdOrCtrl+F',
    run: () => runEditorAction('actions.find')
  },
  {
    id: 'replace',
    title: 'Replace',
    category: 'Edit',
    keybinding: 'CmdOrCtrl+H',
    run: () => runEditorAction('editor.action.startFindReplaceAction')
  },
  {
    id: 'find-in-project',
    title: 'Search in Project',
    category: 'Edit',
    keybinding: 'CmdOrCtrl+Shift+F',
    run: () => useUiStore.getState().setSidebarTab('search')
  },
  {
    id: 'quick-open',
    title: 'Quick Open File',
    category: 'Edit',
    keybinding: 'CmdOrCtrl+P',
    run: () => useUiStore.getState().setQuickOpenOpen(true)
  },
  {
    id: 'toggle-sidebar',
    title: 'Toggle Explorer',
    category: 'View',
    keybinding: 'CmdOrCtrl+B',
    run: () => useUiStore.getState().toggleExplorer()
  },
  {
    id: 'toggle-bottom-panel',
    title: 'Toggle Bottom Panel',
    category: 'View',
    keybinding: 'CmdOrCtrl+J',
    run: () => useUiStore.getState().toggleBottom()
  },
  {
    id: 'toggle-pdf',
    title: 'Toggle PDF Preview',
    category: 'View',
    keybinding: 'CmdOrCtrl+Shift+P',
    run: () => {
      const { layout, setLayout } = useUiStore.getState()
      setLayout(layout === 'editor' ? 'split' : 'editor')
    }
  },
  {
    id: 'distraction-free',
    title: 'Distraction-Free Mode',
    category: 'View',
    keybinding: 'CmdOrCtrl+Shift+D',
    run: () => useUiStore.getState().toggleDistractionFree()
  },
  {
    id: 'settings',
    title: 'Settings',
    category: 'View',
    keybinding: 'CmdOrCtrl+,',
    run: () => useUiStore.getState().setSettingsOpen(true)
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    category: 'View',
    run: () => useUiStore.getState().setShortcutsOpen(true)
  },
  {
    id: 'latex-status',
    title: 'LaTeX Installation Status',
    category: 'View',
    run: () => {
      useUiStore.getState().setSettingsOpen(true)
      window.dispatchEvent(new CustomEvent('sheaf:settings-section', { detail: 'latex' }))
    }
  }
]

const COMMAND_MAP = new Map(COMMANDS.map((command) => [command.id, command]))

export function runCommand(id: string): void {
  const command = COMMAND_MAP.get(id)
  if (!command) return
  void command.run()
}

/* ------------------------------------------------------------------ */
/* Keyboard handling                                                   */
/* ------------------------------------------------------------------ */

/** Modifier keys never form an accelerator on their own. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'])

export function isModifierOnly(event: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(event.key)
}

/** Turns a KeyboardEvent into the accelerator format used by the table. */
export function acceleratorFor(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CmdOrCtrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  let key = event.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()

  parts.push(key)
  return parts.join('+')
}

/** Commands Monaco already binds; the editor keeps priority when focused. */
const EDITOR_OWNED = new Set(['find', 'replace'])

export function handleKeyDown(event: KeyboardEvent, overrides: Record<string, string>): boolean {
  const accelerator = acceleratorFor(event)
  const overridden = Object.entries(overrides).find(([, binding]) => binding === accelerator)
  const command =
    (overridden ? COMMAND_MAP.get(overridden[0]) : undefined) ??
    COMMANDS.find((candidate) => {
      const binding = overrides[candidate.id] ?? candidate.keybinding
      return binding === accelerator
    })

  if (!command) return false

  const insideEditor =
    event.target instanceof HTMLElement && event.target.closest('.monaco-editor') !== null
  if (insideEditor && EDITOR_OWNED.has(command.id)) return false

  event.preventDefault()
  event.stopPropagation()
  void command.run()
  return true
}

/** Human-readable accelerator for the current platform. */
export function formatAccelerator(accelerator: string | undefined): string {
  if (!accelerator) return ''
  const isMac = navigator.platform.toLowerCase().includes('mac')
  return accelerator
    .replace('CmdOrCtrl', isMac ? 'Cmd' : 'Ctrl')
    .replace('Alt', isMac ? 'Option' : 'Alt')
    .replace('Enter', 'Enter')
    .split('+')
    .join(isMac ? ' ' : '+')
}
