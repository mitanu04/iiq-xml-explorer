/**
 * Minimal stand-in for the `vscode` module so code that imports it (labels, icons, descriptions)
 * can be unit-tested with plain Node. Import this file before any module that imports `vscode`.
 * It is only used by the tests and is never part of the packaged extension.
 */
import Module = require('module');

class ThemeIcon { constructor(public readonly id: string, public readonly color?: ThemeColor) {} }
class ThemeColor { constructor(public readonly id: string) {} }
class MarkdownString {
  value = '';
  constructor(value?: string) { this.value = value ?? ''; }
  appendMarkdown(s: string) { this.value += s; return this; }
  appendText(s: string) { this.value += s; return this; }
  appendCodeblock(s: string, lang?: string) { this.value += '```' + (lang ?? '') + '\n' + s + '\n```\n'; return this; }
}

const settings: Record<string, unknown> = {};

export const vscodeMock = {
  ThemeIcon,
  ThemeColor,
  MarkdownString,
  workspace: {
    getConfiguration: () => ({ get: <T>(key: string, fallback: T): T => (key in settings ? settings[key] as T : fallback) })
  }
};

/** Override a setting for a test, e.g. setSetting('showAttributes', false). */
export function setSetting(key: string, value: unknown): void { settings[key] = value; }
export function resetSettings(): void { for (const k of Object.keys(settings)) { delete settings[k]; } }

const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (request === 'vscode') { return vscodeMock; }
  return originalLoad.call(this, request, ...rest);
};
