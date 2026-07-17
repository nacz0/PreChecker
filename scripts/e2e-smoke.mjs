import { _electron as electron } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const resultsDirectory = join(projectRoot, '.test-results')
const packagedPathArgument = process.argv.find((argument) => argument.startsWith('--packaged-path='))
const packaged = process.argv.includes('--packaged') || Boolean(packagedPathArgument)
const profileMemory = process.argv.includes('--profile-memory')
const packagedExecutable = packagedPathArgument
  ? packagedPathArgument.slice('--packaged-path='.length)
  : join(projectRoot, 'release', 'win-unpacked', 'PreChecker.exe')
await mkdir(resultsDirectory, { recursive: true })

const fixtures = [
  {
    name: 'poster-pl',
    path: join(projectRoot, 'tests', 'fixtures', 'poster-pl.svg'),
    expectedIssues: ['wyprzedarz', 'najleprze', 'wiencej']
  },
  {
    name: 'poster-en',
    path: join(projectRoot, 'tests', 'fixtures', 'poster-en.svg'),
    expectedIssues: ['recieve', 'avalable', 'adress']
  },
  {
    name: 'poster-mixed',
    path: join(projectRoot, 'tests', 'fixtures', 'poster-mixed.svg'),
    expectedIssues: ['świerzo', 'colection', 'desing']
  }
]

const electronApp = await electron.launch({
  ...(packaged ? { executablePath: packagedExecutable, args: [] } : { args: ['.'] }),
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
})

