/**
 * Agent Name Atom
 *
 * Stores the user-customizable agent display name.
 * Used across the UI for menus, notifications, placeholders, etc.
 *
 * Default: 'OpenTomo' (matches DEFAULT_AGENT_NAME in @opentomo/shared)
 */

import { atom } from 'jotai'

/** Default agent display name */
export const DEFAULT_AGENT_NAME = 'OpenTomo'

/** Global atom for the agent display name */
export const agentNameAtom = atom<string>(DEFAULT_AGENT_NAME)

/** Global atom for the user's display name (from USER.md name: field) */
export const userNameAtom = atom<string>('')
