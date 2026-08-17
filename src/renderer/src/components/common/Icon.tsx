import type { CSSProperties } from 'react'

/**
 * A small inline icon set. Everything is drawn from path data so the
 * application has no image assets to load and works entirely offline.
 */

const PATHS: Record<string, string> = {
  'chevron-right': 'M6 3.5 10.5 8 6 12.5',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6',
  'chevron-up': 'M3.5 10 8 5.5 12.5 10',
  'chevron-left': 'M10 3.5 5.5 8 10 12.5',
  folder: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z',
  file: 'M4 2h5l3 3v9H4z M9 2v3h3',
  'file-tex': 'M4 2h5l3 3v9H4z M9 2v3h3 M6 9h4 M8 9v3',
  'file-bib': 'M4 2h5l3 3v9H4z M9 2v3h3 M6 8.5h4 M6 10.5h4',
  'file-image': 'M3 3h10v10H3z M3 10.5 6 8l2.5 2 2-1.5L13 11 M10 5.5h.01',
  'file-pdf': 'M4 2h5l3 3v9H4z M9 2v3h3 M6 10c2 0 3.5-1.5 3.5-3',
  'file-code': 'M4 2h5l3 3v9H4z M9 2v3h3 M6.5 8.5 5.5 10l1 1.5 M9.5 8.5l1 1.5-1 1.5',
  plus: 'M8 3.5v9 M3.5 8h9',
  'new-file': 'M4 2h4l3 3v3 M8 2v3h3 M4 2v12h4 M11.5 10v5 M9 12.5h5',
  'new-folder': 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 6v2 M2 6v5.5A1.5 1.5 0 0 0 3.5 13H8 M11.5 9.5v5 M9 12h5',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M10.6 10.6 14 14',
  files: 'M5 2h4l3 3v7H5z M9 2v3h3 M3 4.5V14h7',
  git: 'M4 3v10 M4 3a1.5 1.5 0 1 0 0 .01 M4 13a1.5 1.5 0 1 0 0 .01 M11 6a1.5 1.5 0 1 0 0 .01 M11 7.5v1A2.5 2.5 0 0 1 8.5 11H4',
  outline: 'M3 4h10 M5 8h8 M7 12h6',
  play: 'M4.5 3 12.5 8l-8 5z',
  stop: 'M4 4h8v8H4z',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.7 M13 2.5V5h-2.5',
  settings:
    'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M13 8c0-.4 0-.8-.1-1.1l1.2-.9-1.3-2.2-1.4.5a4.8 4.8 0 0 0-1.9-1.1L9.3 1.5H6.7l-.2 1.7a4.8 4.8 0 0 0-1.9 1.1l-1.4-.5-1.3 2.2 1.2.9a5 5 0 0 0 0 2.2l-1.2.9 1.3 2.2 1.4-.5c.5.5 1.2.9 1.9 1.1l.2 1.7h2.6l.2-1.7c.7-.2 1.4-.6 1.9-1.1l1.4.5 1.3-2.2-1.2-.9c.1-.3.1-.7.1-1.1z',
  close: 'M4 4l8 8 M12 4l-8 8',
  more: 'M3.5 8h.01 M8 8h.01 M12.5 8h.01',
  trash: 'M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5 5 13.5h6l.5-9',
  pencil: 'M11.5 2.5 13.5 4.5 5.5 12.5 3 13l.5-2.5z',
  download: 'M8 2.5v8 M4.5 7.5 8 11l3.5-3.5 M3 13.5h10',
  upload: 'M8 11.5v-8 M4.5 6.5 8 3l3.5 3.5 M3 13.5h10',
  'error': 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z M8 5v4 M8 11h.01',
  warning: 'M8 2 15 13.5H1z M8 6.5v3 M8 11.5h.01',
  info: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z M8 7.5v3.5 M8 5h.01',
  check: 'M3 8.5 6.5 12 13 4.5',
  'panel-left': 'M2 3h12v10H2z M6 3v10',
  'panel-bottom': 'M2 3h12v10H2z M2 10h12',
  'panel-right': 'M2 3h12v10H2z M10 3v10',
  'zoom-in': 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M10.6 10.6 14 14 M7 5v4 M5 7h4',
  'zoom-out': 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M10.6 10.6 14 14 M5 7h4',
  'fit-width': 'M2 4v8 M14 4v8 M4 8h8 M4 8l1.5-1.5M4 8l1.5 1.5 M12 8l-1.5-1.5M12 8l-1.5 1.5',
  'fit-page': 'M3 3h10v10H3z M6 6h4v4H6z',
  terminal: 'M2 3h12v10H2z M4.5 6.5 6.5 8l-2 1.5 M8.5 10h3',
  'external-link': 'M9 3h4v4 M13 3 7.5 8.5 M11 9.5V13H3V5h3.5',
  sync: 'M8 13A5 5 0 1 0 8 3a5 5 0 0 0 0 10z M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M8 1v2 M8 13v2 M1 8h2 M13 8h2',
  book: 'M3 3h4a2 2 0 0 1 2 2v8a1.5 1.5 0 0 0-1.5-1.5H3z M13 3H9a2 2 0 0 0-2 2v8a1.5 1.5 0 0 1 1.5-1.5H13z',
  save: 'M3 3h8l2 2v8H3z M5.5 3v3.5h5V3 M5.5 13v-3.5h5V13',
  'arrow-left': 'M12 8H4 M7 4.5 3.5 8 7 11.5',
  'arrow-right': 'M4 8h8 M9 4.5 12.5 8 9 11.5',
  maximize: 'M3 6V3h3 M10 3h3v3 M13 10v3h-3 M6 13H3v-3',
  minimize: 'M6 3v3H3 M13 6h-3V3 M10 13v-3h3 M3 10h3v3',
  'collapse-all': 'M2.5 8h11 M5.5 2.5 8 5 10.5 2.5 M5.5 13.5 8 11 10.5 13.5',
  filter: 'M2 4h12 M4.5 8h7 M6.5 12h3',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z M8 5v3.5l2 1.5',
  copy: 'M5.5 5.5h8v8h-8z M2.5 10.5v-8h8',
  folder_open: 'M2 12.5V4a1 1 0 0 1 1-1h3l1.5 1.5H12a1 1 0 0 1 1 1v1.5 M2 12.5 4 7h11l-2 5.5z'
}

export type IconName = keyof typeof PATHS

interface IconProps {
  name: string
  size?: number
  className?: string
  style?: CSSProperties
  title?: string
  /** Filled icons (play, stop) need no stroke. */
  filled?: boolean
}

export function Icon({ name, size = 14, className, style, title, filled }: IconProps): JSX.Element {
  const path = PATHS[name] ?? PATHS.file
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none', ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  )
}

/** Picks the right file icon for a project file. */
export function fileIconFor(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tex') || lower.endsWith('.ltx') || lower.endsWith('.latex')) return 'file-tex'
  if (lower.endsWith('.bib')) return 'file-bib'
  if (lower.endsWith('.pdf')) return 'file-pdf'
  if (lower.endsWith('.sty') || lower.endsWith('.cls') || lower.endsWith('.bst')) return 'file-code'
  if (/\.(png|jpe?g|gif|bmp|webp|svg|eps)$/.test(lower)) return 'file-image'
  return 'file'
}
