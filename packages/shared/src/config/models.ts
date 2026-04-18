/**
 * Centralized model definitions for the entire application.
 * Update model IDs here when new versions are released.
 */

import type { AuthType } from '@opentomo/core/types';

export interface ProviderDefinition {
  id: string;                        // 'anthropic', 'openai', 'google', 'custom'
  name: string;                      // 'OpenTomo', 'Anthropic', 'OpenAI', 'Google', 'Custom API'
  description: string;               // Provider description
  supportedAuthTypes: AuthType[];    // Authentication methods this provider supports
}

export interface ModelDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** Known context window size in tokens (used as fallback before SDK reports usage) */
  contextWindow?: number;
  /** Provider this model belongs to */
  provider: string;                  // 'anthropic', 'openai', 'google', 'custom'
}

// ============================================
// PROVIDERS
// Available AI service providers
// ============================================

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Direct connection to Anthropic',
    supportedAuthTypes: ['api_key', 'oauth_token'],
  },
  {
    id: 'custom',
    name: 'Custom API',
    description: 'Ollama, local LLMs, or other APIs',
    supportedAuthTypes: ['custom_api'],
  },
];

// ============================================
// PURPOSE-SPECIFIC DEFAULTS
// ============================================

/** Default model for main chat (user-facing) */
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/** Model for API response summarization (cost efficient) */
export const SUMMARIZATION_MODEL = 'claude-haiku-4-5-20251001';

// ============================================
// HELPER FUNCTIONS
// ============================================

/** Check if model is an Opus model (for cache TTL decisions) */
export function isOpusModel(modelId: string): boolean {
  return modelId.includes('opus');
}

/**
 * Check if a model ID refers to a Claude model.
 * Handles both direct Anthropic IDs (e.g. "claude-sonnet-4-5-20250929")
 * and provider-prefixed IDs (e.g. "anthropic/claude-sonnet-4" via OpenRouter).
 */
export function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('claude-') || lower.includes('/claude');
}

// ============================================
// RE-EXPORTS FROM STORAGE
// Provider filtering functions are implemented in storage.ts to avoid circular dependencies
// ============================================

export {
  getModelsForProvider,
  getAuthTypesForProvider,
  getProviderById,
  getAvailableModels,
  getModelDisplayName,
  getModelShortName,
  getModelContextWindow,
} from './storage.ts';
