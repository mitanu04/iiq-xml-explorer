import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { analyzeFile } from '../application/analyze';
import { buildDependencies, buildFileList, formatFileList, Defined, DirectRef } from '../application/dependencies';

/** A tiny fake workspace: object "Type:name" → file and the objects it references. */
function workspace(objects: Record<string, { path: string; refs: string[] }>) {
  const toRef = (s: string) => ({ type: s.split(':')[0], name: s.split(':').slice(1).join(':') });
  return (type: string, name: string): Defined[] => {
    const o = objects[`${type}:${name}`];
    return o ? [{ uri: `file:///${o.path}`, path: o.path, refs: o.refs.map(toRef) }] : [];
  };
}
const direct = (...items: string[]): DirectRef[] => items.map(s => {
  const type = s.split(':')[0];
  return { type, name: s.split(':')[1], category: type === 'Rule' ? 'rule' : type === 'Identity' ? 'identity' : 'other' };
});

test('analyzeFile: every object lists the objects it references', () => {
  const xml = `<sailpoint>
    <Rule name="Main" type="BuildMap"><ReferencedRules><Reference class="sailpoint.object.Rule" name="Lib"/></ReferencedRules></Rule>
    <CorrelationConfig name="Corr"><Reference class="sailpoint.object.Rule" name="Lib"/><Reference class="sailpoint.object.Rule" name="Other"/></CorrelationConfig>
  </sailpoint>`;
  const { objects } = analyzeFile(xml, 'xml', 'x');
  assert.deepEqual(objects.map(o => [o.name, o.refs.map(r => `${r.type}:${r.name}`)]), [
    ['Main', ['Rule:Lib']], ['Corr', ['Rule:Lib', 'Rule:Other']]
  ]);
});

test('dependencies: follows references of references, with levels and "needed by"', () => {
  const lookup = workspace({
    'Rule:Main': { path: 'rules/Main.xml', refs: ['Rule:Lib A'] },
    'Rule:Lib A': { path: 'rules/LibA.xml', refs: ['Rule:Lib B'] },
    'Rule:Lib B': { path: 'rules/LibB.xml', refs: [] },
    'CorrelationConfig:Corr': { path: 'cfg/Corr.xml', refs: ['Rule:Corr Rule', 'Rule:Lib A'] }
  });
  const deps = buildDependencies(direct('Rule:Main', 'CorrelationConfig:Corr'), lookup, 'App');
  assert.deepEqual(deps.map(d => [d.type, d.name, d.depth, d.neededBy]), [
    ['Rule', 'Corr Rule', 2, ['CorrelationConfig "Corr"']],
    ['Rule', 'Lib A', 2, ['Rule "Main"', 'CorrelationConfig "Corr"']],
    ['Rule', 'Lib B', 3, ['Rule "Lib A"']]
  ]);
});

test('dependencies: direct references are not repeated, cycles end, the application itself is skipped', () => {
  const lookup = workspace({
    'Rule:A': { path: 'a.xml', refs: ['Rule:B', 'Application:App'] },
    'Rule:B': { path: 'b.xml', refs: ['Rule:A', 'Rule:B'] }
  });
  assert.deepEqual(buildDependencies(direct('Rule:A'), lookup, 'App').map(d => d.name), ['B']);
  assert.deepEqual(buildDependencies(direct('Rule:A', 'Rule:B'), lookup, 'App'), []);
});

test('dependencies: identities are never followed or listed; nothing found means nothing', () => {
  const lookup = workspace({
    'Rule:A': { path: 'a.xml', refs: ['Identity:spadmin', 'Workgroup:IAM'] },
    'Identity:spadmin': { path: 'i.xml', refs: ['Rule:Hidden'] }
  });
  assert.deepEqual(buildDependencies(direct('Rule:A', 'Identity:spadmin'), lookup, 'App'), []);
  assert.deepEqual(buildDependencies([], lookup, 'App'), []);
});

test('dependencies: an object that is not in the workspace is listed but ends the chain; depth is limited', () => {
  const lookup = workspace({ 'Rule:A': { path: 'a.xml', refs: ['Rule:Missing'] } });
  assert.deepEqual(buildDependencies(direct('Rule:A'), lookup, 'App').map(d => d.name), ['Missing']);
  const chain: Record<string, { path: string; refs: string[] }> = {};
  for (let i = 0; i < 20; i++) { chain[`Rule:R${i}`] = { path: `r${i}.xml`, refs: [`Rule:R${i + 1}`] }; }
  assert.equal(buildDependencies(direct('Rule:R0'), workspace(chain), 'App', 4).length, 3, 'levels 2..4');
});

test('file list: own file, defining files (direct and indirect) and mentioning files, each once with all reasons', () => {
  const lookup = workspace({
    'Rule:Main': { path: 'rules/Main.xml', refs: ['Rule:Lib'] },
    'Rule:Lib': { path: 'rules/Lib.xml', refs: [] },
    'Identity:spadmin': { path: 'identities/spadmin.xml', refs: [] }
  });
  const dependencies = buildDependencies(direct('Rule:Main', 'Identity:spadmin', 'Form:Gone'), lookup, 'App');
  const files = buildFileList({ uri: 'file:///apps/App.xml', path: 'apps/App.xml' },
    direct('Rule:Main', 'Identity:spadmin', 'Form:Gone'), dependencies, lookup, [
      { uri: 'file:///docs/App.md', path: 'docs/App.md' }, { uri: 'file:///docs/App.md', path: 'docs/App.md' },
      { uri: 'file:///rules/Main.xml', path: 'rules/Main.xml' }
    ]);
  assert.deepEqual(files.map(f => f.path), ['apps/App.xml', 'docs/App.md', 'identities/spadmin.xml', 'rules/Lib.xml', 'rules/Main.xml']);
  assert.deepEqual(files.find(f => f.path === 'rules/Main.xml')!.reasons, ['Defines Rule "Main"', 'Mentions the application (1 line)']);
  assert.deepEqual(files.find(f => f.path === 'docs/App.md')!.reasons, ['Mentions the application (2 lines)']);
  assert.deepEqual(files.find(f => f.path === 'apps/App.xml')!.reasons, ['Application definition']);
});

test('file list: one object defined in two files lists both', () => {
  const lookup = (): Defined[] => [
    { uri: 'file:///a/R.xml', path: 'a/R.xml', refs: [] }, { uri: 'file:///b/R.xml', path: 'b/R.xml', refs: [] }
  ];
  const files = buildFileList({ uri: 'file:///App.xml', path: 'App.xml' }, [{ type: 'Rule', name: 'R' }], [], lookup, []);
  assert.deepEqual(files.map(f => f.path), ['a/R.xml', 'App.xml', 'b/R.xml']);
});

test('file list text: plain paths and a Markdown checklist', () => {
  const files = [
    { uri: 'u1', path: 'apps/App.xml', reasons: ['Application definition'] },
    { uri: 'u2', path: 'rules/R.xml', reasons: ['Defines Rule "R"', 'Mentions the application (1 line)'] }
  ];
  assert.equal(formatFileList(files, 'paths', 'App'), 'apps/App.xml\nrules/R.xml\n');
  assert.equal(formatFileList(files, 'markdown', 'App'),
    '# Files of application "App"\n\n- [ ] `apps/App.xml` — Application definition\n- [ ] `rules/R.xml` — Defines Rule "R"; Mentions the application (1 line)\n');
  assert.equal(formatFileList([], 'paths', 'App'), '');
});
