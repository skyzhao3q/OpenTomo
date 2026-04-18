/**
 * WorkspaceSettingsPage
 *
 * Workspace-level settings for the active workspace.
 *
 * Settings:
 * - Permissions (Default mode)
 * - Environment Variables (.env file management)
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { useAppShellContext } from '@/context/AppShellContext'
import { Spinner } from '@opentomo/ui'
import { routes } from '@/lib/navigate'
import type { PermissionMode, WorkspaceSettings, EnvVar } from '../../../shared/types'
import { PERMISSION_MODE_CONFIG } from '@opentomo/shared/agent/mode-types'
import { MODE_I18N_KEYS } from '@/components/ui/slash-command-menu'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Pencil, Trash2, RefreshCw, Plus, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

import {
  SettingsSection,
  SettingsCard,
  SettingsMenuSelectRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'workspace',
}

// Reserved env var prefixes that cannot be set via the UI
const RESERVED_PREFIXES = ['ANTHROPIC_', 'CLAUDE_CODE_', 'SS_', 'BUN_']

function isReservedKey(key: string): boolean {
  const upper = key.toUpperCase()
  return RESERVED_PREFIXES.some(prefix => upper.startsWith(prefix))
}

// ─────────────────────────────────────────────────────────────────────────────
// EnvVarRow — displays or edits a single env var entry
// ─────────────────────────────────────────────────────────────────────────────

interface EnvVarRowProps {
  envVar: EnvVar
  isEditing: boolean
  onEdit: () => void
  onDelete: () => void
  onSave: (updated: EnvVar) => void
  onCancel: () => void
  isLast: boolean
}

function EnvVarRow({ envVar, isEditing, onEdit, onDelete, onSave, onCancel, isLast }: EnvVarRowProps) {
  const { t } = useTranslation()
  const [editKey, setEditKey] = useState(envVar.key)
  const [editValue, setEditValue] = useState(envVar.value)
  const [showValue, setShowValue] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  // Reset local state when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditKey(envVar.key)
      setEditValue(envVar.value)
      setKeyError(null)
    }
  }, [isEditing, envVar.key, envVar.value])

  const handleSave = () => {
    const trimmedKey = editKey.trim()
    if (!trimmedKey) {
      setKeyError(t('workspaceSettings.envVarKeyRequired'))
      return
    }
    if (isReservedKey(trimmedKey)) {
      setKeyError(t('workspaceSettings.envVarReservedKey'))
      return
    }
    onSave({ key: trimmedKey, value: editValue })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onCancel()
  }

  if (isEditing) {
    return (
      <div className={cn('px-4 py-3', !isLast && 'border-b border-border/50')}>
        <div className="flex gap-2 items-start">
          <div className="flex-1 min-w-0 space-y-2">
            <Input
              value={editKey}
              onChange={e => { setEditKey(e.target.value); setKeyError(null) }}
              onKeyDown={handleKeyDown}
              placeholder={t('workspaceSettings.envVarKey')}
              className="bg-muted/50 border-0 shadow-none focus-visible:ring-1 focus-visible:ring-ring font-mono text-sm h-8"
            />
            {keyError && <p className="text-xs text-destructive">{keyError}</p>}
            <div className="relative">
              <Input
                type={showValue ? 'text' : 'password'}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('workspaceSettings.envVarValue')}
                className="bg-muted/50 border-0 shadow-none focus-visible:ring-1 focus-visible:ring-ring font-mono text-sm h-8 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowValue(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex gap-1 pt-0.5 shrink-0">
            <Button size="icon" variant="ghost" className="size-8" onClick={handleSave} title={t('workspaceSettings.envVarSave')}>
              <Check className="size-3.5 text-green-500" />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={onCancel} title={t('workspaceSettings.envVarCancel')}>
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Display mode
  const maskedValue = envVar.value ? '••••••••' : ''
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 group', !isLast && 'border-b border-border/50')}>
      <span className="font-mono text-sm font-medium w-2/5 truncate" title={envVar.key}>
        {envVar.key}
      </span>
      <span className="font-mono text-sm text-muted-foreground flex-1 truncate">
        {maskedValue}
      </span>
      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onEdit}
          title={t('workspaceSettings.envVarEdit')}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 hover:text-destructive"
          onClick={onDelete}
          title={t('workspaceSettings.envVarDelete')}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function WorkspaceSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()

  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true)

  // Env vars state
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [isLoadingEnv, setIsLoadingEnv] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  // -1 means "adding a new row at the bottom"
  const [isAddingNew, setIsAddingNew] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI || !activeWorkspaceId) {
        setIsLoadingWorkspace(false)
        return
      }
      setIsLoadingWorkspace(true)
      try {
        const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
        if (settings) {
          setPermissionMode(settings.permissionMode || 'ask')
        }
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoadingWorkspace(false)
      }
    }
    load()
  }, [activeWorkspaceId])

  const loadEnvVars = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    setIsLoadingEnv(true)
    try {
      const vars = await window.electronAPI.getWorkspaceEnv(activeWorkspaceId)
      setEnvVars(vars)
    } catch (error) {
      console.error('Failed to load workspace env vars:', error)
    } finally {
      setIsLoadingEnv(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    loadEnvVars()
  }, [loadEnvVars])

  const saveEnvVars = useCallback(async (vars: EnvVar[]) => {
    if (!window.electronAPI || !activeWorkspaceId) return
    try {
      await window.electronAPI.saveWorkspaceEnv(activeWorkspaceId, vars)
      setEnvVars(vars)
    } catch (error) {
      console.error('Failed to save workspace env vars:', error)
    }
  }, [activeWorkspaceId])

  const updateWorkspaceSetting = useCallback(
    async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
      if (!window.electronAPI || !activeWorkspaceId) return
      try {
        await window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, key, value)
      } catch (error) {
        console.error(`Failed to save ${key}:`, error)
      }
    },
    [activeWorkspaceId]
  )

  const handlePermissionModeChange = useCallback(
    async (newMode: PermissionMode) => {
      setPermissionMode(newMode)
      await updateWorkspaceSetting('permissionMode', newMode)
    },
    [updateWorkspaceSetting]
  )

  const handleSaveRow = useCallback(async (index: number, updated: EnvVar) => {
    const next = [...envVars]
    next[index] = updated
    await saveEnvVars(next)
    setEditingIndex(null)
  }, [envVars, saveEnvVars])

  const handleDeleteRow = useCallback(async (index: number) => {
    const next = envVars.filter((_, i) => i !== index)
    await saveEnvVars(next)
    setEditingIndex(null)
  }, [envVars, saveEnvVars])

  const handleSaveNewRow = useCallback(async (newVar: EnvVar) => {
    const next = [...envVars, newVar]
    await saveEnvVars(next)
    setIsAddingNew(false)
  }, [envVars, saveEnvVars])

  if (!activeWorkspaceId) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t('workspaceSettings.title')} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">{t('workspaceSettings.noWorkspace')}</p>
        </div>
      </div>
    )
  }

  if (isLoadingWorkspace) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t('workspaceSettings.title')} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('workspaceSettings.title')} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">

            {/* Permissions */}
            <SettingsSection title={t('workspaceSettings.permissions')}>
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={t('workspaceSettings.defaultMode')}
                  description={t('workspaceSettings.defaultModeDesc')}
                  value={permissionMode}
                  onValueChange={(v) => handlePermissionModeChange(v as PermissionMode)}
                  options={[
                    { value: 'safe', label: t(MODE_I18N_KEYS['safe'].short, PERMISSION_MODE_CONFIG['safe'].shortName), description: t('workspaceSettings.modeReadOnly') },
                    { value: 'ask', label: t(MODE_I18N_KEYS['ask'].short, PERMISSION_MODE_CONFIG['ask'].shortName), description: t('workspaceSettings.modePrompts') },
                    { value: 'allow-all', label: t(MODE_I18N_KEYS['allow-all'].short, PERMISSION_MODE_CONFIG['allow-all'].shortName), description: t('workspaceSettings.modeAutoExec') },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Environment Variables */}
            <SettingsSection title={t('workspaceSettings.envVars')}>
              {/* Header row: description + Refresh button */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">{t('workspaceSettings.envVarsDesc')}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadEnvVars}
                  disabled={isLoadingEnv}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className={cn('size-3.5', isLoadingEnv && 'animate-spin')} />
                  {t('workspaceSettings.refreshEnvVars')}
                </Button>
              </div>

              <SettingsCard>
                {/* Existing env vars */}
                {envVars.length === 0 && !isAddingNew ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('workspaceSettings.envVarsEmpty')}
                  </div>
                ) : (
                  envVars.map((envVar, index) => (
                    <EnvVarRow
                      key={`${envVar.key}-${index}`}
                      envVar={envVar}
                      isEditing={editingIndex === index}
                      isLast={index === envVars.length - 1 && !isAddingNew}
                      onEdit={() => { setEditingIndex(index); setIsAddingNew(false) }}
                      onDelete={() => handleDeleteRow(index)}
                      onSave={(updated) => handleSaveRow(index, updated)}
                      onCancel={() => setEditingIndex(null)}
                    />
                  ))
                )}

                {/* New row being added */}
                {isAddingNew && (
                  <EnvVarRow
                    envVar={{ key: '', value: '' }}
                    isEditing={true}
                    isLast={true}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onSave={handleSaveNewRow}
                    onCancel={() => setIsAddingNew(false)}
                  />
                )}
              </SettingsCard>

              {/* Add Variable button */}
              <div className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setIsAddingNew(true); setEditingIndex(null) }}
                  disabled={isAddingNew}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  {t('workspaceSettings.addEnvVar')}
                </Button>
              </div>
            </SettingsSection>

          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
