/**
 * i18n Configuration
 *
 * Initializes react-i18next with bundled translation resources.
 * Language is determined by the user's preference stored in ~/.opentomo/preferences.json.
 * Falls back to English when no preference is set or translation is missing.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'

/** Supported locale codes */
export const SUPPORTED_LOCALES = ['en', 'ja', 'zh'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** Language options for the preferences dropdown */
export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
] as const

/** Default agent display name — matches DEFAULT_AGENT_NAME in @opentomo/shared */
const DEFAULT_AGENT_NAME = 'OpenTomo'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    zh: { translation: zh },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes
    defaultVariables: {
      agentName: DEFAULT_AGENT_NAME,
    },
  },
})

/**
 * Update the global agent name used in i18n interpolation.
 * Call this when the user changes their agent name in preferences.
 */
export function setI18nAgentName(name: string) {
  i18n.options.interpolation = {
    ...i18n.options.interpolation,
    defaultVariables: {
      ...((i18n.options.interpolation as any)?.defaultVariables || {}),
      agentName: name || DEFAULT_AGENT_NAME,
    },
  }
}

export default i18n
