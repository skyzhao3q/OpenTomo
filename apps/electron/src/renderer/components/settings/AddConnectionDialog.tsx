/**
 * AddConnectionDialog
 *
 * Two-step dialog for adding a new provider connection:
 *   Step 1 — Select provider type (Azure OpenAI selectable; others shown as "Coming soon")
 *   Step 2 — Enter API key, endpoint URL, and model IDs per tier
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ConnectionType = 'azure_openai' | 'anthropic_api' | 'aws_bedrock' | 'google_vertex' | 'ollama'

// Mirrors ProviderConnection from packages/shared — used for the edit prop
interface EditableConnection {
  id: string
  name: string
  type: string
  endpoint: string
  models: { best?: string; balanced?: string; fast?: string }
}

interface ProviderOption {
  type: ConnectionType
  label: string
  description: string
  available: boolean
  defaultEndpoint?: string
  endpointHint?: string
  noApiKey?: boolean
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    type: 'anthropic_api',
    label: 'Anthropic API',
    description: 'Connect directly using your Anthropic API key.',
    available: true,
    defaultEndpoint: 'https://api.anthropic.com',
    endpointHint: 'https://api.anthropic.com',
  },
  {
    type: 'azure_openai',
    label: 'Azure OpenAI',
    description: 'Connect via Azure OpenAI Anthropic-compatible endpoint.',
    available: true,
    defaultEndpoint: '',
    endpointHint: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT/chat/completions',
  },
  {
    type: 'ollama',
    label: 'Ollama (Local)',
    description: 'Connect to a locally running Ollama instance. No API key required.',
    available: true,
    defaultEndpoint: 'http://localhost:11434',
    endpointHint: 'http://localhost:11434',
    noApiKey: true,
  },
  {
    type: 'aws_bedrock',
    label: 'AWS Bedrock',
    description: 'Amazon Bedrock hosted models.',
    available: false,
  },
  {
    type: 'google_vertex',
    label: 'Google Vertex AI',
    description: 'Google Vertex AI hosted models.',
    available: false,
  },
]

interface AddConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (newId: string | null) => void
  /** When set, the dialog opens in edit mode pre-filled with this connection's data */
  editingConnection?: EditableConnection | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 – Provider selection
// ─────────────────────────────────────────────────────────────────────────────

