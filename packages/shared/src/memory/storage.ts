/**
 * Memory Storage Layer
 *
 * Handles path resolution, validation, and directory initialization
 * for the episode memory system.
 *
 * Two scopes:
 * - Global: ~/.opentomo/memory/ (user-level, shared across workspaces)
 * - Workspace: ~/.opentomo/workspaces/{id}/memory/ (project-level)
 *
 * Virtual paths:
 * - /global/... → CONFIG_DIR/memory/...
 * - /workspace/... → workspaceRootPath/memory/...
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve, normalize } from 'path';
import { CONFIG_DIR } from '../config/paths.ts';

// ============================================================
// Path Constants
// ============================================================

const MEMORY_DIR_NAME = 'memory';
const LONG_TERM_FILE = 'MEMORY.md';

// ============================================================
// Directory Getters
// ============================================================

/**
 * Get the global memory directory path.
 * @returns Absolute path to ~/.opentomo/memory/
 */
export function getGlobalMemoryDir(): string {
  return join(CONFIG_DIR, MEMORY_DIR_NAME);
}

/**
 * Get the workspace memory directory path.
 * @param workspaceRootPath - Absolute path to workspace root (e.g., ~/.opentomo/workspaces/{id}/)
 * @returns Absolute path to workspace memory directory
 */
export function getWorkspaceMemoryDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, MEMORY_DIR_NAME);
}

// ============================================================
// Directory Initialization
// ============================================================

/**
 * Ensure both global and workspace memory directories exist.
 * Creates them if they don't exist.
 */
export function ensureMemoryDirectories(workspaceRootPath: string): void {
  const globalDir = getGlobalMemoryDir();
  const workspaceDir = getWorkspaceMemoryDir(workspaceRootPath);

  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }
}

// ============================================================
// Path Resolution
// ============================================================

/**
 * Validate that a virtual path is safe (no directory traversal).
 * Only /global/ and /workspace/ prefixes are allowed.
 */
export function isValidMemoryPath(virtualPath: string): boolean {
  if (!virtualPath) return false;
  // Must start with /global/ or /workspace/
  if (!virtualPath.startsWith('/global/') && !virtualPath.startsWith('/workspace/')
      && virtualPath !== '/global' && virtualPath !== '/workspace') {
    return false;
  }
  // Block directory traversal
  if (virtualPath.includes('..')) return false;
  // Block null bytes
  if (virtualPath.includes('\0')) return false;
  return true;
}

/**
 * Resolve a virtual memory path to an absolute filesystem path.
 *
 * @param virtualPath - Virtual path (e.g., /global/MEMORY.md, /workspace/2026-02-14.md)
 * @param workspaceRootPath - Absolute path to workspace root
 * @returns Absolute filesystem path, or null if invalid
 */
export function resolveMemoryPath(
  virtualPath: string,
  workspaceRootPath: string,
): string | null {
  if (!isValidMemoryPath(virtualPath)) return null;

  let baseDir: string;
  let relativePart: string;

  if (virtualPath === '/global' || virtualPath === '/global/') {
    return getGlobalMemoryDir();
  }
  if (virtualPath === '/workspace' || virtualPath === '/workspace/') {
    return getWorkspaceMemoryDir(workspaceRootPath);
  }

  if (virtualPath.startsWith('/global/')) {
    baseDir = getGlobalMemoryDir();
    relativePart = virtualPath.slice('/global/'.length);
  } else if (virtualPath.startsWith('/workspace/')) {
    baseDir = getWorkspaceMemoryDir(workspaceRootPath);
    relativePart = virtualPath.slice('/workspace/'.length);
  } else {
    return null;
  }

  if (!relativePart) return baseDir;

  const resolvedPath = resolve(baseDir, relativePart);
  const normalizedBase = normalize(baseDir);
  const normalizedResolved = normalize(resolvedPath);

  // Ensure resolved path is within the memory directory
  if (!normalizedResolved.startsWith(normalizedBase)) {
    return null;
  }

  return resolvedPath;
}

// ============================================================
// File Path Helpers
// ============================================================

/**
 * Get the path for a daily log file.
 * @param baseDir - Memory directory (global or workspace)
 * @param date - Date string in YYYY-MM-DD format. Defaults to today.
 */
export function getDailyLogPath(baseDir: string, date?: string): string {
  const dateStr = date ?? formatDate(new Date());
  return join(baseDir, `${dateStr}.md`);
}

/**
 * Get the path for the long-term memory file (MEMORY.md).
 * @param baseDir - Memory directory (global or workspace)
 */
export function getLongTermMemoryPath(baseDir: string): string {
  return join(baseDir, LONG_TERM_FILE);
}

// ============================================================
// File Listing
// ============================================================

export interface MemoryFileInfo {
  name: string;
  size: number;
  modified: Date;
}

/**
 * List all .md files in a memory directory, sorted by date descending.
 * Daily log files (YYYY-MM-DD.md) are sorted by date.
 * Other files (MEMORY.md) are listed after daily logs.
 */
export function listMemoryFiles(baseDir: string): MemoryFileInfo[] {
  if (!existsSync(baseDir)) return [];

  try {
    const entries = readdirSync(baseDir);
    const files: MemoryFileInfo[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = join(baseDir, entry);
      try {
        const stats = statSync(filePath);
        if (stats.isFile()) {
          files.push({
            name: entry,
            size: stats.size,
            modified: stats.mtime,
          });
        }
      } catch {
        // Skip files we can't stat
      }
    }

    // Sort: daily logs by date descending, then other files
    return files.sort((a, b) => {
      const aIsDaily = isDailyLogFile(a.name);
      const bIsDaily = isDailyLogFile(b.name);

      if (aIsDaily && bIsDaily) {
        // Both daily logs: sort by filename descending (newer first)
        return b.name.localeCompare(a.name);
      }
      if (aIsDaily && !bIsDaily) return -1; // Daily logs first
      if (!aIsDaily && bIsDaily) return 1;
      // Both non-daily: alphabetical
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Format a Date to YYYY-MM-DD string.
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a Date to HH:MM string.
 */
export function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Check if a filename matches the daily log pattern (YYYY-MM-DD.md).
 */
export function isDailyLogFile(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(filename);
}
