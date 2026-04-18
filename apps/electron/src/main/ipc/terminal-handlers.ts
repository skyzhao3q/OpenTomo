/**
 * IPC handlers for the embedded terminal feature.
 * Bridges renderer requests to the TerminalManager singleton.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getTerminalManager } from '../terminal-manager'

export function registerTerminalHandlers(): void {
  const manager = getTerminalManager()

  // Create a new PTY — returns ptyId to the renderer
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, (event, cwd: string, cols: number, rows: number) => {
    return manager.create(event.sender.id, cwd, cols, rows)
  })

  // Write keystrokes to PTY — uses ipcMain.on (not handle) because the
  // preload calls ipcRenderer.send (fire-and-forget, no round-trip needed)
  ipcMain.on(IPC_CHANNELS.TERMINAL_WRITE, (_event, ptyId: string, data: string) => {
    manager.write(ptyId, data)
  })

  // Resize PTY dimensions
  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, ptyId: string, cols: number, rows: number) => {
    manager.resize(ptyId, cols, rows)
  })

  // Kill a PTY process
  ipcMain.handle(IPC_CHANNELS.TERMINAL_KILL, (_event, ptyId: string) => {
    manager.kill(ptyId)
  })
}
