/**
 * Centralized path configuration for opentomo.
 *
 * Supports multi-instance development via SS_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., opentomo-1), the detect-instance.sh
 * script sets SS_CONFIG_DIR to ~/.opentomo-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.opentomo/
 * Instance 1 (-1 suffix): ~/.opentomo-1/
 * Instance 2 (-2 suffix): ~/.opentomo-2/
 */

import { homedir } from 'os';
import { join } from 'path';

const home = homedir();
const newDir = join(home, '.opentomo');

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.opentomo/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.SS_CONFIG_DIR || newDir;
