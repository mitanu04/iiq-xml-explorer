import * as vscode from 'vscode';
import { XmlAttribute, XmlDocumentModel, XmlNode, XmlParseProblem } from './parser/xmlParser';
import { DocumentCache, isXmlDocument } from './documentCache';
import { getNavigableReference, isIiqDocument } from './iiq/knowledge';
import { descriptionFor, iconFor, labelFor, tooltipFor } from './presentation';

/** Must match the default of `iiqXmlExplorer.previewAttributes` in package.json. */
export const DEFAULT_PREVIEW_KEYS = ['name', 'key', 'type', 'action', 'value', 'to', 'when', 'class', 'connector'];

/** Synthetic node listing parse problems at the top of the tree. */
export interface ProblemsEntry { kind: 'problems'; problems: XmlParseProblem[] }
export interface ProblemEntry { kind: 'problem'; problem: XmlParseProblem; parent: ProblemsEntry }
/** One attribute of an element, shown as a child node (e.g. name = GLOBEX). */
export interface AttributeEntry { kind: 'attribute'; attr: XmlAttribute; parent: XmlNode }
export type TreeEntry = XmlNode | ProblemsEntry | ProblemEntry | AttributeEntry;

function isXmlNode(e: TreeEntry): e is XmlNode {
  return e.kind !== 'problems' && e.kind !== 'problem' && e.kind !== 'attribute';
}

