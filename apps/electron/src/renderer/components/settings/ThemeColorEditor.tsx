/**
 * ThemeColorEditor
 *
 * Color customization editor for theme overrides.
 * Each color row has a swatch that opens a Popover with a visual color picker
 * (react-colorful) plus a text input for direct CSS value entry.
 * Changes are held as draft state until the user clicks Apply or Create New Theme.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import type { ThemeOverrides } from '@config/theme'

type ColorKey = 'background' | 'foreground' | 'accent' | 'info' | 'success' | 'destructive'

const COLOR_FIELDS: { key: ColorKey; label: string; description: string }[] = [
  { key: 'background', label: 'Background', description: 'Surface/page background' },
  { key: 'foreground', label: 'Foreground', description: 'Text and icons' },
  { key: 'accent', label: 'Accent', description: 'Brand color, highlights' },
  { key: 'info', label: 'Info', description: 'Warnings, attention states' },
  { key: 'success', label: 'Success', description: 'Connected status, success' },
  { key: 'destructive', label: 'Destructive', description: 'Errors, delete actions' },
]

// ──────────────────────────────────────────────
// Hex ↔ CSS value helpers
// ──────────────────────────────────────────────

/** Returns true if the value is a valid 6-digit hex color */
function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

/** Attempt to extract a hex color from a CSS value for seeding the picker.
 *  Falls back to #888888 for oklch / hsl / named colors. */
function toPickerHex(value: string | undefined): string {
  if (!value) return '#888888'
  if (isHex(value)) return value
  // Try 3-digit hex
  const shortMatch = value.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/)
  if (shortMatch) {
    const [, r, g, b] = shortMatch
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#888888'
}

// ──────────────────────────────────────────────
// Individual color row
// ──────────────────────────────────────────────

interface ColorRowProps {
  label: string
  description: string
  value: string | undefined
  colorKey: ColorKey
  onChange: (value: string) => void
  onReset: () => void
}

