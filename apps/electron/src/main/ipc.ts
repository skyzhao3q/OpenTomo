import { app, ipcMain, nativeTheme, nativeImage, dialog, shell, BrowserWindow } from 'electron'
import { readFile, readdir, stat, realpath, mkdir, writeFile, unlink, rm, rename } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { normalize, isAbsolute, join, basename, dirname, resolve, sep } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { SessionManager } from './sessions'
import { ipcLog, windowLog, searchLog } from './logger'
import { WindowManager } from './window-manager'
import { registerOnboardingHandlers } from './onboarding'
import { registerTerminalHandlers } from './ipc/terminal-handlers'
import { IPC_CHANNELS, type FileAttachment, type StoredAttachment, type AuthType, type ApiSetupInfo, type ClaudeOAuthStatus, type SendMessageOptions } from '../shared/types'
import { readFileAttachment, perf, validateImageForClaudeAPI, IMAGE_LIMITS } from '@opentomo/shared/utils'
import { getAuthType, setAuthType, getPreferencesPath, getCustomModel, setCustomModel, getModel, setModel, getDefaultChatMode, setDefaultChatMode, getProvider, setProvider, getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, getWorkspaceByNameOrId, addWorkspace, setActiveWorkspace, getAnthropicBaseUrl, setAnthropicBaseUrl, loadStoredConfig, saveConfig, resolveModelId, type Workspace, SUMMARIZATION_MODEL, DEFAULT_MODEL, CONFIG_DIR } from '@opentomo/shared/config'
import { getSessionAttachmentsPath, validateSessionId } from '@opentomo/shared/sessions'
import { isValidWorkspace, createWorkspaceAtPath, ensureWorkspaceDirStructure } from '@opentomo/shared/workspaces'
import { isValidThinkingLevel } from '@opentomo/shared/agent/thinking-levels'
import { readUserMd, writeUserMd, getUserMdPath } from '@opentomo/shared/prompts/user-context'
import { readGlobalSoulMd, writeGlobalSoulMd, getSoulMdPath } from '@opentomo/shared/prompts/soul'
import { getCredentialManager } from '@opentomo/shared/credentials'

/**
 * Sanitizes a filename to prevent path traversal and filesystem issues.
 * Removes dangerous characters and limits length.
 */
function sanitizeFilename(name: string): string {
  return name
    // Remove path separators and traversal patterns
    .replace(/[/\\]/g, '_')
    // Remove Windows-forbidden characters: < > : " | ? *
    .replace(/[<>:"|?*]/g, '_')
    // Remove control characters (ASCII 0-31)
    .replace(/[\x00-\x1f]/g, '')
    // Collapse multiple dots (prevent hidden files and extension tricks)
    .replace(/\.{2,}/g, '.')
    // Remove leading/trailing dots and spaces (Windows issues)
    .replace(/^[.\s]+|[.\s]+$/g, '')
    // Limit length (200 chars is safe for all filesystems)
    .slice(0, 200)
    // Fallback if name is empty after sanitization
    || 'unnamed'
}

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

/**
 * Validates that a file path is within allowed directories to prevent path traversal attacks.
 * Allowed directories: user's home directory and /tmp
 */
async function validateFilePath(filePath: string): Promise<string> {
  // Normalize the path to resolve . and .. components
  let normalizedPath = normalize(filePath)

  // Expand ~ to home directory
  if (normalizedPath.startsWith('~')) {
    normalizedPath = normalizedPath.replace(/^~/, homedir())
  }

  // Must be an absolute path
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Only absolute file paths are allowed')
  }

  // Resolve symlinks to get the real path
  let realPath: string
  try {
    realPath = await realpath(normalizedPath)
  } catch {
    // File doesn't exist or can't be resolved - use normalized path
    realPath = normalizedPath
  }

  // Define allowed base directories
  const allowedDirs = [
    homedir(),      // User's home directory
    tmpdir(),       // Platform-appropriate temp directory
  ]

  // Check if the real path is within an allowed directory (cross-platform)
  const isAllowed = allowedDirs.some(dir => {
    const normalizedDir = normalize(dir)
    const normalizedReal = normalize(realPath)
    return normalizedReal.startsWith(normalizedDir + sep) || normalizedReal === normalizedDir
  })

  if (!isAllowed) {
    throw new Error('Access denied: file path is outside allowed directories')
  }

  // Block sensitive files even within home directory
  const sensitivePatterns = [
    /\.ssh\//,
    /\.gnupg\//,
    /\.aws\/credentials/,
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
  ]

  if (sensitivePatterns.some(pattern => pattern.test(realPath))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  return realPath
}

/**
 * Shared test helper — validates an API key + endpoint + model by sending a minimal
 * POST /v1/messages request. Used by both SETTINGS_TEST_API_CONNECTION (user-supplied
 * credentials) and CONNECTIONS_TEST (encrypted credentials loaded from CredentialManager).
 */
async function testApiConnectionInternal(
  apiKey: string | undefined,
  baseUrl: string | undefined,
  modelName: string | undefined,
): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = apiKey?.trim()
  const trimmedUrl = baseUrl?.trim()

  // Require API key unless a custom base URL is provided (e.g. Ollama needs no key)
  if (!trimmedKey && !trimmedUrl) {
    return { success: false, error: 'API key is required' }
  }

  try {
    // Unified test: send a minimal POST to /v1/messages with a tool definition.
    // This validates connection, auth, model existence, and tool support in one call.
    // Works identically for Anthropic, OpenRouter, Vercel AI Gateway, and Ollama (v0.14+).
    const Anthropic = (await import('@anthropic-ai/sdk')).default

    // Auth strategy:
    // - Anthropic direct (no URL, or https://api.anthropic.com): pass as apiKey (SDK sends x-api-key header).
    //   Always explicitly set baseURL to https://api.anthropic.com to prevent the SDK from reading
    //   ANTHROPIC_BASE_URL from the environment (which may point to the OpenTomo proxy).
    // - Custom base URL: pass key as authToken (SDK sends Authorization: Bearer,
    //   which OpenRouter, Vercel AI Gateway, and Ollama all accept).
    //   Explicitly null the other auth param to prevent SDK from reading env vars.
    const isAnthropicDirect = !trimmedUrl || trimmedUrl.startsWith('https://api.anthropic.com')
    const client = new Anthropic({
      baseURL: isAnthropicDirect ? 'https://api.anthropic.com' : trimmedUrl,
      ...(isAnthropicDirect
        ? { apiKey: trimmedKey, authToken: null }              // x-api-key for Anthropic direct
        : { authToken: trimmedKey || 'ollama', apiKey: null }  // Bearer for custom URLs; 'ollama' dummy for no-key local APIs
      ),
    })

    // Determine test model: user-specified model takes priority, otherwise use
    // the default Haiku model for known providers (validates full pipeline).
    // Custom endpoints MUST specify a model — there's no sensible default.
    const userModel = modelName?.trim()
    let testModel: string
    if (userModel) {
      testModel = userModel
    } else if (isAnthropicDirect || trimmedUrl.includes('openrouter.ai') || trimmedUrl.includes('ai-gateway.vercel.sh')) {
      // Anthropic, OpenRouter, and Vercel are all Anthropic-compatible — same model IDs
      testModel = resolveModelId(SUMMARIZATION_MODEL)
    } else {
      // Custom endpoint with no model specified — can't test without knowing the model
      return { success: false, error: 'Please specify a model for custom endpoints' }
    }

    // OpenAI models via providers like OpenRouter require max_tokens >= 16
    await client.messages.create({
      model: testModel,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      // Include a tool to validate tool/function calling support
      tools: [{
        name: 'test_tool',
        description: 'Test tool for validation',
        input_schema: { type: 'object' as const, properties: {} }
      }]
    })

    // 200 response — everything works (auth, endpoint, model, tool support)
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const lowerMsg = msg.toLowerCase()
    ipcLog.info(`[testApiConnection] Error: ${msg.slice(0, 500)}`)

    // Connection errors — server unreachable
    if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('fetch failed')) {
      return { success: false, error: 'Cannot connect to API server. Check the URL and ensure the server is running.' }
    }

    // 404 on endpoint — /v1/messages doesn't exist (wrong URL or Ollama < v0.14)
    if (lowerMsg.includes('404') && !lowerMsg.includes('model')) {
      return { success: false, error: 'Endpoint not found. Ensure the server supports the Anthropic Messages API (/v1/messages). For Ollama, version 0.14+ is required.' }
    }

    // Auth errors
    if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('authentication')) {
      return { success: false, error: 'Invalid API key' }
    }

    // OpenRouter data policy errors (check before tool support since both may contain "model")
    if (lowerMsg.includes('data policy') || lowerMsg.includes('privacy')) {
      return { success: false, error: 'Data policy restriction. Configure your privacy settings at openrouter.ai/settings/privacy' }
    }

    // Tool support errors (check before model-not-found since tool errors often contain "model")
    const isToolSupportError =
      lowerMsg.includes('no endpoints found that support tool use') ||
      lowerMsg.includes('does not support tool') ||
      lowerMsg.includes('tool_use is not supported') ||
      lowerMsg.includes('function calling not available') ||
      lowerMsg.includes('tools are not supported') ||
      lowerMsg.includes("doesn't support tool") ||
      lowerMsg.includes('tool use is not supported') ||
      (lowerMsg.includes('tool') && lowerMsg.includes('not') && lowerMsg.includes('support'))
    if (isToolSupportError) {
      const displayModel = modelName?.trim() || resolveModelId(SUMMARIZATION_MODEL)
      return { success: false, error: `Model "${displayModel}" does not support tool/function calling. This app requires a model with tool support (e.g. Claude, GPT-4, Gemini).` }
    }

    // Model not found — always a failure.
    const isModelNotFound =
      lowerMsg.includes('model not found') ||
      lowerMsg.includes('is not a valid model') ||
      lowerMsg.includes('invalid model') ||
      (lowerMsg.includes('404') && lowerMsg.includes('model'))
    if (isModelNotFound) {
      if (modelName?.trim()) {
        return { success: false, error: `Model "${modelName}" not found. Check the model name and try again.` }
      }
      // Default model (Haiku) not found on a known provider — likely a billing/permissions issue
      return { success: false, error: 'Could not access the default model. Check your API key permissions and billing.' }
    }

    // Fallback: return the raw error message
    return { success: false, error: msg.slice(0, 300) }
  }
}

