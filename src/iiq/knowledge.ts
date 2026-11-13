/**
 * IdentityIQ-specific knowledge: what common tags mean, which ones are top-level
 * objects, and how references to other objects are written.
 */
import { XmlDocumentModel, XmlNode, getAttr } from '../parser/xmlParser';

/** Top-level SailPoint object types that can live in their own XML file. */
export const IIQ_OBJECT_TYPES = new Set<string>([
  'Rule', 'Workflow', 'Application', 'TaskDefinition', 'TaskSchedule', 'Identity', 'Bundle',
  'Profile', 'Policy', 'Form', 'Configuration', 'ObjectConfig', 'AuditConfig', 'QuickLink',
  'QuickLinkOptions', 'Capability', 'SPRight', 'EmailTemplate', 'Custom', 'CorrelationConfig',
  'IdentityTrigger', 'GroupFactory', 'GroupDefinition', 'Scope', 'Workgroup', 'RuleRegistry',
  'Dictionary', 'ManagedAttribute', 'Plugin', 'DynamicScope', 'Certification',
  'CertificationDefinition', 'Partition', 'Scorecard', 'ScoreConfig', 'TargetSource',
  'Target', 'UIConfig', 'IntegrationConfig', 'ProvisioningRequest', 'FullTextIndex',
  'Alert', 'AlertDefinition', 'MitigationExpiration', 'RoleIndex', 'Server', 'ServiceDefinition',
  'Request', 'RequestDefinition', 'JasperTemplate', 'LocalizedAttribute', 'Module', 'Recommender'
]);

/** Short explanations shown in hovers and tree tooltips. */
export const TAG_DOCS: Record<string, string> = {
  sailpoint: 'Wrapper element used when one XML file contains several IdentityIQ objects (import file).',
  ImportAction: 'Import directive inside a <sailpoint> file, e.g. merge or execute a command during import.',
  Rule: 'A BeanShell rule. The `type` attribute (BuildMap, Correlation, BeforeProvisioning, ...) decides where IdentityIQ calls it and which variables it receives.',
  Signature: 'Documents the rule\'s inputs and return value. Mostly informational; IIQ passes the variables regardless.',
  Inputs: 'List of variables passed into the rule.',
  Returns: 'What the rule is expected to return.',
  Argument: 'One documented input or return value of a rule (name, type, description).',
  Source: 'The BeanShell (or Java) code of a rule or script, usually wrapped in CDATA.',
  Description: 'Free-text description of the enclosing object.',
  ReferencedRules: 'Other Rule objects whose code is made available to this rule (rule libraries).',
  Reference: 'A pointer to another IdentityIQ object, identified by `class` and `name` (or `id`).',
  Workflow: 'A business process made of Steps connected by Transitions. Variables carry state between steps.',
  Variable: 'A workflow variable. `input="true"` means it can be passed in by the caller; `initializer` sets a default.',
  Step: 'One step of a workflow. `action` can be `rule:`, `script:`, `call:` (library method) or a subprocess.',
  Transition: 'Moves the workflow to another step (`to`). The optional `when` condition decides if it is taken.',
  Arg: 'An argument passed to a step action, approval or subprocess. `value` may be a literal, `ref:var`, `script:` or `rule:`.',
  Return: 'Copies a value back from a step or subprocess into a workflow variable.',
  Script: 'Inline BeanShell code used by a step, condition, initializer or form field.',
  Approval: 'A work item step that waits for a person (or group) to approve, reject or fill a form.',
  WorkflowRef: 'Reference to another workflow, used to call it as a subprocess.',
  RuleLibraries: 'Rule libraries made available to all scripts of the workflow.',
  Application: 'A connected system. Holds connector settings, schemas, correlation and provisioning configuration.',
  Schema: 'Account or group schema of an application: the attributes IIQ reads from the source.',
  AttributeDefinition: 'One attribute of a schema, form or object config.',
  Attributes: 'Generic key/value container (holds a <Map> of entries).',
  Map: 'Key/value map. Each <entry> has a `key` and a `value` (attribute or nested <value>).',
  entry: 'One key/value pair of a <Map>.',
  value: 'Value of a map entry when it is not a simple string (list, map, reference...).',
  List: 'An ordered list of values.',
  Set: 'An unordered set of values.',
  String: 'A string value.',
  Boolean: 'A boolean value.',
  Integer: 'An integer value.',
  Long: 'A long integer value.',
  Date: 'A date value (milliseconds since epoch).',
  TaskDefinition: 'Defines a task (aggregation, refresh, report...). Arguments live in <Attributes>.',
  TaskSchedule: 'Schedules a TaskDefinition to run (cron-like).',
  Identity: 'An identity (person or service account) with its attributes and links.',
  Link: 'An account of an identity on an application.',
  Bundle: 'A role (business, IT, organizational...).',
  Profile: 'Entitlement profile of an IT role: which application entitlements make up the role.',
  Policy: 'A policy (SoD, risk, activity...). Violations are detected by its constraints or rules.',
  Filter: 'A filter expression, e.g. `name == "x"`, used to select objects.',
  CompositeFilter: 'Combines several filters with AND / OR.',
  IdentitySelector: 'Selects identities by match terms, filter, script, rule or population.',
  MatchExpression: 'A list of match terms combined with AND / OR.',
  MatchTerm: 'A single condition on an attribute or entitlement.',
  Form: 'A form shown to users (provisioning policy, approval form, workflow form).',
  Section: 'A group of fields inside a form.',
  Field: 'One field of a form. Can have a value, allowed values, validation and scripts.',
  Button: 'A form button and the action it triggers (next, back, cancel...).',
  Configuration: 'A configuration object (SystemConfiguration, IdentitySelectorConfiguration, ...).',
  ObjectConfig: 'Configuration of an object type, for example which identity attributes exist.',
  Custom: 'A Custom object: a generic key/value store, often used for lookup tables and settings.',
  CorrelationConfig: 'Rules that correlate accounts to identities by attribute matching.',
  QuickLink: 'An entry on the home page / quick-link menu, usually launching a workflow.',
  EmailTemplate: 'An email template with subject and body (Velocity syntax).',
  ProvisioningPolicy: 'Form-like policy that computes or asks for values when creating/updating accounts.',
  Template: 'Provisioning policy template (legacy name for a provisioning form).',
  Owner: 'The owner of the object (identity or workgroup).',
  ManagedAttribute: 'An entitlement or account group with its description and owner.',
  ProvisioningPlan: 'Describes changes to make on identities and accounts (account and attribute requests).',
  AccountRequest: 'Part of a provisioning plan: an operation on one account.',
  AttributeRequest: 'Part of an account request: add/remove/set one attribute value.'
};

