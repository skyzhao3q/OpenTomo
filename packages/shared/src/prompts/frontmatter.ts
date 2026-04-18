/**
 * YAML Front Matter Parser
 *
 * Simple parser for markdown files with YAML front matter.
 * Supports single-level key: value pairs only (no nested objects or arrays).
 *
 * Format:
 * ---
 * key1: value1
 * key2: value2
 * ---
 *
 * Body content here...
 */

export interface ParsedFrontmatter<T = Record<string, string>> {
  /** Parsed key-value data from the YAML front matter */
  data: T;
  /** Body content after the closing --- */
  content: string;
}

/**
 * Parse a markdown file with YAML front matter.
 *
 * If the file doesn't start with ---, returns empty data and the full content as body.
 */
export function parseFrontmatter<T = Record<string, string>>(raw: string): ParsedFrontmatter<T> {
  const trimmed = raw.trimStart();

  // Must start with ---
  if (!trimmed.startsWith('---')) {
    return { data: {} as T, content: raw };
  }

  // Find the closing ---
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    // No closing --- found, treat entire content as body
    return { data: {} as T, content: raw };
  }

  // Extract YAML block (between the two ---)
  const yamlBlock = trimmed.slice(4, endIndex); // Skip opening "---\n"
  const body = trimmed.slice(endIndex + 4); // Skip closing "\n---"

  // Parse simple key: value pairs
  const data: Record<string, string> = {};
  const lines = yamlBlock.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim();
    const value = trimmedLine.slice(colonIndex + 1).trim();

    if (key) {
      // Remove surrounding quotes if present
      data[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  // Remove leading newline from body
  const cleanBody = body.startsWith('\n') ? body.slice(1) : body;

  return { data: data as T, content: cleanBody };
}

/**
 * Serialize data and content back to markdown with YAML front matter.
 *
 * Omits the front matter block entirely if data is empty.
 */
export function serializeFrontmatter<T = Record<string, string>>(data: T, content: string): string {
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );

  if (entries.length === 0) {
    return content;
  }

  const yamlLines = entries.map(([key, value]) => `${key}: ${value}`);
  const frontmatter = `---\n${yamlLines.join('\n')}\n---\n`;

  return `${frontmatter}\n${content}`;
}
