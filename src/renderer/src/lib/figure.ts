import { getActiveEditor } from './editor-ref'
import { basename, stem } from './paths'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'

/** Turns images/my-plot.png into "my-plot", usable as a label. */
export function labelFromPath(path: string): string {
  return stem(basename(path))
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/** Turns images/my-plot.png into "My plot", usable as a caption. */
export function captionFromPath(path: string): string {
  const words = stem(basename(path)).replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Fills the project's figure template and inserts it at the cursor. The
 * template is a plain string with ${path}, ${caption} and ${label}
 * placeholders, editable in the settings.
 */
export function buildFigureSnippet(imagePath: string, template: string): string {
  return template
    .replace(/\$\{path\}/g, imagePath)
    .replace(/\$\{caption\}/g, captionFromPath(imagePath))
    .replace(/\$\{label\}/g, labelFromPath(imagePath))
}

export function insertFigureSnippet(imagePath: string): void {
  const editor = getActiveEditor()
  if (!editor) {
    useUiStore.getState().pushToast({
      severity: 'info',
      title: 'No file open',
      detail: 'Open a .tex file first, then insert the figure.'
    })
    return
  }

  const settings = useProjectStore.getState().settings
  const template =
    settings?.figureTemplate ??
    [
      '\\begin{figure}[ht]',
      '    \\centering',
      '    \\includegraphics[width=0.8\\textwidth]{${path}}',
      '    \\caption{${caption}}',
      '    \\label{fig:${label}}',
      '\\end{figure}'
    ].join('\n')

  const snippet = buildFigureSnippet(imagePath, template)
  const selection = editor.getSelection()
  if (!selection) return

  editor.executeEdits('sheaf.insert-figure', [
    { range: selection, text: snippet, forceMoveMarkers: true }
  ])
  editor.focus()
}

/** Inserts arbitrary text at the cursor of the focused editor. */
export function insertAtCursor(text: string): boolean {
  const editor = getActiveEditor()
  const selection = editor?.getSelection()
  if (!editor || !selection) return false
  editor.executeEdits('sheaf.insert', [{ range: selection, text, forceMoveMarkers: true }])
  editor.focus()
  return true
}
