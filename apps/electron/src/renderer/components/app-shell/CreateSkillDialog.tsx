/**
 * CreateSkillDialog
 *
 * Dialog presented when the user clicks the "Add Skill" (+) button.
 * Offers two options:
 *   1. Create from scratch — opens a chat with the skill-creator AI guide
 *   2. Import from folder  — opens a native folder picker, then opens a chat
 *                            with the selected folder as the working directory
 */

import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useRegisterModal } from '@/context/ModalContext'
import { cn } from '@/lib/utils'

interface CreateSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateFromScratch: () => void
  onImportFromFolder: () => void
}

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreateFromScratch,
  onImportFromFolder,
}: CreateSkillDialogProps) {
  const { t } = useTranslation()

  useRegisterModal(open, () => onOpenChange(false))

  const optionClass = cn(
    'flex items-start gap-3 px-4 py-3.5 text-left rounded-[10px] transition-colors outline-none',
    'bg-foreground/[0.02] hover:bg-foreground/[0.06] border border-border/40 hover:border-border/60',
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('createSkillDialog.title', 'Add Skill')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {/* Option 1: Create from scratch */}
          <button
            type="button"
            className={optionClass}
            onClick={() => {
              onOpenChange(false)
              onCreateFromScratch()
            }}
          >
            <Zap className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-tight">
                {t('createSkillDialog.createFromScratch', 'Create from scratch')}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t('createSkillDialog.createFromScratchDesc', 'Use AI to guide you through building a new skill')}
              </span>
            </div>
          </button>

          {/* Option 2: Import from folder */}
          <button
            type="button"
            className={optionClass}
            onClick={() => {
              onOpenChange(false)
              onImportFromFolder()
            }}
          >
            <FolderOpen className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-tight">
                {t('createSkillDialog.importFromFolder', 'Import from folder')}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t('createSkillDialog.importFromFolderDesc', 'Select a SKILL folder — AI will help you install it')}
              </span>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
