import { _electron as electron } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const resultsDirectory = join(projectRoot, '.test-results')
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
  args: ['.'],
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
})

try {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const preloadReady = await page.evaluate(() => typeof window.prechecker?.scanScreen === 'function')
  if (!preloadReady) throw new Error('Preload API was not exposed to the renderer')

  const shortcutRegistered = await electronApp.evaluate(({ globalShortcut }) =>
    globalShortcut.isRegistered('CommandOrControl+Shift+K')
  )
  if (!shortcutRegistered) throw new Error('Global shortcut was not registered')

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

      const summary = (await page.locator('#summary-title').textContent())?.trim() ?? ''
      const meta = (await page.locator('#result-meta').textContent())?.trim() ?? ''
      const screenshotPath = join(resultsDirectory, `${fixture.name}-result.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      fixtureResults.push({
        name: fixture.name,
        expectedIssues: fixture.expectedIssues,
        detectedIssues,
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
  }

  console.log(
    JSON.stringify(
      {
        preloadReady,
        shortcutRegistered,
        escapeCancellation: true,
        displayDiagnostics,
        fixtureResults
      },
      null,
      2
    )
  )
} finally {
  await electronApp.close()
}
