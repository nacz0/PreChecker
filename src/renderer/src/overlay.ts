import './overlay.css'
import type { SelectionRect } from '../../shared/types'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing overlay root')

app.innerHTML = `
  <img id="screen-image" alt="" draggable="false" />
  <div class="shade" aria-hidden="true"></div>
  <div class="selection" id="selection" hidden aria-hidden="true"></div>
  <div class="instructions">
    <strong>Zaznacz obszar do sprawdzenia</strong>
    <span>Przeciągnij myszą · <kbd>Esc</kbd> anuluje</span>
  </div>
  <div class="dimensions" id="dimensions" hidden></div>
`

const image = document.querySelector<HTMLImageElement>('#screen-image')!
const selection = document.querySelector<HTMLDivElement>('#selection')!
const dimensions = document.querySelector<HTMLDivElement>('#dimensions')!

let startX = 0
let startY = 0
let dragging = false
let currentRect: SelectionRect | undefined

function rectFromPoints(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

function renderRect(rect: SelectionRect): void {
  selection.hidden = false
  selection.style.left = `${rect.x}px`
  selection.style.top = `${rect.y}px`
  selection.style.width = `${rect.width}px`
  selection.style.height = `${rect.height}px`
  selection.style.backgroundPosition = `-${rect.x}px -${rect.y}px`

  dimensions.hidden = false
  dimensions.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
  dimensions.style.left = `${Math.min(rect.x, window.innerWidth - 120)}px`
  dimensions.style.top = `${Math.min(rect.y + rect.height + 10, window.innerHeight - 38)}px`
}

window.prechecker.onSelectionSetup(({ imageDataUrl }) => {
  image.src = imageDataUrl
  selection.style.backgroundImage = `url(${imageDataUrl})`
  selection.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`
})

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  startX = event.clientX
  startY = event.clientY
  dragging = true
  currentRect = rectFromPoints(startX, startY, startX, startY)
  renderRect(currentRect)
})

window.addEventListener('pointermove', (event) => {
  if (!dragging) return
  currentRect = rectFromPoints(startX, startY, event.clientX, event.clientY)
  renderRect(currentRect)
})

window.addEventListener('pointerup', (event) => {
  if (!dragging || event.button !== 0) return
  dragging = false
  currentRect = rectFromPoints(startX, startY, event.clientX, event.clientY)

  if (currentRect.width < 12 || currentRect.height < 12) {
    selection.hidden = true
    dimensions.hidden = true
    currentRect = undefined
    return
  }

  window.prechecker.submitSelection(currentRect)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.prechecker.cancelSelection()
})

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.prechecker.cancelSelection()
})
