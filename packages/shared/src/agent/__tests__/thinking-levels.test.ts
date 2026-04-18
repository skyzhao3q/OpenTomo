/**
 * Regression tests for thinking-levels.ts
 *
 * Verifies the three-tier thinking token budget system:
 * - off / think / max levels per model family
 * - Haiku gets a smaller budget than sonnet/opus
 * - isValidThinkingLevel guards against invalid input
 */
import { describe, it, expect } from 'bun:test';
import {
  getThinkingTokens,
  isValidThinkingLevel,
  getThinkingLevelName,
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVELS,
} from '../thinking-levels.ts';

// ============================================================
// getThinkingTokens
// ============================================================

describe('getThinkingTokens', () => {
  describe('off level always returns 0', () => {
    it('haiku', () => {
      expect(getThinkingTokens('off', 'claude-haiku-4-5-20251001')).toBe(0);
    });
    it('sonnet', () => {
      expect(getThinkingTokens('off', 'claude-sonnet-4-6')).toBe(0);
    });
    it('opus', () => {
      expect(getThinkingTokens('off', 'claude-opus-4-6')).toBe(0);
    });
  });

  describe('haiku model (smaller budget)', () => {
    it('think level → 4000', () => {
      expect(getThinkingTokens('think', 'claude-haiku-4-5-20251001')).toBe(4_000);
    });
    it('max level → 8000', () => {
      expect(getThinkingTokens('max', 'claude-haiku-4-5-20251001')).toBe(8_000);
    });
    it('haiku short id', () => {
      expect(getThinkingTokens('think', 'claude-haiku-4-5')).toBe(4_000);
    });
    it('case-insensitive haiku detection', () => {
      expect(getThinkingTokens('think', 'CLAUDE-HAIKU-4-5')).toBe(4_000);
    });
  });

  describe('non-haiku models (default budget)', () => {
    it('sonnet think → 10000', () => {
      expect(getThinkingTokens('think', 'claude-sonnet-4-6')).toBe(10_000);
    });
    it('sonnet max → 32000', () => {
      expect(getThinkingTokens('max', 'claude-sonnet-4-6')).toBe(32_000);
    });
    it('opus think → 10000', () => {
      expect(getThinkingTokens('think', 'claude-opus-4-6')).toBe(10_000);
    });
    it('opus max → 32000', () => {
      expect(getThinkingTokens('max', 'claude-opus-4-6')).toBe(32_000);
    });
    it('proxy-prefixed sonnet', () => {
      expect(getThinkingTokens('think', 'anthropic/claude-sonnet-4.6')).toBe(10_000);
    });
  });
});

// ============================================================
// isValidThinkingLevel
// ============================================================

describe('isValidThinkingLevel', () => {
  it('accepts "off"', () => {
    expect(isValidThinkingLevel('off')).toBe(true);
  });
  it('accepts "think"', () => {
    expect(isValidThinkingLevel('think')).toBe(true);
  });
  it('accepts "max"', () => {
    expect(isValidThinkingLevel('max')).toBe(true);
  });

  it('rejects "none"', () => {
    expect(isValidThinkingLevel('none')).toBe(false);
  });
  it('rejects "slow"', () => {
    expect(isValidThinkingLevel('slow')).toBe(false);
  });
  it('rejects "fast"', () => {
    expect(isValidThinkingLevel('fast')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(isValidThinkingLevel('')).toBe(false);
  });
  it('rejects null', () => {
    expect(isValidThinkingLevel(null)).toBe(false);
  });
  it('rejects undefined', () => {
    expect(isValidThinkingLevel(undefined)).toBe(false);
  });
  it('rejects number', () => {
    expect(isValidThinkingLevel(0)).toBe(false);
  });
  it('rejects uppercase "OFF"', () => {
    expect(isValidThinkingLevel('OFF')).toBe(false);
  });
  it('rejects uppercase "THINK"', () => {
    expect(isValidThinkingLevel('THINK')).toBe(false);
  });
});

// ============================================================
// getThinkingLevelName
// ============================================================

describe('getThinkingLevelName', () => {
  it('"off" → "No Thinking"', () => {
    expect(getThinkingLevelName('off')).toBe('No Thinking');
  });
  it('"think" → "Thinking"', () => {
    expect(getThinkingLevelName('think')).toBe('Thinking');
  });
  it('"max" → "Max Thinking"', () => {
    expect(getThinkingLevelName('max')).toBe('Max Thinking');
  });
  it('unknown value falls back to the value itself', () => {
    expect(getThinkingLevelName('unknown' as never)).toBe('unknown');
  });
});

// ============================================================
// Constants
// ============================================================

describe('DEFAULT_THINKING_LEVEL', () => {
  it('is a valid ThinkingLevel', () => {
    expect(isValidThinkingLevel(DEFAULT_THINKING_LEVEL)).toBe(true);
  });
});

describe('THINKING_LEVELS', () => {
  it('contains exactly 3 levels', () => {
    expect(THINKING_LEVELS.length).toBe(3);
  });
  it('ids match the valid levels', () => {
    const ids = THINKING_LEVELS.map(l => l.id);
    expect(ids).toContain('off');
    expect(ids).toContain('think');
    expect(ids).toContain('max');
  });
  it('every level has name and description', () => {
    for (const level of THINKING_LEVELS) {
      expect(typeof level.name).toBe('string');
      expect(level.name.length).toBeGreaterThan(0);
      expect(typeof level.description).toBe('string');
    }
  });
});
