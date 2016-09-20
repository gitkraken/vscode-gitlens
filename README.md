# GitLens

Provides Git information (most recent commit, # of authors) in CodeLens, on-demand inline blame annotations, a blame explorer, and commands to compare changes with the working tree or previous versions.

## Features

Provides two CodeLens on code blocks:
- **Recent Change** - author and date of the most recent check-in
  > Clicking on the CodeLens opens a **Blame explorer** with the commits and changed lines in the right pane and the commit (file) contents on the left
- **Authors** - number of authors of a block and the most prominent author (if there are more than one)
  > Clicking on the CodeLens toggles Git blame annotations on/off

## Screenshot
> ![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/preview-gitlens.gif)

## Requirements

Must be using Git and it must be in your path.

## Extension Settings

|Name | Description
|-----|------------
|`gitlens.blame.annotation.style`|Specifies the style of the blame annotations. `compact` - groups annotations to limit the repetition and also adds author and date when possible. `expanded` - shows an annotation on every line
|`gitlens.blame.annotation.sha`|Specifies whether the commit sha will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.author`|Specifies whether the committer will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.date`|Specifies whether the commit date will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.useCodeActions`|Specifies whether code actions (Diff with Working, Diff with Previous) will be provided for the selected line, when annotating. Not required as context menu options are always provided
|`gitlens.codeLens.visibility`|Specifies when CodeLens will be triggered in the active document. `auto` - automatically. `ondemand` - only when requested. `off` - disables all active document CodeLens
|`gitlens.codeLens.location`|Specifies where CodeLens will be rendered in the active document. `all` - render at the top of the document, on container-like (classes, modules, etc), and on member-like (methods, functions, properties, etc) lines. `document+containers` - render at the top of the document and on container-like lines. `document` - only render at the top of the document. `custom` - rendering controlled by `gitlens.codeLens.locationCustomSymbols`
|`gitlens.codeLens.locationCustomSymbols`|Specifies the set of document symbols to render active document CodeLens on. Must be a member of `SymbolKind`
|`gitlens.codeLens.recentChange.enabled`|Specifies whether the recent change CodeLens is shown
|`gitlens.codeLens.recentChange.command`|Specifies the command executed when the recent change CodeLens is clicked. `blame.annotate` - toggles blame annotations. `blame.explorer` - opens the blame explorer. `git.history` - opens a file history picker, which requires the Git History (git log) extension
|`gitlens.codeLens.authors.enabled`|Specifies whether the authors CodeLens is shown
|`gitlens.codeLens.authors.command`|Specifies the command executed when the authors CodeLens is clicked. `blame.annotate` - toggles blame annotations. `blame.explorer` - opens the blame explorer. `git.history` - opens a file history picker, which requires the Git History (git log) extension

## Known Issues

- Content in the **Blame explorer** disappears after a bit: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- Highlighted lines disappear in **Blame explorer** after changing selection and returning to a previous selection: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- CodeLens aren't updated properly after a file is saved: [vscode issue](https://github.com/Microsoft/vscode/issues/11546)
- Visible whitespace causes issue with blame overlay (currently fixed with a hack, but fails randomly): [vscode issue](https://github.com/Microsoft/vscode/issues/11485)

## Release Notes

### 0.3.2

  - Fixes issue with missing lodash dependency

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
- Fixes some issues with uncommited blames
- Removes CodeLens from fields and single-line properties to reduce visual noise
- Automatically turns off blame only when required now

### 0.0.4

Candidate for preview release on the vscode marketplace.

### 0.0.1

Initial release but still heavily a work in progress.