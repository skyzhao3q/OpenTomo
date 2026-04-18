/**
 * ProvidersSettingsPage
 *
 * Manage AI provider connections. Users can add named connections
 * (e.g. Azure OpenAI) and set one as the default provider.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppShellContext } from '@/context/AppShellContext'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Plus } from 'lucide-react'
import { SettingsSection } from '@/components/settings'
import { AddConnectionDialog } from '@/components/settings/AddConnectionDialog'
import { ClaudeOAuthDialog } from '@/components/settings/ClaudeOAuthDialog'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { ClaudeOAuthStatus } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'providers',
}

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror of ProviderConnection from packages/shared)
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderConnection {
  id: string
  name: string
  type: string
  endpoint: string
  models: { best?: string; balanced?: string; fast?: string }
  createdAt: number
}

const CONNECTION_TYPE_LABELS: Record<string, string> = {
  azure_openai: 'Azure OpenAI',
  anthropic_api: 'Anthropic',
  custom_api: 'Custom API',
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Claude Subscription card
// ─────────────────────────────────────────────────────────────────────────────

function ClaudeSubscriptionCard({
  isConnected,
  isDefault,
  onConnect,
  onSetDefault,
  onDisconnect,
}: {
  isConnected: boolean
  isDefault: boolean
  onConnect: () => void
  onSetDefault: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3 flex items-center gap-3">
      {/* Icon — Claude logo (simplified) */}
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-foreground/70">
          <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm-1-11v4l3.5 2.1-.8 1.2-4.2-2.5V8h1.5z" fill="currentColor"/>
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Claude Subscription</span>
          {isDefault && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border text-muted-foreground shrink-0">
              Default
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          claude.ai · {isConnected ? 'Connected' : 'Not connected'}
        </p>
      </div>

      {/* Actions */}
      {isConnected ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onSetDefault} disabled={isDefault}>
              Set as Default
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDisconnect}
              className="text-destructive focus:text-destructive"
            >
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant="outline" size="sm" className="shrink-0 h-7 text-xs" onClick={onConnect}>
          Connect
        </Button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// User-created connection card
// ─────────────────────────────────────────────────────────────────────────────

function ConnectionCard({
  connection,
  isDefault,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  connection: ProviderConnection
  isDefault: boolean
  onSetDefault: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const typeLabel = CONNECTION_TYPE_LABELS[connection.type] ?? connection.type
  // Show the hostname portion of the endpoint for the subtitle
  let endpointHost = connection.endpoint
  try {
    endpointHost = new URL(connection.endpoint).hostname
  } catch {
    // keep raw value
  }

  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3 flex items-center gap-3">
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-orange-500">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{connection.name}</span>
          {isDefault && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border text-muted-foreground shrink-0">
              Default
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {typeLabel} · {endpointHost}
        </p>
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSetDefault} disabled={isDefault}>
            Set as Default
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProvidersSettingsPage() {
  const { refreshCustomModel } = useAppShellContext()
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [oauthStatus, setOAuthStatus] = useState<ClaudeOAuthStatus | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showOAuthDialog, setShowOAuthDialog] = useState(false)
  const [editingConnection, setEditingConnection] = useState<ProviderConnection | null>(null)

  const loadData = useCallback(async () => {
    if (!window.electronAPI) return
    const [list, activeId, oauthSt] = await Promise.all([
      window.electronAPI.listConnections(),
      window.electronAPI.getActiveConnectionId(),
      window.electronAPI.getClaudeOAuthStatus(),
    ])
    setConnections(list ?? [])
    setActiveConnectionId(activeId ?? null)
    setOAuthStatus(oauthSt ?? null)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSetDefault = async (connectionId: string | null) => {
    if (!window.electronAPI) return
    await window.electronAPI.setActiveConnection(connectionId)
    await loadData()
    await refreshCustomModel()
  }

  const handleDelete = async (connectionId: string) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteConnection(connectionId)
    await loadData()
    await refreshCustomModel()
  }

  const handleAdded = async (newId: string | null) => {
    if (newId) {
      await handleSetDefault(newId)
    }
    loadData()
  }

  const handleSetClaudeOAuthDefault = async () => {
    if (!window.electronAPI) return
    await window.electronAPI.activateClaudeOAuth()
    await loadData()
    await refreshCustomModel()
  }

  const handleDisconnectClaudeOAuth = async () => {
    if (!window.electronAPI) return
    await window.electronAPI.disconnectClaudeOAuth()
    await loadData()
    await refreshCustomModel()
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Providers" />
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-8 max-w-2xl">
          <SettingsSection
            title="Connections"
            description="Manage your AI provider connections."
          >
            <div className="space-y-2">
              {/* Built-in Claude Subscription (oauth) — non-deletable */}
              <ClaudeSubscriptionCard
                isConnected={oauthStatus?.isConnected ?? false}
                isDefault={oauthStatus?.isActive ?? false}
                onConnect={() => setShowOAuthDialog(true)}
                onSetDefault={handleSetClaudeOAuthDefault}
                onDisconnect={handleDisconnectClaudeOAuth}
              />

              {/* User-created connections */}
              {connections.map(connection => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  isDefault={activeConnectionId === connection.id}
                  onSetDefault={() => handleSetDefault(connection.id)}
                  onEdit={() => setEditingConnection(connection)}
                  onDelete={() => handleDelete(connection.id)}
                />
              ))}

              {/* Add connection button */}
              <Button
                variant="outline"
                className="w-auto"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add Connection
              </Button>
            </div>
          </SettingsSection>
        </div>
      </ScrollArea>

      <AddConnectionDialog
        open={showAddDialog || editingConnection !== null}
        onOpenChange={(open) => {
          if (!open) setEditingConnection(null)
          setShowAddDialog(open)
        }}
        onAdded={handleAdded}
        editingConnection={editingConnection}
      />

      <ClaudeOAuthDialog
        open={showOAuthDialog}
        onOpenChange={setShowOAuthDialog}
        onConnected={() => loadData()}
      />
    </div>
  )
}
