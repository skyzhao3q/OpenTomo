/**
 * Media Image Protocol Handler
 *
 * Registers a custom `media-image://` protocol that serves generated images
 * from ~/.opentomo/.media/. Uses net.fetch('file://') for reliable file serving.
 *
 * URL format: media-image://serve/<filename> (e.g. media-image://serve/uuid.png)
 * Security: Only allows simple filenames — no path separators or traversal.
 */

import { net, protocol } from 'electron'
import { stat } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { mainLog } from './logger'
import { CONFIG_DIR } from '@opentomo/shared/config'

/** Get the allowed media directory */
function getMediaDir(): string {
  return join(CONFIG_DIR, '.media')
}

/**
 * Register the media-image:// custom protocol scheme.
 * MUST be called before app.whenReady().
 */
export function registerMediaImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media-image',
      privileges: {
        supportFetchAPI: true,
        standard: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
}

/**
 * Register the media-image:// protocol handler.
 * Must be called after app.whenReady().
 *
 * Uses net.fetch(file://...) — the Electron-recommended pattern for serving
 * local files via custom protocols. This avoids manual Buffer → Response
 * conversion issues.
 */
export function registerMediaImageHandler(): void {
  const mediaDir = getMediaDir()
  mainLog.info(`media-image:// handler: mediaDir = ${mediaDir}`)

  protocol.handle('media-image', async (request) => {
    mainLog.info(`media-image:// request: ${request.url}`)
    try {
      const url = new URL(request.url)
      // URL format: media-image://serve/<filename> (e.g. media-image://serve/uuid.png)
      // With standard: true, host is 'serve' and pathname is '/<filename>'
      const fileName = decodeURIComponent(url.pathname.slice(1))
      mainLog.info(`media-image:// parsed: host=${url.hostname}, pathname=${url.pathname}, fileName=${fileName}`)

      // Validate: must be a simple filename, no path separators or traversal
      if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
        mainLog.error(`media-image:// rejected: invalid fileName "${fileName}"`)
        return new Response(null, { status: 400 })
      }

      const filePath = join(mediaDir, fileName)

      // Check file exists
      try {
        const fileStat = await stat(filePath)
        mainLog.info(`media-image:// file found: ${filePath} (${fileStat.size} bytes)`)
      } catch {
        mainLog.error(`media-image:// file not found: ${filePath}`)
        return new Response(null, { status: 404 })
      }

      // Serve via net.fetch(file://) — the Electron-recommended pattern
      const fileUrl = pathToFileURL(filePath).toString()
      mainLog.info(`media-image:// serving via net.fetch: ${fileUrl}`)
      return net.fetch(fileUrl)
    } catch (error) {
      mainLog.error('media-image:// protocol error:', error)
      return new Response(null, { status: 500 })
    }
  })

  mainLog.info('Registered media-image:// protocol handler')
}
