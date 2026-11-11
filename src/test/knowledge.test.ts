import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseXml } from '../parser/xmlParser';
import { getReference, getNavigableReference, isIiqDocument, isCodeContainer, TAG_DOCS, IIQ_OBJECT_TYPES } from '../iiq/knowledge';

const root = (xml: string) => parseXml(xml).root!;

test('isIiqDocument: DOCTYPE, <sailpoint> root and known object roots', () => {
  assert.equal(isIiqDocument(parseXml('<!DOCTYPE Foo PUBLIC "sailpoint.dtd" "sailpoint.dtd"><Foo/>')), true);
  assert.equal(isIiqDocument(parseXml('<sailpoint/>')), true);
  for (const type of ['Rule', 'Workflow', 'Application', 'TaskDefinition', 'Custom', 'Bundle', 'Form']) {
    assert.equal(isIiqDocument(parseXml(`<${type}/>`)), true, type);
  }
  assert.equal(isIiqDocument(parseXml('<project/>')), false);
  assert.equal(isIiqDocument(parseXml('')), false);
});

test('every sample file is recognised as IdentityIQ XML and parses cleanly', () => {
  const dir = path.join(__dirname, '..', '..', 'samples');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const m = parseXml(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(m.problems.length, 0, `${f}: ${JSON.stringify(m.problems)}`);
    assert.ok(isIiqDocument(m), f);
  }
});

test('getReference: <Reference> by name or id, with the class shortened', () => {
  assert.deepEqual(getReference(root('<Reference class="sailpoint.object.Rule" name="R"/>')), { type: 'Rule', name: 'R' });
  assert.deepEqual(getReference(root('<Reference class="sailpoint.object.Application" id="abc"/>')), { type: 'Application', name: 'abc' });
  assert.equal(getReference(root('<Reference name="x"/>')), undefined, 'no class and no typed wrapper');
});

test('getReference: class implied by a typed *Ref wrapper', () => {
  const wrapper = root('<WorkflowRef><Reference name="W"/></WorkflowRef>');
  assert.deepEqual(getReference(wrapper.children[0]), { type: 'Workflow', name: 'W' });
  assert.deepEqual(getReference(wrapper), { type: 'Workflow', name: 'W' });
  assert.deepEqual(getReference(root('<RuleRef><Reference class="sailpoint.object.Rule" name="R"/></RuleRef>')), { type: 'Rule', name: 'R' });
});

test('getReference: rule: prefixes and ruleName', () => {
  assert.deepEqual(getReference(root('<Step action="rule:Build Plan"/>')), { type: 'Rule', name: 'Build Plan' });
  assert.deepEqual(getReference(root('<Arg value="rule:R2"/>')), { type: 'Rule', name: 'R2' });
  assert.deepEqual(getReference(root('<Step action="rule: Spaced "/>')), { type: 'Rule', name: 'Spaced' });
  assert.deepEqual(getReference(root('<Field ruleName="R3"/>')), { type: 'Rule', name: 'R3' });
});

test('getReference: other action types and plain values are not references', () => {
  for (const xml of ['<Step action="call:sendEmail"/>', '<Step action="script:x()"/>', '<Arg value="ref:plan"/>', '<Arg value="literal"/>', '<Description>rule:X</Description>']) {
    assert.equal(getReference(root(xml)), undefined, xml);
  }
});

test('getReference ignores text and CDATA nodes', () => {
  const r = root('<Source><![CDATA[rule:X]]></Source>');
  assert.equal(getReference(r.children[0]), undefined);
});

test('getNavigableReference: a wrapper around exactly one Reference', () => {
  assert.deepEqual(getNavigableReference(root('<AccountCorrelationConfig><Reference class="sailpoint.object.CorrelationConfig" name="C"/></AccountCorrelationConfig>')),
    { type: 'CorrelationConfig', name: 'C' });
  const two = root('<Owners><Reference class="sailpoint.object.Identity" name="a"/><Reference class="sailpoint.object.Identity" name="b"/></Owners>');
  assert.equal(getNavigableReference(two), undefined, 'ambiguous: two references');
});

test('getNavigableReference: rule entries, skipping empty and $() values', () => {
  assert.deepEqual(getNavigableReference(root('<entry key="creationRule" value="Create Rule"/>')), { type: 'Rule', name: 'Create Rule' });
  assert.equal(getNavigableReference(root('<entry key="creationRule" value="  "/>')), undefined);
  assert.equal(getNavigableReference(root('<entry key="creationRule" value="$(ruleName)"/>')), undefined);
  assert.equal(getNavigableReference(root('<entry key="ruleset" value="X"/>')), undefined, 'key must end in Rule');
});

test('isCodeContainer', () => {
  assert.equal(isCodeContainer('Source'), true);
  assert.equal(isCodeContainer('Script'), true);
  assert.equal(isCodeContainer('Description'), false);
  assert.equal(isCodeContainer(undefined), false);
});

test('tag descriptions exist for the main IIQ tags and are not empty', () => {
  for (const tag of ['Rule', 'Workflow', 'Step', 'Transition', 'Application', 'Schema', 'entry', 'Reference', 'Source']) {
    assert.ok(TAG_DOCS[tag] && TAG_DOCS[tag].length > 10, tag);
  }
  for (const [tag, doc] of Object.entries(TAG_DOCS)) {
    assert.ok(doc.trim().length > 0, `${tag} has an empty description`);
  }
  assert.ok(IIQ_OBJECT_TYPES.has('Rule') && IIQ_OBJECT_TYPES.has('Workflow'));
  assert.equal(IIQ_OBJECT_TYPES.has('entry'), false);
});
