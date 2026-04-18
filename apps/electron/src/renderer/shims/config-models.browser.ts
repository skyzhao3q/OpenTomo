/**
 * Renderer-safe shim for @config/models
 *
 * Avoids importing storage.ts (which uses fs/path/crypto) by serving
 * model metadata directly from bundled JSON resources.
 *
 * Exports the same surface used by the renderer:
 * - PROVIDERS, DEFAULT_MODEL
 * - isClaudeModel, isOpusModel
 * - getAvailableModels, getModelsForProvider, getAuthTypesForProvider, getProviderById
 * - getModelDisplayName, getModelShortName, getModelContextWindow
 */

// Types kept local to avoid pulling extra deps
export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  supportedAuthTypes: string[]; // AuthType[] in shared
}

export interface ModelDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  contextWindow?: number;
  provider: string; // 'opentomo', 'anthropic', 'custom', etc.
}

// Providers used by the UI (Auth types are string unions in shared; string[] here is sufficient)
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

// Direct Anthropic defaults
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
export const SUMMARIZATION_MODEL = 'claude-haiku-4-5-20251001';

// Available models (embedded to keep renderer self-contained)
const AVAILABLE_MODELS: ModelDefinition[] = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6', shortName: 'Opus', description: 'Most capable', contextWindow: 200000, provider: 'anthropic' },
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', shortName: 'Opus 4.5', description: 'Previous generation', contextWindow: 200000, provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', shortName: 'Sonnet', description: 'Balanced', contextWindow: 200000, provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', shortName: 'Haiku', description: 'Fast & efficient', contextWindow: 200000, provider: 'anthropic' },
];

export function getAvailableModels(): ModelDefinition[] {
  return AVAILABLE_MODELS;
}

export function getModelsForProvider(providerId: string): ModelDefinition[] {
  return getAvailableModels().filter(m => m.provider === providerId);
}

export function getAuthTypesForProvider(providerId: string): string[] {
  const provider = PROVIDERS.find(p => p.id === providerId);
  return provider?.supportedAuthTypes ?? [];
}

export function getProviderById(providerId: string): ProviderDefinition | undefined {
  return PROVIDERS.find(p => p.id === providerId);
}

// Helpers -------------------------------------------------

export function isOpusModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('opus');
}

export function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('claude-') || lower.includes('/claude');
}

export function getModelDisplayName(modelId: string): string {
  const model = getAvailableModels().find(m => m.id === modelId);
  if (model) return model.name;
  // Fallback: strip prefix and date suffix
  return modelId.replace('claude-', '').replace(/-\d{8}$/, '');
}

export function getModelShortName(modelId: string): string {
  const model = getAvailableModels().find(m => m.id === modelId);
  if (model) return model.shortName;
  if (modelId.includes('/')) {
    return modelId.split('/').pop() || modelId;
  }
  return modelId.replace('claude-', '').replace(/-[\d.-]+$/, '');
}

export function getModelContextWindow(modelId: string): number | undefined {
  return getAvailableModels().find(m => m.id === modelId)?.contextWindow;
}
