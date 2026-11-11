import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseXml } from '../parser/xmlParser';
import { buildWorkflowModel, findWorkflows, pickWorkflow } from '../workflow/workflowModel';

const model = (xml: string) => buildWorkflowModel(pickWorkflow(parseXml(xml))!);

test('Start and Stop are found by icon or by name', () => {
  const byName = model(`<Workflow name="W" type="T"><Variable name="a"/>
    <Step name="Start"><Transition to="Run"/></Step>
    <Step name="Run" action="script:doIt()"><Transition to="End"/></Step>
    <Step name="End"/></Workflow>`);
  assert.deepEqual(byName.steps.map(s => s.kind), ['start', 'script', 'stop']);
  assert.equal(byName.type, 'T');
  assert.equal(byName.variables, 1);
  assert.deepEqual(byName.warnings, []);

  const byIcon = model('<Workflow name="W"><Step name="Begin" icon="Start"/><Step name="Done" icon="stop"/></Workflow>');
  assert.deepEqual(byIcon.steps.map(s => s.kind), ['start', 'stop']);
  assert.equal(byIcon.startStep, 'Begin');
});

test('a step named Start with an action is a normal step', () => {
  const m = model('<Workflow name="W"><Step name="Start" action="rule:Init"/></Workflow>');
  assert.equal(m.steps[0].kind, 'rule');
  assert.equal(m.startStep, 'Start', 'still the first step, so the diagram starts there');
});

test('step kinds: rule, call, script, plain action, approval, subprocess, inline script', () => {
  const m = model(`<Workflow name="W">
    <Step name="R" action="rule:My Rule"/>
    <Step name="C" action="call:sendEmail"/>
    <Step name="S" action="script:x()"/>
    <Step name="P" action="doSomething"/>
    <Step name="A1"><Approval owner="ref:manager" mode="serial"/></Step>
    <Step name="A2"><Approval mode="parallel"/></Step>
    <Step name="A3"><Approval/></Step>
    <Step name="Sub"><WorkflowRef><Reference class="sailpoint.object.Workflow" name="LCM Provisioning"/></WorkflowRef></Step>
    <Step name="In"><Script><Source>a();
b();</Source></Script></Step>
    <Step name="Empty"/>
  </Workflow>`);
  assert.deepEqual(m.steps.map(s => [s.name, s.kind, s.detail]), [
    ['R', 'rule', 'My Rule'],
    ['C', 'call', 'sendEmail'],
    ['S', 'script', 'x()'],
    ['P', 'step', 'doSomething'],
    ['A1', 'approval', 'owner: ref:manager'],
    ['A2', 'approval', 'mode: parallel'],
    ['A3', 'approval', 'work item'],
    ['Sub', 'subprocess', 'LCM Provisioning'],
    ['In', 'script', '2 lines of BeanShell'],
    ['Empty', 'step', '']
  ]);
});

test('long step details are shortened, the tooltip keeps the full action', () => {
  const long = 'rule:' + 'A very long rule name '.repeat(5).trim();
  const s = model(`<Workflow name="W"><Step name="X" action="${long}"/></Workflow>`).steps[0];
  assert.ok(s.detail.length <= 48 && s.detail.endsWith('…'), s.detail);
  assert.equal(s.tooltip, long);
});

test('transitions keep their order, sibling count and condition', () => {
  const m = model(`<Workflow name="W">
    <Step name="A"><Transition to="B" when="x"/><Transition to="C" when="y"/><Transition to="B"/></Step>
    <Step name="B"/><Step name="C"/></Workflow>`);
  assert.deepEqual(m.transitions.map(t => [t.to, t.order, t.siblings, t.when ?? null]),
    [['B', 1, 3, 'x'], ['C', 2, 3, 'y'], ['B', 3, 3, null]]);
});

