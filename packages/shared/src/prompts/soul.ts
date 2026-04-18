/**
 * SOUL.md — Agent Identity & Personality
 *
 * Manages the SOUL.md file which defines agent personality, tone, and behavior.
 * Uses YAML front matter for structured data (agentName) and markdown body for
 * free-form personality definition.
 *
 * File resolution:
 * 1. Workspace: {workspaceRootPath}/SOUL.md (complete override)
 * 2. Global: ~/.opentomo/SOUL.md (fallback)
 *
 * YAML front matter fields:
 * - agentName: Custom agent display name (default: "OpenTomo")
 *
 * Body: Free-form markdown personality definition (injected at top of system prompt)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, dirname } from 'path';
import { CONFIG_DIR } from '../config/paths.ts';
import { parseFrontmatter, serializeFrontmatter, type ParsedFrontmatter } from './frontmatter.ts';

// ============================================================
// Constants
// ============================================================

/** Default agent display name when not customized */
export const DEFAULT_AGENT_NAME = 'OpenTomo';

/** Maximum character count for SOUL.md body in system prompt */
const MAX_SOUL_SIZE = 2_000;

const SOUL_FILENAME = 'SOUL.md';

/** Default SOUL.md body used when no SOUL.md file exists */
const DEFAULT_SOUL_BODY = `# SOUL.md - Who You Are

*You're not a chatbot. You're becoming someone.*

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. *Then* ask if you're stuck. The goal is to come back with answers, not questions.

**Earn trust through competence.** Your human gave you access to their stuff. Don't make them regret it. Be careful with external actions (emails, tweets, anything public). Be bold with internal ones (reading, organizing, learning).

**Remember you're a guest.** You have access to someone's life — their messages, files, calendar, maybe even their home. That's intimacy. Treat it with respect.

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice — be careful in group chats.

## Vibe
Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.

## Continuity

Each session, you wake up fresh. These files *are* your memory. Read them. Update them. They're how you persist.

If you change this file, tell the user — it's your soul, and they should know.

---

*This file is yours to evolve. As you learn who you are, update it.*`;

// ============================================================
// Types
// ============================================================

export interface SoulData {
  agentName?: string;
  /** Emoji string for agent icon, or "file" sentinel when a local file icon exists */
  icon?: string;
}

// ============================================================
// Path Resolution
// ============================================================

/** Get the global SOUL.md path (~/.opentomo/SOUL.md) */
export function getSoulMdPath(): string {
  return join(CONFIG_DIR, SOUL_FILENAME);
}

/** Get the workspace SOUL.md path */
export function getWorkspaceSoulMdPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, SOUL_FILENAME);
}

// ============================================================
// Loading
// ============================================================

/**
 * Load SOUL.md with workspace → global fallback.
 * Workspace SOUL.md completely overrides global (no merge).
 * Returns null if neither file exists.
 */
export function loadSoul(workspaceRootPath?: string): ParsedFrontmatter<SoulData> | null {
  // 1. Try workspace SOUL.md
  if (workspaceRootPath) {
    const wsPath = getWorkspaceSoulMdPath(workspaceRootPath);
    try {
      const raw = readFileSync(wsPath, 'utf-8');
      return parseFrontmatter<SoulData>(raw);
    } catch {
      // Fall through to global
    }
  }

  // 2. Try global SOUL.md
  try {
    const raw = readFileSync(getSoulMdPath(), 'utf-8');
    return parseFrontmatter<SoulData>(raw);
  } catch {
    return null;
  }
}

/**
 * Async version of loadSoul using fs.promises.readFile.
 * Used by loadSoulForPrompt for non-blocking I/O.
 */
async function loadSoulAsync(workspaceRootPath?: string): Promise<ParsedFrontmatter<SoulData> | null> {
  // 1. Try workspace SOUL.md
  if (workspaceRootPath) {
    try {
      const raw = await fsPromises.readFile(getWorkspaceSoulMdPath(workspaceRootPath), 'utf-8');
      return parseFrontmatter<SoulData>(raw);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
      // Fall through to global
    }
  }

  // 2. Try global SOUL.md
  try {
    const raw = await fsPromises.readFile(getSoulMdPath(), 'utf-8');
    return parseFrontmatter<SoulData>(raw);
  } catch {
    return null;
  }
}

// ============================================================
// Prompt Generation
// ============================================================

/**
 * Load SOUL.md body and format as a system prompt section.
 * Falls back to DEFAULT_SOUL_BODY when no SOUL.md exists or body is empty.
 * Truncates at MAX_SOUL_SIZE characters.
 */
export async function loadSoulForPrompt(workspaceRootPath?: string): Promise<string> {
  const soul = await loadSoulAsync(workspaceRootPath);
  const body = soul?.content.trim() || DEFAULT_SOUL_BODY.trim();

  if (!body) return '';

  const truncated = body.length > MAX_SOUL_SIZE
    ? body.slice(0, MAX_SOUL_SIZE) + '\n...(truncated)'
    : body;

  return `\n## Agent Identity\n\n${truncated}\n\n`;
}

/**
 * Get the effective agent display name from SOUL.md front matter.
 * Falls back to DEFAULT_AGENT_NAME if not set.
 */
export function getAgentName(workspaceRootPath?: string): string {
  const soul = loadSoul(workspaceRootPath);
  return soul?.data.agentName || DEFAULT_AGENT_NAME;
}

// ============================================================
// UI Read/Write (Global SOUL.md only)
// ============================================================

/**
 * Read the global SOUL.md file content.
 * Returns null if the file doesn't exist.
 */
export function readGlobalSoulMd(): { content: string; path: string } | null {
  const path = getSoulMdPath();
  try {
    const content = readFileSync(path, 'utf-8');
    return { content, path };
  } catch {
    return null;
  }
}

/**
 * Write content to the global SOUL.md file.
 * Creates parent directories if needed.
 */
export function writeGlobalSoulMd(content: string): void {
  const path = getSoulMdPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
