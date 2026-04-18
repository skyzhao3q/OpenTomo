/**
 * Workspace Environment Variable Storage
 *
 * Manages reading and writing the .env file in a workspace folder.
 * These variables are injected into the Claude Agent SDK subprocess
 * so Skills and tools can access user-defined secrets (e.g. API keys).
 *
 * File location: {workspaceRootPath}/.env
 * Format: standard .env (KEY=VALUE, # comments, quoted values)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface EnvVar {
  key: string;
  value: string;
}

/**
 * Parse a .env file content string into an array of key-value pairs.
 * - Skips blank lines and comment lines (starting with #)
 * - Strips inline comments after values (only if unquoted)
 * - Strips surrounding quotes from values (" or ')
 */
export function parseEnvFile(content: string): EnvVar[] {
  const vars: EnvVar[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    // Skip blank lines and comment lines
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = line.slice(eqIdx + 1);

    // Strip surrounding quotes (" or ')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comments (e.g. KEY=val # comment)
      const commentIdx = value.indexOf(' #');
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    vars.push({ key, value });
  }

  return vars;
}

/**
 * Serialize an array of key-value pairs into .env file content.
 * Values containing spaces or special characters are double-quoted.
 */
export function serializeEnvFile(vars: EnvVar[]): string {
  const lines = vars
    .filter(({ key }) => key.trim())
    .map(({ key, value }) => {
      // Quote values that contain spaces, #, or quotes
      const needsQuoting = /[\s#"']/.test(value);
      const serializedValue = needsQuoting ? `"${value.replace(/"/g, '\\"')}"` : value;
      return `${key}=${serializedValue}`;
    });

  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/**
 * Read the workspace .env file and return parsed key-value pairs.
 * Returns an empty array if the file does not exist.
 */
export function readWorkspaceEnvFile(workspaceRootPath: string): EnvVar[] {
  const envPath = join(workspaceRootPath, '.env');
  if (!existsSync(envPath)) {
    return [];
  }
  try {
    const content = readFileSync(envPath, 'utf-8');
    return parseEnvFile(content);
  } catch {
    return [];
  }
}

/**
 * Write env vars to the workspace .env file.
 * Creates the file (and parent directories) if they do not exist.
 */
export function writeWorkspaceEnvFile(workspaceRootPath: string, vars: EnvVar[]): void {
  const envPath = join(workspaceRootPath, '.env');
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, serializeEnvFile(vars), 'utf-8');
}
