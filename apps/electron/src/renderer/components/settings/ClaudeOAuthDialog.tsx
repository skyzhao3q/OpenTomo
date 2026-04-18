/**
 * ClaudeOAuthDialog
 *
 * Two-step dialog to connect a Claude Subscription (claude.ai) account:
 *   Step 1 — Open the browser to sign in with Claude
 *   Step 2 — Paste the authorization code and submit
 *
 * Reuses OAuthConnect for the code-entry step. Reuses the existing
 * startClaudeOAuth / exchangeClaudeCode / clearClaudeOAuthState IPC
 * from the onboarding flow.
 */

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { OAuthConnect } from '@/components/apisetup/OAuthConnect'
import type { OAuthStatus } from '@/components/apisetup/OAuthConnect'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a raw OAuth error string into a user-facing message. */
function humanizeOAuthError(raw: string): string {
  if (raw.includes('429') || raw.toLowerCase().includes('rate limit') || raw.toLowerCase().includes('rate_limit')) {
    return 'Too many requests. Please wait a moment, then click Connect again.'
  }
  if (raw.includes('400') || raw.toLowerCase().includes('invalid_grant') || raw.toLowerCase().includes('invalid code')) {
    return 'The authorization code is invalid or has already been used. Please sign in again to get a new code.'
  }
  if (raw.includes('401') || raw.includes('403')) {
    return 'Authorization failed. Please sign in again.'
  }
  // Strip the "Token exchange failed: NNN - " prefix for cleaner display
  const match = raw.match(/Token exchange failed: \d+ - (.+)/)
  if (match) return match[1]
  return raw
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ConnectStep = 'prompt' | 'waiting-for-code' | 'validating'

export interface ClaudeOAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after credentials are exchanged and Claude Subscription is activated */
  onConnected: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ClaudeOAuthDialog({ open, onOpenChange, onConnected }: ClaudeOAuthDialogProps) {
  const [step, setStep] = useState<ConnectStep>('prompt')
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const submittingRef = useRef(false)

  const reset = () => {
    setStep('prompt')
    setOAuthStatus('idle')
    setErrorMessage(undefined)
    submittingRef.current = false
  }

  const handleOpenChange = async (isOpen: boolean) => {
    if (!isOpen) {
      // Clear any in-progress OAuth state when user closes the dialog
      if (step === 'waiting-for-code') {
        await window.electronAPI?.clearClaudeOAuthState()
      }
      reset()
    }
    onOpenChange(isOpen)
  }

  const handleStartOAuth = async () => {
    setOAuthStatus('validating')
    setErrorMessage(undefined)
    try {
      await window.electronAPI?.startClaudeOAuth()
      setStep('waiting-for-code')
      setOAuthStatus('idle')
    } catch (err) {
      setOAuthStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to open browser.')
    }
  }

  const handleSubmitCode = async (code: string) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setOAuthStatus('validating')
    setErrorMessage(undefined)
    try {
      const exchangeResult = await window.electronAPI?.exchangeClaudeCode(code)
      if (exchangeResult && !exchangeResult.success) {
        throw new Error(exchangeResult.error ?? 'Failed to exchange authorization code.')
      }
      // Activate Claude Subscription as the active provider
      const activateResult = await window.electronAPI?.activateClaudeOAuth()
      if (activateResult && !activateResult.success) {
        throw new Error(activateResult.error ?? 'Failed to activate Claude Subscription.')
      }
      setOAuthStatus('success')
      reset()
      onOpenChange(false)
      onConnected()
    } catch (err) {
      setOAuthStatus('error')
      setErrorMessage(humanizeOAuthError(err instanceof Error ? err.message : 'Failed to connect. Please try again.'))
    } finally {
      submittingRef.current = false
    }
  }

  const handleCancel = async () => {
    await window.electronAPI?.clearClaudeOAuthState()
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Claude Subscription</DialogTitle>
          <DialogDescription>
            {step === 'prompt'
              ? 'Sign in with your claude.ai account to use your Claude Max subscription.'
              : 'A browser window opened. After signing in, copy the authorization code and paste it below.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {step === 'prompt' && oauthStatus === 'error' && errorMessage && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive text-center mb-3">
              {errorMessage}
            </div>
          )}

          {step === 'waiting-for-code' && (
            <OAuthConnect
              status={oauthStatus}
              errorMessage={errorMessage}
              isWaitingForCode={true}
              onStartOAuth={handleStartOAuth}
              onSubmitAuthCode={handleSubmitCode}
              onCancelOAuth={handleCancel}
            />
          )}
        </div>

        <DialogFooter>
          {step === 'prompt' ? (
            <>
              <Button variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                onClick={handleStartOAuth}
                disabled={oauthStatus === 'validating'}
              >
                Sign In with Claude
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleCancel} disabled={oauthStatus === 'validating'}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="auth-code-form"
                disabled={oauthStatus === 'validating'}
              >
                {oauthStatus === 'validating' ? 'Connecting...' : 'Connect'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
