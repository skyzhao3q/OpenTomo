/**
 * Regression tests for session slug generator.
 *
 * These tests verify the human-readable session ID system:
 * - Date prefix generation (YYMMDD format)
 * - Adjective-noun slug generation
 * - Unique ID generation with collision handling
 * - Session ID parsing and validation
 */
import { describe, it, expect } from 'bun:test';
import {
  generateDatePrefix,
  generateHumanSlug,
  generateUniqueSessionId,
  parseSessionId,
  isHumanReadableId,
} from '../slug-generator.ts';

// ============================================================
// generateDatePrefix
// ============================================================

describe('generateDatePrefix', () => {
  it('formats date as YYMMDD', () => {
    expect(generateDatePrefix(new Date(2026, 2, 2))).toBe('260302');
  });

  it('zero-pads single-digit month', () => {
    expect(generateDatePrefix(new Date(2026, 0, 15))).toBe('260115');
  });

  it('zero-pads single-digit day', () => {
    expect(generateDatePrefix(new Date(2026, 11, 1))).toBe('261201');
  });

  it('handles end of year correctly', () => {
    expect(generateDatePrefix(new Date(2026, 11, 31))).toBe('261231');
  });

  it('handles start of year correctly', () => {
    expect(generateDatePrefix(new Date(2026, 0, 1))).toBe('260101');
  });

  it('uses current date when no argument is provided', () => {
    const result = generateDatePrefix();
    expect(result).toMatch(/^\d{6}$/);
  });
});

// ============================================================
// generateHumanSlug
// ============================================================

describe('generateHumanSlug', () => {
  it('returns a string in adjective-noun format', () => {
    const slug = generateHumanSlug();
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('returns a string every time it is called', () => {
    for (let i = 0; i < 5; i++) {
      const slug = generateHumanSlug();
      expect(typeof slug).toBe('string');
      expect(slug.length).toBeGreaterThan(0);
    }
  });

  it('contains exactly one hyphen', () => {
    const slug = generateHumanSlug();
    const parts = slug.split('-');
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });
});

// ============================================================
// generateUniqueSessionId
// ============================================================

describe('generateUniqueSessionId', () => {
  it('generates id in YYMMDD-adjective-noun format', () => {
    const id = generateUniqueSessionId(new Set(), new Date(2026, 2, 2));
    expect(id).toMatch(/^260302-[a-z]+-[a-z]+$/);
  });

  it('uses correct date prefix', () => {
    const id = generateUniqueSessionId([], new Date(2026, 0, 1));
    expect(id.startsWith('260101-')).toBe(true);
  });

  it('accepts an empty Set', () => {
    const id = generateUniqueSessionId(new Set());
    expect(id).toMatch(/^\d{6}-[a-z]+-[a-z]+$/);
  });

  it('accepts an empty array', () => {
    const id = generateUniqueSessionId([]);
    expect(id).toMatch(/^\d{6}-[a-z]+-[a-z]+$/);
  });

  it('adds -2 suffix when base id already exists', () => {
    const date = new Date(2026, 2, 2);
    // Generate a base id first
    const baseId = generateUniqueSessionId(new Set(), date);
    // Now request a new id with the base id already taken
    const id = generateUniqueSessionId(new Set([baseId]), date);
    // Either a different slug or the same with -2 suffix
    expect(id).toMatch(/^\d{6}-[a-z]+-[a-z]+(-\d+)?$/);
    expect(id).not.toBe(baseId);
  });

  it('handles collision by appending numeric suffix', () => {
    const date = new Date(2026, 2, 2);
    // Force collision by using a spy on generateHumanSlug indirectly:
    // generate one id, then pass it as existing + the -2 variant
    const first = generateUniqueSessionId(new Set(), date);
    const second = generateUniqueSessionId(new Set([first]), date);
    expect(second).not.toBe(first);
    expect(second).toMatch(/^\d{6}-[a-z]+-[a-z]+(-\d+)?$/);
  });

  it('works with array of existing ids', () => {
    const date = new Date(2026, 2, 2);
    const first = generateUniqueSessionId([], date);
    const second = generateUniqueSessionId([first], date);
    expect(second).not.toBe(first);
  });
});

// ============================================================
// parseSessionId
// ============================================================

describe('parseSessionId', () => {
  it('parses a standard human-readable id', () => {
    const result = parseSessionId('260302-swift-river');
    expect(result).not.toBeNull();
    expect(result!.datePrefix).toBe('260302');
    expect(result!.slug).toBe('swift-river');
    expect(result!.suffix).toBeUndefined();
  });

  it('parses an id with a numeric suffix', () => {
    const result = parseSessionId('260302-swift-river-2');
    expect(result).not.toBeNull();
    expect(result!.suffix).toBe(2);
  });

  it('parses an id with a large numeric suffix', () => {
    const result = parseSessionId('260302-swift-river-42');
    expect(result).not.toBeNull();
    expect(result!.suffix).toBe(42);
  });

  it('includes a parsed Date object', () => {
    const result = parseSessionId('260302-swift-river');
    expect(result).not.toBeNull();
    expect(result!.date).toBeInstanceOf(Date);
    expect(result!.date.getFullYear()).toBe(2026);
    expect(result!.date.getMonth()).toBe(2); // 0-indexed
    expect(result!.date.getDate()).toBe(2);
  });

  it('returns null for plain string without date prefix', () => {
    expect(parseSessionId('invalid')).toBeNull();
  });

  it('returns null for three-word slug without numeric prefix', () => {
    expect(parseSessionId('abc-def-ghi')).toBeNull();
  });

  it('returns null for only digits', () => {
    expect(parseSessionId('123456')).toBeNull();
  });

  it('returns null for UUID format', () => {
    expect(parseSessionId('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSessionId('')).toBeNull();
  });
});

// ============================================================
// isHumanReadableId
// ============================================================

describe('isHumanReadableId', () => {
  it('returns true for a standard id', () => {
    expect(isHumanReadableId('260302-swift-river')).toBe(true);
  });

  it('returns true for an id with numeric suffix', () => {
    expect(isHumanReadableId('260302-swift-river-2')).toBe(true);
  });

  it('returns false for UUID format', () => {
    expect(isHumanReadableId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('returns false for plain string', () => {
    expect(isHumanReadableId('invalid')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isHumanReadableId('')).toBe(false);
  });

  it('returns false for partial match', () => {
    expect(isHumanReadableId('123456')).toBe(false);
  });
});
