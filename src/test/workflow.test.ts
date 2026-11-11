import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseXml } from '../parser/xmlParser';
import { buildWorkflowModel, findWorkflows, pickWorkflow } from '../workflow/workflowModel';

const samples = path.join(__dirname, '..', '..', 'samples');

test('builds steps and transitions from the sample workflow', () => {
  const doc = parseXml(fs.readFileSync(path.join(samples, 'Workflow-Joiner-Example.xml'), 'utf8'));
  const wf = pickWorkflow(doc)!;
  const m = buildWorkflowModel(wf);
  assert.equal(m.name, 'Example - Joiner');
  assert.equal(m.startStep, 'Start');
  assert.deepEqual(m.steps.map(s => `${s.name}:${s.kind}`), ['Start:start', 'Build Plan:rule', 'Notify Manager:script', 'Stop:stop']);
  assert.equal(m.steps[1].detail, 'Example - Joiner Helper');
  const fromBuild = m.transitions.filter(t => t.from === 'Build Plan');
  assert.equal(fromBuild.length, 2);
  assert.equal(fromBuild[0].order, 1);
  assert.match(fromBuild[0].when!, /plan != null && !plan.isEmpty\(\)/);
  assert.equal(fromBuild[1].when, undefined);
  assert.equal(m.variables, 3);
  assert.deepEqual(m.warnings, []);
});

test('detects approvals, subprocesses, calls and missing targets', () => {
  const xml = `<Workflow name="W">
    <Step name="Start" icon="Start"><Transition to="Ask"/></Step>
    <Step name="Ask"><Approval mode="serial" owner="ref:manager"/><Transition to="Sub"/></Step>
    <Step name="Sub"><WorkflowRef><Reference class="sailpoint.object.Workflow" name="LCM Provisioning"/></WorkflowRef><Transition to="Call"/></Step>
    <Step name="Call" action="call:sendEmail"><Transition to="Nowhere"/></Step>
    <Step name="Orphan"/>
  </Workflow>`;
  const m = buildWorkflowModel(pickWorkflow(parseXml(xml))!);
  const kinds = Object.fromEntries(m.steps.map(s => [s.name, s.kind]));
  assert.equal(kinds['Ask'], 'approval');
  assert.equal(kinds['Sub'], 'subprocess');
  assert.equal(kinds['Call'], 'call');
  assert.equal(kinds['Nowhere'], 'missing');
  assert.ok(m.warnings.some(w => w.includes('unknown step "Nowhere"')));
  assert.ok(m.warnings.some(w => w.includes('"Orphan" is never reached')));
});

test('finds workflows inside a <sailpoint> import file', () => {
  const xml = `<sailpoint><Rule name="R"/><Workflow name="A"><Step name="S"/></Workflow><Workflow name="B"/></sailpoint>`;
  const doc = parseXml(xml);
  assert.deepEqual(findWorkflows(doc).map(w => w.attributes[0].value), ['A', 'B']);
  assert.equal(pickWorkflow(doc, xml.indexOf('name="B"'))!.attributes[0].value, 'B');
});
