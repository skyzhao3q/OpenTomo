/**
 * SkillsCatalogSettingsPage
 *
 * Skills manager settings page.
 * - Shows total skill count (builtin + custom)
 * - Built-in skills: count only (no list)
 * - Custom skills (global / workspace / project): list with enable/disable toggle
 * - Search by name, description, or path
 * - Open Folder: opens workspace skills directory in Finder/Explorer
 * - Refresh: re-reads skills from filesystem and validates
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Search, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { Info_Markdown } from '@/components/info'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { LoadedSkill } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'skills',
}

export default function SkillsCatalogSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()

  const [allSkills, setAllSkills] = useState<LoadedSkill[]>([])
  const [disabledSlugs, setDisabledSlugs] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const result = await window.electronAPI.getSkillsCatalog(activeWorkspaceId)
      setAllSkills(result.skills)
      setDisabledSlugs(new Set(result.disabledSlugs))
    } catch (err) {
      console.error('Failed to load skills catalog:', err)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    setLoading(true)
    loadData().finally(() => setLoading(false))
  }, [loadData])

  const handleRefresh = useCallback(async () => {
    if (!activeWorkspaceId || refreshing) return
    setRefreshing(true)
    try {
      await loadData()
    } finally {
      setRefreshing(false)
    }
  }, [activeWorkspaceId, refreshing, loadData])

  const handleToggle = useCallback(async (slug: string, enabled: boolean) => {
    if (!activeWorkspaceId) return
    // Optimistic update
    setDisabledSlugs(prev => {
      const next = new Set(prev)
      if (enabled) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
    try {
      await window.electronAPI.toggleSkillEnabled(activeWorkspaceId, slug, enabled)
    } catch (err) {
      console.error('Failed to toggle skill:', err)
      // Revert on error
      setDisabledSlugs(prev => {
        const next = new Set(prev)
        if (enabled) {
          next.add(slug)
        } else {
          next.delete(slug)
        }
        return next
      })
    }
  }, [activeWorkspaceId])

  const builtinSkills = useMemo(() => allSkills.filter(s => s.source === 'builtin'), [allSkills])
  const customSkills = useMemo(() => allSkills.filter(s => s.source !== 'builtin'), [allSkills])

  const filteredCustomSkills = useMemo(() => {
    if (!search.trim()) return customSkills
    const q = search.toLowerCase()
    return customSkills.filter(s =>
      s.metadata.name.toLowerCase().includes(q) ||
      s.metadata.description.toLowerCase().includes(q) ||
      s.path.toLowerCase().includes(q)
    )
  }, [customSkills, search])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('skillsCatalog.title', 'Skills')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {t('skillsCatalog.refresh', 'Refresh')}
          </Button>
        }
      />

      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-5 max-w-3xl mx-auto space-y-4">

            {/* Total count */}
            {!loading && (
              <p className="text-sm text-muted-foreground">
                {t('skillsCatalog.totalAvailable', '{{count}} skill(s) available', { count: allSkills.length })}
              </p>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('skillsCatalog.searchPlaceholder', 'Search skills by name, description, or path...')}
                className={cn(
                  'w-full h-8 pl-8 pr-3 text-sm rounded-md',
                  'bg-background border border-border/60',
                  'placeholder:text-muted-foreground/60',
                  'focus:outline-none focus:ring-1 focus:ring-ring'
                )}
              />
            </div>

            {/* Built-in Skills — count only */}
            <div className="rounded-xl bg-background shadow-minimal px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t('skillsCatalog.builtinSkills', 'Built-in Skills')}
                </span>
              </div>
              <Badge variant="secondary" className="text-xs font-mono">
                {loading ? '…' : builtinSkills.length}
              </Badge>
            </div>

            <Separator />

            {/* Custom Skills */}
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-xl bg-background shadow-minimal h-16 animate-pulse" />
                ))}
              </div>
            ) : filteredCustomSkills.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                {search
                  ? t('skillsCatalog.noSearchResults', 'No skills match your search.')
                  : t('skillsCatalog.noCustomSkills', 'No custom skills added yet. Click "Open Folder" to add skills.')
                }
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCustomSkills.map(skill => (
                  <SkillRow
                    key={skill.slug}
                    skill={skill}
                    enabled={!disabledSlugs.has(skill.slug)}
                    expanded={expandedSlug === skill.slug}
                    onToggleExpand={() => setExpandedSlug(prev => prev === skill.slug ? null : skill.slug)}
                    onToggleEnabled={(enabled) => handleToggle(skill.slug, enabled)}
                    workspaceId={activeWorkspaceId || ''}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillRow
// ─────────────────────────────────────────────────────────────────────────────

interface SkillRowProps {
  skill: LoadedSkill
  enabled: boolean
  expanded: boolean
  onToggleExpand: () => void
  onToggleEnabled: (enabled: boolean) => void
  workspaceId: string
}

function SkillRow({ skill, enabled, expanded, onToggleExpand, onToggleEnabled, workspaceId }: SkillRowProps) {
  const { t } = useTranslation()

  return (
    <div className={cn(
      'rounded-xl bg-background shadow-minimal overflow-hidden transition-all',
      !enabled && 'opacity-60'
    )}>
      {/* Main row */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="shrink-0 mt-0.5">
            <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm leading-tight">{skill.metadata.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {skill.metadata.description}
                </div>
              </div>

              {/* Toggle */}
              <Switch
                checked={enabled}
                onCheckedChange={onToggleEnabled}
                aria-label={enabled
                  ? t('skillsCatalog.disableSkill', 'Disable skill')
                  : t('skillsCatalog.enableSkill', 'Enable skill')
                }
                className="shrink-0"
              />
            </div>

            {/* Path */}
            <div
              className="mt-1.5 text-[11px] text-muted-foreground/70 font-mono truncate"
              title={skill.path}
            >
              {skill.path}
            </div>
          </div>
        </div>
      </div>

      {/* View Content toggle */}
      <button
        type="button"
        onClick={onToggleExpand}
        className={cn(
          'w-full flex items-center gap-1 px-4 py-1.5 text-xs text-muted-foreground',
          'hover:text-foreground hover:bg-foreground/3 transition-colors',
          'border-t border-border/30'
        )}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />
        }
        {t('skillsCatalog.viewContent', 'View Content')}
      </button>

      {/* Expanded content */}
      {expanded && skill.content && (
        <div className="px-4 pb-4 border-t border-border/30">
          <Info_Markdown maxHeight={300}>
            {skill.content}
          </Info_Markdown>
        </div>
      )}
    </div>
  )
}
