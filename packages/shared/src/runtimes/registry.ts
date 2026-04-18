/**
 * Runtime Registry
 *
 * Central registry for all available runtime providers.
 * Used by the agent environment builder to collect runtimes and
 * construct the execution environment.
 */

import type { IRuntimeProvider, IRuntimeRegistry, RuntimeType } from './types.ts';

export class RuntimeRegistry implements IRuntimeRegistry {
  private providers = new Map<RuntimeType, IRuntimeProvider>();

  /**
   * Register a runtime provider.
   * Replaces any existing provider of the same type.
   */
  register(provider: IRuntimeProvider): void {
    this.providers.set(provider.type, provider);
  }

  /**
   * Get a runtime provider by type, or null if not registered.
   */
  get(type: RuntimeType): IRuntimeProvider | null {
    return this.providers.get(type) ?? null;
  }

  /**
   * Get all registered runtime providers.
   */
  getAll(): IRuntimeProvider[] {
    return Array.from(this.providers.values());
  }
}
