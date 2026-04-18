/**
 * Memory MCP Tools
 *
 * Provides three MCP tools for the episode memory system:
 * - memory_save: Save daily logs or long-term memory
 * - memory_search: Search across memory files by keyword
 * - memory_read: Read memory files or list available memories
 *
 * These tools use the same patterns as session-scoped-tools.ts:
 * - tool() helper from Claude Agent SDK
 * - createSdkMcpServer() for MCP server wrapping
 * - workspaceRootPath captured in closures
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { debug } from '../utils/debug.ts';
import {
  getGlobalMemoryDir,
  getWorkspaceMemoryDir,
  ensureMemoryDirectories,
  getDailyLogPath,
  getLongTermMemoryPath,
  listMemoryFiles,
  formatDate,
  formatTime,
  type MemoryFileInfo,
} from './storage.ts';

// ============================================================
// Tool Result Type
// ============================================================

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

// ============================================================
// Helper: Get base directory for a scope
// ============================================================

function getBaseDirForScope(
  scope: 'global' | 'workspace',
  workspaceRootPath: string,
): string {
  return scope === 'global'
    ? getGlobalMemoryDir()
    : getWorkspaceMemoryDir(workspaceRootPath);
}

// ============================================================
// Helper: Format entry for daily log
// ============================================================

function formatEpisodeEntry(content: string, tags?: string[]): string {
  const now = new Date();
  const time = formatTime(now);
  const tagStr = tags && tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  return `## ${time}${tagStr}\n\n${content}\n\n---\n\n`;
}

// ============================================================
// Helper: Format entry for core memory
// ============================================================

function formatCoreEntry(content: string, tags?: string[]): string {
  const now = new Date();
  const dateStr = formatDate(now);
  const time = formatTime(now);
  const tagStr = tags && tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  return `## ${dateStr} ${time}${tagStr}\n\n${content}\n\n---\n\n`;
}

// ============================================================
// Helper: Read first N lines of a file
// ============================================================

function readFirstLines(filePath: string, maxLines: number = 5): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, maxLines);
    return lines.join('\n');
  } catch {
    return '(unable to read)';
  }
}

// ============================================================
// Helper: Split file content into sections
// ============================================================

interface MemorySection {
  heading: string;
  content: string;
  lineStart: number;
}

function splitIntoSections(content: string): MemorySection[] {
  const lines = content.split('\n');
  const sections: MemorySection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('## ')) {
      // Save previous section if it has content
      if (currentLines.length > 0) {
        const sectionContent = currentLines.join('\n').trim();
        if (sectionContent) {
          sections.push({
            heading: currentHeading,
            content: sectionContent,
            lineStart: currentStart,
          });
        }
      }
      currentHeading = line;
      currentLines = [];
      currentStart = i + 1;
    } else if (line.trim() === '---') {
      // Section divider - save current section
      if (currentLines.length > 0) {
        const sectionContent = currentLines.join('\n').trim();
        if (sectionContent) {
          sections.push({
            heading: currentHeading,
            content: sectionContent,
            lineStart: currentStart,
          });
        }
      }
      currentLines = [];
      currentStart = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentLines.length > 0) {
    const sectionContent = currentLines.join('\n').trim();
    if (sectionContent) {
      sections.push({
        heading: currentHeading,
        content: sectionContent,
        lineStart: currentStart,
      });
    }
  }

  return sections;
}

// ============================================================
// Helper: Search within sections
// ============================================================

interface SearchResult {
  scope: 'global' | 'workspace';
  fileName: string;
  heading: string;
  snippet: string;
  lineStart: number;
}

function searchInDirectory(
  baseDir: string,
  scope: 'global' | 'workspace',
  queryWords: string[],
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const files = listMemoryFiles(baseDir);

  for (const file of files) {
    if (results.length >= limit) break;

    const filePath = `${baseDir}/${file.name}`;
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const sections = splitIntoSections(content);

    for (const section of sections) {
      if (results.length >= limit) break;

      const searchText = `${section.heading}\n${section.content}`.toLowerCase();
      const allMatch = queryWords.every(word => searchText.includes(word));

      if (allMatch) {
        // Create snippet (truncate long content)
        const snippet = section.content.length > 200
          ? section.content.slice(0, 200) + '...'
          : section.content;

        results.push({
          scope,
          fileName: file.name,
          heading: section.heading,
          snippet,
          lineStart: section.lineStart,
        });
      }
    }
  }

  return results;
}

// ============================================================
// Tool 1: memory_save
// ============================================================

function createMemorySaveTool(workspaceRootPath: string) {
  return tool(
    'memory_save',
    `Save information to persistent memory. Use this to record:
- Daily work logs, decisions, and context (type="episode")
- Important long-term information like user preferences, project conventions (type="core")

Episode memories are saved to daily log files (YYYY-MM-DD.md) with timestamps.
Core memories are saved to MEMORY.md for long-term persistence.

**Scope:**
- "global": User-level memory, shared across all workspaces (default)
- "workspace": Project-specific memory for the current workspace

**When to save:**
- Important technical decisions and their rationale
- Project milestones and status changes
- User preferences or context learned during conversation
- Configuration details that might be needed later`,
    {
      content: z.string().min(1).describe('The content to save (Markdown format recommended)'),
      type: z.enum(['episode', 'core']).default('episode').describe(
        'episode: daily timestamped log entry, core: long-term MEMORY.md entry'
      ),
      scope: z.enum(['global', 'workspace']).default('global').describe(
        'global: user-level (all workspaces), workspace: project-specific'
      ),
      tags: z.array(z.string()).optional().describe(
        'Optional tags for search (e.g., ["redis", "config", "deployment"])'
      ),
    },
    async (args): Promise<ToolResult> => {
      debug('[memory_save] type:', args.type, 'scope:', args.scope, 'tags:', args.tags);

      try {
        ensureMemoryDirectories(workspaceRootPath);

        const baseDir = getBaseDirForScope(args.scope, workspaceRootPath);

        if (args.type === 'episode') {
          const logPath = getDailyLogPath(baseDir);
          const entry = formatEpisodeEntry(args.content, args.tags);

          // Create file with header if it doesn't exist
          if (!existsSync(logPath)) {
            const today = formatDate(new Date());
            writeFileSync(logPath, `# ${today}\n\n`, 'utf-8');
          }

          appendFileSync(logPath, entry, 'utf-8');
          const fileName = logPath.split('/').pop();

          return {
            content: [{
              type: 'text',
              text: `Episode saved to ${args.scope}/${fileName}`,
            }],
          };
        } else {
          // core memory
          const memoryPath = getLongTermMemoryPath(baseDir);
          const entry = formatCoreEntry(args.content, args.tags);

          // Create file with header if it doesn't exist
          if (!existsSync(memoryPath)) {
            writeFileSync(memoryPath, '# Long-Term Memory\n\n', 'utf-8');
          }

          appendFileSync(memoryPath, entry, 'utf-8');

          return {
            content: [{
              type: 'text',
              text: `Core memory saved to ${args.scope}/MEMORY.md`,
            }],
          };
        }
      } catch (error) {
        debug('[memory_save] Error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error saving memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Tool 2: memory_search
// ============================================================

function createMemorySearchTool(workspaceRootPath: string) {
  return tool(
    'memory_search',
    `Search across memory files by keyword. Finds matching sections in both daily logs and MEMORY.md.

**Search behavior:**
- Space-separated words are matched with AND logic (all must appear)
- Case-insensitive matching
- Searches within section boundaries (## headings or --- dividers)
- Results ordered by date (newest first)

**Scope:**
- "all": Search both global and workspace memories (default)
- "global": Search only user-level memories
- "workspace": Search only project-specific memories

**Examples:**
- memory_search(query="Redis config") → finds sections mentioning both "redis" and "config"
- memory_search(query="deployment", scope="workspace") → project-specific deployment notes`,
    {
      query: z.string().min(1).describe('Search keywords (space-separated for AND matching)'),
      scope: z.enum(['global', 'workspace', 'all']).default('all').describe(
        'Search scope: all (both), global (user-level), workspace (project-specific)'
      ),
      limit: z.number().int().min(1).max(50).default(10).describe(
        'Maximum number of results to return'
      ),
    },
    async (args): Promise<ToolResult> => {
      debug('[memory_search] query:', args.query, 'scope:', args.scope, 'limit:', args.limit);

      try {
        const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        if (queryWords.length === 0) {
          return {
            content: [{ type: 'text', text: 'Error: Query is empty after processing.' }],
            isError: true,
          };
        }

        const allResults: SearchResult[] = [];

        // Search global memory
        if (args.scope === 'all' || args.scope === 'global') {
          const globalDir = getGlobalMemoryDir();
          if (existsSync(globalDir)) {
            allResults.push(
              ...searchInDirectory(globalDir, 'global', queryWords, args.limit)
            );
          }
        }

        // Search workspace memory
        if (args.scope === 'all' || args.scope === 'workspace') {
          const workspaceDir = getWorkspaceMemoryDir(workspaceRootPath);
          if (existsSync(workspaceDir)) {
            const remaining = args.limit - allResults.length;
            if (remaining > 0) {
              allResults.push(
                ...searchInDirectory(workspaceDir, 'workspace', queryWords, remaining)
              );
            }
          }
        }

        if (allResults.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No results found for "${args.query}".`,
            }],
          };
        }

        // Format results
        const formatted = allResults.map((r, i) => {
          const heading = r.heading ? ` — ${r.heading}` : '';
          return `**${i + 1}.** [${r.scope}] ${r.fileName}${heading}\n${r.snippet}`;
        }).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${allResults.length} result(s) for "${args.query}":\n\n${formatted}`,
          }],
        };
      } catch (error) {
        debug('[memory_search] Error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error searching memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Tool 3: memory_read
// ============================================================

function createMemoryReadTool(workspaceRootPath: string) {
  return tool(
    'memory_read',
    `Read memory files or list available memories.

**Targets:**
- "recent" (default): Recent daily logs (last 3 days) + MEMORY.md summary
- "today": Today's daily log
- "core": Full MEMORY.md content
- "list": List all memory files with sizes and previews
- "YYYY-MM-DD": A specific day's log (e.g., "2026-02-10")

**Scope:**
- "global": User-level memories (default)
- "workspace": Project-specific memories
- "all": Both scopes

**Usage tips:**
- Start a session with memory_read() to recall recent context
- Use memory_read(target="core") to check long-term memory
- Use memory_read(target="list") to see what's available`,
    {
      target: z.string().default('recent').describe(
        'What to read: "recent", "today", "core", "list", or "YYYY-MM-DD"'
      ),
      scope: z.enum(['global', 'workspace', 'all']).default('global').describe(
        'Read scope: global (user-level), workspace (project-specific), all (both)'
      ),
    },
    async (args): Promise<ToolResult> => {
      debug('[memory_read] target:', args.target, 'scope:', args.scope);

      try {
        const scopes: Array<'global' | 'workspace'> =
          args.scope === 'all' ? ['global', 'workspace'] :
          [args.scope];

        if (args.target === 'list') {
          return readList(scopes, workspaceRootPath);
        }

        if (args.target === 'core') {
          return readCore(scopes, workspaceRootPath);
        }

        if (args.target === 'today') {
          return readDay(scopes, workspaceRootPath, formatDate(new Date()));
        }

        if (args.target === 'recent') {
          return readRecent(scopes, workspaceRootPath);
        }

        // Try as YYYY-MM-DD date
        if (/^\d{4}-\d{2}-\d{2}$/.test(args.target)) {
          return readDay(scopes, workspaceRootPath, args.target);
        }

        return {
          content: [{
            type: 'text',
            text: `Unknown target "${args.target}". Use "recent", "today", "core", "list", or a date like "2026-02-14".`,
          }],
          isError: true,
        };
      } catch (error) {
        debug('[memory_read] Error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error reading memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// memory_read Sub-handlers
// ============================================================

function readList(
  scopes: Array<'global' | 'workspace'>,
  workspaceRootPath: string,
): ToolResult {
  const parts: string[] = [];

  for (const scope of scopes) {
    const baseDir = getBaseDirForScope(scope, workspaceRootPath);
    const files = listMemoryFiles(baseDir);

    parts.push(`### ${scope === 'global' ? 'Global' : 'Workspace'} Memory`);

    if (files.length === 0) {
      parts.push('(no memory files yet)\n');
      continue;
    }

    for (const file of files) {
      const sizeKB = (file.size / 1024).toFixed(1);
      const preview = readFirstLines(`${baseDir}/${file.name}`, 3);
      const previewFormatted = preview.split('\n').map(l => `  ${l}`).join('\n');
      parts.push(`- **${file.name}** (${sizeKB} KB)\n${previewFormatted}`);
    }
    parts.push('');
  }

  return {
    content: [{
      type: 'text',
      text: parts.join('\n') || 'No memory files found.',
    }],
  };
}

function readCore(
  scopes: Array<'global' | 'workspace'>,
  workspaceRootPath: string,
): ToolResult {
  const parts: string[] = [];

  for (const scope of scopes) {
    const baseDir = getBaseDirForScope(scope, workspaceRootPath);
    const memoryPath = getLongTermMemoryPath(baseDir);

    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, 'utf-8');
      parts.push(`### ${scope === 'global' ? 'Global' : 'Workspace'} MEMORY.md\n`);
      parts.push(content);
    } else {
      parts.push(`### ${scope === 'global' ? 'Global' : 'Workspace'} MEMORY.md\n`);
      parts.push('(no long-term memory file yet)\n');
    }
  }

  return {
    content: [{
      type: 'text',
      text: parts.join('\n'),
    }],
  };
}

function readDay(
  scopes: Array<'global' | 'workspace'>,
  workspaceRootPath: string,
  date: string,
): ToolResult {
  const parts: string[] = [];

  for (const scope of scopes) {
    const baseDir = getBaseDirForScope(scope, workspaceRootPath);
    const logPath = getDailyLogPath(baseDir, date);

    if (existsSync(logPath)) {
      const content = readFileSync(logPath, 'utf-8');
      parts.push(`### ${scope === 'global' ? 'Global' : 'Workspace'} — ${date}\n`);
      parts.push(content);
    } else {
      parts.push(`### ${scope === 'global' ? 'Global' : 'Workspace'} — ${date}\n`);
      parts.push(`(no log for ${date})\n`);
    }
  }

  return {
    content: [{
      type: 'text',
      text: parts.join('\n'),
    }],
  };
}

function readRecent(
  scopes: Array<'global' | 'workspace'>,
  workspaceRootPath: string,
): ToolResult {
  const parts: string[] = [];
  const recentDays = 3;

  // Generate last N dates
  const dates: string[] = [];
  for (let i = 0; i < recentDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(formatDate(d));
  }

  for (const scope of scopes) {
    const baseDir = getBaseDirForScope(scope, workspaceRootPath);
    const scopeLabel = scope === 'global' ? 'Global' : 'Workspace';
    parts.push(`### ${scopeLabel} — Recent\n`);

    // Read recent daily logs
    let hasContent = false;
    for (const date of dates) {
      const logPath = getDailyLogPath(baseDir, date);
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, 'utf-8');
        // Truncate if very long
        const truncated = content.length > 2000
          ? content.slice(0, 2000) + '\n\n...(truncated)'
          : content;
        parts.push(`#### ${date}\n`);
        parts.push(truncated);
        parts.push('');
        hasContent = true;
      }
    }

    if (!hasContent) {
      parts.push('(no recent logs)\n');
    }

    // Read MEMORY.md summary (first section only)
    const memoryPath = getLongTermMemoryPath(baseDir);
    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, 'utf-8');
      // Show first ~500 chars
      const summary = content.length > 500
        ? content.slice(0, 500) + '\n\n...(use target="core" for full content)'
        : content;
      parts.push(`#### ${scopeLabel} Core Memory (summary)\n`);
      parts.push(summary);
      parts.push('');
    }
  }

  return {
    content: [{
      type: 'text',
      text: parts.join('\n') || 'No memories found.',
    }],
  };
}

// ============================================================
// MCP Server Factory
// ============================================================

/**
 * Create the memory MCP server with all three tools.
 * @param workspaceRootPath - Absolute path to workspace root for workspace-scoped memory
 */
export function createMemoryTools(workspaceRootPath: string) {
  return createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools: [
      createMemorySaveTool(workspaceRootPath),
      createMemorySearchTool(workspaceRootPath),
      createMemoryReadTool(workspaceRootPath),
    ],
  });
}
