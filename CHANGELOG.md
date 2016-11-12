---
## Release Notes

### 1.0.0

  - Adds support for git history (log)!
  - Adds support for blame annotations and git commands on file revisions
  - Adds ability to show multiple blame annotation at the same time (one per vscode editor)
  - Adds new `gitlens.showFileHistory` command to open the history explorer
  - Adds new `gitlens.showFileHistory` option to the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings
  - Adds per-language CodeLens location customization using the `gitlens.codeLens.languageLocations` setting
  - Adds new `gitlens.diffLineWithPrevious` command for line sensitive diffs
  - Adds new `gitlens.diffLineWithWorking` command for line sensitive diffs
  - Adds `gitlens.diffWithPrevious` command to the explorer context menu
  - Adds output channel logging, controlled by the `gitlens.advanced.output.level` setting
  - Switches on-demand CodeLens to be a global toggle (rather than per file)
  - Complete rewrite of the blame annotation provider to reduce overhead and provide better performance
  - Improves performance of the CodeLens support
  - Improves performance (significantly) when only showing CodeLens at the document level
  - Improves performance of status bar blame support
  - Changes `gitlens.diffWithPrevious` command to always be file sensitive diffs
  - Changes `gitlens.diffWithWorking` command to always be file sensitive diffs
  - Removes all debug logging, unless the `gitlens.advanced.debug` settings it on
  - Fixes many (most?) issues with whitespace toggling (required because of https://github.com/Microsoft/vscode/issues/11485)
  - Fixes issue where blame annotations would not be cleared properly when switching between open files

### 0.5.5

  - Fixes another off-by-one issue when diffing with caching

### 0.5.4

 - Fixes off-by-one issues with blame annotations without caching and when diffing with a previous version

### 0.5.3

 - Adds better uncommitted hover message in blame annotations
 - Adds more protection for dealing with uncommitted lines

### 0.5.2

 - Fixes loading issue on Linux

### 0.5.1

 - Adds blame information in the StatusBar
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