/// <reference types="vite/client" />

import type { PreCheckerApi } from '../../shared/types'

declare global {
  interface Window {
    prechecker: PreCheckerApi
  }
}

export {}
