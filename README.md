# GitLens

Provides Git CodeLens information (most recent commit, # of authors), on-demand inline blame annotations, status bar blame information, file and blame history explorers, and commands to compare changes with the working tree or previous versions.

---
## Features

- Provides (optional) **CodeLens** on code blocks:
  - **Recent Change** - author and date of the most recent check-in for that block
    - Clicking on the CodeLens opens a **file history explorer** (by default) with the all the file commits in the right pane and the commit (file) contents on the left
  - **Authors** - number of authors of a block and the most prominent author (if there are more than one)
    - Clicking on the CodeLens toggles Git blame annotations on/off (by default)
- Provides on-demand **inline blame annotations** with multiple styles (compact, expanded, and trailing)
- Provides (optional) Git blame information about the selected line in the **status bar**
  - Clicking on the status bar toggles Git blame annotations on/off (by default)
- Provides (optional) Git blame information about the selected line to the right of the line
- Provides a Git **file history explorer** to visualize the history of a file
- Provides a Git **blame history explorer** to visualize the blame history of a file or block
- Provides ability to **compare diffs** with the working tree as well as with previous versions
- Provides many configuration settings to allow the **customization** of almost all features

## Screenshots

![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/preview-gitlens.gif)

## Extension Settings

|Name | Description
|-----|------------
|`gitlens.blame.annotation.style`|Specifies the style of the blame annotations. `compact` - groups annotations to limit the repetition and also adds author and date when possible. `expanded` - shows an annotation on every line
|`gitlens.blame.annotation.sha`|Specifies whether the commit sha will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.author`|Specifies whether the committer will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.date`|Specifies whether the commit date will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.message`|Specifies whether the commit message will be shown in the blame annotations. Applies only to the `expanded` & `trailing` annotation styles
|`gitlens.blame.annotation.activeLine`|Specifies whether and how to show blame annotations on the active line. `off` - no annotation. `inline` - adds a trailing annotation to the active line. `hover` - adds hover annotation to the active line. `both` - adds both `inline` and `hover` annotations
|`gitlens.codeLens.visibility`|Specifies when CodeLens will be triggered in the active document. `auto` - automatically. `ondemand` - only when requested. `off` - disables all active document CodeLens
|`gitlens.codeLens.location`|Specifies where CodeLens will be rendered in the active document. `all` - render at the top of the document, on container-like (classes, modules, etc), and on member-like (methods, functions, properties, etc) lines. `document+containers` - render at the top of the document and on container-like lines. `document` - only render at the top of the document. `custom` - rendering controlled by `gitlens.codeLens.locationCustomSymbols`
|`gitlens.codeLens.locationCustomSymbols`|Specifies the set of document symbols to render active document CodeLens on. Must be a member of `SymbolKind`
|`gitlens.codeLens.languageLocations`|Specifies where CodeLens will be rendered in the active document for the specified languages
|`gitlens.codeLens.recentChange.enabled`|Specifies whether the recent change CodeLens is shown
|`gitlens.codeLens.recentChange.command`|Specifies the command executed when the recent change CodeLens is clicked.  `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `gitlens.showQuickFileHistory` - shows a file history picker
|`gitlens.codeLens.authors.enabled`|Specifies whether the authors CodeLens is shown
|`gitlens.codeLens.authors.command`|Specifies the command executed when the authors CodeLens is clicked.  `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `gitlens.showQuickFileHistory` - shows a file history picker
|`gitlens.menus.diff.enabled`|Specifies whether diff commands will be added to the context menus
|`gitlens.statusBar.enabled`|Specifies whether blame information is shown in the status bar
|`gitlens.statusBar.command`|"Specifies the command executed when the blame status bar item is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `gitlens.showQuickFileHistory` - shows a file history picker

## Known Issues

- Visible whitespace causes issue ([vscode issue](https://github.com/Microsoft/vscode/issues/11485)) with `expanded` & `compact` blame annotations when using a non-monospace font -- use `gitlens.advanced.toggleWhitespace.enabled` if you are using a non-monospace font
- Menu `alt` commands aren't working: [vscode issue](https://github.com/Microsoft/vscode/issues/15395)