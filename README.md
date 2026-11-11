# IIQ XML Explorer

*Built by **Mergea Sergiu-Octavian**.*

A VS Code extension that shows the structure of **SailPoint IdentityIQ** XML objects at a glance.
Open a Rule, Workflow, Application, TaskDefinition or a `<sailpoint>` import file and see every tag,
all its attributes and entry values, the BeanShell sources and the references to other objects in a tree.
Workflows can also be opened as a live flowchart of their steps and transitions.

The extension is read-only and works offline. It runs side by side with the
*SailPoint IIQ Development Accelerator*, which handles deploy, compare and BeanShell evaluation.

## Requirements

- VS Code 1.85 or newer.
- XML files opened with the `xml` language mode (the default for `.xml`).

## Install

1. Get the package: download it from the repository's **Releases** page, or
   [build it yourself](#build-locally).
2. Install the package:
   ```bash
   code --install-extension iiq-xml-explorer-0.4.2.vsix
   ```
   or in VS Code: *Extensions* → `…` → *Install from VSIX…*.
3. Open an XML file. The extension starts on the first XML file you open.

Later versions install over this one and keep your layout and settings.

## IIQ Structure view

By default the **IIQ Structure** view is in the **Explorer**, the last section under your files, Outline and Timeline.
It shows the tag tree of the XML file in the active editor.

- **Every attribute** of a tag is listed as a child node (`name  GLOBEX`, `connector  sailpoint.connector…`),
  and key attributes are also previewed next to the tag (`name`, `key`, `type`, `action`, `value`, `to`, `when`, `class`, `connector`).
- **`<entry>`** shows its value whatever form it has: `value="x"`, `<value><Boolean>true</Boolean></value>`,
  string lists `[a, b, c]`, `Map{n}`, references (`Rule → X`) or `(empty)`.
- Elements that only wrap text, like `<Description>` or `<String>`, show the text inline.
- `<Source>` / `<Script>` CDATA appears as a **BeanShell** node with its line count; hover it for a code preview.
- **Icons** follow the IIQ meaning of each tag: objects, steps, transitions, variables, map entries, schemas,
  filters, references to other objects (link) and anything that points to an identity or workgroup (person).
- **Tooltips** list all attributes, a short explanation of common IIQ tags and the line range.
- **Click** a node to jump to it in the editor. With *follow cursor* on, the node under your cursor is selected in the tree.
- **Parse problems** (unclosed or mismatched tags) are listed at the top of the tree; click one to jump to it.
  Stray text inside a tag also shows up as a node, which makes typos easy to find.

### Toolbar

| Button | What it does |
|---|---|
| Show Workflow Diagram | Opens the flowchart (only when the file contains a `<Workflow>`) |
| Show Tag Index | Lists every distinct tag with its count, then every occurrence of the tag you pick |
| Toggle Follow Cursor | Turns cursor following on or off (saved in your user settings) |
| Toggle Attribute Preview | Turns the attribute preview next to tags on or off (saved in your user settings) |
| Refresh | Re-reads the active file |
| `…` → Move IIQ Structure to the Right Side Bar… | See [Layout](#layout) |

### Right-click menu on a node

| Item | What it does |
|---|---|
| Show Workflow Diagram | On a `Workflow` node: opens that workflow's flowchart |
| Go to Referenced Object | On anything that points to another object: a `Reference` node, the tag around it (`BuildMapRule`, `Owner`, `AccountCorrelationConfig`, …), a rule entry such as `afterProvisioningRule`, a step with `action="rule:…"`, or one of their attribute rows. Opens the referenced object's XML file (see [References](#references)) |
| Select Whole Element | Selects the whole element (or attribute) in the editor |
| Copy Value | Copies the attribute value, `value` attribute or text content |
| Copy Path | Copies a path such as `Workflow[name=X]/Step[name=Y]/Arg[name=Z]` or `…/Application[name=GLOBEX]/@connector` |

## Workflow Diagram

Opens a Workflow as a flowchart beside the XML. Open it with the diagram button in the editor title bar,
in the IIQ Structure toolbar or next to the `Workflow` node, or with **IIQ XML: Show Workflow Diagram** from the
Command Palette. In a `<sailpoint>` file with several workflows, the one under the cursor is shown.

- **Steps** are boxes coloured by kind, with the rule, method or subprocess name underneath:
  | Kind | Detected from |
  |---|---|
  | Start / Stop (rounded) | `icon="Start"` / `icon="Stop"`, or a step named Start, Stop or End with no action |
  | Approval | an `<Approval>` child |
  | Subprocess | a `<WorkflowRef>` child |
  | Rule / Call / Script | `action="rule:…"`, `action="call:…"`, `action="script:…"`, or a `<Script>` child |
- **Transitions** are arrows. Conditional ones are dashed and labelled with their **full** `when`, wrapped over
  several lines. When a step has several transitions they are numbered in the order IIQ checks them, and the
  fallback is labelled `else`. Use **Conditions → Short** in the toolbar for one-line previews; hovering always shows the full text.
- **Layout**: by default the diagram uses the `posX` / `posY` positions saved by the IIQ Business Process Editor,
  so it looks like the IIQ UI. When steps have no positions (or two share the same spot) it uses an automatic
  left-to-right layout; you can switch in the toolbar.
- **Click** a step, arrow or label to jump to that `<Step>` or `<Transition>` in the XML.
  Moving the cursor in the XML highlights the step it is in.
- **Live**: the diagram redraws as you edit and follows you when you switch to another workflow file.
- **Warnings** (bottom right): transitions to steps that don't exist (also drawn as red dashed boxes),
  steps no transition leads to, and duplicate step names.
- **Navigation**: scroll to zoom, drag to pan, **Fit** to see everything. Large workflows open at a readable zoom
  starting from the Start step. With the diagram focused: `+` / `-` zoom, `0` or `F` fit, arrow keys pan, `Enter` opens the focused step.

## References

These are recognised as references to other IdentityIQ objects:

- `<Reference class="sailpoint.object.Rule" name="X"/>` (any class), and a tag that wraps a single one,
  such as `<RuleRef>`, `<BuildMapRule>`, `<Owner>` or `<AccountCorrelationConfig>`
- `action="rule:X"`, `value="rule:X"` and `ruleName="X"`
- map entries whose key ends in `Rule` and that have a value, e.g. `<entry key="afterProvisioningRule" value="X"/>`

Use the link button in the tree, **Go to Referenced Object**, or **Ctrl+Click / F12** in the editor to open the
referenced object. It is looked up in the XML files of your workspace by type and `name`
(for example `<Rule … name="X">`), so the object's XML must be in the open folder.

## Outline, breadcrumbs and hovers

For IdentityIQ files the extension also provides:
- **Outline and breadcrumbs**, e.g. `Workflow Example - Joiner › Step Build Plan › Arg identityName`.
- **Hovers** on tag names with a short IIQ description (about 60 common tags).

## Which files count as IdentityIQ XML

The IIQ Structure tree and Tag Index work for **any** XML file. Outline, hovers and Ctrl+Click on references
are enabled only for files that look like IdentityIQ XML:
- the file has a `sailpoint.dtd` DOCTYPE (every file exported from IIQ has one), or
- its root tag is `<sailpoint>` or a known IIQ object (Rule, Workflow, Application, TaskDefinition, Bundle, Form, Custom, …).

## Layout

IIQ Structure starts in the **Explorer**, under your files. To give it more room:
- **Bigger in the Explorer**: drag the divider above it, or collapse Outline and Timeline.
- **Full height on the right**: run **IIQ XML: Move IIQ Structure to the Right Side Bar…** and pick
  **New Secondary Side Bar Entry**. It becomes its own tab next to tools like Copilot Chat, and **Ctrl+Alt+B** hides or shows that side bar.
- **Back to the start**: right-click its header or tab → **Reset Location**.

VS Code remembers the position across restarts.

## Commands

Available from the Command Palette (**Ctrl+Shift+P**), all starting with `IIQ XML:`.

| Command | What it does |
|---|---|
| IIQ XML: Show IIQ Structure | Brings the IIQ Structure view into sight and focuses it |
| IIQ XML: Show Workflow Diagram | Opens the flowchart of the workflow in the active file |
| IIQ XML: Show Tag Index | Lists every distinct tag, then every occurrence of the one you pick |
| IIQ XML: Move IIQ Structure to the Right Side Bar… | Moves the view to another area (see [Layout](#layout)) |
| IIQ XML: Toggle Follow Cursor | Turns cursor following in the tree on or off |
| IIQ XML: Toggle Attribute Preview | Turns the attribute preview next to tags on or off |
| IIQ XML: Refresh | Re-reads the active file |

## Settings

| Setting | Default | Description |
|---|---|---|
| `iiqXmlExplorer.followCursor` | `true` | Select the tree node under the editor cursor |
| `iiqXmlExplorer.showAttributes` | `true` | Preview key attributes next to each tag |
| `iiqXmlExplorer.previewAttributes` | `name, key, type, action, value, to, when, class, connector` | Which attributes are previewed, in this order |
| `iiqXmlExplorer.showAttributeNodes` | `true` | List every attribute as a child node (`<entry>` excluded, its key and value are shown inline) |
| `iiqXmlExplorer.showTextNodes` | `true` | Show text content as child nodes |
| `iiqXmlExplorer.onlyIiqFiles` | `false` | Show the tree only for IdentityIQ XML files |
| `iiqXmlExplorer.provideOutline` | `true` | Outline and breadcrumbs for IdentityIQ files |
| `iiqXmlExplorer.provideHovers` | `true` | Tag descriptions on hover in IdentityIQ files |

## Known limitations

- Read-only: the tree and the diagram never change the XML.
- Hover descriptions cover common tags only; other tags still appear in the tree.
- Identity/workgroup icons are based on tag names (`Owner`, `Remediators`, `Approvers`, …) and on
  `Reference` elements with class `Identity`; values like `owner="ref:manager"` are shown as plain attributes.
- References are resolved only against XML files in the open workspace, not against a live IIQ server.
- The workflow diagram does not follow subprocesses into other files.

## Build locally

### Prerequisites

| Tool | Version | Check with |
|---|---|---|
| [Node.js](https://nodejs.org) (includes npm) | 20 LTS or newer | `node -v` |
| Git | any recent | `git --version` |
| VS Code | 1.85 or newer, to install and debug | `code --version` |

Nothing has to be installed globally: the TypeScript compiler and the packaging tool (`@vscode/vsce`)
are development dependencies of the project and are downloaded by `npm install`.

### Build the .vsix

```bash
git clone https://github.com/<your-user>/iiq-xml-explorer.git
cd iiq-xml-explorer
npm install          # first time, and after package.json changes: downloads node_modules/
npm test             # optional: compiles and runs the unit tests
npm run package      # compiles into out/ and creates iiq-xml-explorer-<version>.vsix
```

The `.vsix` is created in the project folder. Install it with

```bash
code --install-extension iiq-xml-explorer-<version>.vsix
```

then run **Developer: Reload Window** in VS Code.

`node_modules/`, `out/` and `*.vsix` are generated and are ignored by Git; delete them any time and rebuild.

### npm scripts

| Command | What it does |
|---|---|
| `npm install` | Downloads the dependencies into `node_modules/` |
| `npm run compile` | Compiles `src/` (TypeScript) into `out/` (JavaScript) |
| `npm run watch` | Same, and recompiles on every save |
| `npm test` | Compiles, then runs the unit tests (XML parser, IIQ reference detection, workflow model, tree labels and icons) |
| `npm run package` | Compiles and creates `iiq-xml-explorer-<version>.vsix` |

### Run and debug without installing

1. Open the project folder in VS Code and run `npm install` once.
2. Press **F5** (*Run Extension*). It compiles the code and opens an **Extension Development Host** window
   with the extension loaded and the `samples/` folder open.
3. After changing code, run `npm run watch` (or press F5 again) and reload the host window with
   **Ctrl+R** (*Developer: Reload Window*). Breakpoints in `src/*.ts` work in the main window.

### Releasing a new version

1. Raise the version: `npm version patch --no-git-tag-version` (or `minor` / `major`).
   This updates `package.json` and `package-lock.json` together.
2. Add the changes to `CHANGELOG.md` and update the version in the install command above.
3. Build with `npm run package`, or let GitHub build it (next section).

### Troubleshooting

- **`code` is not recognized**: in VS Code run **Shell Command: Install 'code' command in PATH** (macOS),
  or re-run the Windows installer with *Add to PATH*. You can always use *Extensions* → `…` → *Install from VSIX…* instead.
- **PowerShell: "running scripts is disabled on this system"** when calling `npm`: use *Command Prompt*,
  or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **Compile errors after pulling changes**: run `npm install` again; a dependency may have changed.
- **The extension doesn't change after installing a new build**: check the `version` in `package.json` was raised,
  then reload the window.

## Build on GitHub

The workflow in `.github/workflows/build.yml` builds the extension on GitHub, so you don't need Node.js locally.

| When | What happens |
|---|---|
| Every push to any branch, and every pull request | Installs dependencies (`npm ci`), compiles, runs the tests and packages the extension |
| **Actions** tab → *Build extension* → **Run workflow** | The same build, on demand, for the branch you pick |
| Pushing a tag such as `v0.4.2` | The same build, then a **GitHub Release** named *IIQ XML Explorer 0.4.2* with the `.vsix` attached |

**Download a build**: *Actions* → open the run → **Artifacts** at the bottom → `iiq-xml-explorer-<version>.vsix`.
GitHub delivers artifacts zipped, so unzip it to get the `.vsix`. Artifacts are kept for 30 days;
releases are kept until you delete them.

**Publish a release**:

```bash
npm version patch --no-git-tag-version   # e.g. 0.4.2 → 0.4.3
git commit -am "Release 0.4.3"
git tag v0.4.3
git push origin main v0.4.3
```

The tag must match the `version` in `package.json`; otherwise the build stops with an error saying which version to use.
If the release step fails with a permissions error, open the repository's *Settings → Actions → General* and set
*Workflow permissions* to **Read and write permissions**.

## Author

IIQ XML Explorer was designed and built by **Mergea Sergiu-Octavian**. Released under the MIT License.
