// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent
import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow, dialog, powerMonitor } from 'electron'

import { join } from 'path'
import { existsSync } from 'fs'
import { SessionManager } from './sessions'
import { registerIpcHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces, loadStoredConfig, syncWorkspaces, addWorkspace, ensureConfigExists, setActiveConnection, loadConnections } from '@opentomo/shared/config'
import { getDefaultWorkspacesDir, generateUniqueWorkspacePath, CONFIG_DIR, isValidWorkspace, createWorkspaceAtPath, ensureWorkspaceDirStructure } from '@opentomo/shared/workspaces'
import { ensureDefaultPermissions } from '@opentomo/shared/agent'
import { ensureToolIcons, ensurePresetThemes } from '@opentomo/shared/config'
import { setBundledAssetsRoot } from '@opentomo/shared/utils'
import { handleDeepLink } from './deep-link'
import { registerThumbnailScheme, registerThumbnailHandler } from './thumbnail-protocol'
import { registerMediaImageScheme, registerMediaImageHandler } from './media-protocol'
import log, { isDebugMode, mainLog, getLogFilePath } from './logger'
import { setPerfEnabled, enableDebug } from '@opentomo/shared/utils'
import { initNotificationService, clearBadgeCount, initBadgeIcon, initInstanceBadge } from './notifications'
import { checkForUpdatesOnLaunch, setWindowManager as setAutoUpdateWindowManager, isUpdating, startPeriodicUpdateChecks, stopPeriodicUpdateChecks } from './auto-update'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.SS_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Custom URL scheme for deeplinks (e.g., opentomo://auth-complete)
// Supports multi-instance dev: SS_DEEPLINK_SCHEME env var (opentomo1, opentomo2, etc.)
const DEEPLINK_SCHEME = process.env.SS_DEEPLINK_SCHEME || 'opentomo'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: SS_APP_NAME env var (e.g., "OpenTomo [1]")
app.setName(process.env.SS_APP_NAME || 'OpenTomo')

// Register as default protocol client for opentomo:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Register thumbnail:// custom protocol for file preview thumbnails in the sidebar.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerThumbnailScheme()
registerMediaImageScheme()

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager).catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager).catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

/**
 * Ensure all workspace folders exist and have valid directory structures.
 * Handles cases where workspace folders were deleted after config.json was written,
 * or where onboarding saved config but failed to create the folder.
 * Runs on startup to guarantee workspaces are in a usable state before opening windows.
 */
