import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { languageFor } from './paths'

/**
 * Monaco models live outside React state: they hold the document text, the
 * undo stack and the view state, none of which should be copied on render.
 */

const models = new Map<string, monaco.editor.ITextModel>()
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

function uriFor(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'sheaf', path: `/${path}` })
}

export function getModel(path: string): monaco.editor.ITextModel | undefined {
  return models.get(path)
}

export function ensureModel(path: string, content: string): monaco.editor.ITextModel {
  const existing = models.get(path)
  if (existing && !existing.isDisposed()) return existing
  const model = monaco.editor.createModel(content, languageFor(path), uriFor(path))
  models.set(path, model)
  return model
}

export function disposeModel(path: string): void {
  const model = models.get(path)
  models.delete(path)
  viewStates.delete(path)
  if (model && !model.isDisposed()) model.dispose()
}

export function disposeAllModels(): void {
  for (const path of [...models.keys()]) disposeModel(path)
}

/** Keeps the undo stack when a file is renamed or moved. */
export function renameModel(from: string, to: string): void {
  const model = models.get(from)
  if (!model) return
  const content = model.getValue()
  const state = viewStates.get(from) ?? null
  disposeModel(from)
  const next = ensureModel(to, content)
  models.set(to, next)
  viewStates.set(to, state)
}

export function saveViewState(
  path: string,
  state: monaco.editor.ICodeEditorViewState | null
): void {
  viewStates.set(path, state)
}

export function readViewState(path: string): monaco.editor.ICodeEditorViewState | null {
  return viewStates.get(path) ?? null
}

/** Replaces the text while keeping undo history and cursor position. */
export function replaceModelContent(model: monaco.editor.ITextModel, content: string): void {
  if (model.getValue() === content) return
  model.pushEditOperations(
    [],
    [{ range: model.getFullModelRange(), text: content }],
    () => null
  )
}
