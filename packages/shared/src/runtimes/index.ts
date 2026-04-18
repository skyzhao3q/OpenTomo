/**
 * Runtimes Module
 *
 * Runtime abstraction layer for bundled execution environments.
 * Provides a registry of runtime providers (Node, Bun) and
 * utilities for building agent subprocess environments.
 */

import { existsSync } from 'fs';
import { RuntimeRegistry } from './registry.ts';
import type { RuntimeType, IRuntimeProvider, IRuntimeRegistry } from './types.ts';

export * from './types.ts';
export { RuntimeRegistry } from './registry.ts';
export { buildAgentEnvironment } from './environment.ts';

/** Global singleton registry — populated at app startup with bundled runtime paths. */
const globalRegistry = new RuntimeRegistry();

/**
 * Register a bundled runtime binary so agent subprocesses can find it on PATH.
 * Call this at startup (e.g., from sessions.ts) before creating any agents.
 *
 * @param type - Runtime type ('bun' | 'node')
 * @param executablePath - Absolute path to the binary
 */
export function registerBundledRuntime(type: RuntimeType, executablePath: string): void {
  const provider: IRuntimeProvider = {
    type,
    getExecutablePath: () => executablePath,
    isAvailable: () => existsSync(executablePath),
    getEnvironment: () => ({}),
    getVersion: () => null,
  };
  globalRegistry.register(provider);
}

/**
 * Get the global runtime registry (pre-populated with bundled binaries).
 * Used by opentomo-agent.ts to build the agent subprocess environment.
 */
export function getGlobalRegistry(): IRuntimeRegistry {
  return globalRegistry;
}
