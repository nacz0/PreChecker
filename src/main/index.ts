import { app, BrowserWindow, globalShortcut, ipcMain, shell, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import type { SelectionRect } from '../shared/types'
import {
  captureActiveScreen,
  scanCapturedRegion,
  stopScanner,
  type CapturedScreen
} from './scanner'
import { SpellChecker } from './spell-checker'

const SHORTCUT = 'CommandOrControl+Shift+K'
let mainWindow: BrowserWindow | null = null
let selectionWindow: BrowserWindow | null = null
let spellCheckerPromise: Promise<SpellChecker> | undefined
let scanInProgress = false

function getSpellChecker(): Promise<SpellChecker> {
  if (!spellCheckerPromise) {
    spellCheckerPromise = Promise.resolve().then(async () => {
      const checker = new SpellChecker(join(app.getPath('userData'), 'custom-words.json'))
      await checker.load()
      return checker
    })
  }
  return spellCheckerPromise
}

function loadRendererPage(window: BrowserWindow, page: 'index.html' | 'overlay.html'): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const baseUrl = process.env.ELECTRON_RENDERER_URL.endsWith('/')
      ? process.env.ELECTRON_RENDERER_URL
      : `${process.env.ELECTRON_RENDERER_URL}/`
    void window.loadURL(new URL(page, baseUrl).toString())
  } else {
    void window.loadFile(join(__dirname, `../renderer/${page}`))
  }
}

function createWindow(showOnReady = true): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 680,
    minHeight: 560,
    show: false,
    backgroundColor: '#f4f2ec',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window

  window.once('ready-to-show', () => {
    if (showOnReady) window.show()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRendererPage(window, 'index.html')
  return window
}

function revealWindow(): void {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function normalizeSelection(rect: SelectionRect, captured: CapturedScreen): SelectionRect | null {
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (!values.every(Number.isFinite)) return null

  const x = Math.max(0, Math.min(captured.displayWidth, rect.x))
  const y = Math.max(0, Math.min(captured.displayHeight, rect.y))
  const width = Math.max(0, Math.min(rect.width, captured.displayWidth - x))
  const height = Math.max(0, Math.min(rect.height, captured.displayHeight - y))
  if (width < 12 || height < 12) return null
  return { x, y, width, height }
}

function selectRegion(captured: CapturedScreen): Promise<SelectionRect | null> {
  return new Promise((resolve) => {
    const overlay = new BrowserWindow({
      ...captured.displayBounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#101317',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    selectionWindow = overlay
    let settled = false

    const finish = (selection: SelectionRect | null): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener('selection-complete', onComplete)
      ipcMain.removeListener('selection-cancelled', onCancelled)
      selectionWindow = null
      if (!overlay.isDestroyed()) overlay.close()
      resolve(selection)
    }
    const onComplete = (event: IpcMainEvent, rect: SelectionRect): void => {
      if (event.sender !== overlay.webContents) return
      const selection = normalizeSelection(rect, captured)
      if (selection) finish(selection)
    }
    const onCancelled = (event: IpcMainEvent): void => {
      if (event.sender === overlay.webContents) finish(null)
    }

    ipcMain.on('selection-complete', onComplete)
    ipcMain.on('selection-cancelled', onCancelled)
    overlay.on('closed', () => finish(null))
    overlay.webContents.once('did-finish-load', () => {
      const imageDataUrl = `data:image/jpeg;base64,${captured.image.toJPEG(88).toString('base64')}`
      overlay.webContents.send('selection-setup', { imageDataUrl })
      overlay.setAlwaysOnTop(true, 'screen-saver')
      overlay.show()
      overlay.focus()
    })
    loadRendererPage(overlay, 'overlay.html')
  })
}

async function scanWithRegionSelection(
  source: 'button' | 'shortcut'
): Promise<Awaited<ReturnType<typeof scanCapturedRegion>> | null> {
  if (scanInProgress) return null
  scanInProgress = true
  mainWindow?.hide()
  await new Promise((resolve) => setTimeout(resolve, 250))

  try {
    const captured = await captureActiveScreen()
    const selection = await selectRegion(captured)
    if (!selection) {
      if (source === 'button') revealWindow()
      return null
    }

    revealWindow()
    return await scanCapturedRegion(captured, selection, getSpellChecker)
  } catch (error) {
    revealWindow()
    throw error
  } finally {
    if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close()
    selectionWindow = null
    scanInProgress = false
  }
}

function requestScan(): void {
  if (!mainWindow) {
    const window = createWindow(false)
    window.webContents.once('did-finish-load', () => {
      window.webContents.send('scan-requested')
    })
    return
  }

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('scan-requested')
    })
    return
  }

  mainWindow.webContents.send('scan-requested')
}

app.whenReady().then(() => {
  ipcMain.handle('scan-screen', (_event, source: 'button' | 'shortcut' = 'button') =>
    scanWithRegionSelection(source)
  )
  ipcMain.handle('add-to-dictionary', async (_event, word: string) => {
    const checker = await getSpellChecker()
    await checker.add(word)
  })
  ipcMain.handle('get-app-info', () => ({ shortcut: SHORTCUT, platform: process.platform }))

  createWindow()
  globalShortcut.register(SHORTCUT, requestScan)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  void stopScanner()
})
