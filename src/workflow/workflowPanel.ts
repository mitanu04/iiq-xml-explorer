import * as vscode from 'vscode';
import { DocumentCache } from '../documentCache';
import { buildWorkflowModel, findWorkflows, pickWorkflow, WorkflowDiagramModel } from './workflowModel';
import { XmlNode, getAttr } from '../parser/xmlParser';

/**
 * The "Workflow Diagram" webview. One panel at a time; it shows the workflow of the
 * document it was opened for and follows the active editor when that is another workflow.
 */
export class WorkflowPanel {
  static readonly viewType = 'iiqXmlExplorer.workflowDiagram';
  private static current: WorkflowPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private document: vscode.TextDocument;
  private workflowName?: string;
  private model?: WorkflowDiagramModel;
  private updateTimer?: NodeJS.Timeout;

  static show(context: vscode.ExtensionContext, cache: DocumentCache, document: vscode.TextDocument, offset?: number): void {
    const workflow = pickWorkflow(cache.get(document), offset);
    if (!workflow) {
      vscode.window.showInformationMessage('This file does not contain a <Workflow>.');
      return;
    }
    if (WorkflowPanel.current) {
      WorkflowPanel.current.setDocument(document, getAttr(workflow, 'name'));
      WorkflowPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(WorkflowPanel.viewType, 'Workflow Diagram', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    panel.iconPath = new vscode.ThemeIcon('type-hierarchy');
    WorkflowPanel.current = new WorkflowPanel(panel, context, cache, document, getAttr(workflow, 'name'));
  }

  /** Called by the extension when the editor cursor moves, to highlight the step under it. */
  static cursorMoved(document: vscode.TextDocument, offset: number): void {
    const self = WorkflowPanel.current;
    if (!self || self.document !== document || !self.model) { return; }
    const step = self.model.steps.find(s => offset >= s.start && offset < s.end);
    self.panel.webview.postMessage({ type: 'highlight', step: step?.name ?? null });
  }

  /** Called when the active editor changes: follow it if it is another workflow file. */
  static editorChanged(editor: vscode.TextEditor | undefined, cache: DocumentCache): void {
    const self = WorkflowPanel.current;
    if (!self || !editor || editor.document === self.document) { return; }
    if (editor.document.languageId !== 'xml') { return; }
    const wf = pickWorkflow(cache.get(editor.document), editor.document.offsetAt(editor.selection.active));
    if (wf) { self.setDocument(editor.document, getAttr(wf, 'name')); }
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly cache: DocumentCache,
    document: vscode.TextDocument,
    workflowName: string | undefined
  ) {
    this.document = document;
    this.workflowName = workflowName;
    panel.webview.html = this.html();

    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage(msg => this.onMessage(msg)),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document !== this.document) { return; }
        if (this.updateTimer) { clearTimeout(this.updateTimer); }
        this.updateTimer = setTimeout(() => this.update(), 350);
      }),
      vscode.workspace.onDidCloseTextDocument(doc => {
        if (doc === this.document) { this.panel.dispose(); }
      })
    );
  }

  private setDocument(document: vscode.TextDocument, workflowName: string | undefined): void {
    this.document = document;
    this.workflowName = workflowName;
    this.update();
  }

  private findWorkflow(): XmlNode | undefined {
    const all = findWorkflows(this.cache.get(this.document));
    return all.find(w => getAttr(w, 'name') === this.workflowName) ?? all[0];
  }

  private update(): void {
    const wf = this.findWorkflow();
    if (!wf) {
      this.model = undefined;
      this.panel.webview.postMessage({ type: 'empty', message: 'The file no longer contains a <Workflow>.' });
      return;
    }
    this.workflowName = getAttr(wf, 'name');
    this.model = buildWorkflowModel(wf);
    this.panel.title = `Diagram: ${this.model.name}`;
    const editor = vscode.window.visibleTextEditors.find(e => e.document === this.document);
    const offset = editor ? this.document.offsetAt(editor.selection.active) : -1;
    const highlight = this.model.steps.find(s => offset >= s.start && offset < s.end)?.name ?? null;
    this.panel.webview.postMessage({
      type: 'model',
      model: this.model,
      file: vscode.workspace.asRelativePath(this.document.uri, false),
      highlight
    });
  }

  private async onMessage(msg: { type: string; offset?: number }): Promise<void> {
    if (msg.type === 'ready') {
      this.update();
      return;
    }
    if (msg.type === 'reveal' && typeof msg.offset === 'number' && msg.offset >= 0) {
      const existing = vscode.window.visibleTextEditors.find(e => e.document === this.document);
      const editor = await vscode.window.showTextDocument(this.document, {
        viewColumn: existing?.viewColumn ?? vscode.ViewColumn.One,
        preserveFocus: false
      });
      const pos = this.document.positionAt(msg.offset);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${media('workflow.css')}" rel="stylesheet">
<title>Workflow Diagram</title>
</head>
<body>
<header class="bar">
  <div class="title"><strong id="wfName">Workflow</strong><span id="wfMeta" class="meta"></span></div>
  <div class="tools">
    <label class="layout">Conditions
      <select id="conditions">
        <option value="full">Full</option>
        <option value="short">Short</option>
      </select>
    </label>
    <label class="layout">Layout
      <select id="layout">
        <option value="iiq">IIQ positions</option>
        <option value="auto">Automatic</option>
      </select>
    </label>
    <button id="zoomOut" title="Zoom out">−</button>
    <button id="zoomIn" title="Zoom in">+</button>
    <button id="fit" title="Fit to window">Fit</button>
  </div>
</header>
<div id="stage" class="stage" tabindex="0" aria-label="Workflow diagram. Drag to pan, scroll to zoom.">
  <svg id="svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" class="arrowhead"></path>
      </marker>
      <marker id="arrowHot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" class="arrowhead hot"></path>
      </marker>
    </defs>
    <g id="viewport"></g>
  </svg>
  <div id="empty" class="empty" hidden></div>
</div>
<footer class="legend" id="legend"></footer>
<script nonce="${nonce}" src="${media('workflow.js')}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    WorkflowPanel.current = undefined;
    if (this.updateTimer) { clearTimeout(this.updateTimer); }
    this.disposables.forEach(d => d.dispose());
  }
}
