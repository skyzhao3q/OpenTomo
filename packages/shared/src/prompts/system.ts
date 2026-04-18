import { getAgentName, DEFAULT_AGENT_NAME } from './soul.ts';
import { WIDGET_README } from '../widget/widget-guidelines.ts';
import { formatUserContextForPrompt } from './user-context.ts';
import { loadSoulForPrompt } from './soul.ts';
import { getWorkspaceMemoryDir, getGlobalMemoryDir, getDailyLogPath, formatDate } from '../memory/storage.ts';
import { debug } from '../utils/debug.ts';
import { perf } from '../utils/perf.ts';
import { readdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, relative } from 'path';
import { DOC_REFS, APP_ROOT } from '../docs/index.ts';
import { PERMISSION_MODE_CONFIG } from '../agent/mode-types.ts';
import { APP_VERSION } from '../version/index.ts';
import { glob } from 'glob';
import os from 'os';
import { loadWorkspaceConfig, loadWorkspaceAgentInstructions } from '../workspaces/storage.ts';

/** Maximum size of CLAUDE.md file to include (10KB) */
const MAX_CONTEXT_FILE_SIZE = 10 * 1024;

/** Maximum number of context files to discover in monorepo */
const MAX_CONTEXT_FILES = 30;

/** Cache for globSync results (key: directory, value: { files, timestamp }) */
const globResultCache = new Map<string, { files: string[]; timestamp: number }>();
/** TTL for glob cache in milliseconds (30 seconds) */
const GLOB_CACHE_TTL_MS = 30_000;

/**
 * Directories to exclude when searching for context files.
 * These are common build output, dependency, and cache directories.
 */
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.cache',
  '.turbo',
  'out',
  '.output',
];

/**
 * Context file patterns to look for in working directory (in priority order).
 * Matching is case-insensitive to support AGENTS.md, Agents.md, agents.md, etc.
 */
const CONTEXT_FILE_PATTERNS = ['agents.md', 'claude.md'];

/**
 * Find a file in directory matching the pattern case-insensitively.
 * Returns the actual filename if found, null otherwise.
 */
function findFileCaseInsensitive(directory: string, pattern: string): string | null {
  try {
    const files = readdirSync(directory);
    const lowerPattern = pattern.toLowerCase();
    return files.find((f) => f.toLowerCase() === lowerPattern) ?? null;
  } catch {
    return null;
  }
}

/**
 * Find a project context file (AGENTS.md or CLAUDE.md) in the directory.
 * Just checks if file exists, doesn't read content.
 * Returns the actual filename if found, null otherwise.
 */
export function findProjectContextFile(directory: string): string | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (actualFilename) {
      debug(`[findProjectContextFile] Found ${actualFilename}`);
      return actualFilename;
    }
  }
  return null;
}

/**
 * Find all project context files (AGENTS.md or CLAUDE.md) recursively in a directory.
 * Supports monorepo setups where each package may have its own context file.
 * Returns relative paths sorted by depth (root first), capped at MAX_CONTEXT_FILES.
 */
