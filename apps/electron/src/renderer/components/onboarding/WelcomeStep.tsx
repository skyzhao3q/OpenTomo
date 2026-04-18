import { useTranslation } from 'react-i18next'
import { OpenTomoSymbol } from "@/components/icons/OpenTomoSymbol"
import { StepFormLayout, ContinueButton } from "./primitives"

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
  /** Whether the app is loading (e.g., checking Git Bash on Windows) */
  isLoading?: boolean
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * Shows different messaging for new vs existing users:
 * - New users: Welcome to OpenTomo
 * - Existing users: Update your API connection settings
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false
}: WelcomeStepProps) {
  const { t } = useTranslation()

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-48 items-center justify-center">
          <OpenTomoSymbol className="size-40 text-accent" />
        </div>
      }
      title={isExistingUser ? t('onboarding.updateSettings') : t('onboarding.welcomeTitle')}
      description={
        isExistingUser
          ? t('onboarding.updateSettingsDesc')
          : t('onboarding.welcomeDesc')
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full" loading={isLoading} loadingText={t('appSettings.checking')}>
          {isExistingUser ? t('common.continue') : t('onboarding.getStarted')}
        </ContinueButton>
      }
    />
  )
}
