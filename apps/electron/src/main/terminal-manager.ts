/**
 * TerminalManager — PTY lifecycle management for the embedded terminal feature.
 *
 * Creates and manages node-pty instances on behalf of the renderer.
 * Each PTY is bound to the webContents that created it; output is pushed
 * back only to that specific BrowserWindow via webContents.send().
 *
 * Cross-platform:
 *   macOS/Linux: POSIX PTY via node-pty (uses process.env already enriched by shell-env.ts)
 *   Windows: ConPTY (Win10 1903+) or winpty fallback — handled transparently by node-pty
 */

import { spawn as ptySpawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { webContents } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { IPC_CHANNELS } from '../shared/types'
import { mainLog } from './logger'

interface ManagedPty {
  pty: IPty
  webContentsId: number  // push terminal:data only to this window
  cols: number
  rows: number
}

class TerminalManager {
  private ptys = new Map<string, ManagedPty>()

  /**
   * Spawn a new PTY process.
   * @param webContentsId - ID of the BrowserWindow WebContents that owns this terminal
   * @param cwd - Initial working directory (falls back to homedir if path doesn't exist)
   * @param cols - Initial column count
   * @param rows - Initial row count
   * @returns ptyId — a UUID used to identify this terminal in subsequent calls
   */
  create(webContentsId: number, cwd: string, cols: number, rows: number): string {
    const ptyId = randomUUID()
    const shell = this.detectShell()
    const resolvedCwd = cwd && existsSync(cwd) ? cwd : homedir()

    mainLog.info(`[terminal] Creating PTY ${ptyId} shell=${shell} cwd=${resolvedCwd}`)

    const pty = ptySpawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: resolvedCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    pty.onData((data: string) => {
      // null-check: the window may have been destroyed
      webContents.fromId(webContentsId)?.send(IPC_CHANNELS.TERMINAL_DATA, ptyId, data)
    })

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      mainLog.info(`[terminal] PTY ${ptyId} exited with code ${exitCode}`)
      webContents.fromId(webContentsId)?.send(IPC_CHANNELS.TERMINAL_EXIT, ptyId, exitCode)
      this.ptys.delete(ptyId)
    })

    this.ptys.set(ptyId, { pty, webContentsId, cols, rows })
    return ptyId
  }

  /** Write keystrokes or pasted text to the PTY stdin. */
  write(ptyId: string, data: string): void {
    this.ptys.get(ptyId)?.pty.write(data)
  }

  /** Resize the PTY to match the new xterm.js dimensions. */
  resize(ptyId: string, cols: number, rows: number): void {
    const entry = this.ptys.get(ptyId)
    if (!entry) return
    entry.pty.resize(cols, rows)
    entry.cols = cols
    entry.rows = rows
  }

  /** Terminate the PTY process and remove it from the registry. */
  kill(ptyId: string): void {
    const entry = this.ptys.get(ptyId)
    if (!entry) return
    mainLog.info(`[terminal] Killing PTY ${ptyId}`)
    try {
      entry.pty.kill()
    } catch {
      // Process may have already exited — ignore
    }
    this.ptys.delete(ptyId)
  }

  /** Kill all PTYs owned by a specific window (called on window close). */
  killAllForWindow(webContentsId: number): void {
    for (const [ptyId, entry] of this.ptys) {
      if (entry.webContentsId === webContentsId) {
        this.kill(ptyId)
      }
    }
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private detectShell(): string {
    if (process.platform === 'win32') {
      // Priority: PowerShell 7 → PowerShell 5 → COMSPEC (cmd.exe)
      const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      if (existsSync(ps7)) return ps7
      const ps5 = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      if (existsSync(ps5)) return ps5
      return process.env.COMSPEC || 'cmd.exe'
    }
    // macOS / Linux: honour $SHELL (already populated by shell-env.ts on macOS)
    return process.env.SHELL || '/bin/zsh'
  }
}

// ──────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────

let _manager: TerminalManager | null = null

export function getTerminalManager(): TerminalManager {
  if (!_manager) _manager = new TerminalManager()
  return _manager
}
