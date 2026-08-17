import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '@shared/types'
import { flattenFiles } from '../lib/tree'
import { dirname } from '../lib/paths'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'
import { Icon, fileIconFor } from './common/Icon'
import './QuickOpen.css'

interface Scored {
  node: FileNode
  score: number
  matches: number[]
}

/** Subsequence match, favouring hits in the file name and consecutive runs. */
function fuzzyScore(text: string, query: string): { score: number; matches: number[] } | null {
  if (!query) return { score: 0, matches: [] }
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  const matches: number[] = []
  let score = 0
  let textIndex = 0
  let previous = -2

  for (const char of lowerQuery) {
    const found = lowerText.indexOf(char, textIndex)
    if (found === -1) return null
    matches.push(found)
    if (found === previous + 1) score += 6
    if (found === 0 || '/-_. '.includes(lowerText[found - 1])) score += 4
    score += 1
    previous = found
    textIndex = found + 1
  }

  // Prefer shorter paths and matches inside the base name.
  const lastSlash = text.lastIndexOf('/')
  if (matches[0] > lastSlash) score += 8
  score -= text.length * 0.02
  return { score, matches }
}

export function QuickOpen(): JSX.Element | null {
  const open = useUiStore((state) => state.quickOpenOpen)
  const setOpen = useUiStore((state) => state.setQuickOpenOpen)
  const tree = useProjectStore((state) => state.tree)
  const openFile = useEditorStore((state) => state.openFile)
  const recentTabs = useEditorStore((state) => state.tabs)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
    }
  }, [open])

  const files = useMemo(() => flattenFiles(tree), [tree])

  const results = useMemo(() => {
    const openPaths = new Set(recentTabs.map((tab) => tab.path))
    if (!query.trim()) {
      const sorted = [...files].sort((a, b) => {
        const aOpen = openPaths.has(a.path) ? 0 : 1
        const bOpen = openPaths.has(b.path) ? 0 : 1
        if (aOpen !== bOpen) return aOpen - bOpen
        return a.path.localeCompare(b.path)
      })
      return sorted.slice(0, 60).map((node) => ({ node, score: 0, matches: [] }) as Scored)
    }

    const scored: Scored[] = []
    for (const node of files) {
      const result = fuzzyScore(node.path, query.trim())
      if (!result) continue
      scored.push({
        node,
        score: result.score + (openPaths.has(node.path) ? 3 : 0),
        matches: result.matches
      })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 60)
  }, [files, query, recentTabs])

  useEffect(() => {
    const element = listRef.current?.children[selected] as HTMLElement | undefined
    element?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const choose = (index: number): void => {
    const entry = results[index]
    if (!entry) return
    setOpen(false)
    void openFile(entry.node.path)
  }

  return (
    <div className="quick-open-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="quick-open" onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-open__input">
          <Icon name="search" size={14} />
          <input
            className="input"
            autoFocus
            placeholder="Go to file"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((current) => Math.min(current + 1, results.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((current) => Math.max(current - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(selected)
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
        </div>

        <div className="quick-open__list" ref={listRef}>
          {results.length === 0 ? (
            <div className="quick-open__empty">No matching file.</div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.node.path}
                className={`quick-open__item${index === selected ? ' quick-open__item--selected' : ''}`}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(index)}
              >
                <Icon name={fileIconFor(entry.node.path)} size={13} />
                <span className="quick-open__name">
                  {highlight(entry.node.name, entry.node.path, entry.matches)}
                </span>
                <span className="quick-open__dir truncate">{dirname(entry.node.path)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/** Bolds the characters of the path that the query matched. */
function highlight(name: string, path: string, matches: number[]): JSX.Element[] {
  const offset = path.length - name.length
  const relevant = new Set(matches.map((index) => index - offset).filter((index) => index >= 0))
  return name.split('').map((char, index) => (
    <span key={index} className={relevant.has(index) ? 'quick-open__hit' : undefined}>
      {char}
    </span>
  ))
}
