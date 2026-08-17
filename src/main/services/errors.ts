import type { AppError, AppErrorCode, Result } from '@shared/types'

/** Thrown internally; converted to an AppError at the IPC boundary. */
export class SheafError extends Error {
  readonly code: AppErrorCode
  readonly title: string
  readonly detail: string
  readonly action?: string
  readonly raw?: string

  constructor(error: Omit<AppError, 'raw'> & { raw?: string }) {
    super(`${error.title}: ${error.detail}`)
    this.name = 'SheafError'
    this.code = error.code
    this.title = error.title
    this.detail = error.detail
    this.action = error.action
    this.raw = error.raw
  }

  toAppError(): AppError {
    return {
      code: this.code,
      title: this.title,
      detail: this.detail,
      action: this.action,
      raw: this.raw
    }
  }
}

export function fail(
  code: AppErrorCode,
  title: string,
  detail: string,
  action?: string,
  raw?: string
): never {
  throw new SheafError({ code, title, detail, action, raw })
}

const NODE_ERROR_MAP: Record<string, { code: AppErrorCode; title: string; action?: string }> = {
  ENOENT: { code: 'NOT_FOUND', title: 'File not found' },
  EEXIST: { code: 'ALREADY_EXISTS', title: 'Already exists' },
  EACCES: {
    code: 'PERMISSION_DENIED',
    title: 'Permission denied',
    action: 'Check the file permissions, or choose a different location.'
  },
  EPERM: {
    code: 'PERMISSION_DENIED',
    title: 'Permission denied',
    action: 'Check the file permissions, or choose a different location.'
  },
  EISDIR: { code: 'NOT_FOUND', title: 'Expected a file but found a directory' },
  ENOTDIR: { code: 'NOT_FOUND', title: 'Expected a directory but found a file' },
  ENOTEMPTY: { code: 'ALREADY_EXISTS', title: 'Directory is not empty' },
  ENOSPC: {
    code: 'UNKNOWN',
    title: 'No space left on device',
    action: 'Free up disk space and try again.'
  },
  EROFS: { code: 'PERMISSION_DENIED', title: 'Read-only filesystem' },
  EMFILE: { code: 'UNKNOWN', title: 'Too many open files' },
  EBUSY: { code: 'PERMISSION_DENIED', title: 'File is in use by another program' }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof SheafError) return err.toAppError()

  const anyErr = err as NodeJS.ErrnoException | undefined
  const sysCode = anyErr?.code
  if (sysCode && NODE_ERROR_MAP[sysCode]) {
    const mapped = NODE_ERROR_MAP[sysCode]
    return {
      code: mapped.code,
      title: mapped.title,
      detail: anyErr?.path
        ? `${mapped.title} while accessing ${anyErr.path}.`
        : anyErr?.message || mapped.title,
      action: mapped.action,
      raw: anyErr?.message
    }
  }

  return {
    code: 'UNKNOWN',
    title: 'Something went wrong',
    detail: anyErr?.message ?? String(err),
    raw: anyErr?.stack
  }
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T = never>(error: AppError): Result<T> {
  return { ok: false, error }
}

/** Wraps a handler so it always resolves to a Result and never rejects. */
export function guard<A extends unknown[], T>(
  fn: (...args: A) => Promise<T> | T
): (...args: A) => Promise<Result<T>> {
  return async (...args: A) => {
    try {
      return ok(await fn(...args))
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code === 'UNKNOWN') {
        console.error('[sheaf] unhandled failure', error)
      }
      return err(appError)
    }
  }
}
