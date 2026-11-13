/**
 * Looks inside one workspace file for the Application overview: which IdentityIQ objects it
 * defines (to resolve references) and where it mentions an application's name.
 * Pure TypeScript, no VS Code dependency, so it can be unit-tested.
 */
import { parseXml, findNodeAt, getAttr, XmlNode } from '../parser/xmlParser';
import { collectReferences } from './applicationModel';

export type FileKind = 'xml' | 'doc';

export interface ObjectDef {
  type: string;
  name: string;
  /** Rule type (BuildMap, Correlation, ...) for Rule objects. */
  ruleType?: string;
  /** 0-based position of the object's tag name. */
  line: number;
  column: number;
  /** Objects this object points to (rules, correlation configs, ...), without duplicates. */
  refs: Array<{ type: string; name: string }>;
}

export interface Mention {
  line: number;
  column: number;
  /** The line of text, trimmed and shortened. */
  preview: string;
  /** The whole name sits between quotes or tags, e.g. name="HR Feed" or <String>HR Feed</String>. */
  exact: boolean;
  /** What the mention sits in: "Workflow \"Joiner\"" in XML, the nearest heading in a document. */
  container?: string;
}

export interface FileAnalysis {
  objects: ObjectDef[];
  mentions: Mention[];
}

export interface Exclude {
  /** Offsets to ignore (the application's own element in its own file). */
  start: number;
  end: number;
}

const WORD = /[A-Za-z0-9_]/;
const MAX_PREVIEW = 160;

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) { starts.push(i + 1); }
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) { lo = mid; } else { hi = mid - 1; }
  }
  return lo;
}

/** Offsets where `name` occurs as a whole word / phrase (not inside a longer word). */
export function findNameOffsets(text: string, name: string): number[] {
  const out: number[] = [];
  if (!name) { return out; }
  let from = 0;
  for (;;) {
    const i = text.indexOf(name, from);
    if (i < 0) { break; }
    from = i + 1;
    const before = i > 0 ? text[i - 1] : '';
    const after = i + name.length < text.length ? text[i + name.length] : '';
    if ((before && WORD.test(before) && WORD.test(name[0])) || (after && WORD.test(after) && WORD.test(name[name.length - 1]))) { continue; }
    out.push(i);
  }
  return out;
}

function isExact(text: string, offset: number, name: string): boolean {
  const before = text[offset - 1];
  const after = text[offset + name.length];
  return (before === '"' && after === '"') || (before === "'" && after === "'") || (before === '>' && after === '<');
}

function previewOf(text: string, starts: number[], line: number): string {
  const end = line + 1 < starts.length ? starts[line + 1] : text.length;
  const flat = text.slice(starts[line], end).replace(/\s+/g, ' ').trim();
  return flat.length > MAX_PREVIEW ? flat.slice(0, MAX_PREVIEW - 1) + '…' : flat;
}

/** Top-level objects: children of <sailpoint>, or the root element itself. */
function topLevelObjects(root: XmlNode | undefined): XmlNode[] {
  if (!root) { return []; }
  return (root.name === 'sailpoint' ? root.children : [root]).filter(n => n.kind === 'element' && n.name !== 'ImportAction');
}

function xmlContainer(top: XmlNode | undefined): string | undefined {
  if (!top) { return undefined; }
  const name = getAttr(top, 'name');
  return name ? `${top.name} "${name}"` : top.name;
}

export function analyzeFile(text: string, kind: FileKind, appName: string, exclude?: Exclude): FileAnalysis {
  const starts = lineStarts(text);
  const offsets = findNameOffsets(text, appName).filter(o => !exclude || o < exclude.start || o >= exclude.end);
  const result: FileAnalysis = { objects: [], mentions: [] };

  if (kind === 'xml') {
    const model = parseXml(text);
    const tops = topLevelObjects(model.root);
    for (const t of tops) {
      const name = getAttr(t, 'name');
      if (!name) { continue; }
      const pos = lineOf(starts, t.nameStart);
      result.objects.push({
        type: t.name,
        name,
        ruleType: t.name === 'Rule' ? getAttr(t, 'type') : undefined,
        line: pos,
        column: t.nameStart - starts[pos],
        refs: collectReferences(t).map(r => ({ type: r.type, name: r.name }))
      });
    }
    const seen = new Set<number>();
    for (const o of offsets) {
      const line = lineOf(starts, o);
      if (seen.has(line)) {
        const prev = result.mentions[result.mentions.length - 1];
        if (isExact(text, o, appName)) { prev.exact = true; }
        continue;
      }
      seen.add(line);
      const node = findNodeAt(model.nodes, o);
      let top = node;
      while (top?.parent && !tops.includes(top)) { top = top.parent; }
      result.mentions.push({
        line, column: o - starts[line], preview: previewOf(text, starts, line),
        exact: isExact(text, o, appName),
        container: tops.includes(top as XmlNode) ? xmlContainer(top) : undefined
      });
    }
    return result;
  }

  if (offsets.length === 0) { return result; }

  // Documentation (Markdown / text): remember the nearest heading above each mention.
  const headings: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < starts.length; i++) {
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(previewRaw(text, starts, i));
    if (m) { headings.push({ line: i, text: m[1] }); }
  }
  const seen = new Set<number>();
  for (const o of offsets) {
    const line = lineOf(starts, o);
    if (seen.has(line)) { continue; }
    seen.add(line);
    let heading: string | undefined;
    for (const h of headings) { if (h.line <= line) { heading = h.text; } else { break; } }
    result.mentions.push({
      line, column: o - starts[line], preview: previewOf(text, starts, line),
      exact: isExact(text, o, appName) || /`/.test(text[o - 1] ?? '') || /\*/.test(text[o - 1] ?? ''),
      container: heading
    });
  }
  return result;
}

function previewRaw(text: string, starts: number[], line: number): string {
  const end = line + 1 < starts.length ? starts[line + 1] : text.length;
  return text.slice(starts[line], end).replace(/\r?\n$/, '');
}
