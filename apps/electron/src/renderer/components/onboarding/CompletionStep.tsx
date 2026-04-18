import { useTranslation } from 'react-i18next'
import { Button } from "@/components/ui/button"
import { Spinner } from "@opentomo/ui"
import { OpenTomoSymbol } from "@/components/icons/OpenTomoSymbol"
import { StepFormLayout } from "./primitives"

interface CompletionStepProps {
  status: 'saving' | 'complete'
  spaceName?: string
  onFinish: () => void
}

/**
 * CompletionStep - Success screen after onboarding
 *
 * Shows:
 * - saving: Spinner while saving configuration
 * - complete: Success message with option to start
 */
export function CompletionStep({
  status,
  spaceName,
  onFinish
}: CompletionStepProps) {
  const { t } = useTranslation()
  const isSaving = status === 'saving'

  return (
    <StepFormLayout
      iconElement={isSaving ? (
        <div className="flex size-48 items-center justify-center">
          <Spinner className="text-6xl text-foreground" />
        </div>
      ) : (
        <div className="flex size-48 items-center justify-center">
          <OpenTomoSymbol className="size-40 text-accent" />
        </div>
      )}
      title={isSaving ? t('onboarding.settingUp') : t('onboarding.allSet')}
      description={
        isSaving ? (
          t('onboarding.savingConfig')
        ) : (
          t('onboarding.startChatting')
        )
      }
      actions={
        status === 'complete' ? (
          <Button onClick={onFinish} className="w-full max-w-[320px] bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg" size="lg">
            {t('onboarding.getStarted')}
          </Button>
        ) : undefined
      }
    />
  )
}
