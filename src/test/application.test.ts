import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseXml } from '../parser/xmlParser';
import { buildApplicationModel, buildSchemas, collectReferences, findApplications, pickApplication } from '../application/applicationModel';

const samples = path.join(__dirname, '..', '..', 'samples');
const app = (xml: string, offset?: number) => pickApplication(parseXml(xml), offset)!;
const sample = (f: string) => fs.readFileSync(path.join(samples, f), 'utf8');

test('findApplications / pickApplication: root, inside <sailpoint>, none', () => {
  assert.equal(findApplications(parseXml('<Application name="A"/>')).length, 1);
  assert.equal(findApplications(parseXml('<sailpoint><Application name="A"/><Rule/><Application name="B"/></sailpoint>')).length, 2);
  assert.equal(findApplications(parseXml('<Rule/>')).length, 0);
  assert.equal(findApplications(parseXml('')).length, 0);
  assert.equal(pickApplication(parseXml('<Rule/>')), undefined);
});

test('pickApplication prefers the application under the offset, else the first', () => {
  const xml = '<sailpoint><Application name="A"/><Application name="B"/></sailpoint>';
  assert.equal(app(xml, xml.indexOf('name="B"')).attributes[0].value, 'B');
  assert.equal(app(xml, 0).attributes[0].value, 'A');
  assert.equal(app(xml).attributes[0].value, 'A');
});

test('schema rows: flags, identity/display, description from attribute or child', () => {
  const [schema] = buildSchemas(app(`<Application name="A"><Schemas>
    <Schema objectType="account" nativeObjectType="user" identityAttribute="dn" displayAttribute="uid" groupAttribute="memberOf">
      <AttributeDefinition name="dn" type="string"><Description>Distinguished name</Description></AttributeDefinition>
      <AttributeDefinition name="uid" type="string" description="Login"/>
      <AttributeDefinition name="memberOf" type="string" entitlement="true" managed="true" multi="true" minable="TRUE" correlationKey="1" required="1"/>
      <AttributeDefinition name="x" type="int" entitlement="false" correlationKey="0"/>
    </Schema></Schemas></Application>`));
  assert.equal(schema.objectType, 'account');
  assert.equal(schema.nativeObjectType, 'user');
  assert.equal(schema.groupAttribute, 'memberOf');
  assert.deepEqual(schema.rows.map(r => r.name), ['dn', 'uid', 'memberOf', 'x']);
  const [dn, uid, member, x] = schema.rows;
  assert.equal(dn.description, 'Distinguished name');
  assert.equal(dn.identity, true);
  assert.equal(uid.description, 'Login');
  assert.equal(uid.display, true);
  assert.deepEqual([member.entitlement, member.managed, member.multi, member.minable, member.correlationKey, member.required],
    [true, true, true, true, true, true]);
  assert.deepEqual([x.entitlement, x.correlationKey, x.identity, x.display], [false, false, false, false]);
  assert.equal(x.type, 'int');
});

test('schema: several schemas, object type fallbacks, none, attribute offsets', () => {
  const xml = `<Application name="A"><Schemas><Schema objectType="account"/><Schema nativeObjectType="group"><AttributeDefinition name="cn"/></Schema><Schema/></Schemas></Application>`;
  const schemas = buildSchemas(app(xml));
  assert.deepEqual(schemas.map(s => s.objectType), ['account', 'group', 'account']);
  assert.equal(xml.slice(schemas[1].rows[0].offset, schemas[1].rows[0].offset + 19), 'AttributeDefinition');
  assert.deepEqual(buildSchemas(app('<Application name="A"/>')), []);
});

