import { useEffect, useRef, useState } from 'react'
import type { SearchResults } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { formatDuration } from '../lib/paths'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { reportError } from '../state/ui-store'
import { Icon, fileIconFor } from './common/Icon'
import './SearchPanel.css'

export function SearchPanel(): JSX.Element {
  const projectRef = useProjectStore((state) => state.ref)
  const openFile = useEditorStore((state) => state.openFile)

  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = async (value: string): Promise<void> => {
    if (!projectRef || !value.trim()) {
      setResults(null)
      return
    }
    setBusy(true)
    const found = await attempt(
      api.search.run(projectRef.id, {
        query: value,
        caseSensitive,
        wholeWord,
        regex,
        include,
        exclude
      }),
      reportError
    )
    setBusy(false)
    setResults(found)
  }

  // Search as you type, but only once typing pauses.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void run(query), 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regex, include, exclude])

  return (
    <div className="search-panel">
      <div className="search-panel__form">
        <div className="search-panel__row">
          <input
            ref={inputRef}
            className="input"
            placeholder="Search in project"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run(query)
            }}
          />
        </div>
        <div className="search-panel__toggles">
          <button
            className={`search-panel__toggle${caseSensitive ? ' search-panel__toggle--on' : ''}`}
            title="Match case"
            onClick={() => setCaseSensitive((value) => !value)}
          >
            Aa
          </button>
          <button
            className={`search-panel__toggle${wholeWord ? ' search-panel__toggle--on' : ''}`}
            title="Match whole word"
            onClick={() => setWholeWord((value) => !value)}
          >
            ab
          </button>
          <button
            className={`search-panel__toggle${regex ? ' search-panel__toggle--on' : ''}`}
            title="Use a regular expression"
            onClick={() => setRegex((value) => !value)}
          >
            .*
          </button>
          <div className="bottom-panel__spacer" />
          <button
            className={`search-panel__toggle${showFilters ? ' search-panel__toggle--on' : ''}`}
            title="Filter by file name"
            onClick={() => setShowFilters((value) => !value)}
          >
            <Icon name="filter" size={12} />
          </button>
        </div>

        {showFilters ? (
          <div className="search-panel__filters">
            <input
              className="input"
              placeholder="Files to include, e.g. *.tex"
              value={include}
              onChange={(event) => setInclude(event.target.value)}
            />
            <input
              className="input"
              placeholder="Files to exclude"
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="search-panel__status">
        {busy ? (
          <>
            <span className="spinner" /> Searching...
          </>
        ) : results ? (
          results.totalMatches === 0 ? (
            'No results'
          ) : (
            <>
              {results.totalMatches} result{results.totalMatches === 1 ? '' : 's'} in{' '}
              {results.files.length} file{results.files.length === 1 ? '' : 's'}
              <span className="search-panel__timing">
                {formatDuration(results.durationMs)}
                {results.truncated ? ' (truncated)' : ''}
              </span>
            </>
          )
        ) : (
          'Type to search across every text file in the project.'
        )}
      </div>

      <div className="search-panel__results">
        {results?.files.map((file) => {
          const isCollapsed = collapsed.has(file.file)
          return (
            <div key={file.file}>
              <button
                className="search-panel__file"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current)
                    if (next.has(file.file)) next.delete(file.file)
                    else next.add(file.file)
                    return next
                  })
                }
              >
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                <Icon name={fileIconFor(file.file)} size={13} />
                <span className="truncate">{file.file}</span>
                <span className="search-panel__badge">{file.matches.length}</span>
              </button>
              {!isCollapsed
                ? file.matches.map((match, index) => {
                    const before = match.preview.slice(
                      0,
                      Math.max(0, match.column - 1 - match.previewOffset)
                    )
                    const hit = match.preview.slice(
                      Math.max(0, match.column - 1 - match.previewOffset),
                      Math.max(0, match.column - 1 - match.previewOffset) + match.length
                    )
                    const after = match.preview.slice(
                      Math.max(0, match.column - 1 - match.previewOffset) + match.length
                    )
                    return (
                      <button
                        key={index}
                        className="search-panel__match"
                        onClick={() =>
                          void openFile(file.file, {
                            line: match.line,
                            column: match.column,
                            highlight: true
                          })
                        }
                      >
                        <span className="search-panel__line">{match.line}</span>
                        <span className="search-panel__text mono truncate">
                          {before}
                          <mark>{hit}</mark>
                          {after}
                        </span>
                      </button>
                    )
                  })
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
