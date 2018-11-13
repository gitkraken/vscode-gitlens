[![](https://vsmarketplacebadge.apphb.com/version-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/installs-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/rating-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://img.shields.io/badge/vscode--dev--community-gitlens-blue.svg?logo=slack)](https://join.slack.com/t/vscode-dev-community/shared_invite/enQtMjIxOTgxNDE3NzM0LWU5M2ZiZDU1YjBlMzdlZjA2YjBjYzRhYTM5NTgzMTAxMjdiNWU0ZmQzYWI3MWU5N2Q1YjBiYmQ4MzY0NDE1MzY)

<p align="center">
  <br />
  <a title="Learn more about GitLens" href="http://gitlens.amod.io"><img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/gitlens-logo.png" alt="GitLens Logo" /></a>
</p>

> GitLens **supercharges** the Git capabilities built into Visual Studio Code. It helps you to **visualize code authorship** at a glance via Git blame annotations and code lens, **seamlessly navigate and explore** Git repositories, **gain valuable insights** via powerful comparison commands, and so much more.

<br />

# What's new in GitLens 9

## 9.0 &mdash; September 2018

See the [release notes](https://github.com/eamodio/vscode-gitlens/blob/master/CHANGELOG.md 'Open Release Notes') for the full set of changes

# GitLens

[GitLens](http://gitlens.amod.io 'Learn more about GitLens') is an [open-source](https://github.com/eamodio/vscode-gitlens 'Open GitLens on GitHub') extension for [Visual Studio Code](https://code.visualstudio.com) created by [Eric Amodio](http://www.amod.io 'Learn more about Eric').
While GitLens is generously offered to everyone free of charge, if you find it useful please consider [supporting](#support-gitlens 'Support GitLens') it.

GitLens simply helps you understand code better. Quickly glimpse into whom, why, and when a line or code block was changed. Jump back through history to gain further insights as to how and why the code evolved. Explore the history and evolution of a codebase.

Here are just some of the features that GitLens provides,

- a [_Repositories_ view](#repositories-view 'Jump to the Repositories view') to visualize, navigate, and explore Git repositories
- a [_File History_ view](#file-history-view 'Jump to the File History view') to visualize, navigate, and explore the revision history of the current file
- a [_Line History_ view](#line-history-view 'Jump to the Line History view') to visualize, navigate, and explore the revision history of the selected lines of current file
- a [_Compare_ view](#compare-view 'Jump to the Compare view') to visualize comparisons between branches, tags, commits, and more
- a [Search Commits view](#search-commits-view 'Jump to the Search Commits view') to search and explore commit histories by message, author, files, id, etc
- [authorship code lens](#code-lens 'Jump to the Code Lens') showing the most recent commit and # of authors to the top of files and/or on code blocks
- an unobtrusive [current line blame](#current-line-blame 'Jump to the Current Line Blame') annotation at the end of the line
- on-demand [gutter blame](#gutter-blame 'Jump to the Gutter Blame') annotations, including a heatmap, for the whole file
- on-demand [gutter heatmap](#gutter-heatmap 'Jump to the Gutter Heatmap') annotations to show how recently lines were changed, relative to all the other changes in the file and to now (hot vs. cold)
- detailed blame information accessible via [hovers](#hovers 'Jump to Hovers)
- on-demand [recent changes](#recent-changes 'Jump to the Recent Changes') annotations to highlight lines changed by the most recent commit
- a [status bar blame](#status-bar-blame 'Jump to the Status Bar Blame') annotation showing author and date for the current line
- [commit search](#commit-search 'Jump to the Commit Search') &mdash; by message, author, filename, commit id, or code changes
- many powerful commands for exploring commits and histories, comparing and navigating revisions, stash access, repository status, etc
- and so much [more](#features 'Jump to Features')

GitLens is powerful, feature rich, and also [highly customizable](#gitlens-settings 'Jump to the GitLens settings docs') to meet your specific needs &mdash; find code lens intrusive or the current line blame annotation distracting &mdash; no problem, it is quick and easy to turn them off or change how they behave via the built-in [_GitLens Settings_ editor](#configuration 'Jump to Configuration'), an interactive editor covering many of GitLens' powerful settings. While for more advanced customizations, refer to the [GitLens settings docs](#gitlens-settings 'Jump to the GitLens settings docs') and edit your vscode [user settings](https://code.visualstudio.com/docs/getstarted/settings 'Open User settings').

<p align="center">
  <br />
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/gitlens-preview.gif" alt="GitLens Preview" />
  <br />
</p>

## Support GitLens

While GitLens is generously offered to everyone free of charge, if you find it useful please consider supporting it.

I've been building GitLens in my spare time<sup><a title="nights and weekends, i.e. trading sleep for time">1</a></sup> for almost 2 years now.
From its very humble beginnings, GitLens has grown wildly beyond my expectations &mdash; in both its reach as well as its demands on my time and attention.
While I enjoy giving my free time and attention to GitLens' development and growth, I would like to do even more.

### Show Your Support &#x2764;

To my incredible backers &mdash; thank you so much for your contributions. I am truly humbled by your generosity and support. Please know that your support plays an important role in helping me realize GitLens' potential in making developer's lives easier.

If you'd like to join in supporting GitLens, please consider the following &mdash; feel free to choose more than one. &#x1F609;

- [Become a Sponsor](https://www.patreon.com/eamodio 'Become a sponsor on Patreon') &mdash; join the growing group of generous [backers](https://github.com/eamodio/vscode-gitlens/blob/master/BACKERS.md)
- [Donate via PayPal](https://www.paypal.me/eamodio 'Donate via PayPal')
- [Donate via Cash App](https://cash.me/$eamodio 'Donate via Cash App')
- [Write a Review](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#review-details 'Write a review')
- [Star or Fork me on GitHub](https://github.com/eamodio/vscode-gitlens 'Star or fork me on GitHub')
- [Follow me on Twitter](https://twitter.com/eamodio 'Follow me on Twitter')

#### Gold Sponsors (\$100+)

None yet &mdash; could be you!

#### Silver Sponsors (\$50+)

None yet &mdash; could be you!

#### Bronze Sponsors (\$25+)

None yet &mdash; could be you!

## Configuration

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/settings.png" alt="GitLens Interactive Settings" />
</p>

GitLens has a built-in interactive settings editor which provides an easy-to-use interface to configure many of GitLens' powerful features. It can be accessed via the _Open Settings_ (`gitlens.showSettingsPage`) command from the [_Command Palette_](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette).

For more advanced customizations, refer to the [settings documentation](#gitlens-settings 'Jump to the GitLens settings docs') below.

## Features

### Repositories view

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/repositories-explorer.png" alt="Repositories view" />
</p>

A [customizable](#repositories-view-settings 'Jump to the Repositories view settings') view to visualize, navigate, and explore Git repositories.

- A toolbar provides _Search Commits_, and _Refresh_ commands
  - A context menu provides _Automatic Layout_, _List Layout_, _Tree Layout_, and _Enable Automatic Refresh_ or _Disable Automatic Refresh_ commands

The repositories view provides the following features,

- **Repository Status**

  - Provides the name of the current branch, [optionally](#repositories-view-settings 'Jump to the Repositories view settings') its working tree status, and its upstream tracking branch and status (if available)
  - Provides indicator dots on the repository icon which denote the following:
    - _None_ &mdash; up-to-date with the upstream
    - _Green_ &mdash; ahead of the upstream
    - _Red_ &mdash; behind the upstream
    - _Yellow_ &mdash; both ahead of and behind the upstream
  - Provides additional upstream status nodes, if the current branch is tracking a remote branch and,
    - is behind the upstream &mdash; quickly see and explore the specific commits behind the upstream (i.e. commits that haven't been pulled)
    - is ahead of the upstream &mdash; quickly see and explore the specific commits ahead of the upstream (i.e. commits that haven't been pushed)
  - A context menu provides _Open Repository on Remote_, and _Refresh_ commands
  - **Changed Files** &mdash; lists all the "working" changes
    - Expands to a file-based view of all changed files in the working tree ([optionally](#repositories-view-settings 'Jump to the Repositories view settings')) and/or all files in all commits ahead of the upstream
  - **History (current-branch)** &mdash; lists the revision (commit) history of the current branch
    - See the _Branches expand_ section under **Branches** below for more details

- **Branches** &mdash; lists the local branches

  - Indicates which branch is the current branch and [optionally](#repositories-view-settings 'Jump to the Repositories view settings') shows the remote tracking branch
  - A context menu provides _Open Branches on Remote_, and _Refresh_ commands
  - Branches expand to show its revision (commit) history
    - Provides indicator dots on each branch icon which denote the following:
      - _None_ &mdash; no upstream or up-to-date with the upstream
      - _Green_ &mdash; ahead of the upstream
      - _Red_ &mdash; behind the upstream
      - _Yellow_ &mdash; both ahead of and behind the upstream
    - Context menus for each branch provide
      - _Open Branch on Remote_ (if available), _Compare with Remote_ (if available), _Compare with HEAD_, _Compare with Working Tree_, _Compare with Selected_ (when available), _Compare Ancestry with Working Tree_ (when available), _Select for Compare_, _Open Directory Compare with Working Tree_, _Checkout Branch (via Terminal)_, _Merge Branch (via Terminal)_, _Rebase (Interactive) Branch (via Terminal)_, _Rebase (Interactive) Branch to Remote (via Terminal)_, _Squash Branch into Commit (via Terminal)_, _Create Branch (via Terminal)..._, _Delete Branch (via Terminal)_, _Create Tag (via Terminal)..._, and _Refresh_ commands
    - Revisions (commits) expand to show the set of files changed, complete with status indicators for adds, changes, renames, and deletes
      - Context menus for each revision (commit) provide
        - _Open Commit on Remote_ (if available), _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Compare with HEAD_, _Compare with Working Tree_, _Compare with Selected_ (when available), _Select for Compare_, _Cherry Pick Commit (via Terminal)_ (when available), _Push to Commit (via Terminal)_ (when available), _Revert Commit (via Terminal)_ (when available), _Checkout Commit (via Terminal)_, _Rebase to Commit (via Terminal)_, _Reset to Commit (via Terminal)_, _Create Branch (via Terminal)..._, _Create Tag (via Terminal)..._, and _Refresh_ commands
      - Context menus for each changed file provide
        - _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on Remote_, _Open Revision on Remote_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Copy Remote File Url to Clipboard_, _Apply Changes_, _Compare with Selected_ (when available), _Select for Compare_, and _Show Commit File Details_ commands
      - Inline toolbars for each changed file provide an _Open File_ command

- **Remotes** &mdash; lists the remotes

  - Indicates the direction of the remote (fetch, push, both), remote service (if applicable), and repository path
  - A context menu provides a _Refresh_ command
  - Remotes expands show its list of branches
    - Context menus for each remote provide
      - _Open Branches on Remote_, _Open Repository on Remote_, _Remove Remote (via Terminal)_, and _Refresh_ commands
    - Branches expand to show its revision (commit) history
      - See the _Branches expand_ section under **Branches** above for more details

- **Stashes** &mdash; lists the stashed changes

  - A context menu provides _Stash Changes_, and _Refresh_ commands
  - Stashes expand to show the set of files stashed, complete with status indicators for adds, changes, renames, and deletes
    - Context menus for each stash provide
      - _Apply Stashed Changes_ (confirmation required), _Delete Stashed Changes_ (confirmation required), _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit Message to Clipboard_, _Compare with HEAD_, _Compare with Working Tree_, _Compare with Selected_ (when available), _Select for Compare_, and _Refresh_ commands
    - Context menus for each stashed file provide
      - _Apply Changes_, _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on Remote_ (if available), _Compare with Selected_ (when available), _Select for Compare_, and _Show File History_ commands

- **Tags** &mdash; lists the tags
  - A context menu provides a _Refresh_ command
  - Tags expand to show its revision (commit) history
    - Context menus for each tag provide
      - _Compare with HEAD_, _Compare with Working Tree_, _Compare with Selected_, _Select for Compare_, _Open Directory Compare with Working Tree_, _Delete Tag (via Terminal)_, _Create Branch (via Terminal)_, and _Refresh_ commands
    - Revisions (commits) expand to show the set of files changed, complete with status indicators for adds, changes, renames, and deletes
      - See the _Revisions (commits) expand_ section under **Branches** above for more details

---

### File History view

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/file-history-explorer.png" alt="File History view" />
</p>

A [customizable](#file-history-view-settings 'Jump to the File History view settings') view to visualize, navigate, and explore the revision history of the current file.

- A toolbar provides a _Refresh_ command
  - A context menu provides a _Follow Renames_ or _Don't Follow Renames_ command

The file history view provides the following features,

- Automatically updates to track the current editor
- A context menu provides _Open File_, _Open File on Remote_ (if available), _Copy Remote File Url to Clipboard_ (if available), and _Refresh_ commands
- An inline toolbar provides an _Open File_ command
- Context menus for each revision (commit) provides
  - _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on Remote_ (if available), _Open Revision on Remote_ (if available), _Apply Changes_, _Compare with Selected_ (when available), _Select for Compare_, and _Show Commit File Details_ commands

---

### Line History view

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/line-history-explorer.png" alt="Line History view" />
</p>

A [customizable](#line-history-view-settings 'Jump to the Line History view settings') view to visualize, navigate, and explore the revision history of the selected lines of current file.

- A toolbar provides a _Refresh_ command
  - A context menu provides a _Follow Renames_ or _Don't Follow Renames_ command

The line history view provides the following features,

- Automatically updates to track the selection of the current editor
- A context menu provides _Open File_, _Open File on Remote_ (if available), _Copy Remote File Url to Clipboard_ (if available), and _Refresh_ commands
- An inline toolbar provides an _Open File_ command
- Context menus for each revision (commit) provides
  - _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on Remote_ (if available), _Open Revision on Remote_ (if available), _Apply Changes_, _Compare with Selected_ (when available), _Select for Compare_, and _Show Commit File Details_ commands

---

### Compare view

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/compare-view.png" alt="Compare view" />
</p>

A [customizable](#compare-view-settings 'Jump to the Compare view settings') view to visualize comparisons between branches, tags, commits, and more

- A toolbar provides _Clear Results_, _Keep Results_, and _Refresh_ commands
  - A context menu provides _Automatic Layout_, _List Layout_, and _Tree Layout_ commands

The compare view provides the following features,

- Provides a semi-persistent results view for comparison operations

  - Accessible via the following commands
    - _Compare with Remote_ command (`gitlens.views.compareWithRemote`)
    - _Compare with HEAD_ command (`gitlens.views.compareWithHead`)
    - _Compare with Working Tree_ command (`gitlens.views.compareWithWorking`)
    - _Compare with Selected_ command (`gitlens.views.compareWithSelected`)
    - _Compare Ancestry with Working Tree_ command (`gitlens.views.compareAncestryWithWorking`)
  - An inline toolbar provides _Swap Comparision_, and _Clear Results_ commands
  - A context menu provides _Clear Results_, _Swap Comparision_, _Open Directory Compare_, and _Refresh_ commands

  - **Commits** &mdash; lists the commits between the compared revisions (branches or commits)

    - Revisions (commits) expand to show the set of files changed, complete with status indicators for adds, changes, renames, and deletes
      - See the _Revisions (commits) expand_ section under **Explore** above for more details

  - **Changed Files** &mdash; lists the files changed between the compared revisions (branches or commits)
    - Expands to a file-based view of all changed files
      - Context menus for each changed file provide
        - _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on Remote_, _Open Revision on Remote_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Copy Remote File Url to Clipboard_, _Apply Changes_, _Compare with Selected_ (when available), _Select for Compare_, and _Show Commit File Details_ commands

---

### Search Commits view

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/search-view.png" alt="Search Commits view" />
</p>

A [customizable](#search-commits-view-settings 'Jump to the Search Commits view settings') view to search and explore commit histories by message, author, files, id, etc

- A toolbar provides _Clear Results_, _Keep Results_, and _Refresh_ commands
  - A context menu provides _Automatic Layout_, _List Layout_, and _Tree Layout_ commands

The search commits view provides the following features,

- Provides a semi-persistent results view for searching and exploring commit histories
  - Accessible via the following commands
    - _Search Commits_ command (`gitlens.showCommitSearch`)
    - _Show File History_ command (`gitlens.showQuickFileHistory`)
    - _Show Commit Details_ command (`gitlens.showQuickCommitDetails`)
  - An inline toolbar provides a _Clear Results_ command
  - A context menu provides _Clear Results_, and _Refresh_ commands
  - Revisions (commits) expand show the set of files changed, complete with status indicators for adds, changes, renames, and deletes
    - Context menus for each revision (commit) provide
      - _Open Commit on Remote_ (if available), _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Compare with HEAD_, _Compare with Working Tree_, _Compare with Selected_ (when available), _Select for Compare_, _Cherry Pick Commit (via Terminal)_ (when available), _Push to Commit (via Terminal)_ (when available), _Revert Commit (via Terminal)_ (when available), _Checkout Commit (via Terminal)_, _Rebase to Commit (via Terminal)_, _Reset to Commit (via Terminal)_, _Create Branch (via Terminal)..._, _Create Tag (via Terminal)..._, and _Refresh_ commands
    - Context menus for each changed file provide
      - _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on Remote_, _Open Revision on Remote_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Copy Remote File Url to Clipboard_, _Apply Changes_, _Compare with Selected_ (when available), _Select for Compare_, and _Show Commit File Details_ commands

---

### Code Lens

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/code-lens.png" alt="Code Lens" />
</p>

- Adds Git authorship **code lens** to the top of the file and on code blocks ([optional](#code-lens-settings 'Jump to the Code Lens settings'), on by default)

  - **Recent Change** &mdash; author and date of the most recent commit for the file or code block
    - Click the code lens to show a **commit file details quick pick menu** with commands for comparing, navigating and exploring commits, and more (by [default](#code-lens-settings 'Jump to the Code Lens settings'))
  - **Authors** &mdash; number of authors of the file or code block and the most prominent author (if there is more than one)

    - Click the code lens to toggle the file Git blame annotations on and off of the whole file (by [default](#code-lens-settings 'Jump to the Code Lens settings'))
    - Will be hidden if the author of the most recent commit is also the only author of the file or block, to avoid duplicate information and reduce visual noise

  - Provides [customizable](#code-lens-settings 'Jump to the Code Lens settings') click behavior for each code lens &mdash; choose between one of the following
    - Toggle file blame annotations on and off
    - Compare the commit with the previous commit
    - Show a quick pick menu with details and commands for the commit
    - Show a quick pick menu with file details and commands for the commit
    - Show a quick pick menu with the commit history of the file
    - Show a quick pick menu with the commit history of the current branch

- Adds a _Toggle Git Code Lens_ command (`gitlens.toggleCodeLens`) with a shortcut of `shift+alt+b` to toggle the code lens on and off

---

### Current Line Blame

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/current-line-blame.png" alt="Current Line Blame" />
</p>

- Adds an unobtrusive, [customizable](#current-line-blame-settings 'Jump to the Current Line Blame settings'), and [themable](#themable-colors 'Jump to the Themable Colors'), **blame annotation** at the end of the current line
  - Contains the author, date, and message of the current line's most recent commit (by [default](#current-line-blame-settings 'Jump to the Current Line Blame settings'))
  - Adds a _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`) to toggle the blame annotation on and off

---

### Gutter Blame

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/gutter-blame.png" alt="Gutter Blame">
</p>

- Adds on-demand, [customizable](#gutter-blame-settings 'Jump to the Gutter Blame settings'), and [themable](#themable-colors 'Jump to the Themable Colors'), **gutter blame annotations** for the whole file
  - Contains the commit message and date, by [default](#gutter-blame-settings 'Jump to the Gutter Blame settings')
  - Adds a **heatmap** (age) indicator on right edge (by [default](#gutter-blame-settings 'Jump to the Gutter Blame settings')) of the gutter to provide an easy, at-a-glance way to tell how recently lines were changed ([optional](#gutter-blame-settings 'Jump to the Gutter Blame settings'), on by default)
    - See the [gutter heatmap](#gutter-Heatmap 'Jump to the Gutter Heatmap') section below for more details
  - Adds a _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) with a shortcut of `alt+b` to toggle the blame annotations on and off
  - Press `Escape` to turn off the annotations

---

### Gutter Heatmap

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/heatmap.png" alt="Gutter Heatmap" />
</p>

- Adds an on-demand **heatmap** to the edge of the gutter to show how recently lines were changed
  - The indicator's [customizable](#gutter-heatmap-settings 'Jump to the Gutter Heatmap settings') color will either be hot or cold based on the age of the most recent change (cold after 90 days by [default](#gutter-heatmap-settings 'Jump to the Gutter Heatmap settings'))
  - The indicator's brightness ranges from bright (newer) to dim (older) based on the relative age, which is calculated from the median age of all the changes in the file
  - Adds _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`) to toggle the heatmap on and off
  - Press `Escape` to turn off the annotations

---

### Hovers

#### Current Line Hovers

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/hovers-current-line.png" alt="Current Line Hovers" />
</p>

- Adds [customizable](#hover-settings 'Jump to the Hover settings') Git blame hovers accessible over the current line

##### Details Hover

  <p align="center">
    <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/hovers-current-line-details.png" alt="Current Line Details Hover" />
  </p>

- Adds a **details hover** annotation to the current line to show more commit details ([optional](#hover-settings 'Jump to the Hover settings'), on by default)
  - Provides automatic issue linking to Bitbucket, GitHub, GitLab, and Visual Studio Team Services in commit messages
  - Provides a **quick-access command bar** with _Open Changes_, _Blame Previous Revision_, _Open on Remote_, and _Show More Actions_ command buttons
  - Click the commit id to execute the _Show Commit Details_ command

##### Changes (diff) Hover

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/hovers-current-line-changes.png" alt="Current Line Changes (diff) Hover" />
</p>

- Adds a **changes (diff) hover** annotation to the current line to show the line's previous version ([optional](#hover-settings 'Jump to the Hover settings'), on by default)
  - Click the **Changes** to execute the _Open Changes_ command
  - Click the current and previous commit ids to execute the _Show Commit Details_ command

#### Annotation Hovers

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/hovers-annotations.png" alt="Annotation Hovers" />
</p>

- Adds [customizable](#hover-settings 'Jump to the Hover settings') Git blame hovers accessible when annotating

##### Details Hover

  <p align="center">
    <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/hovers-annotations-details.png" alt="Annotations Details Hover" />
  </p>

- Adds a **details hover** annotation to each line while annotating to show more commit details ([optional](#hover-settings 'Jump to the Hover settings'), on by default)
  - Provides automatic issue linking to Bitbucket, GitHub, GitLab, and Visual Studio Team Services in commit messages
  - Provides a **quick-access command bar** with _Open Changes_, _Blame Previous Revision_, _Open on Remote_, and _Show More Actions_ command buttons
  - Click the commit id to execute the _Show Commit Details_ command

##### Changes (diff) Hover

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/hovers-annotations-changes.png" alt="Annotations Changes (diff) Hover" />
</p>

- Adds a **changes (diff) hover** annotation to each line while annotating to show the line's previous version ([optional](#hover-settings 'Jump to the Hover settings'), on by default)
  - Click the **Changes** to execute the _Open Changes_ command
  - Click the current and previous commit ids to execute the _Show Commit Details_ command

---

### Modes

- GitLens supports [user-defined](#modes-settings 'Jump to the Modes settings') modes for quickly toggling between sets of settings
  - Adds _Switch Mode_ command (`gitlens.switchMode`) to quickly switch the active mode
  - Adds a built-in _Zen_ mode which for a zen-like experience, disables many visual features
    - Adds _Toggle Zen Mode_ command (`gitlens.toggleZenMode`) to toggle Zen mode
  - Adds a built-in _Review_ mode which for reviewing code, enables many visual features
    - Adds _Toggle Review Mode_ command (`gitlens.toggleReviewMode`) to toggle Review mode
  - Adds the active mode to the **status bar** ([optional](#modes-settings 'Jump to the Modes settings'), on by default)

---

### Recent Changes

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/recent-changes.png" alt="Recent Changes" />
</p>

- Adds an on-demand, [customizable](#recent-changes-settings 'Jump to the Recent Changes settings') and [themable](#themable-colors 'Jump to the Themable Colors'), **recent changes annotation** to highlight lines changed by the most recent commit
  - Adds _Toggle Recent File Changes Annotations_ command (`gitlens.toggleFileRecentChanges`) to toggle the recent changes annotations on and off
  - Press `Escape` to turn off the annotations

---

### Status Bar Blame

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/status-bar.png" alt="Status Bar Blame" />
</p>

- Adds a [customizable](#status-bar-settings 'Jump to the Status Bar Blame settings') **Git blame annotation** about the current line to the **status bar** ([optional](#status-bar-settings 'Jump to the Status Bar Blame settings'), on by default)

  - Contains the commit author and date (by [default](#status-bar-settings 'Jump to the Status Bar Blame settings'))
  - Click the status bar item to show a **commit details quick pick menu** with commands for comparing, navigating and exploring commits, and more (by [default](#status-bar-settings 'Jump to the Status Bar Blame settings'))

  - Provides [customizable](#status-bar-settings 'Jump to the Status Bar Blame settings') click behavior &mdash; choose between one of the following
    - Toggle file blame annotations on and off
    - Toggle code lens on and off
    - Compare the line commit with the previous commit
    - Compare the line commit with the working tree
    - Show a quick pick menu with details and commands for the commit (default)
    - Show a quick pick menu with file details and commands for the commit
    - Show a quick pick menu with the commit history of the file
    - Show a quick pick menu with the commit history of the current branch

---

### Commit Search

- Adds a _Search Commits_ command (`gitlens.showCommitSearch`) with a shortcut of `alt+/` to search for commits by message, author, file(s), commit id, or code changes
  - Use `<message>` to search for commits with messages that match `<message>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#git-log---grepltpatterngt 'Open Git docs')
  - Use `@<pattern>` to search for commits with authors that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#git-log---authorltpatterngt 'Open Git docs')
  - Use `:<pattern>` to search for commits with file names that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log 'Open Git docs')
  - Use `#<sha>` to search for a commit with id of `<sha>` &mdash; See [Git docs](https://git-scm.com/docs/git-log 'Open Git docs')
  - Use `~<pattern>` to search for commits with differences whose patch text contains added/removed lines that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#git-log--Gltregexgt 'Open Git docs')
  - Use `=<string>` to search for commits with differences that change the number of occurrences of the specified string (i.e. addition/deletion) in a file &mdash; See [Git docs](https://git-scm.com/docs/git-log#git-log--Sltstringgt 'Open Git docs')
  - Provides a _Show in View_ option to show the search results in the _Search Commits_ view

---

### Navigate and Explore

- Adds a _Show Last Opened Quick Pick_ command (`gitlens.showLastQuickPick`) with a shortcut of `alt+-` to quickly get back to where you were when the last GitLens quick pick menu closed

- Adds commands to Open files, commits, branches, and the repository on the supported remote services, **Bitbucket, GitHub, GitLab, and Visual Studio Team Services** or a [**user-defined** remote services](#custom-remotes-settings 'Jump to Custom Remotes settings') &mdash; only available if a Git upstream service is configured in the repository
  - Also supports [remote services with custom domains](#custom-remotes-settings 'Jump to Custom Remotes settings'), such as **Bitbucket, Bitbucket Server (previously called Stash), GitHub, GitHub Enterprise, GitLab**
  - _Open Branches on Remote_ command (`gitlens.openBranchesInRemote`) &mdash; opens the branches on the supported remote service
  - _Open Branch on Remote_ command (`gitlens.openBranchInRemote`) &mdash; opens the current branch commits on the supported remote service
  - _Open Commit on Remote_ command (`gitlens.openCommitInRemote`) &mdash; opens the commit revision of the current line on the supported remote service
  - _Open File on Remote_ command (`gitlens.openFileInRemote`) &mdash; opens the current file/revision on the supported remote service
  - _Open Repository on Remote_ command (`gitlens.openRepoInRemote`) &mdash; opens the repository on the supported remote service

#### Branch History

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-branch-history.png" alt="Branch History Quick Pick Menu" />
</p>

- Adds a _Show Current Branch History_ command (`gitlens.showQuickRepoHistory`) with a shortcut of `shift+alt+h` to show a paged **branch history quick pick menu** of the current branch for exploring its commit history

  - Provides entries to _Show Commit Search_ and _Open Branch on \<remote-service\>_ when available
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

- Adds a _Show Branch History_ command (`gitlens.showQuickBranchHistory`) to show a paged **branch history quick pick menu** of the selected branch for exploring its commit history
  - Provides the same features as _Show Current Branch History_ above

#### File History

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-file-history.png" alt="File History Quick Pick Menu" />
</p>

- Adds a _Show File History_ command (`gitlens.showQuickFileHistory`) to show a paged **file history quick pick menu** of the current file for exploring its commit history
  - Provides additional entries to _Show in View_, _Show Branch History_, and _Open File on \<remote-service\>_ when available
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

#### Commit Details

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-commit-details.png" alt="Commit Details Quick Pick Menu" />
</p>

- Adds a _Show Commit Details_ command (`gitlens.showQuickCommitDetails`) to show a **commit details quick pick menu** of the most recent commit of the current file
  - Quickly see the set of files changed in the commit, complete with status indicators for adds, changes, renames, and deletes
  - Provides additional entries to _Show in View_, _Open Commit on \<remote-service\>_ when available, _Open Files_, _Open Revisions_, _Open Directory Compare with Previous Revision_, _Open Directory Compare with Working Tree_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings 'Jump to Advanced settings') is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the comparison of the current revision with the previous one

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-commit-file-details.png" alt="Commit File Details Quick Pick Menu" />
</p>

- Adds a _Show Commit File Details_ command (`gitlens.showQuickCommitFileDetails`) with a shortcut of `alt+c` to show a **file commit details quick pick menu** of the most recent commit of the current file
  - Provides entries to _Open Changes_, _Open Changes with Working File_, _Open File_, _Open Revision_, _Open File on \<remote-service\>_ when available, _Open Revision on \<remote-service\>_ when available, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Show File History_, and _Show Previous File History_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings 'Jump to Advanced settings') is set

#### Repository Status

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-repo-status.png" alt="Repository Status Quick Pick Menu" />
</p>

- Adds a _Show Repository Status_ command (`gitlens.showQuickRepoStatus`) with a shortcut of `alt+s` to show a **repository status quick pick menu** for visualizing the current repository status
  - Quickly see upstream status (if an Git upstream is configured) &mdash; complete with ahead and behind information
    - If you are ahead of the upstream, an entry will be shown with the number of commits ahead. Choosing it will show a limited **branch history quick pick menu** containing just the commits ahead of the upstream
    - If you are behind the upstream, an entry will be shown with the number of commits behind. Choosing it will show a limited **branch history quick pick menu** containing just the commits behind the upstream
  - Quickly see all working changes, both staged and unstaged, complete with status indicators for adds, changes, renames, and deletes
  - Provides entries to _Show Stashed Changes_, _Open Changed Files_, and _Close Unchanged Files_
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings 'Jump to Advanced settings') is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Staged Files` or `Unstaged Files` sections to preview the comparison of the working file with the previous revision

#### Stashes

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-stash-list.png" alt="Stashed Changes Quick Pick Menu" />
</p>

- Adds a _Show Stashed Changes_ command (`gitlens.showQuickStashList`) to show a **stashed changes quick pick menu** for exploring your repository stash history

  - Provides additional entries to _Stash Changes_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available

- Adds a _Stash Changes_ command (`gitlens.stashSave`) to save any working tree changes to the stash &mdash; can optionally provide a stash message
  - Also adds the command to the Source Control items context menu to stash an individual or group of files, works with multi-select too!

#### Stash Details

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/develop/images/docs/menu-stash-details.png" alt="Stash Details Quick Pick Menu" />
</p>

- Stashed changes show a **stash details quick pick menu** which is very similar to the **commit details quick pick menu** above

  - Quickly see the set of files changed in the stash, complete with status indicators for adds, changes, renames, and deletes
  - Provides additional entries to _Apply Stashed Changes_ (requires confirmation), _Delete Stashed Changes_ (requires confirmation), _Open Files_, _Open Revisions_, _Open Directory Compare with Previous Revision_, _Open Directory Compare with Working Tree_, _Copy Commit Message to Clipboard_
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible &mdash; commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings 'Jump to Advanced settings') is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the comparison of the current revision with the previous one

- Adds a _Apply Stashed Changes_ command (`gitlens.stashApply`) to chose a stash entry to apply to the working tree from a quick pick menu

---

### Powerful Comparison Tools

- Effortlessly navigate between comparisons via the `alt+,` and `alt+.` shortcut keys to go back and forth through a file's revisions

- Provides easy access to the following comparison commands via the `Command Palette` as well as in context via the many provided quick pick menus

- Adds a _Directory Compare Working Tree with..._ command (`gitlens.diffDirectory`) to open the configured Git difftool to compare the working tree with the selected branch or tag

- Adds a _Compare HEAD with Branch or Tag..._ command (`gitlens.diffHeadWithBranch`) to compare the index (HEAD) with the selected branch or tag

- Adds a _Compare Working Tree with Branch or Tag..._ command (`gitlens.diffWorkingWithBranch`) to compare the working tree with the selected branch or tag

- Adds a _Open Changes with Branch or Tag..._ command (`gitlens.diffWithBranch`) to compare the current file with the same file on the selected branch or tag

- Adds a _Open Changes with Next Revision_ command (`gitlens.diffWithNext`) with a shortcut of `alt+.` to compare the current file/diff with the next commit revision

- Adds a _Open Changes with Previous Revision_ command (`gitlens.diffWithPrevious`) with a shortcut of `alt+,` to compare the current file/diff with the previous commit revision

- Adds a _Open Line Changes with Previous Revision_ command (`gitlens.diffLineWithPrevious`) with a shortcut of `shift+alt+,` to compare the current file/diff with the previous line commit revision

- Adds a _Open Changes with Revision..._ command (`gitlens.diffWithRevision`) to compare the current file with the selected revision of the same file

- Adds a _Open Changes with Working File_ command (`gitlens.diffWithWorking`) with a shortcut of `shift+alt+w` to compare the most recent commit revision of the current file/diff with the working tree

- Adds a _Open Line Changes with Working File_ command (`gitlens.diffLineWithWorking`) with a shortcut of `alt+w` to compare the commit revision of the current line with the working tree

---

### And More

- Adds a _Copy Commit ID to Clipboard_ command (`gitlens.copyShaToClipboard`) to copy the commit id (sha) of the current line to the clipboard or from the most recent commit to the current branch, if there is no current editor

- Adds a _Copy Commit Message to Clipboard_ command (`gitlens.copyMessageToClipboard`) to copy the commit message of the current line to the clipboard or from the most recent commit to the current branch, if there is no current editor

- Adds a _Copy Remote File Url to Clipboard_ command (`gitlens.copyRemoteFileUrlToClipboard`) to copy the remote url of the current file and line to the clipboard

- Adds a _Open Working File"_ command (`gitlens.openWorkingFile`) to open the working file for the current file revision

- Adds a _Open Revision..._ command (`gitlens.openFileRevision`) to open the selected revision for the current file

- Adds a _Open Changes (with difftool)_ command (`gitlens.externalDiff`) to the source control group and source control resource context menus to open the changes of a file or set of files with the configured git difftool

- Adds a _Open All Changes (with difftool)_ command (`gitlens.externalDiffAll`) to open all working changes with the configured git difftool

  - Also adds the command to the Source Control group context menu

- Adds a _Open Changed Files_ command (`gitlens.openChangedFiles`) to open any files with working tree changes

- Adds a _Close Unchanged Files_ command (`gitlens.closeUnchangedFiles`) to close any files without working tree changes

---

## GitLens Settings

GitLens is highly customizable and provides many configuration settings to allow the personalization of almost all features.

### General Settings

| Name                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.defaultDateFormat`         | Specifies how absolute dates will be formatted by default<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats                                                                                                                                                                                                                                                                                                                 |
| `gitlens.defaultDateStyle`          | Specifies how dates will be displayed by default                                                                                                                                                                                                                                                                                                                                                                                                    |
| `gitlens.defaultGravatarsStyle`     | Specifies the style of the gravatar default (fallback) images<br />`identicon` - a geometric pattern<br />`mm` - a simple, cartoon-style silhouetted outline of a person (does not vary by email hash)<br />`monsterid` - a monster with different colors, faces, etc<br />`retro` - 8-bit arcade-style pixelated faces<br />`robohash` - a robot with different colors, faces, etc<br />`wavatar` - a face with differing features and backgrounds |
| `gitlens.insiders`                  | Specifies whether to enable experimental features                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.keymap`                    | Specifies the keymap to use for GitLens shortcut keys<br />`alternate` - adds an alternate set of shortcut keys that start with `Alt` (&#x2325; on macOS)<br />`chorded` - adds a chorded set of shortcut keys that start with `Ctrl+Shift+G` (<code>&#x2325;&#x2318;G</code> on macOS)<br />`none` - no shortcut keys will be added                                                                                                                |
| `gitlens.menus`                     | Specifies which commands will be added to which menus                                                                                                                                                                                                                                                                                                                                                                                               |
| `gitlens.outputLevel`               | Specifies how much (if any) output will be sent to the GitLens output channel                                                                                                                                                                                                                                                                                                                                                                       |
| `gitlens.settings.mode`             | Specifies the display mode of the interactive settings editor<br />`simple` - only displays common settings<br />`advanced` - displays all settings                                                                                                                                                                                                                                                                                                 |
| `gitlens.showWhatsNewAfterUpgrades` | Specifies whether to show What's New after upgrading to new feature releases                                                                                                                                                                                                                                                                                                                                                                        |

### Repositories View Settings

See also [View Settings](#view-settings 'Jump to the View settings')

| Name                                            | Description                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.repositories.autoRefresh`        | Specifies whether to automatically refresh the _Repositories_ view when the repository or the file system changes                                                                                                                                                                                                                        |
| `gitlens.views.repositories.autoReveal`         | Specifies whether to automatically reveal repositories in the _Repositories_ view when opening files                                                                                                                                                                                                                                     |
| `gitlens.views.repositories.branches.layout`    | Specifies how the _Repositories_ view will display branches<br />`list` - displays branches as a list<br />`tree` - displays branches as a tree when branch names contain slashes `/`                                                                                                                                                    |
| `gitlens.views.repositories.enabled`            | Specifies whether to show the _Repositories_ view                                                                                                                                                                                                                                                                                        |
| `gitlens.views.repositories.files.compact`      | Specifies whether to compact (flatten) unnecessary file nesting in the _Repositories_ view<br />Only applies when `gitlens.views.repositories.files.layout` is set to `tree` or `auto`                                                                                                                                                   |
| `gitlens.views.repositories.files.layout`       | Specifies how the _Repositories_ view will display files<br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.repositories.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.repositories.files.threshold`    | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Repositories_ view<br />Only applies when `gitlens.views.repositories.files.layout` is set to `auto`                                                                                                     |
| `gitlens.views.repositories.includeWorkingTree` | Specifies whether to include working tree files inside the `Repository Status` node of the _Repositories_ view                                                                                                                                                                                                                           |
| `gitlens.views.repositories.location`           | Specifies where to show the _Repositories_ view<br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar                                                                                                                                           |
| `gitlens.views.repositories.showTrackingBranch` | Specifies whether to show the tracking branch when displaying local branches in the _Repositories_ view                                                                                                                                                                                                                                  |

### File History View Settings

See also [View Settings](#view-settings 'Jump to the View settings')

| Name                                 | Description                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.fileHistory.avatars`  | Specifies whether to show avatar images instead of status icons in the _File History_ view                                                                                                     |
| `gitlens.views.fileHistory.enabled`  | Specifies whether to show the _File History_ view                                                                                                                                              |
| `gitlens.views.fileHistory.location` | Specifies where to show the _File History_ view<br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar |

### Line History View Settings

See also [View Settings](#view-settings 'Jump to the View settings')

| Name                                 | Description                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.lineHistory.avatars`  | Specifies whether to show avatar images instead of status icons in the _Line History_ view                                                                                                     |
| `gitlens.views.lineHistory.enabled`  | Specifies whether to show the _Line History_ view                                                                                                                                              |
| `gitlens.views.lineHistory.location` | Specifies where to show the _Line History_ view<br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar |

### Compare View Settings

See also [View Settings](#view-settings 'Jump to the View settings')

| Name                                    | Description                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.views.compare.files.compact`   | Specifies whether to compact (flatten) unnecessary file nesting in the _Compare_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `tree` or `auto`                                                                                                                                                   |
| `gitlens.views.compare.enabled`         | Specifies whether to show the _Compare_ view                                                                                                                                                                                                                                                                                   |
| `gitlens.views.compare.files.layout`    | Specifies how the _Compare_ view will display files<br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.compare.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.compare.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Compare_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `auto`                                                                                                     |
| `gitlens.views.compare.location`        | Specifies where to show the _Compare_ view<br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar                                                                                                                                      |

### Search View Settings

See also [View Settings](#view-settings 'Jump to the View settings')

| Name                                    | Description                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.search.files.compact`    | Specifies whether to compact (flatten) unnecessary file nesting in the _Search Commits_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `tree` or `auto`                                                                                                                                                   |
| `gitlens.views.search.enabled`          | Specifies whether to show the _Search Commits_ view                                                                                                                                                                                                                                                                                   |
| `gitlens.views.search.files.layout`     | Specifies how the _Search Commits_ view will display files<br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.compare.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.compare.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Search Commits_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `auto`                                                                                                     |
| `gitlens.views.search.location`         | Specifies where to show the _Search Commits_ view<br />`gitlens` - adds to the GitLens side bar<br />`explorer` - adds to the Explorer side bar<br />`scm` - adds to the Source Control side bar                                                                                                                                      |

### View Settings

| Name                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.avatars`          | Specifies whether to show avatar images instead of commit (or status) icons in the views                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `gitlens.views.commitFileFormat` | Specifies the format of a committed file in the views<br />Available tokens<br /> ${directory} - directory name<br />${file} - file name<br /> ${filePath} - formatted file name and path<br />${path} - full file path                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.views.commitFormat`     | Specifies the format of committed changes in the views<br />Available tokens<br /> ${id} - commit id<br />${author} - commit author<br /> ${message} - commit message<br />${ago} - relative commit date (e.g. 1 day ago)<br /> \${date} - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br /> \${agoOrDate} - commit date specified by `gitlens.defaultDateStyle`<br /> ${authorAgo} - commit author, relative commit date<br />${authorAgoOrDate} - commit author, commit date specified by `gitlens.defaultDateStyle`<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting |
| `gitlens.views.defaultItemLimit` | Specifies the default number of items to show in a view list. Use 0 to specify no limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.views.stashFileFormat`  | Specifies the format of a stashed file in the views<br />Available tokens<br /> ${directory} - directory name<br />${file} - file name<br /> ${filePath} - formatted file name and path<br />${path} - full file path                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.views.stashFormat`      | Specifies the format of stashed changes in the views<br />Available tokens<br /> ${id} - commit id<br />${author} - commit author<br /> ${message} - commit message<br />${ago} - relative commit date (e.g. 1 day ago)<br /> \${date} - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br /> \${agoOrDate} - commit date specified by `gitlens.defaultDateStyle`<br /> ${authorAgo} - commit author, relative commit date<br />${authorAgoOrDate} - commit author, commit date specified by `gitlens.defaultDateStyle`<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting   |
| `gitlens.views.statusFileFormat` | Specifies the format of the status of a working or committed file in the views<br />Available tokens<br /> ${directory} - directory name<br />${file} - file name<br /> ${filePath} - formatted file name and path<br />${path} - full file path<br />\${working} - optional indicator if the file is uncommitted                                                                                                                                                                                                                                                                                                                                         |

### Code Lens Settings

| Name                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.codeLens.authors.command`          | Specifies the command to be executed when the `authors` code lens is clicked<br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current committed file with the previous commit<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick       |
| `gitlens.codeLens.authors.enabled`          | Specifies whether to provide an `authors` code lens, showing number of authors of the file or code block and the most prominent author (if there is more than one)                                                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.codeLens.enabled`                  | Specifies whether to provide any Git code lens, by default<br />Use the _Toggle Git Code Lens_ command (`gitlens.toggleCodeLens`) to toggle the Git code lens on and off for the current window                                                                                                                                                                                                                                                                                                                                                              |
| `gitlens.codeLens.includeSingleLineSymbols` | Specifies whether to provide any Git code lens on symbols that span only a single line                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `gitlens.codeLens.recentChange.command`     | Specifies the command to be executed when the `recent change` code lens is clicked<br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current committed file with the previous commit<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick |
| `gitlens.codeLens.recentChange.enabled`     | Specifies whether to provide a `recent change` code lens, showing the author and date of the most recent commit for the file or code block                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.codeLens.scopes`                   | Specifies where Git code lens will be shown in the document<br />`document` - adds code lens at the top of the document<br />`containers` - adds code lens at the start of container-like symbols (modules, classes, interfaces, etc)<br />`blocks` - adds code lens at the start of block-like symbols (functions, methods, etc) lines                                                                                                                                                                                                                      |
| `gitlens.codeLens.scopesByLanguage`         | Specifies where Git code lens will be shown in the document for the specified languages                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.codeLens.symbolScopes`             | Specifies a set of document symbols where Git code lens will or will not be shown in the document<br />Prefix with `!` to avoid providing a Git code lens for the symbol<br />Must be a member of [`SymbolKind`](https://code.visualstudio.com/docs/extensionAPI/vscode-api#_a-namesymbolkindaspan-classcodeitem-id660symbolkindspan)                                                                                                                                                                                                                        |

#### Current Line Blame Settings

| Name                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.currentLine.dateFormat` | Specifies how to format absolute dates (using the `${date}` token) for the current line blame annotations<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.currentLine.enabled`    | Specifies whether to provide a blame annotation for the current line, by default<br />Use the _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`) to toggle the annotations on and off for the current window                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.currentLine.format`     | Specifies the format of the current line blame annotation<br />Available tokens<br />`${id}` - commit id<br />`${author}` - commit author<br />`${message}` - commit message<br />`${ago}` - relative commit date (e.g. 1 day ago)<br />`${date}` - formatted commit date (format specified by `gitlens.currentLine.dateFormat`)<br />`${agoOrDate}` - commit date specified by `gitlens.defaultDateStyle`<br />`${authorAgo}` - commit author, relative commit date<br />`${authorAgoOrDate}` - commit author, commit date specified by `gitlens.defaultDateStyle`<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting |
| `gitlens.currentLine.scrollable` | Specifies whether the current line blame annotation can be scrolled into view when it is outside the viewport                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Gutter Blame Settings

| Name                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.blame.avatars`             | Specifies whether to show avatar images in the gutter blame annotations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.blame.compact`             | Specifies whether to compact (deduplicate) matching adjacent gutter blame annotations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `gitlens.blame.dateFormat`          | Specifies how to format absolute dates (using the `${date}` token) in gutter blame annotations<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.blame.format`              | Specifies the format of the gutter blame annotations<br />Available tokens<br />`${id}` - commit id<br />`${author}` - commit author<br />`${message}` - commit message<br />`${ago}` - relative commit date (e.g. 1 day ago)<br />`${date}` - formatted commit date (format specified by `gitlens.blame.dateFormat`)<br />`${agoOrDate}` - commit date specified by `gitlens.defaultDateStyle`<br />`${authorAgo}` - commit author, relative commit date<br />`${authorAgoOrDate}` - commit author, commit date specified by `gitlens.defaultDateStyle`<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting |
| `gitlens.blame.heatmap.enabled`     | Specifies whether to provide a heatmap indicator in the gutter blame annotations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.blame.heatmap.location`    | Specifies where the heatmap indicators will be shown in the gutter blame annotations<br />`left` - adds a heatmap indicator on the left edge of the gutter blame annotations<br />`right` - adds a heatmap indicator on the right edge of the gutter blame annotations                                                                                                                                                                                                                                                                                                                                                                                       |
| `gitlens.blame.highlight.enabled`   | Specifies whether to highlight lines associated with the current line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `gitlens.blame.highlight.locations` | Specifies where the associated line highlights will be shown<br />`gutter` - adds a gutter glyph<br />`line` - adds a full-line highlight background color<br />`overview` - adds a decoration to the overview ruler (scroll bar)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `gitlens.blame.ignoreWhitespace`    | Specifies whether to ignore whitespace when comparing revisions during blame operations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.blame.separateLines`       | Specifies whether gutter blame annotations will have line separators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `gitlens.blame.toggleMode`          | Specifies how the gutter blame annotations will be toggled<br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Gutter Heatmap Settings

| Name                           | Description                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.heatmap.ageThreshold` | Specifies the age of the most recent change (in days) after which the gutter heatmap annotations will be cold rather than hot (i.e. will use `gitlens.heatmap.coldColor` instead of `gitlens.heatmap.hotColor`) |
| `gitlens.heatmap.coldColor`    | Specifies the base color of the gutter heatmap annotations when the most recent change is older (cold) than the `gitlens.heatmap.ageThreshold` value                                                            |
| `gitlens.heatmap.hotColor`     | Specifies the base color of the gutter heatmap annotations when the most recent change is newer (hot) than the `gitlens.heatmap.ageThreshold` value                                                             |
| `gitlens.heatmap.toggleMode`   | Specifies how the gutter heatmap annotations will be toggled<br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                            |

### Hover Settings

| Name                                 | Description                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.hovers.annotations.changes` | Specifies whether to provide a changes (diff) hover for all lines when showing blame annotations                                                                                               |
| `gitlens.hovers.annotations.details` | Specifies whether to provide a commit details hover for all lines when showing blame annotations                                                                                               |
| `gitlens.hovers.annotations.enabled` | Specifies whether to provide any hovers when showing blame annotations                                                                                                                         |
| `gitlens.hovers.annotations.over`    | Specifies when to trigger hovers when showing blame annotations<br />`annotation` - only shown when hovering over the line annotation<br />`line` - shown when hovering anywhere over the line |
| `gitlens.hovers.avatars`             | Specifies whether to show avatar images in hovers                                                                                                                                              |
| `gitlens.hovers.currentLine.changes` | Specifies whether to provide a changes (diff) hover for the current line                                                                                                                       |
| `gitlens.hovers.currentLine.details` | Specifies whether to provide a commit details hover for the current line                                                                                                                       |
| `gitlens.hovers.currentLine.enabled` | Specifies whether to provide any hovers for the current line                                                                                                                                   |
| `gitlens.hovers.currentLine.over`    | Specifies when to trigger hovers for the current line<br />`annotation` - only shown when hovering over the line annotation<br />`line` - shown when hovering anywhere over the line           |
| `gitlens.hovers.enabled`             | Specifies whether to provide any hovers                                                                                                                                                        |

### Modes Settings

| Name                               | Description                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.mode.active`              | Specifies the active GitLens mode, if any                                                                                         |
| `gitlens.mode.statusBar.enabled`   | Specifies whether to provide the active GitLens mode in the status bar                                                            |
| `gitlens.mode.statusBar.alignment` | Specifies the active GitLens mode alignment in the status bar<br />`left` - aligns to the left<br />`right` - aligns to the right |
| `gitlens.modes`                    | Specifies the user-defined GitLens modes                                                                                          |

### Recent Changes Settings

| Name                                        | Description                                                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.recentChanges.highlight.locations` | Specifies where the highlights of the recently changed lines will be shown<br />`gutter` - adds a gutter glyph<br />`line` - adds a full-line highlight background color<br />`overview` - adds a decoration to the overview ruler (scroll bar) |
| `gitlens.recentChanges.toggleMode`          | Specifies how the recently changed lines annotations will be toggled<br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                                                    |

### Status Bar Settings

| Name                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.statusBar.alignment`     | Specifies the blame alignment in the status bar<br />`left` - aligns to the left<br />`right` - aligns to the right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gitlens.statusBar.command`       | Specifies the command to be executed when the blame status bar item is clicked<br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current line commit with the previous<br />`gitlens.diffWithWorking` - compares the current line commit with the working tree<br />`gitlens.toggleCodeLens` - toggles Git code lens<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick |
| `gitlens.statusBar.dateFormat`    | Specifies the date format of absolute dates shown in the blame information in the status bar<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `gitlens.statusBar.enabled`       | Specifies whether to provide blame information in the status bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.statusBar.format`        | Specifies the format of the blame information in the status bar<br />Available tokens<br />`${id}` - commit id<br />`${author}` - commit author<br />`${message}` - commit message<br />`${ago}` - relative commit date (e.g. 1 day ago)<br />`${date}` - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br />`${agoOrDate}` - commit date specified by `gitlens.defaultDateStyle`<br />`${authorAgo}` - commit author, relative commit date<br />`${authorAgoOrDate}` - commit author, commit date specified by `gitlens.defaultDateStyle`<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting                  |
| `gitlens.statusBar.reduceFlicker` | Specifies whether to avoid clearing the previous blame information when changing lines to reduce status bar "flashing"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Advanced Settings

| Name                                            | Description                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.advanced.blame.customArguments`        | Specifies additional arguments to pass to the `git blame` command                                                                     |
| `gitlens.advanced.blame.delayAfterEdit`         | Specifies the time (in milliseconds) to wait before re-blaming an unsaved document after an edit. Use 0 to specify an infinite wait   |
| `gitlens.advanced.blame.sizeThresholdAfterEdit` | Specifies the maximum document size (in lines) allowed to be re-blamed after an edit while still unsaved. Use 0 to specify no maximum |
| `gitlens.advanced.caching.enabled`              | Specifies whether git output will be cached &mdash; changing the default is not recommended                                           |
| `gitlens.advanced.fileHistoryFollowsRenames`    | Specifies whether file histories will follow renames -- will affect how merge commits are shown in histories                          |
| `gitlens.advanced.maxListItems`                 | Specifies the maximum number of items to show in a list. Use 0 to specify no maximum                                                  |
| `gitlens.advanced.messages`                     | Specifies which messages should be suppressed                                                                                         |
| `gitlens.advanced.quickPick.closeOnFocusOut`    | Specifies whether to close QuickPick menus when focus is lost                                                                         |
| `gitlens.advanced.repositorySearchDepth`        | Specifies how many folders deep to search for repositories                                                                            |
| `gitlens.advanced.telemetry.enabled`            | Specifies whether to enable GitLens telemetry (even if enabled still abides by the overall `telemetry.enableTelemetry` setting        |

#### Custom Remotes Settings

| Name              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.remotes` | Specifies user-defined remote (code-hosting) services or custom domains for built-in remote services<br /><br />Example:<br />`"gitlens.remotes": [{ "domain": "git.corporate-url.com", "type": "GitHub" }]`<br /><br />Example:<br />`"gitlens.remotes": [{`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"domain": "git.corporate-url.com",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"type": "Custom",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"name": "My Company",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"protocol": "https",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"urls": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"repository": "https://git.corporate-url.com/${repo}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branches": "https://git.corporate-url.com/${repo}/branches",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branch": "https://git.corporate-url.com/${repo}/commits/${branch}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"commit": "https://git.corporate-url.com/${repo}/commit/${id}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"file": "https://git.corporate-url.com/${repo}?path=${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInBranch": "https://git.corporate-url.com/${repo}/blob/${branch}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInCommit": "https://git.corporate-url.com/${repo}/blob/${id}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileLine": "#L${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileRange": "#L${start}-L${end}"`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}]`<br /><br />Example:<br />`"gitlens.remotes": [{`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"domain": "git.corporate-url.com",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"type": "Custom",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"name": "My Company",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"protocol": "https",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"urls": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"repository": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branches": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/branches",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branch": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/commits/${branch}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"commit": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/commit/${id}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"file": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}?path=${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInBranch": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/blob/${branch}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInCommit": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/blob/${id}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileLine": "#L${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileRange": "#L${start}-L${end}"`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}]` |

#### Strings Settings

| Name                                                             | Description                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.strings.codeLens.unsavedChanges.recentChangeAndAuthors` | Specifies the string to be shown in place of both the `recent change` and `authors` code lens when there are unsaved changes |
| `gitlens.strings.codeLens.unsavedChanges.recentChangeOnly`       | Specifies the string to be shown in place of the `recent change` code lens when there are unsaved changes                    |
| `gitlens.strings.codeLens.unsavedChanges.authorsOnly`            | Specifies the string to be shown in place of the `authors` code lens when there are unsaved changes                          |

---

## Themable Colors

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

Add [`"gitlens.insiders": true`](#general-settings 'Jump to GitLens settings') to your settings to join the insiders channel and get early access to upcoming features. Be aware that because this provides early access expect there to be issues.

---

## Contributors &#x1F64F;&#x2764;

A big thanks to the people that have contributed to this project:

- Loris Bettazza ([@Pustur](https://github.com/Pustur)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=Pustur)
- Amanda Cameron ([@AmandaCameron](https://github.com/AmandaCameron)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=AmandaCameron)
- Brett Cannon ([@brettcannon](https://github.com/brettcannon)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=brettcannon)
- Segev Finer ([@segevfiner](https://github.com/segevfiner)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=segevfiner)
- Cory Forsyth ([@bantic](https://github.com/bantic)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=bantic)
- Geoffrey ([@g3offrey](https://github.com/g3offrey)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=g3offrey)
- Yukai Huang ([@Yukaii](https://github.com/Yukaii)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=Yukaii)
- Roy Ivy III ([@rivy](https://github.com/rivy)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=rivy)
- Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=hjanuschka)
- Chris Kaczor ([@ckaczor](https://github.com/ckaczor)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=ckaczor)
- Andrei Korigodski ([@korigod](https://github.com/korigod)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=korigod)
- Peng Lyu ([@rebornix](https://github.com/rebornix)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=rebornix)
- Cédric Malard ([@cmalard](https://github.com/cmalard)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=cmalard)
- Aurelio Ogliari ([@nobitagit](https://github.com/nobitagit)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=nobitagit)
- Maxim Pekurin ([@pmaxim25](https://github.com/pmaxim25)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=pmaxim25)
- Johannes Rieken ([@jrieken](https://github.com/jrieken)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=jrieken)
- ryenus ([@ryenus](https://github.com/ryenus)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=ryenus)
- Zack Schuster ([@zackschuster](https://github.com/zackschuster)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=zackschuster)
- SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=SpaceEEC)
- Alexey Vasyukov ([@notmedia](https://github.com/notmedia)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=notmedia)
- Zyck ([@qzyse2017](https://github.com/qzyse2017)) &mdash; [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=qzyse2017)

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!
