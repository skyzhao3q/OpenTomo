/**
 * Opens a URL in the default browser.
 *
 * In Electron's main process, uses shell.openExternal() which is the
 * reliable platform-native API. Falls back to the 'open' npm package
 * for non-Electron contexts (CLI, tests, etc.).
 *
 * ALWAYS use this instead of importing 'open' directly.
 * Direct imports will fail with: "(0 , import_open.default) is not a function"
 *
 * @param url - The URL to open in the default browser
 */
export async function openUrl(url: string): Promise<void> {
  try {
    const { shell } = await import('electron')
    await shell.openExternal(url)
    return
  } catch {
    // Not in Electron main process — fall back to 'open' package
  }
  const open = await import('open')
  const openFn = open.default || open
  await openFn(url)
}
