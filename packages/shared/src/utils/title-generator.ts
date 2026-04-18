/**
 * Session title generator utility.
 * Uses Claude Agent SDK query() for all auth types (API Key, Claude OAuth).
 * Respects the user's language preference from USER.md.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { SUMMARIZATION_MODEL } from '../config/models.ts';
import { resolveModelId } from '../config/storage.ts';
import { loadUserContext, LANGUAGE_NAMES } from '../prompts/user-context.ts';

function getSummarizationModel(): string {
  return resolveModelId(SUMMARIZATION_MODEL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Language-aware prompt helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Localized examples for title generation */
const LOCALIZED_EXAMPLES: Record<string, string> = {
  ja: '"認証バグを修正", "ダークモードを追加", "API層をリファクタリング", "コードベース構造を説明"',
  zh: '"修复认证错误", "添加暗色模式", "重构API层", "解释代码结构"',
  ko: '"인증 버그 수정", "다크 모드 추가", "API 계층 리팩토링", "코드베이스 구조 설명"',
  es: '"Corregir error de autenticación", "Agregar modo oscuro", "Refactorizar capa API", "Explicar estructura del código"',
  fr: '"Corriger le bug d\'authentification", "Ajouter le mode sombre", "Refactoriser la couche API", "Expliquer la structure du code"',
  de: '"Authentifizierungsfehler beheben", "Dark Mode hinzufügen", "API-Schicht refaktorisieren", "Codestruktur erklären"',
};

/** Fully localized prompt templates for title generation */
const LOCALIZED_GENERATE_PROMPT: Record<string, { instruction: string; userLabel: string; taskLabel: string }> = {
  ja: {
    instruction: 'ユーザーが何をしようとしているか、日本語で2〜5語の短いタスク説明だけを返してください。プレーンテキストのみ。マークダウン禁止。',
    userLabel: 'ユーザー',
    taskLabel: 'タスク',
  },
};

/** Fully localized prompt templates for title regeneration */
const LOCALIZED_REGENERATE_PROMPT: Record<string, { instruction: string; userMessagesLabel: string; assistantLabel: string; focusLabel: string }> = {
  ja: {
    instruction: '以下の最近のメッセージに基づいて、この会話の現在の焦点は何ですか？日本語で2〜5語の短いタスク説明だけを返してください。プレーンテキストのみ。マークダウン禁止。',
    userMessagesLabel: '最近のユーザーメッセージ',
    assistantLabel: '最新のアシスタント応答',
    focusLabel: '現在の焦点',
  },
};

interface LanguageContext {
  lang: string;
  langName: string;
}

/**
 * Read the user's preferred language from USER.md.
 * Returns null if English or unset.
 */
function getUserLanguage(): LanguageContext | null {
  try {
    const user = loadUserContext();
    const lang = user?.data?.language;
    if (!lang || lang === 'en') return null;
    const langName = LANGUAGE_NAMES[lang] || lang;
    return { lang, langName };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Abort / timeout helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an AbortController that fires after the configured timeout.
 * Default: 10 seconds. Override with CLAUDE_TITLE_TIMEOUT_MS env var.
 * Returns the controller and a cleanup function to cancel the timer.
 */
function createTitleAbortController(): { abortController: AbortController; clearAbortTimeout: () => void } {
  const timeoutMs = (() => {
    const v = process.env.CLAUDE_TITLE_TIMEOUT_MS;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 10000; // default 10s
  })();
  const abortController = new AbortController();
  const handle = setTimeout(() => {
    try { abortController.abort(); } catch { /* noop */ }
  }, timeoutMs);
  return { abortController, clearAbortTimeout: () => clearTimeout(handle) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Title generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a task-focused title (2-5 words) from the user's first message.
 * Respects the user's language setting from USER.md — the entire prompt is
 * localized for supported languages to ensure the model responds in the
 * correct language.
 */
export async function generateSessionTitle(
  userMessage: string
): Promise<string | null> {
  try {
    const userSnippet = userMessage.slice(0, 500);
    const langCtx = getUserLanguage();

    let prompt: string;

    if (langCtx) {
      const localized = LOCALIZED_GENERATE_PROMPT[langCtx.lang];
      const examples = LOCALIZED_EXAMPLES[langCtx.lang]
        || `Examples in ${langCtx.langName} (2-5 words each)`;

      if (localized) {
        // Fully localized prompt (Japanese, etc.)
        prompt = [
          localized.instruction,
          `例: ${examples}`,
          '',
          `${localized.userLabel}: ${userSnippet}`,
          '',
          `${localized.taskLabel}:`,
        ].join('\n');
      } else {
        // Partially localized: English instructions + language override
        prompt = [
          `You MUST reply in ${langCtx.langName}. Generate a short task description (2-5 words) in ${langCtx.langName}.`,
          'Use plain text only - no markdown.',
          `Examples: ${examples}`,
          '',
          'User: ' + userSnippet,
          '',
          'Task:',
        ].join('\n');
      }
    } else {
      // English (default)
      prompt = [
        'What is the user trying to do? Reply with ONLY a short task description (2-5 words).',
        'Start with a verb. Use plain text only - no markdown.',
        'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
        '',
        'User: ' + userSnippet,
        '',
        'Task:',
      ].join('\n');
    }

    const defaultOptions = getDefaultOptions();
    // Allow opt-in context-1m only when explicitly enabled and not using custom base URL
    const allowContext1m = process.env.CLAUDE_ENABLE_1M_BETA === '1' && !process.env.ANTHROPIC_BASE_URL;
    const safeBetas: string[] = allowContext1m ? ['context-1m-2025-08-07'] : [];
    const { abortController, clearAbortTimeout } = createTitleAbortController();

    const options = {
      ...defaultOptions,
      model: getSummarizationModel(),
      maxTurns: 1,
      // Explicitly set betas to a safe list so the SDK doesn't attach unsupported defaults
      betas: safeBetas as any,
      // Disable tools to prevent SDK from attaching advanced tool-use beta headers
      tools: [],
      // Abort if the SDK call stalls
      abortController,
      // Capture SDK stderr for actionable diagnostics (e.g., beta warnings, auth messages)
      stderr: (data: string) => {
        // Mirror OpenTomoAgent logging style for consistency
        // Do not accumulate state here; title generation runs quickly and logs are short
        console.error('[SDK stderr]', data)
      },
    };

    let title = '';

    try {
      for await (const message of query({ prompt, options })) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              title += block.text;
            }
          }
        }
      }
    } finally {
      clearAbortTimeout();
    }

    const trimmed = title.trim();

    // Validate: reasonable length, not empty
    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  } catch (error) {
    const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'));
    if (isAbort) {
      console.error('[title-generator] Title generation timed out (aborted)');
    } else {
      console.error('[title-generator] Failed to generate title:', error);
      // Extract subprocess stdout/stderr if present (SDK sets these on exit-code errors)
      const anyErr = error as Record<string, unknown>;
      const stdout = typeof anyErr.stdout === 'string' ? anyErr.stdout.trim() : '';
      const stderr = typeof anyErr.stderr === 'string' ? anyErr.stderr.trim() : '';
      if (stdout) console.error('[title-generator] subprocess stdout:', stdout);
      if (stderr) console.error('[title-generator] subprocess stderr:', stderr);
    }
    return null;
  }
}

