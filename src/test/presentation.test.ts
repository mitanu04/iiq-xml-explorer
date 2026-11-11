import { test, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { resetSettings } from './vscodeMock';   // must be imported before presentation (which imports vscode)
import { parseXml, XmlNode } from '../parser/xmlParser';
import { descriptionFor, iconFor, labelFor } from '../presentation';

const KEYS = ['name', 'key', 'type', 'action', 'value', 'to', 'when', 'class', 'connector'];
const el = (xml: string) => parseXml(xml).root!;
const child = (xml: string, name: string) => el(xml).children.find(c => c.name === name)!;
const describe = (n: XmlNode, show = true) => descriptionFor(n, KEYS, show);
const icon = (n: XmlNode) => (iconFor(n) as unknown as { id: string }).id;

beforeEach(() => resetSettings());

test('labels: element name, BeanShell for code, quoted text, comments and prolog', () => {
  const rule = el('<Rule><Source><![CDATA[x();]]></Source><Description>Hello</Description><!-- c --></Rule>');
  assert.equal(labelFor(rule), 'Rule');
  assert.equal(labelFor(rule.children[0].children[0]), 'BeanShell');
  assert.equal(labelFor(el('<Attributes><![CDATA[data]]></Attributes>').children[0]), 'CDATA');
  assert.equal(labelFor(rule.children[1].children[0]), '"Hello"');
  assert.equal(labelFor(rule.children[2]), '<!-- c -->');
  const doc = parseXml('<?xml version="1.0"?><!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd"><Rule/>');
  assert.equal(labelFor(doc.nodes[0]), '<?xml?>');
  assert.equal(labelFor(doc.nodes[1]), 'DOCTYPE Rule');
});

test('description: previewed attributes in the configured order, then hidden count', () => {
  const app = el('<Application profileClass="" name="GLOBEX" type="DelimitedFile" featuresString="X"/>');
  assert.equal(describe(app), 'name=GLOBEX  ·  type=DelimitedFile  ·  +2 attr');
  assert.equal(describe(app, false), '+4 attr', 'preview off: only the count');
});

test('description: long values are shortened', () => {
  const d = describe(el(`<Step name="${'x'.repeat(80)}"/>`));
  assert.ok(d.startsWith('name=') && d.endsWith('…') && d.length < 60, d);
});

test('description: text-only elements show their text inline', () => {
  assert.equal(describe(el('<String>abc</String>')), '"abc"');
});

test('entry values in every form', () => {
  const map = `<Map>
    <entry key="a" value="1"/>
    <entry key="b"><value><Boolean>true</Boolean></value></entry>
    <entry key="c"><value><List><String>x</String><String>y</String></List></value></entry>
    <entry key="d"><value><Map><entry key="k" value="v"/><entry key="l" value="w"/></Map></value></entry>
    <entry key="e"><value><Reference class="sailpoint.object.Rule" name="R"/></value></entry>
    <entry key="f"/>
    <entry key="g"><value><List><Map/></List></value></entry>
  </Map>`;
  const entries = el(map).children.filter(c => c.name === 'entry');
  assert.deepEqual(entries.map(e => describe(e)), [
    'key=a  ·  value=1',
    'key=b  ·  = true',
    'key=c  ·  = [x, y]',
    'key=d  ·  = Map{2}',
    'key=e  ·  = Rule → R',
    'key=f  ·  = (empty)',
    'key=g  ·  = List[1]'
  ]);
});

test('references are described as Type → name', () => {
  assert.equal(describe(el('<Reference class="sailpoint.object.Identity" name="spadmin"/>')), 'Identity → spadmin');
});

test('BeanShell nodes show their line count', () => {
  const cdata = el('<Source><![CDATA[\na();\nb();\nc();\n]]></Source>').children[0];
  assert.equal(describe(cdata), '3 lines');
  const one = el('<Source><![CDATA[a();]]></Source>').children[0];
  assert.equal(describe(one), '1 line');
});

test('unclosed elements are flagged', () => {
  const b = el('<A><B name="x"></A>').children[0];
  assert.match(describe(b), /not closed/);
  assert.equal(icon(b), 'warning');
});

test('icons: top-level objects, also inside <sailpoint>', () => {
  assert.equal(icon(el('<Rule/>')), 'symbol-class');
  assert.equal(icon(child('<sailpoint><Application/></sailpoint>', 'Application')), 'symbol-class');
  assert.equal(icon(child('<Bundle><Rule/></Bundle>', 'Rule')), 'symbol-tag', 'nested Rule is not a top-level object');
});

test('icons: common tags', () => {
  const cases: Array<[string, string]> = [
    ['<Step name="s"/>', 'debug-step-over'],
    ['<Transition to="x"/>', 'arrow-right'],
    ['<Variable name="v"/>', 'symbol-variable'],
    ['<Arg name="a"/>', 'symbol-parameter'],
    ['<entry key="k"/>', 'symbol-key'],
    ['<Map/>', 'symbol-structure'],
    ['<Attributes/>', 'symbol-structure'],
    ['<AccountCorrelationConfig/>', 'symbol-structure'],
    ['<List/>', 'symbol-array'],
    ['<Source/>', 'symbol-method'],
    ['<Schema/>', 'table'],
    ['<Field name="f"/>', 'symbol-field'],
    ['<Description/>', 'note'],
    ['<Section/>', 'symbol-interface'],
    ['<Filter/>', 'filter'],
    ['<String/>', 'symbol-constant'],
    ['<SomethingElse/>', 'symbol-tag']
  ];
  for (const [xml, expected] of cases) { assert.equal(icon(el(xml)), expected, xml); }
});

test('icons: a Form is an object on its own, a form icon inside another object', () => {
  assert.equal(icon(el('<Form name="F"/>')), 'symbol-class');
  assert.equal(icon(child('<Application><Form name="F"/></Application>', 'Form')), 'symbol-interface');
});

test('icons: AccountCorrelationConfig keeps the Map icon even though it wraps a reference', () => {
  const acc = el('<AccountCorrelationConfig><Reference class="sailpoint.object.CorrelationConfig" name="C"/></AccountCorrelationConfig>');
  assert.equal(icon(acc), 'symbol-structure');
  assert.equal(icon(acc.children[0]), 'link');
});

test('icons: person for identities and workgroups', () => {
  assert.equal(icon(el('<Owner/>')), 'person');
  assert.equal(icon(el('<Remediators/>')), 'person');
  assert.equal(icon(el('<Reference class="sailpoint.object.Identity" name="a"/>')), 'person');
  assert.equal(icon(el('<Approvers2><Reference class="sailpoint.object.Identity" name="a"/></Approvers2>')), 'person',
    'unknown wrapper that only holds identity references');
  assert.equal(icon(el('<Reference class="sailpoint.object.Rule" name="R"/>')), 'link');
});

test('icons: rule references and code', () => {
  assert.equal(icon(el('<Step action="rule:R"/>')), 'link');
  assert.equal(icon(el('<Source><![CDATA[x]]></Source>').children[0]), 'code');
  assert.equal(icon(el('<Data><![CDATA[x]]></Data>').children[0]), 'symbol-string');
});
