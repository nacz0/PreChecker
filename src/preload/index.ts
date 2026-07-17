import { contextBridge, ipcRenderer } from 'electron'
import type { PreCheckerApi, ScanProgress, SelectionSetup } from '../shared/types'

const api: PreCheckerApi = {
  scanScreen: () => ipcRenderer.invoke('scan-screen'),
  addToDictionary: (word) => ipcRenderer.invoke('add-to-dictionary', word),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  onScanRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('scan-requested', listener)
    return () => ipcRenderer.removeListener('scan-requested', listener)
  },
  onScanProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on('scan-progress', listener)
    return () => ipcRenderer.removeListener('scan-progress', listener)
  },
  submitSelection: (rect) => ipcRenderer.send('selection-complete', rect),
  cancelSelection: () => ipcRenderer.send('selection-cancelled'),
  onSelectionSetup: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, setup: SelectionSetup): void => callback(setup)
    ipcRenderer.on('selection-setup', listener)
    return () => ipcRenderer.removeListener('selection-setup', listener)
  }
}

contextBridge.exposeInMainWorld('prechecker', api)
