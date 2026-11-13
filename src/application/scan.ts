import * as vscode from 'vscode';
import { analyzeFile, FileKind, Mention, ObjectDef } from './analyze';

const INCLUDE = '**/*.{xml,md,markdown,txt}';
const EXCLUDE = '{**/node_modules/**,**/out/**,**/.git/**,**/target/**,**/build/**,**/dist/**}';
const MAX_FILES = 10000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MENTIONS = 500;

export interface Located {
  /** uri.toString(), used to open the file again. */
  uri: string;
  /** Workspace-relative path, for display. */
  path: string;
  line: number;
  column: number;
}

export interface DefinitionHit extends Located { ruleType?: string; refs: Array<{ type: string; name: string }> }
export interface MentionHit extends Located, Mention { kind: FileKind }

export interface ScanResult {
  /** `${type}\0${name}` → where that object is defined. */
  definitions: Record<string, DefinitionHit[]>;
  mentions: MentionHit[];
  filesScanned: number;
  truncated: boolean;
}

export const definitionKey = (type: string, name: string) => `${type}\u0000${name}`;

/**
 * Reads every XML / Markdown / text file of the workspace once and collects
 * (1) the IdentityIQ objects defined in the XML files and (2) every mention of `appName`.
 * Unsaved editor changes are taken into account.
 */
export async function scanWorkspace(
  appName: string,
  self: { uri: vscode.Uri; start: number; end: number },
  token: vscode.CancellationToken
): Promise<ScanResult> {
  const files = await vscode.workspace.findFiles(INCLUDE, EXCLUDE, MAX_FILES);
  const open = new Map(vscode.workspace.textDocuments.filter(d => d.isDirty).map(d => [d.uri.toString(), d.getText()]));
  const result: ScanResult = { definitions: {}, mentions: [], filesScanned: 0, truncated: files.length >= MAX_FILES };

  const handle = async (uri: vscode.Uri) => {
    if (token.isCancellationRequested) { return; }
    let text = open.get(uri.toString());
    if (text === undefined) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_BYTES) { return; }
        text = Buffer.from(bytes).toString('utf8');
      } catch { return; }
    }
    result.filesScanned++;
    const kind: FileKind = uri.path.toLowerCase().endsWith('.xml') ? 'xml' : 'doc';
    const isSelf = uri.toString() === self.uri.toString();
    const analysis = analyzeFile(text, kind, appName, isSelf ? { start: self.start, end: self.end } : undefined);
    const path = vscode.workspace.asRelativePath(uri, false);

    for (const o of analysis.objects as ObjectDef[]) {
      const key = definitionKey(o.type, o.name);
      (result.definitions[key] ??= []).push({ uri: uri.toString(), path, line: o.line, column: o.column, ruleType: o.ruleType, refs: o.refs });
    }
    for (const m of analysis.mentions) {
      if (result.mentions.length >= MAX_MENTIONS) { result.truncated = true; break; }
      result.mentions.push({ ...m, uri: uri.toString(), path, kind });
    }
  };

  for (let i = 0; i < files.length; i += 40) {
    if (token.isCancellationRequested) { break; }
    await Promise.all(files.slice(i, i + 40).map(handle));
  }

  // Stable order: exact matches first, then by file and line.
  result.mentions.sort((a, b) =>
    Number(b.exact) - Number(a.exact) || a.path.localeCompare(b.path) || a.line - b.line);
  return result;
}
