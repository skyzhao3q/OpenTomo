/**
 * Runtime Types
 *
 * Type definitions for the runtime abstraction layer.
 * Runtimes provide execution environments for skill scripts (e.g., Python, Bun).
 */

/** Supported runtime types */
export type RuntimeType = 'bun' | 'node';

/** Runtime provider interface */
export interface IRuntimeProvider {
  /** Runtime identifier */
  readonly type: RuntimeType;

  /** Get absolute path to the runtime executable, or null if not found */
  getExecutablePath(): string | null;

  /** Check if the runtime is available (binary exists) */
  isAvailable(): boolean;

  /** Get environment variables to set when executing with this runtime */
  getEnvironment(): Record<string, string>;

  /** Get version string (e.g., "3.12.7"), or null if unavailable */
  getVersion(): string | null;
}

/** Runtime registry - resolves runtimes by type */
export interface IRuntimeRegistry {
  get(type: RuntimeType): IRuntimeProvider | null;
  getAll(): IRuntimeProvider[];
}
