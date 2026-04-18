/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - Default Theme (mode)
 * - Sending (send message key)
 * - About (version, updates)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { navigate, routes } from '@/lib/navigate'
import { Monitor, Sun, Moon, ChevronDown, ChevronUp } from 'lucide-react'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { PresetTheme, ThemeOverrides } from '@config/theme'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsSegmentedControl,
  SettingsMenuSelectRow,
  SettingsMenuSelect,
  ThemeColorEditor,
} from '@/components/settings'
import { useTheme } from '@/context/ThemeContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { DEFAULT_THEME, themeToCSS } from '@config/theme'

// ─── Provider Connection types (mirrors packages/shared) ──────────────────────
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

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation()
  const { mode, setMode, colorTheme, setColorTheme, resolvedTheme, isDark } = useTheme()
  const { onModelChange: onGlobalModelChange, refreshCustomModel } = useAppShellContext()

  // Theme state
  const [presetThemes, setPresetThemes] = useState<PresetTheme[]>([])
  const [showColorEditor, setShowColorEditor] = useState(false)
  const [previewColors, setPreviewColors] = useState<ThemeOverrides | null>(null)
  const previewStyleRef = useRef<HTMLStyleElement | null>(null)

  // Resolved initial colors for the color editor (preview colors take priority over resolved theme)
  const initialColors = useMemo(() => {
    const base = previewColors ?? resolvedTheme
    return {
      background:  base.background  ?? DEFAULT_THEME.background  ?? '',
      foreground:  base.foreground  ?? DEFAULT_THEME.foreground  ?? '',
      accent:      base.accent      ?? DEFAULT_THEME.accent      ?? '',
      info:        base.info        ?? DEFAULT_THEME.info        ?? '',
      success:     base.success     ?? DEFAULT_THEME.success     ?? '',
      destructive: base.destructive ?? DEFAULT_THEME.destructive ?? '',
    }
  }, [previewColors, resolvedTheme])

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // AI Connection state
  const [userConnections, setUserConnections] = useState<ProviderConnection[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [currentAuthType, setCurrentAuthType] = useState<string>('api_key')
  const [isValidatingConnection, setIsValidatingConnection] = useState(false)
  const [connectionValidationError, setConnectionValidationError] = useState<string | null>(null)

  // Send message key state
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter'>('enter')

  // Version state
  const [appVersion, setAppVersion] = useState<string | null>(null)

  // Load preset themes on mount
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.loadPresetThemes().then(themes => {
      setPresetThemes(themes ?? [])
    }).catch(() => {})
  }, [])

  // Preset theme options for dropdown
  const themeOptions = useMemo(() => [
    { value: 'default', label: t('appearanceSettings.default') },
    ...presetThemes
      .filter(th => th.id !== 'default')
      .map(th => ({ value: th.id, label: th.theme.name || th.id })),
  ], [presetThemes, t])

  const handlePreview = useCallback((colors: ThemeOverrides) => {
    if (!previewStyleRef.current) {
      const el = document.createElement('style')
      el.id = 'theme-preview'
      document.head.appendChild(el)
      previewStyleRef.current = el
    }
    previewStyleRef.current.textContent = `:root {\n  ${themeToCSS(colors, isDark)}\n}`
    setPreviewColors(colors)
  }, [isDark])

  const handleClose = useCallback(() => {
    setShowColorEditor(false)
  }, [])

  const handleCancel = useCallback(() => {
    previewStyleRef.current?.remove()
    previewStyleRef.current = null
    setPreviewColors(null)
    setShowColorEditor(false)
  }, [])

  const handleCreateNew = useCallback(async (name: string, colors: ThemeOverrides) => {
    previewStyleRef.current?.remove()
    previewStyleRef.current = null
    setPreviewColors(null)
    const newId = await window.electronAPI?.createPresetTheme?.(name, colors)
    if (newId) {
      const themes = await window.electronAPI.loadPresetThemes()
      setPresetThemes(themes ?? [])
      setColorTheme(newId)
    }
  }, [setColorTheme])

  // Load connections, active connection, model, send key, and notifications on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [connections, activeId, sendKey, notificationsOn, apiSetup] = await Promise.all([
          window.electronAPI.listConnections(),
          window.electronAPI.getActiveConnectionId(),
          window.electronAPI.getSendMessageKey(),
          window.electronAPI.getNotificationsEnabled(),
          window.electronAPI.getApiSetup(),
        ])
        setUserConnections(connections ?? [])
        setActiveConnectionId(activeId ?? null)
        setCurrentAuthType(apiSetup?.authType ?? 'api_key')
        setSendMessageKey(sendKey)
        setNotificationsEnabled(notificationsOn)
        window.electronAPI.getUpdateInfo().then(info => setAppVersion(info.currentVersion)).catch(() => {})
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    loadSettings()
  }, [])

  const handleConnectionChange = useCallback(async (newValue: string) => {
    // Claude Subscription is managed in Providers settings
    if (newValue === 'claude_subscription') {
      navigate(routes.view.settings('providers'))
      return
    }

    const newId = newValue

    // Validate the connection before switching
    if (newId !== null) {
      setIsValidatingConnection(true)
      try {
        const result = await window.electronAPI.testConnectionById(newId)
        if (!result.success) {
          setConnectionValidationError(result.error ?? 'Connection test failed.')
          return
        }
      } catch {
        setConnectionValidationError('Connection test failed unexpectedly.')
        return
      } finally {
        setIsValidatingConnection(false)
      }
    }

    await window.electronAPI.setActiveConnection(newId)
    setActiveConnectionId(newId)

    setCurrentAuthType('custom_api')
    const conn = userConnections.find(c => c.id === newId)
    const modelId = conn?.models.balanced ?? conn?.models.best ?? ''
    if (modelId) {
      onGlobalModelChange(modelId)
    }

    // Sync global context: customModel, currentAuthType, and provider
    await refreshCustomModel()
  }, [userConnections, onGlobalModelChange, refreshCustomModel])

  const handleSendMessageKeyChange = useCallback((value: string) => {
    const key = value as 'enter' | 'cmd-enter'
    setSendMessageKey(key)
    window.electronAPI.setSendMessageKey(key)
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('appSettings.title')} actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Notifications */}
            <SettingsSection title={t('appSettings.notifications')}>
              <SettingsCard>
                <SettingsToggle
                  label={t('appSettings.desktopNotifications')}
                  description={t('appSettings.desktopNotificationsDesc')}
                  checked={notificationsEnabled}
                  onCheckedChange={handleNotificationsEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            {/* AI Connection */}
            <SettingsSection title="AI Connection" description="Configure your AI service provider and model">
              <SettingsCard>
                <SettingsMenuSelectRow
                  label="Provider"
                  description={isValidatingConnection ? 'Validating connection…' : 'Select your AI service provider'}
                  value={activeConnectionId ?? (currentAuthType === 'oauth_token' ? 'claude_subscription' : '')}
                  onValueChange={handleConnectionChange}
                  disabled={isValidatingConnection}
                  options={[
                    { value: 'claude_subscription', label: 'Claude Subscription', description: 'claude.ai · Your personal account' },
                    ...userConnections.map(conn => {
                      let host = conn.endpoint
                      try { host = new URL(conn.endpoint).hostname } catch { /* keep raw */ }
                      return {
                        value: conn.id,
                        label: conn.name,
                        description: `${CONNECTION_TYPE_LABELS[conn.type] ?? conn.type} · ${host}`,
                      }
                    }),
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Connection validation error dialog */}
            {connectionValidationError && (
              <Dialog open onOpenChange={(open) => { if (!open) setConnectionValidationError(null) }}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Connection Failed</DialogTitle>
                    <DialogDescription>{connectionValidationError}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConnectionValidationError(null)}>
                      Cancel
                    </Button>
                    <Button onClick={() => {
                      setConnectionValidationError(null)
                      navigate(routes.view.settings('providers'))
                    }}>
                      Go to Providers
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

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
                <SettingsRow
                  label={t('appSettings.customizeColors')}
                  description={t('appSettings.customizeColorsDesc')}
                  onClick={() => setShowColorEditor(v => !v)}
                >
                  {showColorEditor
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  }
                </SettingsRow>
                {showColorEditor && (
                  <ThemeColorEditor
                    initialColors={initialColors}
                    baseTheme={(previewColors ?? resolvedTheme ?? DEFAULT_THEME) as ThemeOverrides}
                    onPreview={handlePreview}
                    onCreateNew={handleCreateNew}
                    onClose={handleClose}
                    onCancel={handleCancel}
                  />
                )}
              </SettingsCard>
            </SettingsSection>

            {/* Sending */}
            <SettingsSection title={t('inputSettings.sending')} description={t('inputSettings.sendingDesc')}>
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={t('inputSettings.sendMessageWith')}
                  description={t('inputSettings.sendMessageWithDesc')}
                  value={sendMessageKey}
                  onValueChange={handleSendMessageKeyChange}
                  options={[
                    { value: 'enter', label: t('inputSettings.enter'), description: t('inputSettings.shiftEnterNewLines') },
                    { value: 'cmd-enter', label: t('inputSettings.cmdEnter'), description: t('inputSettings.enterNewLines') },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* About */}
            <SettingsSection title={t('appSettings.about')}>
              <SettingsCard>
                <SettingsRow label={t('appSettings.version')}>
                  <span className="text-muted-foreground">
                    {appVersion ?? t('common.loading')}
                  </span>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>
          </div>
        </div>
        </ScrollArea>
      </div>
    </div>
  )
}
