import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { Toaster } from '@/components/ui/sonner'
import i18n, { SUPPORTED_LOCALES } from './i18n'
import { useSetAtom } from 'jotai'
import { userNameAtom } from './atoms/agent-name'
import { isWindows, isMac } from '@/lib/platform'
import './index.css'

// Set platform attribute synchronously before first render so CSS rules apply immediately.
// Used by index.css to apply platform-specific background overrides (e.g. solid bg on Windows
// to prevent dark acrylic/wallpaper bleed-through in transparent areas).
if (isWindows) {
  document.documentElement.dataset.platform = 'windows'
} else if (isMac) {
  document.documentElement.dataset.platform = 'mac'
}

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 */
function CrashFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{t('common.somethingWentWrong')}</p>
      <p className="text-[13px]">{t('common.restartApp')}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
      >
        {t('common.reload')}
      </button>
    </div>
  )
}

/**
 * Root component - loads workspace ID for theme context and renders App
 * App.tsx handles window mode detection internally (main vs tab-content)
 */
function Root() {
  // Load workspace ID for theme context (workspace-specific theme overrides)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.getWindowWorkspace?.().then((id) => {
      setWorkspaceId(id)
    })
  }, [])

  const setUserName = useSetAtom(userNameAtom)

  // Load language and user name from USER.md
  useEffect(() => {
    window.electronAPI?.readUserMd?.().then((result) => {
      try {
        const content = result.content.trimStart()
        if (content.startsWith('---')) {
          const endIdx = content.indexOf('\n---', 3)
          if (endIdx !== -1) {
            const yamlBlock = content.slice(4, endIdx)
            for (const line of yamlBlock.split('\n')) {
              const trimmed = line.trim()
              if (trimmed.startsWith('language:')) {
                const lang = trimmed.slice('language:'.length).trim().replace(/^["']|["']$/g, '')
                if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
                  i18n.changeLanguage(lang)
                }
              } else if (trimmed.startsWith('name:')) {
                const name = trimmed.slice('name:'.length).trim().replace(/^["']|["']$/g, '')
                if (name) setUserName(name)
              }
            }
          }
        }
      } catch {
        // Ignore parse errors - will use defaults
      }
    })
  }, [setUserName])

  return (
    <ThemeProvider activeWorkspaceId={workspaceId}>
      <App />
      <Toaster />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider>
      <Root />
    </JotaiProvider>
  </React.StrictMode>
)
