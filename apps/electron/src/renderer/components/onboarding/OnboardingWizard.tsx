import { cn } from "@/lib/utils"
import { WelcomeStep } from "./WelcomeStep"
import { PrerequisitesStep } from "./PrerequisitesStep"
import { CompletionStep } from "./CompletionStep"
import { GitBashWarning, type GitBashStatus } from "./GitBashWarning"
import type { PrerequisitesCheckResult } from "../../../shared/types"

export type OnboardingStep =
  | 'welcome'
  | 'prerequisites'
  | 'git-bash'
  | 'complete'

export interface OnboardingState {
  step: OnboardingStep
  completionStatus: 'saving' | 'complete'
  isExistingUser: boolean
  errorMessage?: string
  gitBashStatus?: GitBashStatus
  isRecheckingGitBash?: boolean
  isCheckingGitBash?: boolean
  // Prerequisites checking
  prerequisitesStatus?: PrerequisitesCheckResult
  isCheckingPrerequisites?: boolean
  isRecheckingPrerequisites?: boolean
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onContinue: () => void
  onBack: () => void
  onFinish: () => void

  // Prerequisites
  onRecheckPrerequisites?: () => void

  // Git Bash (Windows)
  onBrowseGitBash?: () => Promise<string | null>
  onUseGitBashPath?: (path: string) => void
  onRecheckGitBash?: () => void
  onClearError?: () => void

  className?: string
}

/**
 * OnboardingWizard - Full-screen onboarding flow container
 *
 * Manages the step-by-step flow for setting up OpenTomo:
 * 1. Welcome
 * 2. Prerequisites (Bun, Node.js 18+, Git)
 * 3. Git Bash (Windows only, if not found)
 * 4. Completion (workspace creation)
 */
export function OnboardingWizard({
  state,
  onContinue,
  onBack,
  onFinish,
  // Prerequisites
  onRecheckPrerequisites,
  // Git Bash (Windows)
  onBrowseGitBash,
  onUseGitBashPath,
  onRecheckGitBash,
  onClearError,
  className
}: OnboardingWizardProps) {
  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
            isLoading={state.isCheckingGitBash || state.isCheckingPrerequisites}
          />
        )

      case 'prerequisites':
        return (
          <PrerequisitesStep
            status={state.prerequisitesStatus!}
            onRecheck={onRecheckPrerequisites!}
            onContinue={onContinue}
            isRechecking={state.isRecheckingPrerequisites}
          />
        )

      case 'git-bash':
        return (
          <GitBashWarning
            status={state.gitBashStatus!}
            onBrowse={onBrowseGitBash!}
            onUsePath={onUseGitBashPath!}
            onRecheck={onRecheckGitBash!}
            onBack={onBack}
            isRechecking={state.isRecheckingGitBash}
            errorMessage={state.errorMessage}
            onClearError={onClearError}
          />
        )

      case 'complete':
        return (
          <CompletionStep
            status={state.completionStatus}
            onFinish={onFinish}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-foreground-2",
        !className?.includes('h-full') && "min-h-screen",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-8">
        {renderStep()}
      </main>
    </div>
  )
}
