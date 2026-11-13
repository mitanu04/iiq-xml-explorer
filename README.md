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
   code --install-extension iiq-xml-explorer-0.4.3.vsix
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
| Show Application Overview | Opens the Application view (only when the file contains an `<Application>`) |
| Show Tag Index | Lists every distinct tag with its count, then every occurrence of the tag you pick |
| Toggle Follow Cursor | Turns cursor following on or off (saved in your user settings) |
| Toggle Attribute Preview | Turns the attribute preview next to tags on or off (saved in your user settings) |
| Refresh | Re-reads the active file |
| `…` → Move IIQ Structure to the Right Side Bar… | See [Layout](#layout) |

### Right-click menu on a node

| Item | What it does |
|---|---|
| Show Workflow Diagram | On a `Workflow` node: opens that workflow's flowchart |
| Show Application Overview / Show Application Schema Table | On an `Application` node (and the schema table also on a `Schema` node): opens the [Application view](#application-view) |
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

## Application view

For an `<Application>` the extension opens a second panel with two tabs, in the same colours as your VS Code theme.
Open it with the button in the IIQ Structure toolbar or in the editor title, by right-clicking the `Application`
node, or with **IIQ XML: Show Application Overview** / **IIQ XML: Show Application Schema Table**.
If the file holds several applications, the one under the cursor is shown.

**Schema** – the schemas of the application as tables, like the Schemas tab in IdentityIQ:
- One button per schema (`account`, `group`, …) with its object type, native object type and the identity, display,
  instance and group attributes.
- One row per `AttributeDefinition` with Name, Type, Identity, Display, Entitlement, Managed, Multi-valued, Minable,
  Correlation key, Required and Description (from the `description` attribute or the `<Description>` child).
- Filter box, sorting by clicking a column header, and a click on an attribute name jumps to it in the XML.

**Overview** – everything the application is connected to:
- **Rules used**: connector rules, `afterProvisioningRule`-style entries, `rule:` actions and rule references, with the
  rule type and the file the rule is defined in. Rules that are not in the workspace are marked.
- **Identities and workgroups**: owner, revokers and any other identity reference.
- **Other referenced objects**: correlation configs, forms, workflows and so on.
- **Used as** shows where each reference sits (`BuildMapRule`, `Owner`, an entry key…); click it to jump there in the XML.
- **Indirect dependencies**: objects the application needs through the ones above, for example the rule libraries of a
  rule (`ReferencedRules`) or the rules of a correlation config, followed level by level (up to 8) for every object that
  is defined in the workspace. Identities and workgroups are not followed.
- **Mentioned in**: every line in the workspace that contains the application's name, in `.xml`, `.md`, `.markdown`
  and `.txt` files, grouped by file with the object (XML) or heading (documentation) it sits in. Lines where the name
  stands alone between quotes or tags come first. Filter by *XML* or *Documentation*, click a line to open it.

**Files of this application** (end of the Overview tab) lists every file that belongs to the application: its own file,
the files that define what it references (directly or indirectly) and the files that mention it, each with the reason.
**Copy paths** puts one workspace-relative path per line on the clipboard (for `git`, scripts or a review), and
**Copy as checklist** copies a Markdown checklist with the reasons. Use it to see what to take along when you track an
application in a branch.

The whole workspace is searched when the panel opens and when you press **Refresh**, using unsaved editor changes too
(folders such as `node_modules`, `out`, `.git`, `target`, `build` and `dist` are skipped). Names are matched exactly,
including upper and lower case, and only as whole words.

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
| IIQ XML: Show Application Overview | Opens the references and mentions of the application in the active file |
| IIQ XML: Show Application Schema Table | Opens the schemas of the application as tables |
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
- The Application view searches the workspace folder only, matches the name as written (case-sensitive), and does not read
  `.docx` or other binary documents. It lists at most 500 mentions.

## Build locally

You can build with **npm** (comes with Node.js) or with **Yarn**. Both give the same `.vsix`; use whichever you prefer.

### Prerequisites

| Tool | Version | Check with |
|---|---|---|
| [Node.js](https://nodejs.org) (includes npm) | 20 LTS or newer | `node -v` |
| [Yarn](https://classic.yarnpkg.com) (optional, only if you use Yarn) | 1.22 or newer | `yarn -v` |
| Git | any recent | `git --version` |
| VS Code | 1.85 or newer, to install and debug | `code --version` |

To get Yarn: `npm install -g yarn`, or `corepack enable` (Corepack comes with Node.js).
Nothing else has to be installed globally: the TypeScript compiler and the packaging tool (`@vscode/vsce`)
are development dependencies of the project and are downloaded by the install step.

### Build the .vsix

```bash
git clone https://github.com/<your-user>/iiq-xml-explorer.git
cd iiq-xml-explorer
```

| Step | npm | Yarn |
|---|---|---|
| 1. Download dependencies into `node_modules/` (first time, and after `package.json` changes) | `npm install` | `yarn install` |
| 2. Optional: compile and run the unit tests | `npm test` | `yarn test` |
| 3. Compile into `out/` and create `iiq-xml-explorer-<version>.vsix` | `npm run package` | `yarn package` |

The `.vsix` is created in the project folder. Install it with

```bash
code --install-extension iiq-xml-explorer-<version>.vsix
```

then run **Developer: Reload Window** in VS Code.

`node_modules/`, `out/` and `*.vsix` are generated and are ignored by Git; delete them any time and rebuild.

### Scripts

| npm | Yarn | What it does |
|---|---|---|
| `npm install` | `yarn install` | Downloads the dependencies into `node_modules/` |
| `npm run compile` | `yarn compile` | Compiles `src/` (TypeScript) into `out/` (JavaScript) |
| `npm run watch` | `yarn watch` | Same, and recompiles on every save |
| `npm test` | `yarn test` | Compiles, then runs the unit tests (XML parser, IIQ reference detection, workflow model, tree labels and icons) |
| `npm run package` | `yarn package` | Compiles and creates `iiq-xml-explorer-<version>.vsix` |

### npm or Yarn: what to know

- The repository keeps **`package-lock.json`** (npm's lockfile); the GitHub build uses it. When you build with Yarn,
  a local `yarn.lock` is created; it is ignored by Git, so don't commit it.
- **Yarn 2 or newer** ("Berry") doesn't create `node_modules/` by default, and the packaging tool needs it.
  Add a `.yarnrc.yml` file with the line `nodeLinker: node-modules`, or use Yarn 1.
- Yarn 1 may warn *"package-lock.json found"* when installing. The warning is harmless.

### Run and debug without installing

1. Open the project folder in VS Code and install the dependencies once (`npm install` or `yarn install`).
2. Press **F5** (*Run Extension*). It compiles the code and opens an **Extension Development Host** window
   with the extension loaded and the `samples/` folder open.
3. After changing code, run `npm run watch` or `yarn watch` (or press F5 again) and reload the host window with
   **Ctrl+R** (*Developer: Reload Window*). Breakpoints in `src/*.ts` work in the main window.

### Troubleshooting

- **`code` is not recognized**: in VS Code run **Shell Command: Install 'code' command in PATH** (macOS),
  or re-run the Windows installer with *Add to PATH*. You can always use *Extensions* → `…` → *Install from VSIX…* instead.
- **PowerShell: "running scripts is disabled on this system"** when calling `npm` or `yarn`: use *Command Prompt*,
  or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **`yarn` is not recognized**: install it with `npm install -g yarn` (or `corepack enable`), then open a new terminal.
- **Compile errors after pulling changes**: run the install step again; a dependency may have changed.
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

**Publish a release**: see [Create a new release](#create-a-new-release).

## Create a new release

The GitHub workflow creates the release automatically when a **version tag** (such as `v0.4.3`) reaches GitHub.
With a branch → pull request flow, it goes like this.

### 1. Raise the version on a branch

Skip this step if you are releasing the current version for the first time.

```bash
git switch main
git pull
git switch -c release-0.4.3
npm version patch --no-git-tag-version     # or: yarn version --patch --no-git-tag-version
```

Use `minor` or `major` instead of `patch` for bigger changes. Then add a `## 0.4.3` entry to `CHANGELOG.md`
and update the version in the install command at the top of this README.

```bash
git add .
git commit -m "Release 0.4.3"
git push -u origin release-0.4.3
```

### 2. Open a pull request and merge it

Open the pull request on GitHub. The build runs on it, so you can see it pass before merging.

### 3. Tag the merged commit and push the tag

```bash
git switch main
git pull
git tag v0.4.3
git push origin v0.4.3
```

The tag must match the `version` in `package.json`: `v0.4.3` ↔ `0.4.3`.

### 4. Check the result on GitHub

- **Actions** tab: the run shows **build**, then **release**; both should turn green.
- **Releases** page (right side of the repository's main page): **IIQ XML Explorer 0.4.3**,
  with `iiq-xml-explorer-0.4.3.vsix` attached and notes listing the changes since the previous release.

### If something goes wrong

- **The tag doesn't match the version**: the build stops at *Check the tag matches package.json*.
  Delete the tag, fix the version, and tag again:
  ```bash
  git push origin --delete v0.4.3
  git tag -d v0.4.3
  ```
- **The release job fails with a permissions error**: open *Settings → Actions → General → Workflow permissions*,
  select **Read and write permissions**, save, then click **Re-run all jobs** on the run.
- **Don't create the release with GitHub's "Draft a new release" button.** That button also creates the tag,
  which starts the workflow, and the workflow then fails because the release already exists. Push the tag from the terminal instead.

## Author

IIQ XML Explorer was designed and built by **Mergea Sergiu-Octavian**. Released under the MIT License.
