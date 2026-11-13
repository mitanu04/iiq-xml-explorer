import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeFile, findNameOffsets } from '../application/analyze';

const samples = path.join(__dirname, '..', '..', 'samples');

test('findNameOffsets: whole words only, case-sensitive, names with spaces', () => {
  assert.deepEqual(findNameOffsets('AD, AD2, myAD, AD.', 'AD'), [0, 15]);
  assert.deepEqual(findNameOffsets('HR Feed and hr feed and HR Feeds', 'HR Feed'), [0]);
  assert.deepEqual(findNameOffsets('x', ''), []);
  assert.deepEqual(findNameOffsets('Corp (AD)', '(AD)'), [5], 'names that start or end with a symbol still match');
});

test('xml: objects defined in the file, with rule type and position', () => {
  const xml = '<sailpoint>\n  <Rule name="R1" type="BuildMap"/>\n  <Application name="App"/>\n  <ImportAction name="x"/>\n  <Workflow/>\n</sailpoint>';
  const { objects } = analyzeFile(xml, 'xml', 'zzz');
  assert.deepEqual(objects.map(o => [o.type, o.name, o.ruleType ?? null, o.line, o.column]), [
    ['Rule', 'R1', 'BuildMap', 1, 3], ['Application', 'App', null, 2, 3]
  ]);
});

test('xml: a single root object counts as a top-level object', () => {
  assert.deepEqual(analyzeFile('<Rule name="Solo" type="Correlation"/>', 'xml', 'x').objects.map(o => o.name), ['Solo']);
});

test('xml: mentions carry the containing object, a one-line preview and the exact flag', () => {
  const xml = `<sailpoint>
  <Workflow name="Joiner">
    <Step name="a" action="rule:HR Feed Cleanup"/>
    <Arg name="application" value="HR Feed"/>
  </Workflow>
  <Rule name="Other"><Description>Uses HR Feed data</Description></Rule>
</sailpoint>`;
  const { mentions } = analyzeFile(xml, 'xml', 'HR Feed');
  assert.deepEqual(mentions.map(m => [m.line, m.container, m.exact]), [
    [2, 'Workflow "Joiner"', false],
    [3, 'Workflow "Joiner"', true],
    [5, 'Rule "Other"', false]
  ]);
  assert.equal(mentions[1].preview, '<Arg name="application" value="HR Feed"/>');
  assert.equal(xml.split('\n')[3].slice(mentions[1].column, mentions[1].column + 7), 'HR Feed');
});

test('xml: element text that is exactly the name is an exact match', () => {
  const { mentions } = analyzeFile('<Rule name="R"><String>HR Feed</String></Rule>', 'xml', 'HR Feed');
  assert.equal(mentions[0].exact, true);
});

test('xml: several matches on one line give one mention (exact wins)', () => {
  const { mentions } = analyzeFile('<Rule name="R" description="HR Feed and &quot;x&quot;"><A v="HR Feed"/></Rule>', 'xml', 'HR Feed');
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].exact, true);
});

test('xml: the application itself is excluded in its own file, other objects are not', () => {
  const xml = '<sailpoint><Application name="App"><Owner name="App"/></Application>\n<Rule name="R" description="App"/></sailpoint>';
  const start = xml.indexOf('<Application');
  const end = xml.indexOf('</Application>') + '</Application>'.length;
  const { mentions } = analyzeFile(xml, 'xml', 'App', { start, end });
  assert.deepEqual(mentions.map(m => [m.line, m.container]), [[1, 'Rule "R"']]);
});

test('xml: a malformed file is still analyzed', () => {
  const r = analyzeFile('<sailpoint><Rule name="R" type="X"><Source>HR Feed', 'xml', 'HR Feed');
  assert.equal(r.objects[0].name, 'R');
  assert.equal(r.mentions.length, 1);
});

test('documents: mention with the nearest heading above it', () => {
  const md = '# Intro\nnothing here\n## Corp AD\nThe `Corp AD` app is aggregated nightly.\n\n## HR\nAlso Corp AD runs before.\n';
  const { mentions, objects } = analyzeFile(md, 'doc', 'Corp AD');
  assert.deepEqual(objects, []);
  assert.deepEqual(mentions.map(m => [m.line, m.container, m.exact]), [[2, 'Corp AD', false], [3, 'Corp AD', true], [6, 'HR', false]]);
  assert.equal(mentions[1].preview, 'The `Corp AD` app is aggregated nightly.');
});

test('documents: no heading above gives no container; CRLF files work', () => {
  const { mentions } = analyzeFile('Text about App.\r\n## Later\r\nApp again\r\n', 'doc', 'App');
  assert.deepEqual(mentions.map(m => [m.line, m.container ?? null]), [[0, null], [2, 'Later']]);
  assert.equal(mentions[1].preview, 'App again');
});

test('long lines are shortened in the preview', () => {
  const { mentions } = analyzeFile('App ' + 'x'.repeat(400), 'doc', 'App');
  assert.ok(mentions[0].preview.length <= 160 && mentions[0].preview.endsWith('…'));
});

test('no mention: empty result', () => {
  assert.deepEqual(analyzeFile('# nothing', 'doc', 'App').mentions, []);
  assert.deepEqual(analyzeFile('<Rule name="x"/>', 'xml', 'App').mentions, []);
});

test('samples: the AD application is mentioned by the sample notes', () => {
  const md = fs.readFileSync(path.join(samples, 'docs', 'Application-Notes.md'), 'utf8');
  const { mentions } = analyzeFile(md, 'doc', 'Corp Active Directory');
  assert.deepEqual(mentions.map(m => [m.line, m.container, m.exact]), [
    [2, 'Corp Active Directory', false], [4, 'Corp Active Directory', true], [9, 'HR Feed', false]
  ]);
});
