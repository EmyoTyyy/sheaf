import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'
import type { SyncForwardResult } from '@shared/types'
import { api } from '../lib/ipc'
import { runCommand } from '../lib/commands'
import { useBuildStore } from '../state/build-store'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { useSettingsStore } from '../state/settings-store'
import { useUiStore } from '../state/ui-store'
import { Icon } from './common/Icon'
import './PdfPane.css'

// The viewer owns the worker rather than letting each load own it. A loading
// task destroys the worker it created when it is torn down, and with a shared
// worker port that teardown poisons the port for every later document: the
// next getDocument() throws "the worker is being destroyed" from inside an
// effect, which unmounts the window. Handing every task a worker it does not
// own keeps recompiles working.
const pdfWorker = pdfjs.PDFWorker.fromPort({ port: new PdfWorker() })

/** Bundled so the viewer works with no network access. */
const PDF_ASSET_BASE = new URL('./pdfjs/', document.baseURI).href

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
const PAGE_GAP = 12

type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

interface Highlight {
  page: number
  x: number
  y: number
  width: number
  height: number
  nonce: number
}

interface SearchHit {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export function PdfPane(): JSX.Element {
  const pdfData = useBuildStore((state) => state.pdf)
  const pdfVersion = useBuildStore((state) => state.pdfVersion)
  const status = useBuildStore((state) => state.status)
  const pdfStale = useBuildStore((state) => state.pdfStale)
  const loadExistingPdf = useBuildStore((state) => state.loadExistingPdf)
  const projectRef = useProjectStore((state) => state.ref)
  const pdfSettings = useSettingsStore((state) => state.settings?.pdf)
  const theme = useSettingsStore((state) => state.resolvedTheme)
  const pushToast = useUiStore((state) => state.pushToast)

  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)

  const [document_, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[]>([])
  const [scale, setScale] = useState(1)
  const [zoomMode, setZoomMode] = useState<ZoomMode>(() =>
    pdfSettings?.zoomBehavior === 'fit-page'
      ? 'fit-page'
      : pdfSettings?.zoomBehavior === 'actual'
        ? 'custom'
        : 'fit-width'
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  /* ---------------- document loading ---------------- */

  useEffect(() => {
    if (!pdfData || pdfData.length === 0) {
      setDocument(null)
      setPageSizes([])
      return
    }

    let cancelled = false
    // Remember where the reader was, so a recompile does not scroll to page 1.
    const container = scrollRef.current
    const previousRatio =
      container && container.scrollHeight > 0
        ? container.scrollTop / container.scrollHeight
        : 0

    // pdf.js takes ownership of the buffer, so it is always given a copy.
    let task: pdfjs.PDFDocumentLoadingTask
    try {
      task = pdfjs.getDocument({
        data: pdfData.slice(),
        worker: pdfWorker,
        cMapUrl: `${PDF_ASSET_BASE}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDF_ASSET_BASE}standard_fonts/`,
        isEvalSupported: false
      })
    } catch (error) {
      // Throwing from an effect would tear the window down, so a viewer that
      // cannot start reports itself instead.
      setLoadError(error instanceof Error ? error.message : String(error))
      return
    }

    task.promise
      .then(async (doc) => {
        if (cancelled) {
          void doc.destroy()
          return
        }
        const sizes: { width: number; height: number }[] = []
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
          const page = await doc.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1 })
          sizes.push({ width: viewport.width, height: viewport.height })
        }
        if (cancelled) {
          void doc.destroy()
          return
        }
        documentRef.current?.destroy()
        documentRef.current = doc
        setDocument(doc)
        setPageSizes(sizes)
        setLoadError(null)
        setSearchHits([])

        requestAnimationFrame(() => {
          const element = scrollRef.current
          if (element && previousRatio > 0) {
            element.scrollTop = previousRatio * element.scrollHeight
          }
        })
      })
      .catch((error: Error) => {
        if (cancelled) return
        setLoadError(error.message)
      })

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [pdfData, pdfVersion])

  useEffect(
    () => () => {
      documentRef.current?.destroy()
      documentRef.current = null
    },
    []
  )

