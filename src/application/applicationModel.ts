/**
 * Extracts what the Application views show from a parsed <Application> element:
 * its schemas (as table rows) and every object it references.
 * Pure TypeScript, no VS Code dependency, so it can be unit-tested.
 */
import { XmlDocumentModel, XmlNode, getAttr, walk } from '../parser/xmlParser';
import { REF_TAG_CLASS, getNavigableReference, getReference } from '../iiq/knowledge';

export interface SchemaRow {
  name: string;
  type: string;
  description: string;
  identity: boolean;
  display: boolean;
  entitlement: boolean;
  managed: boolean;
  multi: boolean;
  minable: boolean;
  correlationKey: boolean;
  required: boolean;
  /** Offset of the <AttributeDefinition tag name, for reveal. */
  offset: number;
}

export interface SchemaModel {
  /** objectType, e.g. "account" or "group". */
  objectType: string;
  nativeObjectType?: string;
  identityAttribute?: string;
  displayAttribute?: string;
  instanceAttribute?: string;
  groupAttribute?: string;
  rows: SchemaRow[];
  offset: number;
}

export type RefCategory = 'rule' | 'identity' | 'other';

export interface RefUse {
  /** Where the reference sits, e.g. "BuildMapRule", "Owner", "afterProvisioningRule". */
  role: string;
  offset: number;
}

export interface AppReference {
  category: RefCategory;
  /** Object class, e.g. "Rule". */
  type: string;
  name: string;
  uses: RefUse[];
}

export interface ApplicationModel {
  name: string;
  type?: string;
  connector?: string;
  offset: number;
  start: number;
  end: number;
  schemas: SchemaModel[];
  references: AppReference[];
}

const isTrue = (v: string | undefined) => v !== undefined && /^(true|1)$/i.test(v.trim());

/** All top-level <Application> elements of a document (also inside <sailpoint>). */
export function findApplications(model: XmlDocumentModel): XmlNode[] {
  const root = model.root;
  if (!root) { return []; }
  const top = root.name === 'sailpoint' ? root.children : [root];
  return top.filter(n => n.kind === 'element' && n.name === 'Application');
}

/** The application containing the offset, otherwise the first one. */
export function pickApplication(model: XmlDocumentModel, offset?: number): XmlNode | undefined {
  const all = findApplications(model);
  if (offset !== undefined) {
    const hit = all.find(a => offset >= a.start && offset < a.end);
    if (hit) { return hit; }
  }
  return all[0];
}

function descriptionOf(def: XmlNode): string {
  const fromAttr = getAttr(def, 'description');
  if (fromAttr) { return fromAttr; }
  const child = def.children.find(c => c.kind === 'element' && c.name === 'Description');
  return child ? child.children.filter(c => c.kind === 'text' || c.kind === 'cdata').map(c => c.text).join('').trim() : '';
}

export function buildSchemas(app: XmlNode): SchemaModel[] {
  const schemas: SchemaModel[] = [];
  walk(app.children, n => {
    if (n.kind !== 'element' || n.name !== 'Schema') { return true; }
    const identity = getAttr(n, 'identityAttribute');
    const display = getAttr(n, 'displayAttribute');
    const rows: SchemaRow[] = n.children
      .filter(c => c.kind === 'element' && c.name === 'AttributeDefinition')
      .map(def => {
        const name = getAttr(def, 'name') ?? '';
        return {
          name,
          type: getAttr(def, 'type') ?? '',
          description: descriptionOf(def),
          identity: !!identity && name === identity,
          display: !!display && name === display,
          entitlement: isTrue(getAttr(def, 'entitlement')),
          managed: isTrue(getAttr(def, 'managed')),
          multi: isTrue(getAttr(def, 'multi')),
          minable: isTrue(getAttr(def, 'minable')),
          correlationKey: !!getAttr(def, 'correlationKey') && getAttr(def, 'correlationKey') !== '0',
          required: isTrue(getAttr(def, 'required')),
          offset: def.nameStart
        };
      });
    schemas.push({
      objectType: getAttr(n, 'objectType') ?? getAttr(n, 'nativeObjectType') ?? 'account',
      nativeObjectType: getAttr(n, 'nativeObjectType'),
      identityAttribute: identity,
      displayAttribute: display,
      instanceAttribute: getAttr(n, 'instanceAttribute'),
      groupAttribute: getAttr(n, 'groupAttribute'),
      rows,
      offset: n.nameStart
    });
    return false;   // schemas do not nest
  });
  return schemas;
}

/** A readable name for where a reference sits: the wrapper tag, or the map key of its entry. */
function roleOf(node: XmlNode): string {
  if (node.name === 'entry') { return getAttr(node, 'key') ?? 'entry'; }
  if (node.name !== 'Reference') {
    const n = getAttr(node, 'name');
    return n ? `${node.name} ${n}` : node.name;
  }
  let parent = node.parent;
  if (parent && REF_TAG_CLASS[parent.name]) { parent = parent.parent; }          // <RuleRef><Reference/></RuleRef>
  if (parent && parent.name === 'value' && parent.parent?.name === 'entry') {     // <entry key="k"><value><Reference/>
    return getAttr(parent.parent, 'key') ?? 'entry';
  }
  return parent?.name ?? 'Reference';
}

function categoryOf(type: string): RefCategory {
  if (type === 'Rule') { return 'rule'; }
  if (type === 'Identity' || type === 'Workgroup') { return 'identity'; }
  return 'other';
}

/** Every reference inside the application (rules, identities, other objects), grouped by object. */
export function collectReferences(app: XmlNode): AppReference[] {
  const groups = new Map<string, AppReference>();
  walk(app.children, n => {
    if (n.kind !== 'element') { return true; }
    if (REF_TAG_CLASS[n.name]) { return true; }                // the inner <Reference> is counted instead
    let ref = getReference(n);
    if (!ref && n.name === 'entry' && !n.children.some(c => c.kind === 'element')) {
      ref = getNavigableReference(n);                          // <entry key="afterProvisioningRule" value="My Rule"/>
    }
    if (!ref) { return true; }
    const key = `${ref.type}\u0000${ref.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { category: categoryOf(ref.type), type: ref.type, name: ref.name, uses: [] };
      groups.set(key, g);
    }
    g.uses.push({ role: roleOf(n), offset: n.nameStart });
    return true;
  });
  const order: Record<RefCategory, number> = { rule: 0, identity: 1, other: 2 };
  return [...groups.values()].sort((a, b) =>
    order[a.category] - order[b.category] || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

export function buildApplicationModel(app: XmlNode): ApplicationModel {
  return {
    name: getAttr(app, 'name') ?? '(unnamed application)',
    type: getAttr(app, 'type'),
    connector: getAttr(app, 'connector'),
    offset: app.nameStart,
    start: app.start,
    end: app.end,
    schemas: buildSchemas(app),
    references: collectReferences(app)
  };
}
