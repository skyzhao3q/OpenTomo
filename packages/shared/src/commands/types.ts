/**
 * Commands Types
 *
 * Type definitions for workspace commands.
 * Commands are pre-defined prompts for quick access via slash menu.
 */

/**
 * Command metadata from .md YAML frontmatter
 */
export interface CommandMetadata {
  /** Display name for the command */
  name: string;
  /** Brief description shown in command list */
  description: string;
}

/**
 * A loaded command with parsed content
 */
export interface LoadedCommand {
  /** File name without extension (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: CommandMetadata;
  /** Prompt content (without frontmatter) */
  content: string;
  /** Absolute path to .md file */
  path: string;
}