function ProviderCard({
  option,
  selected,
  onSelect,
}: {
  option: ProviderOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={!option.available}
      onClick={onSelect}
      className={cn(
        'w-full text-left rounded-xl border p-4 flex items-start gap-3 transition-colors',
        option.available
          ? selected
            ? 'border-foreground/40 bg-foreground/5'
            : 'border-border hover:border-foreground/20 hover:bg-muted/50'
          : 'border-border/40 opacity-50 cursor-not-allowed',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{option.label}</span>
          {!option.available && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Coming soon
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{option.description}</p>
      </div>
      {option.available && (
        <div
          className={cn(
            'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
            selected ? 'border-foreground' : 'border-muted-foreground/40',
          )}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-foreground" />}
        </div>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-provider UI defaults
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderDefaults {
  apiKeyPlaceholder?: string
  modelPlaceholders?: { best: string; balanced: string; fast: string }
}

function getProviderDefaults(type: string): ProviderDefaults {
  if (type === 'anthropic_api') {
    return {
      apiKeyPlaceholder: 'sk-ant-...',
      modelPlaceholders: {
        best: 'claude-opus-4-5',
        balanced: 'claude-sonnet-4-5',
        fast: 'claude-haiku-4-5',
      },
    }
  }
  if (type === 'ollama') {
    return {
      modelPlaceholders: {
        best: 'qwen3:8b',
        balanced: 'qwen3:4b',
        fast: 'qwen3:0.6b',
      },
    }
  }
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 – API configuration form
// ─────────────────────────────────────────────────────────────────────────────

interface FormData {
  name: string
  apiKey: string
  endpoint: string
  modelBest: string
  modelBalanced: string
  modelFast: string
}

function ConfigForm({
  providerType,
  form,
  onChange,
  apiKeyPlaceholder,
  modelPlaceholders,
  noApiKey,
}: {
  providerType: string
  form: FormData
  onChange: (updates: Partial<FormData>) => void
  apiKeyPlaceholder?: string
  modelPlaceholders?: { best: string; balanced: string; fast: string }
  noApiKey?: boolean
}) {
  const [showKey, setShowKey] = useState(false)
  const option = PROVIDER_OPTIONS.find(o => o.type === providerType)

  return (
    <div className="space-y-4">
      {/* Connection name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Connection Name</label>
        <input
          type="text"
          value={form.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder={option ? `My ${option.label}` : 'Connection name'}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground/60"
        />
      </div>

      {/* API Key — hidden for providers that don't require one (e.g. Ollama) */}
      {!noApiKey && (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={form.apiKey}
            onChange={e => onChange({ apiKey: e.target.value })}
            placeholder={apiKeyPlaceholder ?? 'Paste your API key here...'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showKey ? (
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4"><path d="M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4"><path d="M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/></svg>
            )}
          </button>
        </div>
      </div>
      )}

      {/* Endpoint URL */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Endpoint URL</label>
        <input
          type="url"
          value={form.endpoint}
          onChange={e => onChange({ endpoint: e.target.value })}
          placeholder={option?.endpointHint ?? 'https://your-api-endpoint.com'}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground/60 font-mono text-xs"
        />
      </div>

      {/* Model tiers */}
      <div className="space-y-3 pt-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Model IDs</p>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Best <span className="text-muted-foreground/60">· most capable</span>
          </label>
          <input
            type="text"
            value={form.modelBest}
            onChange={e => onChange({ modelBest: e.target.value })}
            placeholder={modelPlaceholders?.best ?? 'e.g. gpt-4o'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground/60 font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Balanced <span className="text-muted-foreground/60">· good for everyday use</span>
          </label>
          <input
            type="text"
            value={form.modelBalanced}
            onChange={e => onChange({ modelBalanced: e.target.value })}
            placeholder={modelPlaceholders?.balanced ?? 'e.g. gpt-4o-mini'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground/60 font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Fast <span className="text-muted-foreground/60">· summarization &amp; utility</span>
          </label>
          <input
            type="text"
            value={form.modelFast}
            onChange={e => onChange({ modelFast: e.target.value })}
            placeholder={modelPlaceholders?.fast ?? 'e.g. gpt-4o-mini'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20 placeholder:text-muted-foreground/60 font-mono"
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dialog
// ─────────────────────────────────────────────────────────────────────────────

export function AddConnectionDialog({ open, onOpenChange, onAdded, editingConnection }: AddConnectionDialogProps) {
  const isEditMode = editingConnection != null

  const [step, setStep] = useState<1 | 2>(isEditMode ? 2 : 1)
  const [selectedType, setSelectedType] = useState<ConnectionType>('anthropic_api')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  const [form, setForm] = useState<FormData>({
    name: '',
    apiKey: '',
    endpoint: '',
    modelBest: '',
    modelBalanced: '',
    modelFast: '',
  })

  // Pre-fill form when entering edit mode (or switching the edited connection)
  useEffect(() => {
    if (editingConnection) {
      setStep(2)
      setForm({
        name: editingConnection.name,
        apiKey: '',
        endpoint: editingConnection.endpoint,
        modelBest: editingConnection.models.best ?? '',
        modelBalanced: editingConnection.models.balanced ?? '',
        modelFast: editingConnection.models.fast ?? '',
      })
      setError(null)
      setTestResult(null)
      // Fetch stored API key for edit mode
      window.electronAPI.getConnectionApiKey(editingConnection.id).then(key => {
        if (key) {
          setForm(prev => ({ ...prev, apiKey: key }))
        }
      })
    }
  }, [editingConnection])

  const handleFormChange = (updates: Partial<FormData>) => {
    setForm(prev => ({ ...prev, ...updates }))
    setError(null)
    setTestResult(null)
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset state on close
      setStep(1)
      setSelectedType('anthropic_api')
      setForm({ name: '', apiKey: '', endpoint: '', modelBest: '', modelBalanced: '', modelFast: '' })
      setError(null)
      setTestResult(null)
    }
    onOpenChange(nextOpen)
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    setError(null)
    const defaults = getProviderDefaults(isEditMode ? editingConnection.type : selectedType)
    try {
      const result = await window.electronAPI.testApiConnection(
        form.apiKey.trim(),
        form.endpoint.trim(),
        form.modelBalanced.trim() || form.modelBest.trim() || defaults.modelPlaceholders?.balanced || undefined,
      )
      setTestResult(result)
    } catch {
      setTestResult({ success: false, error: 'Test failed unexpectedly.' })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Connection name is required.')
      return
    }
    // API key required only when adding a new connection (not for providers like Ollama)
    const currentOption = PROVIDER_OPTIONS.find(o => o.type === selectedType)
    if (!isEditMode && !form.apiKey.trim() && !currentOption?.noApiKey) {
      setError('API key is required.')
      return
    }
    if (!form.endpoint.trim()) {
      setError('Endpoint URL is required.')
      return
    }

    const defaults = getProviderDefaults(isEditMode ? editingConnection.type : selectedType)
    const p = defaults.modelPlaceholders
    setIsSaving(true)
    setError(null)
    try {
      if (isEditMode) {
        await window.electronAPI.updateConnection(
          editingConnection.id,
          {
            name: form.name.trim(),
            endpoint: form.endpoint.trim(),
            models: {
              best: form.modelBest.trim() || p?.best || undefined,
              balanced: form.modelBalanced.trim() || p?.balanced || undefined,
              fast: form.modelFast.trim() || p?.fast || undefined,
            },
          },
          form.apiKey.trim() || undefined,
        )
      } else {
        const newConn = await window.electronAPI.addConnection(
          {
            name: form.name.trim(),
            type: selectedType,
            endpoint: form.endpoint.trim(),
            models: {
              best: form.modelBest.trim() || p?.best || undefined,
              balanced: form.modelBalanced.trim() || p?.balanced || undefined,
              fast: form.modelFast.trim() || p?.fast || undefined,
            },
          },
          form.apiKey.trim()
        )
        handleClose(false)
        onAdded(newConn.id)
        return
      }
      handleClose(false)
      onAdded(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connection.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleContinue = () => {
    const option = PROVIDER_OPTIONS.find(o => o.type === selectedType)
    if (option?.defaultEndpoint && !form.endpoint) {
      setForm(prev => ({ ...prev, endpoint: option.defaultEndpoint! }))
    }
    setStep(2)
  }

  const providerTypeForForm = isEditMode ? editingConnection.type : selectedType
  const providerDefaults = getProviderDefaults(providerTypeForForm)
  const isNoApiKeyType = PROVIDER_OPTIONS.find(o => o.type === providerTypeForForm)?.noApiKey ?? false

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Connection' : step === 1 ? 'Add Connection' : 'Configure Connection'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update your API credentials and model IDs.'
              : step === 1
                ? 'Choose how you want to connect to an AI provider.'
                : 'Enter your API credentials and model IDs.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {step === 1 && !isEditMode ? (
            <div className="space-y-2">
              {PROVIDER_OPTIONS.map(option => (
                <ProviderCard
                  key={option.type}
                  option={option}
                  selected={selectedType === option.type}
                  onSelect={() => option.available && setSelectedType(option.type)}
                />
              ))}
            </div>
          ) : (
            <ConfigForm
              providerType={providerTypeForForm}
              form={form}
              onChange={handleFormChange}
              apiKeyPlaceholder={providerDefaults.apiKeyPlaceholder}
              modelPlaceholders={providerDefaults.modelPlaceholders}
              noApiKey={isNoApiKeyType}
            />
          )}

          {error && (
            <p className="mt-3 text-xs text-destructive">{error}</p>
          )}
          {testResult && (
            <p className={`mt-3 text-xs ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
              {testResult.success ? 'Connection successful.' : (testResult.error ?? 'Connection failed.')}
            </p>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex gap-2 justify-end pt-2">
          {/* Back button: only shown in add mode step 2 */}
          {step === 2 && !isEditMode && (
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              disabled={isSaving || isTesting}
            >
              Back
            </Button>
          )}
          {step === 1 && !isEditMode ? (
            <Button
              onClick={handleContinue}
            >
              Continue
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={(!form.apiKey.trim() && !isNoApiKeyType) || !form.endpoint.trim() || isSaving || isTesting}
              >
                {isTesting ? 'Testing…' : 'Test Connection'}
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || isTesting}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
