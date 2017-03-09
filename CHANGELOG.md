## Release Notes

### 2.11.0
- Adds `gitlens.showQuickCommitFileDetails` command to show a quick pick list of details for a file commit
- Adds `gitlens.showQuickCommitFileDetails` command to CodeLens
- Adds `gitlens.showQuickCommitFileDetails` command to the status bar
- Adds `gitlens.closeUnchangedFiles` command to close any editors that don't have uncommitted changes
- Adds `gitlens.openChangedFiles` command to open all files that have uncommitted changes
- Adds `gitlens.diffDirectory` command to open the configured git difftool to compare directory versions
- Adds `Directory Compare with Previous Commit` command on the `gitlens.showQuickCommitDetails` quick pick
- Adds `Directory Compare with Working Tree` command on the `gitlens.showQuickCommitDetails` quick pick
- Adds a `Changed Files` grouping on the `gitlens.showQuickCommitDetails` quick pick
- Adds a `Close Unchanged Files` command on the `gitlens.showQuickRepoStatus` quick pick
- Adds a contextual description to the `go back` command in quick pick lists
- Changes layout of the `gitlens.showQuickRepoStatus` quick pick for better clarity
- Changes behavior of `gitlens.showQuickCommitDetails` to show commit a quick pick list of details for a commit
- Changes default of `gitlens.codeLens.recentChange.command` to be `gitlens.showQuickCommitFileDetails` (though there is no visible behavior change)
- Renames `Open Files` to `Open Changed Files` on the `gitlens.showQuickCommitDetails` quick pick
- Renames `Open Working Files` to `Open Changed Working Files` on the `gitlens.showQuickCommitDetails` quick pick
- Renames `Show Changed Files` to `Show Commit Details` on the `gitlens.showQuickCommitFileDetails` quick pick
- Renames `Open Files` to `Open Changed Files` on the `gitlens.showQuickRepoStatus` quick pick
- Fixes [#44](https://github.com/eamodio/vscode-gitlens/issues/43) by adding a warning message about Git version requirements
- Fixes intermittent errors when adding active line annotations
- Fixes intermittent errors when opening multiple files via quick picks

### 2.10.1
- Fixes [#43](https://github.com/eamodio/vscode-gitlens/issues/43) - File-level CodeLens isn't using the blame of the whole file as it should
- Fixes issue with single quotes (') in annotations
- Fixes output channel logging (also adds more debug information to CodeLens -- when enabled)

### 2.10.0
- Adds blame and active line annotation support to git diff split view
- Adds command (compare, copy sha/message, etc) support to git diff split view
- Fixes startup failure if caching was disabled
- Fixes missing `Compare Line with Previous Commit` context menu item
- Fixes [#41](https://github.com/eamodio/vscode-gitlens/issues/41) - Toggle Blame annotations on compare files page
- Fixes issue with undo (to a saved state) not causing annotations to reappear properly
- Attempts to fix [#42](https://github.com/eamodio/vscode-gitlens/issues/42) - Cursor on Uncommitted message

### 2.9.0
- To accomodate the realization that blame information is invalid when a file has unsaved changes, the following behavior changes have been made
  - Status bar blame information will hide
  - CodeLens change to a `Cannot determine...` message and become unclickable
  - Many menu choices and commands will hide
- Fixes [#38](https://github.com/eamodio/vscode-gitlens/issues/38) - Toggle Blame Annotation button shows even when it isn't valid
- Fixes [#36](https://github.com/eamodio/vscode-gitlens/issues/36) - Blame information is invalid when a file has unsaved changes

### 2.8.2
- Adds `gitlens.blame.annotation.dateFormat` to specify how absolute commit dates will be shown in the blame annotations
- Adds `gitlens.statusBar.date` to specify whether and how the commit date will be shown in the blame status bar
- Adds `gitlens.statusBar.dateFormat` to specify how absolute commit dates will be shown in the blame status bar
- Fixes [#39](https://github.com/eamodio/vscode-gitlens/issues/39) - Add date format options for status bar blame

### 2.8.1
- Fixes issue where `Compare with *` commands fail to open when there is no active editor

### 2.8.0
- Adds new `Open File` command on the `gitlens.showQuickCommitDetails` quick pick list to open the commit version of the file
- Adds new `Open File` command on the `gitlens.showQuickCommitDetails` quick pick list to open the commit version of the files
- Adds `alt+left` keyboard shortcut in quick pick list to `go back`
- Adds `alt+right` keyboard shortcut in quick pick list to execute the currently selected item while keeping the quick pick open (in most cases)
- `alt+right` keyboard shortcut on commit details file name, will open the commit version of the file
- Indents the file statuses on the `gitlens.showQuickCommitDetails` quick pick list
- Renames `Open File` to `Open Working File` on the `gitlens.showQuickCommitDetails` quick pick list
- Renames `Open File` and `Open Working Files` on the `gitlens.showQuickCommitDetails` quick pick list
- Reorders some quick pick lists
- Fixes [#34](https://github.com/eamodio/vscode-gitlens/issues/34) - Open file should open the selected version of the file
- Fixes some issue where some editors opened by the quickpick would not be opened in preview tabs
- Fixes issue where copy to clipboard commands would fail if there was no active editor
- Fixes issue where active line annotations would show for opened versioned files
- Fixes issue where CodeLens compare commands on opened versioned files would fail

### 2.7.1
- Adds proper support for multi-line commit messages
- Fixes [#33](https://github.com/eamodio/vscode-gitlens/issues/33) - Commit message styled as title in popup, when message starts with hash symbol

### 2.7.0
- Adds file status icons (added, modified, deleted, etc) to the `gitlens.showQuickCommitDetails` quick pick list
- Adds `Copy Commit Sha to Clipboard` command to commit files quick pick list
- Adds `Copy Commit Message to Clipboard` command to commit files quick pick list
- Changes `Show Commit History` to `Show File History` on the `gitlens.showQuickCommitDetails` quick pick list
- Changes `Show Previous Commit History` to `Show Previous File History` on the `gitlens.showQuickCommitDetails` quick pick list
- Fixes issue with repository status when there are no changes
- Fixes issue with `.` showing in the path of quick pick lists
- Fixes logging to clean up on extension deactivate

### 2.6.0
- Adds `gitlens.showQuickRepoStatus` command to show a quick pick list of files changed including status icons (added, modified, deleted, etc)
- Adds `alt+s` shortcut for the `gitlens.showQuickRepoStatus` command

### 2.5.6
- Fixes [#32](https://github.com/eamodio/vscode-gitlens/issues/32) - 00000000 Uncommitted changes distracting

### 2.5.5
- Fixes [#25](https://github.com/eamodio/vscode-gitlens/issues/25) - Blame information isn't updated after git operations (commit, reset, etc)

### 2.5.4
- Fixes extra spacing in annotations

### 2.5.3
- Fixes [#27](https://github.com/eamodio/vscode-gitlens/issues/27) - Annotations are broken in vscode insider build

### 2.5.2
- Adds `Open File` command to `gitlens.showQuickCommitDetails` quick pick list
- Adds `Open Files` command to `gitlens.showQuickCommitDetails` quick pick list
- Changes `Not Committed Yet` author for uncommitted changes to `Uncommitted`
- Improves performance of git-log operations in `gitlens.diffWithPrevious` and `gitlens.diffWithWorking` commands
- Fixes showing `gitlens.showQuickCommitDetails` quick pick list for uncommitted changes -- now shows the previous commit details

### 2.5.1
- Adds `gitlens.copyMessageToClipboard` command to copy commit message to the clipboard
- Adds `gitlens.copyMessageToClipboard` to the editor content menu
- Adds `Copy Commit Message to Clipboard` command to `gitlens.showQuickCommitDetails` quick pick list
- Changes behavior of `gitlens.copyShaToClipboard` to copy the sha of the most recent commit to the repository if there is no active editor
- Changes behavior of `gitlens.showQuickFileHistory` to execute `gitlens.showQuickRepoHistory` if there is no active editor
- Fixes issue where shortcut keys weren't disabled if GitLens was disabled

### 2.5.0
- Overhauls the `gitlens.showQuickRepoHistory`, `gitlens.showQuickFileHistory`, and `gitlens.showQuickCommitDetails` quick pick lists
  - Adds `Show Repository History` command to `gitlens.showQuickFileHistory` quick pick list
  - Adds `Show Previous Commits History` command to `gitlens.showQuickCommitDetails` quick pick list
  - Adds `Show Commits History` command to `gitlens.showQuickCommitDetails` quick pick list
  - Adds `Copy Commit Sha to Clipboard` command to `gitlens.showQuickCommitDetails` quick pick list
  - Adds `Show Changed Files` command to `gitlens.showQuickCommitDetails` quick pick list
  - Adds more robust `go back` navigation in quick pick lists
  - Adds commit message to placeholder text of many quick pick lists
  - Adds icons for some commands
- Adds `gitlens.diffWithPrevious` command to the editor content menu
- Adds `gitlens.diffWithWorking` command to the editor content menu
- Adds `gitlens.showQuickRepoHistory` and `gitlens.showQuickCommitDetails` commands to CodeLens
- Adds `gitlens.showQuickRepoHistory` and `gitlens.showQuickCommitDetails` commands to the status bar
- Changes the default command of `gitlens.codeLens.recentChange.command` to `gitlens.showQuickCommitDetails`
- Changes the default command of `gitlens.statusBar.command` to `gitlens.showQuickCommitDetails`
- Changes behavior of `gitlens.showQuickCommitDetails` to show commit commands rather than file set (use `Show Changed Files` command to get to the file set)
- Changes `gitlens.diffWithPrevious` command to behave as `gitlens.diffWithWorking` if the file has uncommitted changes
- Renames `gitlens.diffWithPrevious` command from `Diff Commit with Previous` to `Compare with Previous Commit`
- Renames `gitlens.diffLineWithPrevious` command from `Diff Commit (line) with Previous` to `Compare Line with Previous Commit`
- Renames `gitlens.diffWithWorking` command from `Diff Commit with Working Tree` to `Compare with Working Tree`
- Renames `gitlens.diffLineWithWorking` command from `Diff Commit (line) with Working Tree` to `Compare Line with Working Tree`
- Fixes issues with certain git commands not working on Windows
- Fixes [#31](https://github.com/eamodio/vscode-gitlens/issues/31) - Disable gitlens if the project does not have `.git` folder
- Fixes issue where quick pick lists could fail if there was no active editor
- Fixes CodeLens not updating in response to configuration changes

### 2.1.1
- Fixes overzealous active line annotation updating on document changes

### 2.1.0
- Adds a new GitLens logo and changes all images to svg
- Adds `alt+p` shortcut for the `gitlens.diffLineWithPrevious` command
- Adds `shift+alt+p` shortcut for the `gitlens.diffWithPrevious` command
- Adds `alt+w` shortcut for the `gitlens.diffLineWithWorking` command
- Adds `shift+alt+w` shortcut for the `gitlens.diffWithWorking` command
- Adds `gitlens.copyShaToClipboard` command to copy commit sha to the clipboard ([#28](https://github.com/eamodio/vscode-gitlens/issues/28))
- Adds `gitlens.showQuickCommitDetails` command to show a quick pick list of details for a commit
- Adds `go back` choice to `gitlens.showQuickCommitDetails`, `gitlens.showQuickFileHistory`, and `gitlens.showQuickRepoHistory` quick pick lists
- Adds `gitlens.blame.annotation.highlight` to specify whether and how to highlight blame annotations ([#24](https://github.com/eamodio/vscode-gitlens/issues/24))
- Greatly improves performance of line navigation when either active line annotations or status bar blame is enabled
- Fixes [#29](https://github.com/eamodio/vscode-gitlens/issues/29) - Commit info tooltip duplicated for current line when blame is enabled
- Fixes issue where sometimes the commit history shown wasn't complete
- Fixes issues with `gitlens.diffLineWithPrevious` and `gitlens.diffWithPrevious` not following renames properly
- Fixes issues with `gitlens.diffLineWithPrevious` and `gitlens.diffWithPrevious` not always grabbing the correct commit

### 2.0.2
- Adds auto-enable of whitespace toggling when using font-ligatures because of [vscode issue](https://github.com/Microsoft/vscode/issues/11485)
- Adds `gitlens.blame.annotation.characters.*` settings to provide some control over how annotations are displayed
- Fixes [#22](https://github.com/eamodio/vscode-gitlens/issues/22) - Cannot read property 'sha' of undefined

### 2.0.1
- Fixes [#26](https://github.com/eamodio/vscode-gitlens/issues/26) - Active line annotation doesn't disappear properly after delete

### 2.0.0
- Adds `gitlens.blame.annotation.activeLine` to specify whether and how to show blame annotations on the active line
- Adds full commit message (rather than just summary) to active line hover if `gitlens.blame.annotation.activeLine` is not `off`
- Adds new `trailing` blame annotation style -- adds annotations after the code lines rather than before
- Adds `gitlens.blame.annotation.message` to show the commit message in `expanded` and `trailing` blame annotation styles
- Adds support for relative dates in blame annotations. Use `gitlens.blame.annotation.date`
- Changes the design of hover annotations -- much cleaner now
- Disables automatic whitespace toggling by default as it is seemingly no longer needed as [vscode issue](https://github.com/Microsoft/vscode/issues/11485) seems fixed. It can be re-enabled with `gitlens.advanced.toggleWhitespace.enabled`
- Fixes issue where the status bar blame would get stuck switching between editors
- Fixes issue where CodeLens aren't updated properly after a file is saved
- Re-adds context menu for `gitlens.diffLineWithPrevious` -- since [vscode issue](https://github.com/Microsoft/vscode/issues/15395)
- Re-adds context menu for `gitlens.diffLineWithWorking` -- since [vscode issue](https://github.com/Microsoft/vscode/issues/15395)

### 1.4.3
- Adds some logging to hopefully trap [#22](https://github.com/eamodio/vscode-gitlens/issues/22) - Cannot read property 'sha' of undefined
- Fixes issue with the latest insiders build (1.9.0-insider f67f87c5498d9361c0b29781c341fd032815314b) where there is a collision of document schemes

### 1.4.2
- Fixes issue where file history wouldn't compare correctly to working tree if the filename had changed

### 1.4.1
- Adds `gitlens.advanced.gitignore.enabled` to enable/disable .gitignore parsing. Addresses [#20](https://github.com/eamodio/vscode-gitlens/issues/20) - Nested .gitignore files can cause blame to fail with a repo within another repo

### 1.4.0
- Adds `alt+h` shortcut for the `gitlens.showQuickFileHistory` command
- Adds `shift+alt+h` shortcut for the `gitlens.showQuickRepoHistory` command
- Adds `gitlens.advanced.maxQuickHistory` to limit the number of quick history entries to show (for better performance); Defaults to 200
- Adds `gitlens.diffLineWithPrevious` as `alt` context menu item for `gitlens.diffWithPrevious`
- Adds `gitlens.diffLineWithWorking` as `alt` context menu item for `gitlens.diffWithWorking`
- Adds `gitlens.showFileHistory` as `alt` context menu item for `gitlens.showQuickFileHistory`
- Removes context menu for `gitlens.diffLineWithPrevious` -- since it is now the `alt` of `gitlens.diffWithPrevious`
- Removes context menu for `gitlens.diffLineWithWorking` -- since it is now the `alt` of `gitlens.diffWithWorking`
- Replaces `gitlens.menus.fileDiff.enabled` and `gitlens.menus.lineDiff.enabled` with `gitlens.menus.diff.enabled` -- since the switch between file and line diff is now controlled by the `alt` key

### 1.3.1
- Renames `Diff` commands for better clarity
- Removes `Git` from the commands as it feels unnecessary
- Reorders the context menu commands
- Adds `Diff Commit with Working Tree` to the explorer context menu (assuming `gitlens.menus.fileDiff.enabled` is `true`)
- Adds `Diff Commit with Working Tree` & `Diff Commit with Previous` to the editor title context menu (assuming `gitlens.menus.fileDiff.enabled` is `true`)

### 1.3.0
- Adds support for blame and history (log) on files opened via compare commands -- allows for deep navigation through git history

### 1.2.0
- Adds compare (working vs previous) options to repository history
- Adds compare (working vs previous) options to file history
- Fixes issue with repository history compare with commits with multiple files

### 1.1.1
- Allows `gitlens.showQuickRepoHistory` command to run without an open editor (falls back to the folder repository)
- Adds logging for tracking [#18](https://github.com/eamodio/vscode-gitlens/issues/18) - GitLens only displayed for some files

### 1.1.0
- Adds new `gitlens.showQuickFileHistory` command to show the file history in a quick-pick list (palette)
- Adds new `gitlens.showQuickRepoHistory` command to show the repository history in a quick-pick list (palette)
- Adds `gitlens.showQuickFileHistory` option to the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings
- Removes `git.viewFileHistory` option from the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings
- Changes the `gitlens.statusBar.command` settings default to `gitlens.showQuickFileHistory` instead of `gitlens.toggleBlame`

### 1.0.2
- Fixes [#16](https://github.com/eamodio/vscode-gitlens/issues/16) - incorrect 'Unable to find Git' message

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
- Adds blame information in the status bar
- Add new status bar settings -- see **Extension Settings** above for details
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
- Candidate for preview release on the vscode marketplace.

### 0.0.1
- Initial release but still heavily a work in progress.