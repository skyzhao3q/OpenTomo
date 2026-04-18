/**
 * Provider Connections
 *
 * Manages named AI provider connections that users can create and switch between.
 * Multiple connections are stored in config.json alongside the existing provider fields.
 *
 * The active connection syncs into the existing authType / anthropicBaseUrl / customModel
 * fields so that all existing session-creation code requires zero changes.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { CONFIG_DIR } from './paths.ts';
import type { ModelDefinition } from './models.ts';

// ============================================
// Types
// ============================================

/** Supported connection provider types */
export type ConnectionType =
  | 'azure_openai'   // Azure OpenAI (Anthropic-compatible endpoint)
  | 'anthropic_api'  // Direct Anthropic API key
  | 'custom_api'     // Generic Anthropic-compatible API
  | 'ollama';        // Local Ollama instance (no API key required)

/** Model tier IDs entered by the user for this connection */
export interface ConnectionModels {
  /** Most capable model (e.g. o1-pro, claude-opus-4) */
  best?: string;
  /** Everyday use model — also set as customModel when connection is activated */
  balanced?: string;
  /** Summarization & utility model */
  fast?: string;
}

/** A named, user-created AI provider connection */
export interface ProviderConnection {
  id: string;
  name: string;
  type: ConnectionType;
  /** Base URL for the API endpoint */
  endpoint: string;
  /** Model IDs per performance tier */
  models: ConnectionModels;
  createdAt: number;
}

// ============================================
// Storage
// ============================================

const CONNECTIONS_FILE = join(CONFIG_DIR, 'connections.json');

/** Load all connections from disk. Returns empty array if file does not exist. */
export function loadConnections(): ProviderConnection[] {
  try {
    if (!existsSync(CONNECTIONS_FILE)) return [];
    const content = readFileSync(CONNECTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed as ProviderConnection[];
  } catch {
    return [];
  }
}

/** Persist connections array to disk. */
function saveConnections(connections: ProviderConnection[]): void {
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2), 'utf-8');
}

// ============================================
// CRUD Operations
// ============================================

/**
 * Add a new provider connection. Returns the created connection with its generated ID.
 */
export function addProviderConnection(
  data: Omit<ProviderConnection, 'id' | 'createdAt'>
): ProviderConnection {
  const connections = loadConnections();
  const connection: ProviderConnection = {
    ...data,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  connections.push(connection);
  saveConnections(connections);
  return connection;
}

/**
 * Delete a provider connection by ID. Returns true if the connection was found and deleted.
 */
export function deleteProviderConnection(id: string): boolean {
  const connections = loadConnections();
  const index = connections.findIndex(c => c.id === id);
  if (index === -1) return false;
  connections.splice(index, 1);
  saveConnections(connections);
  return true;
}

/**
 * Find a connection by ID. Returns undefined if not found.
 */
export function findProviderConnection(id: string): ProviderConnection | undefined {
  return loadConnections().find(c => c.id === id);
}

/**
 * Update an existing provider connection. Returns the updated connection.
 * Throws if the connection ID is not found.
 * The connection's type and createdAt are immutable.
 */
export function updateProviderConnection(
  id: string,
  updates: Partial<Omit<ProviderConnection, 'id' | 'createdAt' | 'type'>>
): ProviderConnection {
  const connections = loadConnections();
  const index = connections.findIndex(c => c.id === id);
  if (index === -1) throw new Error(`Connection not found: ${id}`);
  const existing = connections[index]!;
  const updated: ProviderConnection = { ...existing, ...updates };
  connections[index] = updated;
  saveConnections(connections);
  return updated;
}

// ============================================
// Config-Models Integration
// ============================================

const CONFIG_MODELS_FILE = join(CONFIG_DIR, 'config-models.json');

/**
 * Append a connection's model IDs to config-models.json so they are
 * discoverable and manageable alongside the built-in OpenTomo models.
 * Does nothing for tier values that are empty.
 */
export function registerConnectionModels(connection: ProviderConnection): void {
  let existingModels: ModelDefinition[] = [];

  try {
    if (existsSync(CONFIG_MODELS_FILE)) {
      const content = readFileSync(CONFIG_MODELS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.models && Array.isArray(parsed.models)) {
        existingModels = parsed.models;
      }
    }
  } catch {
    // start with empty list
  }

  // Remove any previously registered models for this connection (idempotent re-add)
  existingModels = existingModels.filter(m => m.provider !== connection.id);

  const tierDefs: Array<{ key: keyof ConnectionModels; description: string; shortName: string }> = [
    { key: 'best',     description: 'Most capable',           shortName: 'Best' },
    { key: 'balanced', description: 'Good for everyday use',  shortName: 'Balanced' },
    { key: 'fast',     description: 'Summarization & utility', shortName: 'Fast' },
  ];

  for (const tier of tierDefs) {
    const modelId = connection.models[tier.key];
    if (!modelId?.trim()) continue;

    const trimmed = modelId.trim();
    // Avoid duplicates by model ID within this connection's scope
    if (existingModels.some(m => m.id === trimmed && m.provider === connection.id)) continue;

    existingModels.push({
      id: trimmed,
      name: `${connection.name} – ${tier.shortName}`,
      shortName: tier.shortName,
      description: `${tier.description} (${connection.name})`,
      provider: connection.id,
    });
  }

  writeFileSync(
    CONFIG_MODELS_FILE,
    JSON.stringify({ models: existingModels }, null, 2),
    'utf-8'
  );
}

/**
 * Remove a connection's model entries from config-models.json when the connection is deleted.
 */
export function unregisterConnectionModels(connectionId: string): void {
  try {
    if (!existsSync(CONFIG_MODELS_FILE)) return;
    const content = readFileSync(CONFIG_MODELS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed.models || !Array.isArray(parsed.models)) return;
    const filtered = (parsed.models as ModelDefinition[]).filter(m => m.provider !== connectionId);
    writeFileSync(CONFIG_MODELS_FILE, JSON.stringify({ models: filtered }, null, 2), 'utf-8');
  } catch {
    // non-fatal
  }
}

// ============================================
// Human-Readable Labels
// ============================================

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  azure_openai:  'Azure OpenAI',
  anthropic_api: 'Anthropic',
  custom_api:    'Custom API',
  ollama:        'Ollama',
};
