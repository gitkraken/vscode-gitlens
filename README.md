[![](https://vsmarketplacebadge.apphb.com/version-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/downloads-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/rating-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://img.shields.io/badge/vscode--dev--community-gitlens-blue.svg?logo=slack)](https://vscode-slack.amod.io)

<p align="center">
  <br />
  <a title="Learn more about GitLens" href="https://gitlens.amod.io"><img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/gitlens-logo.png" alt="GitLens Logo" /></a>
</p>

> GitLens **supercharges** the Git capabilities built into Visual Studio Code. It helps you to **visualize code authorship** at a glance via Git blame annotations and code lens, **seamlessly navigate and explore** Git repositories, **gain valuable insights** via powerful comparison commands, and so much more.

## Support GitLens

| Sponsored by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <p align="center" style="font-size:10px;font-weight:400;margin:8px 0 8px 0;">[![](https://alt-images.codestream.com/codestream_logo_gitlens_vscmarket.png)](https://codestream.com/?utm_source=vscmarket&utm_medium=banner&utm_campaign=gitlens 'Try CodeStream')<br/>Discuss, review, and share code with your team in VS Code. Links discussions about code to your code. Integrates w/ Slack, Jira, Trello, and Live Share. **[Try it free](https://codestream.com/?utm_source=vscmarket&utm_medium=banner&utm_campaign=gitlens 'Try CodeStream')**</p> | <p align="center" style="font-size:10px;font-weight:400;margin:8px 0 8px 0;">[![](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/sponsors/cresus.png)](https://cresus.ch 'Visit Crésus')</p> |

While GitLens is generously offered to everyone free of charge, if you find it useful, please consider [**supporting**](https://gitlens.amod.io/#support-gitlens) it.

- [**Become a Sponsor**](https://www.patreon.com/eamodio 'Become a sponsor on Patreon') &mdash; join the growing group of generous [backers](https://github.com/eamodio/vscode-gitlens/blob/master/BACKERS.md)
- [**Donate via PayPal**](https://www.paypal.me/eamodio 'Donate via PayPal') or [**Donate via Cash App**](https://cash.me/$eamodio 'Donate via Cash App')

Also please [write a review](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#review-details 'Write a review'), [star me on GitHub](https://github.com/eamodio/vscode-gitlens 'Star me on GitHub'), and [follow me on Twitter](https://twitter.com/eamodio 'Follow me on Twitter')

# What's new in GitLens 9

- Adds GitLens over Visual Studio Live Share
- Adds a new [_Repositories_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#repositories-view- 'Jump to the Repositories view docs') to visualize, navigate, and explore Git repositories
- Adds a new [_File History_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#file-history-view- 'Jump to the File History view docs') to visualize, navigate, and explore the revision history of the current file
- Adds an all-new [_Line History_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#line-history-view- 'Jump to the Line History view docs') to visualize, navigate, and explore the revision history of the selected lines of current file
- Adds an all-new [_Search Commits_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#search-commits-view- 'Jump to the Search Commits view docs') to search and explore commit histories by message, author, files, id, etc
- Adds an all-new [_Compare_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#compare-view- 'Jump to the Compare view docs') to visualize comparisons between branches, tags, commits, and more
- And much more

See the [release notes](https://github.com/eamodio/vscode-gitlens/blob/master/CHANGELOG.md 'Open Release Notes') for the full set of changes

# GitLens

[GitLens](https://gitlens.amod.io 'Learn more about GitLens') is an [open-source](https://github.com/eamodio/vscode-gitlens 'Open GitLens on GitHub') extension for [Visual Studio Code](https://code.visualstudio.com) created by [Eric Amodio](https://www.amod.io 'Learn more about Eric').

GitLens simply helps you **better understand code**. Quickly glimpse into whom, why, and when a line or code block was changed. Jump back through history to **gain further insights** as to how and why the code evolved. Effortlessly explore the history and evolution of a codebase.

While GitLens is **powerful and feature rich**, it is also [highly customizable](#gitlens-settings- 'Jump to the GitLens settings docs') to meet your specific needs &mdash; find code lens intrusive or the current line blame annotation distracting &mdash; no problem, it is quick and easy to turn them off or change how they behave via the built-in [_GitLens Settings_ editor](#configuration 'Jump to Configuration'), an **interactive editor** covering many of GitLens' powerful settings. While for more advanced customizations, refer to the [GitLens settings docs](#gitlens-settings- 'Jump to the GitLens settings docs') and edit your vscode [user settings](https://code.visualstudio.com/docs/getstarted/settings 'Open User settings').

Here are just some of the **features** that GitLens provides,

- an unobtrusive [**current line blame**](#current-line-blame- 'Jump to the Current Line Blame') annotation at the end of the line with detailed blame information accessible via [**hovers**](#hovers- 'Jump to Hovers')
- on-demand [**gutter blame**](#gutter-blame- 'Jump to the Gutter Blame') annotations, including a heatmap, for the whole file
- [**authorship code lens**](#code-lens- 'Jump to the Code Lens') showing the most recent commit and # of authors to the top of files and/or on code blocks
- on-demand [**gutter heatmap**](#gutter-heatmap- 'Jump to the Gutter Heatmap') annotations to show how recently lines were changed, relative to all the other changes in the file and to now (hot vs. cold)
- on-demand [**recent changes**](#recent-changes- 'Jump to the Recent Changes') annotations to highlight lines changed by the most recent commit
- a [**status bar blame**](#status-bar-blame- 'Jump to the Status Bar Blame') annotation showing author and date for the current line
- many rich Side Bar views
  - a [**_Repositories_ view**](#repositories-view- 'Jump to the Repositories view') to visualize, navigate, and explore Git repositories
  - a [**_File History_ view**](#file-history-view- 'Jump to the File History view') to visualize, navigate, and explore the revision history of the current file
  - a [**_Line History_ view**](#line-history-view- 'Jump to the Line History view') to visualize, navigate, and explore the revision history of the selected lines of current file
  - a [**_Search Commits_ view**](#search-commits-view- 'Jump to the Search Commits view') to search and explore commit histories by message, author, files, id, etc
  - a [**_Compare_ view**](#compare-view- 'Jump to the Compare view') to visualize comparisons between branches, tags, commits, and more
- many [**powerful commands**](#navigate-and-explore- 'Jump to the Navigate and Explorer') for exploring commits and histories, comparing and navigating revisions, stash access, repository status, etc
- user-defined [**modes**](#modes- 'Jump to the Modes') for quickly toggling between sets of settings
- and so much [**more**](#and-more- 'Jump to More')

<p align="center">
  <br />
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/gitlens-preview.gif" alt="GitLens Preview" />
  <br />
</p>

# Configuration

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/settings.png" alt="GitLens Interactive Settings" />
</p>

GitLens has a built-in **interactive settings editor** which provides an easy-to-use interface to configure many of GitLens' powerful features. It can be accessed via the _Open Settings_ (`gitlens.showSettingsPage`) command from the [_Command Palette_](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette).

For more advanced customizations, refer to the [settings documentation](#gitlens-settings- 'Jump to the GitLens settings docs') below.

# Features

### Current Line Blame [#](#current-line-blame- 'Current Line Blame')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/current-line-blame.png" alt="Current Line Blame" />
</p>

- Adds an unobtrusive, [customizable](#current-line-blame-settings- 'Jump to the Current Line Blame settings'), and [themable](#themable-colors- 'Jump to the Themable Colors'), **blame annotation** at the end of the current line
  - Contains the author, date, and message of the current line's most recent commit (by [default](#current-line-blame-settings- 'Jump to the Current Line Blame settings'))
  - Adds a _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`) to toggle the blame annotation on and off

---

### Gutter Blame [#](#gutter-blame- 'Gutter Blame')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/gutter-blame.png" alt="Gutter Blame">
</p>

- Adds on-demand, [customizable](#gutter-blame-settings- 'Jump to the Gutter Blame settings'), and [themable](#themable-colors- 'Jump to the Themable Colors'), **gutter blame annotations** for the whole file
  - Contains the commit message and date, by [default](#gutter-blame-settings- 'Jump to the Gutter Blame settings')
  - Adds a **heatmap** (age) indicator on right edge (by [default](#gutter-blame-settings- 'Jump to the Gutter Blame settings')) of the gutter to provide an easy, at-a-glance way to tell how recently lines were changed ([optional](#gutter-blame-settings- 'Jump to the Gutter Blame settings'), on by default)
    - See the [gutter heatmap](#gutter-Heatmap- 'Jump to the Gutter Heatmap') section below for more details
  - Adds a _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) with a shortcut of `alt+b` to toggle the blame annotations on and off
  - Press `Escape` to turn off the annotations

---

### Hovers [#](#hovers- 'Hovers')

#### Current Line Hovers

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/hovers-current-line.png" alt="Current Line Hovers" />
</p>

- Adds [customizable](#hover-settings- 'Jump to the Hover settings') Git blame hovers accessible over the current line

##### Details Hover

  <p align="center">
    <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/hovers-current-line-details.png" alt="Current Line Details Hover" />
  </p>

- Adds a **details hover** annotation to the current line to show more commit details ([optional](#hover-settings- 'Jump to the Hover settings'), on by default)
  - Provides **automatic issue linking** to Bitbucket, GitHub, GitLab, and Azure DevOps in commit messages
  - Provides a **quick-access command bar** with _Open Changes_, _Blame Previous Revision_, _Open on Remote_, _Invite to Live Share_ (if available), and _Show More Actions_ command buttons
  - Click the commit id to execute the _Show Commit Details_ command

##### Changes (diff) Hover

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/hovers-current-line-changes.png" alt="Current Line Changes (diff) Hover" />
</p>

- Adds a **changes (diff) hover** annotation to the current line to show the line's previous version ([optional](#hover-settings- 'Jump to the Hover settings'), on by default)
  - Click the **Changes** to execute the _Open Changes_ command
  - Click the current and previous commit ids to execute the _Show Commit Details_ command

#### Annotation Hovers

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/hovers-annotations.png" alt="Annotation Hovers" />
</p>

- Adds [customizable](#hover-settings- 'Jump to the Hover settings') Git blame hovers accessible when annotating

##### Details Hover

  <p align="center">
    <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/hovers-annotations-details.png" alt="Annotations Details Hover" />
  </p>

- Adds a **details hover** annotation to each line while annotating to show more commit details ([optional](#hover-settings- 'Jump to the Hover settings'), on by default)
  - Provides **automatic issue linking** to Bitbucket, GitHub, GitLab, and Azure DevOps in commit messages
  - Provides a **quick-access command bar** with _Open Changes_, _Blame Previous Revision_, _Open on Remote_, _Invite to Live Share_ (if available), and _Show More Actions_ command buttons
  - Click the commit id to execute the _Show Commit Details_ command

##### Changes (diff) Hover

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/hovers-annotations-changes.png" alt="Annotations Changes (diff) Hover" />
</p>

- Adds a **changes (diff) hover** annotation to each line while annotating to show the line's previous version ([optional](#hover-settings- 'Jump to the Hover settings'), on by default)
  - Click the **Changes** to execute the _Open Changes_ command
  - Click the current and previous commit ids to execute the _Show Commit Details_ command

---

### Code Lens [#](#code-lens- 'Code Lens')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/code-lens.png" alt="Code Lens" />
</p>

- Adds Git authorship **code lens** to the top of the file and on code blocks ([optional](#code-lens-settings- 'Jump to the Code Lens settings'), on by default)

  - **Recent Change** &mdash; author and date of the most recent commit for the file or code block
    - Click the code lens to show a **commit file details quick pick menu** with commands for comparing, navigating and exploring commits, and more (by [default](#code-lens-settings- 'Jump to the Code Lens settings'))
  - **Authors** &mdash; number of authors of the file or code block and the most prominent author (if there is more than one)

    - Click the code lens to toggle the file Git blame annotations on and off of the whole file (by [default](#code-lens-settings- 'Jump to the Code Lens settings'))
    - Will be hidden if the author of the most recent commit is also the only author of the file or block, to avoid duplicate information and reduce visual noise

  - Provides [customizable](#code-lens-settings- 'Jump to the Code Lens settings') click behavior for each code lens &mdash; choose between one of the following
    - Toggle file blame annotations on and off
    - Compare the commit with the previous commit
    - Show a quick pick menu with details and commands for the commit
    - Show a quick pick menu with file details and commands for the commit
    - Show a quick pick menu with the commit history of the file
    - Show a quick pick menu with the commit history of the current branch

- Adds a _Toggle Git Code Lens_ command (`gitlens.toggleCodeLens`) with a shortcut of `shift+alt+b` to toggle the code lens on and off

---

### Gutter Heatmap [#](#gutter-heatmap- 'Gutter Heatmap')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/heatmap.png" alt="Gutter Heatmap" />
</p>

- Adds an on-demand **heatmap** to the edge of the gutter to show how recently lines were changed
  - The indicator's [customizable](#gutter-heatmap-settings- 'Jump to the Gutter Heatmap settings') color will either be hot or cold based on the age of the most recent change (cold after 90 days by [default](#gutter-heatmap-settings- 'Jump to the Gutter Heatmap settings'))
  - The indicator's brightness ranges from bright (newer) to dim (older) based on the relative age, which is calculated from the median age of all the changes in the file
  - Adds _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`) to toggle the heatmap on and off
  - Press `Escape` to turn off the annotations

---

### Recent Changes [#](#recent-changes- 'Recent Changes')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/recent-changes.png" alt="Recent Changes" />
</p>

- Adds an on-demand, [customizable](#recent-changes-settings- 'Jump to the Recent Changes settings') and [themable](#themable-colors- 'Jump to the Themable Colors'), **recent changes annotation** to highlight lines changed by the most recent commit
  - Adds _Toggle Recent File Changes Annotations_ command (`gitlens.toggleFileRecentChanges`) to toggle the recent changes annotations on and off
  - Press `Escape` to turn off the annotations

---

### Status Bar Blame [#](#status-bar-blame- 'Status Bar Blame')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/status-bar.png" alt="Status Bar Blame" />
</p>

- Adds a [customizable](#status-bar-settings- 'Jump to the Status Bar Blame settings') **Git blame annotation** about the current line to the **status bar** ([optional](#status-bar-settings- 'Jump to the Status Bar Blame settings'), on by default)

  - Contains the commit author and date (by [default](#status-bar-settings- 'Jump to the Status Bar Blame settings'))
  - Click the status bar item to show a **commit details quick pick menu** with commands for comparing, navigating and exploring commits, and more (by [default](#status-bar-settings- 'Jump to the Status Bar Blame settings'))

  - Provides [customizable](#status-bar-settings- 'Jump to the Status Bar Blame settings') click behavior &mdash; choose between one of the following
    - Toggle file blame annotations on and off
    - Toggle code lens on and off
    - Compare the line commit with the previous commit
    - Compare the line commit with the working tree
    - Show a quick pick menu with details and commands for the commit (default)
    - Show a quick pick menu with file details and commands for the commit
    - Show a quick pick menu with the commit history of the file
    - Show a quick pick menu with the commit history of the current branch

---

## Side Bar Views

### Repositories view [#](#repositories-view- 'Repositories view')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-repositories.png" alt="Repositories view" />
</p>

A [customizable](#repositories-view-settings- 'Jump to the Repositories view settings') view to visualize, navigate, and explore Git repositories

- A toolbar provides quick access to the _Push Repositories_, _Pull Repositories_, _Fetch Repositories_, and _Refresh_ commands
  - A context menu provides _Automatic Layout_, _List Layout_, _Tree Layout_, _Enable Automatic Refresh_ or _Disable Automatic Refresh_, _Open Settings_ commands

The repositories view provides the following features,

- **Repositories** &mdash; lists the opened repositories

  - Provides the name of each repository, the name of its current branch, [optionally](#repositories-view-settings- 'Jump to the Repositories view settings') its working tree status, and when it was last fetched
    - Indicator dots on each repository icon denote the following:
      - _None_ &mdash; no upstream or up-to-date with the upstream
      - _Green_ &mdash; ahead of the upstream
      - _Red_ &mdash; behind the upstream
      - _Yellow_ &mdash; both ahead of and behind the upstream
    - An inline toolbar provides quick access to the _Add to Favorites_ (when applicable), _Remove from Favorites_ (when applicable), _Search Commits_, _Push_ (`alt-click` for _Push (force)_), _Pull_, and _Fetch_ commands
    - A context menu provides access to more common repository commands
    - **Current Branch** &mdash; lists the revision (commit) history of the current branch and [optionally](#repositories-view-settings- 'Jump to the Repositories view settings') shows its remote tracking branch and status (if available)
      - An inline toolbar provides quick access to the _Compare with Remote_ (if available), _Compare with Working Tree_, and _Open Branch on Remote_ (if available) commands
      - A context menu provides access to more common branch commands
    - **\* Commits Behind** &mdash; quickly see and explore the specific commits behind the upstream (i.e. commits that haven't been pulled)
      - Only provided if the current branch is tracking a remote branch and is behind it
      - An inline toolbar provides quick access to the _Pull_ command
    - **\* Commits Ahead** &mdash; quickly see and explore the specific commits ahead of the upstream (i.e. commits that haven't been pushed)
      - Only provided if the current branch is tracking a remote branch and is ahead of it
      - An inline toolbar provides quick access to the _Push_ (`alt-click` for _Push (force)_) command
    - **\* Files Changed** &mdash; lists all the "working" changes
      - Expands to a file-based view of all changed files in the working tree ([optionally](#repositories-view-settings- 'Jump to the Repositories view settings')) and/or all files in all commits ahead of the upstream
      - An inline toolbar provides quick access to the _Stash All Changes_ command

- **Branches** &mdash; lists the local branches in the repository

  - An inline toolbar provides quick access to the _Open Branches on Remote_ (if available) command
  - Provides the name of each branch, an indicator (check-mark) of the branch is the current one, and [optionally](#repositories-view-settings- 'Jump to the Repositories view settings') shows its remote tracking branch and status (if available)
    - Indicator dots on each branch icon denote the following:
      - _None_ &mdash; no upstream or up-to-date with the upstream
      - _Green_ &mdash; ahead of the upstream
      - _Red_ &mdash; behind the upstream
      - _Yellow_ &mdash; both ahead of and behind the upstream
    - An inline toolbar provides quick access to the _Add to Favorites_ (when applicable), _Remove from Favorites_ (when applicable), _Checkout_, _Compare with Remote_ (if available), _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), and _Open Branch on Remote_ (if available) commands
    - A context menu provides access to more common branch commands
    - Each branch expands to list its revision (commit) history
      - **\* Commits Behind** &mdash; quickly see and explore the specific commits behind the upstream (i.e. commits that haven't been pulled)
        - Only provided if the current branch is tracking a remote branch and is behind it
      - **\* Commits Ahead** &mdash; quickly see and explore the specific commits ahead of the upstream (i.e. commits that haven't been pushed)
        - Only provided if the current branch is tracking a remote branch and is ahead of it
      - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
      - A context menu provides access to more common revision (commit) commands
      - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
        - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
        - A context menu provides access to more common file revision commands

- **Contributors** &mdash; lists the contributors in the repository, sorted by contributed commits

  - Provides the avatar (if enabled), name, and email address of each contributor
    - An inline toolbar provides quick access to the _Copy to Clipboard_ command
    - A context menu provides access to the _Copy to Clipboard_, _Add as Co-author_, and _Refresh_ commands
    - Each contributor expands to list the repository's revision (commit) history filtered by the contributor
      - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
      - A context menu provides access to more common revision (commit) commands
      - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
        - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
        - A context menu provides access to more common file revision commands

- **Remotes** &mdash; lists the remotes in the repository

  - Provides the name of each remote, an indicator of the direction of the remote (fetch, push, both), remote service (if applicable), and repository path
    - An inline toolbar provides quick access to the _Fetch_, and _Open Repository on Remote_ (if available) commands
    - A context menu provides access to more common repository and remote commands
    - Each remote expands to list its remote branches
      - See the **Branches** above for additional details

- **Stashes** &mdash; lists the stashed changes in the repository

  - An inline toolbar provides quick access to the _Stash All Changes_, and _Apply Stash Changes_ commands
  - Provides the name of each stashed changes, the date, and an indicator (+x ~x -x) of the changes
    - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Apply Stashed Changes_, and _Delete Stashed Changes_ commands
    - A context menu provides access to more common stashed changes commands
    - Each stashed changes expands to list the set of stashed files, complete with status indicators for adds, changes, renames, and deletes
      - An inline toolbar provides quick access to the _Open File_, and _Open File on Remote_ (if available) commands
      - A context menu provides access to more common file revision commands

- **Tags** &mdash; lists the tags in the repository

  - Provides the name of each tag
    - An inline toolbar provides quick access to the _Checkout, and \_Compare with HEAD_ (`alt-click` for _Compare with Working Tree_) commands
    - A context menu provides access to more common tag commands
    - Each tags expands to list its revision (commit) history
      - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
      - A context menu provides access to more common revision (commit) commands
      - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
        - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
        - A context menu provides access to more common file revision commands

---

### File History view [#](#file-history-view- 'File History view')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-file-history.png" alt="File History view" />
</p>

A [customizable](#file-history-view-settings- 'Jump to the File History view settings') view to visualize, navigate, and explore the revision history of the current file

- A toolbar provides quick access to the _Pause File Tracking_ or _Resume File Tracking_, _Change Base..._, and _Refresh_ commands
- A context menu provides the _Follow Renames_ or _Don't Follow Renames_, and _Open Settings_ commands

The file history view provides the following features,

- Automatically tracks the current editor and lists the revision (commit) history of the current file
- An inline toolbar provides quick access to the _Open File_, and _Open File on Remote_ (if available) commands
- A context menu provides _Open File_, _Open File on Remote_ (if available), _Copy Remote Url to Clipboard_ (if available), and _Refresh_ commands
- Provides the message, author, and date of each revision (commit) &mdash; fully [customizable](#view-settings- 'Jump to the View settings')
  - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
  - A context menu provides access to more common revision (commit) commands
  - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
    - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
    - A context menu provides access to more common file revision commands

---

### Line History view [#](#line-history-view- 'Line History view')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-line-history.png" alt="Line History view" />
</p>

A [customizable](#line-history-view-settings- 'Jump to the Line History view settings') view to visualize, navigate, and explore the revision history of the selected lines of current file

- A toolbar provides quick access to the _Pause File Tracking_ or _Resume File Tracking_, _Change Base..._, and _Refresh_ commands
- A context menu provides the _Follow Renames_ or _Don't Follow Renames_, and _Open Settings_ commands

The line history view provides the following features,

- Automatically tracks the current editor selection and lists the revision (commit) history of the selection in current file
- An inline toolbar provides quick access to the _Open File_, and _Open File on Remote_ (if available) commands
- A context menu provides _Open File_, _Open File on Remote_ (if available), _Copy Remote Url to Clipboard_ (if available), and _Refresh_ commands
- Provides the message, author, and date of each revision (commit) &mdash; fully [customizable](#view-settings- 'Jump to the View settings')
  - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
  - A context menu provides access to more common revision (commit) commands
  - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
    - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
    - A context menu provides access to more common file revision commands

---

### Search Commits view [#](#search-commits-view- 'Search Commits view')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-search.png" alt="Search Commits view" />
</p>

A [customizable](#search-commits-view-settings- 'Jump to the Search Commits view settings') view to search and explore commit histories by message, author, files, id, etc

- A toolbar provides quick access to the _Search Commits_, _Keep Results_, _Clear Results_, and _Refresh_ commands
- A context menu provides _Automatic Layout_, _List Layout_, _Tree Layout_, _Open Settings_ commands
- Use the _Search Commits_ command (`gitlens.showCommitSearch`) with a shortcut of `alt+/` to search for commits
  - by message &mdash; use `<message>` to search for commits with messages that match `<message>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt---grepltpatterngt 'Open Git docs')
  - or, by author &mdash; use `@<pattern>` to search for commits with authors that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt---authorltpatterngt 'Open Git docs')
  - or, by commit id &mdash; use `#<sha>` to search for a commit with id of `<sha>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt-ltrevisionrangegt 'Open Git docs')
  - or, by files &mdash; use `:<path/glob>` to search for commits with file names that match `<path/glob>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt---ltpathgt82308203 'Open Git docs')
  - or, by changes &mdash; use `~<pattern>` to search for commits with differences whose patch text contains added/removed lines that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt--Gltregexgt 'Open Git docs')

The search commits view provides the following features,

- Provides a semi-persistent results view for searching and exploring commit histories
  - An inline toolbar provides quick access to the _Dismiss_ command
  - A context menu provides access to common search commands
  - Provides the message, author, date, and change indicator of each revision (commit) &mdash; fully [customizable](#view-settings- 'Jump to the View settings')
    - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
    - A context menu provides access to more common revision (commit) commands
    - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
      - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
      - A context menu provides access to more common file revision commands
  - Results can be provided by the following commands
    - _Search Commits_ command (`gitlens.showCommitSearch`)
    - _Show File History_ command (`gitlens.showQuickFileHistory`)
    - _Show Commit Details_ command (`gitlens.showQuickCommitDetails`)

---

### Compare view [#](#compare-view- 'Compare view')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-compare.png" alt="Compare view" />
</p>

A [customizable](#compare-view-settings- 'Jump to the Compare view settings') view to visualize comparisons between branches, tags, commits, and more

- A toolbar provides quick access to the _Compare with..._, _Keep Results_, _Clear Results_, and _Refresh_ commands
- A context menu provides _Automatic Layout_, _List Layout_, _Tree Layout_, _Open Settings_ commands

The compare view provides the following features,

- Provides a semi-persistent results view for comparison operations
  - An inline toolbar provides quick access to the _Swap Comparison_, _Pin Comparison_ (when applicable), _Unpin Comparison_ (when applicable), _Refresh_, and _Dismiss_ commands
  - A context menu provides access to common comparison commands
  - **\* Commits** &mdash; lists the commits between the compared revisions (branches or commits)
    - Expands to provide the message, author, date, and change indicator of each revision (commit) &mdash; fully [customizable](#view-settings- 'Jump to the View settings')
      - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
        - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
        - A context menu provides access to more common file revision commands
  - **\* Files Changed** &mdash; lists all of the files changed between the compared revisions (branches or commits)
    - Expands to a file-based view of all changed files in the working tree ([optionally](#compare-view-settings- 'Jump to the Compare view settings')) and/or all files in all commits ahead of the upstream
  - Results can be provided by the following commands
    - _Compare with Remote_ command (`gitlens.views.compareWithRemote`)
    - _Compare with HEAD_ command (`gitlens.views.compareWithHead`)
    - _Compare with Working Tree_ command (`gitlens.views.compareWithWorking`)
    - _Compare with Selected_ command (`gitlens.views.compareWithSelected`)
    - _Compare Ancestry with Working Tree_ command (`gitlens.views.compareAncestryWithWorking`)

---

### Modes [#](#modes- 'Modes')

- GitLens supports [user-defined](#modes-settings- 'Jump to the Modes settings') modes for quickly toggling between sets of settings
  - Adds _Switch Mode_ command (`gitlens.switchMode`) to quickly switch the active mode
  - Adds a built-in _Zen_ mode which for a zen-like experience, disables many visual features
    - Adds _Toggle Zen Mode_ command (`gitlens.toggleZenMode`) to toggle Zen mode
  - Adds a built-in _Review_ mode which for reviewing code, enables many visual features
    - Adds _Toggle Review Mode_ command (`gitlens.toggleReviewMode`) to toggle Review mode
  - Adds the active mode to the **status bar** ([optional](#modes-settings- 'Jump to the Modes settings'), on by default)

---

### Navigate and Explore [#](#navigate-and-explore- 'Navigate and Explore')

- Adds a _Show Last Opened Quick Pick_ command (`gitlens.showLastQuickPick`) with a shortcut of `alt+-` to quickly get back to where you were when the last GitLens quick pick menu closed

- Adds commands to Open files, commits, branches, and the repository on the supported remote services, **Bitbucket, GitHub, GitLab, and Azure DevOps** or a [**user-defined** remote services](#custom-remotes-settings 'Jump to Custom Remotes settings') &mdash; only available if a Git upstream service is configured in the repository
  - Also supports [remote services with custom domains](#custom-remotes-settings 'Jump to Custom Remotes settings'), such as **Bitbucket, Bitbucket Server (previously called Stash), GitHub, GitHub Enterprise, GitLab**
  - _Open Branches on Remote_ command (`gitlens.openBranchesInRemote`) &mdash; opens the branches on the supported remote service
  - _Open Branch on Remote_ command (`gitlens.openBranchInRemote`) &mdash; opens the current branch commits on the supported remote service
  - _Open Commit on Remote_ command (`gitlens.openCommitInRemote`) &mdash; opens the commit revision of the current line on the supported remote service
  - _Open File on Remote_ command (`gitlens.openFileInRemote`) &mdash; opens the current file/revision on the supported remote service
  - _Open Repository on Remote_ command (`gitlens.openRepoInRemote`) &mdash; opens the repository on the supported remote service

#### Branch History

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-branch-history.png" alt="Branch History Quick Pick Menu" />
</p>

- Adds a _Show Current Branch History_ command (`gitlens.showQuickRepoHistory`) with a shortcut of `shift+alt+h` to show a paged **branch history quick pick menu** of the current branch for exploring its commit history

  - Provides entries to _Show Commit Search_ and _Open Branch on \<remote-service\>_ (if available)
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

- Adds a _Show Branch History_ command (`gitlens.showQuickBranchHistory`) to show a paged **branch history quick pick menu** of the selected branch for exploring its commit history
  - Provides the same features as _Show Current Branch History_ above

#### File History

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-file-history.png" alt="File History Quick Pick Menu" />
</p>

- Adds a _Show File History_ command (`gitlens.showQuickFileHistory`) to show a paged **file history quick pick menu** of the current file for exploring its commit history
  - Provides additional entries to _Show in View_, _Show Branch History_, and _Open File on \<remote-service\>_ (if available)
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

#### Commit Details

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-commit-details.png" alt="Commit Details Quick Pick Menu" />
</p>

- Adds a _Show Commit Details_ command (`gitlens.showQuickCommitDetails`) to show a **commit details quick pick menu** of the most recent commit of the current file
  - Quickly see the set of files changed in the commit, complete with status indicators for adds, changes, renames, and deletes
  - Provides additional entries to _Show in View_, _Open Commit on \<remote-service\>_ (if available), _Open Files_, _Open Revisions_, _Open Directory Compare with Previous Revision_, _Open Directory Compare with Working Tree_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings- 'Jump to Advanced settings') is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the comparison of the current revision with the previous one

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-commit-file-details.png" alt="Commit File Details Quick Pick Menu" />
</p>

- Adds a _Show Commit File Details_ command (`gitlens.showQuickCommitFileDetails`) with a shortcut of `alt+c` to show a **file commit details quick pick menu** of the most recent commit of the current file
  - Provides entries to _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on \<remote-service\>_ (if available), _Open Revision on \<remote-service\>_ (if available), _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Show File History_, and _Show Previous File History_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings- 'Jump to Advanced settings') is set

#### Repository Status

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-repo-status.png" alt="Repository Status Quick Pick Menu" />
</p>

- Adds a _Show Repository Status_ command (`gitlens.showQuickRepoStatus`) with a shortcut of `alt+s` to show a **repository status quick pick menu** for visualizing the current repository status
  - Quickly see upstream status (if an Git upstream is configured) &mdash; complete with ahead and behind information
    - If you are ahead of the upstream, an entry will be shown with the number of commits ahead. Choosing it will show a limited **branch history quick pick menu** containing just the commits ahead of the upstream
    - If you are behind the upstream, an entry will be shown with the number of commits behind. Choosing it will show a limited **branch history quick pick menu** containing just the commits behind the upstream
  - Quickly see all working changes, both staged and unstaged, complete with status indicators for adds, changes, renames, and deletes
  - Provides entries to _Show Stashed Changes_, _Open Changed Files_, and _Close Unchanged Files_
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings- 'Jump to Advanced settings') is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Staged Files` or `Unstaged Files` sections to preview the comparison of the working file with the previous revision

#### Stashes

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-stash-list.png" alt="Stashed Changes Quick Pick Menu" />
</p>

- Adds a _Show Stashed Changes_ command (`gitlens.showQuickStashList`) to show a **stashed changes quick pick menu** for exploring your repository stash history

  - Provides additional entries to _Stash All Changes_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available

- Adds a _Stash All Changes_ command (`gitlens.stashSave`) to save any working tree changes to the stash &mdash; can optionally provide a stash message
  - Also adds the command to the Source Control items context menu to stash an individual or group of files, works with multi-select too!

#### Stash Details

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/menu-stash-details.png" alt="Stash Details Quick Pick Menu" />
</p>

- Stashed changes show a **stash details quick pick menu** which is very similar to the **commit details quick pick menu** above

  - Quickly see the set of files changed in the stash, complete with status indicators for adds, changes, renames, and deletes
  - Provides additional entries to _Apply Stashed Changes_ (requires confirmation), _Delete Stashed Changes_ (requires confirmation), _Open Files_, _Open Revisions_, _Open Directory Compare with Previous Revision_, _Open Directory Compare with Working Tree_, _Copy Commit Message to Clipboard_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings- 'Jump to Advanced settings') is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the comparison of the current revision with the previous one

- Adds an _Apply Stashed Changes_ command (`gitlens.stashApply`) to chose a stash entry to apply to the working tree from a quick pick menu

---

### And More [#](#and-more- 'More features')

#### Powerful Comparison Tools

- Effortlessly navigate between comparisons via the `alt+,` and `alt+.` shortcut keys to go back and forth through a file's revisions

- Provides easy access to the following comparison commands via the `Command Palette` as well as in context via the many provided quick pick menus

- Adds a _Directory Compare Working Tree with..._ command (`gitlens.diffDirectory`) to open the configured Git difftool to compare the working tree with the selected reference

- Adds a _Compare HEAD with..._ command (`gitlens.diffHeadWith`) to compare the index (HEAD) with the selected reference

- Adds a _Compare Working Tree with..._ command (`gitlens.diffWorkingWith`) to compare the working tree with the selected reference

- Adds an _Open Changes with..._ command (`gitlens.diffWithRef`) to compare the current file with the same file on the selected reference

- Adds an _Open Changes with Next Revision_ command (`gitlens.diffWithNext`) with a shortcut of `alt+.` to compare the current file/diff with the next commit revision

- Adds an _Open Changes with Previous Revision_ command (`gitlens.diffWithPrevious`) with a shortcut of `alt+,` to compare the current file/diff with the previous commit revision

- Adds an _Open Line Changes with Previous Revision_ command (`gitlens.diffLineWithPrevious`) with a shortcut of `shift+alt+,` to compare the current file/diff with the previous line commit revision

- Adds an _Open Changes with Revision..._ command (`gitlens.diffWithRevision`) to compare the current file with the selected revision of the same file

- Adds an _Open Changes with Working File_ command (`gitlens.diffWithWorking`) with a shortcut of `shift+alt+w` to compare the most recent commit revision of the current file/diff with the working tree

- Adds an _Open Line Changes with Working File_ command (`gitlens.diffLineWithWorking`) with a shortcut of `alt+w` to compare the commit revision of the current line with the working tree

#### Other Commands (not a complete list)

- Adds a _Copy Commit ID to Clipboard_ command (`gitlens.copyShaToClipboard`) to copy the commit id (sha) of the current line to the clipboard or from the most recent commit to the current branch, if there is no current editor

- Adds a _Copy Commit Message to Clipboard_ command (`gitlens.copyMessageToClipboard`) to copy the commit message of the current line to the clipboard or from the most recent commit to the current branch, if there is no current editor

- Adds a _Copy Remote Url to Clipboard_ command (`gitlens.copyRemoteFileUrlToClipboard`) to copy the remote url of the current file and line to the clipboard

- Adds an _Open Working File"_ command (`gitlens.openWorkingFile`) to open the working file for the current file revision

- Adds an _Open Revision..._ command (`gitlens.openFileRevision`) to open the selected revision for the current file

- Adds an _Open Revision from..._ command (`gitlens.openFileRevisionFrom`) to open the revision of the current file from the selected reference

- Adds an _Open Changes (with difftool)_ command (`gitlens.externalDiff`) to the source control group and source control resource context menus to open the changes of a file or set of files with the configured git difftool

- Adds an _Open All Changes (with difftool)_ command (`gitlens.externalDiffAll`) to open all working changes with the configured git difftool

  - Also adds the command to the Source Control group context menu

- Adds an _Directory Compare All Changes_ command (`gitlens.diffDirectoryWithHead`) to the source control groups to open the configured Git difftool to compare the working tree with HEAD

- Adds a _Open Changed Files_ command (`gitlens.openChangedFiles`) to open any files with working tree changes

- Adds a _Close Unchanged Files_ command (`gitlens.closeUnchangedFiles`) to close any files without working tree changes

---

## GitLens Settings [#](#gitlens-settings- 'GitLens Settings')

GitLens is highly customizable and provides many configuration settings to allow the personalization of almost all features.

### General Settings [#](#general-settings- 'General Settings')

| Name                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.defaultDateFormat`          | Specifies how absolute dates will be formatted by default. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                                                                                                                                                                                                                                                     |
| `gitlens.defaultDateShortFormat`     | Specifies how short absolute dates will be formatted by default. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                                                                                                                                                                                                                                               |
| `gitlens.defaultDateStyle`           | Specifies how dates will be displayed by default                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gitlens.defaultDateSource`          | Specifies whether commit dates should use the authored or committed date                                                                                                                                                                                                                                                                                                                                                                                  |
| `gitlens.defaultGravatarsStyle`      | Specifies the style of the gravatar default (fallback) images<br /><br />`identicon` - a geometric pattern<br />`mm` - a simple, cartoon-style silhouetted outline of a person (does not vary by email hash)<br />`monsterid` - a monster with different colors, faces, etc<br />`retro` - 8-bit arcade-style pixelated faces<br />`robohash` - a robot with different colors, faces, etc<br />`wavatar` - a face with differing features and backgrounds |
| `gitlens.insiders`                   | Specifies whether to enable experimental features                                                                                                                                                                                                                                                                                                                                                                                                         |
| `gitlens.keymap`                     | Specifies the keymap to use for GitLens shortcut keys<br /><br />`alternate` - adds an alternate set of shortcut keys that start with `Alt` (&#x2325; on macOS)<br />`chorded` - adds a chorded set of shortcut keys that start with `Ctrl+Shift+G` (<code>&#x2325;&#x2318;G</code> on macOS)<br />`none` - no shortcut keys will be added                                                                                                                |
| `gitlens.liveshare.allowGuestAccess` | Specifies whether to allow guest access to GitLens features when using Visual Studio Live Share                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.menus`                      | Specifies which commands will be added to which menus                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.outputLevel`                | Specifies how much (if any) output will be sent to the GitLens output channel                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.settings.mode`              | Specifies the display mode of the interactive settings editor<br /><br />`simple` - only displays common settings<br />`advanced` - displays all settings                                                                                                                                                                                                                                                                                                 |
| `gitlens.showWhatsNewAfterUpgrades`  | Specifies whether to show What's New after upgrading to new feature releases                                                                                                                                                                                                                                                                                                                                                                              |

### Current Line Blame Settings [#](#current-line-blame-settings- 'Current Line Blame Settings')

| Name                             | Description                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.currentLine.dateFormat` | Specifies how to format absolute dates (e.g. using the `${date}` token) for the current line blame annotations. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                          |
| `gitlens.currentLine.enabled`    | Specifies whether to provide a blame annotation for the current line, by default. Use the _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`) to toggle the annotations on and off for the current window                                           |
| `gitlens.currentLine.format`     | Specifies the format of the current line blame annotation. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs. Date formatting is controlled by the `gitlens.currentLine.dateFormat` setting |
| `gitlens.currentLine.scrollable` | Specifies whether the current line blame annotation can be scrolled into view when it is outside the viewport                                                                                                                                                       |

### Gutter Blame Settings [#](#gutter-blame-settings- 'Gutter Blame Settings')

| Name                                | Description                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.blame.avatars`             | Specifies whether to show avatar images in the gutter blame annotations                                                                                                                                                                                                      |
| `gitlens.blame.compact`             | Specifies whether to compact (deduplicate) matching adjacent gutter blame annotations                                                                                                                                                                                        |
| `gitlens.blame.dateFormat`          | Specifies how to format absolute dates (e.g. using the `${date}` token) in gutter blame annotations. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                              |
| `gitlens.blame.format`              | Specifies the format of the gutter blame annotations. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs. Date formatting is controlled by the `gitlens.blame.dateFormat` setting                     |
| `gitlens.blame.heatmap.enabled`     | Specifies whether to provide a heatmap indicator in the gutter blame annotations                                                                                                                                                                                             |
| `gitlens.blame.heatmap.location`    | Specifies where the heatmap indicators will be shown in the gutter blame annotations<br /><br />`left` - adds a heatmap indicator on the left edge of the gutter blame annotations<br />`right` - adds a heatmap indicator on the right edge of the gutter blame annotations |
| `gitlens.blame.highlight.enabled`   | Specifies whether to highlight lines associated with the current line                                                                                                                                                                                                        |
| `gitlens.blame.highlight.locations` | Specifies where the associated line highlights will be shown<br /><br />`gutter` - adds a gutter glyph<br />`line` - adds a full-line highlight background color<br />`overview` - adds a decoration to the overview ruler (scroll bar)                                      |
| `gitlens.blame.ignoreWhitespace`    | Specifies whether to ignore whitespace when comparing revisions during blame operations                                                                                                                                                                                      |
| `gitlens.blame.separateLines`       | Specifies whether gutter blame annotations will have line separators                                                                                                                                                                                                         |
| `gitlens.blame.toggleMode`          | Specifies how the gutter blame annotations will be toggled<br /><br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                                                                                     |

### Hover Settings [#](#hover-settings- 'Hover Settings')

| Name                                   | Description                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.hovers.annotations.changes`   | Specifies whether to provide a _changes (diff)_ hover for all lines when showing blame annotations                                                                                                                             |
| `gitlens.hovers.annotations.details`   | Specifies whether to provide a _commit details_ hover for all lines when showing blame annotations                                                                                                                             |
| `gitlens.hovers.annotations.enabled`   | Specifies whether to provide any hovers when showing blame annotations                                                                                                                                                         |
| `gitlens.hovers.annotations.over`      | Specifies when to trigger hovers when showing blame annotations<br /><br />`annotation` - only shown when hovering over the line annotation<br />`line` - shown when hovering anywhere over the line                           |
| `gitlens.hovers.avatars`               | Specifies whether to show avatar images in hovers                                                                                                                                                                              |
| `gitlens.hovers.changesDiff`           | Specifies whether to show just the changes to the line or the set of related changes in the _changes (diff)_ hover<br /><br />`line` - Shows only the changes to the line<br /><br />`hunk` - Shows the set of related changes |
| `gitlens.hovers.currentLine.changes`   | Specifies whether to provide a _changes (diff)_ hover for the current line                                                                                                                                                     |
| `gitlens.hovers.currentLine.details`   | Specifies whether to provide a _commit details_ hover for the current line                                                                                                                                                     |
| `gitlens.hovers.currentLine.enabled`   | Specifies whether to provide any hovers for the current line                                                                                                                                                                   |
| `gitlens.hovers.currentLine.over`      | Specifies when to trigger hovers for the current line<br /><br />`annotation` - only shown when hovering over the line annotation<br />`line` - shown when hovering anywhere over the line                                     |
| `gitlens.hovers.enabled`               | Specifies whether to provide any hovers                                                                                                                                                                                        |
| `gitlens.hovers.detailsMarkdownFormat` | Specifies the format (in markdown) of the _commit details_ hover. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                                    |

### Code Lens Settings [#](#code-lens-settings- 'Code Lens Settings')

| Name                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.codeLens.authors.command`          | Specifies the command to be executed when an _authors_ code lens is clicked<br /><br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current committed file with the previous commit<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick      |
| `gitlens.codeLens.authors.enabled`          | Specifies whether to provide an _authors_ code lens, showing number of authors of the file or code block and the most prominent author (if there is more than one)                                                                                                                                                                                                                                                                                                                                                                                               |
| `gitlens.codeLens.enabled`                  | Specifies whether to provide any Git code lens, by default. Use the _Toggle Git Code Lens_ command (`gitlens.toggleCodeLens`) to toggle the Git code lens on and off for the current window                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.codeLens.includeSingleLineSymbols` | Specifies whether to provide any Git code lens on symbols that span only a single line                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.codeLens.recentChange.command`     | Specifies the command to be executed when a _recent change_ code lens is clicked<br /><br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current committed file with the previous commit<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick |
| `gitlens.codeLens.recentChange.enabled`     | Specifies whether to provide a _recent change_ code lens, showing the author and date of the most recent commit for the file or code block                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `gitlens.codeLens.scopes`                   | Specifies where Git code lens will be shown in the document<br /><br />`document` - adds code lens at the top of the document<br />`containers` - adds code lens at the start of container-like symbols (modules, classes, interfaces, etc)<br />`blocks` - adds code lens at the start of block-like symbols (functions, methods, etc) lines                                                                                                                                                                                                                    |
| `gitlens.codeLens.scopesByLanguage`         | Specifies where Git code lens will be shown in the document for the specified languages                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gitlens.codeLens.symbolScopes`             | Specifies a set of document symbols where Git code lens will or will not be shown in the document. Prefix with `!` to avoid providing a Git code lens for the symbol. Must be a member of [`SymbolKind`](https://code.visualstudio.com/docs/extensionAPI/vscode-api#_a-namesymbolkindaspan-classcodeitem-id660symbolkindspan)                                                                                                                                                                                                                                    |

### Gutter Heatmap Settings [#](#gutter-heatmap-settings- 'Gutter Heatmap Settings')

| Name                           | Description                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.heatmap.ageThreshold` | Specifies the age of the most recent change (in days) after which the gutter heatmap annotations will be cold rather than hot (i.e. will use `gitlens.heatmap.coldColor` instead of `gitlens.heatmap.hotColor`) |
| `gitlens.heatmap.coldColor`    | Specifies the base color of the gutter heatmap annotations when the most recent change is older (cold) than the `gitlens.heatmap.ageThreshold` value                                                            |
| `gitlens.heatmap.hotColor`     | Specifies the base color of the gutter heatmap annotations when the most recent change is newer (hot) than the `gitlens.heatmap.ageThreshold` value                                                             |
| `gitlens.heatmap.toggleMode`   | Specifies how the gutter heatmap annotations will be toggled<br /><br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                      |

### Recent Changes Settings [#](#recent-changes-settings- 'Recent Changes Settings')

| Name                                        | Description                                                                                                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.recentChanges.highlight.locations` | Specifies where the highlights of the recently changed lines will be shown<br /><br />`gutter` - adds a gutter glyph<br />`line` - adds a full-line highlight background color<br />`overview` - adds a decoration to the overview ruler (scroll bar) |
| `gitlens.recentChanges.toggleMode`          | Specifies how the recently changed lines annotations will be toggled<br /><br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                                                    |

### Status Bar Settings [#](#status-bar-settings- 'Status Bar Settings')

| Name                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.statusBar.alignment`     | Specifies the blame alignment in the status bar<br /><br />`left` - aligns to the left<br />`right` - aligns to the right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gitlens.statusBar.command`       | Specifies the command to be executed when the blame status bar item is clicked<br /><br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current line commit with the previous<br />`gitlens.diffWithWorking` - compares the current line commit with the working tree<br />`gitlens.toggleCodeLens` - toggles Git code lens<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick |
| `gitlens.statusBar.dateFormat`    | Specifies how to format absolute dates (e.g. using the `${date}` token) in the blame information in the status bar. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.statusBar.enabled`       | Specifies whether to provide blame information in the status bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.statusBar.format`        | Specifies the format of the blame information in the status bar. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs. Date formatting is controlled by the `gitlens.statusBar.dateFormat` setting                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `gitlens.statusBar.reduceFlicker` | Specifies whether to avoid clearing the previous blame information when changing lines to reduce status bar "flashing"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Repositories View Settings [#](#repositories-view-settings- 'Repositories View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                            | Description                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.repositories.avatars`            | Specifies whether to show avatar images instead of commit (or status) icons in the _Repositories_ view                                                                                                                                                                                                                                         |
| `gitlens.views.repositories.autoRefresh`        | Specifies whether to automatically refresh the _Repositories_ view when the repository or the file system changes                                                                                                                                                                                                                              |
| `gitlens.views.repositories.autoReveal`         | Specifies whether to automatically reveal repositories in the _Repositories_ view when opening files                                                                                                                                                                                                                                           |
| `gitlens.views.repositories.branches.layout`    | Specifies how the _Repositories_ view will display branches<br /><br />`list` - displays branches as a list<br />`tree` - displays branches as a tree when branch names contain slashes `/`                                                                                                                                                    |
| `gitlens.views.repositories.compact`            | Specifies whether to show the _Repositories_ view in a compact display density                                                                                                                                                                                                                                                                 |
| `gitlens.views.repositories.enabled`            | Specifies whether to show the _Repositories_ view                                                                                                                                                                                                                                                                                              |
| `gitlens.views.repositories.files.compact`      | Specifies whether to compact (flatten) unnecessary file nesting in the _Repositories_ view. Only applies when `gitlens.views.repositories.files.layout` is set to `tree` or `auto`                                                                                                                                                             |
| `gitlens.views.repositories.files.layout`       | Specifies how the _Repositories_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.repositories.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.repositories.files.threshold`    | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Repositories_ view. Only applies when `gitlens.views.repositories.files.layout` is set to `auto`                                                                                                               |
| `gitlens.views.repositories.includeWorkingTree` | Specifies whether to include working tree file status for each repository in the _Repositories_ view                                                                                                                                                                                                                                           |
| `gitlens.views.repositories.location`           | Specifies where to show the _Repositories_ view<br /><br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar                                                                                                                                           |
| `gitlens.views.repositories.showTrackingBranch` | Specifies whether to show the tracking branch when displaying local branches in the _Repositories_ view                                                                                                                                                                                                                                        |

### File History View Settings [#](#file-history-view-settings- 'File History View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                 | Description                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.fileHistory.avatars`  | Specifies whether to show avatar images instead of status icons in the _File History_ view                                                                                                           |
| `gitlens.views.fileHistory.enabled`  | Specifies whether to show the _File History_ view                                                                                                                                                    |
| `gitlens.views.fileHistory.location` | Specifies where to show the _File History_ view<br /><br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar |

### Line History View Settings [#](#line-history-view-settings- 'Line History View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                 | Description                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.lineHistory.avatars`  | Specifies whether to show avatar images instead of status icons in the _Line History_ view                                                                                                           |
| `gitlens.views.lineHistory.enabled`  | Specifies whether to show the _Line History_ view                                                                                                                                                    |
| `gitlens.views.lineHistory.location` | Specifies where to show the _Line History_ view<br /><br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar |

### Search View Settings [#](#search-view-settings- 'Search View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                    | Description                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.search.avatars`          | Specifies whether to show avatar images instead of commit (or status) icons in the _Search Commits_ view                                                                                                                                                                                                                              |
| `gitlens.views.search.files.compact`    | Specifies whether to compact (flatten) unnecessary file nesting in the _Search Commits_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `tree` or `auto`                                                                                                                                                   |
| `gitlens.views.search.enabled`          | Specifies whether to show the _Search Commits_ view                                                                                                                                                                                                                                                                                   |
| `gitlens.views.search.files.layout`     | Specifies how the _Search Commits_ view will display files<br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.compare.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.compare.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Search Commits_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `auto`                                                                                                     |
| `gitlens.views.search.location`         | Specifies where to show the _Search Commits_ view<br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar                                                                                                                                      |

### Compare View Settings [#](#compare-view-settings- 'Compare View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                    | Description                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.views.compare.avatars`         | Specifies whether to show avatar images instead of commit (or status) icons in the _Compare_ view                                                                                                                                                                                                                                    |
| `gitlens.views.compare.files.compact`   | Specifies whether to compact (flatten) unnecessary file nesting in the _Compare_ view. Only applies when `gitlens.views.compare.files.layout` is set to `tree` or `auto`                                                                                                                                                             |
| `gitlens.views.compare.enabled`         | Specifies whether to show the _Compare_ view                                                                                                                                                                                                                                                                                         |
| `gitlens.views.compare.files.layout`    | Specifies how the _Compare_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.compare.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.compare.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Compare_ view. Only applies when `gitlens.views.compare.files.layout` is set to `auto`                                                                                                               |
| `gitlens.views.compare.location`        | Specifies where to show the _Compare_ view<br /><br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar                                                                                                                                      |

### View Settings [#](#view-settings- 'View Settings')

| Name                                        | Description                                                                                                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.commitFileFormat`            | Specifies the format of a committed file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs                                      |
| `gitlens.views.commitFileDescriptionFormat` | Specifies the description format of a committed file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs                          |
| `gitlens.views.commitFormat`                | Specifies the format of committed changes in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                                 |
| `gitlens.views.commitDescriptionFormat`     | Specifies the description format of committed changes in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                     |
| `gitlens.views.defaultItemLimit`            | Specifies the default number of items to show in a view list. Use 0 to specify no limit                                                                                                                           |
| `gitlens.views.pageItemLimit`               | Specifies the number of items to show in a each page when paginating a view list. Use 0 to specify no limit                                                                                                       |
| `gitlens.views.showRelativeDateMarkers`     | Specifies whether to show relative date markers (_Less than a week ago_, _Over a week ago_, _Over a month ago_, etc) on revision (commit) histories in the views                                                  |
| `gitlens.views.stashFileFormat`             | Specifies the format of a stashed file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs                                        |
| `gitlens.views.stashFileDescriptionFormat`  | Specifies the description format of a stashed file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs                            |
| `gitlens.views.stashFormat`                 | Specifies the format of stashed changes in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                                   |
| `gitlens.views.stashDescriptionFormat`      | Specifies the description format of stashed changes in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                       |
| `gitlens.views.statusFileFormat`            | Specifies the format of the status of a working or committed file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs             |
| `gitlens.views.statusFileDescriptionFormat` | Specifies the description format of the status of a working or committed file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs |

### Modes Settings [#](#modes-settings- 'Modes Settings')

| Name                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.mode.active`              | Specifies the active GitLens mode, if any                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `gitlens.mode.statusBar.enabled`   | Specifies whether to provide the active GitLens mode in the status bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `gitlens.mode.statusBar.alignment` | Specifies the active GitLens mode alignment in the status bar<br /><br />`left` - aligns to the left<br />`right` - aligns to the right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `gitlens.modes`                    | Specifies the user-defined GitLens modes<br /><br />Example &mdash; adds heatmap annotations to the built-in _Reviewing_ mode<br />`"gitlens.modes": { "review": { "annotations": "heatmap" } }`<br /><br />Example &mdash; adds a new _Annotating_ mode with blame annotations<br />`"gitlens.modes": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"annotate": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"name": "Annotating",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"statusBarItemName": "Annotating",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"description": "for root cause analysis",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"annotations": "blame",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"codeLens": false,`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"currentLine": false,`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"hovers": true`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />`}` |

### Advanced Settings [#](#advanced-settings- 'Advanced Settings')

| Name                                            | Description                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.advanced.abbreviatedShaLength`         | Specifies the length of abbreviated commit ids (shas)                                                                                 |
| `gitlens.advanced.blame.customArguments`        | Specifies additional arguments to pass to the `git blame` command                                                                     |
| `gitlens.advanced.blame.delayAfterEdit`         | Specifies the time (in milliseconds) to wait before re-blaming an unsaved document after an edit. Use 0 to specify an infinite wait   |
| `gitlens.advanced.blame.sizeThresholdAfterEdit` | Specifies the maximum document size (in lines) allowed to be re-blamed after an edit while still unsaved. Use 0 to specify no maximum |
| `gitlens.advanced.caching.enabled`              | Specifies whether git output will be cached &mdash; changing the default is not recommended                                           |
| `gitlens.advanced.fileHistoryFollowsRenames`    | Specifies whether file histories will follow renames -- will affect how merge commits are shown in histories                          |
| `gitlens.advanced.maxListItems`                 | Specifies the maximum number of items to show in a list. Use 0 to specify no maximum                                                  |
| `gitlens.advanced.maxSearchItems`               | Specifies the maximum number of items to show in a search. Use 0 to specify no maximum                                                |
| `gitlens.advanced.messages`                     | Specifies which messages should be suppressed                                                                                         |
| `gitlens.advanced.quickPick.closeOnFocusOut`    | Specifies whether to close QuickPick menus when focus is lost                                                                         |
| `gitlens.advanced.repositorySearchDepth`        | Specifies how many folders deep to search for repositories                                                                            |
| `gitlens.advanced.similarityThreshold`          | Specifies the amount (percent) of similarity a deleted and added file pair must have to be considered a rename                        |
| `gitlens.advanced.telemetry.enabled`            | Specifies whether to enable GitLens telemetry (even if enabled still abides by the overall `telemetry.enableTelemetry` setting        |

#### Custom Remotes Settings

| Name              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.remotes` | Specifies user-defined remote (code-hosting) services or custom domains for built-in remote services<br /><br />Example:<br />`"gitlens.remotes": [{ "domain": "git.corporate-url.com", "type": "GitHub" }]`<br /><br />Example:<br />`"gitlens.remotes": [{`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"domain": "git.corporate-url.com",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"type": "Custom",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"name": "My Company",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"protocol": "https",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"urls": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"repository": "https://git.corporate-url.com/${repo}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branches": "https://git.corporate-url.com/${repo}/branches",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branch": "https://git.corporate-url.com/${repo}/commits/${branch}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"commit": "https://git.corporate-url.com/${repo}/commit/${id}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"file": "https://git.corporate-url.com/${repo}?path=${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInBranch": "https://git.corporate-url.com/${repo}/blob/${branch}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInCommit": "https://git.corporate-url.com/${repo}/blob/${id}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileLine": "#L${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileRange": "#L${start}-L${end}"`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}]`<br /><br />Example:<br />`"gitlens.remotes": [{`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"domain": "git.corporate-url.com",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"type": "Custom",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"name": "My Company",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"protocol": "https",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"urls": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"repository": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branches": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/branches",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branch": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/commits/${branch}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"commit": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/commit/${id}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"file": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}?path=${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInBranch": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/blob/${branch}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInCommit": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/blob/${id}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileLine": "#L${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileRange": "#L${start}-L${end}"`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}]` |

#### Strings Settings

| Name                                                             | Description                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.strings.codeLens.unsavedChanges.recentChangeAndAuthors` | Specifies the string to be shown in place of both the _recent change_ and _authors_ code lens when there are unsaved changes |
| `gitlens.strings.codeLens.unsavedChanges.recentChangeOnly`       | Specifies the string to be shown in place of the _recent change_ code lens when there are unsaved changes                    |
| `gitlens.strings.codeLens.unsavedChanges.authorsOnly`            | Specifies the string to be shown in place of the _authors_ code lens when there are unsaved changes                          |

---

## Themable Colors [#](#themable-colors- 'Themable Colors')

GitLens defines a set of themable colors which can be provided by vscode themes or directly by the user using [`workbench.colorCustomization`](https://code.visualstudio.com/docs/getstarted/themes#_customize-a-color-theme).

| Name                                       | Description                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `gitlens.gutterBackgroundColor`            | Specifies the background color of the gutter blame annotations                            |
| `gitlens.gutterForegroundColor`            | Specifies the foreground color of the gutter blame annotations                            |
| `gitlens.gutterUncommittedForegroundColor` | Specifies the foreground color of an uncommitted line in the gutter blame annotations     |
| `gitlens.trailingLineBackgroundColor`      | Specifies the background color of the trailing blame annotation                           |
| `gitlens.trailingLineForegroundColor`      | Specifies the foreground color of the trailing blame annotation                           |
| `gitlens.lineHighlightBackgroundColor`     | Specifies the background color of the associated line highlights in blame annotations     |
| `gitlens.lineHighlightOverviewRulerColor`  | Specifies the overview ruler color of the associated line highlights in blame annotations |

---

## Insiders

Add [`"gitlens.insiders": true`](#general-settings- 'Jump to GitLens settings') to your settings to join the insiders channel and get early access to upcoming features. Be aware that because this provides early access expect there to be issues.

---

## Contributors &#x1F64F;&#x2764;

A big thanks to the people that have contributed to this project:

- Loris Bettazza ([@Pustur](https://github.com/Pustur)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=Pustur)
- Tony Brix ([@UziTech](https://github.com/UziTech)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=UziTech)
- Amanda Cameron ([@AmandaCameron](https://github.com/AmandaCameron)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=AmandaCameron)
- Brett Cannon ([@brettcannon](https://github.com/brettcannon)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=brettcannon)
- Ash Clarke ([@ashclarke](https://github.com/ashclarke)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=ashclarke)
- Matt Cooper ([@vtbassmatt](https://github.com/vtbassmatt)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=vtbassmatt)
- Segev Finer ([@segevfiner](https://github.com/segevfiner)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=segevfiner)
- Cory Forsyth ([@bantic](https://github.com/bantic)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=bantic)
- John Gee ([@shadowspawn](https://github.com/shadowspawn)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=shadowspawn)
- Geoffrey ([@g3offrey](https://github.com/g3offrey)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=g3offrey)
- Yukai Huang ([@Yukaii](https://github.com/Yukaii)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=Yukaii)
- Roy Ivy III ([@rivy](https://github.com/rivy)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=rivy)
- Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=hjanuschka)
- Chris Kaczor ([@ckaczor](https://github.com/ckaczor)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=ckaczor)
- Mathew King ([@MathewKing](https://github.com/MathewKing)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=MathewKing)
- Andrei Korigodski ([@korigod](https://github.com/korigod)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=korigod)
- Marc Lasson ([@mlasson](https://github.com/mlasson)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=mlasson)
- Peng Lyu ([@rebornix](https://github.com/rebornix)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=rebornix)
- Cédric Malard ([@cmalard](https://github.com/cmalard)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=cmalard)
- Aurelio Ogliari ([@nobitagit](https://github.com/nobitagit)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=nobitagit)
- Maxim Pekurin ([@pmaxim25](https://github.com/pmaxim25)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=pmaxim25)
- Johannes Rieken ([@jrieken](https://github.com/jrieken)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=jrieken)
- ryenus ([@ryenus](https://github.com/ryenus)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=ryenus)
- Zack Schuster ([@zackschuster](https://github.com/zackschuster)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=zackschuster)
- sgtwilko ([@sgtwilko](https://github.com/sgtwilko)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=sgtwilko)
- SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=SpaceEEC)
- Skybbles // L5474 ([@Luxray5474](https://github.com/Luxray5474)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=Luxray5474)
- Alexey Vasyukov ([@notmedia](https://github.com/notmedia)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=notmedia)
- x13machine ([@x13machine](https://github.com/x13machine)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=x13machine)
- Yan Zhang ([@Eskibear](https://github.com/Eskibear)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=Eskibear)
- Zyck ([@qzyse2017](https://github.com/qzyse2017)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=qzyse2017)

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!