try {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const memorySnapshots = []
  const captureMemory = async (label) => {
    if (!profileMemory) return
    const snapshot = await electronApp.evaluate(({ app }, snapshotLabel) => {
      const processes = app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        privateMb: Math.round((metric.memory.privateBytes / 1024) * 10) / 10,
        workingSetMb: Math.round((metric.memory.workingSetSize / 1024) * 10) / 10
      }))
      return {
        label: snapshotLabel,
        totalPrivateMb: Math.round(processes.reduce((sum, item) => sum + item.privateMb, 0) * 10) / 10,
        totalWorkingSetMb: Math.round(processes.reduce((sum, item) => sum + item.workingSetMb, 0) * 10) / 10,
        processes
      }
    }, label)
    memorySnapshots.push(snapshot)
  }

  await captureMemory('startup')

  const preloadReady = await page.evaluate(() => typeof window.prechecker?.scanScreen === 'function')
  if (!preloadReady) throw new Error('Preload API was not exposed to the renderer')

  const shortcutRegistered = await electronApp.evaluate(({ globalShortcut }) =>
    globalShortcut.isRegistered('CommandOrControl+Shift+K')
  )
  const allowShortcutConflict =
    process.env.PRECHECKER_E2E_ALLOW_SHORTCUT_CONFLICT === '1' ||
    process.argv.includes('--allow-shortcut-conflict')
  if (!shortcutRegistered && !allowShortcutConflict) {
    throw new Error('Global shortcut was not registered')
  }
  if (!shortcutRegistered) {
    console.warn('Global shortcut is occupied by another running application instance')
  }

  const menuBarHidden = await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/index.html')
    )
    return mainWindow ? !mainWindow.isMenuBarVisible() : false
  })
  if (!menuBarHidden) throw new Error('Native application menu bar is visible')

  const displayDiagnostics = await electronApp.evaluate(async ({ desktopCapturer, screen }) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
    return {
      cursorPoint: screen.getCursorScreenPoint(),
      displays: screen.getAllDisplays().map((display) => ({
        id: display.id,
        label: display.label,
        bounds: display.bounds
      })),
      sources: sources.map((source) => ({ name: source.name, displayId: source.display_id }))
    }
  })
  console.log(`Display diagnostics: ${JSON.stringify(displayDiagnostics)}`)

  const fixtureResults = []
  let firstScanMainThreadLatencyMs = 0
  for (const fixture of fixtures) {
    const fixtureWindowIds = await electronApp.evaluate(
      async ({ BrowserWindow, screen }, fixturePath) => {
        const windows = await Promise.all(
          screen.getAllDisplays().map(async (display) => {
            const window = new BrowserWindow({
              ...display.bounds,
              frame: false,
              show: false,
              alwaysOnTop: true,
              backgroundColor: '#ffffff'
            })
            await window.loadFile(fixturePath)
            window.setMenuBarVisibility(false)
            window.setAlwaysOnTop(true, 'screen-saver')
            window.show()
            window.moveTop()
            return window
          })
        )
        windows.at(-1)?.focus()
        return windows.map((window) => window.id)
      },
      fixture.path
    )

    try {
      await page.waitForTimeout(1500)
      if (fixture.name === 'poster-pl') {
        const cancelOverlayPromise = electronApp.waitForEvent('window', {
          predicate: (candidate) => candidate.url().includes('/overlay.html'),
          timeout: 30_000
        })
        await page.evaluate(() => document.querySelector('#scan-button')?.click())
        const cancelOverlay = await cancelOverlayPromise
        await cancelOverlay.waitForLoadState('domcontentloaded')
        try {
          await cancelOverlay.keyboard.press('Escape')
        } catch (error) {
          if (!cancelOverlay.isClosed()) throw error
        }
        await page.waitForFunction(
          () => (document.querySelector('#scan-button')).disabled === false,
          undefined,
          { timeout: 30_000 }
        )
      }

      const overlayPromise = electronApp.waitForEvent('window', {
        predicate: (candidate) => candidate.url().includes('/overlay.html'),
        timeout: 30_000
      })
      await page.evaluate(() => document.querySelector('#scan-button')?.click())
      const overlayPage = await overlayPromise
      await overlayPage.waitForLoadState('domcontentloaded')
      await overlayPage.waitForFunction(
        () => {
          const image = document.querySelector('#screen-image')
          return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
        },
        undefined,
        { timeout: 30_000 }
      )

      const overlaySize = await overlayPage.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }))
      await overlayPage.mouse.move(60, 60)
      await overlayPage.mouse.down()
      await overlayPage.mouse.move(overlaySize.width - 60, overlaySize.height - 60, { steps: 12 })
      if (fixture.name === 'poster-pl') {
        await overlayPage.screenshot({
          path: join(resultsDirectory, 'selection-overlay.png'),
          fullPage: true
        })
      }
      await overlayPage.mouse.up()

      if (fixture.name === 'poster-pl') {
        const pingStartedAt = Date.now()
        await electronApp.evaluate(() => true)
        firstScanMainThreadLatencyMs = Date.now() - pingStartedAt
        if (firstScanMainThreadLatencyMs > 1_500) {
          throw new Error(
            `Main process blocked for ${firstScanMainThreadLatencyMs} ms during first scan`
          )
        }
      }

      await page.waitForFunction(
        () => (document.querySelector('#scan-button')).disabled === false,
        undefined,
        { timeout: 180_000 }
      )

      const errorMessage = await page.locator('#error-message').textContent()
      const errorVisible = await page.locator('#error-message').evaluate(
        (element) => !element.hasAttribute('hidden')
      )
      if (errorVisible) throw new Error(`${fixture.name}: screen scan failed: ${errorMessage}`)

      const recognizedText = (await page.locator('#recognized-text').textContent())?.trim() ?? ''
      const detectedIssues = await page
        .locator('.issue-card')
        .evaluateAll((cards) =>
          cards
            .map((card) => card.getAttribute('data-word')?.normalize('NFC').toLocaleLowerCase('pl'))
            .filter(Boolean)
        )

      const missingIssues = fixture.expectedIssues.filter((word) => !detectedIssues.includes(word))
      if (missingIssues.length > 0) {
        throw new Error(
          `${fixture.name}: OCR/spell check missed ${missingIssues.join(', ')}. ` +
            `Detected: ${detectedIssues.join(', ')}. OCR text: ${recognizedText}`
        )
      }

      const markerData = await page.locator('.proof-marker').evaluateAll((markers) =>
        markers.map((marker) => {
          const bounds = marker.getBoundingClientRect()
          return {
            word: marker.getAttribute('data-marker-word'),
            width: bounds.width,
            height: bounds.height
          }
        })
      )
      const markedWords = markerData.map((marker) => marker.word)
      const missingMarkers = fixture.expectedIssues.filter((word) => !markedWords.includes(word))
      if (missingMarkers.length > 0) {
        throw new Error(`${fixture.name}: missing image markers for ${missingMarkers.join(', ')}`)
      }
      if (markerData.some((marker) => marker.width <= 0 || marker.height <= 0)) {
        throw new Error(`${fixture.name}: at least one image marker has empty bounds`)
      }

      const focusedResultLayout = await page.evaluate(() => {
        const hero = document.querySelector('.hero')
        const header = document.querySelector('.header')
        const details = document.querySelector('#details-panel')
        const canvas = document.querySelector('#proof-canvas')
        const bounds = canvas?.getBoundingClientRect()
        return {
          resultsMode: document.body.classList.contains('results-mode'),
          heroDisplay: hero ? getComputedStyle(hero).display : null,
          headerDisplay: header ? getComputedStyle(header).display : null,
          detailsDisplay: details ? getComputedStyle(details).display : null,
          canvasInsideViewport: Boolean(
            bounds &&
              bounds.top >= 0 &&
              bounds.left >= 0 &&
              bounds.right <= window.innerWidth + 1 &&
              bounds.bottom <= window.innerHeight + 1
          )
        }
      })
      if (
        !focusedResultLayout.resultsMode ||
        focusedResultLayout.heroDisplay !== 'none' ||
        focusedResultLayout.headerDisplay !== 'none' ||
        focusedResultLayout.detailsDisplay !== 'none' ||
        !focusedResultLayout.canvasInsideViewport
      ) {
        throw new Error(
          `${fixture.name}: focused result layout is invalid: ${JSON.stringify(focusedResultLayout)}`
        )
      }

      const summary = (await page.locator('#summary-title').textContent())?.trim() ?? ''
      const meta = (await page.locator('#result-meta').textContent())?.trim() ?? ''
      const screenshotPath = join(resultsDirectory, `${fixture.name}-result.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      fixtureResults.push({
        name: fixture.name,
        expectedIssues: fixture.expectedIssues,
        detectedIssues,
        markerCount: markerData.length,
        focusedResultLayout,
        summary,
        meta,
        recognizedPreview: recognizedText.slice(0, 180),
        screenshotPath
      })
    } finally {
      await electronApp.evaluate(({ BrowserWindow }, windowIds) => {
        for (const windowId of windowIds) BrowserWindow.fromId(windowId)?.close()
      }, fixtureWindowIds)
    }
    await page.waitForTimeout(1000)
    await captureMemory(`after-${fixture.name}`)
  }

  if (profileMemory) {
    await page.waitForTimeout(12_000)
    await captureMemory('after-ocr-idle')
    await page.waitForTimeout(23_000)
    await captureMemory('after-all-idle')
  }

  console.log(
    JSON.stringify(
      {
        packaged,
        preloadReady,
        shortcutRegistered,
        menuBarHidden,
        escapeCancellation: true,
        firstScanMainThreadLatencyMs,
        displayDiagnostics,
        ...(profileMemory ? { memorySnapshots } : {}),
        fixtureResults
      },
      null,
      2
    )
  )
} finally {
  await electronApp.close()
}