/** Element names that hold a reference to another object, mapped to the object class. */
export const REF_TAG_CLASS: Record<string, string> = {
  RuleRef: 'Rule',
  WorkflowRef: 'Workflow',
  ApplicationRef: 'Application',
  IdentityRef: 'Identity',
  BundleRef: 'Bundle',
  TaskDefinitionRef: 'TaskDefinition',
  FormRef: 'Form',
  PolicyRef: 'Policy',
  OwnerRef: 'Identity',
  EmailTemplateRef: 'EmailTemplate'
};

export interface IiqReference {
  /** Object class, e.g. "Rule". */
  type: string;
  /** Object name (or id when no name is given). */
  name: string;
}

/** Heuristic: is this document an IdentityIQ XML file? */
export function isIiqDocument(model: XmlDocumentModel): boolean {
  if (model.nodes.some(n => n.kind === 'doctype' && /sailpoint\.dtd/i.test(n.text))) { return true; }
  const root = model.root;
  return !!root && (root.name === 'sailpoint' || IIQ_OBJECT_TYPES.has(root.name));
}

/**
 * If the node refers to another IIQ object, return what it points to.
 * Handles:
 *   <Reference class="sailpoint.object.Rule" name="X"/>
 *   <RuleRef><Reference .../></RuleRef>  (resolved on the inner Reference)
 *   <Step action="rule:X">,  <Arg value="rule:X"/>,  <Field ... ruleName="X">
 */
export function getReference(node: XmlNode): IiqReference | undefined {
  if (node.kind !== 'element') { return undefined; }

  if (node.name === 'Reference') {
    const cls = getAttr(node, 'class');
    const name = getAttr(node, 'name') ?? getAttr(node, 'id');
    if (cls && name) {
      return { type: cls.split('.').pop()!, name };
    }
    // Inside a typed *Ref wrapper the class may be implied.
    const parentType = node.parent ? REF_TAG_CLASS[node.parent.name] : undefined;
    if (parentType && name) { return { type: parentType, name }; }
    return undefined;
  }

  if (REF_TAG_CLASS[node.name]) {
    const inner = node.children.find(c => c.kind === 'element' && c.name === 'Reference');
    return inner ? getReference(inner) : undefined;
  }

  for (const attr of ['action', 'value', 'rule']) {
    const v = getAttr(node, attr);
    if (v && /^rule:/.test(v)) {
      return { type: 'Rule', name: v.slice(5).trim() };
    }
  }

  const ruleName = getAttr(node, 'ruleName');
  if (ruleName) {
    return { type: 'Rule', name: ruleName };
  }

  return undefined;
}

/**
 * Like getReference, but also for the nodes a person naturally right-clicks:
 *   - a wrapper whose only child element is a <Reference> (<BuildMapRule>, <Owner>, <AccountCorrelationConfig>...)
 *   - a map entry naming a rule: <entry key="afterProvisioningRule" value="My Rule"/>
 * Kept separate from getReference so icons of wrappers are not changed.
 */
export function getNavigableReference(node: XmlNode): IiqReference | undefined {
  const direct = getReference(node);
  if (direct || node.kind !== 'element') { return direct; }

  const childElements = node.children.filter(c => c.kind === 'element');
  if (childElements.length === 1 && childElements[0].name === 'Reference') {
    return getReference(childElements[0]);
  }

  if (node.name === 'entry') {
    const key = getAttr(node, 'key') ?? '';
    const value = (getAttr(node, 'value') ?? '').trim();
    if (/Rule$/.test(key) && value && !value.includes('$(')) {
      return { type: 'Rule', name: value };
    }
  }
  return undefined;
}

/** Tags whose CDATA/text content is code. */
export function isCodeContainer(tag: string | undefined): boolean {
  return tag === 'Source' || tag === 'Script';
}
