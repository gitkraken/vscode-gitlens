# GitLens

Provides Git information (most recent commit, # of authors) in CodeLens, on-demand inline blame annotations, status bar blame information, a blame explorer, and commands to compare changes with the working tree or previous versions.

---
## Features

- Provides **CodeLens** on code blocks:
  - **Recent Change** - author and date of the most recent check-in for that block
    > Clicking on the CodeLens opens a **Blame history explorer** with the commits and changed lines in the right pane and the commit (file) contents on the left
  - **Authors** - number of authors of a block and the most prominent author (if there are more than one)
    > Clicking on the CodeLens toggles Git blame annotations on/off
- Provides on-demand **inline blame annotations** with multiple styles
- Provides Git blame information about the selected line in the **status bar**
- Provides a Git **blame history explorer** to visualize the history of a file or block
- Provides ability to **compare diffs** with the working tree as well as with previous versions
- Provides many configuration settings to allow the **customization** of almost all Features

---
## Screenshots

> ![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/preview-gitlens.gif)

---
## Requirements

Must be using Git and it must be in your path.

---
## Extension Settings

|Name | Description
|-----|------------
|`gitlens.blame.annotation.style`|Specifies the style of the blame annotations. `compact` - groups annotations to limit the repetition and also adds author and date when possible. `expanded` - shows an annotation on every line
|`gitlens.blame.annotation.sha`|Specifies whether the commit sha will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.author`|Specifies whether the committer will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.date`|Specifies whether the commit date will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.codeLens.visibility`|Specifies when CodeLens will be triggered in the active document. `auto` - automatically. `ondemand` - only when requested. `off` - disables all active document CodeLens
|`gitlens.codeLens.location`|Specifies where CodeLens will be rendered in the active document. `all` - render at the top of the document, on container-like (classes, modules, etc), and on member-like (methods, functions, properties, etc) lines. `document+containers` - render at the top of the document and on container-like lines. `document` - only render at the top of the document. `custom` - rendering controlled by `gitlens.codeLens.locationCustomSymbols`
|`gitlens.codeLens.locationCustomSymbols`|Specifies the set of document symbols to render active document CodeLens on. Must be a member of `SymbolKind`
|`gitlens.codeLens.recentChange.enabled`|Specifies whether the recent change CodeLens is shown
|`gitlens.codeLens.recentChange.command`|Specifies the command executed when the recent change CodeLens is clicked.  `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `git.viewFileHistory` - opens a file history picker, which requires the Git History (git log) extension
|`gitlens.codeLens.authors.enabled`|Specifies whether the authors CodeLens is shown
|`gitlens.codeLens.authors.command`|Specifies the command executed when the authors CodeLens is clicked.  `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `git.viewFileHistory` - opens a file history picker, which requires the Git History (git log) extension
|`gitlens.statusBar.enabled`|Specifies whether blame information is shown in the status bar
|`gitlens.statusBar.command`|"Specifies the command executed when the blame status bar item is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `git.viewFileHistory` - opens a file history picker, which requires the Git History (git log) extension"

---
## Known Issues

- Content in the **Blame history explorer** disappears after a bit: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- Highlighted lines disappear in **Blame explorer** after changing selection and returning to a previous selection: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- CodeLens aren't updated properly after a file is saved: [vscode issue](https://github.com/Microsoft/vscode/issues/11546)
- Visible whitespace causes issue with blame overlay (currently fixed with a hack, but fails randomly): [vscode issue](https://github.com/Microsoft/vscode/issues/11485)

---
## Release Notes

### 0.5.4

 - Fixes off-by-one issues with blame annotations without caching and when diffing with a previous version

### 0.5.3

 - Adds better uncommitted hover message in blame annotations
 - Adds more protection for dealing with uncommitted lines

### 0.5.2

 - Fixes loading issue on Linux

### 0.5.1

 - Adds blame information in the statusBar
 - Add new StatusBar settings -- see **Extension Settings** above for details
 - Renames the `gitlens.codeLens.recentChange.command` & `gitlens.codeLens.authors.command` settings options (to align with command names)
 - Adds new `gitlens.diffWithPrevious` option to the `gitlens.codeLens.recentChange.command` & `gitlens.codeLens.authors.command` settings
 - Fixes Diff with Previous when the selection is uncommitted
 - Removes `gitlens.blame.annotation.useCodeActions` setting and behavior

### 0.3.3

  - Fixes [#7](https://github.com/eamodio/vscode-gitlens/issues/7) - missing spawn-rx dependency (argh!)

### 0.3.2

  - Fixes [#7](https://github.com/eamodio/vscode-gitlens/issues/7) - missing lodash dependency

### 0.3.1

 - Adds new CodeLens visibility & location settings -- see **Extension Settings** above for details
 - Adds new command to toggle CodeLens on and off when `gitlens.codeLens.visibility` is set to `ondemand`

### 0.2.0

 - Fixes [#1](https://github.com/eamodio/vscode-gitlens/issues/1) - Support blame on files outside the workspace repository
 - Replaces blame regex parsing with a more robust parser
 - Fixes failures with Diff with Previous command
 - Fixes issues with blame explorer CodeLens when dealing with previous commits
 - Fixes display issues with compact blame annotations (now skips blank lines)

### 0.1.3

 - Improved blame annotations, now with sha and author by default
 - Add new blame annotation styles -- compact and expanded (default)
 - Adds many new configuration settings; see **Extension Settings** above for details

### 0.0.7

 - Fixes [#4](https://github.com/eamodio/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash (Really!)
 - Fixes [#5](https://github.com/eamodio/vscode-gitlens/issues/5) - Finding first non-white-space fails sometimes
 - Adds .gitignore checks to reduce the number of blame calls

### 0.0.6

 - Fixes [#2](https://github.com/eamodio/vscode-gitlens/issues/2) - [request] Provide some debug info when things fail
 - Fixes [#4](https://github.com/eamodio/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash
 - Attempts to scroll to the correct position when opening a diff

### 0.0.5

- Fixes issues where filename changes in history would cause diffs to fails
- Fixes some issues with uncommitted blames
- Removes CodeLens from fields and single-line properties to reduce visual noise
- Automatically turns off blame only when required now

### 0.0.4

Candidate for preview release on the vscode marketplace.

### 0.0.1

Initial release but still heavily a work in progress.