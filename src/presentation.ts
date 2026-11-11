import * as vscode from 'vscode';
import { XmlNode, getAttr } from './parser/xmlParser';
import { IIQ_OBJECT_TYPES, TAG_DOCS, getReference, isCodeContainer } from './iiq/knowledge';

const MAX_PREVIEW = 60;

function oneLine(text: string, max = MAX_PREVIEW): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function lineCount(text: string): number {
  const trimmed = text.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  return trimmed.length === 0 ? 0 : trimmed.split('\n').length;
}

/** For <entry><value><String>abc</String></value></entry>, returns "abc"; undefined for lists/maps. */
function simpleNestedValue(entry: XmlNode): string | undefined {
  const elements = (n: XmlNode) => n.children.filter(c => c.kind === 'element');
  const value = elements(entry);
  if (value.length !== 1 || value[0].name !== 'value') { return undefined; }
  const inner = elements(value[0]);
  if (inner.length !== 1) { return undefined; }
  const leaf = inner[0];
  if (leaf.children.length === 1 && leaf.children[0].kind === 'text') { return oneLine(leaf.children[0].text, 40); }
  if (leaf.name === 'Reference') {
    const ref = getReference(leaf);
    return ref ? `${ref.type} → ${ref.name}` : undefined;
  }
  if (leaf.name === 'List' || leaf.name === 'Set') {
    const items = elements(leaf);
    const texts = items.map(i => i.children.length === 1 && i.children[0].kind === 'text' ? i.children[0].text.trim() : undefined);
    if (items.length > 0 && texts.every(t => t !== undefined)) {
      return oneLine(`[${texts.join(', ')}]`, 80);
    }
    return `${leaf.name}[${items.length}]`;
  }
  if (leaf.name === 'Map') {
    return `Map{${elements(leaf).length}}`;
  }
  return undefined;
}

export function labelFor(node: XmlNode): string {
  switch (node.kind) {
    case 'element': return node.name;
    case 'cdata': return isCodeContainer(node.parent?.name) ? 'BeanShell' : 'CDATA';
    case 'text': return `"${oneLine(node.text, 40)}"`;
    case 'comment': return `<!-- ${oneLine(node.text, 40)} -->`;
    case 'doctype': return `DOCTYPE ${node.name}`;
    case 'pi': return `<?${node.name}?>`;
  }
}

export function descriptionFor(node: XmlNode, previewKeys: string[], showAttributes: boolean): string {
  if (node.kind === 'cdata') {
    const n = lineCount(node.text);
    return `${n} line${n === 1 ? '' : 's'}`;
  }
  if (node.kind === 'doctype') { return oneLine(node.text.slice(node.name.length)); }
  if (node.kind === 'pi') { return oneLine(node.text); }
  if (node.kind !== 'element') { return ''; }

  // <Reference class="sailpoint.object.Rule" name="X"/>  →  Rule → X
  if (node.name === 'Reference') {
    const ref = getReference(node);
    if (ref) { return `${ref.type} → ${ref.name}`; }
  }

  const parts: string[] = [];
  if (showAttributes) {
    for (const key of previewKeys) {
      const v = getAttr(node, key);
      if (v !== undefined) { parts.push(`${key}=${oneLine(v, 40)}`); }
    }
    // Map entries are the most common tag in IIQ files: show key → value compactly.
    if (node.name === 'entry' && parts.length === 0 && node.attributes.length > 0) {
      parts.push(node.attributes.map(a => `${a.name}=${oneLine(a.value, 30)}`).join(' '));
    }
  }

  // An element that only wraps text (e.g. <String>abc</String>, <Description>) shows the text inline.
  if (node.children.length === 1 && node.children[0].kind === 'text') {
    parts.push(`"${oneLine(node.children[0].text, 40)}"`);
  }

  // <entry key="x"><value><Boolean>true</Boolean></value></entry>  →  key=x  ·  = true
  if (node.name === 'entry' && getAttr(node, 'value') === undefined) {
    const nested = simpleNestedValue(node);
    if (nested !== undefined) { parts.push(`= ${nested}`); }
    else if (!node.children.some(c => c.kind === 'element' || c.kind === 'text' || c.kind === 'cdata')) { parts.push('= (empty)'); }
  }

  const shownCount = showAttributes ? previewKeys.filter(k => getAttr(node, k) !== undefined).length : 0;
  const hidden = node.attributes.length - shownCount;
  if (hidden > 0 && !(showAttributes && node.name === 'entry')) { parts.push(`+${hidden} attr`); }
  if (node.unclosed) { parts.push('⚠ not closed'); }
  return parts.join('  ·  ');
}

/** Tags that hold an identity or workgroup (owner, approvers, remediators...). */
const IDENTITY_TAGS = new Set<string>([
  'Owner', 'Owners', 'OwnerRef', 'Remediator', 'Remediators', 'Approver', 'Approvers',
  'Requester', 'Requesters', 'Requestor', 'Assignee', 'Assignees', 'Certifier', 'Certifiers',
  'Manager', 'ManagerRef', 'IdentityRef', 'Workgroup', 'Workgroups', 'Signer', 'Launcher'
]);

