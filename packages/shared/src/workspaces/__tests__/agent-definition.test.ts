/**
 * Tests for workspace-level Agent Definition feature.
 *
 * Two test cases:
 *   Case 1: No agent definition (preserves existing behavior)
 *   Case 2: With agent definition (new opt-in functionality)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import {
  hasWorkspaceAgentInstructions,
  loadWorkspaceAgentInstructions,
  saveWorkspaceAgentInstructions,
  deleteWorkspaceAgentInstructions,
  saveWorkspaceConfig,
} from '../storage.ts';
import type { WorkspaceConfig } from '../types.ts';
import { getWorkspaceAgentPrompt } from '../../prompts/system.ts';

// ============================================================
// Helpers
// ============================================================

/** Create a minimal workspace config for testing */
function createTestConfig(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    id: `ws_test_${randomUUID().slice(0, 8)}`,
    name: 'Test Workspace',
    slug: 'test-workspace',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Create a temporary workspace directory with config.json */
function createTempWorkspace(config?: WorkspaceConfig): string {
  const rootPath = join(tmpdir(), `ss-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(rootPath, { recursive: true });
  saveWorkspaceConfig(rootPath, config ?? createTestConfig());
  return rootPath;
}

// ============================================================
// Test Case 1: Agent 定義なし（既存動作の保持）
// ============================================================

describe('Case 1: No agent definition (existing behavior preserved)', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = createTempWorkspace();
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('1-1: hasWorkspaceAgentInstructions() returns false when no AGENT.md', () => {
    expect(hasWorkspaceAgentInstructions(workspacePath)).toBe(false);
  });

  it('1-2: loadWorkspaceAgentInstructions() returns null when no AGENT.md', () => {
    expect(loadWorkspaceAgentInstructions(workspacePath)).toBeNull();
  });

  it('1-3: getWorkspaceAgentPrompt() returns empty string when no agent config and no AGENT.md', async () => {
    expect(await getWorkspaceAgentPrompt(workspacePath)).toBe('');
  });

  it('1-4: getWorkspaceAgentPrompt() returns empty string when workspaceRootPath is undefined', async () => {
    expect(await getWorkspaceAgentPrompt(undefined)).toBe('');
  });

  it('1-5: deleteWorkspaceAgentInstructions() returns false when no AGENT.md exists', () => {
    expect(deleteWorkspaceAgentInstructions(workspacePath)).toBe(false);
  });
});

// ============================================================
// Test Case 2: Agent 定義あり
// ============================================================

describe('Case 2: With agent definition', () => {
  let workspacePath: string;

  afterEach(() => {
    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  // --- AGENT.md storage operations ---

  it('2-1: hasWorkspaceAgentInstructions() returns true when AGENT.md exists', () => {
    workspacePath = createTempWorkspace();
    writeFileSync(join(workspacePath, 'AGENT.md'), '# Test Agent');

    expect(hasWorkspaceAgentInstructions(workspacePath)).toBe(true);
  });

  it('2-2: loadWorkspaceAgentInstructions() returns file content', () => {
    workspacePath = createTempWorkspace();
    const content = '# DevOps Agent\n\nYou are a DevOps specialist.';
    writeFileSync(join(workspacePath, 'AGENT.md'), content);

    expect(loadWorkspaceAgentInstructions(workspacePath)).toBe(content);
  });

  it('2-3: loadWorkspaceAgentInstructions() truncates content over 20KB', () => {
    workspacePath = createTempWorkspace();
    const largeContent = 'A'.repeat(25 * 1024); // 25KB
    writeFileSync(join(workspacePath, 'AGENT.md'), largeContent);

    const result = loadWorkspaceAgentInstructions(workspacePath);
    expect(result).not.toBeNull();
    expect(result!.endsWith('... (truncated)')).toBe(true);
    expect(result!.length).toBeLessThan(largeContent.length);
  });

  it('2-4: loadWorkspaceAgentInstructions() returns null for empty file', () => {
    workspacePath = createTempWorkspace();
    writeFileSync(join(workspacePath, 'AGENT.md'), '');

    expect(loadWorkspaceAgentInstructions(workspacePath)).toBeNull();
  });

  it('2-5: loadWorkspaceAgentInstructions() returns null for whitespace-only file', () => {
    workspacePath = createTempWorkspace();
    writeFileSync(join(workspacePath, 'AGENT.md'), '   \n\n  ');

    expect(loadWorkspaceAgentInstructions(workspacePath)).toBeNull();
  });

  // --- getWorkspaceAgentPrompt combinations ---

  it('2-6: getWorkspaceAgentPrompt() includes both config.agent and AGENT.md', async () => {
    const config = createTestConfig({
      agent: { name: 'DevOps Bot', description: 'AWS infrastructure specialist' },
    });
    workspacePath = createTempWorkspace(config);
    writeFileSync(join(workspacePath, 'AGENT.md'), '## Guidelines\n\n- Use Terraform');

    const result = await getWorkspaceAgentPrompt(workspacePath);
    expect(result).toContain('DevOps Bot');
    expect(result).toContain('AWS infrastructure specialist');
    expect(result).toContain('Use Terraform');
  });

  it('2-7: getWorkspaceAgentPrompt() works with config.agent only (no AGENT.md)', async () => {
    const config = createTestConfig({
      agent: { name: 'Code Reviewer', description: 'Reviews pull requests' },
    });
    workspacePath = createTempWorkspace(config);

    const result = await getWorkspaceAgentPrompt(workspacePath);
    expect(result).toContain('Code Reviewer');
    expect(result).toContain('Reviews pull requests');
    expect(result).not.toContain('Workspace-Specific Instructions');
  });

  it('2-8: getWorkspaceAgentPrompt() works with AGENT.md only (no config.agent)', async () => {
    workspacePath = createTempWorkspace(); // no agent in config
    writeFileSync(join(workspacePath, 'AGENT.md'), '## Role\n\nYou are a data analyst.');

    const result = await getWorkspaceAgentPrompt(workspacePath);
    expect(result).toContain('You are a data analyst.');
    expect(result).not.toContain('Agent Name');
  });

  // --- save/delete round-trip ---

  it('2-9: saveWorkspaceAgentInstructions() + loadWorkspaceAgentInstructions() round-trip', () => {
    workspacePath = createTempWorkspace();
    const content = '# Research Agent\n\nSpecializes in academic research.';

    saveWorkspaceAgentInstructions(workspacePath, content);

    expect(hasWorkspaceAgentInstructions(workspacePath)).toBe(true);
    expect(loadWorkspaceAgentInstructions(workspacePath)).toBe(content);
  });

  it('2-10: deleteWorkspaceAgentInstructions() removes file and returns true', () => {
    workspacePath = createTempWorkspace();
    writeFileSync(join(workspacePath, 'AGENT.md'), '# Agent');

    expect(deleteWorkspaceAgentInstructions(workspacePath)).toBe(true);
    expect(existsSync(join(workspacePath, 'AGENT.md'))).toBe(false);
    expect(hasWorkspaceAgentInstructions(workspacePath)).toBe(false);
  });
});
