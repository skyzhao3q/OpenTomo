/**
 * useOnboarding Hook
 *
 * Manages the state machine for the onboarding wizard.
 * Flow:
 * 1. Welcome
 * 2. Prerequisites (Bun, Node.js 18+, Git) — blocks until all satisfied
 * 3. Git Bash (Windows only, if not found)
 * 4. Complete (workspace creation)
 */
import { useState, useCallback, useEffect } from 'react'
import type {
  OnboardingState,
  OnboardingStep,
} from '@/components/onboarding'
import type { SetupNeeds } from '../../shared/types'

interface UseOnboardingOptions {
  /** Called when onboarding is complete */
  onComplete: () => void
  /** Initial setup needs from auth state check */
  initialSetupNeeds?: SetupNeeds
  /** Start the wizard at a specific step (default: 'welcome') */
  initialStep?: OnboardingStep
  /** Called when user goes back from the initial step (dismisses the wizard) */
  onDismiss?: () => void
  /** Called immediately after config is saved to disk (before wizard closes).
   *  Use this to propagate billing/model changes to the UI without waiting for onComplete. */
  onConfigSaved?: () => void
}

interface UseOnboardingReturn {
  // State
  state: OnboardingState

  // Wizard actions
  handleContinue: () => void
  handleBack: () => void

  // Prerequisites
  handleRecheckPrerequisites: () => void

  // Git Bash (Windows)
  handleBrowseGitBash: () => Promise<string | null>
  handleUseGitBashPath: (path: string) => void
  handleRecheckGitBash: () => void
  handleClearError: () => void

  // Completion
  handleFinish: () => void
  handleCancel: () => void

  // Reset
  reset: () => void
}

