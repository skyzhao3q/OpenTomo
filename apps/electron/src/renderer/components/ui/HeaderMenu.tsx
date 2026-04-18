/**
 * HeaderMenu
 *
 * A "..." dropdown menu for panel headers.
 * Pass page-specific menu items as children.
 * Optionally includes a "Learn More" link to documentation when helpFeature is provided.
 */

import * as React from 'react'
import { MoreHorizontal, ExternalLink } from 'lucide-react'
import { HeaderIconButton } from './HeaderIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from './styled-dropdown'
import { type DocFeature, getDocUrl } from '@opentomo/shared/docs/doc-links'

interface HeaderMenuProps {
  /** Route string (kept for compatibility) */
  route: string
  /** Page-specific menu items */
  children?: React.ReactNode
  /** Documentation feature - when provided, adds a "Learn More" link to docs */
  helpFeature?: DocFeature
}

export function HeaderMenu({ route, children, helpFeature }: HeaderMenuProps) {
  const handleLearnMore = helpFeature ? () => {
    window.electronAPI?.openUrl(getDocUrl(helpFeature))
  } : undefined

  // If no children and no help feature, don't render the menu
  if (!children && !helpFeature) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton icon={<MoreHorizontal className="h-4 w-4" />} />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {children}
        {helpFeature && (
          <>
            {children && <StyledDropdownMenuSeparator />}
            <StyledDropdownMenuItem onClick={handleLearnMore}>
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="flex-1">Learn More</span>
            </StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
