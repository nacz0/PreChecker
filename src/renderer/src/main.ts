import './styles.css'
import type { ScanResult, ScanSource, SpellingIssue } from '../../shared/types'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing app root')

app.innerHTML = `
  <main class="shell">
    <header class="header">
      <div class="brand">
        <h1>PreChecker</h1>
      </div>
      <span class="app-meta">PL + EN · lokalnie</span>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <h2 id="hero-title">Sprawdź projekt</h2>
      <p class="hero-copy">Zaznacz obszar ekranu z tekstem.</p>
      <div class="actions">
        <button class="scan-button" id="scan-button" type="button">
          <span class="scan-icon" aria-hidden="true"></span>
          <span>Zaznacz obszar</span>
        </button>
        <div class="shortcut-copy"><kbd id="shortcut">Ctrl + Shift + K</kbd></div>
      </div>
      <div class="progress-wrap" id="progress-wrap" hidden>
        <div class="progress-copy">
          <span id="progress-label">Przygotowywanie OCR…</span>
          <span id="progress-value">0%</span>
        </div>
        <div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div>
      </div>
      <p class="error-message" id="error-message" role="alert" hidden></p>
    </section>

    <section class="empty-state" id="empty-state" hidden></section>

    <section class="results" id="results" hidden aria-live="polite">
      <div class="result-toolbar">
        <div class="result-brand">
          <strong id="result-toolbar-status">Wynik skanowania</strong>
        </div>
        <div class="result-toolbar-actions">
          <span class="result-toolbar-meta" id="result-toolbar-meta"></span>
          <button class="toolbar-button toolbar-button-secondary" id="details-toggle" type="button" aria-expanded="false">Szczegóły</button>
          <button class="toolbar-button toolbar-button-primary" id="rescan-button" type="button">Nowy skan</button>
        </div>
      </div>
      <div class="proof">
        <div class="proof-heading">
          <strong>Miejsca wymagające uwagi</strong>
          <span id="proof-count"></span>
        </div>
        <div class="proof-canvas" id="proof-canvas">
          <img id="proof-image" alt="Zaznaczony fragment projektu" />
          <div class="proof-markers" id="proof-markers" aria-hidden="true"></div>
        </div>
      </div>
      <div class="details-panel" id="details-panel">
        <div class="summary-row">
          <div>
            <h3 id="summary-title">Znaleziono podejrzane słowa</h3>
          </div>
          <div class="result-meta" id="result-meta"></div>
        </div>
        <div class="issues" id="issues"></div>
        <details class="recognized-text">
          <summary>Tekst rozpoznany przez OCR</summary>
          <pre id="recognized-text"></pre>
        </details>
      </div>
    </section>
  </main>
`

const scanButton = document.querySelector<HTMLButtonElement>('#scan-button')!
const progressWrap = document.querySelector<HTMLDivElement>('#progress-wrap')!
const progressLabel = document.querySelector<HTMLSpanElement>('#progress-label')!
const progressValue = document.querySelector<HTMLSpanElement>('#progress-value')!
const progressBar = document.querySelector<HTMLDivElement>('#progress-bar')!
const errorMessage = document.querySelector<HTMLParagraphElement>('#error-message')!
const emptyState = document.querySelector<HTMLElement>('#empty-state')!
const results = document.querySelector<HTMLElement>('#results')!
const issuesContainer = document.querySelector<HTMLDivElement>('#issues')!
const summaryTitle = document.querySelector<HTMLHeadingElement>('#summary-title')!
const resultMeta = document.querySelector<HTMLDivElement>('#result-meta')!
const recognizedText = document.querySelector<HTMLPreElement>('#recognized-text')!
const shortcut = document.querySelector<HTMLElement>('#shortcut')!
const proofImage = document.querySelector<HTMLImageElement>('#proof-image')!
const proofMarkers = document.querySelector<HTMLDivElement>('#proof-markers')!
const proofCount = document.querySelector<HTMLSpanElement>('#proof-count')!
const proofCanvas = document.querySelector<HTMLDivElement>('#proof-canvas')!
const resultToolbarStatus = document.querySelector<HTMLSpanElement>('#result-toolbar-status')!
const resultToolbarMeta = document.querySelector<HTMLSpanElement>('#result-toolbar-meta')!
const detailsToggle = document.querySelector<HTMLButtonElement>('#details-toggle')!
const rescanButton = document.querySelector<HTMLButtonElement>('#rescan-button')!

