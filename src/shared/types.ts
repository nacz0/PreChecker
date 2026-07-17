export type SpellingIssue = {
  word: string
  normalized: string
  count: number
  suggestions: string[]
  occurrences?: TextOccurrence[]
}

export type TextOccurrence = {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export type ScanPreview = {
  imageDataUrl: string
  width: number
  height: number
}

export type ScanResult = {
  text: string
  issues: SpellingIssue[]
  confidence: number
  durationMs: number
  screenName: string
  preview: ScanPreview
}

export type ScanProgress = {
  status: string
  progress: number
}

export type SelectionRect = {
  x: number
  y: number
  width: number
  height: number
}

export type SelectionSetup = {
  imageDataUrl: string
}

export type ScanSource = 'button' | 'shortcut'

export type AppInfo = {
  shortcut: string
  platform: NodeJS.Platform
}

export interface PreCheckerApi {
  scanScreen(source?: ScanSource): Promise<ScanResult | null>
  addToDictionary(word: string): Promise<void>
  getAppInfo(): Promise<AppInfo>
  onScanRequested(callback: () => void): () => void
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  submitSelection(rect: SelectionRect): void
  cancelSelection(): void
  onSelectionSetup(callback: (setup: SelectionSetup) => void): () => void
}
