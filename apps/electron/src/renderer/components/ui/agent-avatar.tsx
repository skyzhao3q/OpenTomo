import * as React from 'react'
import { OpenTomoAgentsSymbol } from '@/components/icons/OpenTomoAgentsSymbol'
import { cn } from '@/lib/utils'

interface AgentAvatarProps {
  className?: string
}

export function AgentAvatar({ className }: AgentAvatarProps) {
  return <OpenTomoAgentsSymbol className={cn('h-5 w-5', className)} />
}
