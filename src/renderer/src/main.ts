import './styles.css'
import type { ScanResult, ScanSource, SpellingIssue } from '../../shared/types'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing app root')

app.innerHTML = `
  <main class="shell">
    <header class="header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">P</span>
        <div>
          <h1>PreChecker</h1>
          <p>Literówki nie przejdą niezauważone.</p>
        </div>
      </div>
      <span class="privacy-pill"><span class="privacy-dot"></span> Wszystko lokalnie</span>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <p class="eyebrow">POLSKI + ENGLISH</p>
      <h2 id="hero-title">Sprawdź tekst widoczny<br />na ekranie.</h2>
      <p class="hero-copy">Otwórz projekt, ustaw kursor na odpowiednim monitorze i uruchom skanowanie. Obraz nie opuszcza tego komputera.</p>
      <div class="actions">
        <button class="scan-button" id="scan-button" type="button">
          <span class="scan-icon" aria-hidden="true"></span>
          <span>Zaznacz obszar</span>
        </button>
        <div class="shortcut-copy">albo użyj <kbd id="shortcut">Ctrl + Shift + K</kbd></div>
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

    <section class="empty-state" id="empty-state">
      <div class="empty-icon" aria-hidden="true"><span>A</span><i>?</i></div>
      <h3>Wyniki pojawią się tutaj</h3>
      <p>Pierwsze skanowanie może potrwać kilkanaście sekund, ponieważ uruchamiany jest lokalny silnik OCR.</p>
    </section>

    <section class="results" id="results" hidden aria-live="polite">
      <div class="summary-row">
        <div>
          <p class="eyebrow">WYNIK SKANOWANIA</p>
          <h3 id="summary-title">Znaleziono podejrzane słowa</h3>
        </div>
        <div class="result-meta" id="result-meta"></div>
      </div>
      <div class="issues" id="issues"></div>
      <details class="recognized-text">
        <summary>Tekst rozpoznany przez OCR</summary>
        <pre id="recognized-text"></pre>
      </details>
    </section>

    <footer>
      <span>PreChecker MVP</span>
      <span>OCR i słowniki działają offline</span>
    </footer>
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

function issueCard(issue: SpellingIssue): string {
  const suggestions = issue.suggestions.length
    ? issue.suggestions.map((suggestion) => `<span class="suggestion">${escapeHtml(suggestion)}</span>`).join('')
    : '<span class="no-suggestion">Brak pewnej sugestii</span>'

  return `
    <article class="issue-card" data-word="${escapeHtml(issue.word)}">
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

function renderResult(result: ScanResult): void {
  lastResult = result
  emptyState.hidden = true
  results.hidden = false
  recognizedText.textContent = result.text || '(OCR nie rozpoznał tekstu)'
  resultMeta.textContent = `${result.screenName} · ${Math.round(result.confidence)}% OCR · ${(result.durationMs / 1000).toFixed(1)} s`

  if (!result.text) {
    summaryTitle.textContent = 'Nie wykryto tekstu'
    issuesContainer.innerHTML = '<div class="clean-result"><span>—</span><p>Spróbuj powiększyć projekt lub poprawić kontrast tekstu.</p></div>'
  } else if (result.issues.length === 0) {
    summaryTitle.textContent = 'Nie znaleziono literówek'
    issuesContainer.innerHTML = '<div class="clean-result"><span>✓</span><p>Wszystkie rozpoznane słowa występują w polskim lub angielskim słowniku.</p></div>'
  } else {
    summaryTitle.textContent = issueSummary(result.issues.length)
    issuesContainer.innerHTML = result.issues.map(issueCard).join('')
  }
}

async function runScan(source: ScanSource): Promise<void> {
  if (scanning) return
  scanning = true
  scanButton.disabled = true
  scanButton.querySelector('span:last-child')!.textContent = 'Skanowanie…'
  errorMessage.hidden = true
  progressWrap.hidden = false
  progressLabel.textContent = 'Przygotowywanie lokalnych słowników'
  progressBar.style.width = '2%'
  progressValue.textContent = '2%'

  try {
    const result = await window.prechecker.scanScreen(source)
    if (result) renderResult(result)
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : 'Skanowanie nie powiodło się.'
    errorMessage.hidden = false
  } finally {
    scanning = false
    scanButton.disabled = false
    scanButton.querySelector('span:last-child')!.textContent = 'Zaznacz obszar'
    window.setTimeout(() => {
      progressWrap.hidden = true
    }, 450)
  }
}

scanButton.addEventListener('click', () => void runScan('button'))

issuesContainer.addEventListener('click', async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-add-word]')
  if (!target || !lastResult) return

  const word = target.dataset.addWord
  if (!word) return
  await window.prechecker.addToDictionary(word)
  target.closest('.issue-card')?.remove()

  const remaining = issuesContainer.querySelectorAll('.issue-card').length
  if (remaining === 0) {
    summaryTitle.textContent = 'Nie znaleziono literówek'
    issuesContainer.innerHTML = '<div class="clean-result"><span>✓</span><p>Wszystkie pozostałe słowa są w słowniku.</p></div>'
  } else {
    summaryTitle.textContent = issueSummary(remaining)
  }
})

window.prechecker.onScanRequested(() => void runScan('shortcut'))
window.prechecker.onScanProgress(({ status, progress }) => {
  const percent = Math.round(progress * 100)
  progressLabel.textContent = status
  progressValue.textContent = `${percent}%`
  progressBar.style.width = `${percent}%`
})

void window.prechecker.getAppInfo().then((info) => {
  const commandKey = info.platform === 'darwin' ? '⌘' : 'Ctrl'
  shortcut.textContent = `${commandKey} + Shift + K`
})
