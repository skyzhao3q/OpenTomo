import { AlertTriangle, Check, X, RefreshCw, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StepFormLayout, ContinueButton } from "./primitives"
import type { PrerequisitesCheckResult, PrerequisiteStatus } from "../../../shared/types"

interface PrerequisitesStepProps {
  status: PrerequisitesCheckResult
  onRecheck: () => void
  onContinue: () => void
  isRechecking?: boolean
}

const PREREQUISITE_INFO: Record<
  PrerequisiteStatus['name'],
  {
    displayName: string
    requiredNote: string
    url: Record<string, string>
    instructions: Record<string, string>
  }
> = {
  bun: {
    displayName: 'Bun',
    requiredNote: '',
    url: {
      darwin: 'https://bun.sh',
      linux: 'https://bun.sh',
      win32: 'https://bun.sh',
    },
    instructions: {
      darwin: 'curl -fsSL https://bun.sh/install | bash',
      linux: 'curl -fsSL https://bun.sh/install | bash',
      win32: 'powershell -c "irm bun.sh/install.ps1 | iex"',
    },
  },
  node: {
    displayName: 'Node.js',
    requiredNote: ' (v18+)',
    url: {
      darwin: 'https://nodejs.org/en/download/',
      linux: 'https://nodejs.org/en/download/',
      win32: 'https://nodejs.org/en/download/',
    },
    instructions: {
      darwin: 'brew install node@20',
      linux: 'sudo apt install nodejs npm  (Ubuntu/Debian)',
      win32: 'winget install OpenJS.NodeJS.LTS',
    },
  },
  git: {
    displayName: 'Git',
    requiredNote: '',
    url: {
      darwin: 'https://git-scm.com/downloads',
      linux: 'https://git-scm.com/downloads',
      win32: 'https://git-scm.com/downloads/win',
    },
    instructions: {
      darwin: 'brew install git',
      linux: 'sudo apt install git  (Ubuntu/Debian)',
      win32: 'winget install Git.Git',
    },
  },
}

/**
 * PrerequisitesStep - Check that runtime prerequisites are installed
 *
 * Shows:
 * - Status for each prerequisite (Bun, Node.js 18+, Git)
 * - Version information for found items
 * - Download links and install instructions for missing items
 * - Re-check button after installing
 * - Blocks continuation until all prerequisites pass
 */
export function PrerequisitesStep({
  status,
  onRecheck,
  onContinue,
  isRechecking = false,
}: PrerequisitesStepProps) {
  const { platform, allSatisfied, prerequisites } = status

  const renderPrerequisite = (prereq: PrerequisiteStatus) => {
    const { name, found, version, meetsMinimum } = prereq
    const info = PREREQUISITE_INFO[name]
    const isSatisfied = name === 'node' ? found && meetsMinimum : found

    return (
      <div
        key={name}
        className="rounded-lg border border-border bg-foreground-2 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            {isSatisfied ? (
              <Check className="size-5 text-success" />
            ) : (
              <X className="size-5 text-destructive" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              {info.displayName}{info.requiredNote}
            </h3>

            {isSatisfied ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Version: <span className="font-mono">{version}</span>
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  {found && name === 'node' && !meetsMinimum
                    ? `Found ${version}, but requires v18 or later`
                    : 'Not found on your system'}
                </p>
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-mono text-muted-foreground bg-background/50 rounded px-2 py-1">
                    {info.instructions[platform] ?? info.instructions.darwin}
                  </p>
                  <Button
                    onClick={() => window.electronAPI.openUrl(info.url[platform] ?? info.url.darwin)}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs bg-background hover:bg-foreground/5"
                  >
                    <ExternalLink className="mr-2 size-3" />
                    Download {info.displayName}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <StepFormLayout
      icon={allSatisfied ? <Check className="size-full" /> : <AlertTriangle className="size-full" />}
      iconVariant={allSatisfied ? 'success' : 'error'}
      title={allSatisfied ? 'Prerequisites Satisfied' : 'Prerequisites Required'}
      description={
        allSatisfied
          ? 'All required runtime dependencies are installed.'
          : 'OpenTomo requires the following tools to be installed on your system.'
      }
      actions={
        allSatisfied ? (
          <ContinueButton onClick={onContinue} className="w-full">
            Continue
          </ContinueButton>
        ) : (
          <Button
            onClick={onRecheck}
            disabled={isRechecking}
            className="w-full max-w-[320px] bg-background text-foreground hover:bg-foreground/5 rounded-lg shadow-minimal"
          >
            <RefreshCw className={`mr-2 size-4 ${isRechecking ? 'animate-spin' : ''}`} />
            {isRechecking ? 'Checking...' : 'Re-check Prerequisites'}
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {prerequisites.map(renderPrerequisite)}
      </div>
    </StepFormLayout>
  )
}
