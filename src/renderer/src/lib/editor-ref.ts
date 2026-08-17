import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

/** The Monaco instance currently mounted, shared with the command layer. */
let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null

export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  activeEditor = editor
}

export function getActiveEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor
}

export function runEditorAction(actionId: string): boolean {
  const editor = activeEditor
  if (!editor) return false
  editor.focus()
  const action = editor.getAction(actionId)
  if (!action) return false
  void action.run()
  return true
}
