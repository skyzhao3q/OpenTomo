/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { StoplightProvider } from '@/context/StoplightContext'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import {
  useNavigationState,
  isChatsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
} from '@/contexts/NavigationContext'
import { AppSettingsPage, AppearanceSettingsPage, InputSettingsPage, WorkspaceSettingsPage, PermissionsSettingsPage, ShortcutsPage, SkillsCatalogSettingsPage, ProvidersSettingsPage, ChatPage } from '@/pages'
import SkillInfoPage from '@/pages/SkillInfoPage'

export interface MainContentPanelProps {
  /** Whether the app is in focused mode (single chat, no sidebar) */
  isFocusedMode?: boolean
  /** Optional className for the container */
  className?: string
}

export function MainContentPanel({
  isFocusedMode = false,
  className,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const { activeWorkspaceId } = useAppShellContext()

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isFocusedMode}>
      {content}
    </StoplightProvider>
  )

  // Settings navigator - always has content (subpage determines which page)
  if (isSettingsNavigation(navState)) {
    switch (navState.subpage) {
      case 'appearance':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AppearanceSettingsPage />
          </Panel>
        )
      case 'input':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <InputSettingsPage />
          </Panel>
        )
      case 'workspace':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <WorkspaceSettingsPage />
          </Panel>
        )
      case 'permissions':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <PermissionsSettingsPage />
          </Panel>
        )
      case 'shortcuts':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <ShortcutsPage />
          </Panel>
        )
      case 'skills':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <SkillsCatalogSettingsPage />
          </Panel>
        )
      case 'providers':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <ProvidersSettingsPage />
          </Panel>
        )
      case 'app':
      default:
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AppSettingsPage />
          </Panel>
        )
    }
  }

  // Skills navigator - show skill info or empty state
  if (isSkillsNavigation(navState)) {
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">No skills configured</p>
        </div>
      </Panel>
    )
  }

  // Chats navigator - show chat or empty state
  if (isChatsNavigation(navState)) {
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }
    // No session selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
          <AgentAvatar className="h-12 w-12" />
          <p className="text-sm text-muted-foreground">
            {t('mainContent.noConversations')}
          </p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
        <AgentAvatar className="h-12 w-12" />
        <p className="text-sm text-muted-foreground">{t('mainContent.noConversations')}</p>
      </div>
    </Panel>
  )
}
