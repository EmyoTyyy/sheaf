import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import './ContextMenu.css'

export interface MenuItem {
  id: string
  label?: string
  icon?: string
  separator?: boolean
  danger?: boolean
  disabled?: boolean
  shortcut?: string
  onSelect?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 6)
    const top = Math.min(y, window.innerHeight - rect.height - 6)
    setPosition({ left: Math.max(4, left), top: Math.max(4, top) })
  }, [x, y])

  useEffect(() => {
    const dismiss = (): void => onClose()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  return (
    <div
      className="context-menu"
      ref={ref}
      style={position}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {items.map((item, index) =>
        item.separator ? (
          <div className="context-menu__separator" key={`sep-${index}`} />
        ) : (
          <button
            key={item.id}
            className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect?.()
            }}
          >
            <span className="context-menu__icon">
              {item.icon ? <Icon name={item.icon} size={13} /> : null}
            </span>
            <span className="context-menu__label">{item.label}</span>
            {item.shortcut ? <span className="context-menu__shortcut">{item.shortcut}</span> : null}
          </button>
        )
      )}
    </div>
  )
}

/** Small hook that manages open/close state and the click position. */
export function useContextMenu(): {
  menu: { x: number; y: number; items: MenuItem[] } | null
  openMenu: (event: { clientX: number; clientY: number }, items: MenuItem[]) => void
  closeMenu: () => void
} {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  return {
    menu,
    openMenu: (event, items) => setMenu({ x: event.clientX, y: event.clientY, items }),
    closeMenu: () => setMenu(null)
  }
}