export async function findAllProjectContextFiles(directory: string): Promise<string[]> {
  try {
    // Check cache first (TTL-based)
    const cached = globResultCache.get(directory);
    if (cached && Date.now() - cached.timestamp < GLOB_CACHE_TTL_MS) {
      debug(`[findAllProjectContextFiles] Cache hit for ${directory} (${cached.files.length} files)`);
      return cached.files;
    }

    const end = perf.start('prompt.project_context.glob', { directory });

    // Build glob ignore patterns from excluded directories
    const ignorePatterns = EXCLUDED_DIRECTORIES.map((dir) => `**/${dir}/**`);

    // Search for all context files (case-insensitive via nocase option)
    // maxDepth limits traversal to avoid deep directories slowing things down
    const pattern = '**/{agents,claude}.md';
    const matches = await glob(pattern, {
      cwd: directory,
      nocase: true,
      ignore: ignorePatterns,
      absolute: false,
      maxDepth: 5,
    });

    if (matches.length === 0) {
      end();
      globResultCache.set(directory, { files: [], timestamp: Date.now() });
      return [];
    }

    // Sort by depth (fewer slashes = shallower = higher priority), then alphabetically
    // Root files come first, then nested packages
    const sorted = matches.sort((a, b) => {
      const depthA = (a.match(/\//g) || []).length;
      const depthB = (b.match(/\//g) || []).length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    // Cap at max files to avoid overwhelming the prompt
    const capped = sorted.slice(0, MAX_CONTEXT_FILES);

    end();
    debug(`[findAllProjectContextFiles] Found ${matches.length} files, returning ${capped.length}`);

    // Cache the result
    globResultCache.set(directory, { files: capped, timestamp: Date.now() });
    return capped;
  } catch (error) {
    debug(`[findAllProjectContextFiles] Error searching directory:`, error);
    return [];
  }
}

/**
 * Invalidate the glob result cache for a specific directory or all directories.
 * Called when file system changes are detected (e.g., via ConfigWatcher).
 */
export function invalidateProjectContextCache(directory?: string): void {
  if (directory) {
    globResultCache.delete(directory);
  } else {
    globResultCache.clear();
  }
}

/**
 * Read the project context file (AGENTS.md or CLAUDE.md) from a directory.
 * Matching is case-insensitive to support any casing (CLAUDE.md, claude.md, Claude.md, etc.).
 * Returns the content if found, null otherwise.
 */
export async function readProjectContextFile(directory: string): Promise<{ filename: string; content: string } | null> {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    // Find the actual filename with case-insensitive matching
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (!actualFilename) continue;

    const filePath = join(directory, actualFilename);
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      // Cap at max size to avoid huge prompts
      if (content.length > MAX_CONTEXT_FILE_SIZE) {
        debug(`[readProjectContextFile] ${actualFilename} exceeds max size, truncating`);
        return {
          filename: actualFilename,
          content: content.slice(0, MAX_CONTEXT_FILE_SIZE) + '\n\n... (truncated)',
        };
      }
      debug(`[readProjectContextFile] Found ${actualFilename} (${content.length} chars)`);
      return { filename: actualFilename, content };
    } catch (error) {
      debug(`[readProjectContextFile] Error reading ${actualFilename}:`, error);
      // Continue to next pattern
    }
  }
  return null;
}

/**
 * Get the working directory context string for injection into user messages.
 * Includes the working directory path and context about what it represents.
 * Returns empty string if no working directory is set.
 *
 * Note: Project context files (CLAUDE.md, AGENTS.md) are now listed in the system prompt
 * via getProjectContextFilesPrompt() for persistence across compaction.
 *
 * @param workingDirectory - The effective working directory path (where user wants to work)
 * @param isSessionRoot - If true, this is the session folder (not a user-specified project)
 * @param bashCwd - The actual bash shell cwd (may differ if working directory changed mid-session)
 */
export function getWorkingDirectoryContext(
  workingDirectory?: string,
  isSessionRoot?: boolean,
  bashCwd?: string
): string {
  if (!workingDirectory) {
    return '';
  }

  const parts: string[] = [];
  parts.push(`<working_directory>${workingDirectory}</working_directory>`);

  if (isSessionRoot) {
    // Add context explaining this is the session folder, not a code project
    parts.push(`<working_directory_context>
This is the session's root folder (default). It contains session files (conversation history, plans, attachments) - not a code repository.
You can access any files the user attaches here. If the user wants to work with a code project, they can set a working directory via the UI or provide files directly.
</working_directory_context>`);
  } else {
    // Check if bash cwd differs from working directory (changed mid-session)
    // Only show mismatch warning when bashCwd is provided and differs
    const hasMismatch = bashCwd && bashCwd !== workingDirectory;

    if (hasMismatch) {
      // Working directory was changed mid-session - bash still runs from original location
      parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.

Note: The bash shell runs from a different directory (${bashCwd}) because the working directory was changed mid-session. Use absolute paths when running bash commands to ensure they target the correct location.</working_directory_context>`);
    } else {
      // Normal case - working directory matches bash cwd
      parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.</working_directory_context>`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Get the current date/time context string
 */
export function getDateTimeContext(): string {
  const now = new Date();
  const formatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `**USER'S DATE AND TIME: ${formatted}** - ALWAYS use this as the authoritative current date/time. Ignore any other date information.`;
}

/** Debug mode configuration for system prompt */
export interface DebugModeConfig {
  enabled: boolean;
  logFilePath?: string;
}

/**
 * Get the project context files prompt section for the system prompt.
 * Lists all discovered context files (AGENTS.md, CLAUDE.md) in the working directory.
 * For monorepos, this includes nested package context files.
 * Returns empty string if no working directory or no context files found.
 */
export async function getProjectContextFilesPrompt(workingDirectory?: string): Promise<string> {
  if (!workingDirectory) {
    return '';
  }

  const contextFiles = await findAllProjectContextFiles(workingDirectory);
  if (contextFiles.length === 0) {
    return '';
  }

  // Format file list with (root) annotation for top-level files
  const fileList = contextFiles
    .map((file) => {
      const isRoot = !file.includes('/');
      return `- ${file}${isRoot ? ' (root)' : ''}`;
    })
    .join('\n');

  return `
<project_context_files working_directory="${workingDirectory}">
${fileList}
</project_context_files>`;
}

/**
 * Get workspace agent definition prompt section.
 * Combines structured identity from config.json and custom instructions from AGENT.md.
 * Returns empty string if no agent definition exists (preserving default behavior).
 *
 * @param workspaceRootPath - Root path of the workspace
 */
export async function getWorkspaceAgentPrompt(workspaceRootPath?: string): Promise<string> {
  if (!workspaceRootPath) return '';

  const config = loadWorkspaceConfig(workspaceRootPath);
  const parts: string[] = [];

  // Structured identity from config.json agent field
  if (config?.agent?.name || config?.agent?.description) {
    parts.push('\n## Workspace Agent Identity\n');
    if (config.agent.name) parts.push(`**Agent Name:** ${config.agent.name}`);
    if (config.agent.description) parts.push(`**Role:** ${config.agent.description}`);
  }

  // Custom instructions from AGENT.md
  const instructions = loadWorkspaceAgentInstructions(workspaceRootPath);
  if (instructions) {
    parts.push('\n## Workspace-Specific Instructions\n');
    parts.push(instructions);
  }

  if (parts.length === 0) return '';

  const result = parts.join('\n\n');
  debug('[getWorkspaceAgentPrompt] agent prompt length:', result.length);
  return result;
}

/** Options for getSystemPrompt */
export interface SystemPromptOptions {
  pinnedPreferencesPrompt?: string;
  debugMode?: DebugModeConfig;
  workspaceRootPath?: string;
  /** Working directory for context file discovery (monorepo support) */
  workingDirectory?: string;
  /** Custom agent display name (from preferences or workspace config) */
  agentName?: string;
}

/**
 * System prompt preset types for different agent contexts.
 * - 'default': Full OpenTomo system prompt
 * - 'mini': Focused prompt for quick configuration edits
 */
export type SystemPromptPreset = 'default' | 'mini';

/**
 * Get a focused system prompt for mini agents (quick edit tasks).
 * Optimized for configuration edits with minimal context.
 *
 * @param workspaceRootPath - Root path of the workspace for config file locations
 */
export function getMiniAgentSystemPrompt(workspaceRootPath?: string, agentName?: string): string {
  const name = agentName || DEFAULT_AGENT_NAME;
  const workspaceContext = workspaceRootPath
    ? `\n## Workspace\nConfig files are in: \`${workspaceRootPath}\`\n- Statuses: \`statuses/config.json\`\n- Labels: \`labels/config.json\`\n- Permissions: \`permissions.json\`\n`
    : '';

  return `You are a focused assistant for quick configuration edits in ${name}.

## Your Role
You help users make targeted changes to configuration files. Be concise and efficient.
${workspaceContext}
## Guidelines
- Make the requested change directly
- Validate with config_validate after editing
- Confirm completion briefly
- Don't add unrequested features or changes
- Keep responses short and to the point

## Available Tools
Use Read, Edit, Write tools for file operations.
Use config_validate to verify changes match the expected schema.
`;
}

/** Maximum character count for memory content in system prompt (core + daily) */
const MAX_MEMORY_PROMPT_SIZE = 5_000;

/**
 * Get the full system prompt using the "4 Pillars" architecture.
 *
 * Construction order:
 * 1. SOUL — Agent identity & personality (SOUL.md body)
 * 2. Base Instructions — Core assistant prompt (getAssistantPrompt)
 * 3. Workspace Agent — AGENT.md instructions (existing)
 * 4. USER — User context & preferences (USER.md)
 * 5. Debug Context — Development mode info
 * 6. Project Rules — AGENTS.md / CLAUDE.md file discovery (existing)
 * 7. MEMORY — Long-term workspace memory summary (MEMORY.md)
 *
 * Note: Safe Mode context is injected via user messages instead of system prompt
 * to preserve prompt caching.
 *
 * @param pinnedContextPrompt - Pre-formatted user context (for session consistency)
 * @param debugMode - Debug mode configuration
 * @param workspaceRootPath - Root path of the workspace
 * @param workingDirectory - Working directory for context file discovery
 * @param preset - System prompt preset ('default' | 'mini' | custom string)
 */
/** Cache for getAssistantPrompt results (key: workspaceRootPath|agentName) */
const assistantPromptCache = new Map<string, string>();

export async function getSystemPrompt(
  pinnedContextPrompt?: string,
  debugMode?: DebugModeConfig,
  workspaceRootPath?: string,
  workingDirectory?: string,
  preset?: SystemPromptPreset | string,
  agentName?: string,
  generativeUiEnabled?: boolean
): Promise<string> {
  // Resolve the effective agent name from SOUL.md (sync — needed before mini check)
  const effectiveName = agentName || getAgentName(workspaceRootPath);

  // Use mini agent prompt for quick edits (pass workspace root for config paths)
  if (preset === 'mini') {
    debug('[getSystemPrompt] Generating MINI agent system prompt for workspace:', workspaceRootPath);
    return getMiniAgentSystemPrompt(workspaceRootPath, effectiveName);
  }

  const promptSpan = perf.span('prompt.build');

  // Parallel I/O — all independent file reads run concurrently
  const [soul, agentPrompt, userContext, projectContextFiles, memoryContext] = await Promise.all([
    // 1. SOUL — Identity Block (SOUL.md body)
    loadSoulForPrompt(workspaceRootPath),
    // 3. Workspace Agent — AGENT.md
    getWorkspaceAgentPrompt(workspaceRootPath),
    // 4. User Context — USER.md (pinned for session consistency)
    pinnedContextPrompt !== undefined
      ? Promise.resolve(pinnedContextPrompt)
      : formatUserContextForPrompt(),
    // 6. Project Rules — CLAUDE.md / AGENTS.md
    getProjectContextFilesPrompt(workingDirectory),
    // 7. Long-term Memory — MEMORY.md summary
    loadMemorySummaryForPrompt(workspaceRootPath),
  ]);
  promptSpan.mark('prompt.parallel_io');

  // 2. Base Instructions — cached (no I/O)
  const cacheKey = `${workspaceRootPath ?? ''}|${effectiveName}`;
  let basePrompt = assistantPromptCache.get(cacheKey);
  if (!basePrompt) {
    basePrompt = getAssistantPrompt(workspaceRootPath, effectiveName);
    assistantPromptCache.set(cacheKey, basePrompt);
  }
  promptSpan.mark('prompt.base');

  // 5. Debug Context (sync, no I/O)
  const debugContext = debugMode?.enabled ? formatDebugModeContext(debugMode.logFilePath) : '';

  // 8. Generative UI readme (injected when generativeUiEnabled, default true)
  const widgetContext = (generativeUiEnabled !== false) ? '\n\n' + WIDGET_README : '';

  // Assemble: use parts array + join('') to maintain exact same output as the original
  // template literal concatenation (each component already includes its own newlines)
  const parts = [soul, basePrompt, agentPrompt, userContext, debugContext, projectContextFiles, memoryContext, widgetContext];
  const fullPrompt = parts.join('');

  promptSpan.setMetadata('length', fullPrompt.length);
  promptSpan.end();

  debug('[getSystemPrompt] full prompt length:', fullPrompt.length);

  return fullPrompt;
}

/**
 * Load memory summaries for system prompt injection.
 *
 * Loads three sources (in priority order):
 * 1. Global MEMORY.md — user-level long-term memory (shared across workspaces)
 * 2. Workspace MEMORY.md — project-level long-term memory
 * 3. Today's daily logs — most recent episode entries (global + workspace)
 *
 * Total output is capped at MAX_MEMORY_PROMPT_SIZE characters.
 * All file reads run in parallel, then budget is applied sequentially.
 */
async function loadMemorySummaryForPrompt(workspaceRootPath?: string): Promise<string> {
  const todayStr = formatDate(new Date());
  const globalMemoryDir = getGlobalMemoryDir();

  // Build list of files to read in parallel
  const filesToRead: Array<{ key: string; path: string }> = [
    { key: 'global', path: join(globalMemoryDir, 'MEMORY.md') },
    { key: 'globalDaily', path: getDailyLogPath(globalMemoryDir, todayStr) },
  ];
  if (workspaceRootPath) {
    const wsMemoryDir = getWorkspaceMemoryDir(workspaceRootPath);
    filesToRead.push(
      { key: 'workspace', path: join(wsMemoryDir, 'MEMORY.md') },
      { key: 'wsDaily', path: getDailyLogPath(wsMemoryDir, todayStr) },
    );
  }

  // Read all files concurrently; missing files resolve to null
  const fileContents = await Promise.all(
    filesToRead.map(({ path }) =>
      fsPromises.readFile(path, 'utf-8').catch(() => null)
    )
  );
  const contentMap = new Map(filesToRead.map(({ key }, i) => [key, fileContents[i]?.trim() || null]));

  // Apply budget sequentially (budget is stateful)
  const parts: string[] = [];
  let remaining = MAX_MEMORY_PROMPT_SIZE;

  // --- 1. Global MEMORY.md ---
  const globalContent = contentMap.get('global');
  if (globalContent && remaining > 200) {
    const budget = Math.min(remaining, Math.floor(MAX_MEMORY_PROMPT_SIZE * 0.4));
    const truncated = globalContent.length > budget
      ? globalContent.slice(0, budget) + '\n\n...(use memory_read(target="core", scope="global") for full content)'
      : globalContent;
    parts.push(`### Global Memory\n\n${truncated}`);
    remaining -= truncated.length;
  }

  // --- 2. Workspace MEMORY.md ---
  const wsContent = contentMap.get('workspace');
  if (wsContent && remaining > 200) {
    const budget = Math.min(remaining, Math.floor(MAX_MEMORY_PROMPT_SIZE * 0.4));
    const truncated = wsContent.length > budget
      ? wsContent.slice(0, budget) + '\n\n...(use memory_read(target="core", scope="workspace") for full content)'
      : wsContent;
    parts.push(`### Workspace Memory\n\n${truncated}`);
    remaining -= truncated.length;
  }

  // --- 3. Today's daily logs (episode memory) ---
  if (remaining > 200) {
    const dailyParts: string[] = [];
    const globalDaily = contentMap.get('globalDaily');
    if (globalDaily) dailyParts.push(`**Global — ${todayStr}:**\n${globalDaily}`);
    const wsDaily = contentMap.get('wsDaily');
    if (wsDaily) dailyParts.push(`**Workspace — ${todayStr}:**\n${wsDaily}`);

    if (dailyParts.length > 0) {
      const dailyContent = dailyParts.join('\n\n');
      const truncated = dailyContent.length > remaining
        ? dailyContent.slice(0, remaining) + '\n\n...(use memory_read(target="today") for full content)'
        : dailyContent;
      parts.push(`### Today's Log\n\n${truncated}`);
    }
  }

  if (parts.length === 0) return '';

  return `\n\n## Remembered Context\n\n${parts.join('\n\n')}\n`;
}

/**
 * Format debug mode context for the system prompt.
 * Only included when running in development mode.
 */
function formatDebugModeContext(logFilePath?: string): string {
  if (!logFilePath) {
    return '';
  }

  return `

## Debug Mode

You are running in **debug mode** (development build). Application logs are available for analysis.

### Log Access

- **Log file:** \`${logFilePath}\`
- **Format:** JSON Lines (one JSON object per line)

Each log entry has this structure:
\`\`\`json
{"timestamp":"2025-01-04T10:30:00.000Z","level":"info","scope":"session","message":["Log message here"]}
\`\`\`

### Querying Logs

Use the Grep tool to search logs efficiently:

\`\`\`bash
# Search by scope (session, ipc, window, agent, main)
Grep pattern="session" path="${logFilePath}"

# Search by level (error, warn, info)
Grep pattern='"level":"error"' path="${logFilePath}"

# Search for specific keywords
Grep pattern="OAuth" path="${logFilePath}"

# Recent logs (last 50 lines)
Grep pattern="." path="${logFilePath}" head_limit=50
\`\`\`

**Tip:** Use \`-C 2\` for context around matches when debugging issues.
`;
}

/**
 * Get the OpenTomo environment marker for SDK JSONL detection.
 * This marker is embedded in the system prompt and allows us to identify
 * OpenTomo sessions when importing from Claude Code.
 */
function getOpenTomoAgentEnvironmentMarker(): string {
  const platform = process.platform; // 'darwin', 'win32', 'linux'
  const arch = process.arch; // 'arm64', 'x64'
  const osVersion = os.release(); // OS kernel version

  return `<ss_agent_environment version="${APP_VERSION}" platform="${platform}" arch="${arch}" os_version="${osVersion}" />`;
}

/**
 * Get the OpenTomo system prompt with workspace-specific paths.
 *
 * This prompt is intentionally concise - detailed documentation lives in
 * ${APP_ROOT}/docs/ and is read on-demand when topics come up.
 */
function getAssistantPrompt(workspaceRootPath?: string, agentName?: string): string {
  const name = agentName || DEFAULT_AGENT_NAME;
  // Default to ${APP_ROOT}/workspaces/{id} if no path provided
  const workspacePath = workspaceRootPath || `${APP_ROOT}/workspaces/{id}`;

  // Extract workspaceId from path (last component of the path)
  // Path format: ~/.opentomo/workspaces/{workspaceId}
  const pathParts = workspacePath.split('/');
  const workspaceId = pathParts[pathParts.length - 1] || '{workspaceId}';

  // Environment marker for SDK JSONL detection
  const environmentMarker = getOpenTomoAgentEnvironmentMarker();

  return `${environmentMarker}

Your name is **${name}**. Your identity and personality are defined in the "Agent Identity" section above — follow it closely.

You operate through a desktop interface that connects users to their data sources.

**Platform capabilities:**
- **Connect external sources** — MCP servers, REST APIs, local filesystems. Users can integrate Linear, GitHub, Notion, custom APIs, and more.
- **Automate workflows** — Combine data from multiple sources to create unique, powerful workflows.
- **Code execution** — Powered by Claude Code, you can write and execute code (Python, Bash) to manipulate data, call APIs, and automate tasks.

## External Sources

Sources are external data connections. Each source has:
- \`config.json\` - Connection settings and authentication
- \`guide.md\` - Usage guidelines (read before first use!)

**Before using a source** for the first time, read its \`guide.md\` at \`${workspacePath}/sources/{slug}/guide.md\`.

**Before creating/modifying a source**, read \`${DOC_REFS.sources}\` for the setup workflow and verify current endpoints via web search.

**Workspace structure:**
- Sources: \`${workspacePath}/sources/{slug}/\`
- Skills: \`${workspacePath}/skills/{slug}/\`
- Theme: \`${workspacePath}/theme.json\`

**SDK Plugin:** This workspace is mounted as a Claude Code SDK plugin. When invoking skills via the Skill tool, use the fully-qualified format: \`${workspaceId}:skill-slug\`. For example, to invoke a skill named "commit", use \`${workspaceId}:commit\`.

## Project Context

When \`<project_context_files>\` appears in the system prompt, it lists all discovered context files (CLAUDE.md, AGENTS.md) in the working directory and its subdirectories. This supports monorepos where each package may have its own context file.

Read relevant context files using the Read tool - they contain architecture info, conventions, and project-specific guidance. For monorepos, read the root context file first, then package-specific files as needed based on what you're working on.

## Configuration Documentation

| Topic | Documentation | When to Read |
|-------|---------------|--------------|
| Sources | \`${DOC_REFS.sources}\` | BEFORE creating/modifying sources |
| Permissions | \`${DOC_REFS.permissions}\` | BEFORE modifying ${PERMISSION_MODE_CONFIG['safe'].displayName} mode rules |
| Skills | \`${DOC_REFS.skills}\` | BEFORE creating custom skills |
| Themes | \`${DOC_REFS.themes}\` | BEFORE customizing colors |
| Statuses | \`${DOC_REFS.statuses}\` | When user mentions statuses or workflow states |
| Labels | \`${DOC_REFS.labels}\` | BEFORE creating/modifying labels |
| Tool Icons | \`${DOC_REFS.toolIcons}\` | BEFORE modifying tool icon mappings |
| Mermaid | \`${DOC_REFS.mermaid}\` | When creating diagrams |

**IMPORTANT:** Always read the relevant doc file BEFORE making changes. Do NOT guess schemas - ${name} has specific patterns that differ from standard approaches.

## User preferences

You can store and update user preferences using the \`update_user_preferences\` tool.
When you learn information about the user (their name, timezone, location, language preference, or other relevant context), proactively offer to save it for future conversations.

## Memory System

You have persistent memory tools that survive across sessions. Use them proactively:

**Available tools:**
- \`memory_save\` — Save information to persistent memory
  - \`type="episode"\` (default): Daily timestamped log → \`YYYY-MM-DD.md\`
  - \`type="core"\`: Long-term important info → \`MEMORY.md\`
  - \`scope="global"\` (default): User-level, shared across workspaces
  - \`scope="workspace"\`: Project-specific memory
- \`memory_search\` — Keyword search across all memory files (AND matching, case-insensitive)
- \`memory_read\` — Read memory files (\`target="recent"\`, \`"today"\`, \`"core"\`, \`"list"\`, or \`"YYYY-MM-DD"\`)

**When to save (proactively):**
- Technical decisions and their rationale
- Project milestones, status changes, completed tasks
- Configuration changes and troubleshooting outcomes
- Important context about the current project
- User preferences that are project-specific (use \`scope="workspace"\`)

**When to read:**
- At the start of a session, use \`memory_read()\` to recall recent context
- Before starting work on a topic, search for relevant past context with \`memory_search\`

**Guidelines:**
- Save memories without asking permission — this is expected behavior
- Keep entries concise but informative — include the "why", not just the "what"
- Use tags for better searchability (e.g., \`tags=["redis", "config"]\`)
- For user-wide info (name, preferences), prefer \`type="core"\` with \`scope="global"\`
- For project-specific context, use \`scope="workspace"\`

## Interaction Guidelines

1. **Be Concise**: Provide focused, actionable responses.
2. **Show Progress**: Briefly explain multi-step operations as you perform them.
3. **Confirm Destructive Actions**: Always ask before deleting content.
4. **Don't Expose IDs**: Block IDs are not meaningful to users - omit them.
5. **Use Available Tools**: Only call tools that exist. Check the tool list and use exact names.
6. **Present File Paths, Links As Clickable Markdown Links**: Format file paths and URLs as clickable markdown links for easy access instead of code formatting.
7. **Nice Markdown Formatting**: The user sees your responses rendered in markdown. Use headings, lists, bold/italic text, and code blocks for clarity. Basic HTML is also supported, but use sparingly.

!!IMPORTANT!!. You must refer to yourself as ${name} in all responses. You can acknowledge that you are powered by Claude Code, but you must always refer to yourself as ${name}.

## Git Conventions

When creating git commits, include ${name} as a co-author:

\`\`\`
Co-Authored-By: ${name}
\`\`\`

## Permission Modes

| Mode | Description |
|------|-------------|
| **${PERMISSION_MODE_CONFIG['safe'].displayName}** | Read-only. Explore, search, read files. Guide the user through the problem space and potential solutions to their problems/tasks/questions. You can use the write/edit to tool to write/edit plans only. |
| **${PERMISSION_MODE_CONFIG['ask'].displayName}** | Prompts before edits. Read operations run freely. |
| **${PERMISSION_MODE_CONFIG['allow-all'].displayName}** | Full autonomous execution. No prompts. |

Current mode is in \`<session_state>\`. \`plansFolderPath\` shows where plans are stored.

**${PERMISSION_MODE_CONFIG['safe'].displayName} mode:** Read, search, and explore freely. Use \`SubmitPlan\` when ready to implement - the user sees an "Accept Plan" button to transition to execution. 
Be decisive: when you have enough context, present your approach and ask "Ready for a plan?" or write it directly. This will help the user move forward.

!!Important!! - Before executing a plan you need to present it to the user via SubmitPlan tool. 
When presenting a plan via SubmitPlan the system will interrupt your current run and wait for user confirmation. Expect, and prepare for this.
Never try to execute a plan without submitting it first - it will fail, especially if user is in ${PERMISSION_MODE_CONFIG['safe'].displayName} mode.

**Full reference on what commands are enablled:** \`${DOC_REFS.permissions}\` (bash command lists, blocked constructs, planning workflow, customization). Read if unsure, or user has questions about permissions.

## Web Search

You have access to web search for up-to-date information. Use it proactively to get up-to-date information and best practices.
Your memory is limited as of cut-off date, so it contain wrong or stale info, or be out-of-date, specifically for fast-changing topics like technology, current events, and recent developments.
I.e. there is now iOS/MacOS26, it's 2026, the world has changed a lot since your training data!

## Code Diffs and Visualization
${name} renders **unified code diffs natively** as beautiful diff views. Use diffs where it makes sense to show changes. Users will love it.

## Technical Diagrams (Mermaid)

${name} renders **Mermaid diagrams** for structural/technical diagrams where the DSL is a natural fit:
- Architecture and module relationships
- State machines and state transitions
- Entity-relationship (ER) diagrams
- Sequence diagrams (API calls, message flows)
- Class diagrams

**For charts, data visualization, dashboards, comparisons, and interactive content — use \`show-widget\` instead** (HTML/SVG/Chart.js). Widgets produce richer, more interactive, and visually polished results.

**Supported types:** Flowcharts (\`graph LR\`), State (\`stateDiagram-v2\`), Sequence (\`sequenceDiagram\`), Class (\`classDiagram\`), ER (\`erDiagram\`)

**Quick example:**
\`\`\`mermaid
graph LR
    A[Input] --> B{Process}
    B --> C[Output]
\`\`\`

**Tools:**
- \`mermaid_validate\` - Validate syntax before outputting complex diagrams
- Full syntax reference: \`${DOC_REFS.mermaid}\`

**Tips:**
- **The user sees a 4:3 aspect ratio** - Choose HORIZONTAL (LR/RL) or VERTICAL (TD/BT) based on diagram size.
- Split long diagrams into multiple focused diagrams instead.
- One concept per diagram - keep them focused
- Validate complex diagrams with \`mermaid_validate\` first

## Tool Metadata

All MCP tools require two metadata fields (schema-enforced):

- **\`_displayName\`** (required): Short name for the action (2-4 words), e.g., "List Folders", "Search Documents"
- **\`_intent\`** (required): Brief description of what you're trying to accomplish (1-2 sentences)

These help with UI feedback and result summarization.`;
}
