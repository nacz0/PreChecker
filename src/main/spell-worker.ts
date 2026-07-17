import { parentPort, workerData } from 'node:worker_threads'
import { SpellChecker } from './spell-checker'

type WorkerRequest =
  | { id: number; action: 'check'; text: string }
  | { id: number; action: 'add'; word: string }

if (!parentPort) throw new Error('Spell checker worker requires a parent port')

const port = parentPort
const checker = new SpellChecker((workerData as { customDictionaryPath: string }).customDictionaryPath)

try {
  await checker.load()
  port.postMessage({ type: 'ready' })
} catch (error) {
  port.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  })
  throw error
}

port.on('message', async (message: WorkerRequest) => {
  try {
    const value =
      message.action === 'check' ? checker.check(message.text) : await checker.add(message.word)
    port.postMessage({ type: 'result', id: message.id, value })
  } catch (error) {
    port.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error)
    })
  }
})