/**
 * True for anything that points at an identity or workgroup (workgroups are Identity objects in IIQ):
 * a known identity tag, a <Reference class="sailpoint.object.Identity" .../>, or a wrapper
 * whose only child element is such a reference (e.g. <Remediator><Reference .../></Remediator>).
 */
function refersToIdentity(node: XmlNode): boolean {
  if (IDENTITY_TAGS.has(node.name)) { return true; }
  const isIdentityRef = (n: XmlNode) => {
    if (n.kind !== 'element' || n.name !== 'Reference') { return false; }
    const ref = getReference(n);
    return !!ref && (ref.type === 'Identity' || ref.type === 'Workgroup');
  };
  if (isIdentityRef(node)) { return true; }
  const elems = node.children.filter(c => c.kind === 'element');
  return elems.length > 0 && elems.every(isIdentityRef) && !IIQ_OBJECT_TYPES.has(node.name);
}

export function iconFor(node: XmlNode): vscode.ThemeIcon {
  switch (node.kind) {
    case 'cdata':
      return isCodeContainer(node.parent?.name)
        ? new vscode.ThemeIcon('code', new vscode.ThemeColor('symbolIcon.functionForeground'))
        : new vscode.ThemeIcon('symbol-string');
    case 'text': return new vscode.ThemeIcon('symbol-text');
    case 'comment': return new vscode.ThemeIcon('comment');
    case 'doctype':
    case 'pi': return new vscode.ThemeIcon('symbol-namespace');
    case 'element':
      break;
  }
  if (node.unclosed) { return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground')); }
  if (refersToIdentity(node)) { return new vscode.ThemeIcon('person'); }
  if (getReference(node)) { return new vscode.ThemeIcon('link', new vscode.ThemeColor('symbolIcon.referenceForeground')); }
  if (IIQ_OBJECT_TYPES.has(node.name) && (!node.parent || node.parent.name === 'sailpoint')) {
    return new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('symbolIcon.classForeground'));
  }
  switch (node.name) {
    case 'Step': return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('symbolIcon.eventForeground'));
    case 'Transition': return new vscode.ThemeIcon('arrow-right');
    case 'Variable': return new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('symbolIcon.variableForeground'));
    case 'Arg':
    case 'Argument': return new vscode.ThemeIcon('symbol-parameter');
    case 'entry': return new vscode.ThemeIcon('symbol-key', new vscode.ThemeColor('symbolIcon.keyForeground'));
    case 'Map':
    case 'Attributes':
    case 'AccountCorrelationConfig': return new vscode.ThemeIcon('symbol-structure');
    case 'List':
    case 'Set': return new vscode.ThemeIcon('symbol-array');
    case 'Source':
    case 'Script': return new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('symbolIcon.methodForeground'));
    case 'Schema': return new vscode.ThemeIcon('table');
    case 'AttributeDefinition':
    case 'Field': return new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('symbolIcon.fieldForeground'));
    case 'Description': return new vscode.ThemeIcon('note');
    case 'Approval': return new vscode.ThemeIcon('person');
    case 'Form':
    case 'Section': return new vscode.ThemeIcon('symbol-interface');
    case 'Filter':
    case 'CompositeFilter':
    case 'IdentitySelector':
    case 'MatchExpression':
    case 'MatchTerm': return new vscode.ThemeIcon('filter');
    case 'String':
    case 'Boolean':
    case 'Integer':
    case 'Long':
    case 'Date': return new vscode.ThemeIcon('symbol-constant');
  }
  return new vscode.ThemeIcon('symbol-tag');
}

export function tooltipFor(node: XmlNode, document: vscode.TextDocument): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  const startLine = document.positionAt(node.start).line + 1;
  const endLine = document.positionAt(Math.max(node.start, node.end - 1)).line + 1;
  const lines = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;

  if (node.kind === 'element') {
    md.appendMarkdown(`**\`<${node.name}>\`** — ${lines}\n\n`);
    const doc = TAG_DOCS[node.name];
    if (doc) { md.appendMarkdown(`${doc}\n\n`); }
    if (node.attributes.length > 0) {
      md.appendMarkdown('| Attribute | Value |\n|---|---|\n');
      for (const a of node.attributes) {
        const v = a.value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        md.appendMarkdown(`| \`${a.name}\` | ${v.length > 120 ? v.slice(0, 119) + '…' : v} |\n`);
      }
      md.appendMarkdown('\n');
    }
    const ref = getReference(node);
    if (ref) { md.appendMarkdown(`$(link) References **${ref.type}** \`${ref.name}\` — use *Go to Referenced Object*.\n\n`); }
    const childTags = node.children.filter(c => c.kind === 'element').length;
    if (childTags > 0) { md.appendMarkdown(`${childTags} child element${childTags === 1 ? '' : 's'}\n`); }
    if (node.unclosed) { md.appendMarkdown('\n$(warning) This element is not closed.\n'); }
  } else if (node.kind === 'cdata') {
    md.appendMarkdown(`**${labelFor(node)}** — ${lines}\n\n`);
    const preview = node.text.replace(/^\s*\n/, '').split('\n').slice(0, 15).join('\n');
    md.appendCodeblock(preview, 'java');
  } else {
    md.appendMarkdown(`**${labelFor(node)}** — ${lines}\n\n`);
    md.appendText(node.text.slice(0, 500));
  }
  return md;
}
