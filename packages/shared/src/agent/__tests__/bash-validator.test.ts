/**
 * Regression tests for bash-validator.ts
 *
 * Verifies AST-based bash command validation used in Safe (Explore) mode.
 * Tests compound commands, redirects, command expansions, and background execution.
 */
import { describe, it, expect } from 'bun:test';
import { validateBashCommand, hasControlCharacters } from '../bash-validator.ts';
import type { CompiledBashPattern } from '../mode-types.ts';

// ============================================================
// Test pattern set (mirrors default.json patterns)
// ============================================================

const TEST_PATTERNS: CompiledBashPattern[] = [
  { regex: /^ls\b/, source: '^ls\\b', comment: 'list files' },
  { regex: /^cat\b/, source: '^cat\\b', comment: 'cat file' },
  { regex: /^echo\b/, source: '^echo\\b', comment: 'echo' },
  { regex: /^git\s+status\b/, source: '^git\\s+status\\b', comment: 'git status' },
  { regex: /^git\s+log\b/, source: '^git\\s+log\\b', comment: 'git log' },
  { regex: /^git\s+diff\b/, source: '^git\\s+diff\\b', comment: 'git diff' },
];

// ============================================================
// validateBashCommand — basic allow/block
// ============================================================

describe('validateBashCommand - basic', () => {
  it('allows a whitelisted command', () => {
    const result = validateBashCommand('ls -la', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });

  it('blocks a non-whitelisted command', () => {
    const result = validateBashCommand('rm -rf /', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('unsafe_command');
  });

  it('allows cat command', () => {
    const result = validateBashCommand('cat file.txt', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });

  it('blocks curl (not in whitelist)', () => {
    const result = validateBashCommand('curl https://example.com', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
  });

  it('blocks sudo', () => {
    const result = validateBashCommand('sudo rm -rf /', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
  });
});

// ============================================================
// validateBashCommand — compound commands (&&, ||)
// ============================================================

describe('validateBashCommand - compound commands', () => {
  it('allows && when both sides are whitelisted', () => {
    const result = validateBashCommand('git status && git log', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });

  it('blocks && when right side is not whitelisted', () => {
    const result = validateBashCommand('git status && rm -rf /', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
  });

  it('blocks && when left side is not whitelisted', () => {
    const result = validateBashCommand('rm -rf / && git status', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
  });

  it('allows multiple && chained safe commands', () => {
    const result = validateBashCommand('git status && git log && git diff', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// validateBashCommand — redirects
// ============================================================

describe('validateBashCommand - redirects', () => {
  it('blocks output redirect >', () => {
    const result = validateBashCommand('cat file > output.txt', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('redirect');
  });

  it('blocks append redirect >>', () => {
    const result = validateBashCommand('echo hello >> log.txt', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('redirect');
  });

  it('allows redirect to /dev/null', () => {
    const result = validateBashCommand('cat file > /dev/null', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });

  it('allows stderr redirect to /dev/null', () => {
    const result = validateBashCommand('cat file 2>/dev/null', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });

  it('allows fd duplication 2>&1', () => {
    const result = validateBashCommand('cat file 2>&1', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });

  it('allows input redirect <', () => {
    const result = validateBashCommand('cat < file.txt', TEST_PATTERNS);
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// validateBashCommand — command expansion
// ============================================================

describe('validateBashCommand - command expansion', () => {
  it('blocks $(...) substitution', () => {
    const result = validateBashCommand('ls $(echo /tmp)', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('command_expansion');
  });

  it('blocks nested command substitution', () => {
    const result = validateBashCommand('echo $(cat /etc/passwd)', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('command_expansion');
  });
});

// ============================================================
// validateBashCommand — background execution
// ============================================================

describe('validateBashCommand - background execution', () => {
  it('blocks & background operator', () => {
    const result = validateBashCommand('echo hello &', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('background_execution');
  });
});

// ============================================================
// validateBashCommand — pipelines
// ============================================================

describe('validateBashCommand - pipelines', () => {
  it('allows pipeline when all commands are whitelisted', () => {
    const pipePatterns: CompiledBashPattern[] = [
      ...TEST_PATTERNS,
      { regex: /^head\b/, source: '^head\\b', comment: 'head' },
      { regex: /^grep\b/, source: '^grep\\b', comment: 'grep' },
    ];
    const result = validateBashCommand('cat file.txt | grep foo', pipePatterns);
    expect(result.allowed).toBe(true);
  });

  it('blocks pipeline when any command is not whitelisted', () => {
    const result = validateBashCommand('cat file.txt | rm -rf', TEST_PATTERNS);
    expect(result.allowed).toBe(false);
  });
});

// ============================================================
// hasControlCharacters
// ============================================================

describe('hasControlCharacters', () => {
  it('returns null for a normal command', () => {
    expect(hasControlCharacters('ls -la /tmp')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(hasControlCharacters('')).toBeNull();
  });

  it('returns null for command with spaces and flags', () => {
    expect(hasControlCharacters('git log --oneline -n 10')).toBeNull();
  });

  it('detects null byte \\x00', () => {
    const result = hasControlCharacters('cmd\x00arg');
    expect(result).not.toBeNull();
    expect(result!.char).toBe('\\0');
    expect(result!.explanation.length).toBeGreaterThan(0);
  });

  it('returns null for newlines (handled by AST parser)', () => {
    // Newlines are intentionally allowed at this level — bash-parser handles them
    expect(hasControlCharacters('cmd\nother')).toBeNull();
  });
});