export class StructureTreeProvider implements vscode.TreeDataProvider<TreeEntry> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeEntry | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private document?: vscode.TextDocument;
  private model?: XmlDocumentModel;
  private problemsEntry?: ProblemsEntry;

  constructor(private readonly cache: DocumentCache) {}

  // ---- state ---------------------------------------------------------------

  get currentDocument(): vscode.TextDocument | undefined { return this.document; }
  get currentModel(): XmlDocumentModel | undefined { return this.model; }

  /** Point the tree at a document (or clear it). Returns true if something is shown. */
  setDocument(document: vscode.TextDocument | undefined): boolean {
    if (!document || !isXmlDocument(document)) {
      // Keep showing the last XML file when focus moves away from a text editor
      // or to a non-file editor such as the Output panel.
      const transient = document === undefined || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled');
      if (transient && this.document) { return true; }
      this.clear();
      return false;
    }
    const model = this.cache.get(document);
    const onlyIiq = vscode.workspace.getConfiguration('iiqXmlExplorer').get<boolean>('onlyIiqFiles', false);
    if (onlyIiq && !isIiqDocument(model)) {
      this.clear();
      return false;
    }
    this.document = document;
    this.model = model;
    this.problemsEntry = model.problems.length > 0 ? { kind: 'problems', problems: model.problems } : undefined;
    this.changeEmitter.fire();
    return true;
  }

  refresh(): void {
    if (this.document) { this.setDocument(this.document); } else { this.changeEmitter.fire(); }
  }

  private clear(): void {
    this.document = undefined;
    this.model = undefined;
    this.problemsEntry = undefined;
    this.changeEmitter.fire();
  }

  // ---- TreeDataProvider ----------------------------------------------------

  getChildren(element?: TreeEntry): TreeEntry[] {
    if (!this.model) { return []; }
    if (!element) {
      const top: TreeEntry[] = [];
      if (this.problemsEntry) { top.push(this.problemsEntry); }
      top.push(...this.visibleChildren(this.model.nodes));
      return top;
    }
    if (element.kind === 'problems') {
      return element.problems.map(p => ({ kind: 'problem', problem: p, parent: element }) as ProblemEntry);
    }
    if (element.kind === 'problem' || element.kind === 'attribute') { return []; }
    return [...this.attributeEntries(element), ...this.visibleChildren(element.children, element)];
  }

  getParent(element: TreeEntry): TreeEntry | undefined {
    if (element.kind === 'problem' || element.kind === 'attribute') { return element.parent; }
    if (element.kind === 'problems') { return undefined; }
    return element.parent;
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem {
    const doc = this.document!;

    if (entry.kind === 'problems') {
      const item = new vscode.TreeItem(`${entry.problems.length} parse problem${entry.problems.length === 1 ? '' : 's'}`,
        vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
      item.contextValue = 'problems';
      return item;
    }
    if (entry.kind === 'problem') {
      const pos = doc.positionAt(entry.problem.start);
      const item = new vscode.TreeItem(entry.problem.message, vscode.TreeItemCollapsibleState.None);
      item.description = `line ${pos.line + 1}`;
      item.iconPath = new vscode.ThemeIcon('circle-small-filled');
      item.command = { command: 'iiqXmlExplorer.reveal', title: 'Reveal', arguments: [{ start: entry.problem.start, end: entry.problem.end }] };
      item.contextValue = 'problem';
      return item;
    }

    if (entry.kind === 'attribute') {
      const { attr, parent } = entry;
      const item = new vscode.TreeItem(attr.name, vscode.TreeItemCollapsibleState.None);
      const flat = attr.value.replace(/\s+/g, ' ').trim();
      item.id = `${doc.uri.toString()}#${parent.start}@${attr.name}`;
      item.description = attr.value === '' ? '(empty)' : (flat.length > 200 ? flat.slice(0, 199) + '…' : flat);
      item.iconPath = new vscode.ThemeIcon('symbol-property', new vscode.ThemeColor('symbolIcon.propertyForeground'));
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**@${attr.name}** of \`<${parent.name}>\`\n\n`);
      md.appendCodeblock(attr.value, 'text');
      item.tooltip = md;
      // Attributes of a reference (e.g. its name) also offer "Go to Referenced Object".
      item.contextValue = getNavigableReference(parent) ? 'attributeReference' : 'attribute';
      item.command = { command: 'iiqXmlExplorer.reveal', title: 'Reveal', arguments: [{ start: attr.start, end: attr.end }] };
      return item;
    }

    const config = vscode.workspace.getConfiguration('iiqXmlExplorer');
    const showAttributes = config.get<boolean>('showAttributes', true);
    const keys = config.get<string[]>('previewAttributes', DEFAULT_PREVIEW_KEYS);

    const hasChildren = this.attributeEntries(entry).length > 0 || this.visibleChildren(entry.children, entry).length > 0;
    const item = new vscode.TreeItem(labelFor(entry),
      hasChildren
        ? (this.startExpanded(entry) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None);
    item.id = `${doc.uri.toString()}#${entry.start}:${entry.kind}`;
    item.description = descriptionFor(entry, keys, showAttributes);
    item.iconPath = iconFor(entry);
    item.tooltip = tooltipFor(entry, doc);
    item.contextValue = getNavigableReference(entry) ? 'reference'
      : (entry.kind === 'element' && entry.name === 'Workflow') ? 'workflow' : entry.kind;
    item.command = { command: 'iiqXmlExplorer.reveal', title: 'Reveal', arguments: [entry] };
    return item;
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * Every attribute of an element as a child node, listed before child tags.
   * Skipped for <entry> (its key/value already show in full next to it) and when disabled in settings.
   */
  private attributeEntries(node: XmlNode): AttributeEntry[] {
    if (node.kind !== 'element' || node.attributes.length === 0) { return []; }
    if (!vscode.workspace.getConfiguration('iiqXmlExplorer').get<boolean>('showAttributeNodes', true)) { return []; }
    if (node.name === 'entry') { return []; }
    return node.attributes.map(attr => ({ kind: 'attribute', attr, parent: node }));
  }

  /** Children shown in the tree: hides text nodes that are already shown inline in the parent description. */
  private visibleChildren(children: XmlNode[], parent?: XmlNode): XmlNode[] {
    const showText = vscode.workspace.getConfiguration('iiqXmlExplorer').get<boolean>('showTextNodes', true);
    if (parent && parent.children.length === 1 && parent.children[0].kind === 'text') { return []; }
    return children.filter(c => c.kind !== 'text' || showText);
  }

  /** Expand the root object and the first level under it; deeper levels start collapsed. */
  private startExpanded(node: XmlNode): boolean {
    let depth = 0;
    for (let p = node.parent; p; p = p.parent) { depth++; }
    if (node.name === 'sailpoint') { return true; }
    if (node.parent?.name === 'sailpoint') { return depth <= 1; }
    return depth === 0;
  }

  /** Deepest visible tree entry containing a document offset (used by "follow cursor"). */
  entryAt(offset: number): XmlNode | undefined {
    if (!this.model) { return undefined; }
    let best: XmlNode | undefined;
    let level = this.visibleChildren(this.model.nodes);
    while (level.length > 0) {
      const hit = level.find(n => offset >= n.start && offset < n.end);
      if (!hit) { break; }
      best = hit;
      level = this.visibleChildren(hit.children, hit);
    }
    return best;
  }
}

export { isXmlNode };
