import * as vscode from 'vscode';
import { XmlNode, findNodeAt, getAttr } from './parser/xmlParser';
import { DocumentCache } from './documentCache';
import { IIQ_OBJECT_TYPES, TAG_DOCS, getReference, isIiqDocument } from './iiq/knowledge';
import { labelFor } from './presentation';

function symbolKind(node: XmlNode): vscode.SymbolKind {
  if (node.kind === 'cdata') { return vscode.SymbolKind.Function; }
  if (IIQ_OBJECT_TYPES.has(node.name) && (!node.parent || node.parent.name === 'sailpoint')) { return vscode.SymbolKind.Class; }
  switch (node.name) {
    case 'Step': return vscode.SymbolKind.Event;
    case 'Variable': return vscode.SymbolKind.Variable;
    case 'Arg':
    case 'Argument': return vscode.SymbolKind.TypeParameter;
    case 'entry': return vscode.SymbolKind.Key;
    case 'Source':
    case 'Script': return vscode.SymbolKind.Method;
    case 'Field':
    case 'AttributeDefinition': return vscode.SymbolKind.Field;
    case 'Transition': return vscode.SymbolKind.Operator;
    case 'List':
    case 'Set': return vscode.SymbolKind.Array;
    case 'Map':
    case 'Attributes': return vscode.SymbolKind.Struct;
  }
  return getReference(node) ? vscode.SymbolKind.Constant : vscode.SymbolKind.Property;
}

/** Outline view and breadcrumbs for IdentityIQ XML files. */
export class IiqDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    if (!vscode.workspace.getConfiguration('iiqXmlExplorer').get<boolean>('provideOutline', true)) { return []; }
    const model = this.cache.get(document);
    if (!isIiqDocument(model)) { return []; }

    const convert = (node: XmlNode): vscode.DocumentSymbol | undefined => {
      if (node.kind !== 'element' && node.kind !== 'cdata') { return undefined; }
      const range = new vscode.Range(document.positionAt(node.start), document.positionAt(node.end));
      const selStart = node.kind === 'element' ? node.nameStart : node.start;
      const selEnd = node.kind === 'element' ? node.nameStart + node.name.length : Math.min(node.end, node.start + 9);
      const selection = new vscode.Range(document.positionAt(selStart), document.positionAt(selEnd));
      const id = getAttr(node, 'name') ?? getAttr(node, 'key');
      const name = node.kind === 'element' && id ? `${node.name} ${id}` : labelFor(node);
      const detail = node.kind === 'element' ? (getAttr(node, 'type') ?? getAttr(node, 'action') ?? getAttr(node, 'value') ?? '') : '';
      const sym = new vscode.DocumentSymbol(name, detail, symbolKind(node), range, selection);
      sym.children = node.children.map(convert).filter((s): s is vscode.DocumentSymbol => !!s);
      return sym;
    };

    return model.nodes.map(convert).filter((s): s is vscode.DocumentSymbol => !!s);
  }
}

/** Short IIQ explanation when hovering a tag name. */
export class IiqHoverProvider implements vscode.HoverProvider {
  constructor(private readonly cache: DocumentCache) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!vscode.workspace.getConfiguration('iiqXmlExplorer').get<boolean>('provideHovers', true)) { return undefined; }
    const model = this.cache.get(document);
    if (!isIiqDocument(model)) { return undefined; }

    const offset = document.offsetAt(position);
    const node = findNodeAt(model.nodes, offset);
    if (!node || node.kind !== 'element') { return undefined; }

    // Only on the tag name of the opening tag (closing tags are matched by name too).
    const onOpenName = offset >= node.nameStart && offset <= node.nameStart + node.name.length;
    const closeNameStart = node.end - node.name.length - 1;
    const onCloseName = !node.selfClosing && !node.unclosed && offset >= closeNameStart && offset < node.end - 1;
    if (!onOpenName && !onCloseName) { return undefined; }

    const doc = TAG_DOCS[node.name];
    const ref = getReference(node);
    if (!doc && !ref) { return undefined; }

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**IIQ \`<${node.name}>\`**\n\n`);
    if (doc) { md.appendMarkdown(doc + '\n\n'); }
    if (ref) { md.appendMarkdown(`$(link) References **${ref.type}** \`${ref.name}\``); }
    const range = onOpenName
      ? new vscode.Range(document.positionAt(node.nameStart), document.positionAt(node.nameStart + node.name.length))
      : new vscode.Range(document.positionAt(closeNameStart), document.positionAt(node.end - 1));
    return new vscode.Hover(md, range);
  }
}

/** Ctrl+Click on a reference (Reference name, rule:X, ruleName="X") opens the referenced object's file. */
export class IiqDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly cache: DocumentCache) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | undefined> {
    const model = this.cache.get(document);
    if (!isIiqDocument(model)) { return undefined; }
    const node = findNodeAt(model.nodes, document.offsetAt(position));
    if (!node || node.kind !== 'element' || document.offsetAt(position) > node.openTagEnd) { return undefined; }
    const ref = getReference(node);
    if (!ref) { return undefined; }
    return findObjectDefinitions(ref.type, ref.name, this.cache);
  }
}

/** Searches workspace XML files for `<Type ... name="Name"`. */
export async function findObjectDefinitions(type: string, name: string, cache: DocumentCache): Promise<vscode.Location[]> {
  const files = await vscode.workspace.findFiles('**/*.xml', '{**/node_modules/**,**/out/**,**/.git/**}', 5000);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quick = new RegExp(`<${type}\\b[^>]*\\bname\\s*=\\s*["']${escaped}["']`);
  const results: vscode.Location[] = [];

  await Promise.all(files.map(async uri => {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return;
    }
    const m = quick.exec(text);
    if (!m) { return; }
    const doc = await vscode.workspace.openTextDocument(uri);
    const model = cache.get(doc);
    let target: XmlNode | undefined;
    const visit = (nodes: XmlNode[]) => {
      for (const n of nodes) {
        if (target) { return; }
        if (n.kind === 'element' && n.name === type && getAttr(n, 'name') === name) { target = n; return; }
        visit(n.children);
      }
    };
    visit(model.nodes);
    const offset = target ? target.nameStart : m.index + 1;
    const pos = doc.positionAt(offset);
    results.push(new vscode.Location(uri, pos));
  }));

  return results;
}
