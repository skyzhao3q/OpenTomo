/**
 * Memory Module - Episode Memory System
 *
 * Provides persistent memory tools for the AI agent:
 * - Daily episode logs (YYYY-MM-DD.md)
 * - Long-term core memory (MEMORY.md)
 * - Keyword search across all memories
 *
 * Two scopes: global (user-level) and workspace (project-level)
 */

export { createMemoryTools } from './tools.ts';
export {
  ensureMemoryDirectories,
  getGlobalMemoryDir,
  getWorkspaceMemoryDir,
  resolveMemoryPath,
  isValidMemoryPath,
  listMemoryFiles,
  getDailyLogPath,
  getLongTermMemoryPath,
  formatDate,
  formatTime,
  isDailyLogFile,
  type MemoryFileInfo,
} from './storage.ts';
