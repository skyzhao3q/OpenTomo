/**
 * Tests for memory storage layer
 *
 * Validates:
 * - Path resolution (virtual → real)
 * - Path validation (security: directory traversal prevention)
 * - Directory initialization
 * - File listing and sorting
 * - Date/time formatting
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  getGlobalMemoryDir,
  getWorkspaceMemoryDir,
  ensureMemoryDirectories,
  resolveMemoryPath,
  isValidMemoryPath,
  getDailyLogPath,
  getLongTermMemoryPath,
  listMemoryFiles,
  formatDate,
  formatTime,
  isDailyLogFile,
} from '../storage.ts';

// ============================================================
// Test setup
// ============================================================

let testDir: string;
let testWorkspaceRoot: string;

beforeEach(() => {
  testDir = join(tmpdir(), `memory-test-${randomUUID().slice(0, 8)}`);
  testWorkspaceRoot = join(testDir, 'workspace');
  mkdirSync(testWorkspaceRoot, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ============================================================
// isValidMemoryPath
// ============================================================

describe('isValidMemoryPath', () => {
  it('accepts /global/ paths', () => {
    expect(isValidMemoryPath('/global/')).toBe(true);
    expect(isValidMemoryPath('/global/MEMORY.md')).toBe(true);
    expect(isValidMemoryPath('/global/2026-02-14.md')).toBe(true);
  });

  it('accepts /workspace/ paths', () => {
    expect(isValidMemoryPath('/workspace/')).toBe(true);
    expect(isValidMemoryPath('/workspace/MEMORY.md')).toBe(true);
    expect(isValidMemoryPath('/workspace/2026-02-14.md')).toBe(true);
  });

  it('accepts bare /global and /workspace', () => {
    expect(isValidMemoryPath('/global')).toBe(true);
    expect(isValidMemoryPath('/workspace')).toBe(true);
  });

  it('rejects paths without valid prefix', () => {
    expect(isValidMemoryPath('/other/file.md')).toBe(false);
    expect(isValidMemoryPath('global/file.md')).toBe(false);
    expect(isValidMemoryPath('/GLOBAL/file.md')).toBe(false);
    expect(isValidMemoryPath('')).toBe(false);
    expect(isValidMemoryPath('/foo')).toBe(false);
  });

  it('rejects directory traversal', () => {
    expect(isValidMemoryPath('/global/../etc/passwd')).toBe(false);
    expect(isValidMemoryPath('/workspace/../../secret')).toBe(false);
    expect(isValidMemoryPath('/global/subdir/../../../etc')).toBe(false);
  });

  it('rejects null bytes', () => {
    expect(isValidMemoryPath('/global/file\0.md')).toBe(false);
  });
});

// ============================================================
// resolveMemoryPath
// ============================================================

describe('resolveMemoryPath', () => {
  it('resolves /global/ to global memory directory', () => {
    const result = resolveMemoryPath('/global/', testWorkspaceRoot);
    expect(result).toBe(getGlobalMemoryDir());
  });

  it('resolves /global to global memory directory', () => {
    const result = resolveMemoryPath('/global', testWorkspaceRoot);
    expect(result).toBe(getGlobalMemoryDir());
  });

  it('resolves /workspace/ to workspace memory directory', () => {
    const result = resolveMemoryPath('/workspace/', testWorkspaceRoot);
    expect(result).toBe(getWorkspaceMemoryDir(testWorkspaceRoot));
  });

  it('resolves /global/MEMORY.md to the correct file path', () => {
    const result = resolveMemoryPath('/global/MEMORY.md', testWorkspaceRoot);
    expect(result).toBe(join(getGlobalMemoryDir(), 'MEMORY.md'));
  });

  it('resolves /workspace/2026-02-14.md to the correct file path', () => {
    const result = resolveMemoryPath('/workspace/2026-02-14.md', testWorkspaceRoot);
    expect(result).toBe(join(getWorkspaceMemoryDir(testWorkspaceRoot), '2026-02-14.md'));
  });

  it('returns null for invalid paths', () => {
    expect(resolveMemoryPath('/other/file.md', testWorkspaceRoot)).toBeNull();
    expect(resolveMemoryPath('/global/../etc', testWorkspaceRoot)).toBeNull();
    expect(resolveMemoryPath('', testWorkspaceRoot)).toBeNull();
  });
});

// ============================================================
// ensureMemoryDirectories
// ============================================================

describe('ensureMemoryDirectories', () => {
  it('creates workspace memory directory', () => {
    const wsMemDir = getWorkspaceMemoryDir(testWorkspaceRoot);
    expect(existsSync(wsMemDir)).toBe(false);

    ensureMemoryDirectories(testWorkspaceRoot);

    expect(existsSync(wsMemDir)).toBe(true);
  });
});

// ============================================================
// getDailyLogPath
// ============================================================

describe('getDailyLogPath', () => {
  it('returns path with today date by default', () => {
    const baseDir = '/test/memory';
    const path = getDailyLogPath(baseDir);
    const today = formatDate(new Date());
    expect(path).toBe(join(baseDir, `${today}.md`));
  });

  it('returns path with specified date', () => {
    const baseDir = '/test/memory';
    const path = getDailyLogPath(baseDir, '2026-02-14');
    expect(path).toBe(join(baseDir, '2026-02-14.md'));
  });
});

// ============================================================
// getLongTermMemoryPath
// ============================================================

describe('getLongTermMemoryPath', () => {
  it('returns MEMORY.md path', () => {
    const baseDir = '/test/memory';
    const path = getLongTermMemoryPath(baseDir);
    expect(path).toBe(join(baseDir, 'MEMORY.md'));
  });
});

// ============================================================
// listMemoryFiles
// ============================================================

describe('listMemoryFiles', () => {
  it('returns empty array for non-existent directory', () => {
    const result = listMemoryFiles('/nonexistent/path');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty directory', () => {
    const memDir = join(testDir, 'empty-mem');
    mkdirSync(memDir, { recursive: true });
    const result = listMemoryFiles(memDir);
    expect(result).toEqual([]);
  });

  it('lists .md files and ignores non-.md files', () => {
    const memDir = join(testDir, 'mem');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, '2026-02-14.md'), 'content');
    writeFileSync(join(memDir, 'notes.txt'), 'ignore me');
    writeFileSync(join(memDir, 'MEMORY.md'), 'core');

    const result = listMemoryFiles(memDir);
    const names = result.map(f => f.name);
    expect(names).toContain('2026-02-14.md');
    expect(names).toContain('MEMORY.md');
    expect(names).not.toContain('notes.txt');
  });

  it('sorts daily logs by date descending (newest first)', () => {
    const memDir = join(testDir, 'sorted-mem');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, '2026-02-10.md'), 'older');
    writeFileSync(join(memDir, '2026-02-14.md'), 'newest');
    writeFileSync(join(memDir, '2026-02-12.md'), 'middle');

    const result = listMemoryFiles(memDir);
    const names = result.map(f => f.name);
    expect(names[0]).toBe('2026-02-14.md');
    expect(names[1]).toBe('2026-02-12.md');
    expect(names[2]).toBe('2026-02-10.md');
  });

  it('puts daily logs before non-daily files', () => {
    const memDir = join(testDir, 'mixed-mem');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'MEMORY.md'), 'core');
    writeFileSync(join(memDir, '2026-02-14.md'), 'daily');

    const result = listMemoryFiles(memDir);
    expect(result[0]!.name).toBe('2026-02-14.md');
    expect(result[1]!.name).toBe('MEMORY.md');
  });
});

// ============================================================
// formatDate
// ============================================================

describe('formatDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2026, 1, 14); // Feb 14, 2026
    expect(formatDate(date)).toBe('2026-02-14');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatDate(date)).toBe('2026-01-05');
  });
});

// ============================================================
// formatTime
// ============================================================

describe('formatTime', () => {
  it('formats time as HH:MM', () => {
    const date = new Date(2026, 1, 14, 14, 30);
    expect(formatTime(date)).toBe('14:30');
  });

  it('pads single-digit hours and minutes', () => {
    const date = new Date(2026, 1, 14, 9, 5);
    expect(formatTime(date)).toBe('09:05');
  });
});

// ============================================================
// isDailyLogFile
// ============================================================

describe('isDailyLogFile', () => {
  it('matches YYYY-MM-DD.md pattern', () => {
    expect(isDailyLogFile('2026-02-14.md')).toBe(true);
    expect(isDailyLogFile('2025-12-31.md')).toBe(true);
  });

  it('rejects non-matching filenames', () => {
    expect(isDailyLogFile('MEMORY.md')).toBe(false);
    expect(isDailyLogFile('notes.md')).toBe(false);
    expect(isDailyLogFile('2026-2-14.md')).toBe(false); // not zero-padded
    expect(isDailyLogFile('2026-02-14.txt')).toBe(false);
  });
});
