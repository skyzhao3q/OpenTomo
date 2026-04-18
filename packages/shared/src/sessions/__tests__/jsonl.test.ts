/**
 * Regression tests for JSONL session storage helpers.
 *
 * Tests the core read/write primitives:
 * - createSessionHeader: derives header fields from a StoredSession
 * - readSessionHeader: reads the first line of a .jsonl file
 * - readSessionJsonl: reads header + all messages from a .jsonl file
 * - readSessionMessages: resilient parsing (skips corrupted lines)
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  createSessionHeader,
  readSessionHeader,
  readSessionJsonl,
  readSessionMessages,
  writeSessionJsonl,
} from '../jsonl.ts';
import type { StoredSession } from '../types.ts';

// ============================================================
// Test helpers
// ============================================================

const TMP = tmpdir();
const tmpFiles: string[] = [];

function tmpFile(): string {
  const path = join(TMP, `opentomo-test-${randomUUID()}.jsonl`);
  tmpFiles.push(path);
  return path;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    try { if (existsSync(f + '.tmp')) unlinkSync(f + '.tmp'); } catch { /* ignore */ }
  }
});

function makeSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: '260302-test-session',
    workspaceRootPath: '/tmp/test-workspace',
    createdAt: 1000000,
    lastUsedAt: 1000001,
    messages: [],
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      contextTokens: 5,
      costUsd: 0.001,
    },
    ...overrides,
  };
}

// ============================================================
// createSessionHeader
// ============================================================

describe('createSessionHeader', () => {
  it('copies id from session', () => {
    const session = makeSession({ id: '260302-swift-river' });
    const header = createSessionHeader(session);
    expect(header.id).toBe('260302-swift-river');
  });

  it('copies createdAt from session', () => {
    const session = makeSession({ createdAt: 9999999 });
    const header = createSessionHeader(session);
    expect(header.createdAt).toBe(9999999);
  });

  it('sets messageCount to messages.length', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: 'hello', timestamp: 1 },
        { id: 'm2', type: 'assistant', content: 'hi', timestamp: 2 },
      ] as StoredSession['messages'],
    });
    const header = createSessionHeader(session);
    expect(header.messageCount).toBe(2);
  });

  it('sets messageCount to 0 for empty messages', () => {
    const session = makeSession({ messages: [] });
    const header = createSessionHeader(session);
    expect(header.messageCount).toBe(0);
  });

  it('extracts preview from first user message', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: 'Hello world', timestamp: 1 },
      ] as StoredSession['messages'],
    });
    const header = createSessionHeader(session);
    expect(header.preview).toBe('Hello world');
  });

  it('sets preview to undefined when no messages', () => {
    const session = makeSession({ messages: [] });
    const header = createSessionHeader(session);
    expect(header.preview).toBeUndefined();
  });

  it('truncates preview to 150 chars', () => {
    const longContent = 'a'.repeat(200);
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: longContent, timestamp: 1 },
      ] as StoredSession['messages'],
    });
    const header = createSessionHeader(session);
    expect(header.preview!.length).toBeLessThanOrEqual(150);
  });

  it('copies tokenUsage from session', () => {
    const session = makeSession({
      tokenUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300, contextTokens: 50, costUsd: 0.01 },
    });
    const header = createSessionHeader(session);
    expect(header.tokenUsage.inputTokens).toBe(100);
    expect(header.tokenUsage.outputTokens).toBe(200);
  });

  it('strips XML tags from preview', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: '<edit_request>stuff</edit_request>Clean text', timestamp: 1 },
      ] as StoredSession['messages'],
    });
    const header = createSessionHeader(session);
    expect(header.preview).not.toContain('<edit_request>');
    expect(header.preview).toContain('Clean text');
  });
});

// ============================================================
// readSessionHeader
// ============================================================

describe('readSessionHeader', () => {
  it('reads header from valid jsonl file', () => {
    const session = makeSession({ id: '260302-read-header' });
    const file = tmpFile();
    writeSessionJsonl(file, session);

    const header = readSessionHeader(file);
    expect(header).not.toBeNull();
    expect(header!.id).toBe('260302-read-header');
  });

  it('returns null for nonexistent file', () => {
    const result = readSessionHeader('/nonexistent/path/session.jsonl');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON content', () => {
    const file = tmpFile();
    writeFileSync(file, 'not valid json\n');
    const result = readSessionHeader(file);
    expect(result).toBeNull();
  });

  it('returns null for empty file', () => {
    const file = tmpFile();
    writeFileSync(file, '');
    const result = readSessionHeader(file);
    expect(result).toBeNull();
  });
});

// ============================================================
// readSessionJsonl
// ============================================================

describe('readSessionJsonl', () => {
  it('reads header and messages from valid file', () => {
    const session = makeSession({
      id: '260302-full-read',
      messages: [
        { id: 'm1', type: 'user', content: 'hello', timestamp: 1 },
        { id: 'm2', type: 'assistant', content: 'hi', timestamp: 2 },
      ] as StoredSession['messages'],
    });
    const file = tmpFile();
    writeSessionJsonl(file, session);

    const result = readSessionJsonl(file);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('260302-full-read');
    expect(result!.messages.length).toBe(2);
  });

  it('returns null for nonexistent file', () => {
    expect(readSessionJsonl('/nonexistent/session.jsonl')).toBeNull();
  });

  it('returns null for invalid JSON header', () => {
    const file = tmpFile();
    writeFileSync(file, 'invalid json\n{"id":"m1"}\n');
    expect(readSessionJsonl(file)).toBeNull();
  });

  it('skips corrupted message lines and keeps valid ones', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: 'valid message', timestamp: 1 },
      ] as StoredSession['messages'],
    });
    const file = tmpFile();
    writeSessionJsonl(file, session);

    // Append a corrupted line after the valid content
    const existing = require('fs').readFileSync(file, 'utf-8');
    writeFileSync(file, existing + 'CORRUPTED_LINE\n');

    const result = readSessionJsonl(file);
    expect(result).not.toBeNull();
    // The valid message should still be present
    expect(result!.messages.length).toBe(1);
    expect(result!.messages[0]!.id).toBe('m1');
  });
});

// ============================================================
// readSessionMessages
// ============================================================

describe('readSessionMessages', () => {
  it('returns messages from valid file', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: 'hello', timestamp: 1 },
        { id: 'm2', type: 'assistant', content: 'hi', timestamp: 2 },
      ] as StoredSession['messages'],
    });
    const file = tmpFile();
    writeSessionJsonl(file, session);

    const messages = readSessionMessages(file);
    expect(messages.length).toBe(2);
  });

  it('returns empty array for nonexistent file', () => {
    expect(readSessionMessages('/nonexistent/session.jsonl')).toEqual([]);
  });

  it('skips corrupted lines', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', type: 'user', content: 'hello', timestamp: 1 },
      ] as StoredSession['messages'],
    });
    const file = tmpFile();
    writeSessionJsonl(file, session);
    const existing = require('fs').readFileSync(file, 'utf-8');
    writeFileSync(file, existing + 'BAD_JSON\n');

    const messages = readSessionMessages(file);
    expect(messages.length).toBe(1);
    expect(messages[0]!.id).toBe('m1');
  });
});