test('blank conditions count as no condition; entities in conditions are decoded', () => {
  const m = model(`<Workflow name="W"><Step name="A">
    <Transition to="B" when="   "/><Transition to="B" when="script:a &lt; 3 &amp;&amp; b"/></Step><Step name="B"/></Workflow>`);
  assert.equal(m.transitions[0].when, undefined);
  assert.equal(m.transitions[1].when, 'script:a < 3 && b');
});

test('a step that loops to itself is allowed', () => {
  const m = model('<Workflow name="W"><Step name="Wait"><Transition to="Wait" when="!done"/><Transition to="Next"/></Step><Step name="Next"/></Workflow>');
  assert.equal(m.transitions[0].from, 'Wait');
  assert.equal(m.transitions[0].to, 'Wait');
  assert.deepEqual(m.warnings, []);
});

test('positions: numbers are read, bad or missing values are undefined', () => {
  const m = model('<Workflow name="W"><Step name="A" posX="10" posY="x"/><Step name="B" posX="" posY="-5.5"/></Workflow>');
  assert.deepEqual(m.steps.map(s => [s.posX, s.posY]), [[10, undefined], [undefined, -5.5]]);
});

test('warnings: missing target, unreachable step, duplicate and unnamed steps', () => {
  const m = model(`<Workflow name="W">
    <Step name="Start" icon="Start"><Transition to="Nowhere"/></Step>
    <Step name="Orphan"/>
    <Step name="Twice"/><Step name="Twice"/>
    <Step/></Workflow>`);
  const ghost = m.steps.find(s => s.name === 'Nowhere')!;
  assert.equal(ghost.kind, 'missing');
  assert.equal(ghost.offset, -1, 'missing steps cannot be revealed');
  const text = m.warnings.join('\n');
  assert.match(text, /unknown step "Nowhere"/);
  assert.match(text, /"Orphan" is never reached/);
  assert.match(text, /Duplicate step name "Twice"/);
  assert.match(text, /A step has no name/);
});

test('a missing target used twice gives one ghost step', () => {
  const m = model('<Workflow name="W"><Step name="A"><Transition to="X"/></Step><Step name="B"><Transition to="X"/></Step></Workflow>');
  assert.equal(m.steps.filter(s => s.kind === 'missing').length, 1);
});

test('step offsets point at the <Step tag name and the range covers the step', () => {
  const src = '<Workflow name="W"><Step name="A"><Transition to="A"/></Step></Workflow>';
  const s = model(src).steps[0];
  assert.equal(src.slice(s.offset, s.offset + 4), 'Step');
  assert.equal(src.slice(s.start, s.end), '<Step name="A"><Transition to="A"/></Step>');
  const t = model(src).transitions[0];
  assert.equal(src.slice(t.offset, t.offset + 10), 'Transition');
});

test('a workflow without a name or steps still builds', () => {
  const m = model('<Workflow/>');
  assert.equal(m.name, '(unnamed workflow)');
  assert.deepEqual(m.steps, []);
  assert.equal(m.startStep, undefined);
});

test('findWorkflows / pickWorkflow on files without a workflow', () => {
  assert.deepEqual(findWorkflows(parseXml('<Rule/>')), []);
  assert.deepEqual(findWorkflows(parseXml('')), []);
  assert.equal(pickWorkflow(parseXml('<Rule/>')), undefined);
  assert.deepEqual(findWorkflows(parseXml('<sailpoint><Rule/></sailpoint>')), []);
});

test('pickWorkflow falls back to the first workflow when the cursor is outside all of them', () => {
  const xml = '<sailpoint><Workflow name="A"/><Workflow name="B"/></sailpoint>';
  assert.equal(pickWorkflow(parseXml(xml), 0)!.attributes[0].value, 'A');
});

test('every transition in the sample workflows points to an existing step', () => {
  const dir = path.join(__dirname, '..', '..', 'samples');
  for (const f of fs.readdirSync(dir).filter(x => x.startsWith('Workflow-'))) {
    const m = model(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.deepEqual(m.warnings, [], f);
    assert.ok(m.steps.every(s => s.kind !== 'missing'), f);
    assert.ok(m.steps.length >= 4, f);
  }
});