let scanning = false
let lastResult: ScanResult | undefined

function escapeHtml(value: string): string {
  const element = document.createElement('span')
  element.textContent = value
  return element.innerHTML
}

function issueSummary(count: number): string {
  if (count === 1) return '1 podejrzane słowo'
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${count} podejrzane słowa`
  }
  return `${count} podejrzanych słów`
}

function markerSummary(count: number): string {
  if (count === 1) return '1 oznaczone miejsce'
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${count} oznaczone miejsca`
  }
  return `${count} oznaczonych miejsc`
}

function scanResultStatus(result: ScanResult): string {
  if (!result.text) return 'Nie wykryto tekstu'
  if (result.issues.length === 0) return 'Brak podejrzanych słów'
  return issueSummary(result.issues.length)
}

function issueCard(issue: SpellingIssue): string {
  const suggestions = issue.suggestions.length
    ? issue.suggestions.map((suggestion) => `<span class="suggestion">${escapeHtml(suggestion)}</span>`).join('')
    : '<span class="no-suggestion">Brak pewnej sugestii</span>'

  return `
    <article class="issue-card" data-word="${escapeHtml(issue.word)}" data-normalized="${escapeHtml(issue.normalized)}">
      <div class="issue-main">
        <span class="warning-mark" aria-hidden="true">!</span>
        <div>
          <div class="word-row">
            <strong>${escapeHtml(issue.word)}</strong>
            ${issue.count > 1 ? `<span class="count">×${issue.count}</span>` : ''}
          </div>
          <div class="suggestions">${suggestions}</div>
        </div>
      </div>
      <button class="dictionary-button" type="button" data-add-word="${escapeHtml(issue.word)}">To poprawne słowo</button>
    </article>
  `
}

function renderProof(result: ScanResult): void {
  proofImage.src = result.preview.imageDataUrl
  proofCanvas.style.setProperty('--preview-ratio', String(result.preview.width / result.preview.height))
  const markers = result.issues.flatMap((issue) =>
    (issue.occurrences ?? []).map((occurrence, index) => {
      const left = (occurrence.x / result.preview.width) * 100
      const top = (occurrence.y / result.preview.height) * 100
      const width = (occurrence.width / result.preview.width) * 100
      const height = (occurrence.height / result.preview.height) * 100
      return `
        <div
          class="proof-marker"
          data-marker-word="${escapeHtml(issue.normalized)}"
          style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"
        ><span>${escapeHtml(issue.word)}${index > 0 ? ` ${index + 1}` : ''}</span></div>
      `
    })
  )
  proofMarkers.innerHTML = markers.join('')
  proofCount.textContent = markerSummary(markers.length)
}

function renderResult(result: ScanResult): void {
  lastResult = result
  document.body.classList.add('results-mode')
  document.body.classList.remove('details-visible')
  detailsToggle.setAttribute('aria-expanded', 'false')
  detailsToggle.textContent = 'Szczegóły'
  emptyState.hidden = true
  results.hidden = false
  recognizedText.textContent = result.text || '(OCR nie rozpoznał tekstu)'
  const meta = `${result.screenName} · ${Math.round(result.confidence)}% OCR · ${(result.durationMs / 1000).toFixed(1)} s`
  resultMeta.textContent = meta
  resultToolbarMeta.textContent = meta
  renderProof(result)

  resultToolbarStatus.textContent = scanResultStatus(result)
  if (!result.text) {
    summaryTitle.textContent = 'Nie wykryto tekstu'
    issuesContainer.innerHTML = '<div class="clean-result"><span>—</span><p>Spróbuj powiększyć projekt lub poprawić kontrast tekstu.</p></div>'
  } else if (result.issues.length === 0) {
    summaryTitle.textContent = 'Nie znaleziono literówek'
    issuesContainer.innerHTML = '<div class="clean-result"><span>✓</span><p>Wszystkie rozpoznane słowa występują w polskim lub angielskim słowniku.</p></div>'
  } else {
    const summary = issueSummary(result.issues.length)
    summaryTitle.textContent = summary
    issuesContainer.innerHTML = result.issues.map(issueCard).join('')
  }
  window.scrollTo({ top: 0, behavior: 'auto' })
}

