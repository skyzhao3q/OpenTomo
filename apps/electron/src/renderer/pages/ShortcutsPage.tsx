/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference.
 */

import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { isMac } from '@/lib/platform'

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

const cmdKey = isMac ? '⌘' : 'Ctrl'

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium bg-muted border border-border rounded shadow-sm ${className || ''}`}>
      {children}
    </kbd>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation()

  const sections: ShortcutSection[] = useMemo(() => [
    {
      title: t('shortcuts.global'),
      shortcuts: [
        { keys: [cmdKey, '1'], description: t('shortcuts.focusSidebar') },
        { keys: [cmdKey, '2'], description: t('shortcuts.focusSessionList') },
        { keys: [cmdKey, '3'], description: t('shortcuts.focusChatInput') },
        { keys: [cmdKey, 'N'], description: t('shortcuts.newChat') },
        { keys: [cmdKey, 'B'], description: t('shortcuts.toggleSidebar') },
        { keys: [cmdKey, ','], description: t('shortcuts.openSettings') },
        { keys: [cmdKey, '/'], description: t('shortcuts.showShortcuts') },
      ],
    },
    {
      title: t('shortcuts.navigation'),
      shortcuts: [
        { keys: ['Tab'], description: t('shortcuts.moveNextZone') },
        { keys: ['Shift', 'Tab'], description: t('shortcuts.movePrevZone') },
        { keys: ['←', '→'], description: t('shortcuts.moveBetweenZones') },
        { keys: ['↑', '↓'], description: t('shortcuts.navigateItems') },
        { keys: ['Home'], description: t('shortcuts.goToFirst') },
        { keys: ['End'], description: t('shortcuts.goToLast') },
        { keys: ['Esc'], description: t('shortcuts.closeDialog') },
      ],
    },
    {
      title: t('shortcuts.sessionList'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.focusChatInput') },
        { keys: ['Delete'], description: t('shortcuts.deleteSession') },
        { keys: ['R'], description: t('shortcuts.renameSession') },
        { keys: ['Right-click'], description: t('shortcuts.openContextMenu') },
      ],
    },
    {
      title: t('shortcuts.agentTree'),
      shortcuts: [
        { keys: ['←'], description: t('shortcuts.collapseFolder') },
        { keys: ['→'], description: t('shortcuts.expandFolder') },
      ],
    },
    {
      title: t('shortcuts.chat'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('shortcuts.newLine') },
        { keys: [cmdKey, 'Enter'], description: t('shortcuts.sendMessage') },
        { keys: ['Esc'], description: t('shortcuts.stopAgent') },
      ],
    },
  ], [t])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('shortcuts.title')} actions={<HeaderMenu route={routes.view.settings('shortcuts')} />} />
      <Separator />
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 pb-1.5 border-b border-border/50">
                  {section.title}
                </h3>
                <div className="space-y-0.5">
                  {section.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="group flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <div className="flex-1 mx-3 h-px bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_8px)] opacity-0 group-hover:opacity-15" />
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <Kbd key={keyIndex} className="group-hover:bg-foreground/10 group-hover:border-foreground/20">{key}</Kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