test('references: wrappers, entries, rule: actions, identities, other objects', () => {
  const refs = collectReferences(app(`<Application name="A">
    <AccountCorrelationConfig><Reference class="sailpoint.object.CorrelationConfig" name="Corr"/></AccountCorrelationConfig>
    <BuildMapRule><Reference class="sailpoint.object.Rule" name="R1"/></BuildMapRule>
    <Owner><Reference class="sailpoint.object.Identity" name="spadmin"/></Owner>
    <Remediators><Reference class="sailpoint.object.Identity" name="IAM Team"/></Remediators>
    <Attributes><Map>
      <entry key="afterProvisioningRule" value="R2"/>
      <entry key="customizationRule"><value><Reference class="sailpoint.object.Rule" name="R1"/></value></entry>
      <entry key="emptyRule"/>
      <entry key="template" value="$(name)"/>
      <entry key="plain" value="x"/>
    </Map></Attributes>
    <Step action="rule:R3"/>
  </Application>`));
  assert.deepEqual(refs.map(r => [r.category, r.type, r.name]), [
    ['rule', 'Rule', 'R1'], ['rule', 'Rule', 'R2'], ['rule', 'Rule', 'R3'],
    ['identity', 'Identity', 'IAM Team'], ['identity', 'Identity', 'spadmin'],
    ['other', 'CorrelationConfig', 'Corr']
  ]);
  const r1 = refs.find(r => r.name === 'R1')!;
  assert.deepEqual(r1.uses.map(u => u.role), ['BuildMapRule', 'customizationRule'], 'one group, every place it is used');
  assert.equal(refs.find(r => r.name === 'R2')!.uses[0].role, 'afterProvisioningRule');
  assert.equal(refs.find(r => r.name === 'spadmin')!.uses[0].role, 'Owner');
  assert.equal(refs.find(r => r.name === 'R3')!.uses[0].role, 'Step');
});

test('references: a typed *Ref wrapper is counted once, with the wrapper tag skipped from the role', () => {
  const refs = collectReferences(app(`<Application name="A"><Wrapper><RuleRef><Reference class="sailpoint.object.Rule" name="R"/></RuleRef></Wrapper></Application>`));
  assert.equal(refs.length, 1);
  assert.equal(refs[0].uses.length, 1);
  assert.equal(refs[0].uses[0].role, 'Wrapper');
});

test('references: reference offsets point at the tag', () => {
  const xml = '<Application name="A"><Owner><Reference class="sailpoint.object.Identity" name="x"/></Owner></Application>';
  const use = collectReferences(app(xml))[0].uses[0];
  assert.equal(xml.slice(use.offset, use.offset + 9), 'Reference');
});

test('buildApplicationModel: header fields and ranges', () => {
  const xml = '<sailpoint><Application name="A" type="LDAP" connector="c.X"/></sailpoint>';
  const m = buildApplicationModel(app(xml));
  assert.deepEqual([m.name, m.type, m.connector], ['A', 'LDAP', 'c.X']);
  assert.equal(xml.slice(m.start, m.end), '<Application name="A" type="LDAP" connector="c.X"/>');
  assert.equal(buildApplicationModel(app('<Application/>')).name, '(unnamed application)');
});

test('sample Active Directory application: schemas and references', () => {
  const m = buildApplicationModel(app(sample('Application-ActiveDirectory-Example.xml')));
  assert.equal(m.name, 'Corp Active Directory');
  assert.deepEqual(m.schemas.map(s => [s.objectType, s.rows.length]), [['account', 5], ['group', 3]]);
  const account = m.schemas[0];
  assert.equal(account.rows.find(r => r.name === 'memberOf')!.entitlement, true);
  assert.equal(account.rows.find(r => r.name === 'distinguishedName')!.identity, true);
  assert.equal(account.rows.find(r => r.name === 'distinguishedName')!.description, 'Unique LDAP path of the account');
  assert.deepEqual(m.references.filter(r => r.category === 'rule').map(r => r.name), [
    'Example - AD After Provisioning', 'Example - AD Customization', 'Example - AD Manager Correlation'
  ]);
  assert.deepEqual(m.references.filter(r => r.category === 'identity').map(r => r.name), ['spadmin']);
});