function ensureWorkspaceHealth(workspaces: ReturnType<typeof getWorkspaces>): void {
  for (const ws of workspaces) {
    try {
      if (!isValidWorkspace(ws.rootPath)) {
        // Folder missing entirely (e.g. user deleted it, or onboarding didn't create it)
        mainLog.warn(`[Startup] Workspace folder missing, repairing: ${ws.rootPath}`)
        createWorkspaceAtPath(ws.rootPath, ws.name)
        mainLog.info(`[Startup] Workspace repaired successfully: ${ws.rootPath}`)
      } else {
        // config.json exists but subdirectories (sessions/, sources/, etc.) may be missing
        ensureWorkspaceDirStructure(ws.rootPath)
      }
    } catch (err) {
      mainLog.error(`[Startup] Failed to repair workspace: ${ws.rootPath}`, err)
    }
  }
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Step 1: Recover workspace folders that exist on disk but aren't tracked in config.
  // This handles the case where a user manually removed a workspace entry from config.json
  // while the workspace folder itself is still on disk.
  syncWorkspaces()

  // Load saved window state
  const savedState = loadWindowState()
  let workspaces = getWorkspaces()

  if (workspaces.length === 0) {
    // Step 2: No workspaces found anywhere — check if this is a returning user.
    // A returning user may have credentials.enc or connections.json even if config.json is missing
    // (e.g. user added a custom connection which creates those files but NOT config.json).
    const config = loadStoredConfig()
    const isReturningUser = config?.authType != null
      || existsSync(join(CONFIG_DIR, 'credentials.enc'))
      || existsSync(join(CONFIG_DIR, 'connections.json'))

    if (isReturningUser) {
      // Returning user lost all workspaces or config.json is missing.
      // Create minimal config.json if needed, then try to recover existing workspace
      // folders from disk before falling back to creating a brand-new workspace.
      // This handles the case where config.json was corrupted (e.g. non-atomic write
      // interrupted on Windows) but workspace folders still exist on disk.
      mainLog.warn('[Startup] Returning user has no workspaces; auto-recovering...')
      ensureConfigExists()
      syncWorkspaces()  // Re-discover existing workspace folders on disk
      workspaces = getWorkspaces()
      if (workspaces.length === 0) {
        // No existing workspace folders found — create a fresh default workspace
        const rootPath = generateUniqueWorkspacePath('My Workspace', getDefaultWorkspacesDir())
        addWorkspace({ name: 'My Workspace', rootPath })
        workspaces = getWorkspaces()
      }
    }
  }

  // Step 2b: Ensure workspace folder structures are valid on disk.
  // Handles: (a) folders deleted while app was not running, (b) onboarding that saved config
  // but failed to create the folder, (c) missing subdirectories (sessions/, sources/, etc.).
  ensureWorkspaceHealth(workspaces)

  if (workspaces.length === 0) {
    // Step 3: New user (no authType set) — show onboarding
    windowManager.createWindow({ workspaceId: '' })
    return
  }

  const validWorkspaceIds = workspaces.map(ws => ws.id)

  if (savedState?.windows.length) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid workspaces
      if (!validWorkspaceIds.includes(saved.workspaceId)) continue

      // Restore main window with focused mode if it was saved
      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, focused=${saved.focused ?? false}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        focused: saved.focused,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      return
    }
  }

  // Default: open window for first workspace
  windowManager.createWindow({ workspaceId: workspaces[0].id })
  mainLog.info(`Created window for first workspace: ${workspaces[0].name}`)
}

