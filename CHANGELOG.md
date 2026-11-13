# Changelog

## 0.4.3
- Application view: a new panel for an `<Application>` with a **Schema** tab (the schemas as sortable, filterable tables:
  type, identity/display attribute, entitlement, managed, multi-valued, minable, correlation key, required, description)
  and an **Overview** tab (rules, identities and other objects the application references, where they are defined,
  and every mention of the application in the workspace's `.xml`, `.md`, `.markdown` and `.txt` files).
  The Overview also lists indirect dependencies (a rule's libraries, a correlation config's rules, …) and a
  **Files of this application** list (own file, defining files, mentioning files) with *Copy paths* and *Copy as checklist*,
  to track an application in a branch.
  Open it from the tree toolbar, the editor title, the right-click menu on `Application` / `Schema`, or the Command Palette.
- `npm test` / `yarn test` now also work on Windows with Node 20 (the test files are listed by `scripts/run-tests.js`
  instead of a `*.test.js` pattern that cmd.exe and Node 20 do not expand).

## 0.4.2
- "Go to Referenced Object" is also offered on the tag around a reference (`BuildMapRule`, `Owner`, `AccountCorrelationConfig`, …),
  on rule entries such as `<entry key="afterProvisioningRule" value="X"/>`, and on the attribute rows of a reference.
  Ctrl+Click works on these tags too.
- README: shorter Layout section, Commands table without shortcuts, removed the upgrade note for the old publisher id,
  the project file listings and the roadmap.
- GitHub Actions workflow: builds, tests and packages the extension on every push and pull request,
  uploads the .vsix as an artifact, and creates a GitHub Release for version tags (`v*`).
- README: step-by-step local build guide (prerequisites, npm scripts, debugging with F5, releasing, troubleshooting)
  and a section on building with GitHub.
- `npm run package` no longer stops to ask about the missing repository field.
- Build with npm or Yarn: scripts no longer call npm internally, Yarn files are ignored by Git, and the README
  shows every build step for both.
- README: new "Create a new release" section with the full branch → pull request → tag procedure.
- Unit tests extended from 10 to 68: XML parser edge cases, IIQ file and reference detection,
  workflow model edge cases, and the tree's labels, entry values and icons.

## 0.4.1
- Ctrl+Alt+X is now **Show IIQ Structure**: it brings the view into sight and focuses it wherever it is. It no longer hides the right side bar, so tools there (such as Copilot Chat) are never hidden by surprise. Use Ctrl+Alt+B to hide or show the right side bar.
- The first-run prompt now says which option to pick ("New Secondary Side Bar Entry").
- README rewritten: requirements, install and upgrade steps, every toolbar button and menu item, how diagram steps are detected, which files count as IdentityIQ XML, layout options, commands and shortcuts, samples and known limitations.
- Clearer setting descriptions.

## 0.4.0
- Workflow Diagram: clicking a step or transition now jumps to it in the XML (an invisible layer was blocking clicks).
- Workflow Diagram: transition conditions are shown in full, wrapped over several lines; steps are spaced so labels fit and labels avoid step boxes. Toolbar switch for Full / Short conditions.
- Workflow Diagram: large workflows open at a readable zoom starting from the Start step.
- One-time offer to move IIQ Structure to the right side bar (full height); Ctrl+Alt+X shortcut (changed in 0.4.1).

## 0.3.4
- The IIQ Structure view starts larger in the Explorer.
- New command to move the view to the Secondary Side Bar (full height, files stay visible).

## 0.3.3
- Updated extension description (author, attribute view, workflow flowcharts).

## 0.3.2
- Publisher id changed to `mergea-sergiu-octavian` (extension id `mergea-sergiu-octavian.iiq-xml-explorer`). Uninstall the older `mihai-dev.iiq-xml-explorer` once.

## 0.3.1
- Author credit: built by Mergea Sergiu-Octavian.

## 0.3.0
- Workflow Diagram: renders a Workflow as a flowchart in a webview, with IIQ positions or automatic layout, click-to-jump, cursor highlight, live updates and warnings for missing/unreachable steps.

## 0.2.1
- Person icon for everything that references an identity or workgroup (Owner, Remediators, Approvers, Identity references...).
- AccountCorrelationConfig uses the same icon as Attributes/Map.

## 0.2.0
- Every attribute of a tag is listed as a child node (no more hidden "+N attr").
- `<entry>` values shown for nested values, string lists, maps and empty entries.
- New Copy Value command; Copy Path works on attributes (`.../@name`).

## 0.1.1
- The structure view now lives in the Explorer sidebar (under the file tree) instead of its own Activity Bar tab, so files stay visible.

## 0.1.0
- Structure tree view with attribute preview, IIQ icons, tooltips and follow-cursor.
- Tag Index quick pick.
- Reference detection and go-to-definition across workspace XML files.
- Outline/breadcrumbs and hovers for IdentityIQ XML.
- Copy Path and Select Whole Element commands.