async function runScan(source: ScanSource): Promise<void> {
  if (scanning) return
  const previousResultStatus = resultToolbarStatus.textContent
  let renderedResult = false
  let scanFailed = false
  scanning = true
  scanButton.disabled = true
  rescanButton.disabled = true
  detailsToggle.disabled = true
  scanButton.querySelector('span:last-child')!.textContent = 'Skanowanie…'
  errorMessage.hidden = true
  progressWrap.hidden = false
  progressLabel.textContent = 'Przygotowywanie lokalnych słowników'
  progressBar.style.width = '2%'
  progressValue.textContent = '2%'
  if (lastResult) resultToolbarStatus.textContent = 'Przygotowywanie skanu…'

  try {
    const result = await window.prechecker.scanScreen(source)
    if (result) {
      renderResult(result)
      renderedResult = true
    }
  } catch (error) {
    scanFailed = true
    errorMessage.textContent = error instanceof Error ? error.message : 'Skanowanie nie powiodło się.'
    errorMessage.hidden = false
    if (lastResult) resultToolbarStatus.textContent = errorMessage.textContent
  } finally {
    scanning = false
    scanButton.disabled = false
    rescanButton.disabled = false
    detailsToggle.disabled = false
    scanButton.querySelector('span:last-child')!.textContent = 'Zaznacz obszar'
    if (lastResult && !renderedResult && !scanFailed) {
      resultToolbarStatus.textContent = previousResultStatus
    }
    window.setTimeout(() => {
      progressWrap.hidden = true
    }, 450)
  }
}

scanButton.addEventListener('click', () => void runScan('button'))
rescanButton.addEventListener('click', () => void runScan('button'))
detailsToggle.addEventListener('click', () => {
  const visible = document.body.classList.toggle('details-visible')
  detailsToggle.setAttribute('aria-expanded', String(visible))
  detailsToggle.textContent = visible ? 'Ukryj szczegóły' : 'Szczegóły'
  if (visible) window.scrollTo({ top: 0, behavior: 'smooth' })
})

issuesContainer.addEventListener('click', async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-add-word]')
  if (!target || !lastResult) return

  const word = target.dataset.addWord
  if (!word) return
  await window.prechecker.addToDictionary(word)
  const normalized = target.closest<HTMLElement>('.issue-card')?.dataset.normalized
  if (normalized) {
    proofMarkers.querySelectorAll(`[data-marker-word="${CSS.escape(normalized)}"]`).forEach((marker) => marker.remove())
  }
  target.closest('.issue-card')?.remove()

  const remaining = issuesContainer.querySelectorAll('.issue-card').length
  if (remaining === 0) {
    summaryTitle.textContent = 'Nie znaleziono literówek'
    resultToolbarStatus.textContent = 'Brak podejrzanych słów'
    issuesContainer.innerHTML = '<div class="clean-result"><span>✓</span><p>Wszystkie pozostałe słowa są w słowniku.</p></div>'
  } else {
    const summary = issueSummary(remaining)
    summaryTitle.textContent = summary
    resultToolbarStatus.textContent = summary
  }
})

issuesContainer.addEventListener('pointerover', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('.issue-card')
  const normalized = card?.dataset.normalized
  if (!normalized) return
  proofMarkers.querySelectorAll(`[data-marker-word="${CSS.escape(normalized)}"]`).forEach((marker) => {
    marker.classList.add('is-focused')
  })
})

issuesContainer.addEventListener('pointerout', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('.issue-card')
  if (card?.contains(event.relatedTarget as Node | null)) return
  proofMarkers.querySelectorAll('.is-focused').forEach((marker) => marker.classList.remove('is-focused'))
})

window.prechecker.onScanRequested(() => void runScan('shortcut'))
window.prechecker.onScanProgress(({ status, progress }) => {
  const percent = Math.round(progress * 100)
  progressLabel.textContent = status
  progressValue.textContent = `${percent}%`
  progressBar.style.width = `${percent}%`
  if (lastResult && scanning) resultToolbarStatus.textContent = `${status} · ${percent}%`
})

void window.prechecker.getAppInfo().then((info) => {
  const commandKey = info.platform === 'darwin' ? '⌘' : 'Ctrl'
  shortcut.textContent = `${commandKey} + Shift + K`
})
