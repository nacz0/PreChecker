import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { SpellingIssue } from '../shared/types'

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id?: number; message: string }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class SpellCheckerClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingRequest>()
  private readonly readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private requestId = 0

  constructor(customDictionaryPath: string) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.worker = new Worker(join(__dirname, 'spell-worker.js'), {
      workerData: { customDictionaryPath }
    })
    this.worker.on('message', (message: WorkerResponse) => this.handleMessage(message))
    this.worker.on('error', (error) => this.fail(error))
    this.worker.on('exit', (code) => {
      if (code !== 0) this.fail(new Error(`Spell checker worker stopped with code ${code}`))
    })
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  async check(text: string): Promise<SpellingIssue[]> {
    await this.ready()
    return (await this.request('check', { text })) as SpellingIssue[]
  }

  async add(word: string): Promise<void> {
    await this.ready()
    await this.request('add', { word })
  }

  async stop(): Promise<void> {
    await this.worker.terminate()
  }

  private request(action: 'check' | 'add', payload: Record<string, string>): Promise<unknown> {
    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, action, ...payload })
    })
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === 'ready') {
      this.resolveReady()
      return
    }
    if (message.type === 'error' && message.id === undefined) {
      this.fail(new Error(message.message))
      return
    }
    if (message.type === 'result') {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      request.resolve(message.value)
      return
    }
    if (message.type === 'error' && message.id !== undefined) {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      request.reject(new Error(message.message))
    }
  }

  private fail(error: Error): void {
    this.rejectReady(error)
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}