app.whenReady().then(async () => {
  // Register bundled assets root so all seeding functions can find their files
  // (docs, permissions, themes, tool-icons resolve via getBundledAssetsDir)
  setBundledAssetsRoot(__dirname)

  // Ensure default permissions file exists (copies bundled default.json on first run)
  ensureDefaultPermissions()

  // Seed tool icons to ~/.opentomo/tool-icons/ (copies bundled SVGs on first run)
  ensureToolIcons()

  // Seed preset themes to ~/.opentomo/themes/ (copies bundled JSON files on first run)
  ensurePresetThemes()

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()
  registerMediaImageHandler()

  // Note: electron-updater handles pending updates internally via autoInstallOnAppQuit

  // Application menu is created after windowManager initialization (see below)

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = join(__dirname, '../resources/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
      // Initialize badge icon for canvas-based badge overlay
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // SS_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = process.env.SS_INSTANCE_NUMBER
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    // Initialize window manager
    windowManager = new WindowManager()

    // Create the application menu (needs windowManager for New Window action)
    createApplicationMenu(windowManager)

    // Initialize session manager
    sessionManager = new SessionManager()
    sessionManager.setWindowManager(windowManager)

    // Initialize notification service
    initNotificationService(windowManager)

    // Register IPC handlers (must happen before window creation)
    registerIpcHandlers(sessionManager, windowManager)

    // Create initial windows (restores from saved state or opens first workspace)
    await createInitialWindows()

    // Initialize auth (must happen after window creation for error reporting)
    await sessionManager.initialize()

    // Warm up custom API provider in background (Azure/OpenRouter cold start mitigation).
    // Fire-and-forget — never blocks startup.
    sessionManager.warmupApiConnection().catch(() => {/* non-critical */})

    // If we auto-recovered (workspace created with a blank config.json), try to re-activate
    // any existing connections so the auth settings are properly restored.
    try {
      const recoveredConfig = loadStoredConfig()
      const connections = loadConnections()
      if (recoveredConfig && !recoveredConfig.activeConnectionId && connections.length > 0) {
        mainLog.info('[Startup] Re-activating connection after recovery:', connections[0].name)
        await setActiveConnection(connections[0].id)
        await sessionManager.reinitializeAuth()
      }
    } catch (e) {
      mainLog.warn('[Startup] Failed to re-activate connection after recovery:', e)
    }

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    setAutoUpdateWindowManager(windowManager)
    if (app.isPackaged) {
      checkForUpdatesOnLaunch().catch(err => {
        mainLog.error('[auto-update] Launch check failed:', err)
      })
      // Start periodic checks (every 4 hours)
      startPeriodicUpdateChecks()
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager)
      pendingDeepLink = null
    }

    mainLog.info('App initialized successfully')

    // Re-warm provider on system resume (sleep/wake cycle causes cold starts)
    powerMonitor.on('resume', () => {
      sessionManager?.warmupApiConnection().catch(() => {/* non-critical */})
    })

    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
  } catch (error) {
    mainLog.error('Failed to initialize app:', error)

    // If bundled runtime is missing, show a clear error and quit — the app cannot function
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('Bundled Bun runtime not found')) {
      dialog.showErrorBox(
        'Application Error',
        'The bundled runtime was not found. This may be caused by antivirus software '
        + 'quarantining the file or a corrupted installation.\n\n'
        + 'Please try:\n'
        + '1. Reinstalling the application\n'
        + '2. Adding the app directory to your antivirus exclusions\n'
        + '3. Checking Windows Defender quarantine for blocked files'
      )
      app.quit()
      return
    }

    // For other errors, continue — the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (!windowManager?.hasWindows() && windowManager) {
      const workspaces = getWorkspaces()
      if (workspaces.length > 0) {
        // Open last focused workspace or first available
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        const targetId = workspaces.some(ws => ws.id === wsId) ? wsId : workspaces[0].id
        windowManager.createWindow({ workspaceId: targetId })
      } else {
        // No workspaces — open a window that will show onboarding/recovery UI
        windowManager.createWindow({ workspaceId: '' })
      }
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track if we're in the process of quitting (to avoid re-entry)
let isQuitting = false

// Save window state and clean up resources before quitting
app.on('before-quit', async (event) => {
  // Avoid re-entry when we call app.exit()
  if (isQuitting) return
  isQuitting = true

  if (windowManager) {
    // Get full window states (includes bounds, type, and query)
    const windows = windowManager.getWindowStates()
    // Get the focused window's workspace as last focused
    const focusedWindow = BrowserWindow.getFocusedWindow()
    let lastFocusedWorkspaceId: string | undefined
    if (focusedWindow) {
      lastFocusedWorkspaceId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
    }

    saveWindowState({
      windows,
      lastFocusedWorkspaceId,
    })
    mainLog.info('Saved window state:', windows.length, 'windows')
  }

  // Stop periodic update checks
  if (app.isPackaged) {
    stopPeriodicUpdateChecks()
  }

  // Flush all pending session writes before quitting
  if (sessionManager) {
    // Prevent quit until sessions are flushed
    event.preventDefault()
    try {
      await sessionManager.flushAllSessions()
      mainLog.info('Flushed all pending session writes')
    } catch (error) {
      mainLog.error('Failed to flush sessions:', error)
    }
    // Clean up SessionManager resources (file watchers, timers, etc.)
    sessionManager.cleanup()

    // If update is in progress, let electron-updater handle the quit flow
    // Force exit breaks the NSIS installer on Windows
    if (isUpdating()) {
      mainLog.info('Update in progress, letting electron-updater handle quit')
      app.quit()
      return
    }

    // Now actually quit
    app.exit(0)
  }
})

// Handle uncaught exceptions — log for diagnostics
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  // Suppress known benign SDK race: control response arrives after transport closes at session end
  if (reason instanceof Error && reason.message === 'ProcessTransport is not ready for writing') return
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
})