/**
 * Regenerate a session title based on recent messages.
 * Respects the user's language setting from USER.md.
 */
export async function regenerateSessionTitle(
  recentUserMessages: string[],
  lastAssistantResponse: string
): Promise<string | null> {
  try {
    const userContext = recentUserMessages
      .map((msg) => msg.slice(0, 300))
      .join('\n\n');
    const assistantSnippet = lastAssistantResponse.slice(0, 500);
    const langCtx = getUserLanguage();

    let prompt: string;

    if (langCtx) {
      const localized = LOCALIZED_REGENERATE_PROMPT[langCtx.lang];
      const examples = LOCALIZED_EXAMPLES[langCtx.lang]
        || `Examples in ${langCtx.langName} (2-5 words each)`;

      if (localized) {
        // Fully localized prompt
        prompt = [
          localized.instruction,
          `例: ${examples}`,
          '',
          `${localized.userMessagesLabel}:`,
          userContext,
          '',
          `${localized.assistantLabel}:`,
          assistantSnippet,
          '',
          `${localized.focusLabel}:`,
        ].join('\n');
      } else {
        // Partially localized
        prompt = [
          `You MUST reply in ${langCtx.langName}. What is the current focus of this conversation?`,
          `Reply with ONLY a short task description (2-5 words) in ${langCtx.langName}.`,
          'Use plain text only - no markdown.',
          `Examples: ${examples}`,
          '',
          'Recent user messages:',
          userContext,
          '',
          'Latest assistant response:',
          assistantSnippet,
          '',
          'Current focus:',
        ].join('\n');
      }
    } else {
      // English (default)
      prompt = [
        'Based on these recent messages, what is the current focus of this conversation?',
        'Reply with ONLY a short task description (2-5 words).',
        'Start with a verb. Use plain text only - no markdown.',
        'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
        '',
        'Recent user messages:',
        userContext,
        '',
        'Latest assistant response:',
        assistantSnippet,
        '',
        'Current focus:',
      ].join('\n');
    }

    const defaultOptions = getDefaultOptions();
    const allowContext1m = process.env.CLAUDE_ENABLE_1M_BETA === '1' && !process.env.ANTHROPIC_BASE_URL;
    const safeBetas: string[] = allowContext1m ? ['context-1m-2025-08-07'] : [];
    const { abortController, clearAbortTimeout } = createTitleAbortController();

    const options = {
      ...defaultOptions,
      model: getSummarizationModel(),
      maxTurns: 1,
      betas: safeBetas as any,
      tools: [],
      abortController,
      stderr: (data: string) => {
        console.error('[SDK stderr]', data)
      },
    };

    let title = '';

    try {
      for await (const message of query({ prompt, options })) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              title += block.text;
            }
          }
        }
      }
    } finally {
      clearAbortTimeout();
    }

    const trimmed = title.trim();

    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  } catch (error) {
    const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'));
    if (isAbort) {
      console.error('[title-generator] Title regeneration timed out (aborted)');
    } else {
      console.error('[title-generator] Failed to regenerate title:', error);
      const anyErr = error as Record<string, unknown>;
      const stdout = typeof anyErr.stdout === 'string' ? anyErr.stdout.trim() : '';
      const stderr = typeof anyErr.stderr === 'string' ? anyErr.stderr.trim() : '';
      if (stdout) console.error('[title-generator] subprocess stdout:', stdout);
      if (stderr) console.error('[title-generator] subprocess stderr:', stderr);
    }
    return null;
  }
}
