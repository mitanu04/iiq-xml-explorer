import * as vscode from 'vscode';
import { DocumentCache, isXmlDocument } from './documentCache';
import { StructureTreeProvider, TreeEntry, isXmlNode } from './structureTree';
import { IiqDefinitionProvider, IiqDocumentSymbolProvider, IiqHoverProvider, findObjectDefinitions } from './providers';
import { XmlNode, nodePath, walk, getAttr } from './parser/xmlParser';
import { getNavigableReference } from './iiq/knowledge';
import { WorkflowPanel } from './workflow/workflowPanel';
import { findWorkflows } from './workflow/workflowModel';

const XML_SELECTOR: vscode.DocumentSelector = [
  { language: 'xml', scheme: 'file' },
  { language: 'xml', scheme: 'untitled' }
];

export function activate(context: vscode.ExtensionContext): void {
  const cache = new DocumentCache();
  const tree = new StructureTreeProvider(cache);
  const view = vscode.window.createTreeView<TreeEntry>('iiqXmlExplorer.structure', {
    treeDataProvider: tree,
    showCollapseAll: true
  });
  context.subscriptions.push(view);

  const updateTitle = () => {
    const doc = tree.currentDocument;
    view.description = doc ? vscode.workspace.asRelativePath(doc.uri, false) : undefined;
    const root = tree.currentModel?.root;
    const name = root ? getAttr(root, 'name') : undefined;
    view.message = root && root.name !== 'sailpoint'
      ? `${root.name}${name ? ` · ${name}` : ''}${getAttr(root, 'type') ? ` · ${getAttr(root, 'type')}` : ''}`
      : undefined;
    // Shows the diagram button in the tree toolbar and editor title only for workflow files.
    const hasWorkflow = !!tree.currentModel && findWorkflows(tree.currentModel).length > 0;
    vscode.commands.executeCommand('setContext', 'iiqXmlExplorer.isWorkflow', hasWorkflow);
  };

  const showFor = (editor: vscode.TextEditor | undefined) => {
    tree.setDocument(editor?.document);
    updateTitle();
  };
  showFor(vscode.window.activeTextEditor);

  // One-time offer to put the tree in the Secondary Side Bar: full height on the right,
  // files stay in the Explorer, and Ctrl+Alt+B hides / shows it.
  if (!context.globalState.get<boolean>('askedSideBar')) {
    context.globalState.update('askedSideBar', true);
    vscode.window.showInformationMessage(
      'IIQ XML Explorer: show IIQ Structure in the right side bar at full height, next to tools like Copilot Chat? Choose "Move", then pick "New Secondary Side Bar Entry".',
      'Move', 'Keep in Explorer'
    ).then(choice => {
      if (choice === 'Move') { vscode.commands.executeCommand('iiqXmlExplorer.moveToSideBar'); }
    });
  }

  // ---- keep tree in sync with the editor --------------------------------------

  let refreshTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      showFor(editor);
      WorkflowPanel.editorChanged(editor, cache);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document !== tree.currentDocument) { return; }
      if (refreshTimer) { clearTimeout(refreshTimer); }
      refreshTimer = setTimeout(() => { tree.refresh(); updateTitle(); }, 400);
    }),
    vscode.workspace.onDidCloseTextDocument(doc => cache.forget(doc)),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('iiqXmlExplorer')) { tree.refresh(); updateTitle(); }
    })
  );

  // Follow cursor: select the tree node under the caret.
  let followTimer: NodeJS.Timeout | undefined;
  let revealingFromTree = false;
  let diagramTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
    // Highlight the step under the cursor in the workflow diagram.
    if (diagramTimer) { clearTimeout(diagramTimer); }
    diagramTimer = setTimeout(() => WorkflowPanel.cursorMoved(e.textEditor.document, e.textEditor.document.offsetAt(e.selections[0].active)), 120);

    if (!view.visible || revealingFromTree) { return; }
    if (e.textEditor.document !== tree.currentDocument) { return; }
    if (!vscode.workspace.getConfiguration('iiqXmlExplorer').get<boolean>('followCursor', true)) { return; }
    if (followTimer) { clearTimeout(followTimer); }
    followTimer = setTimeout(() => {
      const node = tree.entryAt(e.textEditor.document.offsetAt(e.selections[0].active));
      if (node) { view.reveal(node, { select: true, focus: false, expand: false }).then(undefined, () => undefined); }
    }, 150);
  }));

  // ---- language features -------------------------------------------------------

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(XML_SELECTOR, new IiqDocumentSymbolProvider(cache), { label: 'IIQ XML' }),
    vscode.languages.registerHoverProvider(XML_SELECTOR, new IiqHoverProvider(cache)),
    vscode.languages.registerDefinitionProvider(XML_SELECTOR, new IiqDefinitionProvider(cache))
  );

  // ---- commands ------------------------------------------------------------------

  const revealRange = async (start: number, end: number, selectWhole = false) => {
    const doc = tree.currentDocument;
    if (!doc) { return; }
    revealingFromTree = true;
    try {
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
      const startPos = doc.positionAt(start);
      const endPos = doc.positionAt(end);
      editor.selection = selectWhole ? new vscode.Selection(startPos, endPos) : new vscode.Selection(startPos, startPos);
      editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } finally {
      setTimeout(() => { revealingFromTree = false; }, 300);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('iiqXmlExplorer.showWorkflowDiagram', async (arg?: TreeEntry | vscode.Uri) => {
      // From the tree: the Workflow node that was clicked. From the editor title: the file's URI.
      let document: vscode.TextDocument | undefined;
      let offset: number | undefined;
      if (arg instanceof vscode.Uri) {
        document = await vscode.workspace.openTextDocument(arg);
      } else if (arg && isXmlNode(arg) && tree.currentDocument) {
        document = tree.currentDocument;
        offset = arg.start;
      } else {
        const editor = vscode.window.activeTextEditor;
        document = editor && isXmlDocument(editor.document) ? editor.document : tree.currentDocument;
        if (editor && document === editor.document) { offset = document.offsetAt(editor.selection.active); }
      }
      if (!document) {
        vscode.window.showInformationMessage('Open a Workflow XML file first.');
        return;
      }
      WorkflowPanel.show(context, cache, document, offset);
    }),

    // Focus the view, then let VS Code ask where to move it (e.g. the Secondary Side Bar on the right).
    vscode.commands.registerCommand('iiqXmlExplorer.moveToSideBar', async () => {
      await vscode.commands.executeCommand('iiqXmlExplorer.structure.focus');
      await vscode.commands.executeCommand('workbench.action.moveFocusedView');
    }),

    // Bring IIQ Structure into view wherever it lives (Explorer, right side bar tab, panel) and focus it.
    // Hiding is left to VS Code (e.g. Ctrl+Alt+B for the right side bar) so other tools there are never hidden by surprise.
    vscode.commands.registerCommand('iiqXmlExplorer.showStructure', async () => {
      await vscode.commands.executeCommand('iiqXmlExplorer.structure.focus');
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.refresh', () => {
      showFor(vscode.window.activeTextEditor);
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.reveal', (target: XmlNode | { start: number; end: number }) => {
      if (!target) { return; }
      const start = 'nameStart' in target && (target as XmlNode).kind === 'element' ? (target as XmlNode).nameStart : target.start;
      return revealRange(start, start);
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.selectNode', (entry?: TreeEntry) => {
      const node = entry ?? view.selection[0];
      if (node && node.kind === 'attribute') { return revealRange(node.attr.start, node.attr.end, true); }
      if (node && isXmlNode(node)) { return revealRange(node.start, node.end, true); }
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.copyValue', async (entry?: TreeEntry) => {
      const node = entry ?? view.selection[0];
      let value: string | undefined;
      if (node?.kind === 'attribute') { value = node.attr.value; }
      else if (node && isXmlNode(node)) {
        value = node.kind === 'element'
          ? (getAttr(node, 'value') ?? node.children.filter(c => c.kind === 'text' || c.kind === 'cdata').map(c => c.text).join('').trim())
          : node.text;
      }
      if (value === undefined) { return; }
      await vscode.env.clipboard.writeText(value);
      vscode.window.setStatusBarMessage('Copied value', 2000);
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.copyPath', async (entry?: TreeEntry) => {
      const node = entry ?? view.selection[0];
      if (!node) { return; }
      let path: string;
      if (node.kind === 'attribute') { path = `${nodePath(node.parent)}/@${node.attr.name}`; }
      else if (isXmlNode(node)) { path = nodePath(node); }
      else { return; }
      await vscode.env.clipboard.writeText(path);
      vscode.window.setStatusBarMessage(`Copied: ${path}`, 3000);
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.goToReference', async (entry?: TreeEntry) => {
      const picked = entry ?? view.selection[0];
      // On an attribute row, use the element it belongs to.
      const node = picked?.kind === 'attribute' ? picked.parent : picked;
      if (!node || !isXmlNode(node)) { return; }
      const ref = getNavigableReference(node);
      if (!ref) {
        vscode.window.showInformationMessage('This node does not reference another IdentityIQ object.');
        return;
      }
      const locations = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Searching for ${ref.type} "${ref.name}"…` },
        () => findObjectDefinitions(ref.type, ref.name, cache)
      );
      if (locations.length === 0) {
        vscode.window.showInformationMessage(`${ref.type} "${ref.name}" was not found in the XML files of this workspace.`);
        return;
      }
      if (locations.length === 1) {
        const doc = await vscode.workspace.openTextDocument(locations[0].uri);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selection = new vscode.Selection(locations[0].range.start, locations[0].range.start);
        editor.revealRange(locations[0].range, vscode.TextEditorRevealType.InCenter);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        locations.map(l => ({ label: vscode.workspace.asRelativePath(l.uri), description: `line ${l.range.start.line + 1}`, location: l })),
        { placeHolder: `${ref.type} "${ref.name}" is defined in several files` }
      );
      if (pick) {
        const doc = await vscode.workspace.openTextDocument(pick.location.uri);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selection = new vscode.Selection(pick.location.range.start, pick.location.range.start);
        editor.revealRange(pick.location.range, vscode.TextEditorRevealType.InCenter);
      }
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.showTagIndex', async () => {
      if (!tree.currentModel || !tree.currentDocument) {
        const editor = vscode.window.activeTextEditor;
        if (!isXmlDocument(editor?.document)) {
          vscode.window.showInformationMessage('Open an XML file first.');
          return;
        }
        showFor(editor);
      }
      const model = tree.currentModel!;
      const doc = tree.currentDocument!;

      const byTag = new Map<string, XmlNode[]>();
      walk(model.nodes, n => {
        if (n.kind === 'element') {
          const list = byTag.get(n.name) ?? [];
          list.push(n);
          byTag.set(n.name, list);
        }
      });

      const tags = [...byTag.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      const tagPick = await vscode.window.showQuickPick(
        tags.map(([tag, nodes]) => ({
          label: `$(symbol-tag) ${tag}`,
          description: `${nodes.length}×`,
          detail: [...new Set(nodes.flatMap(n => n.attributes.map(a => a.name)))].slice(0, 10).join(', ') || undefined,
          tag
        })),
        { placeHolder: `${tags.length} distinct tags in ${vscode.workspace.asRelativePath(doc.uri)} — pick one to list its occurrences`, matchOnDetail: true }
      );
      if (!tagPick) { return; }

      const occurrences = byTag.get(tagPick.tag)!;
      const target = occurrences.length === 1 ? occurrences[0] : (await vscode.window.showQuickPick(
        occurrences.map(n => ({
          label: `line ${doc.positionAt(n.start).line + 1}`,
          description: n.attributes.map(a => `${a.name}="${a.value}"`).join(' ').slice(0, 120),
          detail: nodePath(n),
          node: n
        })),
        { placeHolder: `<${tagPick.tag}> — ${occurrences.length} occurrences`, matchOnDescription: true, matchOnDetail: true }
      ))?.node;
      if (target) {
        await revealRange(target.nameStart, target.nameStart);
        if (view.visible) { view.reveal(target, { select: true, focus: false }).then(undefined, () => undefined); }
      }
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.toggleFollowCursor', async () => {
      const config = vscode.workspace.getConfiguration('iiqXmlExplorer');
      const next = !config.get<boolean>('followCursor', true);
      await config.update('followCursor', next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`IIQ XML Explorer: follow cursor ${next ? 'on' : 'off'}`, 2500);
    }),

    vscode.commands.registerCommand('iiqXmlExplorer.toggleAttributes', async () => {
      const config = vscode.workspace.getConfiguration('iiqXmlExplorer');
      const next = !config.get<boolean>('showAttributes', true);
      await config.update('showAttributes', next, vscode.ConfigurationTarget.Global);
    })
  );
}

export function deactivate(): void {
  // nothing to clean up: everything is registered in context.subscriptions
}
