/**
 * Tests for saveCommand and the full create-load-delete cycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveCommand, loadCommand, loadAllCommands, deleteCommand } from '../storage.ts';

describe('saveCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary "workspace" directory
    tempDir = mkdtempSync(join(tmpdir(), 'cmd-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a .md file with YAML frontmatter and body', () => {
    const result = saveCommand(tempDir, 'clean-folder', {
      name: 'Clean Folder',
      description: 'Organize files in the folder',
    }, 'Please clean up this folder');

    expect(result.slug).toBe('clean-folder');
    expect(result.metadata.name).toBe('Clean Folder');
    expect(result.metadata.description).toBe('Organize files in the folder');
    expect(result.content).toBe('Please clean up this folder');

    // Verify the file was actually written
    const filePath = join(tempDir, 'commands', 'clean-folder.md');
    expect(existsSync(filePath)).toBe(true);

    // Verify file content has YAML frontmatter
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toContain('name: Clean Folder');
    expect(fileContent).toContain('description: Organize files in the folder');
    expect(fileContent).toContain('Please clean up this folder');
  });

  it('creates commands directory if it does not exist', () => {
    const commandsDir = join(tempDir, 'commands');
    expect(existsSync(commandsDir)).toBe(false);

    saveCommand(tempDir, 'test', { name: 'Test', description: 'Test desc' }, 'Test prompt');

    expect(existsSync(commandsDir)).toBe(true);
  });

  it('saved command can be loaded back with loadCommand', () => {
    saveCommand(tempDir, 'my-cmd', {
      name: 'My Command',
      description: 'A test command',
    }, 'Do something useful');

    const loaded = loadCommand(tempDir, 'my-cmd');
    expect(loaded).not.toBeNull();
    expect(loaded!.slug).toBe('my-cmd');
    expect(loaded!.metadata.name).toBe('My Command');
    expect(loaded!.metadata.description).toBe('A test command');
    expect(loaded!.content.trim()).toBe('Do something useful');
  });

  it('saved command appears in loadAllCommands', () => {
    saveCommand(tempDir, 'cmd-a', { name: 'A', description: 'Desc A' }, 'Prompt A');
    saveCommand(tempDir, 'cmd-b', { name: 'B', description: 'Desc B' }, 'Prompt B');

    const all = loadAllCommands(tempDir);
    expect(all.length).toBe(2);

    const slugs = all.map(c => c.slug).sort();
    expect(slugs).toEqual(['cmd-a', 'cmd-b']);
  });

  it('saved command can be deleted', () => {
    saveCommand(tempDir, 'to-delete', { name: 'Delete Me', description: 'Will be deleted' }, 'Bye');

    expect(loadCommand(tempDir, 'to-delete')).not.toBeNull();

    const deleted = deleteCommand(tempDir, 'to-delete');
    expect(deleted).toBe(true);
    expect(loadCommand(tempDir, 'to-delete')).toBeNull();
  });

  it('handles Unicode slugs (Japanese name)', () => {
    const result = saveCommand(tempDir, 'フォルダ整理', {
      name: 'フォルダ整理',
      description: 'フォルダ内の不要ファイルを整理する',
    }, 'このフォルダをきれいに整理して');

    expect(result.slug).toBe('フォルダ整理');

    // Verify it can be loaded back
    const loaded = loadCommand(tempDir, 'フォルダ整理');
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.name).toBe('フォルダ整理');
    expect(loaded!.content.trim()).toBe('このフォルダをきれいに整理して');
  });

  it('overwrites existing command with same slug', () => {
    saveCommand(tempDir, 'update-me', { name: 'V1', description: 'Version 1' }, 'Old prompt');
    saveCommand(tempDir, 'update-me', { name: 'V2', description: 'Version 2' }, 'New prompt');

    const loaded = loadCommand(tempDir, 'update-me');
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.name).toBe('V2');
    expect(loaded!.content.trim()).toBe('New prompt');

    // Should still be just one command
    const all = loadAllCommands(tempDir);
    expect(all.length).toBe(1);
  });
});