export function registerIpcHandlers(sessionManager: SessionManager, windowManager: WindowManager): void {
  // Get all sessions
  ipcMain.handle(IPC_CHANNELS.GET_SESSIONS, async () => {
    const end = perf.start('ipc.getSessions')
    const sessions = sessionManager.getSessions()
    end()
    return sessions
  })

  // Get a single session with messages (for lazy loading)
  ipcMain.handle(IPC_CHANNELS.GET_SESSION_MESSAGES, async (_event, sessionId: string) => {
    const end = perf.start('ipc.getSessionMessages')
    const session = await sessionManager.getSession(sessionId)
    end()
    return session
  })

  // Get workspaces
  ipcMain.handle(IPC_CHANNELS.GET_WORKSPACES, async () => {
    return sessionManager.getWorkspaces()
  })

  // Create a new workspace at a folder path (Obsidian-style: folder IS the workspace)
  ipcMain.handle(IPC_CHANNELS.CREATE_WORKSPACE, async (_event, folderPath: string, name: string) => {
    const rootPath = folderPath
    const workspace = addWorkspace({ name, rootPath })
    // Make it active
    setActiveWorkspace(workspace.id)
    ipcLog.info(`Created workspace "${name}" at ${rootPath}`)
    return workspace
  })

  // Check if a workspace slug already exists (for validation before creation)
  ipcMain.handle(IPC_CHANNELS.CHECK_WORKSPACE_SLUG, async (_event, slug: string) => {
    const defaultWorkspacesDir = join(CONFIG_DIR, 'workspaces')
    const workspacePath = join(defaultWorkspacesDir, slug)
    const exists = existsSync(workspacePath)
    return { exists, path: workspacePath }
  })

  // ============================================================
  // Window Management
  // ============================================================

  // Get workspace ID for the calling window
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_WORKSPACE, (event) => {
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    // Set up ConfigWatcher for live updates (statuses, sources, themes)
    if (workspaceId) {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (workspace) {
        sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
      }
    }
    return workspaceId
  })

  // Open workspace in new window (or focus existing)
  ipcMain.handle(IPC_CHANNELS.OPEN_WORKSPACE, async (_event, workspaceId: string) => {
    windowManager.focusOrCreateWindow(workspaceId)
  })

  // Open a session in a new window
  ipcMain.handle(IPC_CHANNELS.OPEN_SESSION_IN_NEW_WINDOW, async (_event, workspaceId: string, sessionId: string) => {
    // Build deep link for session navigation
    const deepLink = `opentomo://allChats/chat/${sessionId}`
    windowManager.createWindow({
      workspaceId,
      focused: true,
      initialDeepLink: deepLink,
    })
  })

  // Get mode for the calling window (always 'main' now)
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_MODE, () => {
    return 'main'
  })

  // Close the calling window (triggers close event which may be intercepted)
  ipcMain.handle(IPC_CHANNELS.CLOSE_WINDOW, (event) => {
    windowManager.closeWindow(event.sender.id)
  })

  // Confirm close - force close the window (bypasses interception).
  // Called by renderer when it has no modals to close and wants to proceed.
  ipcMain.handle(IPC_CHANNELS.WINDOW_CONFIRM_CLOSE, (event) => {
    windowManager.forceCloseWindow(event.sender.id)
  })

  // Show/hide macOS traffic light buttons (for fullscreen overlays)
  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_TRAFFIC_LIGHTS, (event, visible: boolean) => {
    windowManager.setTrafficLightsVisible(event.sender.id, visible)
  })

  // Switch workspace in current window (in-window switching)
  ipcMain.handle(IPC_CHANNELS.SWITCH_WORKSPACE, async (event, workspaceId: string) => {
    const end = perf.start('ipc.switchWorkspace', { workspaceId })

    // Get the old workspace ID before updating
    const oldWorkspaceId = windowManager.getWorkspaceForWindow(event.sender.id)

    // Update the window's workspace mapping
    const updated = windowManager.updateWindowWorkspace(event.sender.id, workspaceId)

    // If update failed, the window may have been re-created (e.g., after refresh)
    // Try to register it
    if (!updated) {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        windowManager.registerWindow(win, workspaceId)
        windowLog.info(`Re-registered window ${event.sender.id} for workspace ${workspaceId}`)
      }
    }

    // Clear activeViewingSession for old workspace if no other windows are viewing it
    // This ensures read/unread state is correct after workspace switch
    if (oldWorkspaceId && oldWorkspaceId !== workspaceId) {
      const otherWindows = windowManager.getAllWindowsForWorkspace(oldWorkspaceId)
      if (otherWindows.length === 0) {
        sessionManager.clearActiveViewingSession(oldWorkspaceId)
      }
    }

    // Set up ConfigWatcher for the new workspace
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
    }
    end()
  })

  // Create a new session
  ipcMain.handle(IPC_CHANNELS.CREATE_SESSION, async (_event, workspaceId: string, options?: import('../shared/types').CreateSessionOptions) => {
    const end = perf.start('ipc.createSession', { workspaceId })

    // Ensure workspace folder exists before creating a session.
    // Handles the case where the user deleted the workspace folder while the app was running.
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      try {
        if (!isValidWorkspace(workspace.rootPath)) {
          ipcLog.warn(`[CreateSession] Workspace folder missing, repairing: ${workspace.rootPath}`)
          createWorkspaceAtPath(workspace.rootPath, workspace.name)
          ipcLog.info(`[CreateSession] Workspace repaired: ${workspace.rootPath}`)
        } else {
          ensureWorkspaceDirStructure(workspace.rootPath)
        }
      } catch (repairErr) {
        ipcLog.error(`[CreateSession] Failed to repair workspace:`, repairErr)
        // Continue anyway — createSession will surface the real error if the folder is still broken
      }
    }

    const session = sessionManager.createSession(workspaceId, options)
    end()
    return session
  })

  // Delete a session
  ipcMain.handle(IPC_CHANNELS.DELETE_SESSION, async (_event, sessionId: string) => {
    return sessionManager.deleteSession(sessionId)
  })

  // Send a message to a session (with optional file attachments)
  // Note: We intentionally don't await here - the response is streamed via events.
  // The IPC handler returns immediately, and results come through SESSION_EVENT channel.
  // attachments: FileAttachment[] for Claude (has content), storedAttachments: StoredAttachment[] for persistence (has thumbnailBase64)
  ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (event, sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions) => {
    // Capture the workspace from the calling window for error routing
    const callingWorkspaceId = windowManager.getWorkspaceForWindow(event.sender.id)

    // Start processing in background, errors are sent via event stream
    sessionManager.sendMessage(sessionId, message, attachments, storedAttachments, options).catch(err => {
      ipcLog.error('Error in sendMessage:', err)
      // Send error to renderer so user sees it (route to correct window)
      const window = callingWorkspaceId
        ? windowManager.getWindowByWorkspace(callingWorkspaceId)
        : BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      // Check mainFrame - it becomes null when render frame is disposed
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.mainFrame) {
        window.webContents.send(IPC_CHANNELS.SESSION_EVENT, {
          type: 'error',
          sessionId,
          error: err instanceof Error ? err.message : 'Unknown error'
        })
        // Also send complete event to clear processing state
        window.webContents.send(IPC_CHANNELS.SESSION_EVENT, {
          type: 'complete',
          sessionId
        })
      }
    })
    // Return immediately - streaming results come via SESSION_EVENT
    return { started: true }
  })

  // Cancel processing
  ipcMain.handle(IPC_CHANNELS.CANCEL_PROCESSING, async (_event, sessionId: string, silent?: boolean) => {
    return sessionManager.cancelProcessing(sessionId, silent)
  })

  // Kill background shell
  ipcMain.handle(IPC_CHANNELS.KILL_SHELL, async (_event, sessionId: string, shellId: string) => {
    return sessionManager.killShell(sessionId, shellId)
  })

  // Get background task output
  ipcMain.handle(IPC_CHANNELS.GET_TASK_OUTPUT, async (_event, taskId: string) => {
    try {
      const output = await sessionManager.getTaskOutput(taskId)
      return output
    } catch (err) {
      ipcLog.error('Failed to get task output:', err)
      throw err
    }
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_PERMISSION, async (_event, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
  })

  // Respond to a credential request (secure auth input)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.RESPOND_TO_CREDENTIAL, async (_event, sessionId: string, requestId: string, response: import('../shared/types').CredentialResponse) => {
    return sessionManager.respondToCredential(sessionId, requestId, response)
  })

  // ==========================================================================
  // Consolidated Command Handlers
  // ==========================================================================

  // Session commands - consolidated handler for session operations
  ipcMain.handle(IPC_CHANNELS.SESSION_COMMAND, async (
    _event,
    sessionId: string,
    command: import('../shared/types').SessionCommand
  ) => {
    switch (command.type) {
      case 'flag':
        return sessionManager.flagSession(sessionId)
      case 'unflag':
        return sessionManager.unflagSession(sessionId)
      case 'rename':
        return sessionManager.renameSession(sessionId, command.name)
      case 'markRead':
        return sessionManager.markSessionRead(sessionId)
      case 'markUnread':
        return sessionManager.markSessionUnread(sessionId)
      case 'setActiveViewing':
        // Track which session user is actively viewing (for unread state machine)
        return sessionManager.setActiveViewingSession(sessionId, command.workspaceId)
      case 'setPermissionMode':
        return sessionManager.setSessionPermissionMode(sessionId, command.mode)
      case 'setThinkingLevel':
        // Validate thinking level before passing to session manager
        if (!isValidThinkingLevel(command.level)) {
          throw new Error(`Invalid thinking level: ${command.level}. Valid values: 'off', 'think', 'max'`)
        }
        return sessionManager.setSessionThinkingLevel(sessionId, command.level)
      case 'updateWorkingDirectory':
        return sessionManager.updateWorkingDirectory(sessionId, command.dir)
      case 'setProject':
        return sessionManager.setSessionProject(sessionId, command.projectId)
      case 'showInFinder': {
        const sessionPath = sessionManager.getSessionPath(sessionId)
        if (sessionPath) {
          shell.showItemInFolder(sessionPath)
        }
        return
      }
      case 'copyPath': {
        // Return the session folder path for copying to clipboard
        const sessionPath = sessionManager.getSessionPath(sessionId)
        return sessionPath ? { success: true, path: sessionPath } : { success: false }
      }
      case 'startOAuth':
        return sessionManager.startSessionOAuth(sessionId, command.requestId)
      case 'refreshTitle':
        ipcLog.info(`IPC: refreshTitle received for session ${sessionId}`)
        return sessionManager.refreshTitle(sessionId)
      // Pending plan execution (Accept & Compact flow)
      case 'setPendingPlanExecution':
        return sessionManager.setPendingPlanExecution(sessionId, command.planPath)
      case 'markCompactionComplete':
        return sessionManager.markCompactionComplete(sessionId)
      case 'clearPendingPlanExecution':
        return sessionManager.clearPendingPlanExecution(sessionId)
      default: {
        const _exhaustive: never = command
        throw new Error(`Unknown session command: ${JSON.stringify(command)}`)
      }
    }
  })

  // Get pending plan execution state (for reload recovery)
  ipcMain.handle(IPC_CHANNELS.GET_PENDING_PLAN_EXECUTION, async (
    _event,
    sessionId: string
  ) => {
    return sessionManager.getPendingPlanExecution(sessionId)
  })

  // Read a file (with path validation to prevent traversal attacks)
  ipcMain.handle(IPC_CHANNELS.READ_FILE, async (_event, path: string) => {
    try {
      // Validate and normalize the path
      const safePath = await validateFilePath(path)
      const content = await readFile(safePath, 'utf-8')
      return content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFile error:', message)
      throw new Error(`Failed to read file: ${message}`)
    }
  })

  // Read a file as a data URL for in-app binary preview (images).
  // Returns data:{mime};base64,{content} — used by ImagePreviewOverlay.
  // Note: PDFs use file:// URLs directly (Chromium's PDF viewer doesn't support data: URLs).
  ipcMain.handle(IPC_CHANNELS.READ_FILE_DATA_URL, async (_event, path: string) => {
    try {
      const safePath = await validateFilePath(path)
      const buffer = await readFile(safePath)
      const ext = safePath.split('.').pop()?.toLowerCase() ?? ''

      // Map extensions to MIME types (only formats Chromium can render in-app).
      // HEIC/HEIF and TIFF are excluded — no Chromium codec, opened externally instead.
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        avif: 'image/avif',
        pdf: 'application/pdf',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const base64 = buffer.toString('base64')
      return `data:${mime};base64,${base64}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFileDataUrl error:', message)
      throw new Error(`Failed to read file as data URL: ${message}`)
    }
  })

  // Read a file as raw binary (Uint8Array) for react-pdf.
  // Returns Uint8Array which IPC automatically converts to ArrayBuffer for the renderer.
  ipcMain.handle(IPC_CHANNELS.READ_FILE_BINARY, async (_event, path: string) => {
    try {
      const safePath = await validateFilePath(path)
      const buffer = await readFile(safePath)
      // Return as Uint8Array (serializes to ArrayBuffer over IPC)
      return new Uint8Array(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFileBinary error:', message)
      throw new Error(`Failed to read file as binary: ${message}`)
    }
  })

  // Open native file dialog for selecting files to attach
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        // Allow all files by default - the agent can figure out how to handle them
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'icns', 'heic', 'heif', 'svg'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Open native file dialog and read selected files as FileAttachment[]
  // Bypasses validateFilePath since user explicitly chose the files via system dialog
  ipcMain.handle(IPC_CHANNELS.OPEN_AND_READ_FILE_ATTACHMENTS, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'icns', 'heic', 'heif', 'svg'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return []

    const attachments: FileAttachment[] = []
    for (const filePath of result.filePaths) {
      try {
        const attachment = readFileAttachment(filePath)
        if (!attachment) continue

        // Generate Quick Look thumbnail
        try {
          const thumbnail = await nativeImage.createThumbnailFromPath(filePath, { width: 200, height: 200 })
          if (!thumbnail.isEmpty()) {
            ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbnail.toPNG().toString('base64')
          }
        } catch {
          // Thumbnail generation failed - ok, icon fallback will be used
        }

        attachments.push(attachment)
      } catch (error) {
        ipcLog.warn('openAndReadFileAttachments: failed to read file:', filePath, error instanceof Error ? error.message : error)
      }
    }
    return attachments
  })

  // Read file and return as FileAttachment with Quick Look thumbnail
  ipcMain.handle(IPC_CHANNELS.READ_FILE_ATTACHMENT, async (_event, path: string) => {
    try {
      // Validate path first to prevent path traversal
      const safePath = await validateFilePath(path)
      // Use shared utility that handles file type detection, encoding, etc.
      const attachment = await readFileAttachment(safePath)
      if (!attachment) return null

      // Generate Quick Look thumbnail for preview (works for images, PDFs, Office docs on macOS)
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(safePath, { width: 200, height: 200 })
        if (!thumbnail.isEmpty()) {
          ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbnail.toPNG().toString('base64')
        }
      } catch (thumbError) {
        // Thumbnail generation failed - this is ok, we'll show an icon fallback
        ipcLog.info('Quick Look thumbnail failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('readFileAttachment error:', message)
      return null
    }
  })

  // Generate thumbnail from base64 data (for drag-drop files where we don't have a path)
  ipcMain.handle(IPC_CHANNELS.GENERATE_THUMBNAIL, async (_event, base64: string, mimeType: string): Promise<string | null> => {
    // Save to temp file, generate thumbnail, clean up
    const tempDir = tmpdir()
    const ext = mimeType.split('/')[1] || 'bin'
    const tempPath = join(tempDir, `ss-thumb-${randomUUID()}.${ext}`)

    try {
      // Write base64 to temp file
      const buffer = Buffer.from(base64, 'base64')
      await writeFile(tempPath, buffer)

      // Generate thumbnail using Quick Look
      const thumbnail = await nativeImage.createThumbnailFromPath(tempPath, { width: 200, height: 200 })

      // Clean up temp file
      await unlink(tempPath).catch(() => {})

      if (!thumbnail.isEmpty()) {
        return thumbnail.toPNG().toString('base64')
      }
      return null
    } catch (error) {
      // Clean up temp file on error
      await unlink(tempPath).catch(() => {})
      ipcLog.info('generateThumbnail failed:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Store an attachment to disk and generate thumbnail/markdown conversion
  // This is the core of the persistent file attachment system
  ipcMain.handle(IPC_CHANNELS.STORE_ATTACHMENT, async (event, sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> => {
    // Track files we've written for cleanup on error
    const filesToCleanup: string[] = []

    try {
      // Reject empty files early
      if (attachment.size === 0) {
        throw new Error('Cannot attach empty file')
      }

      // Get workspace slug from the calling window
      const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
      if (!workspaceId) {
        throw new Error('Cannot determine workspace for attachment storage')
      }
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      const workspaceRootPath = workspace.rootPath

      // SECURITY: Validate sessionId to prevent path traversal attacks
      // This must happen before using sessionId in any file path operations
      validateSessionId(sessionId)

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
      await mkdir(attachmentsDir, { recursive: true })

      // Generate unique ID for this attachment
      const id = randomUUID()
      const safeName = sanitizeFilename(attachment.name)
      const storedFileName = `${id}_${safeName}`
      const storedPath = join(attachmentsDir, storedFileName)

      // Track if image was resized (for return value)
      let wasResized = false
      let finalSize = attachment.size
      let resizedBase64: string | undefined

      // 1. Save the file (with image validation and resizing)
      if (attachment.base64) {
        // Images, PDFs, Office files - decode from base64
        // Type as Buffer (generic) to allow reassignment from nativeImage.toJPEG/toPNG
        let decoded: Buffer = Buffer.from(attachment.base64, 'base64')
        // Validate decoded size matches expected (allow small variance for encoding overhead)
        if (Math.abs(decoded.length - attachment.size) > 100) {
          throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
        }

        // For images: validate and resize if needed for Claude API compatibility
        if (attachment.type === 'image') {
          // Get image dimensions using nativeImage
          const image = nativeImage.createFromBuffer(decoded)
          const imageSize = image.getSize()

          // Validate image for Claude API
          const validation = validateImageForClaudeAPI(decoded.length, imageSize.width, imageSize.height)

          // For dimension errors, calculate resize instead of rejecting
          // File size errors (>5MB) still reject since we can't fix those without significant quality loss
          let shouldResize = validation.needsResize
          let targetSize = validation.suggestedSize

          if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
            // Image exceeds 8000px limit - calculate resize to fit within limits
            const maxDim = IMAGE_LIMITS.MAX_DIMENSION
            const scale = Math.min(maxDim / imageSize.width, maxDim / imageSize.height)
            targetSize = {
              width: Math.floor(imageSize.width * scale),
              height: Math.floor(imageSize.height * scale),
            }
            shouldResize = true
            ipcLog.info(`Image exceeds ${maxDim}px limit (${imageSize.width}×${imageSize.height}), will resize to ${targetSize.width}×${targetSize.height}`)
          } else if (!validation.valid) {
            // Other validation errors (e.g., file size > 5MB) - reject
            throw new Error(validation.error)
          }

          // If resize is needed (either recommended or required), do it now
          if (shouldResize && targetSize) {
            ipcLog.info(`Resizing image from ${imageSize.width}×${imageSize.height} to ${targetSize.width}×${targetSize.height}`)

            try {
              const resized = image.resize({
                width: targetSize.width,
                height: targetSize.height,
                quality: 'best',
              })

              // Get as PNG for best quality (or JPEG for photos to save space)
              const isPhoto = attachment.mimeType === 'image/jpeg'
              decoded = isPhoto ? resized.toJPEG(IMAGE_LIMITS.JPEG_QUALITY_HIGH) : resized.toPNG()
              wasResized = true
              finalSize = decoded.length

              // Re-validate final size after resize (should be much smaller)
              if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                // Even after resize it's too big - try more aggressive compression
                decoded = resized.toJPEG(IMAGE_LIMITS.JPEG_QUALITY_FALLBACK)
                finalSize = decoded.length
                if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                  throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
                }
              }

              ipcLog.info(`Image resized: ${attachment.size} → ${finalSize} bytes (${Math.round((1 - finalSize / attachment.size) * 100)}% reduction)`)

              // Store resized base64 to return to renderer
              // This is used when sending to Claude API instead of original large base64
              resizedBase64 = decoded.toString('base64')
            } catch (resizeError) {
              ipcLog.error('Image resize failed:', resizeError)
              const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
              throw new Error(`Image too large (${imageSize.width}×${imageSize.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
            }
          }
        }

        await writeFile(storedPath, decoded)
        filesToCleanup.push(storedPath)
      } else if (attachment.text) {
        // Text files - save as UTF-8
        await writeFile(storedPath, attachment.text, 'utf-8')
        filesToCleanup.push(storedPath)
      } else {
        throw new Error('Attachment has no content (neither base64 nor text)')
      }

      // 2. Generate thumbnail using native OS APIs (Quick Look on macOS, Shell handlers on Windows)
      let thumbnailPath: string | undefined
      let thumbnailBase64: string | undefined
      const thumbFileName = `${id}_thumb.png`
      const thumbPath = join(attachmentsDir, thumbFileName)
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(storedPath, { width: 200, height: 200 })
        if (!thumbnail.isEmpty()) {
          const pngBuffer = thumbnail.toPNG()
          await writeFile(thumbPath, pngBuffer)
          thumbnailPath = thumbPath
          thumbnailBase64 = pngBuffer.toString('base64')
          filesToCleanup.push(thumbPath)
        }
      } catch (thumbError) {
        // Thumbnail generation failed - this is ok, we'll show an icon fallback
        ipcLog.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      // 3. Convert Office files to markdown (for sending to Claude)
      // This is required for Office files - Claude can't read raw Office binary
      let markdownPath: string | undefined
      if (attachment.type === 'office') {
        const mdFileName = `${id}_${safeName}.md`
        const mdPath = join(attachmentsDir, mdFileName)
        try {
          const { MarkItDown } = await import('markitdown-js')
          const markitdown = new MarkItDown()
          const result = await markitdown.convert(storedPath)
          if (!result || !result.textContent) {
            throw new Error('Conversion returned empty result')
          }
          await writeFile(mdPath, result.textContent, 'utf-8')
          markdownPath = mdPath
          filesToCleanup.push(mdPath)
          ipcLog.info(`Converted Office file to markdown: ${mdPath}`)
        } catch (convertError) {
          // Conversion failed - throw so user knows the file can't be processed
          // Claude can't read raw Office binary, so a failed conversion = unusable file
          const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
          ipcLog.error('Office to markdown conversion failed:', errorMsg)
          throw new Error(`Failed to convert "${attachment.name}" to readable format: ${errorMsg}`)
        }
      }

      // Return StoredAttachment metadata
      // Include wasResized flag so UI can show notification
      // Include resizedBase64 so renderer uses resized image for Claude API
      return {
        id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: finalSize, // Use final size (may differ if resized)
        originalSize: wasResized ? attachment.size : undefined, // Track original if resized
        storedPath,
        thumbnailPath,
        thumbnailBase64,
        markdownPath,
        wasResized,
        resizedBase64, // Only set when wasResized=true, used for Claude API
      }
    } catch (error) {
      // Clean up any files we've written before the error
      if (filesToCleanup.length > 0) {
        ipcLog.info(`Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
        await Promise.all(filesToCleanup.map(f => unlink(f).catch(() => {})))
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('storeAttachment error:', message)
      throw new Error(`Failed to store attachment: ${message}`)
    }
  })

  // Get system theme preference (dark = true, light = false)
  ipcMain.handle(IPC_CHANNELS.GET_SYSTEM_THEME, () => {
    return nativeTheme.shouldUseDarkColors
  })

  // Get user's home directory
  ipcMain.handle(IPC_CHANNELS.GET_HOME_DIR, () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  ipcMain.handle(IPC_CHANNELS.IS_DEBUG_MODE, () => {
    return !app.isPackaged
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  ipcMain.handle(IPC_CHANNELS.GET_GIT_BRANCH, (_event, dirPath: string) => {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],  // Suppress stderr output
        timeout: 5000,  // 5 second timeout
      }).trim()
      return branch || null
    } catch {
      // Not a git repo, git not installed, or other error
      return null
    }
  })

  // Git Bash detection and configuration (Windows only)
  ipcMain.handle(IPC_CHANNELS.GITBASH_CHECK, async () => {
    const platform = process.platform as 'win32' | 'darwin' | 'linux'

    // Non-Windows platforms don't need Git Bash
    if (platform !== 'win32') {
      return { found: true, path: null, platform }
    }

    // Check common Git Bash installation paths
    const commonPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    ]

    for (const bashPath of commonPaths) {
      try {
        await stat(bashPath)
        return { found: true, path: bashPath, platform }
      } catch {
        // Path doesn't exist, try next
      }
    }

    // Try to find via 'where' command
    try {
      const result = execSync('where bash', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      const firstPath = result.split('\n')[0]?.trim()
      if (firstPath && firstPath.toLowerCase().includes('git')) {
        return { found: true, path: firstPath, platform }
      }
    } catch {
      // where command failed
    }

    return { found: false, path: null, platform }
  })

  ipcMain.handle(IPC_CHANNELS.GITBASH_BROWSE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      title: 'Select bash.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile'],
      defaultPath: 'C:\\Program Files\\Git\\bin',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.GITBASH_SET_PATH, async (_event, bashPath: string) => {
    try {
      // Verify the path exists
      await stat(bashPath)

      // Verify it's an executable (basic check - ends with .exe on Windows)
      if (!bashPath.toLowerCase().endsWith('.exe')) {
        return { success: false, error: 'Path must be an executable (.exe) file' }
      }

      // TODO: Persist this path to config if needed
      // For now, we just validate it exists
      return { success: true }
    } catch {
      return { success: false, error: 'File does not exist at the specified path' }
    }
  })

  // ============================================================
  // Prerequisites Checking (Bun, Node.js 18+, Git)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.PREREQUISITES_CHECK, async () => {
    const platform = process.platform as 'win32' | 'darwin' | 'linux'
    const whichCmd = platform === 'win32' ? 'where' : 'which'

    // In packaged builds, Bun and Node.js are always bundled with the app.
    // Check the bundled binaries directly rather than the system PATH.
    if (app.isPackaged) {
      const basePath = app.getAppPath()

      const checkBundledBinary = (
        name: 'bun' | 'node' | 'git',
        bundledPath: string,
        versionFlag: string,
      ): import('../shared/types').PrerequisiteStatus => {
        if (!existsSync(bundledPath)) {
          if (name === 'node') {
            return { name, found: false, version: null, path: null, meetsMinimum: false, minimumVersion: 'v18.0.0' }
          }
          return { name, found: false, version: null, path: null }
        }
        try {
          const version = execSync(`"${bundledPath}" ${versionFlag}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
          }).trim()
          if (name === 'node') {
            return { name, found: true, version, path: bundledPath, meetsMinimum: true, minimumVersion: 'v18.0.0' }
          }
          return { name, found: true, version, path: bundledPath }
        } catch {
          if (name === 'node') {
            return { name, found: true, version: 'bundled', path: bundledPath, meetsMinimum: true, minimumVersion: 'v18.0.0' }
          }
          return { name, found: true, version: 'bundled', path: bundledPath }
        }
      }

      const bunBinary = platform === 'win32' ? 'bun.exe' : 'bun'
      const bunBasePath = platform === 'win32' ? process.resourcesPath : basePath
      const bundledBunPath = join(bunBasePath, 'vendor', 'bun', bunBinary)

      const nodeBinary = platform === 'win32' ? 'node.exe' : 'node'
      const nodeBasePath = platform === 'win32' ? process.resourcesPath : basePath
      const bundledNodePath = join(nodeBasePath, 'vendor', 'node', nodeBinary)

      const bunStatus = checkBundledBinary('bun', bundledBunPath, '--version')
      const nodeStatus = checkBundledBinary('node', bundledNodePath, '--version')

      // Git is not bundled — check system PATH. Not required for app to work;
      // the AI agent will guide users to install it when needed.
      let gitStatus: import('../shared/types').PrerequisiteStatus
      try {
        const gitPath = execSync(`${whichCmd} git`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        }).trim().split('\n')[0]
        const gitVersion = execSync('git --version', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        }).trim()
        gitStatus = { name: 'git', found: true, version: gitVersion, path: gitPath }
      } catch {
        gitStatus = { name: 'git', found: false, version: null, path: null }
      }

      const prerequisites = [bunStatus, nodeStatus, gitStatus]

      return {
        platform,
        // In packaged builds, only bun and node (both bundled) are required.
        // Git is optional — missing git does not block the app.
        allSatisfied: bunStatus.found && nodeStatus.found && nodeStatus.meetsMinimum,
        prerequisites,
      }
    }

    // Dev mode: check all tools on system PATH (unchanged behavior)
    const whichEnv: NodeJS.ProcessEnv = process.env

    // On macOS/Linux, get a fresh PATH from a login shell so that
    // tools installed after the app launched are found without restarting.
    let execEnv: NodeJS.ProcessEnv = whichEnv
    if (platform !== 'win32') {
      try {
        const shell = process.env.SHELL || '/bin/bash'
        const freshPath = execSync(`${shell} -lc "echo \\$PATH"`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        }).trim()
        if (freshPath) {
          execEnv = { ...process.env, PATH: freshPath }
        }
      } catch {
        // Fall back to current process PATH
      }
    }

    const checkTool = (
      name: 'bun' | 'node' | 'git',
      command: string,
      versionFlag: string,
    ): import('../shared/types').PrerequisiteStatus => {
      try {
        const toolPath = execSync(`${whichCmd} ${command}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          env: execEnv,
        }).trim().split('\n')[0]

        const version = execSync(`${command} ${versionFlag}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          env: execEnv,
        }).trim()

        if (name === 'node') {
          const major = parseInt(version.replace(/^v/, '').split('.')[0], 10)
          return { name, found: true, version, path: toolPath, meetsMinimum: major >= 18, minimumVersion: 'v18.0.0' }
        }

        return { name, found: true, version, path: toolPath }
      } catch {
        if (name === 'node') {
          return { name, found: false, version: null, path: null, meetsMinimum: false, minimumVersion: 'v18.0.0' }
        }
        return { name, found: false, version: null, path: null }
      }
    }

    const prerequisites = [
      checkTool('bun', 'bun', '--version'),
      checkTool('node', 'node', '--version'),
      checkTool('git', 'git', '--version'),
    ]

    return {
      platform,
      allSatisfied: prerequisites.every(p =>
        p.name === 'node' ? p.found && p.meetsMinimum : p.found
      ),
      prerequisites,
    }
  })

  // ============================================================
  // Cost Tracking
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.COST_GET_STATS, async (_event, workspaceId?: string) => {
    const { getWorkspaces } = await import('@opentomo/shared/config/storage')
    const { listSessions } = await import('@opentomo/shared/sessions')
    type CostSessionStats = import('../shared/types').CostSessionStats
    type CostStats = import('../shared/types').CostStats

    try {
      const allWorkspaces = getWorkspaces()
      const targetWorkspaces = workspaceId
        ? allWorkspaces.filter(w => w.id === workspaceId)
        : allWorkspaces

      const sessions: CostSessionStats[] = []
      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
      }

      for (const workspace of targetWorkspaces) {
        try {
          const sessionList = listSessions(workspace.rootPath)

          for (const meta of sessionList) {
            if (meta.hidden) continue

            const tokenUsage = meta.tokenUsage
            const inputTokens = tokenUsage?.inputTokens ?? 0
            const outputTokens = tokenUsage?.outputTokens ?? 0
            const cacheReadTokens = tokenUsage?.cacheReadTokens ?? 0
            const cacheCreationTokens = tokenUsage?.cacheCreationTokens ?? 0
            const costUsd = tokenUsage?.costUsd ?? 0

            sessions.push({
              sessionId: meta.id,
              sessionName: meta.name,
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheCreationTokens,
              costUsd,
              lastMessageAt: meta.lastMessageAt,
            })

            totals.inputTokens += inputTokens
            totals.outputTokens += outputTokens
            totals.cacheReadTokens += cacheReadTokens
            totals.cacheCreationTokens += cacheCreationTokens
            totals.costUsd += costUsd
          }
        } catch (wsError) {
          ipcLog.warn('[COST_GET_STATS] Failed to read workspace sessions:', workspace.id, wsError)
        }
      }

      // Sort by most recent first
      sessions.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))

      return { sessions, totals } satisfies CostStats
    } catch (error) {
      ipcLog.error('[COST_GET_STATS] Failed to aggregate cost stats:', error)
      throw error
    }
  })

  // Debug logging from renderer → main log file (fire-and-forget, no response)
  ipcMain.on(IPC_CHANNELS.DEBUG_LOG, (_event, ...args: unknown[]) => {
    ipcLog.info('[renderer]', ...args)
  })

  // Filesystem search for @ mention file selection.
  // Parallel BFS walk that skips ignored directories BEFORE entering them,
  // avoiding reading node_modules/etc. contents entirely. Uses withFileTypes
  // to get entry types without separate stat calls.
  ipcMain.handle(IPC_CHANNELS.FS_SEARCH, async (_event, basePath: string, query: string) => {
    ipcLog.info('[FS_SEARCH] called:', basePath, query)
    const MAX_RESULTS = 50

    // Directories to never recurse into
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
      '.next', '.nuxt', '.cache', '__pycache__', 'vendor',
      '.idea', '.vscode', 'coverage', '.nyc_output', '.turbo', 'out',
    ])

    const lowerQuery = query.toLowerCase()
    const results: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }> = []

    try {
      // BFS queue: each entry is a relative path prefix ('' for root)
      let queue = ['']

      while (queue.length > 0 && results.length < MAX_RESULTS) {
        // Process current level: read all directories in parallel
        const nextQueue: string[] = []

        const dirResults = await Promise.all(
          queue.map(async (relDir) => {
            const absDir = relDir ? join(basePath, relDir) : basePath
            try {
              return { relDir, entries: await readdir(absDir, { withFileTypes: true }) }
            } catch {
              // Skip dirs we can't read (permissions, broken symlinks, etc.)
              return { relDir, entries: [] as import('fs').Dirent[] }
            }
          })
        )

        for (const { relDir, entries } of dirResults) {
          if (results.length >= MAX_RESULTS) break

          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break

            const name = entry.name
            // Skip hidden files/dirs and ignored directories
            if (name.startsWith('.') || SKIP_DIRS.has(name)) continue

            const relativePath = relDir ? `${relDir}/${name}` : name
            const isDir = entry.isDirectory()

            // Queue subdirectories for next BFS level
            if (isDir) {
              nextQueue.push(relativePath)
            }

            // Check if name or path matches the query
            const lowerName = name.toLowerCase()
            const lowerRelative = relativePath.toLowerCase()
            if (lowerName.includes(lowerQuery) || lowerRelative.includes(lowerQuery)) {
              results.push({
                name,
                path: join(basePath, relativePath),
                type: isDir ? 'directory' : 'file',
                relativePath,
              })
            }
          }
        }

        queue = nextQueue
      }

      // Sort: directories first, then by name length (shorter = better match)
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.length - b.name.length
      })

      ipcLog.info('[FS_SEARCH] returning', results.length, 'results')
      return results
    } catch (err) {
      ipcLog.error('[FS_SEARCH] error:', err)
      return []
    }
  })

  // Filesystem mutations for Explorer context menu
  ipcMain.handle(IPC_CHANNELS.FS_MKDIR, async (_event, dirPath: string) => {
    const validated = await validateFilePath(dirPath)
    await mkdir(validated, { recursive: true })
  })

  ipcMain.handle(IPC_CHANNELS.FS_RENAME, async (_event, oldPath: string, newPath: string) => {
    const validOld = await validateFilePath(oldPath)
    const validNew = await validateFilePath(newPath)
    await rename(validOld, validNew)
  })

  ipcMain.handle(IPC_CHANNELS.FS_DELETE, async (_event, filePath: string, recursive = false) => {
    const validated = await validateFilePath(filePath)
    if (recursive) {
      await rm(validated, { recursive: true, force: true })
    } else {
      await unlink(validated)
    }
  })

  // Auto-update handlers
  // Manual check from UI - always start download if update is found
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    const { checkForUpdates } = await import('./auto-update')
    return checkForUpdates({ autoDownload: true })
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_INFO, async () => {
    const { getUpdateInfo } = await import('./auto-update')
    return getUpdateInfo()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, async () => {
    const { installUpdate } = await import('./auto-update')
    return installUpdate()
  })

  // Dismiss update for this version (persists across restarts)
  ipcMain.handle(IPC_CHANNELS.UPDATE_DISMISS, async (_event, version: string) => {
    const { setDismissedUpdateVersion } = await import('@opentomo/shared/config')
    setDismissedUpdateVersion(version)
  })

  // Get dismissed version
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_DISMISSED, async () => {
    const { getDismissedUpdateVersion } = await import('@opentomo/shared/config')
    return getDismissedUpdateVersion()
  })

  // Shell operations - open URL in external browser (or handle opentomo:// internally)
  ipcMain.handle(IPC_CHANNELS.OPEN_URL, async (_event, url: string) => {
    ipcLog.info('[OPEN_URL] Received request:', url)
    try {
      // Validate URL format
      const parsed = new URL(url)

      // Handle opentomo:// URLs internally via deep link handler
      // This ensures ?window= params work correctly for "Open in New Window"
      if (parsed.protocol === 'opentomo:') {
        ipcLog.info('[OPEN_URL] Handling as deep link')
        const { handleDeepLink } = await import('./deep-link')
        const result = await handleDeepLink(url, windowManager)
        ipcLog.info('[OPEN_URL] Deep link result:', result)
        return
      }

      // External URLs - open in default browser
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new Error('Only http, https, and mailto URLs are allowed')
      }
      await shell.openExternal(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  // Shell operations - open file in default application
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE, async (_event, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      // openPath opens file with default application (e.g., VS Code for .ts files)
      const result = await shell.openPath(safePath)
      if (result) {
        // openPath returns empty string on success, error message on failure
        throw new Error(result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  // Shell operations - show file in folder (opens Finder/Explorer with file selected)
  ipcMain.handle(IPC_CHANNELS.SHOW_IN_FOLDER, async (_event, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      shell.showItemInFolder(safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })

  // Reveal any absolute path in system file explorer — no home-dir restriction.
  // Safe because showItemInFolder is a read-only UI operation (opens Finder/Explorer).
  // Used by the Files Explorer for Working Directory paths that may be outside home dir.
  ipcMain.handle(IPC_CHANNELS.REVEAL_IN_EXPLORER, async (_event, path: string) => {
    const normalizedPath = normalize(resolve(path))
    if (!isAbsolute(normalizedPath)) {
      throw new Error('Only absolute paths are allowed')
    }
    shell.showItemInFolder(normalizedPath)
  })

  // Menu actions from renderer (for unified OpenTomo menu)
  ipcMain.handle(IPC_CHANNELS.MENU_QUIT, () => {
    app.quit()
  })

  // New Window: create a new window for the current workspace
  ipcMain.handle(IPC_CHANNELS.MENU_NEW_WINDOW, (event) => {
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    if (workspaceId) {
      windowManager.createWindow({ workspaceId })
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_ZOOM_IN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 3.0))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_ZOOM_OUT, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.5))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MENU_ZOOM_RESET, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.setZoomFactor(1.0)
  })

  ipcMain.handle(IPC_CHANNELS.MENU_TOGGLE_DEVTOOLS, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.toggleDevTools()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_UNDO, (event) => {
    event.sender.undo()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_REDO, (event) => {
    event.sender.redo()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_CUT, (event) => {
    event.sender.cut()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_COPY, (event) => {
    event.sender.copy()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_PASTE, (event) => {
    event.sender.paste()
  })

  ipcMain.handle(IPC_CHANNELS.MENU_SELECT_ALL, (event) => {
    event.sender.selectAll()
  })

  // Show logout confirmation dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_LOGOUT_CONFIRMATION, async () => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Log Out'],
      defaultId: 0,
      cancelId: 0,
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      detail: 'All conversations will be deleted. This action cannot be undone.',
    } as Electron.MessageBoxOptions)
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Log Out
    return result.response === 1
  })

  // Show delete session confirmation dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_DELETE_SESSION_CONFIRMATION, async (_event, name: string) => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Conversation',
      message: `Are you sure you want to delete: "${name}"?`,
      detail: 'This action cannot be undone.',
    } as Electron.MessageBoxOptions)
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Delete
    return result.response === 1
  })

  // Logout - clear credentials only, preserve workspaces and config
  ipcMain.handle(IPC_CHANNELS.LOGOUT, async () => {
    try {
      const manager = getCredentialManager()

      // List and delete all stored credentials
      const allCredentials = await manager.list()
      for (const credId of allCredentials) {
        await manager.delete(credId)
      }

      // Clear auth env vars so in-flight API calls fail cleanly
      delete process.env.ANTHROPIC_AUTH_TOKEN
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_BASE_URL

      // NOTE: config.json is intentionally NOT deleted - workspaces, sessions,
      // and preferences are preserved so the user's data remains intact after re-login.

      ipcLog.info('Logout complete - cleared credentials and auth env vars')
    } catch (error) {
      ipcLog.error('Logout error:', error)
      throw error
    }
  })

  // ============================================================
  // Settings - API Setup
  // ============================================================

  // Get current API setup and credential status
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_API_SETUP, async (): Promise<ApiSetupInfo> => {
    const authType = getAuthType()
    const manager = getCredentialManager()

    let hasCredential = false
    let apiKey: string | undefined
    let anthropicBaseUrl: string | undefined
    let customModel: string | undefined

    if (authType === 'api_key') {
      apiKey = await manager.getApiKey() ?? undefined
      anthropicBaseUrl = getAnthropicBaseUrl() ?? undefined
      customModel = getCustomModel() ?? undefined
      // Keyless providers (Ollama) are valid when a custom base URL is configured
      hasCredential = !!apiKey || !!anthropicBaseUrl
    } else if (authType === 'custom_api') {
      // Active provider connection — read model + endpoint set by setActiveConnection
      anthropicBaseUrl = getAnthropicBaseUrl() ?? undefined
      customModel = getCustomModel() ?? undefined
      apiKey = await manager.getApiKey() ?? undefined
      hasCredential = !!apiKey || !!anthropicBaseUrl
    } else if (authType === 'oauth_token') {
      hasCredential = !!(await manager.getClaudeOAuth())
    }

    return {
      authType: authType as AuthType,
      hasCredential,
      apiKey,
      anthropicBaseUrl,
      customModel,
      oauthTierModels: loadStoredConfig()?.oauthTierModels,
    }
  })

  // Update API setup and credential
  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE_API_SETUP, async (_event, authType: AuthType, credential?: string, anthropicBaseUrl?: string | null, customModel?: string | null) => {
    const manager = getCredentialManager()

    // Clear old credentials when switching auth types
    const oldAuthType = getAuthType()
    if (oldAuthType !== authType) {
      if (oldAuthType === 'api_key') {
        await manager.delete({ type: 'anthropic_api_key' })
      } else if (oldAuthType === 'oauth_token') {
        await manager.delete({ type: 'claude_oauth' })
      }
    }

    // Set new auth type
    setAuthType(authType)

    // Update Anthropic base URL (null to clear, undefined to keep unchanged)
    if (anthropicBaseUrl !== undefined) {
      try {
        setAnthropicBaseUrl(anthropicBaseUrl)
        if (anthropicBaseUrl) {
          ipcLog.info('Anthropic base URL updated (HTTPS enforced)')
        } else {
          ipcLog.info('Anthropic base URL cleared')
        }
      } catch (error) {
        ipcLog.error('Failed to set Anthropic base URL:', error)
        throw error
      }
    }

    // Update custom model (null to clear, undefined to keep unchanged)
    if (customModel !== undefined) {
      setCustomModel(customModel)
      if (customModel) {
        ipcLog.info('Custom model set:', customModel)
      } else {
        ipcLog.info('Custom model cleared')
      }
    }

    // Store or clear credential
    if (credential) {
      if (authType === 'api_key') {
        await manager.setApiKey(credential)
      } else if (authType === 'oauth_token') {
        // Save the access token (refresh token and expiry are managed by the OAuth flow)
        await manager.setClaudeOAuth(credential)
        ipcLog.info('Saved Claude OAuth access token')
      }
    } else if (credential === '') {
      // Empty string means user explicitly cleared the credential
      if (authType === 'api_key') {
        await manager.delete({ type: 'anthropic_api_key' })
        ipcLog.info('API key cleared')
      } else if (authType === 'oauth_token') {
        await manager.delete({ type: 'claude_oauth' })
        ipcLog.info('Claude OAuth cleared')
      }
    }

    ipcLog.info(`API setup updated to: ${authType}`)

    // Reinitialize SessionManager auth to pick up new credentials
    try {
      await sessionManager.reinitializeAuth()
      ipcLog.info('Reinitialized auth after billing update')
    } catch (authError) {
      ipcLog.error('Failed to reinitialize auth:', authError)
      // Don't fail the whole operation if auth reinit fails
    }
  })

  // Test API connection (validates API key, base URL, and optionally custom model)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_API_CONNECTION, async (_event, apiKey: string, baseUrl?: string, modelName?: string): Promise<{ success: boolean; error?: string; modelCount?: number }> => {
    return testApiConnectionInternal(apiKey, baseUrl, modelName)
  })

  // Get Claude Subscription (oauth_token) connection status
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CLAUDE_OAUTH_STATUS, async (): Promise<ClaudeOAuthStatus> => {
    const manager = getCredentialManager()
    const authType = getAuthType()
    const creds = await manager.getClaudeOAuthCredentials()
    return {
      isConnected: !!creds,
      isActive: authType === 'oauth_token',
      expiresAt: creds?.expiresAt,
    }
  })

  // Activate Claude Subscription as the current provider
  ipcMain.handle(IPC_CHANNELS.SETTINGS_ACTIVATE_CLAUDE_OAUTH, async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const config = loadStoredConfig()
      if (!config) throw new Error('Failed to load config')
      config.authType = 'oauth_token'
      config.provider = 'anthropic'
      config.activeConnectionId = null
      delete config.anthropicBaseUrl
      delete config.customModel

      // Fetch available models from Anthropic API using the OAuth token
      const oauthCreds = await getCredentialManager().getClaudeOAuthCredentials()
      if (oauthCreds?.accessToken) {
        try {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const client = new Anthropic({ authToken: oauthCreds.accessToken, apiKey: null })
          const result = await client.models.list()
          const models = result.data ?? []
          const findLatest = (keyword: string) => {
            const matches = models.filter((m: { id: string }) => m.id.toLowerCase().includes(keyword))
            return matches.sort((a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id))[0]?.id as string | undefined
          }
          const best = findLatest('opus')
          const balanced = findLatest('sonnet')
          const fast = findLatest('haiku')
          if (best || balanced || fast) {
            config.oauthTierModels = { best, balanced, fast }
            const defaultModel = balanced ?? best ?? fast ?? DEFAULT_MODEL
            if (!config.model || config.model.includes('/')) {
              config.model = defaultModel
            }
          }
        } catch (e) {
          ipcLog.warn('Failed to fetch models for Claude Subscription:', e)
          if (!config.model || config.model.includes('/')) config.model = DEFAULT_MODEL
        }
      } else {
        if (!config.model || config.model.includes('/')) config.model = DEFAULT_MODEL
      }

      saveConfig(config)
      await sessionManager.reinitializeAuth()
      sessionManager.invalidateAllAgents()
      ipcLog.info('Claude Subscription activated as provider')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ipcLog.error('Failed to activate Claude Subscription:', message)
      return { success: false, error: message }
    }
  })

  // Disconnect Claude Subscription and reset auth settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_DISCONNECT_CLAUDE_OAUTH, async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const manager = getCredentialManager()
      await manager.delete({ type: 'claude_oauth' })
      const config = loadStoredConfig()
      if (!config) throw new Error('Failed to load config')
      config.authType = 'api_key'
      config.provider = 'anthropic'
      config.activeConnectionId = null
      delete config.anthropicBaseUrl
      delete config.customModel
      delete config.oauthTierModels
      config.model = DEFAULT_MODEL
      saveConfig(config)
      await sessionManager.reinitializeAuth()
      sessionManager.invalidateAllAgents()
      ipcLog.info('Claude Subscription disconnected, auth settings reset')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ipcLog.error('Failed to disconnect Claude Subscription:', message)
      return { success: false, error: message }
    }
  })

  // ============================================================
  // Settings - Model (Global Default)
  // ============================================================

  // Get global default model
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_MODEL, async (): Promise<string | null> => {
    return getModel()
  })

  // Set global default model
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_MODEL, async (_event, model: string) => {
    setModel(model)
    ipcLog.info(`Global model updated to: ${model}`)
  })

  // Get default chat mode
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_DEFAULT_CHAT_MODE, async () => {
    return getDefaultChatMode()
  })

  // Set default chat mode
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_DEFAULT_CHAT_MODE, async (_event, mode: 'safe' | 'ask' | 'allow-all') => {
    setDefaultChatMode(mode)
  })

  // ============================================================
  // Settings - Model (Session-Specific)
  // ============================================================

  // Get session-specific model
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_MODEL, async (_event, sessionId: string, _workspaceId: string): Promise<string | null> => {
    const session = await sessionManager.getSession(sessionId)
    return session?.model ?? null
  })

  // Set session-specific model
  ipcMain.handle(IPC_CHANNELS.SESSION_SET_MODEL, async (_event, sessionId: string, workspaceId: string, model: string | null) => {
    await sessionManager.updateSessionModel(sessionId, workspaceId, model)
    ipcLog.info(`Session ${sessionId} model updated to: ${model}`)
  })

  // ============================================================
  // Settings - Provider (Global Default)
  // ============================================================

  // Get global default provider
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_PROVIDER, async (): Promise<string | null> => {
    return getProvider()
  })

  // Set global default provider
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_PROVIDER, async (_event, provider: string) => {
    setProvider(provider)
    ipcLog.info(`Global provider updated to: ${provider}`)
  })

  // ============================================================
  // Provider Connections (multi-connection management)
  // ============================================================

  // List all user-created provider connections
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_LIST, async () => {
    const { loadConnections } = await import('@opentomo/shared/config/connections')
    return loadConnections()
  })

  // Add a new provider connection (with its API key)
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_ADD, async (_event, connectionData: {
    name: string
    type: string
    endpoint: string
    models: { best?: string; balanced?: string; fast?: string }
  }, apiKey: string) => {
    const { addProviderConnection, registerConnectionModels } = await import('@opentomo/shared/config/connections')
    const cm = getCredentialManager()

    const connection = addProviderConnection({
      name: connectionData.name,
      type: connectionData.type as import('@opentomo/shared/config/connections').ConnectionType,
      endpoint: connectionData.endpoint,
      models: connectionData.models,
    })

    // Store the API key encrypted by connection ID
    if (apiKey) {
      await cm.setConnectionApiKey(connection.id, apiKey)
    }

    // Register model IDs in config-models.json
    registerConnectionModels(connection)

    ipcLog.info(`Provider connection added: ${connection.name} (${connection.id})`)
    return connection
  })

  // Update an existing provider connection
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_UPDATE, async (_event, connectionId: string, updates: {
    name?: string
    endpoint?: string
    models?: { best?: string; balanced?: string; fast?: string }
  }, apiKey?: string) => {
    const { updateProviderConnection, registerConnectionModels } = await import('@opentomo/shared/config/connections')
    const { getActiveConnectionId, setActiveConnection } = await import('@opentomo/shared/config')
    const cm = getCredentialManager()

    const updated = updateProviderConnection(connectionId, updates)

    // Replace API key only if a new one was provided
    if (apiKey?.trim()) {
      await cm.setConnectionApiKey(connectionId, apiKey.trim())
    }

    // Re-register model IDs (handles idempotent re-add by removing old entries first)
    registerConnectionModels(updated)

    // If this connection is currently active, re-sync legacy fields
    const activeId = getActiveConnectionId()
    if (activeId === connectionId) {
      await setActiveConnection(connectionId)
      // Reinitialize auth so env vars pick up the new API key
      try {
        await sessionManager.reinitializeAuth()
        // Destroy cached agent subprocesses so they restart with the new credentials
        sessionManager.invalidateAllAgents()
      } catch (authError) {
        ipcLog.error('Failed to reinitialize auth after connection update:', authError)
      }
    }

    ipcLog.info(`Provider connection updated: ${updated.name} (${connectionId})`)
    return updated
  })

  // Delete a provider connection
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_DELETE, async (_event, connectionId: string) => {
    const { deleteProviderConnection, unregisterConnectionModels } = await import('@opentomo/shared/config/connections')
    const { getActiveConnectionId, setActiveConnection } = await import('@opentomo/shared/config')
    const cm = getCredentialManager()

    // If deleting the active connection, revert to OpenTomo proxy
    if (getActiveConnectionId() === connectionId) {
      await setActiveConnection(null)
    }

    // Remove credential
    await cm.deleteConnectionApiKey(connectionId)

    // Remove from config-models.json
    unregisterConnectionModels(connectionId)

    const deleted = deleteProviderConnection(connectionId)
    ipcLog.info(`Provider connection deleted: ${connectionId}`)
    return deleted
  })

  // Get the currently active connection ID
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_GET_ACTIVE, async () => {
    const { getActiveConnectionId } = await import('@opentomo/shared/config')
    return getActiveConnectionId()
  })

  // Set (activate) a provider connection
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_SET_ACTIVE, async (_event, connectionId: string | null) => {
    const { setActiveConnection } = await import('@opentomo/shared/config')
    await setActiveConnection(connectionId)
    ipcLog.info(`Active connection set to: ${connectionId ?? 'opentomo (default)'}`)
    // Reinitialize auth so env vars are immediately updated for new sessions
    try {
      await sessionManager.reinitializeAuth()
      // Destroy cached agent subprocesses so they restart with the updated ANTHROPIC_BASE_URL.
      // The SDK subprocess has env vars baked in at creation — existing agents would still
      // route requests to the old provider (e.g. OpenTomo proxy) until recreated.
      sessionManager.invalidateAllAgents()
    } catch (authError) {
      ipcLog.error('Failed to reinitialize auth after connection switch:', authError)
    }
  })

  // Test a stored provider connection using its encrypted API key
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_TEST, async (_event, connectionId: string): Promise<{ success: boolean; error?: string }> => {
    const { findProviderConnection } = await import('@opentomo/shared/config/connections')
    const cm = getCredentialManager()

    const connection = findProviderConnection(connectionId)
    if (!connection) return { success: false, error: 'Connection not found.' }

    const modelId = connection.models.balanced || connection.models.best || connection.models.fast
    if (!modelId) {
      return { success: false, error: 'No model IDs are configured for this connection. Please add at least one model ID in Providers settings.' }
    }

    const apiKey = await cm.getConnectionApiKey(connectionId)
    // Ollama does not require an API key — allow keyless test
    if (!apiKey && connection.type !== 'ollama') {
      return { success: false, error: 'No API key found for this connection. Please re-enter the API key in Providers settings.' }
    }

    ipcLog.info(`Testing provider connection: ${connection.name} (${connectionId})`)
    return testApiConnectionInternal(apiKey || undefined, connection.endpoint, modelId)
  })

  // Retrieve stored API key for a connection (used by edit UI)
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_GET_API_KEY, async (_event, connectionId: string): Promise<string | null> => {
    const cm = getCredentialManager()
    return cm.getConnectionApiKey(connectionId)
  })

  // Open native folder dialog for selecting working directory
  ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Working Directory',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ============================================================
  // Workspace Settings (per-workspace configuration)
  // ============================================================

  // Get workspace settings (model, permission mode, working directory, credential strategy)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_GET, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`Workspace not found: ${workspaceId}`)
      return null
    }

    // Load workspace config
    const { loadWorkspaceConfig } = await import('@opentomo/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)

    return {
      name: config?.name,
      model: config?.defaults?.model,
      permissionMode: config?.defaults?.permissionMode,
      cyclablePermissionModes: config?.defaults?.cyclablePermissionModes,
      thinkingLevel: config?.defaults?.thinkingLevel,
      workingDirectory: config?.defaults?.workingDirectory,
      localMcpEnabled: config?.localMcpServers?.enabled ?? true,
    }
  })

  // Update a workspace setting
  // Valid keys: 'name', 'model', 'enabledSourceSlugs', 'permissionMode', 'cyclablePermissionModes', 'thinkingLevel', 'workingDirectory', 'localMcpEnabled'
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SETTINGS_UPDATE, async (_event, workspaceId: string, key: string, value: unknown) => {
    const workspace = getWorkspaceOrThrow(workspaceId)

    // Validate key is a known workspace setting
    const validKeys = ['name', 'model', 'enabledSourceSlugs', 'permissionMode', 'cyclablePermissionModes', 'thinkingLevel', 'workingDirectory', 'localMcpEnabled']
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid workspace setting key: ${key}. Valid keys: ${validKeys.join(', ')}`)
    }

    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@opentomo/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }

    // Handle 'name' specially - it's a top-level config property, not in defaults
    if (key === 'name') {
      config.name = String(value).trim()
    } else if (key === 'localMcpEnabled') {
      // Store in localMcpServers.enabled (top-level, not in defaults)
      config.localMcpServers = config.localMcpServers || { enabled: true }
      config.localMcpServers.enabled = Boolean(value)
    } else {
      // Update the setting in defaults
      config.defaults = config.defaults || {}
      ;(config.defaults as Record<string, unknown>)[key] = value
    }

    // Save the config
    saveWorkspaceConfig(workspace.rootPath, config)
    ipcLog.info(`Workspace setting updated: ${key} = ${JSON.stringify(value)}`)
  })

  // Get workspace environment variables (.env file)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_ENV_GET, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId)
    const { readWorkspaceEnvFile } = await import('@opentomo/shared/workspaces')
    return readWorkspaceEnvFile(workspace.rootPath)
  })

  // Save workspace environment variables (.env file)
  // Creates the .env file if it does not exist
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_ENV_SAVE, async (_event, workspaceId: string, vars: unknown) => {
    if (!Array.isArray(vars)) throw new Error('vars must be an array')
    const workspace = getWorkspaceOrThrow(workspaceId)
    const { writeWorkspaceEnvFile } = await import('@opentomo/shared/workspaces')
    writeWorkspaceEnvFile(workspace.rootPath, vars as { key: string; value: string }[])
    ipcLog.info(`Workspace env saved: ${(vars as { key: string }[]).length} vars`)
  })

  // ============================================================
  // User Preferences
  // ============================================================

  // Read user preferences file
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_READ, async () => {
    const path = getPreferencesPath()
    if (!existsSync(path)) {
      return { content: '{}', exists: false, path }
    }
    return { content: readFileSync(path, 'utf-8'), exists: true, path }
  })

  // Write user preferences file (validates JSON before saving)
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_WRITE, async (_, content: string) => {
    try {
      JSON.parse(content) // Validate JSON
      const path = getPreferencesPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ============================================================
  // USER.md and SOUL.md
  // ============================================================

  // Read USER.md
  ipcMain.handle(IPC_CHANNELS.USERMD_READ, async () => {
    const path = getUserMdPath()
    const result = readUserMd()
    if (!result) {
      return { content: '', exists: false, path }
    }
    return { content: result.content, exists: true, path: result.path }
  })

  // Write USER.md
  ipcMain.handle(IPC_CHANNELS.USERMD_WRITE, async (_, content: string) => {
    try {
      writeUserMd(content)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ============================================================
  // Session Drafts (persisted input text)
  // ============================================================

  // Get draft text for a session
  ipcMain.handle(IPC_CHANNELS.DRAFTS_GET, async (_event, sessionId: string) => {
    return getSessionDraft(sessionId)
  })

  // Set draft text for a session (pass empty string to clear)
  ipcMain.handle(IPC_CHANNELS.DRAFTS_SET, async (_event, sessionId: string, text: string) => {
    setSessionDraft(sessionId, text)
  })

  // Delete draft for a session
  ipcMain.handle(IPC_CHANNELS.DRAFTS_DELETE, async (_event, sessionId: string) => {
    deleteSessionDraft(sessionId)
  })

  // Get all drafts (for loading on app start)
  ipcMain.handle(IPC_CHANNELS.DRAFTS_GET_ALL, async () => {
    return getAllSessionDrafts()
  })

  // ============================================================
  // Session Info Panel (files, notes, file watching)
  // ============================================================

  // Recursive directory scanner for session files
  // Filters out internal files (session.jsonl) and hidden files (. prefix)
  // Returns only non-empty directories
  async function scanSessionDirectory(dirPath: string, includeHidden = false): Promise<import('../shared/types').SessionFile[]> {
    const { readdir, stat } = await import('fs/promises')
    const entries = await readdir(dirPath, { withFileTypes: true })
    const files: import('../shared/types').SessionFile[] = []

    for (const entry of entries) {
      // Skip internal files; skip hidden files unless includeHidden is set
      if (entry.name === 'session.jsonl') continue
      if (!includeHidden && entry.name.startsWith('.')) continue

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Recursively scan subdirectory
        const children = await scanSessionDirectory(fullPath, includeHidden)
        // Only include non-empty directories
        if (children.length > 0) {
          files.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
            children,
          })
        }
      } else {
        const stats = await stat(fullPath)
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          size: stats.size,
        })
      }
    }

    // Sort: directories first, then alphabetically
    return files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  // Get files in session directory (recursive tree structure)
  ipcMain.handle(IPC_CHANNELS.GET_SESSION_FILES, async (_event, sessionId: string, includeHidden = false) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return []

    try {
      return await scanSessionDirectory(sessionPath, includeHidden)
    } catch (error) {
      ipcLog.error('Failed to get session files:', error)
      return []
    }
  })

  // Session file watcher state - only one session watched at a time
  let sessionFileWatcher: import('fs').FSWatcher | null = null
  let watchedSessionId: string | null = null
  let fileChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // Start watching a session directory for file changes
  ipcMain.handle(IPC_CHANNELS.WATCH_SESSION_FILES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return

    // Close existing watcher if watching a different session
    if (sessionFileWatcher) {
      sessionFileWatcher.close()
      sessionFileWatcher = null
    }
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer)
      fileChangeDebounceTimer = null
    }

    watchedSessionId = sessionId

    try {
      const { watch } = await import('fs')
      sessionFileWatcher = watch(sessionPath, { recursive: true }, (eventType, filename) => {
        // Ignore internal files and hidden files
        if (filename && (filename.includes('session.jsonl') || filename.startsWith('.'))) {
          return
        }

        // Debounce: wait 100ms before notifying to batch rapid changes
        if (fileChangeDebounceTimer) {
          clearTimeout(fileChangeDebounceTimer)
        }
        fileChangeDebounceTimer = setTimeout(() => {
          // Notify all windows that session files changed
          const { BrowserWindow } = require('electron')
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC_CHANNELS.SESSION_FILES_CHANGED, watchedSessionId)
          }
        }, 100)
      })

      ipcLog.info(`Watching session files: ${sessionId}`)
    } catch (error) {
      ipcLog.error('Failed to start session file watcher:', error)
    }
  })

  // Stop watching session files
  ipcMain.handle(IPC_CHANNELS.UNWATCH_SESSION_FILES, async () => {
    if (sessionFileWatcher) {
      sessionFileWatcher.close()
      sessionFileWatcher = null
    }
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer)
      fileChangeDebounceTimer = null
    }
    if (watchedSessionId) {
      ipcLog.info(`Stopped watching session files: ${watchedSessionId}`)
      watchedSessionId = null
    }
  })

  // ============================================================
  // Directory file explorer (for working directory)
  // ============================================================

  // Recursive directory scanner — filters only hidden files (. prefix), no session.jsonl filter
  async function scanDirectory(dirPath: string, includeHidden = false): Promise<import('../shared/types').SessionFile[]> {
    const { readdir, stat } = await import('fs/promises')
    const entries = await readdir(dirPath, { withFileTypes: true })
    const files: import('../shared/types').SessionFile[] = []

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const children = await scanDirectory(fullPath, includeHidden)
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        })
      } else {
        const stats = await stat(fullPath)
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          size: stats.size,
        })
      }
    }

    return files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  ipcMain.handle(IPC_CHANNELS.GET_DIRECTORY_FILES, async (_event, dirPath: string, includeHidden = false) => {
    try {
      return await scanDirectory(dirPath, includeHidden)
    } catch (error) {
      ipcLog.error('Failed to get directory files:', error)
      return []
    }
  })

  // Directory file watcher state - only one directory watched at a time
  let directoryFileWatcher: import('fs').FSWatcher | null = null
  let watchedDirectoryPath: string | null = null
  let dirChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null

  ipcMain.handle(IPC_CHANNELS.WATCH_DIRECTORY_FILES, async (_event, dirPath: string) => {
    if (directoryFileWatcher) {
      directoryFileWatcher.close()
      directoryFileWatcher = null
    }
    if (dirChangeDebounceTimer) {
      clearTimeout(dirChangeDebounceTimer)
      dirChangeDebounceTimer = null
    }

    watchedDirectoryPath = dirPath

    try {
      const { watch } = await import('fs')
      directoryFileWatcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (filename && filename.startsWith('.')) return

        if (dirChangeDebounceTimer) clearTimeout(dirChangeDebounceTimer)
        dirChangeDebounceTimer = setTimeout(() => {
          const { BrowserWindow } = require('electron')
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC_CHANNELS.DIRECTORY_FILES_CHANGED, watchedDirectoryPath)
          }
        }, 200)
      })

      ipcLog.info(`Watching directory: ${dirPath}`)
    } catch (error) {
      ipcLog.error('Failed to start directory file watcher:', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.UNWATCH_DIRECTORY_FILES, async () => {
    if (directoryFileWatcher) {
      directoryFileWatcher.close()
      directoryFileWatcher = null
    }
    if (dirChangeDebounceTimer) {
      clearTimeout(dirChangeDebounceTimer)
      dirChangeDebounceTimer = null
    }
    if (watchedDirectoryPath) {
      ipcLog.info(`Stopped watching directory: ${watchedDirectoryPath}`)
      watchedDirectoryPath = null
    }
  })

  // Get session notes (reads notes.md from session directory)
  ipcMain.handle(IPC_CHANNELS.GET_SESSION_NOTES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return ''

    try {
      const notesPath = join(sessionPath, 'notes.md')
      const content = await readFile(notesPath, 'utf-8')
      return content
    } catch {
      // File doesn't exist yet - return empty string
      return ''
    }
  })

  // Set session notes (writes to notes.md in session directory)
  ipcMain.handle(IPC_CHANNELS.SET_SESSION_NOTES, async (_event, sessionId: string, content: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    try {
      const notesPath = join(sessionPath, 'notes.md')
      await writeFile(notesPath, content, 'utf-8')
    } catch (error) {
      ipcLog.error('Failed to save session notes:', error)
      throw error
    }
  })

  // Preview windows removed - now using in-app overlays (see ChatDisplay.tsx)

  // Get permissions config for a workspace (raw format for UI display)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_PERMISSIONS, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    // Load raw JSON file (not normalized) for UI display
    const { existsSync, readFileSync } = await import('fs')
    const { getWorkspacePermissionsPath } = await import('@opentomo/shared/agent')
    const path = getWorkspacePermissionsPath(workspace.rootPath)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      ipcLog.error('Error reading workspace permissions config:', error)
      return null
    }
  })

  // Get default permissions from ~/.opentomo/permissions/default.json
  // Returns raw JSON for UI display (patterns with comments), plus the file path
  ipcMain.handle(IPC_CHANNELS.DEFAULT_PERMISSIONS_GET, async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { getAppPermissionsDir } = await import('@opentomo/shared/agent')
    const { join } = await import('path')

    const defaultPath = join(getAppPermissionsDir(), 'default.json')
    if (!existsSync(defaultPath)) return { config: null, path: defaultPath }

    try {
      const content = readFileSync(defaultPath, 'utf-8')
      return { config: JSON.parse(content), path: defaultPath }
    } catch (error) {
      ipcLog.error('Error reading default permissions config:', error)
      return { config: null, path: defaultPath }
    }
  })


  // ============================================================
  // Session Content Search
  // ============================================================

  // Search session content using ripgrep
  ipcMain.handle(IPC_CHANNELS.SEARCH_SESSIONS, async (_event, workspaceId: string, query: string, searchId?: string) => {
    const id = searchId || Date.now().toString(36)
    searchLog.info('ipc:request', { searchId: id, query })

    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.warn('SEARCH_SESSIONS: Workspace not found:', workspaceId)
      return []
    }

    const { searchSessions } = await import('./search')
    const { getWorkspaceSessionsPath } = await import('@opentomo/shared/workspaces')

    const sessionsDir = getWorkspaceSessionsPath(workspace.rootPath)
    ipcLog.debug(`SEARCH_SESSIONS: Searching "${query}" in ${sessionsDir}`)

    const results = await searchSessions(query, sessionsDir, {
      timeout: 5000,
      maxMatchesPerSession: 3,
      maxSessions: 50,
      searchId: id,
    })

    // Filter out hidden sessions (e.g., mini edit sessions)
    const allSessions = await sessionManager.getSessions()
    const hiddenSessionIds = new Set(
      allSessions.filter(s => s.hidden).map(s => s.id)
    )
    const filteredResults = results.filter(r => !hiddenSessionIds.has(r.sessionId))

    searchLog.info('ipc:response', { searchId: id, resultCount: filteredResults.length, totalFound: results.length })
    return filteredResults
  })

  // ============================================================
  // Skills (Workspace-scoped)
  // ============================================================

  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET, async (_event, workspaceId: string, workingDirectory?: string) => {
    ipcLog.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { loadAllSkills } = await import('@opentomo/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, workingDirectory)
    ipcLog.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET_FILES, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { join } = await import('path')
    const { readdirSync, statSync } = await import('fs')
    const { getWorkspaceSkillsPath } = await import('@opentomo/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

    interface SkillFile {
      name: string
      type: 'file' | 'directory'
      size?: number
      children?: SkillFile[]
    }

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        ipcLog.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Delete a skill from a workspace
  ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@opentomo/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    ipcLog.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  ipcMain.handle(IPC_CHANNELS.SKILLS_OPEN_EDITOR, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { join } = await import('path')
    const { shell } = await import('electron')
    const { getWorkspaceSkillsPath } = await import('@opentomo/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await shell.openPath(skillFile)
  })

  // Open skill folder in Finder/Explorer
  ipcMain.handle(IPC_CHANNELS.SKILLS_OPEN_FINDER, async (_event, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { join } = await import('path')
    const { shell } = await import('electron')
    const { getWorkspaceSkillsPath } = await import('@opentomo/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await shell.showItemInFolder(skillDir)
  })

  // Get skills catalog: all skills (builtin + custom) with disabled state per workspace
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET_CATALOG, async (_event, workspaceId: string) => {
    ipcLog.info(`SKILLS_GET_CATALOG: Loading catalog for workspace: ${workspaceId}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_GET_CATALOG: Workspace not found: ${workspaceId}`)
      return { skills: [], disabledSlugs: [] }
    }
    const { loadAllSkills } = await import('@opentomo/shared/skills')
    const { getWorkspaceDisabledCustomSkills } = await import('@opentomo/shared/workspaces')
    const skills = loadAllSkills(workspace.rootPath)
    const disabledSlugs = getWorkspaceDisabledCustomSkills(workspace.rootPath)
    ipcLog.info(`SKILLS_GET_CATALOG: Loaded ${skills.length} skills, ${disabledSlugs.length} disabled`)
    return { skills, disabledSlugs }
  })

  // Toggle a custom skill's enabled/disabled state for a workspace
  ipcMain.handle(IPC_CHANNELS.SKILLS_TOGGLE_ENABLED, async (_event, workspaceId: string, skillSlug: string, enabled: boolean) => {
    ipcLog.info(`SKILLS_TOGGLE_ENABLED: workspace=${workspaceId} slug=${skillSlug} enabled=${enabled}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_TOGGLE_ENABLED: Workspace not found: ${workspaceId}`)
      return
    }
    const { getWorkspaceDisabledCustomSkills, setWorkspaceDisabledCustomSkills } = await import('@opentomo/shared/workspaces')
    const current = getWorkspaceDisabledCustomSkills(workspace.rootPath)
    let updated: string[]
    if (enabled) {
      updated = current.filter(s => s !== skillSlug)
    } else {
      updated = current.includes(skillSlug) ? current : [...current, skillSlug]
    }
    setWorkspaceDisabledCustomSkills(workspace.rootPath, updated)
    ipcLog.info(`SKILLS_TOGGLE_ENABLED: Updated disabled slugs: [${updated.join(', ')}]`)
    // Notify renderer so the @mention list filters immediately
    _event.sender.send(IPC_CHANNELS.SKILLS_DISABLED_CHANGED, updated)
  })

  // Open the workspace skills directory in Finder/Explorer
  ipcMain.handle(IPC_CHANNELS.SKILLS_OPEN_SKILLS_DIR, async (_event, workspaceId: string) => {
    ipcLog.info(`SKILLS_OPEN_SKILLS_DIR: workspace=${workspaceId}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`SKILLS_OPEN_SKILLS_DIR: Workspace not found: ${workspaceId}`)
      return
    }
    const { getWorkspaceSkillsPath } = await import('@opentomo/shared/workspaces')
    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    await shell.openPath(skillsDir)
    ipcLog.info(`SKILLS_OPEN_SKILLS_DIR: Opened ${skillsDir}`)
  })

  // Open native folder picker for SKILL import (returns selected folder path)
  ipcMain.handle(IPC_CHANNELS.SKILLS_IMPORT_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select SKILL Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return { folderPath: result.filePaths[0] }
  })

  // ============================================================
  // Commands (Workspace-scoped)
  // ============================================================

  // Get all commands for a workspace
  ipcMain.handle(IPC_CHANNELS.COMMANDS_GET, async (_event, workspaceId: string) => {
    ipcLog.info(`COMMANDS_GET: Loading commands for workspace: ${workspaceId}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.error(`COMMANDS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { loadAllCommands } = await import('@opentomo/shared/commands')
    const commands = loadAllCommands(workspace.rootPath)
    ipcLog.info(`COMMANDS_GET: Loaded ${commands.length} commands from ${workspace.rootPath}`)
    return commands
  })

  // Save (create or update) a command in a workspace
  ipcMain.handle(IPC_CHANNELS.COMMANDS_SAVE, async (_event, workspaceId: string, slug: string, name: string, description: string, content: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveCommand } = await import('@opentomo/shared/commands')
    const command = saveCommand(workspace.rootPath, slug, { name, description }, content)
    ipcLog.info(`Saved command: ${slug}`)
    return command
  })

  // Delete a command from a workspace
  ipcMain.handle(IPC_CHANNELS.COMMANDS_DELETE, async (_event, workspaceId: string, commandSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteCommand } = await import('@opentomo/shared/commands')
    deleteCommand(workspace.rootPath, commandSlug)
    ipcLog.info(`Deleted command: ${commandSlug}`)
  })

  // Open command .md file in editor
  ipcMain.handle(IPC_CHANNELS.COMMANDS_OPEN_EDITOR, async (_event, workspaceId: string, commandSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { join } = await import('path')
    const { shell } = await import('electron')
    const { getWorkspaceCommandsPath } = await import('@opentomo/shared/workspaces')

    const commandsDir = getWorkspaceCommandsPath(workspace.rootPath)
    const commandFile = join(commandsDir, `${commandSlug}.md`)
    await shell.openPath(commandFile)
  })

  // Open command file in Finder/Explorer
  ipcMain.handle(IPC_CHANNELS.COMMANDS_OPEN_FINDER, async (_event, workspaceId: string, commandSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { join } = await import('path')
    const { shell } = await import('electron')
    const { getWorkspaceCommandsPath } = await import('@opentomo/shared/workspaces')

    const commandsDir = getWorkspaceCommandsPath(workspace.rootPath)
    const commandFile = join(commandsDir, `${commandSlug}.md`)
    await shell.showItemInFolder(commandFile)
  })

  // ============================================================
  // Project Management (Workspace-scoped)
  // ============================================================

  // List all projects for a workspace
  ipcMain.handle(IPC_CHANNELS.PROJECTS_LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { ensureUncategorizedProject, ensureArchivedProject } = await import('@opentomo/shared/projects/crud')

    // Ensure default "Uncategorized" project exists (backwards compat for existing workspaces)
    // If newly created, migrate all null-projectId sessions to it
    const { isNew } = ensureUncategorizedProject(workspace.rootPath)
    if (isNew) {
      sessionManager.migrateNullProjectsToUncategorized(workspace.id, workspace.rootPath)
    }

    // Ensure default "Archived" project exists (backwards compat for existing workspaces)
    ensureArchivedProject(workspace.rootPath)

    const { listProjects } = await import('@opentomo/shared/projects/storage')
    return listProjects(workspace.rootPath)
  })

  // Create a new project in a workspace
  ipcMain.handle(IPC_CHANNELS.PROJECTS_CREATE, async (_event, workspaceId: string, input: import('@opentomo/shared/projects').CreateProjectInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createProject } = await import('@opentomo/shared/projects/crud')
    const project = createProject(workspace.rootPath, input)
    windowManager.broadcastToAll(IPC_CHANNELS.PROJECTS_CHANGED, workspaceId)
    return project
  })

  // Update a project (name, color, icon)
  ipcMain.handle(IPC_CHANNELS.PROJECTS_UPDATE, async (_event, workspaceId: string, projectId: string, input: import('@opentomo/shared/projects').UpdateProjectInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateProject } = await import('@opentomo/shared/projects/crud')
    updateProject(workspace.rootPath, projectId, input)
    windowManager.broadcastToAll(IPC_CHANNELS.PROJECTS_CHANGED, workspaceId)
  })

  // Delete a project (strips projectId from all sessions)
  ipcMain.handle(IPC_CHANNELS.PROJECTS_DELETE, async (_event, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteProject } = await import('@opentomo/shared/projects/crud')
    const result = deleteProject(workspace.rootPath, projectId)

    // Also update in-memory sessions to clear their projectId
    sessionManager.clearProjectFromSessions(projectId)

    windowManager.broadcastToAll(IPC_CHANNELS.PROJECTS_CHANGED, workspaceId)
    return result
  })

  // Reorder projects (drag-and-drop)
  ipcMain.handle(IPC_CHANNELS.PROJECTS_REORDER, async (_event, workspaceId: string, orderedIds: string[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderProjects } = await import('@opentomo/shared/projects/crud')
    reorderProjects(workspace.rootPath, orderedIds)
    windowManager.broadcastToAll(IPC_CHANNELS.PROJECTS_CHANGED, workspaceId)
  })

  // Smart Categorize: AI-powered batch project assignment for uncategorized sessions
  ipcMain.handle(IPC_CHANNELS.SMART_CATEGORIZE, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    // 1. List uncategorized sessions (no name-length filter yet — titles will be generated below)
    // Include both null-projectId sessions and sessions in the 'uncategorized' project
    const { listSessions } = await import('@opentomo/shared/sessions')
    const allSessions = listSessions(workspace.rootPath)
    const uncategorized = allSessions.filter(
      s => (!s.projectId || s.projectId === 'uncategorized') && !s.hidden
    )
    if (uncategorized.length === 0) return { categorized: 0, newProjectsCreated: 0 }

    // 2. Generate AI titles for all uncategorized sessions before classifying.
    // Sessions may only have a raw initial title (first 50 chars of first message).
    // Generating clean 2-5 word titles first improves categorization accuracy.
    const { generateSessionTitle } = await import('@opentomo/shared/utils')
    const { readSessionJsonl, getSessionFilePath } = await import('@opentomo/shared/sessions')
    const TITLE_CONCURRENCY = 3
    for (let i = 0; i < uncategorized.length; i += TITLE_CONCURRENCY) {
      const batch = uncategorized.slice(i, i + TITLE_CONCURRENCY)
      await Promise.allSettled(batch.map(async (session) => {
        try {
          const sessionFile = getSessionFilePath(workspace.rootPath, session.id)
          const stored = readSessionJsonl(sessionFile)
          if (!stored) return
          // StoredMessage uses .type (not .role) to identify user messages
          const firstUserMsg = stored.messages.find(m => m.type === 'user')
          if (!firstUserMsg) return
          const title = await generateSessionTitle(firstUserMsg.content)
          if (title) {
            session.name = title  // update in-place so categorization uses new title
            sessionManager.updateSessionTitle(session.id, title, workspace.id, workspace.rootPath)
          }
        } catch { /* individual title generation failure is non-fatal */ }
      }))
    }

    // 3. Filter to sessions with meaningful titles (after generation attempt)
    const sessionsToProcess = uncategorized.filter(s => s.name && s.name.trim().length > 2)
    if (sessionsToProcess.length === 0) return { categorized: 0, newProjectsCreated: 0 }

    // 4. Ensure Archived exists, get current projects
    const { ensureArchivedProject, createProject } = await import('@opentomo/shared/projects/crud')
    ensureArchivedProject(workspace.rootPath)
    const { listProjects } = await import('@opentomo/shared/projects/storage')
    const existingProjects = listProjects(workspace.rootPath)

    // 5. AI classification
    const { analyzeUncategorizedSessions } = await import('@opentomo/shared/utils')
    const sessionsInput = sessionsToProcess.map(s => ({ id: s.id, name: s.name! }))
    const assignments = await analyzeUncategorizedSessions(sessionsInput, existingProjects)
    if (assignments.length === 0) return { categorized: 0, newProjectsCreated: 0 }

    // 6. Create new projects, build projectName→id map
    const existingNameMap = new Map(existingProjects.map(p => [p.name.toLowerCase(), p]))
    const projectNameToId = new Map(existingProjects.map(p => [p.name.toLowerCase(), p.id]))
    let newProjectsCreated = 0
    for (const name of [...new Set(assignments.map(a => a.projectName))]) {
      if (!existingNameMap.has(name.toLowerCase())) {
        const created = createProject(workspace.rootPath, { name })
        projectNameToId.set(name.toLowerCase(), created.id)
        newProjectsCreated++
      }
    }

    // 7. Batch-assign sessions to projects (assignments index maps into sessionsToProcess)
    const batchAssignments = assignments
      .map(a => ({ sessionId: sessionsToProcess[a.index].id, projectId: projectNameToId.get(a.projectName.toLowerCase())! }))
      .filter(a => a.projectId != null)
    sessionManager.batchSetSessionProjects(batchAssignments, workspace.id, workspace.rootPath)

    // 8. Broadcast projects changed so renderer refreshes project list
    windowManager.broadcastToAll(IPC_CHANNELS.PROJECTS_CHANGED, workspaceId)
    return { categorized: batchAssignments.length, newProjectsCreated }
  })

  // List views for a workspace (dynamic expression-based filters stored in views.json)
  ipcMain.handle(IPC_CHANNELS.VIEWS_LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listViews } = await import('@opentomo/shared/views/storage')
    return listViews(workspace.rootPath)
  })

  // Save views (replaces full array)
  ipcMain.handle(IPC_CHANNELS.VIEWS_SAVE, async (_event, workspaceId: string, views: import('@opentomo/shared/views').ViewConfig[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveViews } = await import('@opentomo/shared/views/storage')
    saveViews(workspace.rootPath, views)
  })

  // Generic workspace image loading (for source icons, status icons, etc.)
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_READ_IMAGE, async (_event, workspaceId: string, relativePath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { readFileSync, existsSync } = await import('fs')
    const { join, normalize } = await import('path')

    // Security: validate path
    // - Must not contain .. (path traversal)
    // - Must be a valid image extension
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    if (!existsSync(absolutePath)) {
      return null  // Missing optional files - silent fallback to default icons
    }

    // Read file as buffer
    const buffer = readFileSync(absolutePath)

    // If SVG, return as UTF-8 string (caller will use as innerHTML)
    if (ext === '.svg') {
      return buffer.toString('utf-8')
    }

    // For binary images, return as data URL
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.gif': 'image/gif',
    }
    const mimeType = mimeTypes[ext] || 'image/png'
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  })

  // Generic workspace image writing (for workspace icon, etc.)
  // Resizes images to max 256x256 to keep file sizes small
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_WRITE_IMAGE, async (_event, workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { writeFileSync, existsSync, unlinkSync, readdirSync } = await import('fs')
    const { join, normalize, basename } = await import('path')

    // Security: validate path
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    // If this is an icon file (icon.*), delete any existing icon files with different extensions
    const fileName = basename(relativePath)
    if (fileName.startsWith('icon.')) {
      const files = readdirSync(workspace.rootPath)
      for (const file of files) {
        if (file.startsWith('icon.') && file !== fileName) {
          const oldPath = join(workspace.rootPath, file)
          try {
            unlinkSync(oldPath)
          } catch {
            // Ignore errors deleting old icon
          }
        }
      }
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(base64, 'base64')

    // For SVGs, just write directly (no resizing needed)
    if (mimeType === 'image/svg+xml' || ext === '.svg') {
      writeFileSync(absolutePath, buffer)
      return
    }

    // For raster images, resize to max 256x256 using nativeImage
    const image = nativeImage.createFromBuffer(buffer)
    const size = image.getSize()

    // Only resize if larger than 256px
    if (size.width > 256 || size.height > 256) {
      const ratio = Math.min(256 / size.width, 256 / size.height)
      const newWidth = Math.round(size.width * ratio)
      const newHeight = Math.round(size.height * ratio)
      const resized = image.resize({ width: newWidth, height: newHeight, quality: 'best' })

      // Write as PNG for consistency
      writeFileSync(absolutePath, resized.toPNG())
    } else {
      // Small enough, write as-is
      writeFileSync(absolutePath, buffer)
    }
  })

  // Register onboarding handlers
  registerOnboardingHandlers(sessionManager)

  // ============================================================
  // Theme (app-level only)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.THEME_GET_APP, async () => {
    const { loadAppTheme } = await import('@opentomo/shared/config/storage')
    return loadAppTheme()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SAVE_APP, async (_event, colors: Record<string, unknown>) => {
    const { saveAppTheme } = await import('@opentomo/shared/config/storage')
    saveAppTheme(colors as Parameters<typeof saveAppTheme>[0])
  })

  ipcMain.handle(IPC_CHANNELS.THEME_CREATE_PRESET, async (_event, name: string, colors: Record<string, unknown>) => {
    const { savePresetTheme } = await import('@opentomo/shared/config/storage')
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36)
    const themeFile = { ...colors, name } // ensure requested name wins over base theme name
    savePresetTheme(id, themeFile as Parameters<typeof savePresetTheme>[1])
    return id
  })

  // Preset themes (app-level)
  ipcMain.handle(IPC_CHANNELS.THEME_GET_PRESETS, async () => {
    const { loadPresetThemes } = await import('@opentomo/shared/config/storage')
    return loadPresetThemes()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_LOAD_PRESET, async (_event, themeId: string) => {
    const { loadPresetTheme } = await import('@opentomo/shared/config/storage')
    return loadPresetTheme(themeId)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET_COLOR_THEME, async () => {
    const { getColorTheme } = await import('@opentomo/shared/config/storage')
    return getColorTheme()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SET_COLOR_THEME, async (_event, themeId: string) => {
    const { setColorTheme } = await import('@opentomo/shared/config/storage')
    setColorTheme(themeId)
  })

  // Broadcast theme preferences to all other windows (for cross-window sync)
  ipcMain.handle(IPC_CHANNELS.THEME_BROADCAST_PREFERENCES, async (event, preferences: { mode: string; colorTheme: string; font: string }) => {
    const senderId = event.sender.id
    // Broadcast to all windows except the sender
    for (const managed of windowManager.getAllWindows()) {
      if (!managed.window.isDestroyed() &&
          !managed.window.webContents.isDestroyed() &&
          managed.window.webContents.mainFrame &&
          managed.window.webContents.id !== senderId) {
        managed.window.webContents.send(IPC_CHANNELS.THEME_PREFERENCES_CHANGED, preferences)
      }
    }
  })

  // Workspace-level theme overrides
  ipcMain.handle(IPC_CHANNELS.THEME_GET_WORKSPACE_COLOR_THEME, async (_event, workspaceId: string) => {
    const { getWorkspaces } = await import('@opentomo/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@opentomo/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return null
    return getWorkspaceColorTheme(workspace.rootPath) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SET_WORKSPACE_COLOR_THEME, async (_event, workspaceId: string, themeId: string | null) => {
    const { getWorkspaces } = await import('@opentomo/shared/config/storage')
    const { setWorkspaceColorTheme } = await import('@opentomo/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return
    setWorkspaceColorTheme(workspace.rootPath, themeId ?? undefined)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET_ALL_WORKSPACE_THEMES, async () => {
    const { getWorkspaces } = await import('@opentomo/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@opentomo/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const themes: Record<string, string | undefined> = {}
    for (const ws of workspaces) {
      themes[ws.id] = getWorkspaceColorTheme(ws.rootPath)
    }
    return themes
  })

  // Broadcast workspace theme change to all other windows (for cross-window sync)
  ipcMain.handle(IPC_CHANNELS.THEME_BROADCAST_WORKSPACE_THEME, async (event, workspaceId: string, themeId: string | null) => {
    const senderId = event.sender.id
    // Broadcast to all windows except the sender
    for (const managed of windowManager.getAllWindows()) {
      if (!managed.window.isDestroyed() &&
          !managed.window.webContents.isDestroyed() &&
          managed.window.webContents.mainFrame &&
          managed.window.webContents.id !== senderId) {
        managed.window.webContents.send(IPC_CHANNELS.THEME_WORKSPACE_THEME_CHANGED, { workspaceId, themeId })
      }
    }
  })

  // Tool icon mappings — loads tool-icons.json and resolves each entry's icon to a data URL
  // for display in the Appearance settings page
  ipcMain.handle(IPC_CHANNELS.TOOL_ICONS_GET_MAPPINGS, async () => {
    const { getToolIconsDir } = await import('@opentomo/shared/config/storage')
    const { loadToolIconConfig } = await import('@opentomo/shared/utils/cli-icon-resolver')
    const { encodeIconToDataUrl } = await import('@opentomo/shared/utils/icon-encoder')
    const { join } = await import('path')

    const toolIconsDir = getToolIconsDir()
    const config = loadToolIconConfig(toolIconsDir)
    if (!config) return []

    return config.tools
      .map(tool => {
        const iconPath = join(toolIconsDir, tool.icon)
        const iconDataUrl = encodeIconToDataUrl(iconPath)
        if (!iconDataUrl) return null
        return {
          id: tool.id,
          displayName: tool.displayName,
          iconDataUrl,
          commands: tool.commands,
        }
      })
      .filter(Boolean)
  })

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  ipcMain.handle(IPC_CHANNELS.LOGO_GET_URL, async (_event, serviceUrl: string, provider?: string) => {
    const { getLogoUrl } = await import('@opentomo/shared/utils/logo')
    const result = getLogoUrl(serviceUrl, provider)
    console.log(`[logo] getLogoUrl("${serviceUrl}", "${provider}") => "${result}"`)
    return result
  })

  // ============================================================
  // Notifications and Badge
  // ============================================================

  // Show a notification
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SHOW, async (_event, title: string, body: string, workspaceId: string, sessionId: string) => {
    const { showNotification } = await import('./notifications')
    showNotification(title, body, workspaceId, sessionId)
  })

  // Get notifications enabled setting
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_GET_ENABLED, async () => {
    const { getNotificationsEnabled } = await import('@opentomo/shared/config/storage')
    return getNotificationsEnabled()
  })

  // Set notifications enabled setting (also triggers permission request if enabling)
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SET_ENABLED, async (_event, enabled: boolean) => {
    const { setNotificationsEnabled } = await import('@opentomo/shared/config/storage')
    setNotificationsEnabled(enabled)

    // If enabling, trigger a notification to request macOS permission
    if (enabled) {
      const { showNotification } = await import('./notifications')
      showNotification('Notifications enabled', 'You will be notified when tasks complete.', '', '')
    }
  })

  // Get auto-capitalisation setting
  ipcMain.handle(IPC_CHANNELS.INPUT_GET_AUTO_CAPITALISATION, async () => {
    const { getAutoCapitalisation } = await import('@opentomo/shared/config/storage')
    return getAutoCapitalisation()
  })

  // Set auto-capitalisation setting
  ipcMain.handle(IPC_CHANNELS.INPUT_SET_AUTO_CAPITALISATION, async (_event, enabled: boolean) => {
    const { setAutoCapitalisation } = await import('@opentomo/shared/config/storage')
    setAutoCapitalisation(enabled)
  })

  // Get send message key setting
  ipcMain.handle(IPC_CHANNELS.INPUT_GET_SEND_MESSAGE_KEY, async () => {
    const { getSendMessageKey } = await import('@opentomo/shared/config/storage')
    return getSendMessageKey()
  })

  // Set send message key setting
  ipcMain.handle(IPC_CHANNELS.INPUT_SET_SEND_MESSAGE_KEY, async (_event, key: 'enter' | 'cmd-enter') => {
    const { setSendMessageKey } = await import('@opentomo/shared/config/storage')
    setSendMessageKey(key)
  })

  // Get spell check setting
  ipcMain.handle(IPC_CHANNELS.INPUT_GET_SPELL_CHECK, async () => {
    const { getSpellCheck } = await import('@opentomo/shared/config/storage')
    return getSpellCheck()
  })

  // Set spell check setting
  ipcMain.handle(IPC_CHANNELS.INPUT_SET_SPELL_CHECK, async (_event, enabled: boolean) => {
    const { setSpellCheck } = await import('@opentomo/shared/config/storage')
    setSpellCheck(enabled)
  })

  // Update app badge count
  ipcMain.handle(IPC_CHANNELS.BADGE_UPDATE, async (_event, count: number) => {
    const { updateBadgeCount } = await import('./notifications')
    updateBadgeCount(count)
  })

  // Clear app badge
  ipcMain.handle(IPC_CHANNELS.BADGE_CLEAR, async () => {
    const { clearBadgeCount } = await import('./notifications')
    clearBadgeCount()
  })

  // Set dock icon with badge (canvas-rendered badge image from renderer)
  ipcMain.handle(IPC_CHANNELS.BADGE_SET_ICON, async (_event, dataUrl: string) => {
    const { setDockIconWithBadge } = await import('./notifications')
    setDockIconWithBadge(dataUrl)
  })

  // Get window focus state
  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_FOCUS_STATE, () => {
    const { isAnyWindowFocused } = require('./notifications')
    return isAnyWindowFocused()
  })

  // Note: Permission mode cycling settings (cyclablePermissionModes) are now workspace-level
  // and managed via WORKSPACE_SETTINGS_GET/UPDATE channels

  // Register terminal (PTY) handlers
  registerTerminalHandlers()

}
