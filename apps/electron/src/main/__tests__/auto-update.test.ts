/**
 * Tests for auto-update.ts — download state machine
 *
 * Key regression covered:
 *   When the user clicks "Check for Updates" from Settings, the IPC handler
 *   was calling checkForUpdates({ autoDownload: false }). The update-available
 *   event handler always set downloadState: 'downloading' regardless of whether
 *   a download was actually started — causing the UI to show "0% downloading"
 *   forever.
 *
 * Fix:
 *   1. IPC handler now passes autoDownload: true
 *   2. update-available handler only sets 'downloading' when autoDownload is true
 *
 * Test strategy:
 *   - Mock electron-updater to capture event handlers registered at module load
 *   - Manually fire events and assert resulting state via getUpdateInfo()
 *   - No Electron process required — runs with plain `bun test`
 */
import { describe, it, expect, beforeAll, beforeEach, mock } from 'bun:test'

// ─── Capture handlers registered by auto-update.ts at load time ───────────────
const registeredHandlers: Record<string, Array<(arg: unknown) => void>> = {}

interface MockAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on(event: string, handler: (arg: unknown) => void): MockAutoUpdater
  checkForUpdates: ReturnType<typeof mock>
  downloadUpdate: ReturnType<typeof mock>
  quitAndInstall: ReturnType<typeof mock>
}

const mockAutoUpdater: MockAutoUpdater = {
  autoDownload: true as boolean,
  autoInstallOnAppQuit: false as boolean,
  logger: null as unknown,

  on(event: string, handler: (arg: unknown) => void): MockAutoUpdater {
    registeredHandlers[event] ??= []
    registeredHandlers[event].push(handler)
    return this
  },

  // Returns a plausible checkForUpdates result without side effects
  checkForUpdates: mock(async () => ({
    updateInfo: { version: '99.9.9' },
  })),

  downloadUpdate: mock(async () => null),
  quitAndInstall: mock(() => {}),
}

// ─── Module mocks — must be declared before auto-update.ts is imported ────────

mock.module('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}))

mock.module('electron', () => ({
  app: {
    getName: () => 'OpenTomo',
    // Return a path guaranteed not to exist so checkForExistingDownload()
    // always returns { exists: false } without touching the real filesystem.
    getPath: (_key: string) => '/nonexistent-mock-home-for-tests',
    isPackaged: false,
  },
}))

mock.module('electron-log', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {} },
}))

mock.module('@opentomo/shared/version', () => ({
  getAppVersion: () => '1.0.0',
}))

mock.module('@opentomo/shared/config', () => ({
  getDismissedUpdateVersion: () => null,
  clearDismissedUpdateVersion: () => {},
}))

// update-downloaded fires a dynamic import('./menu') to rebuild the menu.
// Stub it so this test does not pull in the real Electron menu module.
mock.module('../menu', () => ({
  rebuildMenu: () => {},
}))

// ─── Load module under test (after mocks are in place) ────────────────────────

type UpdateInfo = {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  downloadState: 'idle' | 'downloading' | 'ready' | 'installing' | 'error'
  downloadProgress: number
  error?: string
}

let getUpdateInfo: () => UpdateInfo
let checkForUpdates: (opts?: { autoDownload?: boolean }) => Promise<UpdateInfo>

beforeAll(async () => {
  const mod = await import('../auto-update')
  getUpdateInfo = mod.getUpdateInfo
  checkForUpdates = mod.checkForUpdates as typeof checkForUpdates
})

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Fire all registered autoUpdater event handlers for the given event name */
function fire(event: string, arg: unknown = {}): void {
  for (const handler of registeredHandlers[event] ?? []) {
    handler(arg)
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('update-available event — downloadState', () => {
  beforeEach(() => {
    mockAutoUpdater.autoDownload = true
  })

  it('is "downloading" when autoDownload is true', () => {
    mockAutoUpdater.autoDownload = true
    fire('update-available', { version: '1.1.0' })

    const info = getUpdateInfo()
    expect(info.downloadState).toBe('downloading')
    expect(info.downloadProgress).toBe(0)
    expect(info.available).toBe(true)
    expect(info.latestVersion).toBe('1.1.0')
  })

  it('[regression] is "idle" — NOT "downloading" — when autoDownload is false', () => {
    // Before the fix: update-available always set downloadState: 'downloading'
    // even when autoDownload was false and no bytes would ever be transferred.
    // This caused the progress bar to show "0% downloading" forever.
    // After the fix: state must be 'idle' so the UI does not show a stalled bar.
    mockAutoUpdater.autoDownload = false
    fire('update-available', { version: '1.2.0' })

    const info = getUpdateInfo()
    expect(info.downloadState).not.toBe('downloading')
    expect(info.downloadState).toBe('idle')
  })

  it('still marks the update as available even when autoDownload is false', () => {
    mockAutoUpdater.autoDownload = false
    fire('update-available', { version: '1.3.0' })

    const info = getUpdateInfo()
    expect(info.available).toBe(true)
    expect(info.latestVersion).toBe('1.3.0')
  })
})

describe('download-progress event', () => {
  it('rounds fractional percent and stores it', () => {
    fire('download-progress', { percent: 42.7 })
    expect(getUpdateInfo().downloadProgress).toBe(43) // Math.round(42.7)
  })

  it('handles 0%', () => {
    fire('download-progress', { percent: 0 })
    expect(getUpdateInfo().downloadProgress).toBe(0)
  })

  it('handles 100%', () => {
    fire('download-progress', { percent: 100 })
    expect(getUpdateInfo().downloadProgress).toBe(100)
  })
})

describe('update-not-available event', () => {
  it('sets available: false and resets downloadState to "idle"', () => {
    fire('update-not-available', { version: '1.0.0' })

    const info = getUpdateInfo()
    expect(info.available).toBe(false)
    expect(info.downloadState).toBe('idle')
  })
})

describe('update-downloaded event', () => {
  it('sets downloadState to "ready" with downloadProgress 100', () => {
    fire('update-downloaded', { version: '2.0.0' })

    // State update is synchronous; the async menu rebuild follows it
    const info = getUpdateInfo()
    expect(info.downloadState).toBe('ready')
    expect(info.downloadProgress).toBe(100)
    expect(info.available).toBe(true)
    expect(info.latestVersion).toBe('2.0.0')
  })
})

describe('checkForUpdates — autoDownload flag lifecycle', () => {
  it('restores autoDownload to true after being called with autoDownload: false', async () => {
    // The finally block in checkForUpdates must restore the original flag so
    // subsequent background checks (which need autoDownload: true) still work.
    mockAutoUpdater.autoDownload = true
    await checkForUpdates({ autoDownload: false })
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })

  it('keeps autoDownload as true when called with autoDownload: true', async () => {
    mockAutoUpdater.autoDownload = true
    await checkForUpdates({ autoDownload: true })
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })
})
