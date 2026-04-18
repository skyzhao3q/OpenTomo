/**
 * Smart categorization utility.
 * Analyzes session titles using AI and returns project assignments.
 * Must only be called from the main process (uses Claude Agent SDK).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { SUMMARIZATION_MODEL } from '../config/models.ts';
import { resolveModelId } from '../config/storage.ts';
import { loadUserContext } from '../prompts/user-context.ts';
import type { ProjectConfig } from '../projects/types.ts';

function getSummarizationModel(): string {
  return resolveModelId(SUMMARIZATION_MODEL);
}

export interface SessionToAnalyze {
  id: string;
  name: string;
}

export interface CategoryAssignment {
  /** Index into the input sessions array */
  index: number;
  /** Name of the project to assign this session to */
  projectName: string;
}

/**
 * Analyze uncategorized session titles and return AI-suggested project assignments.
 * Sessions with names <= 2 chars are filtered out (untitled sessions skipped).
 * Throws on AI failure so the IPC handler can surface the error to the renderer.
 */
export async function analyzeUncategorizedSessions(
  sessions: SessionToAnalyze[],
  existingProjects: ProjectConfig[],
): Promise<CategoryAssignment[]> {
  if (sessions.length === 0) return [];

  // Filter to sessions with meaningful titles
  const meaningful = sessions
    .map((s, index) => ({ index, name: s.name.trim() }))
    .filter(s => s.name.length > 2);
  if (meaningful.length === 0) return [];

  // Language detection (same pattern as title-generator.ts)
  let isJapanese = false;
  try {
    const user = loadUserContext();
    const lang = user?.data?.language;
    if (lang === 'ja') isJapanese = true;
  } catch { /* ignore */ }

  const existingNames = existingProjects.map(p => p.name);
  const sessionsList = meaningful.map(s => `${s.index}: "${s.name}"`).join('\n');
  const existingHint = existingNames.length > 0
    ? (isJapanese
        ? `既存プロジェクト（可能な限り再利用）: `
        : `Existing projects (reuse when fitting): `) + existingNames.map(n => `"${n}"`).join(', ')
    : (isJapanese ? 'まだプロジェクトはありません。' : 'No existing projects yet.');

  const prompt = isJapanese ? [
    '以下のチャットタイトルを分析し、各チャットを適切なプロジェクトに分類してください。',
    '',
    'ルール:',
    '- 類似チャットはまとめてください',
    '- プロジェクト名は簡潔に（1〜3語）',
    '- 既存プロジェクトが適切な場合は再利用してください',
    '- JSONのみ返してください: [{"index": 0, "projectName": "名前"}, ...]',
    '- コードブロックや説明は不要。JSONのみ。',
    '',
    existingHint,
    '',
    'チャット一覧:',
    sessionsList,
    '',
    'JSON:',
  ].join('\n') : [
    'Analyze these chat titles and assign each to the most fitting project category.',
    '',
    'Rules:',
    '- Group similar chats together, use concise names (1-3 words, title case)',
    '- Reuse existing project names when a good fit',
    '- Return ONLY a JSON array: [{"index": 0, "projectName": "Name"}, ...]',
    '- No markdown, no code fences, no explanation. Pure JSON only.',
    '',
    existingHint,
    '',
    'Chat list:',
    sessionsList,
    '',
    'JSON:',
  ].join('\n');

  const defaultOptions = getDefaultOptions();
  const options = {
    ...defaultOptions,
    model: getSummarizationModel(),
    maxTurns: 1,
  };

  let raw = '';
  for await (const message of query({ prompt, options })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') raw += block.text;
      }
    }
  }

  // Strip code fences if model wrapped output (defensive)
  const jsonText = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) return [];

  const result: CategoryAssignment[] = [];
  for (const item of parsed) {
    if (
      typeof item === 'object' && item !== null &&
      typeof (item as Record<string, unknown>).index === 'number' &&
      typeof (item as Record<string, unknown>).projectName === 'string'
    ) {
      const idx = (item as Record<string, unknown>).index as number;
      const name = ((item as Record<string, unknown>).projectName as string).trim();
      if (idx >= 0 && idx < sessions.length && name.length > 0) {
        result.push({ index: idx, projectName: name });
      }
    }
  }

  return result;
}
