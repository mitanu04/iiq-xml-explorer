import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseXml, findNodeAt, nodePath, walk, decodeEntities, getAttr, XmlNode } from '../parser/xmlParser';

test('prolog: processing instruction and DOCTYPE with an internal subset', () => {
  const m = parseXml('<?xml version="1.0"?><!DOCTYPE Rule [ <!ENTITY a "b>"> ]><Rule/>');
  assert.deepEqual(m.nodes.map(n => [n.kind, n.name]), [['pi', 'xml'], ['doctype', 'Rule'], ['element', 'Rule']]);
  assert.equal(m.root?.name, 'Rule');
  assert.equal(m.problems.length, 0);
});

test('attributes: single quotes, unquoted, no value, entities', () => {
  const m = parseXml(`<Rule a='x' b=c d e="&#65;&#x42;" f="a &quot;q&quot;"/>`);
  assert.deepEqual(m.root!.attributes.map(a => [a.name, a.value]),
    [['a', 'x'], ['b', 'c'], ['d', ''], ['e', 'AB'], ['f', 'a "q"']]);
  assert.ok(m.root!.selfClosing);
});

test('attribute offsets point at the attribute in the source', () => {
  const src = '<Step name="Build Plan" action="rule:X"/>';
  const action = parseXml(src).root!.attributes.find(a => a.name === 'action')!;
  assert.equal(src.slice(action.start, action.end), 'action="rule:X"');
});

test('CDATA keeps its content raw, including markup and a lone "]]"', () => {
  const m = parseXml('<Source><![CDATA[ if (a < b && c > d) { x = "]]"; } ]]></Source>');
  assert.equal(m.problems.length, 0);
  const cdata = m.root!.children[0];
  assert.equal(cdata.kind, 'cdata');
  assert.equal(cdata.text, ' if (a < b && c > d) { x = "]]"; } ');
});

test('CDATA ends at the first "]]>"', () => {
  const m = parseXml('<Source><![CDATA[a]]>b<![CDATA[c]]></Source>');
  assert.deepEqual(m.root!.children.map(c => [c.kind, c.text]), [['cdata', 'a'], ['text', 'b'], ['cdata', 'c']]);
});

test('comments, child elements and text are kept in order', () => {
  const m = parseXml('<A><!-- note --><B/>text &amp; more</A>');
  assert.deepEqual(m.root!.children.map(c => [c.kind, c.kind === 'element' ? c.name : c.text]),
    [['comment', ' note '], ['element', 'B'], ['text', 'text & more']]);
});

test('whitespace-only text between tags is ignored', () => {
  const m = parseXml('<A>\n  <B/>\n  <C/>\n</A>');
  assert.deepEqual(m.root!.children.map(c => c.kind), ['element', 'element']);
});

test('node ranges cover the whole element, including the closing tag', () => {
  const src = '<A><B x="1">hi</B></A>';
  const b = parseXml(src).root!.children[0];
  assert.equal(src.slice(b.start, b.end), '<B x="1">hi</B>');
  assert.equal(src.slice(b.start, b.openTagEnd), '<B x="1">');
  assert.equal(src.slice(b.nameStart, b.nameStart + b.name.length), 'B');
});

test('problems: each malformed case is reported, parsing continues', () => {
  const cases: Array<[string, RegExp]> = [
    ['<A><B></A>', /<B> is not closed/],
    ['</X><A></A>', /Closing tag <\/X> has no matching opening tag/],
    ['<A><![CDATA[ open', /Unterminated CDATA section/],
    ['<A><!-- open', /Unterminated comment/],
    ['<A b="1"', /not terminated with '>'/],
    ['<A>1 < 2</A>', /Unexpected '<'/],
    ['<A>', /<A> is not closed/]
  ];
  for (const [src, expected] of cases) {
    const m = parseXml(src);
    assert.ok(m.problems.some(p => expected.test(p.message)), `${src} → ${JSON.stringify(m.problems)}`);
    assert.equal(m.root?.name, 'A', `root still found for ${src}`);
  }
});

test('problem offsets point into the source', () => {
  const src = '<A>\n  <B>\n</A>';
  const p = parseXml(src).problems[0];
  assert.equal(src.slice(p.start, p.end), '<B>');
});

test('empty and text-only documents', () => {
  assert.equal(parseXml('').root, undefined);
  assert.equal(parseXml('').nodes.length, 0);
  const m = parseXml('just text');
  assert.equal(m.root, undefined);
  assert.equal(m.nodes[0].kind, 'text');
});

test('decodeEntities: named, numeric, hex; unknown entities are left alone', () => {
  assert.equal(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#169;&#xA9;&unknown;'), '<>&"\'©©&unknown;');
});

test('getAttr returns undefined for a missing attribute', () => {
  const root = parseXml('<A x="1"/>').root!;
  assert.equal(getAttr(root, 'x'), '1');
  assert.equal(getAttr(root, 'y'), undefined);
});

test('walk visits every node and can skip a subtree', () => {
  const m = parseXml('<A><B><C/></B><D/></A>');
  const all: string[] = [];
  walk(m.nodes, n => { all.push(n.name); });
  assert.deepEqual(all, ['A', 'B', 'C', 'D']);
  const skipped: string[] = [];
  walk(m.nodes, n => { skipped.push(n.name); return n.name !== 'B'; });
  assert.deepEqual(skipped, ['A', 'B', 'D']);
});

test('findNodeAt returns the deepest node, or undefined outside the document', () => {
  const src = '<A><B><C/></B></A>   ';
  const m = parseXml(src);
  assert.equal(findNodeAt(m.nodes, src.indexOf('<C') + 1)?.name, 'C');
  assert.equal(findNodeAt(m.nodes, src.indexOf('</B>'))?.name, 'B');
  assert.equal(findNodeAt(m.nodes, src.length - 1), undefined);
});

test('nodePath uses name, falls back to key, and marks CDATA and text', () => {
  const m = parseXml('<Map><entry key="k" value="v"/></Map>');
  assert.equal(nodePath(m.root!.children[0]), 'Map/entry[key=k]');
  const rule = parseXml('<Rule name="R"><Source><![CDATA[x]]></Source><Description>d</Description></Rule>').root!;
  const cdata = rule.children[0].children[0];
  const text = rule.children[1].children[0];
  assert.equal(nodePath(cdata), 'Rule[name=R]/Source/#cdata');
  assert.equal(nodePath(text), 'Rule[name=R]/Description/#text');
});

test('parent links are set for every child', () => {
  const m = parseXml('<A><B><C/></B></A>');
  walk(m.nodes, n => {
    for (const c of n.children) { assert.equal(c.parent, n as XmlNode); }
  });
});

test('a large document parses quickly', () => {
  const entries = Array.from({ length: 5000 }, (_, i) => `<entry key="k${i}" value="v${i}"/>`).join('');
  const started = Date.now();
  const m = parseXml(`<Attributes><Map>${entries}</Map></Attributes>`);
  assert.equal(m.root!.children[0].children.length, 5000);
  assert.ok(Date.now() - started < 1000, 'parsing 5000 entries should take well under a second');
});
