// Shared primitives for building step components
export {
  StepIcon,
  StepHeader,
  StepFormLayout,
  StepActions,
  BackButton,
  ContinueButton,
  type StepIconVariant,
} from './primitives'

// Individual steps
export { WelcomeStep } from './WelcomeStep'
export { PrerequisitesStep } from './PrerequisitesStep'
export { CompletionStep } from './CompletionStep'
export { GitBashWarning, type GitBashStatus } from './GitBashWarning'

// Main wizard container
export { OnboardingWizard, type OnboardingState, type OnboardingStep } from './OnboardingWizard'

// Re-export all types for convenient import
export type {
  OnboardingStep as OnboardingStepType,
  OnboardingState as OnboardingStateType,
} from './OnboardingWizard'
