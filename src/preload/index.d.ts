import type { SheafApi } from '@shared/api'

declare global {
  interface Window {
    sheaf: SheafApi
  }
}

export {}
