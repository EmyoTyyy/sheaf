import type { AppError, Result } from '@shared/types'

export const api = window.sheaf

/** Turns a failed Result into a thrown AppError. */
export class ApiError extends Error {
  constructor(readonly appError: AppError) {
    super(`${appError.title}: ${appError.detail}`)
    this.name = 'ApiError'
  }
}

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new ApiError(result.error)
  return result.value
}

export function toAppError(error: unknown): AppError {
  if (error instanceof ApiError) return error.appError
  return {
    code: 'UNKNOWN',
    title: 'Something went wrong',
    detail: error instanceof Error ? error.message : String(error)
  }
}

/**
 * Runs a call and returns null instead of throwing. Used where a failure has
 * already been reported to the user or is not worth interrupting them for.
 */
export async function attempt<T>(
  promise: Promise<Result<T>>,
  onError?: (error: AppError) => void
): Promise<T | null> {
  const result = await promise
  if (result.ok) return result.value
  onError?.(result.error)
  return null
}
