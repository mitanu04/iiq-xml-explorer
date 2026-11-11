import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseXml, findNodeAt, nodePath, getAttr, walk, XmlNode } from '../parser/xmlParser';
import { getReference, isIiqDocument } from '../iiq/knowledge';

const samples = path.join(__dirname, '..', '..', 'samples');
const read = (f: string) => fs.readFileSync(path.join(samples, f), 'utf8');

test('parses a rule with DOCTYPE, signature and CDATA source', () => {
  const src = read('Rule-BuildMap-Example.xml');
  const model = parseXml(src);
  assert.equal(model.problems.length, 0, JSON.stringify(model.problems));
  assert.ok(isIiqDocument(model));
  assert.equal(model.root?.name, 'Rule');
  assert.equal(getAttr(model.root!, 'type'), 'BuildMap');

  const source = model.root!.children.find(c => c.name === 'Source')!;
  const cdata = source.children.find(c => c.kind === 'cdata')!;
  assert.match(cdata.text, /import sailpoint\.object\.Identity/);
  assert.ok(cdata.text.includes('if (x < 5 && y > 2)'), 'CDATA content must be kept raw');
});

test('parses a workflow and finds rule references', () => {
  const model = parseXml(read('Workflow-Joiner-Example.xml'));
  assert.equal(model.problems.length, 0, JSON.stringify(model.problems));
  const refs: string[] = [];
  walk(model.nodes, n => { const r = getReference(n); if (r) { refs.push(`${r.type}:${r.name}`); } });
  assert.ok(refs.includes('Rule:Example - Joiner Helper'), refs.join(', '));
  assert.ok(refs.includes('Rule:Example Rule Library'), refs.join(', '));
});

test('sailpoint wrapper file with several objects', () => {
  const model = parseXml(read('Application-Example.xml'));
  assert.equal(model.problems.length, 0, JSON.stringify(model.problems));
  assert.equal(model.root?.name, 'sailpoint');
  const objects = model.root!.children.filter(c => c.kind === 'element').map(c => c.name);
  assert.deepEqual(objects, ['Application', 'Rule']);
});

test('tolerates unclosed and mismatched tags', () => {
  const model = parseXml('<Rule name="a"><Description>hi</Rule><Extra>');
  assert.ok(model.problems.length >= 1);
  assert.equal(model.root?.name, 'Rule');
  assert.equal(model.root?.children[0].name, 'Description');
  assert.ok(model.root?.children[0].unclosed);
});

test('findNodeAt and nodePath', () => {
  const src = '<Workflow name="W"><Step name="S"><Arg name="A" value="x"/></Step></Workflow>';
  const model = parseXml(src);
  const node = findNodeAt(model.nodes, src.indexOf('<Arg') + 2) as XmlNode;
  assert.equal(node.name, 'Arg');
  assert.equal(nodePath(node), 'Workflow[name=W]/Step[name=S]/Arg[name=A]');
});

test('decodes entities in attributes', () => {
  const model = parseXml('<Transition to="End" when="x &lt; 3 &amp;&amp; y"/>');
  assert.equal(getAttr(model.root!, 'when'), 'x < 3 && y');
});

test('navigable references: wrappers, rule entries, not icons', async () => {
  const { getNavigableReference } = await import('../iiq/knowledge');
  const xml = `<Application name="A">
    <BuildMapRule><Reference class="sailpoint.object.Rule" name="BM"/></BuildMapRule>
    <Owner><Reference class="sailpoint.object.Identity" name="spadmin"/></Owner>
    <Attributes><Map>
      <entry key="afterProvisioningRule" value="After Rule"/>
      <entry key="afterProvisioningRule"/>
      <entry key="delimiter" value=","/>
    </Map></Attributes>
  </Application>`;
  const root = parseXml(xml).root!;
  const el = (n: string) => root.children.find(c => c.name === n)!;
  assert.deepEqual(getNavigableReference(el('BuildMapRule')), { type: 'Rule', name: 'BM' });
  assert.deepEqual(getNavigableReference(el('Owner')), { type: 'Identity', name: 'spadmin' });
  assert.equal(getReference(el('BuildMapRule')), undefined, 'wrapper icon logic must stay unchanged');
  const entries = el('Attributes').children.find(c => c.name === 'Map')!.children.filter(c => c.name === 'entry');
  assert.deepEqual(getNavigableReference(entries[0]), { type: 'Rule', name: 'After Rule' });
  assert.equal(getNavigableReference(entries[1]), undefined);
  assert.equal(getNavigableReference(entries[2]), undefined);
});
