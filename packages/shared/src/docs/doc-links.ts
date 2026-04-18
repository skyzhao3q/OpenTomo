/**
 * Documentation links and summaries for contextual help throughout the UI.
 * Summaries provide quick context; "Learn more" opens the full docs.
 */

const DOC_BASE_URL = 'https://github.com/OpenTomo/opentomo'

export type DocFeature =
  | 'sources'
  | 'sources-api'
  | 'sources-mcp'
  | 'sources-local'
  | 'skills'
  | 'permissions'
  | 'workspaces'
  | 'themes'
  | 'app-settings'
  | 'preferences'
  | 'agent'

export interface DocInfo {
  /** Path relative to DOC_BASE_URL */
  path: string
  /** Display title for the help popover */
  title: string
  /** 1-2 sentence summary for quick context */
  summary: string
}

export const DOCS: Record<DocFeature, DocInfo> = {
  sources: {
    path: '/sources/overview',
    title: 'Sources',
    summary:
      'Connect external data like MCP servers, REST APIs, and local filesystems. Sources give your agent tools to access services like GitHub, Linear, or your Obsidian vault.',
  },
  'sources-api': {
    path: '/sources/apis/overview',
    title: 'APIs',
    summary:
      'Connect to any REST API with flexible authentication. Make HTTP requests to external services directly from your conversations.',
  },
  'sources-mcp': {
    path: '/sources/mcp-servers/overview',
    title: 'MCP Servers',
    summary:
      'Connect to Model Context Protocol servers for rich tool integrations. MCP servers provide structured access to services like GitHub, Linear, and Notion.',
  },
  'sources-local': {
    path: '/sources/local-filesystems',
    title: 'Local Folders',
    summary:
      'Give your agent access to local directories like Obsidian vaults, code repositories, or data folders on your machine.',
  },
  skills: {
    path: '/skills/overview',
    title: 'Skills',
    summary:
      'Reusable instruction sets that teach your agent specialized behaviors. Create a SKILL.md file and invoke it with @mention in your messages.',
  },
  permissions: {
    path: '/core-concepts/permissions',
    title: 'Permissions',
    summary:
      'Control how much autonomy your agent has. Explore mode is read-only, Ask to Edit prompts before changes, and Execute mode runs without prompts.',
  },
  workspaces: {
    path: '/go-further/workspaces',
    title: 'Workspaces',
    summary:
      'Separate configurations for different contexts like personal projects or work. Each workspace has its own sources, skills, and session history.',
  },
  themes: {
    path: '/go-further/themes',
    title: 'Themes',
    summary:
      'Customize the visual appearance with a 6-color system. Override specific colors in theme.json or install preset themes for complete visual styles.',
  },
  'app-settings': {
    path: '/reference/config/config-file',
    title: 'App Settings',
    summary:
      'Configure global app settings like your default model, authentication method, and workspace list. Settings are stored in ~/.opentomo/config.json.',
  },
  preferences: {
    path: '/reference/config/preferences',
    title: 'User Info',
    summary:
      'Personal information like your name, timezone, and language that help the agent personalize responses. Stored in ~/.opentomo/USER.md.',
  },
  agent: {
    path: '/reference/config/agent',
    title: 'Agent',
    summary:
      'Configure your agent\'s name and personality. Define tone, style, and behavior via SOUL.md.',
  },
}

/**
 * Get the full documentation URL for a feature
 */
export function getDocUrl(feature: DocFeature): string {
  return `${DOC_BASE_URL}${DOCS[feature].path}`
}

/**
 * Get the doc info (title, summary, path) for a feature
 */
export function getDocInfo(feature: DocFeature): DocInfo {
  return DOCS[feature]
}

// ============================================================================
// External Links (locale-aware public website URLs)
// ============================================================================

/** Public website base URL */
const SITE_BASE_URL = 'https://github.com/OpenTomo/opentomo'

/** External link identifiers */
export type ExternalLinkId = 'help' | 'docs' | 'terms' | 'privacy'

export const EXTERNAL_LINKS: Record<ExternalLinkId, { path: string }> = {
  help:    { path: '/docs/' },
  docs:    { path: '/docs/' },
  terms:   { path: '/terms' },
  privacy: { path: '/privacy' },
}

/**
 * Get locale-aware external link URL.
 * Builds: https://github.com/OpenTomo/opentomo/{locale}/{path}
 * Falls back to 'en' for unsupported locales.
 */
export function getExternalUrl(id: ExternalLinkId, locale: string = 'en'): string {
  const lang = locale.startsWith('ja') ? 'ja' : 'en'
  return `${SITE_BASE_URL}/${lang}${EXTERNAL_LINKS[id].path}`
}
