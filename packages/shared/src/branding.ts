/**
 * Centralized branding assets for opentomo
 * Used by OAuth callback pages
 */

export const SS_LOGO = [
  ' ██████  ██████  ███████ ███    ██ ████████  ██████  ███    ███  ██████  ',
  '██    ██ ██   ██ ██      ████   ██    ██    ██    ██ ████  ████ ██    ██ ',
  '██    ██ ██████  █████   ██ ██  ██    ██    ██    ██ ██ ████ ██ ██    ██ ',
  '██    ██ ██      ██      ██  ██ ██    ██    ██    ██ ██  ██  ██ ██    ██ ',
  ' ██████  ██      ███████ ██   ████    ██     ██████  ██      ██  ██████  ',
] as const;

/** Logo as a single string for HTML templates */
export const SS_LOGO_HTML = SS_LOGO.map((line) => line.trimEnd()).join('\n');