function ColorRow({ label, description, value, colorKey, onChange, onReset }: ColorRowProps) {
  const [textValue, setTextValue] = useState(value ?? '')
  const [pickerHex, setPickerHex] = useState(() => toPickerHex(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const isOverridden = value !== undefined && value !== ''

  // Sync local state when the value prop changes externally (e.g. reset from parent)
  useEffect(() => {
    setTextValue(value ?? '')
    setPickerHex(toPickerHex(value))
  }, [value])

  const handlePickerChange = useCallback((hex: string) => {
    setPickerHex(hex)
    setTextValue(hex)
    onChange(hex)
  }, [onChange])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setTextValue(raw)
    onChange(raw)
    if (isHex(raw)) {
      setPickerHex(raw)
    }
  }, [onChange])

  const handleReset = useCallback(() => {
    setTextValue('')
    setPickerHex('#888888')
    onReset()
  }, [onReset])

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* Label group */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Color swatch → opens Popover with picker */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'w-7 h-7 rounded-md border shrink-0 cursor-pointer transition-shadow',
                'hover:ring-2 hover:ring-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isOverridden ? 'border-border/80' : 'border-dashed border-border/60'
              )}
              style={{ backgroundColor: value || 'transparent' }}
              title="Pick color"
              aria-label={`Pick ${colorKey} color`}
            />
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-3 space-y-3"
            align="end"
            sideOffset={6}
          >
            {/* react-colorful picker */}
            <HexColorPicker
              color={pickerHex}
              onChange={handlePickerChange}
              style={{ width: '200px', height: '160px' }}
            />
            {/* Hex preview row */}
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded border border-border/60 shrink-0"
                style={{ backgroundColor: pickerHex }}
              />
              <span className="text-xs font-mono text-muted-foreground flex-1">{pickerHex}</span>
            </div>
          </PopoverContent>
        </Popover>

        {/* Text input for raw CSS value */}
        <input
          ref={inputRef}
          type="text"
          className={cn(
            'w-48 text-xs font-mono px-2 py-1.5 rounded-md border transition-colors',
            'bg-transparent border-border/60 text-foreground placeholder:text-muted-foreground/40',
            'hover:border-border focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30'
          )}
          value={textValue}
          placeholder="e.g. oklch(0.58 0.22 293)"
          onChange={handleTextChange}
          spellCheck={false}
        />

        {/* Reset button */}
        <button
          type="button"
          className={cn(
            'w-5 h-5 rounded flex items-center justify-center transition-opacity',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            isOverridden ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          onClick={handleReset}
          title="Reset to default"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Main editor
// ──────────────────────────────────────────────

export interface ThemeColorEditorProps {
  /** Current resolved theme colors (used as initial draft values) */
  initialColors: Record<string, string>
  /** Base theme to merge extended tokens from */
  baseTheme: ThemeOverrides
  /** Called whenever draft colors change or when user clicks "Preview" — applies live CSS, no disk write */
  onPreview: (colors: ThemeOverrides) => void
  /** Called with name + draft colors when user clicks "Save & Switch" */
  onCreateNew: (name: string, colors: ThemeOverrides) => Promise<void>
  /** Called when user clicks "Preview" (if parent wants to close) */
  onClose: () => void
  /** Called when user clicks "Cancel" — parent reverts any preview */
  onCancel: () => void
}

export function ThemeColorEditor({ initialColors, baseTheme, onPreview, onCreateNew, onClose, onCancel }: ThemeColorEditorProps) {
  const [draft, setDraft] = useState<Record<string, string>>(initialColors)
  const [showNameInput, setShowNameInput] = useState(false)
  const [newThemeName, setNewThemeName] = useState('')

  // Reset draft when the editor is reopened with new initialColors
  useEffect(() => {
    setDraft(initialColors)
  }, [initialColors])

  const mergeWithBase = useCallback(() => ({
    ...baseTheme,
    ...draft,
  }) as ThemeOverrides, [baseTheme, draft])

  const handleColorChange = (key: ColorKey, value: string) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value }
      const merged = { ...baseTheme, ...next } as ThemeOverrides & { name?: string }
      const { name: _omit, ...preview } = merged
      onPreview(preview as ThemeOverrides)
      return next
    })
  }

  const handleColorReset = (key: ColorKey) => {
    setDraft(prev => {
      const next = { ...prev }
      delete next[key]
      const merged = { ...baseTheme, ...next } as ThemeOverrides & { name?: string }
      const { name: _omit, ...preview } = merged
      onPreview(preview as ThemeOverrides)
      return next
    })
  }

  const handleConfirm = () => {
    // Preview without closing so user can continue tweaking
    const merged = mergeWithBase() as ThemeOverrides & { name?: string }
    const { name: _omit, ...preview } = merged
    onPreview(preview as ThemeOverrides)
  }

  const handleCreateNew = async () => {
    const merged = mergeWithBase()
    const { name: _omit, ...toSave } = merged as ThemeOverrides & { name?: string }
    await onCreateNew(newThemeName.trim(), toSave as ThemeOverrides)
    onCancel()
  }

  return (
    <div className="border-t border-border/40">
      {COLOR_FIELDS.map((field) => (
        <ColorRow
          key={field.key}
          label={field.label}
          description={field.description}
          value={draft[field.key]}
          colorKey={field.key}
          onChange={(val) => handleColorChange(field.key, val)}
          onReset={() => handleColorReset(field.key)}
        />
      ))}

      {/* Action bar */}
      <div className="px-4 pt-3 pb-3 border-t border-border/40 flex items-center gap-2 flex-wrap">
        {!showNameInput ? (
          <>
          <Button size="sm" onClick={handleConfirm}>
              Preview
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowNameInput(true)}>
              Save as
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <input
              type="text"
              className={cn(
                'flex-1 min-w-0 text-sm px-2.5 py-1.5 rounded-md border transition-colors',
                'bg-transparent border-border/60 text-foreground placeholder:text-muted-foreground/40',
                'hover:border-border focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30'
              )}
              placeholder="Theme name…"
              value={newThemeName}
              onChange={(e) => setNewThemeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newThemeName.trim()) handleCreateNew() }}
              autoFocus
            />
            <Button size="sm" onClick={handleCreateNew} disabled={!newThemeName.trim()}>
              Save &amp; Switch
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNameInput(false)}>
              Back
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