export function useOnboarding({
  onComplete,
  initialSetupNeeds,
  initialStep = 'welcome',
  onDismiss,
  onConfigSaved,
}: UseOnboardingOptions): UseOnboardingReturn {
  // Main wizard state
  const [state, setState] = useState<OnboardingState>({
    step: initialStep,
    completionStatus: 'saving',
    isExistingUser: initialSetupNeeds?.needsBillingConfig ?? false,
    gitBashStatus: undefined,
    isRecheckingGitBash: false,
    isCheckingGitBash: true, // Start as true until check completes
    isCheckingPrerequisites: true, // Start as true until check completes
  })

  // Check prerequisites on mount (Bun, Node.js 18+, Git)
  useEffect(() => {
    const checkPrerequisites = async () => {
      try {
        const result = await window.electronAPI.checkPrerequisites()
        setState(s => ({ ...s, prerequisitesStatus: result, isCheckingPrerequisites: false }))
      } catch (error) {
        console.error('[Onboarding] Failed to check prerequisites:', error)
        // On error, skip prerequisites step to avoid blocking
        setState(s => ({ ...s, isCheckingPrerequisites: false }))
      }
    }
    checkPrerequisites()
  }, [])

  // Check Git Bash on Windows when starting from welcome
  useEffect(() => {
    const checkGitBash = async () => {
      try {
        const status = await window.electronAPI.checkGitBash()
        setState(s => ({ ...s, gitBashStatus: status, isCheckingGitBash: false }))
      } catch (error) {
        console.error('[Onboarding] Failed to check Git Bash:', error)
        // Even on error, allow continuing (will skip git-bash step)
        setState(s => ({ ...s, isCheckingGitBash: false }))
      }
    }
    checkGitBash()
  }, [])

  // Save workspace (no credentials needed — API connection configured later in Settings)
  const handleSaveWorkspace = useCallback(async () => {
    setState(s => ({ ...s, step: 'complete', completionStatus: 'saving' }))
    try {
      const result = await window.electronAPI.saveOnboardingConfig({})
      if (result.success) {
        setState(s => ({ ...s, completionStatus: 'complete' }))
        onConfigSaved?.()
      } else {
        setState(s => ({ ...s, errorMessage: result.error || 'Failed to save' }))
      }
    } catch (error) {
      setState(s => ({ ...s, errorMessage: error instanceof Error ? error.message : 'Failed to save' }))
    }
  }, [onConfigSaved])

  // Continue to next step
  const handleContinue = useCallback(async () => {
    switch (state.step) {
      case 'welcome':
        // Check prerequisites first (all platforms)
        if (state.prerequisitesStatus && !state.prerequisitesStatus.allSatisfied) {
          setState(s => ({ ...s, step: 'prerequisites' }))
        } else if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          // On Windows, check if Git Bash is needed
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          await handleSaveWorkspace()
        }
        break

      case 'prerequisites':
        // Only proceed if all prerequisites are satisfied
        if (state.prerequisitesStatus?.allSatisfied) {
          if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
            setState(s => ({ ...s, step: 'git-bash' }))
          } else {
            await handleSaveWorkspace()
          }
        }
        break

      case 'git-bash':
        await handleSaveWorkspace()
        break

      case 'complete':
        onComplete()
        break
    }
  }, [state.step, state.gitBashStatus, state.prerequisitesStatus, handleSaveWorkspace, onComplete])

  // Go back to previous step. If at the initial step, call onDismiss instead.
  const handleBack = useCallback(() => {
    if (state.step === initialStep && onDismiss) {
      onDismiss()
      return
    }
    switch (state.step) {
      case 'prerequisites':
        setState(s => ({ ...s, step: 'welcome' }))
        break
      case 'git-bash':
        // Go back to prerequisites if they were shown
        if (state.prerequisitesStatus && !state.prerequisitesStatus.allSatisfied) {
          setState(s => ({ ...s, step: 'prerequisites' }))
        } else {
          setState(s => ({ ...s, step: 'welcome' }))
        }
        break
    }
  }, [state.step, state.prerequisitesStatus, initialStep, onDismiss])

  // Prerequisites recheck handler
  const handleRecheckPrerequisites = useCallback(async () => {
    setState(s => ({ ...s, isRecheckingPrerequisites: true }))
    try {
      const result = await window.electronAPI.checkPrerequisites()
      setState(s => ({ ...s, prerequisitesStatus: result, isRecheckingPrerequisites: false }))

      if (result.allSatisfied) {
        if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          await handleSaveWorkspace()
        }
      }
    } catch (error) {
      console.error('[Onboarding] Failed to recheck prerequisites:', error)
      setState(s => ({ ...s, isRecheckingPrerequisites: false }))
    }
  }, [state.gitBashStatus, handleSaveWorkspace])

  // Git Bash handlers (Windows only)
  const handleBrowseGitBash = useCallback(async () => {
    return window.electronAPI.browseForGitBash()
  }, [])

  const handleUseGitBashPath = useCallback(async (path: string) => {
    const result = await window.electronAPI.setGitBashPath(path)
    if (result.success) {
      setState(s => ({
        ...s,
        gitBashStatus: { ...s.gitBashStatus!, found: true, path },
      }))
      await handleSaveWorkspace()
    } else {
      setState(s => ({
        ...s,
        errorMessage: result.error || 'Invalid path',
      }))
    }
  }, [handleSaveWorkspace])

  const handleRecheckGitBash = useCallback(async () => {
    setState(s => ({ ...s, isRecheckingGitBash: true }))
    try {
      const status = await window.electronAPI.checkGitBash()
      setState(s => ({ ...s, gitBashStatus: status, isRecheckingGitBash: false }))
      if (status.found) {
        await handleSaveWorkspace()
      }
    } catch (error) {
      console.error('[Onboarding] Failed to recheck Git Bash:', error)
      setState(s => ({ ...s, isRecheckingGitBash: false }))
    }
  }, [handleSaveWorkspace])

  const handleClearError = useCallback(() => {
    setState(s => ({ ...s, errorMessage: undefined }))
  }, [])

  // Finish onboarding
  const handleFinish = useCallback(() => {
    onComplete()
  }, [onComplete])

  // Cancel onboarding
  const handleCancel = useCallback(() => {
    setState(s => ({ ...s, step: 'welcome' }))
  }, [])

  // Reset onboarding to initial state (used after reset)
  const reset = useCallback(() => {
    setState({
      step: initialStep,
      completionStatus: 'saving',
      isExistingUser: false,
      errorMessage: undefined,
    })
  }, [initialStep])

  return {
    state,
    handleContinue,
    handleBack,
    // Prerequisites
    handleRecheckPrerequisites,
    // Git Bash (Windows)
    handleBrowseGitBash,
    handleUseGitBashPath,
    handleRecheckGitBash,
    handleClearError,
    handleFinish,
    handleCancel,
    reset,
  }
}
