/**
 * Works out, from what the workspace scan found, (1) which objects the application needs only
 * indirectly (a rule's own libraries, a correlation config's rules, ...) and (2) the list of files
 * that make up the application, e.g. to copy or review when tracking it in a branch.
 * Pure TypeScript, no VS Code dependency, so it can be unit-tested.
 */
import type { RefCategory } from './applicationModel';

export interface Ref { type: string; name: string }

export interface DirectRef extends Ref { category: RefCategory }

export interface Defined {
  uri: string;
  /** Workspace-relative path. */
  path: string;
  /** What the defined object points to. */
  refs: Ref[];
}

export type Lookup = (type: string, name: string) => Defined[];

export interface Dependency extends Ref {
  /** 2 = referenced by something the application references, 3 = one level further, ... */
  depth: number;
  /** "Type name" of the objects that reference it (at most 5). */
  neededBy: string[];
}

export interface FileEntry {
  uri: string;
  path: string;
  /** Why the file belongs to the application. */
  reasons: string[];
}

const key = (r: Ref) => `${r.type}\u0000${r.name}`;
const label = (r: Ref) => `${r.type} "${r.name}"`;
/** People are not files; their references are never followed. */
const isPerson = (type: string) => type === 'Identity' || type === 'Workgroup';

/** Objects reached through the application's direct references, found by following each defined object's own references. */
export function buildDependencies(direct: DirectRef[], lookup: Lookup, appName: string, maxDepth = 8): Dependency[] {
  const known = new Map<string, Dependency | null>();   // null = a direct reference
  direct.forEach(d => known.set(key(d), null));
  known.set(key({ type: 'Application', name: appName }), null);

  const found: Dependency[] = [];
  let level: Ref[] = direct.filter(d => !isPerson(d.type));
  for (let depth = 2; depth <= maxDepth && level.length > 0; depth++) {
    const next: Ref[] = [];
    for (const parent of level) {
      for (const def of lookup(parent.type, parent.name)) {
        for (const r of def.refs) {
          if (isPerson(r.type)) { continue; }
          const k = key(r);
          if (known.has(k)) {
            const existing = known.get(k);
            if (existing && existing.neededBy.length < 5 && !existing.neededBy.includes(label(parent))) { existing.neededBy.push(label(parent)); }
            continue;
          }
          const dep: Dependency = { type: r.type, name: r.name, depth, neededBy: [label(parent)] };
          known.set(k, dep);
          found.push(dep);
          next.push(r);
        }
      }
    }
    level = next;
  }
  return found.sort((a, b) => a.depth - b.depth || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

/**
 * Every file that belongs to the application: its own file, the files that define what it
 * references (directly or indirectly), and the files that mention it.
 */
export function buildFileList(
  self: { uri: string; path: string },
  direct: Ref[],
  dependencies: Ref[],
  lookup: Lookup,
  mentions: Array<{ uri: string; path: string }>
): FileEntry[] {
  const files = new Map<string, FileEntry>();
  const add = (uri: string, path: string, reason: string) => {
    let f = files.get(uri);
    if (!f) { f = { uri, path, reasons: [] }; files.set(uri, f); }
    if (!f.reasons.includes(reason)) { f.reasons.push(reason); }
  };

  add(self.uri, self.path, 'Application definition');
  for (const r of [...direct, ...dependencies]) {
    for (const def of lookup(r.type, r.name)) { add(def.uri, def.path, `Defines ${label(r)}`); }
  }
  const counts = new Map<string, { path: string; n: number }>();
  for (const m of mentions) {
    const c = counts.get(m.uri) ?? { path: m.path, n: 0 };
    c.n++;
    counts.set(m.uri, c);
  }
  counts.forEach((c, uri) => add(uri, c.path, `Mentions the application (${c.n} line${c.n === 1 ? '' : 's'})`));

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Text for the clipboard: plain paths for scripts and git, or a Markdown checklist with the reasons. */
export function formatFileList(files: FileEntry[], format: 'paths' | 'markdown', appName: string): string {
  if (format === 'paths') { return files.map(f => f.path).join('\n') + (files.length ? '\n' : ''); }
  const lines = [`# Files of application "${appName}"`, ''];
  for (const f of files) { lines.push(`- [ ] \`${f.path}\` — ${f.reasons.join('; ')}`); }
  return lines.join('\n') + '\n';
}
