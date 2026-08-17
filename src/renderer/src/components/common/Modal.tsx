import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import './Modal.css'

interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** Fills the available height, for dialogs with their own scroll areas. */
  tall?: boolean
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 520,
  tall
}: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  useEffect(() => {
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-no-autofocus])'
    )
    focusable?.focus()
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal${tall ? ' modal--tall' : ''}`}
        style={{ width }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div className="modal__titles">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="btn btn--ghost btn--icon" onClick={onClose} title="Close" data-no-autofocus>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
