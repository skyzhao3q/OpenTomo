import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// Mirror of ProviderConnection from packages/shared (renderer cannot import main-process packages)
interface ProviderConnection {
  id: string
  name: string
  type: string
  endpoint: string
  models: { best?: string; balanced?: string; fast?: string }
  createdAt: number
}

type AIStatus = 'loading' | 'connected' | 'error'

export interface AIConnectionStatusProps {
  /** null = OpenTomo default provider or Claude Subscription (check authType) */
  activeConnectionId: string | null
  /** Current auth type — used to distinguish OpenTomo vs Claude Subscription when activeConnectionId is null */
  authType?: string
  connections: ProviderConnection[]
  isLoading: boolean
  hasError?: boolean
}

export function AIConnectionStatus({
  activeConnectionId,
  authType,
  connections,
  isLoading,
  hasError,
}: AIConnectionStatusProps) {
  const { t } = useTranslation()

  const status: AIStatus = (() => {
    if (isLoading) return 'loading'
    if (hasError) return 'error'
    return 'connected'
  })()

  const label = (() => {
    if (status === 'loading') return t('sidebar.aiStatus.connecting')
    if (status === 'error') return t('sidebar.aiStatus.error')
    if (activeConnectionId === null) {
      return authType === 'oauth_token' ? 'Claude' : t('sidebar.aiStatus.connected')
    }
    const conn = connections.find(c => c.id === activeConnectionId)
    return conn?.name ?? t('sidebar.aiStatus.connected')
  })()

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/30 select-none">
      {/* Status dot */}
      <span
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          status === 'loading' && 'bg-yellow-400 animate-pulse',
          status === 'connected' && 'bg-green-500',
          status === 'error' && 'bg-red-500',
        )}
        aria-hidden="true"
      />
      <span className="text-xs text-muted-foreground truncate">{label}</span>
    </div>
  )
}
