/**
 * AppearanceSettingsPage
 *
 * Visual customization settings: theme mode, color theme, font,
 * workspace-specific theme overrides, and CLI tool icon mappings.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useTheme } from '@/context/ThemeContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes } from '@/lib/navigate'
import { Monitor, Sun, Moon } from 'lucide-react'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { ToolIconMapping } from '../../../shared/types'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsMenuSelect,
} from '@/components/settings'
import { Info_DataTable, SortableHeader } from '@/components/info/Info_DataTable'
import { Info_Badge } from '@/components/info/Info_Badge'
import type { PresetTheme } from '@config/theme'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'appearance',
}

// ============================================
// Main Component
// ============================================

export default function AppearanceSettingsPage() {
  const { t } = useTranslation()
  const { mode, setMode, colorTheme, setColorTheme, font, setFont, activeWorkspaceId, setWorkspaceColorTheme } = useTheme()
  const { workspaces } = useAppShellContext()

  // Preset themes for the color theme dropdown
  const [presetThemes, setPresetThemes] = useState<PresetTheme[]>([])

  // Per-workspace theme overrides (workspaceId -> themeId or undefined)
  const [workspaceThemes, setWorkspaceThemes] = useState<Record<string, string | undefined>>({})

  // Tool icon mappings loaded from main process
  const [toolIcons, setToolIcons] = useState<ToolIconMapping[]>([])

  // Resolved path to tool-icons.json (needed for EditPopover and "Edit File" action)
  const [toolIconsJsonPath, setToolIconsJsonPath] = useState<string | null>(null)

  // Load preset themes on mount
  useEffect(() => {
    const loadThemes = async () => {
      if (!window.electronAPI) {
        setPresetThemes([])
        return
      }
      try {
        const themes = await window.electronAPI.loadPresetThemes()
        setPresetThemes(themes)
      } catch (error) {
        console.error('Failed to load preset themes:', error)
        setPresetThemes([])
      }
    }
    loadThemes()
  }, [])

  // Load workspace themes on mount
  useEffect(() => {
    const loadWorkspaceThemes = async () => {
      if (!window.electronAPI?.getAllWorkspaceThemes) return
      try {
        const themes = await window.electronAPI.getAllWorkspaceThemes()
        setWorkspaceThemes(themes)
      } catch (error) {
        console.error('Failed to load workspace themes:', error)
      }
    }
    loadWorkspaceThemes()
  }, [])

  // Load tool icon mappings and resolve the config file path on mount
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const [mappings, homeDir] = await Promise.all([
          window.electronAPI.getToolIconMappings(),
          window.electronAPI.getHomeDir(),
        ])
        setToolIcons(mappings)
        setToolIconsJsonPath(`${homeDir}/.opentomo/tool-icons/tool-icons.json`)
      } catch (error) {
        console.error('Failed to load tool icon mappings:', error)
      }
    }
    load()
  }, [])

  // Handler for workspace theme change
  // Uses ThemeContext for the active workspace (immediate visual update) and IPC for other workspaces
  const handleWorkspaceThemeChange = useCallback(
    async (workspaceId: string, value: string) => {
      // 'default' means inherit from app default (null in storage)
      const themeId = value === 'default' ? null : value

      // If changing the current workspace, use context for immediate update
      if (workspaceId === activeWorkspaceId) {
        setWorkspaceColorTheme(themeId)
      } else {
        // For other workspaces, just persist via IPC
        await window.electronAPI?.setWorkspaceColorTheme?.(workspaceId, themeId)
      }

      // Update local state for UI
      setWorkspaceThemes(prev => ({
        ...prev,
        [workspaceId]: themeId ?? undefined
      }))
    },
    [activeWorkspaceId, setWorkspaceColorTheme]
  )

  // Theme options for dropdowns
  const themeOptions = useMemo(() => [
    { value: 'default', label: t('appearanceSettings.default') },
    ...presetThemes
      .filter(th => th.id !== 'default')
      .map(th => ({
        value: th.id,
        label: th.theme.name || th.id,
      })),
  ], [presetThemes, t])

  // Get current app default theme label for display (null when using 'default' to avoid redundant "Use Default (Default)")
  const appDefaultLabel = useMemo(() => {
    if (colorTheme === 'default') return null
    const preset = presetThemes.find(th => th.id === colorTheme)
    return preset?.theme.name || colorTheme
  }, [colorTheme, presetThemes])

  // Column definitions for the tool icon mappings table
  const toolIconColumns: ColumnDef<ToolIconMapping>[] = useMemo(() => [
    {
      accessorKey: 'iconDataUrl',
      header: () => <span className="p-1.5 pl-2.5">Icon</span>,
      cell: ({ row }) => (
        <div className="p-1.5 pl-2.5">
          <img
            src={row.original.iconDataUrl}
            alt={row.original.displayName}
            className="w-5 h-5 object-contain"
          />
        </div>
      ),
      size: 60,
      enableSorting: false,
    },
    {
      accessorKey: 'displayName',
      header: ({ column }) => <SortableHeader column={column} title={t('appearanceSettings.tool')} />,
      cell: ({ row }) => (
        <div className="p-1.5 pl-2.5 font-medium">
          {row.original.displayName}
        </div>
      ),
      size: 150,
    },
    {
      accessorKey: 'commands',
      header: () => <span className="p-1.5 pl-2.5">{t('appearanceSettings.commands')}</span>,
      cell: ({ row }) => (
        <div className="p-1.5 pl-2.5 flex flex-wrap gap-1">
          {row.original.commands.map(cmd => (
            <Info_Badge key={cmd} color="muted" className="font-mono">
              {cmd}
            </Info_Badge>
          ))}
        </div>
      ),
      meta: { fillWidth: true },
      enableSorting: false,
    },
  ], [t])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('appearanceSettings.title')}
        actions={<HeaderMenu route={routes.view.settings('appearance')} helpFeature="themes" />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">

              {/* Default Theme */}
              <SettingsSection title={t('appearanceSettings.defaultTheme')}>
                <SettingsCard>
                  <SettingsRow label={t('appearanceSettings.mode')}>
                    <SettingsSegmentedControl
                      value={mode}
                      onValueChange={setMode}
                      options={[
                        { value: 'system', label: t('appearanceSettings.system'), icon: <Monitor className="w-4 h-4" /> },
                        { value: 'light', label: t('appearanceSettings.light'), icon: <Sun className="w-4 h-4" /> },
                        { value: 'dark', label: t('appearanceSettings.dark'), icon: <Moon className="w-4 h-4" /> },
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow label={t('appearanceSettings.colorTheme')}>
                    <SettingsMenuSelect
                      value={colorTheme}
                      onValueChange={setColorTheme}
                      options={themeOptions}
                    />
                  </SettingsRow>
                  <SettingsRow label={t('appearanceSettings.font')}>
                    <SettingsSegmentedControl
                      value={font}
                      onValueChange={setFont}
                      options={[
                        { value: 'inter', label: 'Inter' },
                        { value: 'system', label: 'System' },
                      ]}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              {/* Workspace Themes */}
              {workspaces.length > 0 && (
                <SettingsSection
                  title={t('appearanceSettings.workspaceThemes')}
                  description={t('appearanceSettings.workspaceThemesDesc')}
                >
                  <SettingsCard>
                    {workspaces.map((workspace) => {
                      const wsTheme = workspaceThemes[workspace.id]
                      const hasCustomTheme = wsTheme !== undefined
                      return (
                        <SettingsRow
                          key={workspace.id}
                          label={
                            <div className="flex items-center gap-2">
                              {workspace.iconUrl ? (
                                <img
                                  src={workspace.iconUrl}
                                  alt=""
                                  className="w-4 h-4 rounded object-cover"
                                />
                              ) : (
                                <div className="w-4 h-4 rounded bg-foreground/10" />
                              )}
                              <span>{workspace.name}</span>
                            </div>
                          }
                        >
                          <SettingsMenuSelect
                            value={hasCustomTheme ? wsTheme : 'default'}
                            onValueChange={(value) => handleWorkspaceThemeChange(workspace.id, value)}
                            options={[
                              { value: 'default', label: appDefaultLabel ? t('appearanceSettings.useDefaultWithName', { name: appDefaultLabel }) : t('appearanceSettings.useDefault') },
                              ...presetThemes
                                .filter(th => th.id !== 'default')
                                .map(th => ({
                                  value: th.id,
                                  label: th.theme.name || th.id,
                                })),
                            ]}
                          />
                        </SettingsRow>
                      )
                    })}
                  </SettingsCard>
                </SettingsSection>
              )}

              {/* Tool Icons — shows the command → icon mapping used in turn cards */}
              <SettingsSection
                title={t('appearanceSettings.toolIcons')}
                description={t('appearanceSettings.toolIconsDesc')}
                action={
                  toolIconsJsonPath ? (
                    <EditPopover
                      trigger={<EditButton />}
                      {...getEditConfig('edit-tool-icons', toolIconsJsonPath)}
                      secondaryAction={{
                        label: t('common.editFile'),
                        filePath: toolIconsJsonPath,
                      }}
                    />
                  ) : undefined
                }
              >
                <SettingsCard>
                  <Info_DataTable
                    columns={toolIconColumns}
                    data={toolIcons}
                    searchable={{ placeholder: t('common.searchTools') }}
                    maxHeight={480}
                    emptyContent={t('appearanceSettings.noToolIcons')}
                  />
                </SettingsCard>
              </SettingsSection>

            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
