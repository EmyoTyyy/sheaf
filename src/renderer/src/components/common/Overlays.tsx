import { useEffect, useState } from 'react'
import { useUiStore } from '../../state/ui-store'
import { Icon } from './Icon'
import { Modal } from './Modal'
import './Overlays.css'

const SEVERITY_ICON: Record<string, string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  success: 'check'
}

export function Toasts(): JSX.Element {
  const toasts = useUiStore((state) => state.toasts)
  const dismiss = useUiStore((state) => state.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.severity}`} key={toast.id} role="status">
          <Icon name={SEVERITY_ICON[toast.severity] ?? 'info'} size={15} className="toast__icon" />
          <div className="toast__content">
            <div className="toast__title">{toast.title}</div>
            {toast.detail ? <div className="toast__detail">{toast.detail}</div> : null}
            {toast.action ? <div className="toast__action">{toast.action}</div> : null}
            {toast.actionLabel && toast.onAction ? (
              <button
                className="btn btn--ghost toast__button"
                onClick={() => {
                  toast.onAction?.()
                  dismiss(toast.id)
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
          <button
            className="btn btn--ghost btn--icon toast__close"
            onClick={() => dismiss(toast.id)}
            title="Dismiss"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog(): JSX.Element | null {
  const request = useUiStore((state) => state.confirmRequest)
  const resolve = useUiStore((state) => state.resolveConfirm)
  if (!request) return null

  return (
    <Modal title={request.title} onClose={() => resolve(false)} width={440}>
      <p className="confirm__message">{request.message}</p>
      <div className="confirm__actions">
        <button className="btn" onClick={() => resolve(false)}>
          Cancel
        </button>
        <button
          className={`btn ${request.danger ? 'btn--danger' : 'btn--primary'}`}
          onClick={() => resolve(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function PromptDialog(): JSX.Element | null {
  const request = useUiStore((state) => state.promptRequest)
  const resolve = useUiStore((state) => state.resolvePrompt)
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue(request?.initialValue ?? '')
  }, [request])

  if (!request) return null

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    resolve(trimmed)
  }

  return (
    <Modal title={request.title} onClose={() => resolve(null)} width={420}>
      <label className="field">
        <span className="field__label">{request.label}</span>
        <input
          className="input"
          value={value}
          placeholder={request.placeholder}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </label>
      <div className="confirm__actions">
        <button className="btn" onClick={() => resolve(null)}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={!value.trim()}>
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