  /* ---------------- sizing ---------------- */

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setContainerWidth(rect.width)
      setContainerHeight(rect.height)
    })
    observer.observe(element)
    setContainerWidth(element.clientWidth)
    setContainerHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [document_])

  const effectiveScale = useMemo(() => {
    if (pageSizes.length === 0 || containerWidth === 0) return scale
    const first = pageSizes[0]
    if (zoomMode === 'fit-width') return Math.max(0.1, (containerWidth - 32) / first.width)
    if (zoomMode === 'fit-page') {
      return Math.max(
        0.1,
        Math.min((containerWidth - 32) / first.width, (containerHeight - 28) / first.height)
      )
    }
    return scale
  }, [zoomMode, scale, pageSizes, containerWidth, containerHeight])

  /* ---------------- page tracking ---------------- */

  const onScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || pageSizes.length === 0) return
    const middle = container.scrollTop + container.clientHeight / 3
    let offset = 0
    for (let index = 0; index < pageSizes.length; index += 1) {
      const height = pageSizes[index].height * effectiveScale + PAGE_GAP
      if (middle < offset + height) {
        setCurrentPage(index + 1)
        return
      }
      offset += height
    }
    setCurrentPage(pageSizes.length)
  }, [pageSizes, effectiveScale])

  const scrollToPage = useCallback(
    (pageNumber: number, offsetY = 0) => {
      const container = scrollRef.current
      if (!container || pageSizes.length === 0) return
      let offset = 0
      for (let index = 0; index < pageNumber - 1 && index < pageSizes.length; index += 1) {
        offset += pageSizes[index].height * effectiveScale + PAGE_GAP
      }
      container.scrollTo({
        top: Math.max(0, offset + offsetY * effectiveScale - 60),
        behavior: 'auto'
      })
    },
    [pageSizes, effectiveScale]
  )

  /* ---------------- forward search from the editor ---------------- */

  useEffect(() => {
    let nonce = 0
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<SyncForwardResult>).detail
      if (!detail) return
      nonce += 1
      const highlightEnabled =
        useSettingsStore.getState().settings?.pdf.highlightSync !== false
      if (highlightEnabled) {
        setHighlight({
          page: detail.page,
          x: detail.x,
          y: detail.y,
          width: detail.width,
          height: detail.height,
          nonce
        })
      }
      scrollToPage(detail.page, Math.max(0, detail.y - 120))
    }
    window.addEventListener('sheaf:sync-forward', handler)
    return () => window.removeEventListener('sheaf:sync-forward', handler)
  }, [scrollToPage])

  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 2600)
    return () => clearTimeout(timer)
  }, [highlight])

  /* ---------------- inverse search ---------------- */

  const onPageClick = useCallback(
    async (pageNumber: number, xPoints: number, yPoints: number) => {
      if (!projectRef) return
      const result = await api.sync.inverse(projectRef.id, pageNumber, xPoints, yPoints)
      if (!result.ok) {
        pushToast({
          severity: 'info',
          title: result.error.title,
          detail: result.error.detail,
          action: result.error.action
        })
        return
      }
      await useEditorStore.getState().openFile(result.value.file, {
        line: result.value.line,
        column: result.value.column,
        highlight: true
      })
    },
    [projectRef, pushToast]
  )

  /* ---------------- search inside the PDF ---------------- */

  const runSearch = useCallback(
    async (query: string) => {
      const doc = documentRef.current
      if (!doc || !query.trim()) {
        setSearchHits([])
        return
      }
      setSearching(true)
      const needle = query.toLowerCase()
      const hits: SearchHit[] = []

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        const content = await page.getTextContent()
        for (const item of content.items) {
          if (!('str' in item) || !item.str) continue
          const text = item.str.toLowerCase()
          let from = text.indexOf(needle)
          while (from !== -1) {
            // transform is [a, b, c, d, e, f]; e/f are the text origin.
            const [, , , , e, f] = item.transform as number[]
            const charWidth = item.width / Math.max(1, item.str.length)
            hits.push({
              page: pageNumber,
              x: e + charWidth * from,
              y: viewport.height - f - item.height,
              width: charWidth * needle.length,
              height: item.height || 10
            })
            from = text.indexOf(needle, from + needle.length)
          }
        }
        if (hits.length > 500) break
      }

      setSearchHits(hits)
      setSearchIndex(0)
      setSearching(false)
      if (hits.length > 0) scrollToPage(hits[0].page, Math.max(0, hits[0].y - 120))
    },
    [scrollToPage]
  )

  const gotoHit = useCallback(
    (delta: number) => {
      if (searchHits.length === 0) return
      const next = (searchIndex + delta + searchHits.length) % searchHits.length
      setSearchIndex(next)
      const hit = searchHits[next]
      scrollToPage(hit.page, Math.max(0, hit.y - 120))
    },
    [searchHits, searchIndex, scrollToPage]
  )

  /* ---------------- toolbar actions ---------------- */

  const zoomBy = (direction: 1 | -1): void => {
    const current = effectiveScale
    const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
    const next = steps.find((step) => (direction > 0 ? step > current + 0.001 : step < current - 0.001))
    setZoomMode('custom')
    setScale(next ?? current)
  }

  const toggleFullscreen = (): void => {
    const element = rootRef.current
    if (!element) return
    if (window.document.fullscreenElement) void window.document.exitFullscreen()
    else void element.requestFullscreen()
  }

  /* ---------------- full screen ---------------- */

  // The zoom the reader had beside the editor is theirs; the one they pick to
  // read a whole page on a whole screen belongs to full screen. So it is put
  // back on the way out, whether they leave through the button or with Escape.
  const zoomNow = useRef({ mode: zoomMode, scale })
  const zoomBeforeFullscreen = useRef<{ mode: ZoomMode; scale: number } | null>(null)

  useEffect(() => {
    zoomNow.current = { mode: zoomMode, scale }
  }, [zoomMode, scale])

  useEffect(() => {
    const onFullscreenChange = (): void => {
      const active = window.document.fullscreenElement === rootRef.current
      setFullscreen(active)
      if (active) {
        zoomBeforeFullscreen.current = zoomNow.current
      } else if (zoomBeforeFullscreen.current) {
        setZoomMode(zoomBeforeFullscreen.current.mode)
        setScale(zoomBeforeFullscreen.current.scale)
        zoomBeforeFullscreen.current = null
      }
    }
    window.document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => window.document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const invert = pdfSettings?.invertInDarkMode && theme === 'dark'

  return (
    <div className="pdf-pane" ref={rootRef}>
      <div className="pdf-toolbar">
        <button
          className={`btn btn--ghost btn--icon${thumbnailsOpen ? ' btn--on' : ''}`}
          title="Page thumbnails"
          onClick={() => setThumbnailsOpen((open) => !open)}
          disabled={!document_}
        >
          <Icon name="panel-left" />
        </button>
        <div className="divider" />
        <button
          className="btn btn--ghost btn--icon"
          title="Previous page"
          disabled={!document_ || currentPage <= 1}
          onClick={() => scrollToPage(currentPage - 1)}
        >
          <Icon name="chevron-up" />
        </button>
        <div className="pdf-toolbar__pages">
          <input
            className="input pdf-toolbar__page-input"
            value={currentPage}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10)
              if (Number.isFinite(value)) {
                setCurrentPage(value)
                scrollToPage(value)
              }
            }}
            disabled={!document_}
          />
          <span className="pdf-toolbar__page-total">/ {document_?.numPages ?? 0}</span>
        </div>
        <button
          className="btn btn--ghost btn--icon"
          title="Next page"
          disabled={!document_ || currentPage >= (document_?.numPages ?? 0)}
          onClick={() => scrollToPage(currentPage + 1)}
        >
          <Icon name="chevron-down" />
        </button>

        <div className="divider" />

        <button className="btn btn--ghost btn--icon" title="Zoom out" onClick={() => zoomBy(-1)}>
          <Icon name="zoom-out" />
        </button>
        <button
          className="btn btn--ghost pdf-toolbar__zoom"
          title="Reset to 100%"
          onClick={() => {
            setZoomMode('custom')
            setScale(1)
          }}
        >
          {Math.round(effectiveScale * 100)}%
        </button>
        <button className="btn btn--ghost btn--icon" title="Zoom in" onClick={() => zoomBy(1)}>
          <Icon name="zoom-in" />
        </button>
        <button
          className={`btn btn--ghost btn--icon${zoomMode === 'fit-width' ? ' btn--on' : ''}`}
          title="Fit width"
          onClick={() => setZoomMode('fit-width')}
        >
          <Icon name="fit-width" />
        </button>
        <button
          className={`btn btn--ghost btn--icon${zoomMode === 'fit-page' ? ' btn--on' : ''}`}
          title="Fit page"
          onClick={() => setZoomMode('fit-page')}
        >
          <Icon name="fit-page" />
        </button>

        <div className="pdf-toolbar__spacer" />

        <button
          className={`btn btn--ghost btn--icon${searchOpen ? ' btn--on' : ''}`}
          title="Search in the PDF"
          onClick={() => setSearchOpen((open) => !open)}
          disabled={!document_}
        >
          <Icon name="search" />
        </button>
        <button
          className="btn btn--ghost btn--icon"
          title="Export PDF"
          onClick={() => runCommand('export-pdf')}
          disabled={!document_}
        >
          <Icon name="download" />
        </button>
        <button
          className="btn btn--ghost btn--icon"
          title={fullscreen ? 'Leave full screen' : 'Full screen'}
          onClick={toggleFullscreen}
        >
          <Icon name={fullscreen ? 'minimize' : 'maximize'} />
        </button>
        {pdfStale ? (
          <button
            className="btn pdf-toolbar__stale"
            title="A newer build is available. Auto-refresh is off in Settings > PDF."
            onClick={() => void loadExistingPdf()}
          >
            <Icon name="download" size={12} />
            Load new build
          </button>
        ) : null}
        <button
          className="btn btn--ghost btn--icon"
          title="Recompile"
          onClick={() => runCommand('compile')}
          disabled={status === 'running'}
        >
          <Icon name="refresh" />
        </button>
      </div>

      {searchOpen ? (
        <div className="pdf-search">
          <Icon name="search" size={13} />
          <input
            className="input"
            autoFocus
            placeholder="Find in document"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (searchHits.length > 0) gotoHit(event.shiftKey ? -1 : 1)
                else void runSearch(searchQuery)
              } else if (event.key === 'Escape') {
                setSearchOpen(false)
              }
            }}
          />
          <span className="pdf-search__count">
            {searching
              ? 'Searching...'
              : searchHits.length > 0
                ? `${searchIndex + 1} of ${searchHits.length}`
                : searchQuery
                  ? 'No results'
                  : ''}
          </span>
          <button className="btn btn--ghost btn--icon" onClick={() => gotoHit(-1)} disabled={searchHits.length === 0}>
            <Icon name="chevron-up" />
          </button>
          <button className="btn btn--ghost btn--icon" onClick={() => gotoHit(1)} disabled={searchHits.length === 0}>
            <Icon name="chevron-down" />
          </button>
          <button className="btn btn--ghost btn--icon" onClick={() => setSearchOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      <div className="pdf-pane__body">
        {thumbnailsOpen && document_ ? (
          <Thumbnails
            document={document_}
            pageSizes={pageSizes}
            currentPage={currentPage}
            onSelect={(page) => scrollToPage(page)}
          />
        ) : null}

        <div className="pdf-scroll" ref={scrollRef} onScroll={onScroll}>
          {!document_ ? (
            <PdfPlaceholder error={loadError} status={status} />
          ) : (
            <div className={`pdf-pages${invert ? ' pdf-pages--invert' : ''}`}>
              {pageSizes.map((size, index) => (
                <PdfPage
                  key={index}
                  document={document_}
                  revision={pdfVersion}
                  pageNumber={index + 1}
                  size={size}
                  scale={effectiveScale}
                  highlight={highlight?.page === index + 1 ? highlight : null}
                  searchHits={searchHits.filter((hit) => hit.page === index + 1)}
                  activeHit={
                    searchHits[searchIndex]?.page === index + 1 ? searchHits[searchIndex] : null
                  }
                  onClick={onPageClick}
                  hint={!fullscreen}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PdfPlaceholder({
  error,
  status
}: {
  error: string | null
  status: string
}): JSX.Element {
  const latex = useBuildStore((state) => state.latex)

  if (error) {
    return (
      <div className="empty-state">
        <Icon name="error" size={22} className="severity-error" />
        <h3>The PDF could not be displayed</h3>
        <p>{error}</p>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="empty-state">
        <div className="spinner" />
        <h3>Compiling</h3>
      </div>
    )
  }

  return (
    <div className="empty-state">
      <Icon name="file-pdf" size={22} />
      <h3>No preview yet</h3>
      {latex && !latex.detected ? (
        <p>
          No LaTeX distribution was found, so nothing can be compiled yet. Install TeX Live or
          MiKTeX, or point Sheaf at an existing installation in Settings.
        </p>
      ) : (
        <p>
          Press <span className="kbd">Ctrl</span> <span className="kbd">Enter</span> to compile the
          document. The result appears here.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* One page                                                            */
/* ------------------------------------------------------------------ */

interface PdfPageProps {
  document: PDFDocumentProxy
  /** Bumped on every reload so a recompiled page is repainted. */
  revision: number
  pageNumber: number
  size: { width: number; height: number }
  scale: number
  highlight: Highlight | null
  searchHits: SearchHit[]
  activeHit: SearchHit | null
  onClick: (pageNumber: number, x: number, y: number) => void
  /**
   * Whether to explain the click. Beside the editor the hint teaches the
   * gesture; filling the screen to read, a tooltip following the pointer over
   * the page is only in the way.
   */
  hint: boolean
}

function PdfPage({
  document,
  revision,
  pageNumber,
  size,
  scale,
  highlight,
  searchHits,
  activeHit,
  onClick,
  hint
}: PdfPageProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const renderedKey = useRef<string>('')

  const width = Math.round(size.width * scale)
  const height = Math.round(size.height * scale)

  // Only pages near the viewport are rendered, so long documents stay fast.
  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { root: element.closest('.pdf-scroll'), rootMargin: '400px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return

    const key = `${revision}:${pageNumber}:${scale.toFixed(3)}`
    if (renderedKey.current === key) return

    let cancelled = false
    let task: ReturnType<PDFPageProxy['render']> | null = null

    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const ratio = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: scale * ratio })
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      task = page.render({ canvasContext: context, viewport })
      task.promise
        .then(() => {
          if (!cancelled) renderedKey.current = key
        })
        .catch(() => {
          // Cancelled renders are expected while scrolling or zooming.
        })
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, document, revision, pageNumber, scale, width, height])

  return (
    <div
      className="pdf-page"
      ref={wrapperRef}
      style={{ width, height }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onClick(pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale)
      }}
      title={hint ? 'Click to jump to the matching line in the source' : undefined}
    >
      <canvas ref={canvasRef} className="pdf-page__canvas" />
      {highlight ? (
        <div
          className="pdf-page__highlight"
          key={highlight.nonce}
          style={{
            left: Math.max(0, (highlight.x - 2) * scale),
            top: Math.max(0, (highlight.y - highlight.height - 2) * scale),
            width: Math.max(6, (highlight.width || 60) * scale),
            height: Math.max(10, (highlight.height || 12) * scale + 4)
          }}
        />
      ) : null}
      {searchHits.map((hit, index) => (
        <div
          key={index}
          className={`pdf-page__hit${hit === activeHit ? ' pdf-page__hit--active' : ''}`}
          style={{
            left: hit.x * scale,
            top: hit.y * scale,
            width: Math.max(4, hit.width * scale),
            height: Math.max(8, hit.height * scale)
          }}
        />
      ))}
      <span className="pdf-page__number">{pageNumber}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Thumbnails                                                          */
/* ------------------------------------------------------------------ */

function Thumbnails({
  document,
  pageSizes,
  currentPage,
  onSelect
}: {
  document: PDFDocumentProxy
  pageSizes: { width: number; height: number }[]
  currentPage: number
  onSelect: (page: number) => void
}): JSX.Element {
  return (
    <div className="pdf-thumbs">
      {pageSizes.map((size, index) => (
        <Thumbnail
          key={index}
          document={document}
          pageNumber={index + 1}
          size={size}
          active={currentPage === index + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function Thumbnail({
  document,
  pageNumber,
  size,
  active,
  onSelect
}: {
  document: PDFDocumentProxy
  pageNumber: number
  size: { width: number; height: number }
  active: boolean
  onSelect: (page: number) => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLButtonElement>(null)
  const rendered = useRef(false)
  const width = 108
  const scale = width / size.width

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || rendered.current) return
      const canvas = canvasRef.current
      if (!canvas) return
      rendered.current = true
      void document.getPage(pageNumber).then((page) => {
        const viewport = page.getViewport({ scale })
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        page.render({ canvasContext: context, viewport }).promise.catch(() => undefined)
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [document, pageNumber, scale])

  useEffect(() => {
    if (active) wrapperRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      className={`pdf-thumb${active ? ' pdf-thumb--active' : ''}`}
      ref={wrapperRef}
      onClick={() => onSelect(pageNumber)}
    >
      <canvas ref={canvasRef} style={{ width, height: size.height * scale }} />
      <span>{pageNumber}</span>
    </button>
  )
}
