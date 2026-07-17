import {
  app,
  BrowserWindow,
  desktopCapturer,
  screen,
  type NativeImage,
  type Rectangle
} from 'electron'
import { join } from 'node:path'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { ScanProgress, ScanResult, SelectionRect } from '../shared/types'
import { SpellChecker } from './spell-checker'

let workerPromise: Promise<Worker> | undefined

export type CapturedScreen = {
  image: NativeImage
  displayBounds: Rectangle
  displayWidth: number
  displayHeight: number
  screenName: string
}

function sendProgress(progress: ScanProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('scan-progress', progress)
  }
}

function tessdataPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tessdata')
    : join(app.getAppPath(), 'resources', 'tessdata')
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['pol', 'eng'], OEM.LSTM_ONLY, {
      langPath: tessdataPath(),
      cacheMethod: 'none',
      logger: ({ status, progress }) => sendProgress({ status, progress })
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1'
      })
      return worker
    })
  }

  return workerPromise
}

export async function captureActiveScreen(): Promise<CapturedScreen> {
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const pixelWidth = Math.round(cursorDisplay.size.width * cursorDisplay.scaleFactor)
  const pixelHeight = Math.round(cursorDisplay.size.height * cursorDisplay.scaleFactor)

  sendProgress({ status: 'Przechwytywanie ekranu', progress: 0.02 })
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: pixelWidth, height: pixelHeight }
  })

  const source =
    sources.find((candidate) => candidate.display_id === String(cursorDisplay.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Nie udało się przechwycić ekranu. Sprawdź uprawnienia nagrywania ekranu.')
  }

  return {
    image: source.thumbnail,
    displayBounds: cursorDisplay.bounds,
    displayWidth: cursorDisplay.size.width,
    displayHeight: cursorDisplay.size.height,
    screenName: cursorDisplay.label || source.name
  }
}

export async function scanCapturedRegion(
  captured: CapturedScreen,
  selection: SelectionRect,
  getSpellChecker: () => Promise<SpellChecker>
): Promise<ScanResult> {
  const startedAt = performance.now()
  const imageSize = captured.image.getSize()
  const scaleX = imageSize.width / captured.displayWidth
  const scaleY = imageSize.height / captured.displayHeight
  const crop = {
    x: Math.max(0, Math.round(selection.x * scaleX)),
    y: Math.max(0, Math.round(selection.y * scaleY)),
    width: Math.min(imageSize.width, Math.max(1, Math.round(selection.width * scaleX))),
    height: Math.min(imageSize.height, Math.max(1, Math.round(selection.height * scaleY)))
  }
  crop.width = Math.min(crop.width, imageSize.width - crop.x)
  crop.height = Math.min(crop.height, imageSize.height - crop.y)

  const screenshot = captured.image.crop(crop).toPNG()
  if (screenshot.length === 0) throw new Error('Zaznaczony obszar jest pusty.')

  sendProgress({ status: 'Rozpoznawanie tekstu', progress: 0.05 })
  const [worker, spellChecker] = await Promise.all([getWorker(), getSpellChecker()])
  const recognition = await worker.recognize(screenshot)
  const text = recognition.data.text.trim()
  const issues = spellChecker.check(text)

  sendProgress({ status: 'Gotowe', progress: 1 })
  return {
    text,
    issues,
    confidence: recognition.data.confidence,
    durationMs: Math.round(performance.now() - startedAt),
    screenName: captured.screenName
  }
}

export async function stopScanner(): Promise<void> {
  if (!workerPromise) return
  const worker = await workerPromise
  await worker.terminate()
  workerPromise = undefined
}
