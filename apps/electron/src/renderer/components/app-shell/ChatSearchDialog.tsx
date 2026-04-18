/**
 * ChatSearchDialog - Global chat history search dialog
 *
 * Opened via the search icon in the left navigation bar or Cmd+F.
 * Shows recent sessions when query is empty, full-text search results otherwise.
 * Clicking a result navigates to that chat and closes the dialog.
 */

import * as React from 'react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, Inbox, MessageSquare } from 'lucide-react'
import { isToday, isYesterday, formatDistanceToNowStrict } from 'date-fns'
import { useAtomValue } from 'jotai'
import { fuzzyMatch } from '@opentomo/shared/search'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Spinner } from '@opentomo/ui'
import { cn } from '@/lib/utils'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import { navigate, routes } from '@/lib/navigate'
import { useRegisterModal } from '@/context/ModalContext'

export interface ChatSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
}

interface SearchResult {
  sessionId: string
  title: string
  snippet?: string
  lastMessageAt?: number
  matchCount?: number
}

function formatRelativeDate(timestamp: number | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return formatDistanceToNowStrict(date, { addSuffix: true })
}

export function ChatSearchDialog({ open, onOpenChange, workspaceId }: ChatSearchDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchIdRef = useRef<string>('')

  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  useRegisterModal(open, () => onOpenChange(false))

  // Recent sessions: sorted by lastMessageAt desc, max 20
  const recentSessions = useMemo((): SearchResult[] => {
    const metas = Array.from(sessionMetaMap.values())
      .filter(m => m.workspaceId === workspaceId && !('hidden' in m && m.hidden))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, 20)
    return metas.map(m => ({
      sessionId: m.id,
      title: getSessionTitle(m),
      lastMessageAt: m.lastMessageAt,
    }))
  }, [sessionMetaMap, workspaceId])

  // Items to display in list
  const displayItems = query.length >= 2 ? searchResults : recentSessions

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setSearchResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keep selectedIndex in bounds when items change
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, displayItems.length - 1)))
  }, [displayItems.length])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]')
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      const searchId = Date.now().toString(36)
      searchIdRef.current = searchId

      try {
        const results = await window.electronAPI.searchSessionContent(workspaceId, query, searchId)

        // Ignore stale results
        if (searchIdRef.current !== searchId) return

        const mapped: SearchResult[] = results.map((r: { sessionId: string; matchCount: number; matches: Array<{ snippet: string }> }) => {
          const meta = sessionMetaMap.get(r.sessionId)
          const title = meta ? getSessionTitle(meta) : r.sessionId
          const snippet = r.matches?.[0]?.snippet
          return {
            sessionId: r.sessionId,
            title,
            snippet,
            lastMessageAt: meta?.lastMessageAt,
            matchCount: r.matchCount,
          }
        })

        // Also include sessions whose title fuzzy-matches the query but weren't found by ripgrep
        const resultIds = new Set(mapped.map(r => r.sessionId))
        const titleMatches: SearchResult[] = Array.from(sessionMetaMap.values())
          .filter(m =>
            m.workspaceId === workspaceId &&
            !m.hidden &&
            !resultIds.has(m.id) &&
            fuzzyMatch(getSessionTitle(m), query)
          )
          .map(m => ({
            sessionId: m.id,
            title: getSessionTitle(m),
            lastMessageAt: m.lastMessageAt,
          }))

        setSearchResults([...mapped, ...titleMatches])
        setSelectedIndex(0)
      } finally {
        if (searchIdRef.current === searchId) {
          setIsSearching(false)
        }
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, workspaceId, sessionMetaMap])

  const handleSelect = useCallback((sessionId: string) => {
    navigate(routes.view.allChats(sessionId))
    onOpenChange(false)
  }, [onOpenChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, displayItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = displayItems[selectedIndex]
      if (item) handleSelect(item.sessionId)
    }
  }, [displayItems, selectedIndex, handleSelect])

  const isSearchMode = query.length >= 2

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'popover-styled fixed top-[20%] left-[50%] z-modal w-[460px] max-w-[calc(100%-2rem)]',
            'translate-x-[-50%] overflow-hidden rounded-xl outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-150',
          )}
          onKeyDown={handleKeyDown}
          aria-label={t('chatSearch.placeholder')}
        >
          <DialogPrimitive.Title className="sr-only">{t('chatSearch.placeholder')}</DialogPrimitive.Title>

          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('chatSearch.placeholder')}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              autoComplete="off"
              spellCheck={false}
            />
            {isSearching ? (
              <Spinner className="text-[10px] text-foreground/40 shrink-0" />
            ) : query ? (
              <button
                onClick={() => setQuery('')}
                className="p-0.5 hover:bg-foreground/10 rounded shrink-0"
                tabIndex={-1}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            ) : null}
          </div>

          {/* Results list */}
          <div ref={listRef} className="overflow-y-auto max-h-[360px] py-1">
            {/* Section label */}
            {displayItems.length > 0 && (
              <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide select-none">
                {isSearchMode
                  ? t('chatSearch.results', { count: displayItems.length })
                  : t('chatSearch.recent')}
              </div>
            )}

            {/* Items */}
            {displayItems.map((item, idx) => (
              <button
                key={item.sessionId}
                data-selected={idx === selectedIndex}
                onClick={() => handleSelect(item.sessionId)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={cn(
                  'w-full flex items-start gap-2.5 px-3 py-2 text-left outline-none transition-colors',
                  idx === selectedIndex
                    ? 'bg-foreground/[0.07]'
                    : 'hover:bg-foreground/[0.04]',
                )}
              >
                {/* Icon */}
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 flex items-center justify-center text-muted-foreground/50">
                  {item.snippet ? (
                    <MessageSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Inbox className="h-3.5 w-3.5" />
                  )}
                </span>

                {/* Title + snippet */}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] leading-snug truncate text-foreground/90">
                    {item.title}
                  </div>
                  {item.snippet && (
                    <div className="text-[11px] leading-snug text-muted-foreground/60 truncate mt-0.5">
                      {item.snippet}
                    </div>
                  )}
                </div>

                {/* Date */}
                {item.lastMessageAt && (
                  <span className="shrink-0 text-[11px] text-muted-foreground/40 mt-0.5">
                    {formatRelativeDate(item.lastMessageAt)}
                  </span>
                )}
              </button>
            ))}

            {/* Empty state */}
            {isSearchMode && !isSearching && displayItems.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground/50">
                {t('chatSearch.noResults')}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
