import * as vscode from 'vscode';
import { DocumentCache } from '../documentCache';
import { buildApplicationModel, ApplicationModel, findApplications, pickApplication } from './applicationModel';
import { getAttr } from '../parser/xmlParser';
import { definitionKey, scanWorkspace } from './scan';
import { buildDependencies, buildFileList, formatFileList, FileEntry } from './dependencies';

export type ApplicationTab = 'overview' | 'schema';

/**
 * The "Application" webview with two tabs: Overview (references and mentions across the
 * workspace) and Schema (the schemas as tables). One panel at a time.
 */
export class ApplicationPanel {
  static readonly viewType = 'iiqXmlExplorer.application';
  private static current: ApplicationPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private document: vscode.TextDocument;
  private appName?: string;
  private model?: ApplicationModel;
  private updateTimer?: NodeJS.Timeout;
  private scanToken?: vscode.CancellationTokenSource;
  /** URIs the webview may ask to open: only files the scan or the model produced. */
  private readonly openable = new Set<string>();
  private files: FileEntry[] = [];

  static show(context: vscode.ExtensionContext, cache: DocumentCache, document: vscode.TextDocument, tab: ApplicationTab, offset?: number): void {
    const app = pickApplication(cache.get(document), offset);
    if (!app) {
      vscode.window.showInformationMessage('This file does not contain an <Application>.');
      return;
    }
    const name = getAttr(app, 'name');
    if (ApplicationPanel.current) {
      ApplicationPanel.current.setDocument(document, name, tab);
      ApplicationPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(ApplicationPanel.viewType, 'Application', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    panel.iconPath = new vscode.ThemeIcon('server-environment');
    ApplicationPanel.current = new ApplicationPanel(panel, context, cache, document, name, tab);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly cache: DocumentCache,
    document: vscode.TextDocument,
    appName: string | undefined,
    private tab: ApplicationTab
  ) {
    this.document = document;
    this.appName = appName;
    panel.webview.html = this.html();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage(msg => this.onMessage(msg)),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document !== this.document) { return; }
        if (this.updateTimer) { clearTimeout(this.updateTimer); }
        this.updateTimer = setTimeout(() => this.update(false), 400);
      }),
      vscode.workspace.onDidCloseTextDocument(doc => { if (doc === this.document) { this.panel.dispose(); } })
    );
  }

  private setDocument(document: vscode.TextDocument, appName: string | undefined, tab: ApplicationTab): void {
    this.document = document;
    this.appName = appName;
    this.tab = tab;
    this.panel.webview.postMessage({ type: 'tab', tab });
    this.update(true);
  }

  private findApp() {
    const all = findApplications(this.cache.get(this.document));
    return all.find(a => getAttr(a, 'name') === this.appName) ?? all[0];
  }

  /** Re-reads the application from the editor; `rescan` also searches the workspace again. */
  private update(rescan: boolean): void {
    const app = this.findApp();
    if (!app) {
      this.model = undefined;
      this.panel.webview.postMessage({ type: 'empty', message: 'The file no longer contains an <Application>.' });
      return;
    }
    const previousName = this.model?.name;
    this.appName = getAttr(app, 'name');
    this.model = buildApplicationModel(app);
    this.panel.title = `Application: ${this.model.name}`;
    this.panel.webview.postMessage({
      type: 'model',
      model: this.model,
      file: vscode.workspace.asRelativePath(this.document.uri, false),
      tab: this.tab
    });
    // Typing never starts a workspace search (the spec asks for that); after a rename the old results
    // no longer fit, so they are dropped and the view asks for Refresh.
    if (rescan) { void this.scan(); }
    else if (previousName !== undefined && previousName !== this.model.name) {
      this.scanToken?.cancel();
      this.panel.webview.postMessage({ type: 'stale' });
    }
  }

  private async scan(): Promise<void> {
    const model = this.model;
    if (!model) { return; }
    this.scanToken?.cancel();
    const source = new vscode.CancellationTokenSource();
    this.scanToken = source;
    this.panel.webview.postMessage({ type: 'scanning' });
    const result = await scanWorkspace(model.name, { uri: this.document.uri, start: model.start, end: model.end }, source.token);
    if (source.token.isCancellationRequested) { return; }
    this.openable.clear();
    this.openable.add(this.document.uri.toString());
    for (const hits of Object.values(result.definitions)) { hits.forEach(h => this.openable.add(h.uri)); }
    result.mentions.forEach(m => this.openable.add(m.uri));

    // What the application needs indirectly, and the list of files that make it up.
    const lookup = (type: string, name: string) => result.definitions[definitionKey(type, name)] ?? [];
    const dependencies = buildDependencies(model.references, lookup, model.name);
    const selfPath = vscode.workspace.asRelativePath(this.document.uri, false);
    this.files = buildFileList({ uri: this.document.uri.toString(), path: selfPath }, model.references, dependencies, lookup, result.mentions);
    this.files.forEach(f => this.openable.add(f.uri));

    // The references inside definitions were only needed here; the view does not need them.
    const definitions = Object.fromEntries(Object.entries(result.definitions)
      .map(([k, hits]) => [k, hits.map(({ refs: _refs, ...rest }) => rest)]));
    this.panel.webview.postMessage({ type: 'scan', result: { ...result, definitions, dependencies, files: this.files } });
  }

  private async onMessage(msg: { type: string; offset?: number; uri?: string; line?: number; column?: number; tab?: ApplicationTab; format?: string }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.update(true);
        break;
      case 'rescan':
        void this.scan();
        break;
      case 'copyFiles':
        if ((msg.format === 'paths' || msg.format === 'markdown') && this.model && this.files.length) {
          await vscode.env.clipboard.writeText(formatFileList(this.files, msg.format, this.model.name));
          vscode.window.setStatusBarMessage(`Copied ${this.files.length} file${this.files.length === 1 ? '' : 's'}`, 2500);
        }
        break;
      case 'tab':
        if (msg.tab === 'overview' || msg.tab === 'schema') { this.tab = msg.tab; }
        break;
      case 'reveal':
        if (typeof msg.offset === 'number' && msg.offset >= 0) {
          await this.open(this.document.uri, this.document.positionAt(msg.offset));
        }
        break;
      case 'open':
        if (typeof msg.uri === 'string' && this.openable.has(msg.uri)) {
          await this.open(vscode.Uri.parse(msg.uri), new vscode.Position(msg.line ?? 0, msg.column ?? 0));
        }
        break;
    }
  }

  private async open(uri: vscode.Uri, pos: vscode.Position): Promise<void> {
    const existing = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: existing?.viewColumn ?? vscode.ViewColumn.One, preserveFocus: false });
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
<link href="${media('application.css')}" rel="stylesheet">
<title>Application</title>
</head>
<body>
<header class="bar">
  <div class="title"><strong id="appName">Application</strong><span id="appMeta" class="meta"></span></div>
  <div class="tools"><button id="rescan" title="Search the workspace again">Refresh</button></div>
</header>
<nav class="tabs" role="tablist">
  <button role="tab" id="tab-overview" data-tab="overview">Overview</button>
  <button role="tab" id="tab-schema" data-tab="schema">Schema</button>
</nav>
<main id="content"></main>
<script nonce="${nonce}" src="${media('application.js')}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    ApplicationPanel.current = undefined;
    this.scanToken?.cancel();
    if (this.updateTimer) { clearTimeout(this.updateTimer); }
    this.disposables.forEach(d => d.dispose());
  }
}
