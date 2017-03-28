[![](https://vsmarketplacebadge.apphb.com/version/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/installs/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/rating/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
# GitLens

Provides Git CodeLens information (most recent commit, # of authors), on-demand inline blame annotations, status bar blame information, file and blame history explorers, and commands to compare changes with the working tree or previous versions.

## Features

- Provides (optional) **CodeLens** on code blocks:
  - **Recent Change** - author and date of the most recent commit for that block
    - Clicking on the CodeLens opens a **commit details quick pick** ui (by default) with commands for comparing, navigating, and exploring commits
  - **Authors** - number of authors of a block and the most prominent author (if there are more than one)
    - Clicking on the CodeLens toggles Git blame annotations on/off (by default)
- Provides on-demand **inline blame annotations** with multiple styles (compact, expanded, and trailing)
- Provides (optional) Git blame information about the selected line in the **status bar**
  - Clicking on the status bar toggles Git blame annotations on/off (by default)
- Provides (optional) Git blame information about the selected line to the right of the line
- Provides ability to **compare diffs** with the working tree as well as with previous versions
- Provides a Git **commit details quick pick** ui with detailed information about the commit, complete with commands for comparing, navigating, and exploring commits
- Provides a Git **file history quick pick** ui for exploring the commit history of a file
- Provides a Git **repository history quick pick** ui for exploring the commit history of a repository
- Provides a Git **repository status quick pick** ui for exploring the status of a repository
- Provides a Git **file history explorer** (peek style ui) to visualize the history of a file
- Provides a Git **blame history explorer** (peek style ui) to visualize the blame history of a file or block
- Provides many configuration settings to allow the **customization** of almost all features

## Feature Previews
#### Featuring CodeLens and commands, toggling inline blame annotations, and showing quick pick ui and commands
![GitLens preview 1](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/gitlens-preview1.gif)

#### Featuring active line blame annotation and hovers, status bar commit details and commands, quick pick ui and commands, compare with previous, etc
![GitLens preview 2](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/gitlens-preview2.gif)

## Extension Settings

|Name | Description
|-----|------------
|`gitlens.blame.annotation.style`|Specifies the style of the blame annotations. `compact` - groups annotations to limit the repetition and also adds author and date when possible. `expanded` - shows an annotation on every line
|`gitlens.blame.annotation.highlight`|Specifies whether and how to highlight blame annotations. `none` - no highlight. `gutter` - adds a gutter icon. `line` - adds a full-line highlight. `both` - adds both `gutter` and `line` highlights
|`gitlens.blame.annotation.sha`|Specifies whether the commit sha will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.author`|Specifies whether the committer will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.date`|Specifies whether and how the commit date will be shown in the blame annotations. `off` - no date. `relative` - relative date (e.g. 1 day ago). `absolute` - date format specified by `gitlens.blame.annotation.dateFormat`. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.dateFormat`|Specifies the date format of how absolute dates will be shown in the blame annotations. See https://momentjs.com/docs/#/displaying/format/ for valid formats
|`gitlens.blame.annotation.message`|Specifies whether the commit message will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.activeLine`|Specifies whether and how to show blame annotations on the active line. `off` - no annotation. `inline` - adds a trailing annotation to the active line. `hover` - adds hover annotation to the active line. `both` - adds both `inline` and `hover` annotations
|`gitlens.codeLens.visibility`|Specifies when CodeLens will be triggered in the active document. `auto` - automatically. `ondemand` - only when requested. `off` - disables all active document CodeLens
|`gitlens.codeLens.location`|Specifies where CodeLens will be rendered in the active document. `all` - render at the top of the document, on container-like (classes, modules, etc), and on member-like (methods, functions, properties, etc) lines. `document+containers` - render at the top of the document and on container-like lines. `document` - only render at the top of the document. `custom` - rendering controlled by `gitlens.codeLens.locationCustomSymbols`
|`gitlens.codeLens.locationCustomSymbols`|Specifies the set of document symbols to render active document CodeLens on. Must be a member of `SymbolKind`
|`gitlens.codeLens.languageLocations`|Specifies where CodeLens will be rendered in the active document for the specified languages
|`gitlens.codeLens.recentChange.enabled`|Specifies whether the recent change CodeLens is shown
|`gitlens.codeLens.recentChange.command`|"Specifies the command executed when the recent change CodeLens is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current committed file with the previous commit. `gitlens.showQuickCommitDetails` - shows a commit details quick pick. `gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick. `gitlens.showQuickFileHistory` - shows a file history quick pick. `gitlens.showQuickFileHistory` - shows a repository history quick pick
|`gitlens.codeLens.authors.enabled`|Specifies whether the authors CodeLens is shown
|`gitlens.codeLens.authors.command`|Specifies the command executed when the authors CodeLens is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current committed file with the previous commit. `gitlens.showQuickCommitDetails` - shows a commit details quick pick. `gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick. `gitlens.showQuickFileHistory` - shows a file history quick pick. `gitlens.showQuickFileHistory` - shows a repository history quick pick
|`gitlens.menus.diff.enabled`|Specifies whether diff commands will be added to the context menus
|`gitlens.statusBar.enabled`|Specifies whether blame information is shown in the status bar
|`gitlens.statusBar.command`|"Specifies the command executed when the blame status bar item is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current committed file with the previous commit. `gitlens.showQuickCommitDetails` - shows a commit details quick pick. `gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick. `gitlens.showQuickFileHistory` - shows a file history quick pick. `gitlens.showQuickFileHistory` - shows a repository history quick pick
|`gitlens.statusBar.date`|Specifies whether and how the commit date will be shown in the blame status bar. `off` - no date. `relative` - relative date (e.g. 1 day ago). `absolute` - date format specified by `gitlens.statusBar.dateFormat`
|`gitlens.statusBar.dateFormat`|Specifies the date format of how absolute dates will be shown in the blame status bar. See https://momentjs.com/docs/#/displaying/format/ for valid formats

## Known Issues

- If the `Copy to * clipboard` commands don't work on Linux -- `xclip` needs to be installed. You can install it via `sudo apt-get install xclip`
- Visible whitespace causes issue ([vscode issue](https://github.com/Microsoft/vscode/issues/11485)) with `expanded` & `compact` blame annotations when using a non-monospace font -- use `gitlens.advanced.toggleWhitespace.enabled` if you are using a non-monospace font
