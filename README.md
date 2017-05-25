[![](https://vsmarketplacebadge.apphb.com/version/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/installs/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/rating/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![Chat at https://gitter.im/vscode-gitlens/Lobby](https://badges.gitter.im/vscode-gitlens/Lobby.svg)](https://gitter.im/vscode-gitlens/Lobby?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

# GitLens

GitLens **supercharges** the built-in Visual Studio Code Git capabilities. It helps you to **visualize code authorship** at a glance via inline Git blame annotations and code lens, **seamlessly navigate and explore** the history of a file or branch, **gain valuable insights** via powerful comparision commands, and so much more.

GitLens provides an unobtrusive blame annotation at the end of the selected line, a status bar item showing the commit author and date of the selected line, code lens showing the most recent commit and # of authors of the file and/or code block, and many commands for exploring commits and histories, comparing and navigating revisions, stash access, repository status, and more. GitLens is also [highly customizable](#extension-settings) to meet your specific needs — find code lens intrusive or the selected line blame annotation distracting — no problem, it is easy to [turn them off or change how they behave](#extension-settings).

## Previews
#### Featuring code lens, whole file inline blame annotations, and navigation and exploration via quick pick menus
![GitLens preview 1](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/gitlens-preview1.gif)

#### Featuring selected line blame annotation and hovers, status bar commit details, quick pick menus, compare with previous, and more
![GitLens preview 2](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/gitlens-preview2.gif)

## Features

#### Git Blame Annotations

- Adds a **blame annotation** to the end of the selected line showing the commit id and message, with more details in a hover popup ([optional](#extension-settings), on by default)

- Adds a `Toggle Blame Annotations` command (`gitlens.toggleBlame`) with a shortcut of `alt+b` to toggle **inline Git blame annotations** for a whole file with multiple styles — compact, expanded, and trailing
  - Also adds a `Show Blame Annotations` command (`gitlens.showBlame`)

- Adds **author and date blame information** about the selected line to the **status bar** ([optional](#extension-settings), on by default)
  - By default clicking on the status bar shows a **commit details quick pick menu** with commands for comparing, navigating and exploring commits, and more

  - Provides [customizable](#extension-settings) click behavior of the status bar — choose between one of the following
    - Toggle whole file blame annotations on and off
    - Toggle code lens on and off — only available if [`"gitlens.codeLens.visibility": "ondemand"`](#extension-settings) is set
    - Compare the file with the previous commit
    - Show a quick pick menu with details and commands for the commit
    - Show a quick pick menu with file details and commands for the commit
    - Show a quick pick menu with the commit history of the file
    - Show a quick pick menu with the commit history of the current branch

#### Git Code Lens

- Adds **code lens** to the top of the file and on code blocks ([optional](#extension-settings), on by default)
  - **Recent Change** — author and date of the most recent commit for the file or code block
    - By default, clicking on the code lens shows a **commit file details quick pick menu** with commands for comparing, navigating and exploring commits, and more
  - **Authors** — number of authors of the file or code block and the most prominent author (if there is more than one)
    - By default, clicking on the code lens toggles the inline Git blame annotations on and off for the whole file
    - Will be hidden if the author of the most recent commit is also the only author of the file or block, to avoid duplicate information and reduce visual noise

- Provides [customizable](#extension-settings) click behavior for each code lens — choose between one of the following
  - Toggle whole file blame annotations on and off
  - Compare the file with the previous commit
  - Show a quick pick menu with details and commands for the commit
  - Show a quick pick menu with file details and commands for the commit
  - Show a quick pick menu with the commit history of the file
  - Show a quick pick menu with the commit history of the current branch

- Adds a `Toggle Git Code Lens` command (`gitlens.toggleCodeLens`) with a shortcut of `shift+alt+b` to toggle the code lens on and off — only available if [`"gitlens.codeLens.visibility": "ondemand"`](#extension-settings) is set

#### Powerful Comparison Tools

- Effortlessly navigate between comparisions via the `alt+,` and `alt+.` shortcut keys to go back and forth through a file's revisions

- Provides easy access to the following comparison commands via the `Command Palette` as well as in context via the many provided quick pick menus

- Adds a `Directory Compare` command (`gitlens.diffDirectory`) to open the configured Git difftool to compare directories between branches

- Adds a `Compare File with...` command (`gitlens.diffWithBranch`) to compare the active file with the same file on the selected branch

- Adds a `Compare File with Next Commit` command (`gitlens.diffWithNext`) with a shortcut of `alt+.` to compare the active file/diff with the next commit revision

- Adds a `Compare File with Previous Commit` command (`gitlens.diffWithPrevious`) with a shortcut of `alt+,` to compare the active file/diff with the previous commit revision

- Adds a `Compare Line with Previous Commit` command (`gitlens.diffLineWithPrevious`) with a shortcut of `shift+alt+,` to compare the active file/diff with the previous line commit revision

- Adds a `Compare File with Working Tree` command (`gitlens.diffWithWorking`) with a shortcut of `shift+alt+w` to compare the most recent commit revision of the active file/diff with the working tree

- Adds a `Compare Line with Working Tree` command (`gitlens.diffLineWithWorking`) with a shortcut of `alt+w` to compare the commit revision of the active line with the working tree

#### Navigate and Explore

- Adds a `Search Commits` command (`gitlens.showCommitSearch`) with a shortcut of `alt+/` to search for commits by message, author, file(s), or commit id

- Adds commands to open files, commits, branches, and the repository in the supported remote services, currently **BitBucket, GitHub, GitLab, and Visual Studio Team Services** — only available if a Git upstream service is configured in the repository
  - `Open Branch in Remote` command (`gitlens.openBranchInRemote`) — opens the current branch commits in the supported remote service
  - `Open Line Commit in Remote` command (`gitlens.openCommitInRemote`) — opens the commit revision of the active line in the supported remote service
  - `Open File in Remote` command (`gitlens.openFileInRemote`) — opens the active file/revision in the supported remote service
  - `Open Repository in Remote` command (`gitlens.openRepoInRemote`) — opens the repository in the supported remote service

- Adds a `Show Current Branch History` command (`gitlens.showQuickRepoHistory`) with a shortcut of `shift+alt+h` to show a paged **branch history quick pick menu** of the current branch for exploring its commit history

  ![Branch History Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-branch-history.png)

  - Provides entries to `Show Commit Search` and `Open Branch in <remote-service>` when available
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

- Adds a `Show Branch History` command (`gitlens.showQuickBranchHistory`) to show a paged **branch history quick pick menu** of the selected branch for exploring its commit history
  - Provides the same features as `Show Current Branch History` above

- Adds a `Show File History` command (`gitlens.showQuickFileHistory`) to show a paged **file history quick pick menu** of the active file for exploring its commit history

  ![File History Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-file-history.png)

  - Provides entries to `Show Branch History` and `Open File in <remote-service>` when available
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

- Adds a `Show Commit Details` command (`gitlens.showQuickCommitDetails`) to show a **commit details quick pick menu** of the most recent commit of the active file

  ![Commit Details Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-commit-details.png)

  - Quickly see the set of files changed in the commit, complete with status indicators for adds, changes, renames, and deletes
  - Provides entries to `Copy to Clipboard`, `Directory Compare`, `Open Changed Files`, `Open File in <remote-service>` when available, and more
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#extension-settings) is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the current revision of the while leaving the quick pick menu open
    - NOTE: Once [vscode issue #10568](https://github.com/Microsoft/vscode/issues/10568) is resolved this will change to preview the comparison of the current revision with the previous one

- Adds a `Show Line Commit Details` command (`gitlens.showQuickCommitFileDetails`) with a shortcut of `alt+c` to show a **file commit details quick pick menu** of the most recent commit of the active file

  ![Line Commit Details Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-commit-file-details.png)

  - Provides entries to `Show Commit Details`, `Show File History`, `Compare with...`, `Copy to Clipboard`, `Open File`, `Open File in <remote-service>` when available, and more
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#extension-settings) is set

- Adds a `Show Repository Status` command (`gitlens.showQuickRepoStatus`) with a shortcut of `alt+s` to show a **repository status quick pick menu** for visualizing the current repository status

  ![Repository Status Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-repo-status.png)

  - Quickly see upstream status (if an Git upstream is configured) — complete with ahead and behind information
    - If you are ahead of the upstream, an entry will be shown with the number of commits ahead. Chosing it will show a limited **branch history quick pick menu** containing just the commits ahead of the upstream
    - If you are behind the upstream, an entry will be shown with the number of commits behind. Chosing it will show a limited **branch history quick pick menu** containing just the commits behind the upstream
  - Quickly see all working changes, both staged and unstaged, complete with status indicators for adds, changes, renames, and deletes
  - Provides entries to `Show Stashed Changes`, `Open Changed Files`, and `Close Unchanged Files`
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#extension-settings) is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Staged Files` or `Unstaged Files` sections to preview the working file while leaving the quick pick menu open
    - NOTE: Once [vscode issue #10568](https://github.com/Microsoft/vscode/issues/10568) is resolved this will change to preview the comparison of the working file with the previous revision

- Adds a `Show Stashed Changes` command (`gitlens.showQuickStashList`) to show a **stashed changes quick pick menu** for exploring your repository stash history

  ![Stashed Changes Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-stash-list.png)

  - Provides entries to `Stash Changes`
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available

  - Chosing a stash entry shows a **stash details quick pick menu** which is very similar to the **commit details quick pick menu** above

    ![Stash Details Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/screenshot-stash-details.png)

    - Quickly see the set of files changed in the stash, complete with status indicators for adds, changes, renames, and deletes
    - Provides entries to `Copy Message to Clipboard`, `Directory Compare`, and `Open Changed Files`
    - Provides entries to `Apply Stashed Changes` and `Delete Stashed Changes` — both require a confirmation
    - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
    - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#extension-settings) is set
    - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the current revision of the while leaving the quick pick menu open
      - NOTE: Once [vscode issue #10568](https://github.com/Microsoft/vscode/issues/10568) is resolved this will change to preview the comparison of the current revision with the previous one

- Adds a `Show Last Opened Quick Pick` command (`gitlens.showLastQuickPick`) with a shortcut of `alt+-` to quickly get back to where you were when the last GitLens quick pick menu closed

- Adds a `Open File History Explorer` command (`gitlens.showFileHistory`) to show a **file history explorer** (peek style) to visualize the history of a file
  - Likely to be deprecated in a future release, add your voice to [#66](https://github.com/eamodio/vscode-gitlens/issues/66) if you feel it should not be removed

- Adds a `Open Blame History Explorer` command (`gitlens.showBlameHistory`) to show a **blame history explorer** (peek style) to visualize the blame history of a file or code block
  - Likely to be deprecated in a future release, add your voice to [#66](https://github.com/eamodio/vscode-gitlens/issues/66) if you feel it should not be removed

#### And More

- Adds a `Copy Commit ID to Clipboard` command (`gitlens.copyShaToClipboard`) to copy the commit id (sha) of the active line to the clipboard

- Adds a `Copy Commit Message to Clipboard` command (`gitlens.copyMessageToClipboard`) to copy the commit message of the active line to the clipboard

- Adds a `Open Changed Files` command (`gitlens.openChangedFiles`) to open any files with working tree changes

- Adds a `Close Unchanged Files` command (`gitlens.closeUnchangedFiles`) to close any files without working tree changes

- Adds a `Apply Stashed Changes` command (`gitlens.stashApply`) to chose a stash entry to apply to the working tree from a quick pick menu

- Adds a `Stash Changes` command (`gitlens.stashSave`) to save any working tree changes to the stash — can optionally provide a stash message

## Insiders

Add [`"gitlens.insiders": true`](#extension-settings) to your settings to join the insiders channel and get early access to upcoming features. Be aware that because this provides early access expect there to be issues.

## Extension Settings

GitLens is highly customizable and provides many configuration settings to allow the personalization of almost all features

|Name | Description
|-----|------------
|`gitlens.insiders`|Opts into the insiders channel -- provides access to upcoming features
|`gitlens.outputLevel`|Specifies how much (if any) output will be sent to the GitLens output channel
|`gitlens.blame.annotation.activeLine`|Specifies whether and how to show blame annotations on the active line. `off` - no annotation. `inline` - adds a trailing annotation to the active line. `hover` - adds hover annotation to the active line. `both` - adds both `inline` and `hover` annotations
|`gitlens.blame.annotation.activeLineDarkColor`|Specifies the color of the active line blame annotation to use with a dark theme. Must be a valid css color
|`gitlens.blame.annotation.activeLineLightColor`|Specifies the color of the active line blame annotation to use with a light theme. Must be a valid css color
|`gitlens.blame.annotation.highlight`|Specifies whether and how to highlight blame annotations. `none` - no highlight. `gutter` - adds a gutter icon. `line` - adds a full-line highlight. `both` - adds both `gutter` and `line` highlights
|`gitlens.blame.annotation.style`|Specifies the style of the blame annotations. `compact` - groups annotations to limit the repetition and also adds author and date when possible. `expanded` - shows an annotation on every line
|`gitlens.blame.annotation.author`|Specifies whether the committer will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.date`|Specifies whether and how the commit date will be shown in the blame annotations. `off` - no date. `relative` - relative date (e.g. 1 day ago). `absolute` - date format specified by `gitlens.blame.annotation.dateFormat`. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.dateFormat`|Specifies the date format of how absolute dates will be shown in the blame annotations. See https://momentjs.com/docs/#/displaying/format/ for valid formats
|`gitlens.blame.annotation.message`|Specifies whether the commit message will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.sha`|Specifies whether the commit sha will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.codeLens.visibility`|Specifies when code lens will be shown in the active document. `auto` - always shown. `ondemand` - never shown, unless toggled via the `gitlens.toggleCodeLens` command. `off` - never shown
|`gitlens.codeLens.authors.enabled`|Specifies whether the authors code lens is shown
|`gitlens.codeLens.authors.command`|Specifies the command executed when the authors code lens is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current committed file with the previous commit. `gitlens.showQuickCommitDetails` - shows a commit details quick pick. `gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick. `gitlens.showQuickFileHistory` - shows a file history quick pick. `gitlens.showQuickRepoHistory` - shows a branch history quick pick
|`gitlens.codeLens.recentChange.enabled`|Specifies whether the recent change code lens is shown
|`gitlens.codeLens.recentChange.command`|"Specifies the command executed when the recent change code lens is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current committed file with the previous commit. `gitlens.showQuickCommitDetails` - shows a commit details quick pick. `gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick. `gitlens.showQuickFileHistory` - shows a file history quick pick. `gitlens.showQuickRepoHistory` - shows a branch history quick pick
|`gitlens.codeLens.location`|Specifies where code lens will be rendered in the active document. `all` - render at the top of the document, on container-like (classes, modules, etc), and on member-like (methods, functions, properties, etc) lines. `document+containers` - render at the top of the document and on container-like lines. `document` - only render at the top of the document. `custom` - rendering controlled by `gitlens.codeLens.locationCustomSymbols`
|`gitlens.codeLens.locationCustomSymbols`|Specifies the set of document symbols to render active document code lens on. Must be a member of `SymbolKind`
|`gitlens.codeLens.languageLocations`|Specifies where code lens will be rendered in the active document for the specified languages
|`gitlens.menus.diff.enabled`|Specifies whether diff commands will be added to the context menus
|`gitlens.statusBar.enabled`|Specifies whether blame information is shown in the status bar
|`gitlens.statusBar.alignment`|Specifies the blame alignment in the status bar. `left` - align to the left,  `right` - align to the right
|`gitlens.statusBar.command`|"Specifies the command executed when the blame status bar item is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current committed file with the previous commit. `gitlens.toggleCodeLens` - toggles Git code lens. `gitlens.showQuickCommitDetails` - shows a commit details quick pick. `gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick. `gitlens.showQuickFileHistory` - shows a file history quick pick. `gitlens.showQuickRepoHistory` - shows a branch history quick pick
|`gitlens.statusBar.date`|Specifies whether and how the commit date will be shown in the blame status bar. `off` - no date. `relative` - relative date (e.g. 1 day ago). `absolute` - date format specified by `gitlens.statusBar.dateFormat`
|`gitlens.statusBar.dateFormat`|Specifies the date format of how absolute dates will be shown in the blame status bar. See https://momentjs.com/docs/#/displaying/format/ for valid formats

## Known Issues

- If the `Copy to * clipboard` commands don't work on Linux -- `xclip` needs to be installed. You can install it via `sudo apt-get install xclip`
- Visible whitespace causes issues ([vscode issue #11485](https://github.com/Microsoft/vscode/issues/11485)) with the `expanded` and `compact` blame annotation styles when using a non-monospace font -- set `"gitlens.advanced.toggleWhitespace.enabled": true` if you are using a non-monospace font

## Contributors

A big thanks to the people that have contributed to this project:

- Aurelio Ogliari ([@nobitagit](https://github.com/nobitagit)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=nobitagit)
- Zack Schuster ([@zackschuster](https://github.com/zackschuster)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=zackschuster)
