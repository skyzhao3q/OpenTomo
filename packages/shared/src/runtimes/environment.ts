/**
 * Agent Environment Builder
 *
 * Constructs environment variables for agent subprocess execution.
 * Collects runtime-specific env vars and prepends bundled runtime
 * executable directories to PATH so they take priority over system installs.
 */

import { dirname } from 'path';
import type { IRuntimeRegistry } from './types.ts';

/**
 * Build a merged environment variable map from all available runtimes.
 *
 * - Collects runtime-specific environment variables (e.g., PYTHONNOUSERSITE)
 * - Prepends bundled runtime bin directories to PATH so bundled runtimes
 *   take priority over any system-installed versions
 *
 * @param registry - The runtime registry containing all registered providers
 * @returns Environment variable map to merge into subprocess env
 */
export function buildAgentEnvironment(registry: IRuntimeRegistry): Record<string, string> {
  const env: Record<string, string> = {};
  const pathPrepend: string[] = [];

  for (const runtime of registry.getAll()) {
    if (!runtime.isAvailable()) continue;

    // Merge runtime-specific environment variables
    Object.assign(env, runtime.getEnvironment());

    // Collect executable directory for PATH prepend
    const execPath = runtime.getExecutablePath();
    if (execPath) {
      pathPrepend.push(dirname(execPath));
    }
  }

  // Prepend bundled runtime directories to PATH (bundled > system)
  if (pathPrepend.length > 0) {
    const separator = process.platform === 'win32' ? ';' : ':';
    env.PATH = pathPrepend.join(separator) + separator + (process.env.PATH || '');
  }

  return env;
}
