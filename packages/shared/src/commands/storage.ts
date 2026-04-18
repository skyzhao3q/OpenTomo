/**
 * Commands Storage
 *
 * CRUD operations for workspace commands.
 * Commands are stored as flat .md files in {workspace}/commands/{slug}.md
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'fs';
import { join, basename } from 'path';
import matter from 'gray-matter';
import type { LoadedCommand, CommandMetadata } from './types.ts';
import { getWorkspaceCommandsPath } from '../workspaces/storage.ts';

// ============================================================
// Parsing
// ============================================================

/**
 * Parse a command .md file content and extract frontmatter + body
 */
export function parseCommandFile(content: string): { metadata: CommandMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single command from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Command file name without extension
 */
export function loadCommand(workspaceRoot: string, slug: string): LoadedCommand | null {
  const commandsDir = getWorkspaceCommandsPath(workspaceRoot);
  const commandFile = join(commandsDir, `${slug}.md`);

  if (!existsSync(commandFile)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(commandFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseCommandFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    path: commandFile,
  };
}

/**
 * Load all commands from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadAllCommands(workspaceRoot: string): LoadedCommand[] {
  const commandsDir = getWorkspaceCommandsPath(workspaceRoot);

  if (!existsSync(commandsDir)) {
    return [];
  }

  const commands: LoadedCommand[] = [];

  try {
    const entries = readdirSync(commandsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const slug = basename(entry.name, '.md');
      const command = loadCommand(workspaceRoot, slug);
      if (command) {
        commands.push(command);
      }
    }
  } catch {
    // Ignore errors reading commands directory
  }

  return commands;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a command from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Command file name without extension
 */
export function deleteCommand(workspaceRoot: string, slug: string): boolean {
  const commandsDir = getWorkspaceCommandsPath(workspaceRoot);
  const commandFile = join(commandsDir, `${slug}.md`);

  if (!existsSync(commandFile)) {
    return false;
  }

  try {
    rmSync(commandFile);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Save Operations
// ============================================================

/**
 * Save (create or update) a command to a workspace.
 * Writes the .md file with YAML frontmatter + body.
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Command file name without extension
 * @param metadata - Command name and description
 * @param content - Prompt body text
 */
export function saveCommand(
  workspaceRoot: string,
  slug: string,
  metadata: CommandMetadata,
  content: string,
): LoadedCommand {
  const commandsDir = getWorkspaceCommandsPath(workspaceRoot);
  if (!existsSync(commandsDir)) {
    mkdirSync(commandsDir, { recursive: true });
  }
  const commandFile = join(commandsDir, `${slug}.md`);
  const fileContent = matter.stringify(content, metadata);
  writeFileSync(commandFile, fileContent, 'utf-8');
  return { slug, metadata, content, path: commandFile };
}
