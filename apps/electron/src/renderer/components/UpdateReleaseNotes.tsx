import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@opentomo/ui'
import { useRegisterModal } from '@/context/ModalContext'
import { useTranslation } from 'react-i18next'

interface UpdateReleaseNotesProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  onInstall: () => void
}

interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  published_at: string
}

/**
 * UpdateReleaseNotes - Displays release notes from GitHub for an update
 *
 * Fetches release information from the GitHub API and displays
 * the markdown release notes along with an install button.
 */
export function UpdateReleaseNotes({
  open,
  onOpenChange,
  version,
  onInstall,
}: UpdateReleaseNotesProps) {
  const { t } = useTranslation()
  const [releaseData, setReleaseData] = useState<GitHubRelease | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Register with modal context so X button / Cmd+W closes this dialog first
  useRegisterModal(open, () => onOpenChange(false))

  // Fetch release notes when dialog opens
  useEffect(() => {
    if (!open || !version) return

    const fetchReleaseNotes = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // GitHub API endpoint for a specific release
        // Public API, no auth required for public repos
        const tag = version.startsWith('v') ? version : `v${version}`
        const url = `https://api.github.com/repos/OpenTomo/opentomo-app-release/releases/tags/${tag}`

        const response = await fetch(url, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
          },
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch release notes: ${response.statusText}`)
        }

        const data: GitHubRelease = await response.json()
        setReleaseData(data)
      } catch (err) {
        console.error('[UpdateReleaseNotes] Error fetching release:', err)
        setError(err instanceof Error ? err.message : 'Failed to load release notes')
      } finally {
        setIsLoading(false)
      }
    }

    fetchReleaseNotes()
  }, [open, version])

  const handleInstall = () => {
    onOpenChange(false)
    onInstall()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {t('appSettings.whatsNew')} v{version}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-4">
          {isLoading && (
            <div className="flex items-center justify-center h-32">
              <Spinner />
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive">
              {error}
            </div>
          )}

          {!isLoading && !error && releaseData && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-4">
                {/* Release name */}
                {releaseData.name && (
                  <div className="font-medium text-foreground">
                    {releaseData.name}
                  </div>
                )}

                {/* Published date */}
                {releaseData.published_at && (
                  <div className="text-xs text-muted-foreground">
                    {new Date(releaseData.published_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                )}

                {/* Release body (markdown) */}
                {releaseData.body && (
                  <div className="text-sm text-foreground/90 whitespace-pre-wrap">
                    {releaseData.body}
                  </div>
                )}

                {!releaseData.body && (
                  <div className="text-sm text-muted-foreground">
                    {t('appSettings.noReleaseNotes')}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button onClick={handleInstall}>
            {t('appSettings.installAndRestart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
