# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [9.4.1] - 2019-01-08

### Fixed

- Reverts [#606](https://github.com/eamodio/vscode-gitlens/issues/606) as it causes views to lose their expansion state

## [9.4.0] - 2019-01-08

### Added

- Adds pinning of comparisons in the _Compare_ view &mdash; pinned comparisons will persist across reloads
- Adds an _Open in Terminal_ command to repositories in the _Repositories_ view

### Changed

- Renames the _Copy Remote File URL to Clipboard_ command (`gitlens.copyRemoteFileUrlToClipboard`) to _Copy Remote URL to Clipboard_ for brevity

### Fixed

- Fixes [#606](https://github.com/eamodio/vscode-gitlens/issues/606) - ID for xxx is already registered?!
- Fixes [#607](https://github.com/eamodio/vscode-gitlens/issues/607) - Open file in Remote Doesn't URL encode
- Fixes [#608](https://github.com/eamodio/vscode-gitlens/issues/608) - Add an option to change the abbreviated commit SHA length &mdash; thanks to [PR #611](https://github.com/eamodio/vscode-gitlens/pull/611) by Skybbles // L5474 ([@Luxray5474](https://github.com/Luxray5474))
- Fixes [#613](https://github.com/eamodio/vscode-gitlens/issues/613) - Change Copy Remote URL to Clipboard to always copy a permalink (e.g. revision link)

## [9.3.0] - 2019-01-02

### Added

- Adds favoriting of repositories and branches in the _Repositories_ view to allow for better (user-customized) sorting
- Adds the ability to specify a default remote selection when using the _Open \* in Remote_ commands &mdash; closes [#504](https://github.com/eamodio/vscode-gitlens/issues/504)
  - Adds _Set as Default_ and _Unset as Default_ commands to remotes in the _Repositories_ view
- Adds the ability to turn on file annotations (blame, heatmap, and recent changes) via user-defined modes &mdash; closes [#542](https://github.com/eamodio/vscode-gitlens/issues/542)
- Adds the ability to stage and unstage files by folders in the _Repositories_ view &mdash; closes [#599](https://github.com/eamodio/vscode-gitlens/issues/599) thanks to [PR #600](https://github.com/eamodio/vscode-gitlens/pull/600) by Tony Brix ([@UziTech](https://github.com/UziTech))
  - Adds _Stage All Changes_ and _Unstage All Changes_ commands to folders in the _Repositories_ view

## [9.2.4] - 2018-12-26

### Added

- Adds a repository indicator in the _Repositories_ view when we are unable to detect repository changes &mdash; related to [#583](https://github.com/eamodio/vscode-gitlens/issues/583)
- Adds `gitlens.defaultDateShortFormat` setting to specify how short absolute dates will be formatted by default

### Changed

- Changes the fetch date in the _Repositories_ view to respect the date style setting (`gitlens.defaultDateStyle`) and uses the new `gitlens.defaultDateShortFormat` setting for formatting
- Avoids caching when we are unable to detect repository changes &mdash; related to [#583](https://github.com/eamodio/vscode-gitlens/issues/583)

### Fixed

- Fixes [#605](https://github.com/eamodio/vscode-gitlens/issues/605) &mdash; Show More Commits not working

## [9.2.3] - 2018-12-21

### Added

- Adds a `gitlens.views.showRelativeDateMarkers` setting to specify whether to show relative date markers (_Less than a week ago_, _Over a week ago_, _Over a month ago_, etc) on revision (commit) histories in the views &mdash; closes [#571](https://github.com/eamodio/vscode-gitlens/issues/571)

### Changed

- Changes the icon of the _Open Changes with Working File_ command (`gitlens.diffWithWorking`) to align with VS Codes new _Open Changes_ icon
- Splits the `gitlens.views.avatars` setting into `gitlens.views.compare.avatars`, `gitlens.views.repositories.avatars`, and `gitlens.views.search.avatars` settings for more granular control

## [9.2.2] - 2018-12-19

### Changed

- Renames the _Stash Changes_ command (`gitlens.stashSave`) to _Stash All Changes_ and adds a new _Stash Changes_ command (`gitlens.stashSaveFiles`)
- Changes the icon of the _Stash All Changes_ command (`gitlens.stashSave`) &mdash; closes [Microsoft/vscode#64423](https://github.com/Microsoft/vscode/issues/64423)

### Fixed

- Fixes [#598](https://github.com/eamodio/vscode-gitlens/issues/598) &mdash; Apply changes when comparing a file from two branches is not working

## [9.2.1] - 2018-12-16

### Changed

- Switches to use the new built-in clipboard apis &mdash; closes [#593](https://github.com/eamodio/vscode-gitlens/issues/593)
- Improves the error messaging when applying a stash, that won't apply cleanly, by including the git output in the message

### Fixed

- Fixes missing icon when using the `alt`-command of the _Toggle File Blame Annotations_ command

## [9.2.0] - 2018-12-13

### Added

- Improves the commit search experience
  - Remembers and restores the last commit search string
  - Adds a _Search Commits_ command to the search results inline toolbar
  - Reopens the commit search when clicking on a search results without results
- Adds a _Collapse_ command to the toolbars of the _Compare_ and _Search Commits_ views &mdash; closes [#383](https://github.com/eamodio/vscode-gitlens/issues/383)
- Adds support for the [new ability](https://code.visualstudio.com/updates/v1_30#_custom-views) to have descriptions on view nodes &mdash; provides a much cleaner layout
  - Adds a `gitlens.views.commitFileDescriptionFormat` setting to specify the description format of a committed file in the views
  - Adds a `gitlens.views.commitDescriptionFormat` setting to specify the description format of committed changes in the views
  - Adds a `gitlens.views.stashFileDescriptionFormat` setting to specify the description format of a stashed file in the views
  - Adds a `gitlens.views.stashDescriptionFormat` setting to specify the description format of stashed changes in the views
  - Adds a `gitlens.views.statusFileDescriptionFormat` setting to specify the description format of the status of a working or committed file in the views
- Adds a `gitlens.views.repositories.compact` setting to specify whether to show the _Repositories_ view in a compact display density &mdash; closes [#571](https://github.com/eamodio/vscode-gitlens/issues/571)

### Fixed

- Fixes [#559](https://github.com/eamodio/vscode-gitlens/issues/559) &mdash; Html encoding issues with the empty state of the _Compare_ and _Search Commits_ views
- Fixes [#574](https://github.com/eamodio/vscode-gitlens/issues/574) &mdash; Apply Changes not working because of whitespace conflicts
- Fixes [#589](https://github.com/eamodio/vscode-gitlens/issues/589) &mdash; Bad revision for stash

## [9.1.0] - 2018-12-12

### Added

- Adds more detailed branch tracking status (if available) to the **Branches** list in the _Repositories_ view
  - **\* Commits Behind** &mdash; quickly see and explore the specific commits behind the upstream (i.e. commits that haven't been pulled)
    - Only provided if the current branch is tracking a remote branch and is behind it
  - **\* Commits Ahead** &mdash; quickly see and explore the specific commits ahead of the upstream (i.e. commits that haven't been pushed)
    - Only provided if the current branch is tracking a remote branch and is ahead of it
- Adds the date and a changes indicator (+x ~x -x) to stashed changes in GitLens views (uses the new `${changes}` token in the `gitlens.views.stashFormat` setting)
- Adds the changed file status (added, modified, renamed, deleted, etc) to the tooltip of each revision in the _File History_ and _Line History_ views
- Adds Git extended regex support to commit searches
- Adds control over the menu commands contributed to the Source Control side bar to the GitLens interactive settings editor (via the `gitlens.menus` setting)

### Changed

- Changes the _Show Revision Details_ command (`gitlens.showQuickRevisionDetails`) to show file commit details
- Changes the `alt`-command of the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) to be the _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`)
- Changes searching for commits by message to be case-insensitive
- Renames the _Explore the Repository from Here_ command (`gitlens.views.exploreRepoRevision`) to _Explore Repository from Here_
- Reworks the layout of some contributed menu commands

### Fixed

- Fixes an issue where gravatar icons would sometimes not show up &mdash; thanks to [PR #579](https://github.com/eamodio/vscode-gitlens/pull/579) by sgtwilko ([@sgtwilko](https://github.com/sgtwilko))
- Fixes [#33](https://github.com/eamodio/vscode-gitlens/issues/33) &mdash; Commit messages can causes markdown formatting in hovers
- Fixes [#501](https://github.com/eamodio/vscode-gitlens/issues/501) &mdash; Azure DevOps ssh remotes aren't handled properly
- Fixes [#523](https://github.com/eamodio/vscode-gitlens/issues/523) &mdash; File History doesn't show all commits on file
- Fixes [#552](https://github.com/eamodio/vscode-gitlens/issues/552) &mdash; "Open Line Changes with..." doesn't work for renamed files
- Fixes [#566](https://github.com/eamodio/vscode-gitlens/issues/566) &mdash; History error with UNC
- Fixes [#572](https://github.com/eamodio/vscode-gitlens/issues/572) &mdash; Explorer can't expand some branch folders
- Fixes [#584](https://github.com/eamodio/vscode-gitlens/issues/584) &mdash; Unexpected results when opening diff from file history
- Fixes [#588](https://github.com/eamodio/vscode-gitlens/issues/588) &mdash; Output channel doesn't exist with `gitlens.outputLevel` default
- Fixes an issue where comparing a file with its staged revision doesn't show any content
- Fixes an issue where the workspace folder added by the _Explore Repository from Here_ command (`gitlens.views.exploreRepoRevision`) would fail to load in certain cases
- Fixes an issue where applying changes of an added file or an untracked file (in a stash) would fail

## [9.0.3] - 2018-12-06

### Fixed

- Fixes [#576](https://github.com/eamodio/vscode-gitlens/issues/576) &mdash; Fails to load with older versions of git
- Fixes an issue where the _Copy Commit Message to Clipboard_ command fails (and probably others too) &mdash; a regression caused by the attempted fix for [#568](https://github.com/eamodio/vscode-gitlens/issues/565)

## [9.0.2] - 2018-12-05

### Added

- Adds a _Directory Compare All Changes_ (`gitlens.diffDirectoryWithHead`) command to open the configured git difftool to compare the working directory with HEAD &mdash; closes [#569](https://github.com/eamodio/vscode-gitlens/issues/569)

### Changed

- Renames _Open Changes (with difftool)_ command to _Open All Changes (with difftool)_ when shown on the SCM group context menu

### Fixed

- Fixes [#565](https://github.com/eamodio/vscode-gitlens/issues/565) &mdash; Regression: Submodules don't work properly (missing repo in view, file and inline blame, etc)
- Fixes [#528](https://github.com/eamodio/vscode-gitlens/issues/528) &mdash; Remotes not showing, being filtred on domain and file, but not complete path
- Fixes an issue where _Close Repository_ command didn't work
- Fixes issues with external files (files not in one of the workspace folders) showing up as a new repository when over a Live Share session

## [9.0.1] - 2018-12-02

### Fixed

- Fixes issues with errors when listing history in repos without any tags

## [9.0.0] - 2018-12-02

### Added

- Adds GitLens over Visual Studio Live Share
  - Live Share guests will now have read-only access to GitLens' features, provided both the host and guest have GitLens installed
  - Adds a `gitlens.liveshare.allowGuestAccess` setting to specify whether to allow guest access to GitLens features when using Visual Studio Live Share
- Adds a new Git virtual file system provider for the `gitlens:` scheme &mdash; closes [#430](https://github.com/eamodio/vscode-gitlens/issues/430)
  - Replaces GitLens' internal handling of file revisions, which allows for better performance, as well as avoiding the use of temp files. It also provides a much better experience when dealing with file encodings, images, etc.
- Adds an _Explore the Repository from Here_ (`gitlens.views.exploreRepoRevision`) command which opens a virtual workspace folder (uses the new Git virtual file system provider) for the repository at the specified point in time (commit, branch, tag, etc) &mdash; closes [#398](https://github.com/eamodio/vscode-gitlens/issues/398)
- Adds a new [_Repositories_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#repositories-view- 'Jump to the Repositories view docs'), formerly the _GitLens_ view, to visualize, navigate, and explore Git repositories &mdash; closes [#456](https://github.com/eamodio/vscode-gitlens/issues/456), [#470](https://github.com/eamodio/vscode-gitlens/issues/470), [#494](https://github.com/eamodio/vscode-gitlens/issues/494)
  <br/>[![Repositories view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-repositories.png)](https://github.com/eamodio/vscode-gitlens/tree/master/#repositories-view- 'Jump to the Repositories view docs')
  - Provides a cleaner information-rich view of your opened repositories, more git commands (fetch, push, pull, checkout, stage, unstage, etc), better visibility and accessibility of existing features, and [more](https://github.com/eamodio/vscode-gitlens/tree/master/#repositories-view- 'Jump to the Repositories view docs')
  - Adds a `gitlens.views.repositories.autoReveal` setting to specify whether to automatically reveal repositories in the _Repositories_ view when opening files
- Adds a new [_File History_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#file-history-view- 'Jump to the File History view docs'), formerly the _History_ view, to visualize, navigate, and explore the revision history of the current file
  <br/>[![File History view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-file-history.png)](https://github.com/eamodio/vscode-gitlens/tree/master/#file-history-view- 'Jump to the File History view docs')
  - Provides similar features to the former _History_ view as well as quickly toggling file tracking on and off, changing the base (branch, tag, commit, etc) of the file's history, and [more](https://github.com/eamodio/vscode-gitlens/tree/master/#file-history-view- 'Jump to the File History view docs')
- Adds an all-new [_Line History_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#line-history-view- 'Jump to the Line History view docs') to visualize, navigate, and explore the revision history of the selected lines of current file &mdash; closes [#354](https://github.com/eamodio/vscode-gitlens/issues/354)
  <br/>[![Line History view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-line-history.png)](https://github.com/eamodio/vscode-gitlens/tree/master/#line-history-view- 'Jump to the Line History view docs')
  - Provides similar features to the _File History_ view including quickly toggling line tracking on and off, changing the base (branch, tag, commit, etc) of the selected lines' history, and [more](https://github.com/eamodio/vscode-gitlens/tree/master/#line-history-view- 'Jump to the Line History view docs')
- Adds an all-new [_Search Commits_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#search-commits-view- 'Jump to the Search Commits view docs') to search and explore commit histories by message, author, files, id, etc &mdash; closes [#455](https://github.com/eamodio/vscode-gitlens/issues/455)
  <br/>[![Search Commits view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-search.png)](https://github.com/eamodio/vscode-gitlens/tree/master/#search-commits-view- 'Jump to the Search Commits view docs')
  - Provides somewhat similar features to the former _Results_ view as well as it is now a persistent view, makes it easier to start a commit search, and [more](https://github.com/eamodio/vscode-gitlens/tree/master/#search-commits-view- 'Jump to the Search Commits view docs')
- Adds an all-new [_Compare_ view](https://github.com/eamodio/vscode-gitlens/tree/master/#compare-view- 'Jump to the Compare view docs') to visualize comparisons between branches, tags, commits, and more
  <br/>[![Compare view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/docs/view-compare.png)](https://github.com/eamodio/vscode-gitlens/tree/master/#compare-view- 'Jump to the Compare view docs')
  - Provides somewhat similar and powerful features to the former _Results_ view as well as it is now a persistent view, makes it easier to start a comparison, and [more](https://github.com/eamodio/vscode-gitlens/tree/master/#compare-view- 'Jump to the Compare view docs')
- Reduces the overhead of all GitLens views &mdash; GitLens now only tracks changes and updates the views if they are visible, collapsed or hidden views should have almost zero overhead
- Adds relative date markers (_Less than a week ago_, _Over a week ago_, _Over a month ago_, etc) to revision (commit) histories in GitLens views
- Adds branch and tag tip markers to revision (commit) histories in GitLens views &mdash; closes [#560](https://github.com/eamodio/vscode-gitlens/issues/560)
- Adds a changes indicator (+x ~x -x) to commits in GitLens views (uses the new `${changes}` token in the `gitlens.views.commitFormat` setting) &mdash; closes [#493](https://github.com/eamodio/vscode-gitlens/issues/493)
- Adds the _Show Commit in View_ command to commits in GitLens views to quickly open the commit in the _Search Commits_ view &mdash; closes [#502](https://github.com/eamodio/vscode-gitlens/issues/502)
- Adds the _Open Changes (with difftool)_ command to files in GitLens views &mdash; closes [#389](https://github.com/eamodio/vscode-gitlens/issues/389)
- Adds an _Expand_ command to some GitLens view nodes to expand them &mdash; closes [#275](https://github.com/eamodio/vscode-gitlens/issues/275)
- Adds a _Fetch Repositories_ (`gitlens.fetchRepositories`) command to fetch **all** of the open repositories
- Adds a _Pull Repositories_ (`gitlens.pullRepositories`) command to pull **all** of the open repositories
- Adds a _Push Repositories_ (`gitlens.pushRepositories`) command to push **all** of the open repositories (becareful with this one)
- Adds a _Show Line History View_ (`gitlens.showLineHistoryView`) command to open the _Line History_ view
- Adds a _Show Commit in View_ (`gitlens.showCommitInView`) command to open a commit in the _Search Commits_ view
- Adds a _Show File History in View_ (`gitlens.showFileHistoryInView`) command to open a file's revision (commit) history in the _File History_ view
- Adds a _Show Commit in View_ (`gitlens.showCommitInView`) command to quickly open the current line's commit in the _Search Commits_ view
- Adds a _Show Revision Details_ (`gitlens.showQuickRevisionDetails`) command to quickly show the revision (commit) details of the current file revision
- Adds the _Open Changes with Working File_ (`gitlens.diffWithWorking`) command to the editor toolbar when comparing revisions
- Adds comparisons to commit ids, by prefixing with a `#`, in addition to branches and tags &mdash; closes [#535](https://github.com/eamodio/vscode-gitlens/issues/535)
- Adds support for git mailmap &mdash; closes [#388](https://github.com/eamodio/vscode-gitlens/issues/388)
- Adds support for Azure DevOps (formerly VSTS) remotes &mdash; closes [#501](https://github.com/eamodio/vscode-gitlens/issues/501)
- Adds better detection of on-prem BitBucket and GitLab remotes &mdash; closes [#214](https://github.com/eamodio/vscode-gitlens/issues/214)
- Adds some missing gitmojis &mdash; thanks to [PR #510](https://github.com/eamodio/vscode-gitlens/pull/510) by Loris Bettazza ([@Pustur](https://github.com/Pustur))
- Adds a `gitlens.codeLens.includeSingleLineSymbols` setting to specify whether to provide any Git code lens on symbols that span only a single line
- Adds smooth scrolling to the interactive settings editor when using the _Jump To_ links

### Changed

- Changes the sorting of branch, tags, and files in GitLens views to be a natural sort &mdash; closes [#547](https://github.com/eamodio/vscode-gitlens/issues/547)
- Changes the _Apply Changes_ command to truly apply only the patch of the specified change &mdash; closes [#539](https://github.com/eamodio/vscode-gitlens/issues/539)
- Changes Azure Pipelines documents to use document scope only by default &mdash; thanks to [PR #548](https://github.com/eamodio/vscode-gitlens/pull/548) by Matt Cooper ([@vtbassmatt](https://github.com/vtbassmatt))
- Renames _Compare File with Branch or Tag..._ (`gitlens.diffWithBranch`) command to _Open Changes with Branch or Tag..._
- Renames _Compare File with Next Revision_ (`gitlens.diffWithNext`) command to _Open Changes with Next Revision_
- Renames _Compare File with Previous Revision_ (`gitlens.diffWithPrevious`) command to _Open Changes with Previous Revision_
- Renames _Compare Commit with Previous_ (`gitlens.diffLineWithPrevious`) command to _Open Line Changes with Previous Revision_
- Renames _Compare File with Revision..._ (`gitlens.diffWithRevision`) command to _Open Changes with Revision..._
- Renames _Compare File with Working Revision_ (`gitlens.diffWithWorking`) command to _Open Changes with Working File_
- Renames _Compare Commit with Working File_ (`gitlens.diffLineWithWorking`) command to _Open Line Changes with Working File_
- Renames _\* in Remote_ commands to _\* on Remote_
- Renames and migrates `gitlens.explorers.*` settings to `gitlens.views.*`
- Renames and migrates `gitlens.gitExplorer.*` settings to `gitlens.views.repositories.*`
- Renames and migrates `gitlens.historyExplorer.*` settings to `gitlens.views.fileHistory.*` and `gitlens.views.lineHistory.*`
- Renames and migrates `gitlens.resultsExplorer.*` settings to `gitlens.views.search.*` and `gitlens.views.compare.*`
- Replaces _Show GitLens Explorer_ (`gitlens.showGitExplorer`) command with _Show Repositories View_ (`gitlens.showRepositoriesView`)
- Replaces _Show File History Explorer_ (`gitlens.showHistoryExplorer`) command with _Show File History View_ (`gitlens.showFileHistoryView`)
- Replaces _Show Results Explorer_ (`gitlens.showResultsExplorer`) command with _Show Search Commits View_ (`gitlens.showSearchView`) and _Show Compare View_ (`gitlens.showCompareView`)
- Switches to use the new git extension's api to get the git path

### Fixed

- Fixes [#405](https://github.com/eamodio/vscode-gitlens/issues/405) - Secondary, blank repository appears repeatedly in Repositories view
- Fixes [#430](https://github.com/eamodio/vscode-gitlens/issues/430) - File revisions can end up being parsed by language servers (causing errors and warnings, etc)
- Fixes [#496](https://github.com/eamodio/vscode-gitlens/issues/496) - Short hash length doesn't match git's default length
- Fixes [#503](https://github.com/eamodio/vscode-gitlens/issues/503) - Open Changes (with difftool) opens one difftool window per changed file
- Fixes [#507](https://github.com/eamodio/vscode-gitlens/issues/507) - Restrict commit message size
- Fixes [#527](https://github.com/eamodio/vscode-gitlens/issues/527) - GitLens icon flashes on startup
- Fixes [#533](https://github.com/eamodio/vscode-gitlens/issues/533) - Some descriptions not using markdown properly in Settings GUI
- Fixes [#544](https://github.com/eamodio/vscode-gitlens/issues/544) - Some commit messages have one letter missing
- Fixes CHANGELOG issue &mdash; thanks to [PR #558](https://github.com/eamodio/vscode-gitlens/pull/558) by Ash Clarke ([@ashclarke](https://github.com/ashclarke))

### Removed

- Removes `gitlens.advanced.git` setting as it is no longer needed

## [8.5.6] - 2018-08-21

### Fixed

- Fixes [#477](https://github.com/eamodio/vscode-gitlens/issues/477) - Can't load any GitLens features or UI
- Fixes [#482](https://github.com/eamodio/vscode-gitlens/issues/482) - UI displays "undefined" in results panel when comparing

## [8.5.5] - 2018-08-18

### Added

- Adds _Copy Remote File Url to Clipboard_ (`gitlens.copyRemoteFileUrlToClipboard`) command &mdash; copies the remote url of the current file and line to the clipboard &mdash; closes [#467](https://github.com/eamodio/vscode-gitlens/issues/467)

### Fixed

- Fixes [#471](https://github.com/eamodio/vscode-gitlens/issues/471) - Don't use Ctrl+Alt+[character] as a shortcut
- Fixes [#478](https://github.com/eamodio/vscode-gitlens/issues/478) - `suppressShowKeyBindingsNotice` gets saved even when it is not required
- Fixes [#468](https://github.com/eamodio/vscode-gitlens/issues/468) - Commit history for detached HEAD doesn't work properly

## [8.5.4] - 2018-07-31

### Added

- Adds _Checkout Commit (via Terminal)_ command (`gitlens.terminalCheckoutCommit`) to commit node(s) of the _GitLens_ explorer &mdash; closes [#463](https://github.com/eamodio/vscode-gitlens/issues/463)

### Changed

- Improves performance of providing blame annotations, especially for large files (a ~33% improvement on some files)
- Changes commit search by sha to jump directly to the commit (if one is found), rather than having to click through to the commit
- Updates settings descriptions to better support the new settings editor in vscode
- Changes _Rebase to Commit (via Terminal)_ command (`gitlens.terminalRebaseCommit`) to apply to all commit node(s) of the _GitLens_ explorer
- Changes _Reset to Commit (via Terminal)_ command (`gitlens.terminalResetCommit`) to apply to all commit node(s) of the _GitLens_ explorer

### Fixed

- Fixes [#462](https://github.com/eamodio/vscode-gitlens/issues/462) - Source Control shortcut on macOS (⌃⇧G) shouldn't be overridden
- Fixes [#457](https://github.com/eamodio/vscode-gitlens/issues/457) - Displays the wrong username (You) &mdash; thanks to [PR #460](https://github.com/eamodio/vscode-gitlens/pull/460) by Zyck ([@qzyse2017](https://github.com/qzyse2017))
- Fixes [#459](https://github.com/eamodio/vscode-gitlens/issues/459) - File blame annotation text overflow with letter spacing setting
- Fixes issues with GitLens Welcome and the interactive settings editor with light themes

## [8.5.3] - 2018-07-25

### Fixed

- Fixes [#454](https://github.com/eamodio/vscode-gitlens/issues/454) - Search for string returns merge commits (unlike raw `git log -S`)
- Fixes issue showing changes with untracked stashed files
- Fixes issue showing changes with working file when the file has been renamed

## [8.5.2] - 2018-07-20

### Fixed

- Fixes [#451](https://github.com/eamodio/vscode-gitlens/issues/451) - "apply Changes" has discarded all my changes
- Fixes [#449](https://github.com/eamodio/vscode-gitlens/issues/449) - Stop hiding explorers by default when in Zen mode

## [8.5.1] - 2018-07-18

### Added

- Adds emoji support, e.g. `:smile:` in commit messages will now be 😃 &mdash; closes [#429](https://github.com/eamodio/vscode-gitlens/issues/429)
- Adds _Compare with Selected_ and _Select for Compare_ commands to file nodes in the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers &mdash; closes [#446](https://github.com/eamodio/vscode-gitlens/issues/446)
- Adds `gitlens.historyExplorer.avatars` setting to specify whether to show avatar images instead of status icons in the `GitLens File History` explorer &mdash; allows for an independent value from the other explorers

### Fixed

- Fixes [#444](https://github.com/eamodio/vscode-gitlens/issues/444) - GitLens custom viewlet icon slightly larger than standard
- Fixes [#437](https://github.com/eamodio/vscode-gitlens/issues/437) - Remove `--first-parent` from git commands to show file history from merged in repositories
- Fixes [#252](https://github.com/eamodio/vscode-gitlens/issues/252) - Cannot read property 'push' of undefined
- Fixes issue where GitLens saves a couple settings with default values into user settings (rather than just removing the setting)

## [8.5.0] - 2018-07-16

### Added

- Adds an all-new _GitLens_ sidebar view to contain the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers
- The new view is enabled by default, but can easily be configured back to the existing locations via the _GitLens_ interactive settings editor
- Adds tag annotations to the tag tooltips in the _GitLens_ explorer &mdash; closes [#431](https://github.com/eamodio/vscode-gitlens/issues/431)
- Adds a `gitlens.hovers.avatars` setting to specify whether to show avatar images in hovers &mdash; closes [#432](https://github.com/eamodio/vscode-gitlens/issues/432) thanks to [PR #441](https://github.com/eamodio/vscode-gitlens/pull/441) by Segev Finer ([@segevfiner](https://github.com/segevfiner))
- Adds the `gitlens.hovers.avatars` setting to the _GitLens_ interactive settings editor to specify whether to show avatar images in hovers
- Adds _Choose from Branch or Tag History..._ command to the quick pick menu shown by the _Show File History..._ command (`gitlens.showQuickFileHistory`) &mdash; closes [#316](https://github.com/eamodio/vscode-gitlens/issues/316)
- Adds the _Compare File with Revision..._ command (`gitlens.diffWithRevision`) as an alternate (`alt+click`) for the _Compare File with Previous Revision_ command in the editor toolbar

### Changed

- Renames the _GitLens History_ explorer to _GitLens File History_ explorer for better clarity
- Changes the _GitLens File History_ explorer to always show the full file history even when reviewing revisions
- Changes the behavior of and renames the _Show Branches and Tags_ command and on the quick pick menu shown by the _Compare File with Revision..._ command (`gitlens.diffWithRevision`) to _Choose from Branch or Tag History..._
- Changes the behavior of and renames the _Show Branches and Tags_ command on the quick pick menu shown by the _Open Revision..._ command (`gitlens.openFileRevision`) to _Choose from Branch or Tag History..._

### Removed

- Removes `gitlens:activeIsTracked`, `gitlens:activeIsBlameable`, `gitlens:activeIsRevision`, and `gitlens:activeHasRemotes` contexts and consolidates them into `gitlens:activeFileStatus` for better performance and UX

### Fixed

- Fixes [#436](https://github.com/eamodio/vscode-gitlens/issues/436) - Copy to clipboard not working
- Fixes [#442](https://github.com/eamodio/vscode-gitlens/issues/442) - GitLens File History fails if name (or path) starts with `-`
- Fixes [#440](https://github.com/eamodio/vscode-gitlens/issues/440) - Searching for commits with an empty query yields to no results anymore
- Fixes issue where commands in the editor toolbar would flash unnecessarily when navigating history or switching tabs
- Fixes issue where the _Compare File with Previous Revision_ command wouldn't work properly when the file had been renamed in some cases
- Fixes issue where the _Compare File with Next Revision_ command wouldn't work properly when the file had been renamed in some cases
- Fixes issue where changed files count was wrong when the branch was behind the upstream
- Fixes issue where the _GitLens File History_ explorer wasn't being updated automatically for working changes
- Fixes issue where the _Compare File with \* Revision_ commands in the editor toolbar would show and hide too often because of insignificant focus changes
- Fixes issue where the scope box would be empty when there was no workspace open in the interactive settings editor

## [8.4.1] - 2018-06-19

### Fixed

- Fixes issue with insiders builds because of the new `SymbolInformation` API changes (see [Microsoft/vscode#34968](https://github.com/Microsoft/vscode/issues/34968))

## [8.4.0] - 2018-06-19

### Added

- Adds completely revamped heatmap annotations
  ![cold heatmap](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-heatmap-cold.png)
  - The indicator's color, now customizable, will either be hot or cold based on the age of the most recent change (cold after 90 days by default) &mdash; closes [#419](https://github.com/eamodio/vscode-gitlens/issues/419)
  - The indicator's brightness ranges from bright (newer) to dim (older) based on the relative age, which is calculated from the median age of all the changes in the file
  - Adds `gitlens.heatmap.ageThreshold` setting to specify the age of the most recent change (in days) after which the gutter heatmap annotations will be cold rather than hot (i.e. will use `gitlens.heatmap.coldColor` instead of `gitlens.heatmap.hotColor`)
  - Adds `gitlens.heatmap.coldColor` setting to specify the base color of the gutter heatmap annotations when the most recent change is older (cold) than the `gitlens.heatmap.ageThreshold` setting
  - Adds `gitlens.heatmap.hotColor` setting to specify the base color of the gutter heatmap annotations when the most recent change is newer (hot) than the `gitlens.heatmap.ageThreshold` setting
- Adds new branch history node under the _Repository Status_ node in the _GitLens_ explorer
- Adds GitLab and Visual Studio Team Services icons to the remote nodes in the _GitLens_ explorer &mdash; thanks to [PR #421](https://github.com/eamodio/vscode-gitlens/pull/421) by Maxim Pekurin ([@pmaxim25](https://github.com/pmaxim25))

### Fixed

- Fixes [#400](https://github.com/eamodio/vscode-gitlens/issues/412) - GitLens logging to debug console when debugging different extension
- Fixes [#409](https://github.com/eamodio/vscode-gitlens/issues/409) - Literal $(ellipsis) inserted into commit QuickPick menu entry placeholder text
- Fixes [#415](https://github.com/eamodio/vscode-gitlens/issues/415) - Branch names get mangled by color escapes &mdash; thanks to [PR #416](https://github.com/eamodio/vscode-gitlens/pull/416) by Roy Ivy III ([@rivy](https://github.com/rivy))

## [8.3.5] - 2018-06-08

### Fixed

- Fixes more instances of [#295](https://github.com/eamodio/vscode-gitlens/issues/295)and [#318](https://github.com/eamodio/vscode-gitlens/issues/318) - Any error encountered during the search for repositories could cause GitLens to die

## [8.3.4] - 2018-06-06

### Added

- Adds clipboard support for Linux without requiring any external dependencies &mdash; thanks to [PR #394](https://github.com/eamodio/vscode-gitlens/pull/394) by Cédric Malard ([@cmalard](https://github.com/cmalard))
- Adds a select branch quick pick menu to the _Open File in Remote_ command (`gitlens.openFileInRemote`) when the current branch has no upstream tracking branch &mdash; closes [#209](https://github.com/eamodio/vscode-gitlens/issues/209)

### Changed

- Moves the _Open Working File_ command (`gitlens.openWorkingFile`) to the right of the _Compare File with \* Revision_ commands in the editor toolbar

### Fixed

- Fixes [#400](https://github.com/eamodio/vscode-gitlens/issues/400) - Reset TO commit also resets chosen one
- Fixes [#399](https://github.com/eamodio/vscode-gitlens/issues/399) - "Open x in Remote" commands aren't always available
- Fixes [#397](https://github.com/eamodio/vscode-gitlens/issues/397) - Error while opening the gitlens view using `Open View` command
- Fixes [#391](https://github.com/eamodio/vscode-gitlens/issues/391) - GitLens adds some settings in settings.json
- Fixes another case of [#343](https://github.com/eamodio/vscode-gitlens/issues/343) - Can't show blame when VSCode starts on branch without upstream &mdash; thanks to [PR #390](https://github.com/eamodio/vscode-gitlens/pull/390) by ryenus ([@ryenus](https://github.com/ryenus))
- Fixes [#392](https://github.com/eamodio/vscode-gitlens/issues/392) - unable to contribute if default script shell is sh &mdash; thanks to [PR #393](https://github.com/eamodio/vscode-gitlens/pull/393) by Cédric Malard ([@cmalard](https://github.com/cmalard))
- Fixes issue with the `chorded` keyboard shortcut for the _Compare File with Previous Revision_ command (`gitlens.diffWithPreviousInDiff`) &mdash; from [#395](https://github.com/eamodio/vscode-gitlens/issues/395)
- Fixes the _Open Working File_ command (`gitlens.openWorkingFile`) not always showing in the editor toolbar when appropriate

## [8.3.3] - 2018-05-31

### Added

- Adds (re-adds) support for handling single files &mdash; closes [#321](https://github.com/eamodio/vscode-gitlens/issues/321)
- Adds _Close Repository_ (`gitlens.explorers.closeRepository`) command to repository and repository status nodes in the _GitLens_ explorer &mdash; closes (hides) the repository in the _GitLens_ explorer

### Fixed

- Fixes [#362](https://github.com/eamodio/vscode-gitlens/issues/362) - Too many code lenses in postcss files
- Fixes [#381](https://github.com/eamodio/vscode-gitlens/issues/381) - Can't stash single files with older versions of Git
- Fixes [#384](https://github.com/eamodio/vscode-gitlens/issues/384) - Absolute dates not always honored in _GitLens Results_ explorer
- Fixes [#385](https://github.com/eamodio/vscode-gitlens/issues/385) - Wrong git command to delete remote branch

## [8.3.2] - 2018-05-21

### Fixed

- Fixes [#366](https://github.com/eamodio/vscode-gitlens/issues/366) - Running a GitLens command from a keybinding fails (more cases)
- Fixes many issues where commands wouldn't work if the active file wasn't part of an open repository &mdash; now GitLens will try to find the best repository otherwise it will open a repository quick pick menu if there is more than one

## [8.3.1] - 2018-05-18

### Added

- Adds the ability to control where the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers are shown 🎉 &mdash; closes [#213](https://github.com/eamodio/vscode-gitlens/issues/213), [#377](https://github.com/eamodio/vscode-gitlens/issues/377)
  - Adds `gitlens.gitExplorer.location` setting to the interactive settings editor to specify where the _GitLens_ explorer is shown &mdash; either in the _Explorer_ or _Source Control_ view
  - Adds `gitlens.historyExplorer.location` setting to the interactive settings editor to specify where the _GitLens File History_ explorer is shown &mdash; either in the _Explorer_ or _Source Control_ view
  - Adds `gitlens.resultsView.location` setting to the interactive settings editor to specify where the _GitLens Results_ explorer is shown &mdash; either in the _Explorer_ or _Source Control_ view

### Changed

- Renames _GitLens Results_ view to _GitLens Results_ explorer for consistency

### Fixed

- Fixes [#372](https://github.com/eamodio/vscode-gitlens/issues/372) - Wrong URL to VSTS work item when using hash work item id in commit

## [8.3.0] - 2018-05-17

### Added

- Adds user-defined modes for quickly toggling between sets of settings

  ![mode switch](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-mode-switch.png)

  - Adds _Switch Mode_ command (`gitlens.switchMode`) to quickly switch the active GitLens mode
  - Adds a built-in _Zen_ mode which for a zen-like experience, disables many visual features
    - Adds _Toggle Zen Mode_ command (`gitlens.toggleZenMode`) to toggle Zen mode
  - Adds a built-in _Review_ mode which for reviewing code, enables many visual features
    - Adds _Toggle Review Mode_ command (`gitlens.toggleReviewMode`) to toggle Review mode
  - Adds the active mode to the status bar, optional (on by default)
    - Adds `gitlens.mode.statusBar.enabled` setting to specify whether to provide the active GitLens mode in the status bar
    - Adds `gitlens.mode.statusBar.alignment` setting to specify the active GitLens mode alignment in the status bar
  - Adds modes settings (`gitlens.mode.*`) to the interactive settings editor

    ![modes settings](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-modes-settings.png)

  - Adds `gitlens.mode.active` setting to specify the active GitLens mode, if any
  - Adds `gitlens.modes` setting to specify the user-defined GitLens modes

- Adds an icon for the _Compare File with Previous Revision_ command (`gitlens.diffWithPrevious`) and moves it into the editor toolbar
- Adds an icon for the _Compare File with Next Revision_ command (`gitlens.diffWithNext`) and moves it into the editor toolbar
- Adds menu settings (`gitlens.menus.*`) to the interactive settings editor

  ![menu settings](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-menu-settings.png)

- Adds a display mode dropdown at the top of the interactive settings editor to reduce complexity

  ![settings mode](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-settings-mode.png)

  - Adds `gitlens.settings.mode` setting to specify the display mode of the interactive settings editor

- Adds a tree layout option to tags in the _GitLens_ explorer &mdash; closes [#358](https://github.com/eamodio/vscode-gitlens/issues/358)
- Adds _Show GitLens Explorer_ (`gitlens.showGitExplorer`) command &mdash; shows/expands the _GitLens_ explorer
- Adds _Show File History Explorer_ (`gitlens.showHistoryExplorer`) command &mdash; shows/expands the _GitLens File History_ explorer
- Adds _Show Results Explorer_ (`gitlens.showResultsView`) command &mdash; shows/expands the _GitLens Results_ explorer

### Changed

- Moves the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers under the Source Control activity (in the sidebar) 🎉 &mdash; closes [#213](https://github.com/eamodio/vscode-gitlens/issues/213)
- Showing results in the _GitLens Results_ explorer now properly shows the explorer first
- Renames _Compare Line Revision with Previous_ command (`gitlens.diffLineWithPrevious`) to _Compare Commit with Previous_ for consistency with other commands
- Renames _Compare Line Revision with Working File_ command (`gitlens.diffLineWithWorking`) to _Compare Commit with Working File_ for consistency with other commands
- Renames _Show Commit File Details_ command (`gitlens.showQuickCommitFileDetails`) to _Show Commit Details_ for consistency with other commands
- Reworks GitLens menu contributions and configuration &mdash; see menu settings above
  - Renames the `gitlens.advanced.menus` setting to `gitlens.menus`
- Uses the new Webview API for better interactions and behavior with the interactive settings editor and welcome page

### Fixed

- Fixes [#366](https://github.com/eamodio/vscode-gitlens/issues/366) - Running a GitLens command from a keybinding fails
- Fixes [#155](https://github.com/eamodio/vscode-gitlens/issues/155) - Navigating file diffs with `alt+,` gets stuck
- Fixes [#359](https://github.com/eamodio/vscode-gitlens/issues/359) - Show changes of an added file in the first commit
- Fixes _bronze_ typo thanks to [PR #361](https://github.com/eamodio/vscode-gitlens/pull/361) by Cory Forsyth ([@bantic](https://github.com/bantic))
- Fixes _individually_ typo thanks to [PR #364](https://github.com/eamodio/vscode-gitlens/pull/364) by Brett Cannon ([@brettcannon](https://github.com/brettcannon))
- Fixes issue where comparing previous revision during a merge/rebase conflict failed to show the correct contents
- Fixes issue with the current line blame toggle not working when current line blame starts disabled
- Fixes various issues when not on a branch

## [8.2.4] - 2018-04-22

### Added

- Adds a visible error message for when Git is disabled (`"git.enabled": false`) &mdash; for [#318](https://github.com/eamodio/vscode-gitlens/issues/318)

## [8.2.3] - 2018-04-21

### Fixed

- Fixes [#313](https://github.com/eamodio/vscode-gitlens/issues/313) - Unable to show branch history for branch that matches file or folder name
- Fixes [#348](https://github.com/eamodio/vscode-gitlens/issues/348) - "Open in remote" commands disappeared from command palette
- Fixes JSON schema of the `gitlens.advanced.blame.customArguments` setting

## [8.2.2] - 2018-04-19

### Added

- Adds an indicator to the _GitLens_ explorer's branch history to mark the the tips of all branches
- Adds `gitlens.advanced.blame.customArguments` setting to specify additional arguments to pass to the `git blame` command &mdash; closes [#337](https://github.com/eamodio/vscode-gitlens/issues/337)

### Changed

- Changes the author name to "You" when appropriate &mdash; closes [#341](https://github.com/eamodio/vscode-gitlens/issues/341)

### Fixed

- Fixes [#345](https://github.com/eamodio/vscode-gitlens/issues/345) - Custom date formats don't work in the GitLens view
- Fixes [#336](https://github.com/eamodio/vscode-gitlens/issues/336) - Default Settings Get Added Automatically
- Fixes [#342](https://github.com/eamodio/vscode-gitlens/issues/342) - GitLens crashes while debugging with Chrome Debugger a larger project
- Fixes [#343](https://github.com/eamodio/vscode-gitlens/issues/343) - Can't show blame when VSCode starts on branch without upstream
- Fixes issue where username and/or password in a remote urls could be shown

## [8.2.1] - 2018-04-11

### Added

- Adds better logging for failed git commands

### Changed

- Marks temporary files (used when showing comparisons with previous revisions) as read-only to help avoid accidental edits/saving

### Fixed

- Fixes [#320](https://github.com/eamodio/vscode-gitlens/issues/320) - Stashes with a single untracked file created with "stash push" aren't shown in the GitLens explorer
- Fixes [#331](https://github.com/eamodio/vscode-gitlens/issues/331) - Code lens shows on every import in Python
- Fixes issues where quick pick menu progress indicators will get stuck in some cases because of a vscode api change in [Microsoft/vscode#46102](https://github.com/Microsoft/vscode/pull/46102)

## [8.2.0] - 2018-03-31

### Added

- Adds new stand-alone _GitLens File History_ explorer to visualize the history of the current file &mdash; undocked version of the _GitLens_ explorer history view

  ![GitLens File History explorer](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-gitlens-history-explorer.png)

- Adds richer tooltips to the _GitLens_ and _GitLens Results_ explorers, and richer working tree and upstream status to the _GitLens_ explorer

  ![Rich tooltips](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-rich-tooltips.png)

- Adds an indicator to the _GitLens_ explorer's branch history to mark the synchronization point between the local and remote branch (if available)

  ![Branch upstream indicator](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-branch-upstream-indicator.png)

- Adds ability to easily switch between relative and absolute dates via the `gitlens.defaultDateStyle` settings &mdash; closes [#312](https://github.com/eamodio/vscode-gitlens/issues/312)

  - Adds `${agoOrDate}` and `${authorAgoOrDate}` tokens to `gitlens.blame.format`, `gitlens.currentLine.format`, `gitlens.explorers.commitFormat`, `gitlens.explorers.stashFormat`, and `gitlens.statusBar.format` settings which will honor the `gitlens.defaultDateStyle` setting

  ![General settings](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-general-settings.png)

- Adds annotation format settings (`gitlens.*.format`) to the interactive settings editor

  ![Annotation format settings](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-annotation-format.png)

- Adds new `gitlens.currentLine.scrollable` setting to specify whether the current line blame annotation can be scrolled into view when it is outside the viewport &mdash; closes [#149](https://github.com/eamodio/vscode-gitlens/issues/149), [#290](https://github.com/eamodio/vscode-gitlens/issues/290), [#265](https://github.com/eamodio/vscode-gitlens/issues/265)

  ![Allow scrolling to annotation setting](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-current-line-scrollable.png)

- Adds `gitlens.statusBar.reduceFlicker` setting to the interactive settings editor

  ![Reduce status bar flashing setting](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-status-bar-reduce-flashing.png)

- Adds a one-time notification on startup if the `alt-based` keyboard shortcuts are in use, with options to easily switch to another set
- Adds _Copy Commit ID to Clipboard_ (`gitlens.copyShaToClipboard`) command to changed file nodes in the _GitLens_ explorer and _GitLens Results_ explorer
- Adds _Copy Commit Message to Clipboard_ (`gitlens.copyMessageToClipboard`) command to changed file nodes in the _GitLens_ explorer and _GitLens Results_ explorer

### Changed

- Moves _Keyboard Settings_ to the _General_ section of the interactive settings editor
- Renames _Compare with Index (HEAD)_ (`gitlens.explorers.compareWithHead`) command to _Compare with HEAD_ &mdash; closes [#309](https://github.com/eamodio/vscode-gitlens/issues/309)
- Renames _Compare Index (HEAD) with Branch or Tag..._ (`gitlens.diffHeadWithBranch`) command to _Compare HEAD with Branch or Tag..._ &mdash; closes [#309](https://github.com/eamodio/vscode-gitlens/issues/309)

### Removed

- Removes the unnecessary _Show File Blame Annotations_ (`gitlens.showFileBlame`) command &mdash; _Toggle File Blame Annotations_ (`gitlens.toggleFileBlame`) provides similar functionality
- Removes the unnecessary _Show Line Blame Annotations_ (`gitlens.showLineBlame`) command &mdash; _Toggle Line Blame Annotations_ (`gitlens.toggleLineBlame`) provides similar functionality
- Removes _Open Working File_ (`gitlens.openWorkingFile`) command from the editor toolbar when the built-in _Open File_ command is visible
- Removes _Compare with HEAD_ (`gitlens.explorers.compareWithHead`), _Compare with Working Tree_ (`gitlens.explorers.compareWithWorking`), and _Compare Compare Ancestry with Working Tree_ (`gitlens.explorers.compareAncestryWithWorking`) commands from the current branch since comparing a branch with itself doesn't make sense &mdash; closes [#309](https://github.com/eamodio/vscode-gitlens/issues/309)

### Fixed

- Fixes [#314](https://github.com/eamodio/vscode-gitlens/issues/314) - Toggle line annotation doesn't work properly
- Fixes [#310](https://github.com/eamodio/vscode-gitlens/issues/310) - "via Terminal" commands need quoting around work directory
- Fixes issues with the active repository in the _GitLens_ explorer failed to update properly
- Fixes issues with _Open File_, _Open Revision_, and _Show File History_ commands and images and other binary files
- Fixes issues preventing nodes in the _GitLens_ explorer from expanding properly in certain cases
- Fixes issues when refreshing nodes in the _GitLens Results_ explorer

## [8.1.1] - 2018-03-12

### Fixed

- Fixes [#276](https://github.com/eamodio/vscode-gitlens/issues/276) - Lookup for branches without upstreams fails
- Fixes the schema of the `gitlens.codeLens.scopesByLanguage` setting

## [8.1.0] - 2018-03-07

### Added

- Adds automatic issue linking to Bitbucket, GitHub, GitLab, and Visual Studio Team Services for commit messages in hovers

  ![Issue linking in commit messages](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-issue-linking.png)

- Adds support to toggle annotations for each file individually or for all files at once &mdash; closes [#289](https://github.com/eamodio/vscode-gitlens/issues/289)

  ![Annotations toggle setting](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-annotations-toggle.png)

  - Adds new controls the interactive settings editor (_Open Settings_ from the Command Palette) to configure this new behavior
  - Adds `gitlens.blame.toggleMode` setting to specify how the gutter blame annotations will be toggled, per file or window
  - Adds `gitlens.heatmap.toggleMode` setting to specify how the gutter heatmap annotations will be toggled, per file or window
  - Adds `gitlens.recentChanges.toggleMode` setting to specify how the recently changed lines annotations will be toggled, per file or window

- Adds icons to remotes in the _GitLens_ explorer based on the remote service provider
- Adds multi-cursor support to current line annotations &mdash; closes [#291](https://github.com/eamodio/vscode-gitlens/issues/291)

### Changed

- Renames _Compare Selected Ancestor with Working Tree_ command to _Compare Ancestry with Working Tree_ and removes the need to select a branch first, since all compares are performed with the working tree &mdash; closes [#279](https://github.com/eamodio/vscode-gitlens/issues/279)

### Removed

- Removes tag icons from the _GitLens_ explorer

### Fixed

- Fixes [#294](https://github.com/eamodio/vscode-gitlens/issues/294) - Keyboard shortcuts will now default to _chorded_ to avoid conflicts. Only affects new installs or if you remove the `gitlens.keymap` setting
- Fixes issue where Recent Changes annotations weren't restored properly on tab switch
- Fixes quick pick menu issue with commits with newlines in the message

## [8.0.2] - 2018-02-19

### Fixed

- Fixes button colors on the Welcome and Settings pages to follow the color theme properly

## [8.0.1] - 2018-02-18

### Added

- Adds _Compare Index (HEAD) with Branch or Tag..._ (`gitlens.explorers.diffHeadWithBranch`) command - compares the index (HEAD) to the selected branch or tag &mdash; thanks to [PR #278](https://github.com/eamodio/vscode-gitlens/pull/278) by Geoffrey ([@g3offrey](https://github.com/g3offrey))!
- Adds _Compare Working Tree with Branch or Tag..._ (`gitlens.explorers.diffWorkingWithBranch`) command - compares the working tree to the selected branch or tag
- Adds `gitlens.statusBar.reduceFlicker` setting to specify whether to reduce the status bar "flickering" when changing lines by not first clearing the previous blame information &mdash; closes [#272](https://github.com/eamodio/vscode-gitlens/issues/272)
- Adds the _Open File_ (`gitlens.explorers.openFile`) command to the _GitLens_ explorer's inline toolbar for file nodes
- Adds the _Clear Results_ (`gitlen.resultsExplorer.clearResultsNode`) command to the _GitLens Results_ explorer's inline toolbar for results nodes
- Adds the _Swap Comparison_ (`gitlen.resultsExplorer.swapComparison`) command to the _GitLens Results_ explorer's inline toolbar and context menu for comparison results nodes
- Adds _Push to Commit (via Terminal)_ (`gitlens.explorers.terminalPushCommit`) command to commit nodes on the current branch in the _GitLens_ explorer

## Changed

- Uses vscode's `git.path` setting when searching for the git executable

### Fixed

- Fixes [#276](https://github.com/eamodio/vscode-gitlens/issues/276) - Lookup for branches without upstreams fails
- Fixes [#274](https://github.com/eamodio/vscode-gitlens/issues/274) - TextEditor is closed/disposed occurs when this extension is enabled
- Fixes [#288](https://github.com/eamodio/vscode-gitlens/issues/288) - CSS errors on welcome page (mask-\* properties)
- Fixes issues with settings migration &mdash; should now migrate any existing settings that haven't already been set

## [8.0.0] - 2018-02-07

### Added

- Adds an all-new GitLens welcome page via the _Welcome_ (`gitlens.showWelcomePage`) command &mdash; provides a welcome / onboarding experience &mdash; closes [#51](https://github.com/eamodio/vscode-gitlens/issues/51)

  ![GitLens Welcome](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-welcome.png)

- Adds an all-new GitLens Settings editor via the _Open Settings_ (`gitlens.showSettingsPage`) command &mdash; provides an easy-to-use interactive settings editor for many of GitLens' features &mdash; closes [#167](https://github.com/eamodio/vscode-gitlens/issues/167)

  ![GitLens Settings](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-settings.png)

- Adds a tree layout option to branches in the _GitLens_ explorer &mdash; closes [#258](https://github.com/eamodio/vscode-gitlens/issues/258) thanks to [PR #260](https://github.com/eamodio/vscode-gitlens/pull/260) by Yukai Huang ([@Yukaii](https://github.com/Yukaii))!
- Adds _Follow Renames_ command (`gitlens.gitExplorer.setRenameFollowingOn`) to the _GitLens_ explorer _History_ view to follow file renames in the history
- Adds _Don't Follow Renames_ command (`gitlens.gitExplorer.setRenameFollowingOff`) to the _GitLens_ explorer _History_ view to not follow file renames in the history
- Adds `gitlens.advanced.fileHistoryFollowsRenames` setting to specify whether file histories will follow renames -- will affect how merge commits are shown in histories &mdash; closes [#259](https://github.com/eamodio/vscode-gitlens/issues/259)
- Adds `gitlens.hovers.enabled` setting to specify whether to provide any hovers
- Adds `gitlens.hovers.annotations.enabled` setting to specify whether to provide any hovers when showing blame annotations
- Adds `gitlens.hovers.currentLine.enabled` setting to specify whether to provide any hovers for the current line
- Adds `gitlens.showWhatsNewAfterUpgrades` setting to specify whether to show What's New after upgrading to new feature releases
- Adds `debug` option to the `gitlens.outputLevel` setting &mdash; outputs git commands to a new output channel called _GitLens (Git)_

### Changed

- Renames _GitLens_ view to _GitLens_ explorer
- Renames _Show Files in Automatic View_ (`gitlens.gitExplorer.setFilesLayoutToAuto`) command to _Automatic Layout_
- Renames _Show Files in List View_ (`gitlens.gitExplorer.setFilesLayoutToList`) command to _List Layout_
- Renames _Show Files in Tree View_ (`gitlens.gitExplorer.setFilesLayoutToTree`) command to _Tree Layout_
- Renames _Show Files in Automatic View_ (`gitlens.resultsView.setFilesLayoutToAuto`) command to _Automatic Layout_
- Renames _Show Files in List View_ (`gitlens.resultsView.setFilesLayoutToAuto`) command to _List Layout_
- Renames _Show Files in Tree View_ (`gitlens.resultsView.setFilesLayoutToAuto`) command to _Tree Layout_
- Overhauls GitLens' settings for better clarity and ease-of-use
- Renames `gitlens.annotations.file.gutter.gravatars` setting to `gitlens.blame.avatars`
- Renames `gitlens.annotations.file.gutter.compact` setting to `gitlens.blame.compact`
- Renames `gitlens.annotations.file.gutter.dateFormat` setting to `gitlens.blame.dateFormat`
- Renames `gitlens.annotations.file.gutter.format` setting to `gitlens.blame.format`
- Renames `gitlens.annotations.file.gutter.heatmap.enabled` setting to `gitlens.blame.heatmap.enabled`
- Renames `gitlens.annotations.file.gutter.heatmap.location` setting to `gitlens.blame.heatmap.location`
- Renames `gitlens.blame.file.lineHighlight.enabled` setting to `gitlens.blame.highlight.enabled`
- Renames `gitlens.blame.file.lineHighlight.locations` setting to `gitlens.blame.highlight.locations`
- Renames `gitlens.annotations.file.gutter.separateLines` setting to `gitlens.blame.separateLines`
- Renames `gitlens.codeLens.locations` setting to `gitlens.codeLens.scopes`
- Renames `gitlens.codeLens.perLanguageLocations` setting to `gitlens.codeLens.scopesByLanguage`
- Renames `gitlens.codeLens.customLocationSymbols` setting to `gitlens.codeLens.symbolScopes`
- Renames `gitlens.annotations.line.trailing.dateFormat` setting to `gitlens.currentLine.dateFormat`
- Renames `gitlens.blame.line.enabled` setting to `gitlens.currentLine.enabled`
- Renames `gitlens.annotations.line.trailing.format` setting to `gitlens.currentLine.format`
- Renames `gitlens.gitExplorer.gravatars` setting to `gitlens.explorers.avatars`
- Renames `gitlens.gitExplorer.commitFileFormat` setting to `gitlens.explorers.commitFileFormat`
- Renames `gitlens.gitExplorer.commitFormat` setting to `gitlens.explorers.commitFormat`
- Renames `gitlens.gitExplorer.stashFileFormat` setting to `gitlens.explorers.stashFileFormat`
- Renames `gitlens.gitExplorer.stashFormat` setting to `gitlens.explorers.stashFormat`
- Renames `gitlens.gitExplorer.statusFileFormat` setting to `gitlens.explorers.statusFileFormat`
- Renames `gitlens.annotations.file.gutter.hover.changes` setting to `gitlens.hovers.annotations.changes`
- Renames `gitlens.annotations.file.gutter.hover.details` setting to `gitlens.hovers.annotations.details`
- Renames `gitlens.annotations.file.gutter.hover.wholeLine` setting to `gitlens.hovers.annotations.over`
- Renames `gitlens.annotations.line.trailing.hover.changes` setting to `gitlens.hovers.currentLine.changes`
- Renames `gitlens.annotations.line.trailing.hover.details` setting to `gitlens.hovers.currentLine.details`
- Renames `gitlens.annotations.line.trailing.hover.wholeLine` setting to `gitlens.hovers.currentLine.over`
- Renames `gitlens.recentChanges.file.lineHighlight.locations` setting to `gitlens.recentChanges.highlight.locations`

### Removed

- Removes `gitlens.codeLens.debug` setting, use `gitlens.debug` instead
- Removes `gitlens.blame.file.annotationType` setting, use `gitlens.hovers.annotations.enabled`
- Removes `gitlens.blame.line.annotationType` setting, use `gitlens.currentLine.enabled` or `gitlens.hovers.currentLine.enabled` instead
- Removes `gitlens.resultsView.gravatars` setting, use `gitlens.explorers.avatars` instead
- Removes `gitlens.resultsView.commitFileFormat` setting, use `gitlens.explorers.commitFileFormat` instead
- Removes `gitlens.resultsView.commitFormat` setting, use `gitlens.explorers.commitFormat` instead
- Removes `gitlens.resultsView.showTrackingBranch` setting
- Removes `gitlens.resultsView.stashFileFormat` setting, use `gitlens.explorers.stashFileFormat` instead
- Removes `gitlens.resultsView.stashFormat` setting, use `gitlens.explorers.stashFormat` instead
- Removes `gitlens.resultsView.statusFileFormat` setting, use `gitlens.explorers.statusFileFormat` instead
- Removes `gitlens.annotations.file.hover.changes` setting, use `gitlens.hovers.annotations.changes` instead
- Removes `gitlens.annotations.file.hover.details` setting, use `gitlens.hovers.annotations.details` instead
- Removes `gitlens.annotations.file.hover.heatmap.enabled` setting
- Removes `gitlens.annotations.file.recentChanges.hover.changes` setting, use `gitlens.hovers.annotations.changes` instead
- Removes `gitlens.annotations.file.recentChanges.hover.details` setting, use `gitlens.hovers.annotations.details` instead
- Removes `gitlens.annotations.line.hover.changes` setting, use `gitlens.hovers.annotations.changes` instead
- Removes `gitlens.annotations.line.hover.details` setting, use `gitlens.hovers.annotations.details` instead

### Fixed

- Fixes [#35](https://github.com/eamodio/vscode-gitlens/issues/35) - Copy Commit Sha to Clipboard not working (linux)
- Fixes issue where the last commit of a file history would be broken (failed to parse correctly)
- Fixes issue with _Open Working File_ command (`gitlens.openWorkingFile`) failing when a file was renamed

## [7.5.10] - 2018-02-01

### Added

- Adds support for custom remotes with split project/repo url structure &mdash; closes [#267](https://github.com/eamodio/vscode-gitlens/issues/267)

### Fixed

- Fixes [#266](https://github.com/eamodio/vscode-gitlens/issues/266) - Wrong time in Popup
- Fixes [#259](https://github.com/eamodio/vscode-gitlens/issues/259) (again) - File history lists unrelated merge commits

## [7.5.9] - 2018-01-30

### Fixed

- Fixes [#265](https://github.com/eamodio/vscode-gitlens/issues/265) - Delete line pushes screen to the right (even if word wrap is on)

## [7.5.8] - 2018-01-29

### Fixed

- Fixes regression working with submodules
- Fixes [#262](https://github.com/eamodio/vscode-gitlens/issues/262) - GitLens only available in SCM diff windows
- Fixes [#261](https://github.com/eamodio/vscode-gitlens/issues/261) - Unable to open compare. The file is probably not under source control
- Fixes missing avatars in file blame annotations in non-compact mode
- Fixes file blame annotation highlight not being restored properly on tab switch

## [7.5.7] - 2018-01-25

### Added

- Adds a repository quick pick menu to the _Show Commit Search_ command (`gitlens.showCommitSearch`) when there is no active repository

### Fixed

- Fixes [#257](https://github.com/eamodio/vscode-gitlens/issues/257) - Some branches fail to show history
- Fixes [#259](https://github.com/eamodio/vscode-gitlens/issues/259) - File history lists unrelated merge commits

## [7.5.6] - 2018-01-22

### Changed

- Changes `chorded` keymap on Windows to use `Ctrl+Shift+G` rather than `Ctrl+Alt+G` to avoid [issues](https://blogs.msdn.microsoft.com/oldnewthing/20040329-00/?p=40003)
  - Also remaps `Show SCM` to `Ctrl+Shift+G G` since by default it is `Ctrl+Shift+G` if the `chorded` keymap is used
- Refactors git log and stash output parsing &mdash; should be faster and far more robust

### Fixed

- Fixes [#256](https://github.com/eamodio/vscode-gitlens/issues/256) - Fails to copy commit message
- Fixes [#255](https://github.com/eamodio/vscode-gitlens/issues/255) - Lines after an empty line in the commit message are not copied to clipboard
- Fixes [#252](https://github.com/eamodio/vscode-gitlens/issues/252) - Cannot read property 'push' of undefined
- Fixes issue where GitLens wouldn't detect the creation of a Git repository if there were no other repositories open
- Fixes issue where some GitLens commands would show in the palette even though there was no repository
- Fixes issue where navigating the history of a renamed file could cause errors
- Fixes issue with using the `gitlens.diffWithPrevious` command option for Git code lens

## [7.5.5] - 2018-01-18

### Fixed

- Fixes [#247](https://github.com/eamodio/vscode-gitlens/issues/247) - File annotations button or ESC key does not turn off file annotations
- Fixes issue where sometimes blame context wasn't available for the open editor when starting vscode

## [7.5.4] - 2018-01-17

### Fixed

- Fixes [#249](https://github.com/eamodio/vscode-gitlens/issues/249) - Gitlens disappears from the status bar
- Fixes issue where [Gravatars](https://en.gravatar.com/) in the gutter blame annotations weren't restored on tab switch
- Fixes issue where the id (sha) was missing in the hover blame annotations for uncommitted changes

## [7.5.3] - 2018-01-15

### Fixed

- Fixes [#245](https://github.com/eamodio/vscode-gitlens/issues/245) - CodeLens disappears/and reappears when auto-saving

## [7.5.2] - 2018-01-15

### Fixed

- Fixes [#242](https://github.com/eamodio/vscode-gitlens/issues/242) - Broken "gitlens.blame.line.enabled" setting

## [7.5.1] - 2018-01-15

### Added

- Adds [Gravatar](https://en.gravatar.com/) support to gutter and hover blame annotations
- Adds `gitlens.annotations.file.gutter.gravatars` setting to specify whether to show gravatar images in the gutter blame annotations
- Adds support for providing blame annotations, code lens, etc on files with unsaved changes &mdash; closes [#112](https://github.com/eamodio/vscode-gitlens/issues/112)
- Adds `gitlens.defaultDateStyle` setting to specify how dates will be displayed by default &mdash; closes [#89](https://github.com/eamodio/vscode-gitlens/issues/89)
- Adds _Compare with Working Tree_ command (`gitlens.explorers.compareWithWorking`) to branch, tag, and revision (commit) nodes in the _GitLens_ explorer to compare the current selection with the current working tree in the _GitLens Results_ explorer
- Adds _Compare Selected Ancestor with Working Tree_ command (`gitlens.explorers.compareSelectedAncestorWithWorking`) to branch nodes in the _GitLens_ explorer once another branch within the same repository has been selected to compare the [merge base](https://git-scm.com/docs/git-merge-base) of current and previously selected branches with the working tree in the _GitLens Results_ explorer &mdash; closes [#240](https://github.com/eamodio/vscode-gitlens/issues/240)
- Adds _Merge Branch (via Terminal)_ command (`gitlens.explorers.terminalMergeBranch`) to branch nodes in the _GitLens_ explorer
- Adds _Rebase (Interactive) Branch (via Terminal)_ command (`gitlens.explorers.terminalRebaseBranch`) to branch nodes in the _GitLens_ explorer
- Adds _Cherry Pick Commit (via Terminal)_ command (`gitlens.explorers.terminalRebaseBranch`) to revision (commit) nodes in the _GitLens_ explorer and _GitLens Results_ explorer
- Adds _Revert Commit (via Terminal)_ command (`gitlens.explorers.terminalRevertCommit`) to revision (commit) nodes in the _GitLens_ explorer and _GitLens Results_ explorer
- Adds _Create Tag (via Terminal)..._ command (`gitlens.explorers.terminalCreateTag`) to branch and revision (commit) nodes in the _GitLens_ explorer and _GitLens Results_ explorer
- Adds _Delete Tag (via Terminal)_ command (`gitlens.explorers.terminalDeleteTag`) to tag nodes in the _GitLens_ explorer
- Adds a helpful notification the first time the _GitLens Results_ explorer is shown

### Changed

- Switches to the explorer view before showing the _GitLens Results_ explorer
- Renames _Rebase Commit (via Terminal)_ command (`gitlens.terminalRebaseCommit`) to _Rebase to Commit (via Terminal)_
- Renames _Reset Commit (via Terminal)_ command (`gitlens.terminalResetCommit`) to _Reset to Commit (via Terminal)_
- Renames _Compare Line Revision with Working_ command (`gitlens.diffLineWithWorking`) to _Compare Line Revision with Working File_
- Renames _Open Changes with Working Tree_ command (`gitlens.openChangesWithWorking`) to _Open Changes with Working File_
- Deprecates `gitlens.gitExplorer.gravatarsDefault` setting, replaced by `gitlens.defaultGravatarsStyle`
- Deprecates `gitlens.resultsView.gravatarsDefault` setting, replaced by `gitlens.defaultGravatarsStyle`

### Fixed

- Fixes issue where the _GitLens Results_ explorer wouldn't properly update when replacing existing results
- Fixes issue where showing commit search (file-based) results in the _GitLens Results_ explorer wouldn't only show the matching files &mdash; closes [#197](https://github.com/eamodio/vscode-gitlens/issues/197)
- Fixes [#238](https://github.com/eamodio/vscode-gitlens/issues/238) - Show merge commits in file history
- Fixes issue where the Tags node of the _GitLens_ explorer wasn't updated on changes
- Fixes issue where changes to .gitignore weren't detected properly
- Fixes [#241](https://github.com/eamodio/vscode-gitlens/issues/241) - Adds default setting for .jsonc files to match Git code lens of .json files
- Fixes issue where blame annotations and commands were missing from vscode Git staged revision documents
- Fixes issue where opening changes for renamed files in the _GitLens_ explorer and _GitLens Results_ explorer wouldn't work properly
- Fixes issue where file-specific menu commands show up on folders in the explorer

## [7.2.0] - 2018-01-01

### Added

- Adds on-demand **heatmap annotations** of the whole file &mdash; closes [#182](https://github.com/eamodio/vscode-gitlens/issues/182)
  - Displays a **heatmap** (age) indicator near the gutter, which provides an easy, at-a-glance way to tell the age of a line
    - Indicator ranges from bright yellow (newer) to dark brown (older)
- Adds _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`) to toggle the heatmap annotations on and off
- Adds semi-persistent results for commit operations, via the _Show Commit Details_ command (`gitlens.showQuickCommitDetails`) in the _GitLens Results_ explorer &mdash; closes [#237](https://github.com/eamodio/vscode-gitlens/issues/237)
- Adds _Show in Results_ option to the commit details quick pick menu to show the commit in the _GitLens Results_ explorer
- Adds _Compare with Index (HEAD)_ command (`gitlens.explorers.compareWithHead`) to branch, tag, and revision (commit) nodes in the _GitLens_ explorer to compare the current selection with the current index (HEAD) in the _GitLens Results_ explorer
- Adds _Compare with Remote_ command (`gitlens.explorers.compareWithRemote`) to branch nodes in the _GitLens_ explorer to compare the current selection with its remote tracking branch in the _GitLens Results_ explorer

### Changed

- Improves startup performance and reduces package size

### Fixed

- Fixes [#239](https://github.com/eamodio/vscode-gitlens/issues/239) - `gitlens.advanced.quickPick.closeOnFocusOut` setting should be reversed
- Fixes [#208](https://github.com/eamodio/vscode-gitlens/issues/208) - Gitlens doesn't work over UNC

## [7.1.0] - 2017-12-22

### Added

- Adds _Open Working File_ command (`gitlens.openWorkingFile`) - opens the working file for the active file revision &mdash; closes [#236](https://github.com/eamodio/vscode-gitlens/issues/236)
- Adds _Open Revision..._ command (`gitlens.openFileRevision`) - opens the selected revision for the active file
- Adds tags to the _Compare File with Branch..._ command (`gitlens.diffWithBranch`) &mdash; closes [#204](https://github.com/eamodio/vscode-gitlens/issues/204)
- Adds tags to the _Directory Compare Working Tree with..._ command (`gitlens.diffDirectory`) &mdash; closes [#204](https://github.com/eamodio/vscode-gitlens/issues/204)
- Adds _Show Branches and Tags_ to quick pick menu shown by the _Compare File with Revision..._ command (`gitlens.diffWithRevision`) &mdash; closes [#204](https://github.com/eamodio/vscode-gitlens/issues/204)
- Adds _Show Branches and Tags_ to quick pick menu shown by the _Open Revision..._ command (`gitlens.openFileRevision`) &mdash; closes [#204](https://github.com/eamodio/vscode-gitlens/issues/204)

### Changed

- Improves startup performance by ~65% (on my very fast PC) and reduces package size by over 75%
- Renames _Compare File with Branch..._ command (`gitlens.diffWithBranch`) to _Compare File with Branch or Tag..._

### Fixed

- Fixes issues with commit paging in certain quick pick menus
- Fixes issues with certain quick pick menu progress indicators getting stuck in some cases
- Fixes issues with menu choice placements on the editor title menu

## [7.0.0] - 2017-12-18

### Added

- Adds a new **Active Repository** node to the **Repository View** of the _GitLens_ explorer &mdash; closes [#224](https://github.com/eamodio/vscode-gitlens/issues/224)

  - Automatically updates to track the repository of the active editor
  - Only visible if there is more than 1 repository within the workspace

- Adds a new **Tags** node to the **Repository View** of the _GitLens_ explorer &mdash; closes [#234](https://github.com/eamodio/vscode-gitlens/issues/234)

  - Provides a list of tags
  - Expand each tag to easily see its revision (commit) history
    - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
      - Provides a context menu on each revision (commit) with _Open Commit in Remote_, _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Compare with Selected_, _Select for Compare_, _Rebase Commit (via Terminal)_, _Reset Commit (via Terminal)_, and _Refresh_ commands
        - Provides a context menu on each changed file with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands
    - Provides a context menu on each tag with _Compare with Selected_, _Select for Compare_, _Open Directory Compare with Working Tree_, and _Refresh_ commands
  - Provides a context menu with a _Refresh_ command

- Adds [Gravatar](https://en.gravatar.com/) support to the _GitLens_ explorer

  - Adds `gitlens.gitExplorer.gravatars` setting to specify whether to show gravatar images instead of commit (or status) icons in the _GitLens_ explorer
  - Adds `gitlens.gitExplorer.gravatarsDefault` setting to specify the style of the gravatar default (fallback) images in the _GitLens_ explorer<br />`identicon` - a geometric pattern<br />`mm` - (mystery-man) a simple, cartoon-style silhouetted outline of a person (does not vary by email hash)<br />`monsterid` - a monster with different colors, faces, etc<br />`retro` - 8-bit arcade-style pixelated faces<br />`robohash` - a robot with different colors, faces, etc<br />`wavatar` - faces with differing features and backgrounds
  - Adds `gitlens.resultsView.gravatars` setting to specify whether to show gravatar images instead of commit (or status) icons in the _GitLens Results_ explorer
  - Adds `gitlens.resultsView.gravatarsDefault` setting to specify the style of the gravatar default (fallback) images in the _GitLens Results_ explorer<br />`identicon` - a geometric pattern<br />`mm` - (mystery-man) a simple, cartoon-style silhouetted outline of a person (does not vary by email hash)<br />`monsterid` - a monster with different colors, faces, etc<br />`retro` - 8-bit arcade-style pixelated faces<br />`robohash` - a robot with different colors, faces, etc<br />`wavatar` - faces with differing features and backgrounds

- Adds _Select for Compare_ command (`gitlens.explorers.selectForCompare`) to branch, remote branch, tag, and revision (commit) nodes in the _GitLens_ explorer to mark the base reference of a comparison
- Adds _Compare with Selected_ command (`gitlens.explorers.compareWithSelected`) to branch, remote branch, tag, and revision (commit) nodes in the _GitLens_ explorer once another reference within the same repository has been selected to compare the current selection with the previously selected reference in the _GitLens Results_ explorer

- Adds an all-new, on-demand _GitLens Results_ explorer to the Explorer activity

  - Provides semi-persistent results for commit search operations, via the _Show Commit Search_ command (`gitlens.showCommitSearch`), and file history operations, via the _Show File History_ command (`gitlens.showQuickFileHistory`)

    - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
      - Provides a context menu on each revision (commit) with _Open Commit in Remote_, _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Compare with Selected_, _Select for Compare_, _Rebase Commit (via Terminal)_, _Reset Commit (via Terminal)_, and _Refresh_ commands
        - Provides a context menu on each changed file with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands

  - Provides semi-persistent results for revision comparison operations, via the _Select for Compare_ command (`gitlens.explorers.selectForCompare`) and the _Compare with Selected_ command (`gitlens.explorers.compareWithSelected`)
    - **Commits** node &mdash; provides a list of the commits between the compared revisions (branches or commits)
      - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
        - Provides a context menu on each revision (commit) with _Open Commit in Remote_, _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, _Compare with Selected_, _Select for Compare_, _Rebase Commit (via Terminal)_, _Reset Commit (via Terminal)_, and _Refresh_ commands
          - Provides a context menu on each changed file with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands
    - **Changed Files** node &mdash; provides a list of all the files changed between the compared revisions (branches or commits)
      - Expands to a file-based view of all changed files
        - Provides a context menu on each changed file with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands
    - Provides a context menu with _Open Directory Compare_ and _Refresh_ commands
  - Provides toolbar commands to _Search Commits_, _Keep Results_, _Refresh_, _Show Files in Automatic View_ or _Show Files in List View_ or _Show Files in Tree View_, and _Close_

- Adds _Apply Changes_ option to the commit/stash file quick pick menu &mdash; closes [#232](https://github.com/eamodio/vscode-gitlens/issues/232)
- Adds _Show All Commits_ option to the commit search quick pick menu to show all the results, if there are more than the threshold
- Adds _Show in Results_ option to the commit search quick pick menu to show the results in the _GitLens Results_ explorer
- Adds _Show in Results_ option to the file history quick pick menu to show the history in the _GitLens Results_ explorer

### Changed

- Improves startup performance a bit
- Renames _Compare Directory with Branch..._ command (`gitlens.diffDirectory`) to _Directory Compare Working Tree with..._
- Renames _Compare Directory with Previous Revision_ in quick pick menus to _Open Directory Compare with Previous Revision_
- Renames _Compare Directory with Working Tree_ in quick pick menus to _Open Directory Compare with Working Tree_

### Fixed

- Fixes [#228](https://github.com/eamodio/vscode-gitlens/issues/228) - Gutter blame spills over heatmap
- Fixes incorrect blame highlighting &mdash; thanks to [PR #231](https://github.com/eamodio/vscode-gitlens/pull/231) by Alexey Vasyukov ([@notmedia](https://github.com/notmedia))!
- Fixes issue with the _Open in File/Revision_ option in the file history quick pick menu
- Fixes issues with Git warnings when parsing log status output (can cause the _GitLens_ explorer to not show data in some cases)
- Fixes &#x1F91E; [#226](https://github.com/eamodio/vscode-gitlens/issues/226) - Annotations show in Debug Console

## [6.4.0] - 2017-12-12

### Added

- Adds `gitlens.keymap` setting to specify the keymap to use for GitLens shortcut keys &mdash; closes [#104](https://github.com/eamodio/vscode-gitlens/issues/104)
  - `standard` - adds a standard set of shortcut keys
  - `chorded` - adds a chorded set of shortcut keys that all start with `Ctrl+Alt+G` (<code>&#x2325;&#x2318;G</code> on macOS)
  - `none` - no shortcut keys will be added
- Adds progress indicator to the _Show Stashed Changes_ command (`gitlens.showQuickStashList`)
- Adds progress indicator to the _Apply Stashed Changes_ command (`gitlens.stashApply`)

### Changed

- Overhauls the internal way GitLens deals with Uris and revisions should be far more robust and lead to many fewer edge-case issues
- Aligns quick pick menu commands more with the _GitLens_ explorer context menus

### Fixed

- Fixes [#220](https://github.com/eamodio/vscode-gitlens/issues/220) - Open Revision quick pick results in empty file
- Fixes so, SO, many bugs through the refactor/overhaul of GitLens' Uri handling

## [6.3.0] - 2017-11-30

### Added

- Adds support for files with staged changes
  - Adds new entry in the **History View** of the _GitLens_ explorer
  - Adds new entry in the **Repository View** of the _GitLens_ explorer
  - Adds blame annotations, navigation & comparison commands, etc
- Adds support for vscode's Git file revisions (e.g. _Open File (HEAD)_) and diffs (e.g. _Open Changes_)
  - Adds new entry in the **History View** of the _GitLens_ explorer
  - Adds blame annotations, navigation & comparison commands, etc
- Adds Git code lens to Git file revisions (GitLens or vscode's)

### Fixed

- Fixes &#x1F91E; [#202](https://github.com/eamodio/vscode-gitlens/issues/202) - Staged change's vscode diff side-by-side view shows the wrong history
- Fixes &#x1F91E; [#216](https://github.com/eamodio/vscode-gitlens/issues/216) - PowerShell session not started if GitLen is enabled
- Fixes [#217](https://github.com/eamodio/vscode-gitlens/issues/217) - empty editor has git lens in status bar with old information
- Fixes [#218](https://github.com/eamodio/vscode-gitlens/issues/218) - Cannot read property 'replace' of undefined
- Fixes issue with feedback when searching for commits without any matches
- Fixes issue where quick pick menu progress indicators could get stuck

## [6.2.0] - 2017-11-27

### Added

- Adds theming support - vscode themes can now specify GitLens colors as well as directly by using [`workbench.colorCustomization`](https://code.visualstudio.com/docs/getstarted/themes#_customize-a-color-theme))
  - Adds `gitlens.gutterBackgroundColor` themable color
  - Adds `gitlens.gutterForegroundColor` themable color
  - Adds `gitlens.gutterUncommittedForegroundColor` themable color
  - Adds `gitlens.trailingLineBackgroundColor` themable color
  - Adds `gitlens.trailingLineForegroundColor` themable color
  - Adds `gitlens.lineHighlightBackgroundColor` themable color
  - Adds `gitlens.lineHighlightOverviewRulerColor` themable color
- Adds `gitlens.advanced.messages` setting to specify which messages should be suppressed

### Changed

- Renames `gitlens.theme.annotations.file.gutter.separateLines` setting to `gitlens.annotations.file.gutter.separateLines`
- Changes from using `globalState` to use `gitlens.advanced.messages` setting for message suppression - provides more control and avoids strange intermittent with `globalState`
- Changes `gitlens.strings.codeLens.unsavedChanges.recentChangeAndAuthors` setting default to `Unsaved changes (cannot determine recent change or authors)`
- Changes `gitlens.strings.codeLens.unsavedChanges.recentChangeOnly` setting default to `Unsaved changes (cannot determine recent change)`
- Changes `gitlens.strings.codeLens.unsavedChanges.authorsOnly` setting default to `Unsaved changes (cannot determine authors)`

### Removed

- Removes `gitlens.theme.*` settings - now using built-in theme support

### Fixed

- Fixes [#211](https://github.com/eamodio/vscode-gitlens/issues/211) - Unsaved code lens appears on untracked files
- Fixes issue where _Open \* in Remote_ commands are sometimes missing

## [6.1.2] - 2017-11-21

### Fixed

- Fixes [#207](https://github.com/eamodio/vscode-gitlens/issues/207) - Applying and deleting stashes suddenly stopped working
- Fixes [#205](https://github.com/eamodio/vscode-gitlens/issues/205) - Toggle Line Blame Annotations disappeared after last update
- Fixes [#203](https://github.com/eamodio/vscode-gitlens/issues/203) - Open Changed Files is broken
- Fixes [#176](https://github.com/eamodio/vscode-gitlens/issues/176) - Line annotations some times mess with white space

## [6.1.1] - 2017-11-17

### Fixed

- Fixes [#201](https://github.com/eamodio/vscode-gitlens/issues/201) - "Open in Remote" commands should check for branch upstream tracking
- Fixes [#200](https://github.com/eamodio/vscode-gitlens/issues/200) - Submodule using terminal command, root directory is incorrect

## [6.1.0] - 2017-11-13

### Added

- Adds support for nested repositories and submodules &mdash; closes [#198](https://github.com/eamodio/vscode-gitlens/issues/198)
- Adds `gitlens.advanced.repositorySearchDepth` setting to specify how many folders deep to search for repositories

### Changed

- Changes to use `diff.guitool` first if available, before falling back to `diff.tool` &mdash; closes [#195](https://github.com/eamodio/vscode-gitlens/issues/195)

### Fixed

- Fixes issue where failed git commands would get stuck in the pending queue causing future similar commands to also fail
- Fixes issue where changes to git remotes would refresh the entire _GitLens_ explorer

## [6.0.0] - 2017-11-08

### Added

- Adds multi-root workspace support &mdash; [Learn more](https://code.visualstudio.com/docs/editor/multi-root-workspaces)
- Adds new logo/icon
- Adds indicator dots on the branch node(s) of the _GitLens_ explorer which denote the following:
  - _None_ - no upstream or up-to-date with the upstream
  - _Green_ - ahead of the upstream
  - _Red_ - behind the upstream
  - _Yellow_ - both ahead of and behind the upstream
- Adds progress indicator to the _Search Commits_ command (`gitlens.showCommitSearch`)
- Adds code search support to the _Search Commits_ command (`gitlens.showCommitSearch`) &mdash; closes [#127](https://github.com/eamodio/vscode-gitlens/issues/127)
  - Use `~<regex>` to search for commits with differences whose patch text contains added/removed lines that match `<regex>`
  - Use `=<regex>` to search for commits with differences that change the number of occurrences of the specified string (i.e. addition/deletion) in a file
- Adds support to the _Compare File with Branch..._ command (`gitlens.diffWithBranch`) work with renamed files &mdash; closes [#165](https://github.com/eamodio/vscode-gitlens/issues/165)
- Adds _Compare File with Branch..._ command (`gitlens.diffWithBranch`) to source control resource context menu
- Adds _Open Repository in Remote_ command (`gitlens.openRepoInRemote`) to repository node(s) of the _GitLens_ explorer
- Adds _Enable Automatic Refresh_ command (`gitlens.gitExplorer.setAutoRefreshToOn`) to the _GitLens_ explorer regardless of the current view
- Adds _Disable Automatic Refresh_ command (`gitlens.gitExplorer.setAutoRefreshToOff`) to the _GitLens_ explorer regardless of the current view
- Adds new Git terminal commands to the _GitLens_ explorer - opens a _GitLens_ terminal and sends the specified Git command to it
  - Adds _Checkout Branch (via Terminal)_ command (`gitlens.terminalCheckoutBranch`) to branch node(s) of the _GitLens_ explorer
  - Adds _Create Branch (via Terminal)..._ command (`gitlens.terminalCreateBranch`) to branch node(s) of the _GitLens_ explorer
  - Adds _Delete Branch (via Terminal)_ command (`gitlens.terminalDeleteBranch`) to branch node(s) of the _GitLens_ explorer
  - Adds _Rebase Branch to Remote (via Terminal)_ command (`gitlens.terminalRebaseBranchToRemote`) to branch node(s) of the _GitLens_ explorer
  - Adds _Squash Branch into Commit (via Terminal)_ command (`gitlens.terminalSquashBranchIntoCommit`) to branch node(s) of the _GitLens_ explorer
  - Adds _Rebase Commit (via Terminal)_ command (`gitlens.terminalRebaseCommit`) to commit node(s) of the _GitLens_ explorer
  - Adds _Reset Commit (via Terminal)_ command (`gitlens.terminalResetCommit`) to commit node(s) of the _GitLens_ explorer
  - Adds _Remove Remote (via Terminal)_ command (`gitlens.terminalRemoveRemote`) to remote node(s) of the _GitLens_ explorer
- Adds ability to specify the url protocol used with user-defined remote services via `gitlens.remotes` setting &mdash; thanks to [PR #192](https://github.com/eamodio/vscode-gitlens/pull/192) by Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka))!

### Changed

- _GitLens_ explorer will no longer show if there is no Git repository &mdash; closes [#159](https://github.com/eamodio/vscode-gitlens/issues/159)
- Optimizes event handling, executing git commands, and general processing to improve performance and reduce any lag
- Optimizes current line hover annotations to only be computed on hover (i.e. lazily evaluated) to reduce the compute required when changing lines
- Protects credentials from possibly being affected by poor network conditions via Git Credential Manager (GCM) for Windows environment variables
- Delays (slightly) the initial loading of the _GitLens_ explorer to improve startup performance

### Fixed

- Fixes jumpy code lens when deleting characters from a line with a Git code lens
- Fixes [#178](https://github.com/eamodio/vscode-gitlens/issues/178) - Slight but noticeable keyboard lag with Gitlens
- Fixes [#183](https://github.com/eamodio/vscode-gitlens/issues/183) - Remote with same url should only show once
- Fixes [#185](https://github.com/eamodio/vscode-gitlens/issues/185) - Wrong relative date shows on mouse hover
- Fixes issue where using the _Refresh_ command on a _GitLens_ explorer node refreshed the whole view, rather than just the node
- Fixes issue where certain commands fail when there is no current branch (rebase, detached HEAD, etc)

## [5.7.1] - 2017-10-19

### Fixed

- Fixes [#174](https://github.com/eamodio/vscode-gitlens/issues/174) - File Blame Annotations No Longer Working (and some other editor-based commands)

## [5.7.0] - 2017-10-19

### Added

- Adds _Open All Changes (with difftool)_ command (`gitlens.externalDiffAll`) - opens all working changes with the configured git difftool &mdash; closes [#164](https://github.com/eamodio/vscode-gitlens/issues/164)
  - Also adds the command to the Source Control group context menu
- Adds `gitlens.gitExplorer.autoRefresh` setting to specify whether to automatically refresh the _GitLens_ explorer when the repository or the file system changes
- Adds _Enable Automatic Refresh_ command (`gitlens.gitExplorer.setAutoRefreshToOn`) to enable the automatic refresh of the _GitLens_ explorer
- Adds _Disable Automatic Refresh_ command (`gitlens.gitExplorer.setAutoRefreshToOff`) to disable the automatic refresh of the _GitLens_ explorer
- Adds _Show Files in Automatic View_ command (`gitlens.gitExplorer.setFilesLayoutToAuto`) to change to an automatic layout for the files in the _GitLens_ explorer
- Adds _Show Files in List View_ command (`gitlens.gitExplorer.setFilesLayoutToList`) to change to a list layout for the files in the _GitLens_ explorer
- Adds _Show Files in Tree View_ command (`gitlens.gitExplorer.setFilesLayoutToTree`) to change to a tree layout for the files in the _GitLens_ explorer

### Changed

- Renames _Directory Compare_ command (`gitlens.diffDirectory`) to _Compare Directory with Branch..._
- Renames _Directory Compare with Previous Commit_ in quick pick menus to _Compare Directory with Previous Commit_
- Renames _Directory Compare with Working Tree_ in quick pick menus to _Compare Directory with Working Tree_
- Changes the marketplace keywords for better discoverability

### Fixed

- Fixes [#163](https://github.com/eamodio/vscode-gitlens/issues/163) - GitLens can cause git locking in the background
- Fixes issues tracking the active editor in the **History View** of the _GitLens_ explorer
- Fixes issue where the _GitLens_ explorer would refresh more than once when a file system change was detected
- Fixes issue where opening commit search could be filled out with `#00000000`

## [5.6.5] - 2017-10-16

### Removed

- Removes `gitlens.advanced.gitignore.enabled` setting since it usage has been replaced by a tracked file cache

### Fixed

- Fixes issues with tracked files which are ignored via `.gitignore` not working properly

## [5.6.4] - 2017-10-12

### Fixed

- Fixes [#168](https://github.com/eamodio/vscode-gitlens/issues/168) - Git environment context was missing

## [5.6.3] - 2017-10-12

### Changed

- Swaps out Moment.js for date-fns to improve blame annotation performance and to reduce the GitLen bundle size (saves ~400kb)

### Fixed

- Fixes issue where the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) wasn't available after a file was saved

## [5.6.2] - 2017-10-11

### Fixed

- Fixes issue where _Open File_ command failed for in many instances (for GitUri resources)

## [5.6.1] - 2017-10-11

### Fixed

- Fixes issue where diffs for stashed files were often wrong (missing)

## [5.6.0] - 2017-10-11

### Added

- Adds **changes** (diff) hover annotation support to both the _gutter_ and _hover_ file blame annotations
- Adds `gitlens.annotations.file.gutter.hover.changes` setting to specify whether to provide a changes (diff) hover annotation over the gutter blame annotations
- Adds `gitlens.annotations.file.hover.details` setting to specify whether to provide a commit details hover annotation over each line
- Adds `gitlens.annotations.file.hover.changes` setting to specify whether to provide a changes (diff) hover annotation over each line

### Changed

- Changes `gitlens.codeLens.customLocationSymbols` setting to both include and exclude (using a `!` prefix) symbols and therefore is always applied

### Removed

- Removes `Custom` from the `gitlens.codeLens.locations` setting as it wasn't really required
- Removes properties (symbol `Property`) from being included in the `Blocks` option of the `gitlens.codeLens.locations` setting &mdash; can be easily re-added by setting `"gitlens.codeLens.customLocationSymbols": [ "Property" ]` if desired
- Removes `gitlens.annotations.file.hover.wholeLine` setting as it didn't really make sense

### Fixed

- Fixes issue where changing `gitlens.blame.file.annotationType` wouldn't correctly update the blame annotations if they were currently active
- Fixes issue where `isBlameable` context could be set incorrectly leading to blame icon showing up on invalid documents

## [5.5.0] - 2017-10-09

### Added

- Adds a **quick-access** command bar to the bottom of the **details** hover annotations

  ![Details Blame Annotation (hover)](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-hovers-current-line-details.png)

  - Provides _Open Changes_, _Blame Previous Revision_, _Open in Remote_, and _Show More Actions_ command buttons

- Adds support for remembering file annotations when switching tabs
- Adds full GitLens support for file revisions &mdash; file & line annotations, commands, etc

### Changed

- Changes `gitlens.annotations.file.gutter.hover.wholeLine` setting to default to `true`

### Removed

- Removes peek-style file & blame history explorers - see [#66](https://github.com/eamodio/vscode-gitlens/issues/66) for more details
  - Removes _Open Blame History Explorer_ command (`gitlens.showBlameHistory`)
  - Removes _Open File History Explorer_ command (`gitlens.showFileHistory`)
  - Removes `"gitlens.showBlameHistory"` & `"gitlens.showFileHistory"` option from `gitlens.codeLens.recentChange.command` setting
  - Removes `"gitlens.showBlameHistory"` & `"gitlens.showFileHistory"` option from `gitlens.codeLens.authors.command` setting
  - Removes `"gitlens.showBlameHistory"` & `"gitlens.showFileHistory"` option from `gitlens.statusBar.command` setting
- Removes `gitlens.advanced.toggleWhitespace.enabled` setting &mdash; as it is no longer required

### Fixed

- Fixes [#161](https://github.com/eamodio/vscode-gitlens/issues/161) - Remove colors from output of git command calls

## [5.4.1] - 2017-10-03

### Changed

- Changes annotation hovers to only add _Open in Remote_ and _Show Commit Details_ commands when applicable &mdash; thanks to [PR #158](https://github.com/eamodio/vscode-gitlens/pull/158) by SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC))!

### Fixed

- Fixes issue where **Changes** hover annotation displayed incorrect info when there was no previous commit &mdash; thanks to [PR #158](https://github.com/eamodio/vscode-gitlens/pull/158) by SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC))!
- Fixes issue when checking for remotes could return no remotes even if remotes are configured

## [5.4.0] - 2017-09-30

### Added

- Adds support for user-defined remote services via `gitlens.remotes` setting &mdash; closes [#148](https://github.com/eamodio/vscode-gitlens/issues/148)
- Adds _Open Changes (with difftool)_ command (`gitlens.externalDiff`) - opens the changes of a file or set of files with the configured git difftool &mdash; thanks to [PR #154](https://github.com/eamodio/vscode-gitlens/pull/154) by Chris Kaczor ([@ckaczor](https://github.com/ckaczor))!
  - Adds to the source control group and source control resource context menus

## [5.3.0] - 2017-09-26

### Added

- Adds new file layouts to the _GitLens_ explorer
  - `auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.gitExplorer.files.threshold` setting and the number of files at each nesting level
  - `list` - displays files as a list
  - `tree` - displays files as a tree
- Adds `gitlens.gitExplorer.files.layout` setting to specify how the _GitLens_ explorer will display files
- Adds `gitlens.gitExplorer.files.compact` setting to specify whether to compact (flatten) unnecessary file nesting in the _GitLens_ explorer
- Adds `gitlens.gitExplorer.files.threshold` setting to specify when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _GitLens_ explorer
- Adds `${directory}` token to the file formatting settings

### Changed

- Changes `${path}` token to be the full file path in the file formatting settings

### Fixed

- Fixes [#153](https://github.com/eamodio/vscode-gitlens/issues/153) - New folders treated as files in "Changed Files" section of the sidebar component

## [5.2.0] - 2017-09-23

### Added

- Adds new **Changed Files** node to the **Repository Status** node of the _GitLens_ explorer's **Repository View** &mdash; closes [#139](https://github.com/eamodio/vscode-gitlens/issues/139)
  - Provides a at-a-glance view of all "working" changes
  - Expands to a file-based view of all changed files in the working tree (enabled via `"gitlens.insiders": true`) and/or all files in all commits ahead of the upstream
- Adds optional (on by default) working tree status information to the **Repository Status** node in the _GitLens_ explorer
- Adds `auto` value to `gitlens.gitExplorer.view` setting - closes [#150](https://github.com/eamodio/vscode-gitlens/issues/150)
- Adds `gitlens.gitExplorer.enabled` setting to specify whether to show the _GitLens_ explorer - closes [#144](https://github.com/eamodio/vscode-gitlens/issues/144)
- Adds `gitlens.gitExplorer.includeWorkingTree` setting to specify whether to include working tree files inside the **Repository Status** node of the _GitLens_ explorer
- Adds `gitlens.gitExplorer.statusFileFormat` setting to the format of the status of a working or committed file in the _GitLens_ explorer

### Changed

- Changes the sorting (now alphabetical) of files shown in the _GitLens_ explorer
- Changes the default of the `gitlens.gitExplorer.view` setting to `auto`
- Changes the default of the `gitlens.gitExplorer.commitFormat` setting to add parentheses around the commit id
- Removes many menu items from `editor/title` & `editor/title/context` by default &mdash; can be re-enabled via the `gitlens.advanced.menus` setting

### Fixed

- Fixes [#146](https://github.com/eamodio/vscode-gitlens/issues/146) - Blame gutter annotation issue when commit contains emoji
- Fixes an issue when running _Open File in Remote_ with a multi-line selection wasn't properly opening the selection in GitLab &mdash; thanks to [PR #145](https://github.com/eamodio/vscode-gitlens/pull/145) by Amanda Cameron ([@AmandaCameron](https://github.com/AmandaCameron))!
- Fixes an issue where the `gitlens.advanced.menus` setting wasn't controlling all the menu items properly

## [5.1.0] - 2017-09-15

### Added

- Adds full (multi-line) commit message to the **details** hover annotations &mdash; closes [#116](https://github.com/eamodio/vscode-gitlens/issues/116)
- Adds an external link icon to the **details** hover annotations to run the _Open Commit in Remote_ command (`gitlens.openCommitInRemote`)

### Changed

- Optimizes performance of the providing blame annotations, especially for large files (saw a ~78% improvement on some files)
- Optimizes date handling (parsing and formatting) for better performance and reduced memory consumption

### Removed

- Removes `gitlens.annotations.file.recentChanges.hover.wholeLine` setting as it didn't really make sense

### Fixed

- Fixes an issue where stashes with only untracked files would not show in the **Stashes** node of the _GitLens_ explorer
- Fixes an issue where stashes with untracked files would not show its untracked files in the _GitLens_ explorer

## [5.0.0] - 2017-09-12

### Added

- Adds an all-new _GitLens_ explorer to the Explorer activity

  - **Repository View** - provides a full repository explorer

    ![GitLens Repository view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-gitlens-explorer-repository.png)

    - **Repository Status** node &mdash; provides the status of the repository

      - Provides the name of the current branch, its upstream tracking branch (if available), and its upstream status (if available)
      - Provides indicator dots on the repository icon which denote the following:
        - _None_ - up-to-date with the upstream
        - _Green_ - ahead of the upstream
        - _Red_ - behind the upstream
        - _Yellow_ - both ahead of and behind the upstream
      - Provides additional nodes, if the current branch is not synchronized with the upstream, to quickly see and explore the specific commits ahead and/or behind the upstream
      - Provides a context menu with _Open Repository in Remote_, and _Refresh_ commands

    - **Branches** node &mdash; provides a list of the local branches

      - Indicates which branch is the current branch and optionally shows the remote tracking branch
      - Expand each branch to easily see its revision (commit) history
        - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
          - Provides a context menu on each changed file with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, _Show File History_, and _Show Commit File Details_ commands
        - Provides a context menu on each revision (commit) with _Open Commit in Remote_, _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_, _Show Commit Details_, and _Refresh_ commands
        - Provides a context menu on each branch with _Open Branch in Remote_, and _Refresh_ commands
      - Provides a context menu with _Open Branches in Remote_, and _Refresh_ commands

    - **Remotes** node &mdash; provides a list of remotes

      - Indicates the direction of the remote (fetch, push, both), remote service (if applicable), and repository path
      - Expand each remote to see its list of branches
        - Expand each branch to easily see its revision (commit) history
          - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
            - Provides a context menu on each changed file with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands
          - Provides a context menu on each revision (commit) with _Open Commit in Remote_, _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit ID to Clipboard_, _Copy Commit Message to Clipboard_,_Show Commit Details_, and _Refresh_ commands
        - Provides a context menu on each remote with _Open Branches in Remote_, _Open Repository in Remote_, and _Refresh_ commands
      - Provides a context menu with a _Refresh_ command

    - **Stashes** node &mdash; provides a list of stashed changes
      - Expand each stash to quickly see the set of files stashed, complete with status indicators for adds, changes, renames, and deletes
      - Provides a context menu with _Stash Changes_, and _Refresh_ commands
      - Provides a context menu on each stash with _Apply Stashed Changes_ (confirmation required), _Delete Stashed Changes_ (confirmation required), _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, _Open Revisions_, _Copy Commit Message to Clipboard_, and _Refresh_ commands
      - Provides a context menu on each stashed file with _Apply Changes_, _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, and _Show File History_ commands

  - **File History View** - provides the revision history of the active file

    ![GitLens File History view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-gitlens-explorer-history.png)

    - Automatically updates to track the active editor
    - Provides a context menu with _Open File_, _Open File in Remote_, and _Refresh_ commands
    - Provides a context menu on each revision (commit) with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands

  - Quickly switch between views using the _Switch to Repository View_ or _Switch to File History View_ commands
  - Provides toolbar commands to _Search Commits_, _Switch to Repository View_ or _Switch to File History View_, and _Refresh_

- Adds all-new interactivity to the hover annotations

  ![Hover Annotations](https://raw.githubusercontent.com/eamodio/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-hovers-annotations.png)

  - Adds the following command-links to the **details** hover annotation
    - Clicking the commit id will run the _Show Commit Details_ command
  - Adds the following command-links to the **changes** hover annotation
    - Clicking on **Changes** will run the _Open Changes_ command
    - Clicking the current and previous commit ids will run the _Show Commit Details_ command

- Adds support for remote services with custom domains &mdash; closes [#120](https://github.com/eamodio/vscode-gitlens/issues/120)
- Adds support for the Bitbucket Server (previously called Stash) remote service &mdash; closes [#120](https://github.com/eamodio/vscode-gitlens/issues/120)
- Adds `gitlens.blame.ignoreWhitespace` setting to specify whether to ignore whitespace when comparing revisions during blame operations &mdash; closes [#138](https://github.com/eamodio/vscode-gitlens/issues/138)
- Adds _Compare File Revisions_ command (`gitlens.diffWith`) - compares the specified file revisions
- Adds _Open Branches in Remote_ command (`gitlens.openBranchesInRemote`) - opens the branches in the supported remote service
- Adds _Stash Changes_ command (`gitlens.stashSave`) to the source control group context menu &mdash; can now stash a group of files
- Adds _Stash Changes_ command (`gitlens.stashSave`) to the source control resource context menu &mdash; can now stash individual files (works with multi-select too!)
- Adds `gitlens.gitExplorer.view` setting to specify the starting view (mode) of the _GitLens_ explorer
- Adds `gitlens.gitExplorer.showTrackingBranch` setting to specify whether to show the tracking branch when displaying local branches in the _GitLens_ explorer
- Adds `gitlens.gitExplorer.commitFormat` setting to specify the format of committed changes in the _GitLens_ explorer
- Adds `gitlens.gitExplorer.commitFileFormat` setting to specify the format of a committed file in the _GitLens_ explorer
- Adds `gitlens.gitExplorer.stashFormat` setting to specify the format of stashed changes in the _GitLens_ explorer
- Adds `gitlens.gitExplorer.stashFileFormat` setting to specify the format of a stashed file in the _GitLens_ explorer
- Adds `${filePath}` token to file formatting settings

### Changed

- Changes _Show Stashed Changes_ option icon in repository status quick pick menu to match the _GitLens_ explorer
- Changes _Stash Changes_ option icon in stashed changes quick pick menu to a plus (+)
- Renames _Compare File with Previous_ command (`gitlens.diffWithPrevious`) to _Compare File with Previous Revision_
- Renames _Compare File with Next Commit_ command (`gitlens.diffWithNext`) to _Compare File with Next Revision_
- Renames _Compare File with Working Tree_ command (`gitlens.diffWithWorking`) to _Compare File with Working Revision_
- Renames _Compare Line Commit with Previous_ command (`gitlens.diffLineWithPrevious`) to _Compare Line Revision with Previous_
- Renames _Compare Line Commit with Working Tree_ command (`gitlens.diffLineWithWorking`) to _Compare Line Revision with Working_

### Removed

- Removes **Git Stashes** view - as it's functionality has been folded into the new _GitLens_ explorer
- Removes `gitlens.stashExplorer.stashFormat` setting
- Removes `gitlens.stashExplorer.stashFileFormat` setting
- Removes _Stash Unstaged Changes_ option from stashed changes quick pick menu &mdash; didn't work as intended
- Removes the seeding of the commit search command from the clipboard

### Fixed

- Fixes an issue where double hover annotations could be shown on blank lines
- Fixes an issue where remote branches couldn't be opened properly in their remote service
- Fixes [#130](https://github.com/eamodio/vscode-gitlens/issues/130) - First-run "Thank you for choosing GitLens! [...]" info message shown on every start up
- Fixes an issue where sometimes diffs (via branch name) wouldn't open properly
- Fixes an issue where remotes are queried more than once on startup

## [4.4.3] - 2017-08-30

## Fixed

- Fixes [#135](https://github.com/eamodio/vscode-gitlens/issues/135) - Full-width characters break gutter annotations (really this time)

## [4.4.2] - 2017-08-29

## Fixed

- Fixes [#135](https://github.com/eamodio/vscode-gitlens/issues/135) - Full-width characters break gutter annotations

## [4.4.1] - 2017-08-23

## Fixed

- Fixes [#114](https://github.com/eamodio/vscode-gitlens/issues/114) - Stylus files makes code lens freak out

## [4.4.0] - 2017-08-18

## Added

- Adds a progress indicator to the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) icon &mdash; pulses while annotations are computed
- Adds an active state to the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) icon &mdash; turns orange while the annotations are visible
- Adds automatic disabling of the current line blame annotations when starting a debug session and will restore them when the debug session ends &mdash; can still be manually toggled via the _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`)

## Changed

- Changes chat links from Gitter to [Slack](https://join.slack.com/t/vscode-gitlens/shared_invite/MjIxOTgxNDE3NzM0LTE1MDE2Nzk1MTgtMjkwMmZjMzcxNQ)
- Changes the look of the line separators on the gutter blame annotations
- Changes the `gitlens.advanced.toggleWhitespace.enabled` configuration setting to default to `false` &mdash; thanks to the awesome work in vscode by Alexandru Dima ([@alexandrudima](https://github.com/alexandrudima)) this is no longer required!

## Removed

- Removes unneeded `gitlens.stashExplorer.enabled` configuration setting since users can add or remove views natively now
- Removes unneeded _Toggle Git Stashes Explorer_ command (`gitlens.stashExplorer.toggle`) since users can add or remove views natively now
- Removes the `gitlens.theme.annotations.file.hover.separateLines` configuration setting

## Fixed

- Fixes jumpiness when opening a diff to a certain line

## [4.3.3] - 2017-07-28

## Added

- Adds progress indicator for when computing annotations takes a while

## Changed

- Optimizes performance of the providing blame annotations, especially for large files (saw a 3.5x improvement on some files)

## Fixed

- Fixes [#107](https://github.com/eamodio/vscode-gitlens/issues/107) - Double-byte characters break blame layout (still requires proper font support)

## [4.3.2] - 2017-07-20

## Fixed

- Fixes [#118](https://github.com/eamodio/vscode-gitlens/issues/118) - GitLens stopped working on latest insiders build &mdash; thanks to [PR #121](https://github.com/eamodio/vscode-gitlens/pull/121) by Johannes Rieken ([@jrieken](https://github.com/jrieken))

## [4.3.1] - 2017-07-03

## Added

- Adds `gitlens.stashExplorer.enabled` setting to specify whether to show the **Git Stashes** view
- Adds _Toggle Git Stashes Explorer_ command (`gitlens.stashExplorer.toggle`) - toggles the **Git Stashes** view on and off

## Changed

- Hides the **Git Stashes** view by default

## Fixed

- Fixes [#108](https://github.com/eamodio/vscode-gitlens/issues/108) - Option to remove stash explorer from the main explorer?

## [4.3.0] - 2017-07-03

## Added

- Adds **Git Stashes** view to the Explorer activity
  - Shows all of the stashed changes in the repository
  - Provides toolbar buttons to _Stash Changes_ and _Refresh_
  - Provides a context menu with _Apply Stashed Changes_ and _Delete Stashed Changes_ commands - both require a confirmation
  - Expand each stash to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
    - Provides a context menu with _Open Changes_, _Open File_, _Open Stashed File_, _Open File in Remote_, and _Compare File with Working Tree_ commands

## [4.2.0] - 2017-06-27

## Added

- Adds _Compare File with Revision..._ command (`gitlens.diffWithRevision`) - compares the active file with the selected revision of the same file
- Adds _Open Changed Files_ command (`gitlens.openChangedFiles`) to the source control group context menu
- Adds _Close Unchanged Files_ command (`gitlens.closeUnchangedFiles`) to the source control group context menu
- Adds _Open File in Remote_ command (`gitlens.openFileInRemote`) to the source control resource context menu
- Adds _Compare File with Revision..._ command (`gitlens.diffWithRevision`) to the source control resource context menu
- Adds _Show File History_ command (`gitlens.showQuickFileHistory`) to the source control resource context menu

## Changed

- Renames _Compare File with..._ command to `Compare File with Branch...`
- Renames _Open Line Commit in Remote_ command to `Open Commit in Remote`
- Renames _Show Line Commit Details_ command to `Show Commit File Details`
- Updates the description of `gitlens.blame.line.enabled` to be clearer about its behavior
- Updates the description of `gitlens.codeLens.enabled` to be clearer about its behavior

### Fixed

- Fixes [#103](https://github.com/eamodio/vscode-gitlens/issues/103) - Toggle file blame annotations disables line blame annotations if line blame annotations are off by default
- Fixes another infinite loop in the _Close Unchanged Files_ command

## [4.1.4] - 2017-06-25

## Changed

- Optimizes performance of the _Compare with Previous_ commands - also avoids trying to focus a line if we don't have one

### Fixed

- Fixes **changes** (diff) hover not showing the correct previous line (for real this time)
- Attempts to fix [#99](https://github.com/eamodio/vscode-gitlens/issues/99) - undo/redo spawns too many git processes

## [4.1.3] - 2017-06-20

### Fixed

- Fixes **changes** (diff) hover not showing the correct previous line when showing recent changes annotations of the whole-file

## [4.1.2] - 2017-06-15

### Fixed

- Fixes [#96](https://github.com/eamodio/vscode-gitlens/issues/96) - External diff command can be unintentionally triggered

## [4.1.1] - 2017-06-13

### Added

- Adds an `alt` command to the _Toggle File Blame Annotations_ command button, which when you hold down `alt` and click it will execute the _Toggle Recent File Changes Annotations_ command instead

### Fixed

- Fixes missing _Toggle File Blame Annotations_ command icon

## [4.1.0] - 2017-06-13

### Added

- Adds all-new recent changes annotations of the whole-file - annotates and highlights all of lines changed in the most recent commit
  - Can customize the [layout](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#file-recent-changes-annotation-settings), as well as the [theme](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#theme-settings)
- Adds _Toggle Recent File Changes Annotations_ command (`gitlens.toggleFileRecentChanges`) - toggles the recent changes annotations on and off
- Adds ability to press `Escape` to quickly toggle any whole-file annotations off
- Improves performance
  - Optimized git output parsing to increase speed and dramatically reduce memory usage
  - Defers diff chunk parsing until it is actually required
- Adds `gitlens.defaultDateFormat` setting to specify how all absolute dates will be formatted by default

### Fixed

- Fixes excessive memory usage when parsing diffs
- Fixes extra newline in multi-line commit messages
- Fixes (again) [#33](https://github.com/eamodio/vscode-gitlens/issues/33) - Commit messages can causes markdown formatting in hovers

## [4.0.1] - 2017-06-09

### Fixed

- Fixes [#87](https://github.com/eamodio/vscode-gitlens/issues/87) - Can't open files in remote when using git@ urls (ssh)

## [4.0.0] - 2017-06-09

### Added

- Adds all-new, beautiful, highly customizable and themable, file blame annotations
  - Can now fully customize the [layout and content](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#file-blame-annotation-settings), as well as the [theme](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#theme-settings)
- Adds all-new configurability and themeability to the current line blame annotations
  - Can now fully customize the [layout and content](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#line-blame-annotation-settings), as well as the [theme](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#theme-settings)
- Adds all-new configurability to the status bar blame information
  - Can now fully customize the [layout and content](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#status-bar-settings)
- Adds all-new [configurability](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#advanced-settings) over which commands are added to which menus via the `gitlens.advanced.menus` setting
- Adds better [configurability](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#code-lens-settings) over where Git code lens will be shown &mdash; both by default and per language
- Adds an all-new **changes** (diff) hover annotation to the current line - provides instant access to the line's previous version
- Adds _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`) - toggles the current line blame annotations on and off
- Adds _Show Line Blame Annotations_ command (`gitlens.showLineBlame`) - shows the current line blame annotations
- Adds _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) - toggles the file blame annotations on and off
- Adds _Show File Blame Annotations_ command (`gitlens.showFileBlame`) - shows the file blame annotations
- Adds _Open File in Remote_ command (`gitlens.openFileInRemote`) to the `editor/title` context menu
- Adds _Open Repo in Remote_ command (`gitlens.openRepoInRemote`) to the `editor/title` context menu
- Adds `gitlens.strings.*` settings to allow for the customization of certain strings displayed
- Adds `gitlens.theme.*` settings to allow for the theming of certain elements
- Adds `gitlens.advanced.telemetry.enabled` settings to explicitly opt-in or out of telemetry, but still ultimately honors the `telemetry.enableTelemetry` setting
- Adds ability to suppress most warning messages - which can be re-enabled using the _Reset Suppressed Warnings_ command (`gitlens.resetSuppressedWarnings`)

### Changed

- (BREAKING) Almost all of the GitLens settings have either been renamed, removed, or otherwise changed - see the [README](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#extension-settings)`
- Changes the positioning of the Git code lens to try to be at the end of any other code lens on the same line
- Changes the position of the _Open File in Remote_ command (`gitlens.openFileInRemote`) in the context menus - now in the `navigation` group
- Changes the _Toggle Git Code Lens_ command (`gitlens.toggleCodeLens`) to always toggle the Git code lens on and off
- Changes the default of `gitlens.advanced.toggleWhitespace.enabled` back to `true`, but automatically disables whitespace toggling if whitespace rendering is not on

### Removed

- Removes the on-demand **trailing** file blame annotations &mdash; didn't work out and just ended up with a ton of visual noise
- Removes _Toggle Blame Annotations_ command (`gitlens.toggleBlame`) - replaced by the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`)
- Removes _Show Blame Annotations_ command (`gitlens.showBlame`) - replaced by the _Show File Blame Annotations_ command (`gitlens.showFileBlame`)

### Fixed

- Fixes [#81](https://github.com/eamodio/vscode-gitlens/issues/81) - Current line annotation feels too sticky
- Fixes [#83](https://github.com/eamodio/vscode-gitlens/issues/83) - Calling "close unchanged files" results in no new files being openable
- Fixes issues with the zone.js monkey patching done by application insights (telemetry) - disables all the monkey patching
- Fixes issue with _Open Branch in Remote_ & _Open Repository in Remote_ not showing when there are no open editors

## [3.6.1] - 2017-06-07

### Fixed

- Fixes issues with the zone.js monkey patching done by application insights (telemetry) - disables all the monkey patching

## [3.6.0] - 2017-06-02

### Added

- Adds diff information (the line's previous version) into the active line hover
- Adds a `gitlens.diffWithWorking` status bar command option - compares the current line commit with the working tree

### Changed

- Changes the behavior of the _Compare File with Working Tree_ command (`gitlens.diffWithWorking`) - always does what it says :)
  - Compares the current file with the working tree &mdash; if the current file _is_ the working file, it will show a `File matches the working tree` message
- Changes the behavior of the _Compare File with Previous_ command (`gitlens.diffWithPrevious`) - always does what it says :)
  - Compares the current file with the previous commit to that file
- Changes the behavior of the `gitlens.diffWithPrevious` status bar command option - compares the current line commit with the previous
- Renames _Compare File with Previous Commit_ command to _Compare File with Previous_
- Renames _Compare Line with Previous Commit_ command to _Compare Line Commit with Previous_
- Renames _Compare Line with Working Tree_ command to _Compare Line Commit with Working Tree_
- Renames _Compare with Previous Commit_ in quick pick menus to _Compare File with Previous_
- Renames _Compare with Working Tree_ in quick pick menus to _Compare File with Working Tree_

### Fixed

- Fixes [#79](https://github.com/eamodio/vscode-gitlens/issues/79) - Application insights package breaks GitLens + eslint

## [3.5.1] - 2017-05-25

### Changed

- Changes certain code lens actions to be unavailable (unclickable) when the commit referenced is uncommitted - avoids unwanted error messages
- Debounces more events when tracking the active line to further reduce lag

### Fixed

- Fixes [#71](https://github.com/eamodio/vscode-gitlens/issues/71) - Blame information is invalid when a file has changed outside of vscode
- Fixes issue with showing the incorrect blame for versioned files (i.e. files on the left of a diff, etc)

## [3.5.0] - 2017-05-24

### Added

- Improves performance
  - Reduces the number of git calls on known "untrackables"
  - Caches many more git commands to reduce git command round-trips and parsing
  - Increases the debounce (delay) on cursor movement to reduce lag when navigating around a file
- Adds diff information (the line's previous version) into the active line hover when the current line is uncommitted
- Adds `gitlens.statusBar.alignment` settings to control the alignment of the status bar &mdash; thanks to [PR #72](https://github.com/eamodio/vscode-gitlens/pull/72) by Zack Schuster ([@zackschuster](https://github.com/zackschuster))!
- Adds _Open Branch in Remote_ command (`gitlens.openBranchInRemote`) - opens the current branch commits in the supported remote service
- Adds _Open Repository in Remote_ command (`gitlens.openRepoInRemote`) - opens the repository in the supported remote service
- Adds _Stash Changes_ option to stashed changes quick pick menu &mdash; no longer hidden behind the `"gitlens.insiders": true` setting
- Adds _Stash Unstaged Changes_ option to stashed changes quick pick menu &mdash; no longer hidden behind the `"gitlens.insiders": true` setting
- Adds _Apply Stashed Changes_ command (`gitlens.stashApply`) to apply the selected stashed changes to the working tree &mdash; no longer hidden behind the `"gitlens.insiders": true` setting
- Adds _Stash Changes_ command (`gitlens.stashSave`) to stash any working tree changes &mdash; no longer hidden behind the `"gitlens.insiders": true` setting
- Adds support to the _Search commits_ command (`gitlens.showCommitSearch`) to work without any active editor
- Adds commit search pre-population &mdash; if there is an active editor it will use the commit sha of the current line commit, otherwise it will use the current clipboard

### Changed

- Changes _Open File in Remote_ and _Open Line Commit in Remote_ commands to actually work for everyone (part of their implementation was still behind the `gitlens.insiders` setting)
- Changes the active line hover to only show at the beginning and end of a line if `gitlens.blame.annotation.activeLine` is `both`
- Changes `alt+f` shortcut to `alt+/` for the _Search commits_ command (`gitlens.showCommitSearch`)
- Changes `alt+right` on commit details quick pick menu to execute the _Compare File with Previous Commit_ command (`gitlens.diffWithPrevious`) when a file is selected
- Changes `alt+right` on repository status quick pick menu to execute the _Compare File with Previous Commit_ command (`gitlens.diffWithPrevious`) when a file is selected
- Refactors command argument passing to allow for future inclusion into the SCM menus

### Fixed

- Fixes [#73](https://github.com/eamodio/vscode-gitlens/issues/73) - GitLens doesn't work with Chinese filenames
- Fixes [#40](https://github.com/eamodio/vscode-gitlens/issues/40) - Encoding issues
  - Given the limitations of the vscode api, I'm unable to fix all the encoding issues, but many of them should now be squashed
  - `files.encoding` is now honored for the cases where the encoding cannot currently be gleaned
- Fixes incorrect file selection from the commit details quick pick menu
- Fixes incorrect command execution when using `"gitlens.statusBar.command": "gitlens.showQuickRepoHistory"`
- Fixes a bunch of issues that were revealed by enabling Typescript `strict` mode

## [3.4.9] - 2017-05-03

### Added

- Adds better support for deleted files when choosing _Open Changed Files_ via in quick pick menus - now opens the file revision from the previous commit
- Adds better support for deleted files when using `alt+right arrow` shortcut on the commit details quick pick menu - now opens the file revision from the previous commit

### Changed

- Removes deleted files when choosing _Open Working Changed Files_ via in quick pick menus

## [3.4.8] - 2017-05-02

### Changed

- Changes display name in the marketplace to **Git Lens** because of the marketplace search ranking algorithm

## [3.4.6] - 2017-05-01

### Added

- Adds better support for deleted files when choosing _Open File_ via in quick pick menus - now opens the file revision from the previous commit
- Adds better support for deleted files when choosing _Open File in Remote_ via in quick pick menus - now opens the file revision from the previous commit
- Improves performance by caching the git path to avoid lookups on every git command

### Changed

- Renames `gitlens.advanced.codeLens.debug` setting to `gitlens.codeLens.debug`
- Renames `gitlens.advanced.debug` setting to `gitlens.debug`
- Renames `gitlens.output.level` setting to `gitlens.outputLevel`

### Fixed

- Fixes incorrect file selection when showing commit details quick pick menu
- Fixes timing error on startup

## [3.4.5] - 2017-04-13

### Added

- Completely overhauls the [GitLens documentation](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens) and messaging &mdash; make sure to check it out to see all the powerful features GitLen provides!
- Adds `gitlens.blame.annotation.activeLineDarkColor` & `gitlens.blame.annotation.activeLineLightColor` settings to control the colors of the active line blame annotation

### Changed

- Changes _Toggle Git Code Lens_ command to work when `gitlens.codeLens.visibility` is set to `auto` (the default)
- Renames _Compare with..._ command to _Compare File with..._
- Renames _Compare with Next Commit_ command to _Compare File with Next Commit_
- Renames _Compare with Previous Commit_ command to _Compare File with Previous Commit_
- Renames _Compare with Previous Commit_ command to _Compare File with Previous Commit_
- Renames _Compare with Working Tree_ command to _Compare File with Working Tree_

### Fixed

- Fixes issue with _Open Commit in Remote_ not working
- Fixes issue with many commands missing from the **Command Palette**

## [3.3.3] - 2017-04-10

### Fixed

- Fixes issue with newlines in commit messages in the file/branch/stash history quick pick menus (truncates and adds an ellipse icon)

## [3.3.2] - 2017-04-10

### Removed

- Removes `gitlens.blame.annotation.characters.*` settings since they were added to deal with unicode bugs in a previous version of vscode

### Fixed

- Closes [#63](https://github.com/eamodio/vscode-gitlens/issues/63) - Switch commit message and author in commit pick list. Also reduces clutter in the commit quick pick menus

## [3.3.1] - 2017-04-09

### Changed

- Changes commit search prefixes &mdash; no prefix for message search, `@` for author, `:` for file pattern, `#` for commit id
- Changes `sha` terminology to `commit id` in the UI

### Fixed

- Fixes issues with author searching

## [3.3.0] - 2017-04-09

### Added

- Adds _Search commits_ command (`gitlens.showCommitSearch`) to allow commit searching by message, author, file pattern, or sha
- Adds `alt+f` shortcut for the _Search commits_ command (`gitlens.showCommitSearch`)
- Adds _Show Commit Search_ command to the branch history quick pick menu
- Adds _Show Stashed Changes_ command to the repository status quick pick menu
- Adds a _Don't Show Again_ option to the GitLen update notification

### Changed

- Changes _Open x in Remote_ commands to be no longer hidden behind the `gitlens.insiders` setting

### Fixed

- Fixes [#59](https://github.com/eamodio/vscode-gitlens/issues/59) - Context menu shows gitlens commands even if folder/file is not under git

## [3.2.1]

### Fixed

- Fixes [#57](https://github.com/eamodio/vscode-gitlens/issues/57) - No more blank message if `diff.tool` is missing

## [3.2.0]

### Added

- Adds support for single files opened in vscode &mdash; you are no longer required to open a folder for GitLens to work

### Fixed

- Fixes [#57](https://github.com/eamodio/vscode-gitlens/issues/57) - Warn on directory compare when there is no diff tool configured
- Fixes [#58](https://github.com/eamodio/vscode-gitlens/issues/58) - Work with git sub-modules
- Fixes issue with _Open \* in Remote_ commands with nested repositories and non-git workspace root folder

## [3.1.0]

### Added

- Adds _Show Stashed Changes_ command (`gitlens.showQuickStashList`) to open a quick pick menu of all the stashed changes
- Adds insiders _Stash Changes_ option to stashed changes quick pick menu &mdash; enabled via `"gitlens.insiders": true`
- Adds insiders _Stash Unstaged Changes_ option to stashed changes quick pick menu
- Adds insiders _Apply Stashed Changes_ command (`gitlens.stashApply`) to apply the selected stashed changes to the working tree
- Adds insiders _Stash Changes_ command (`gitlens.stashSave`) to stash any working tree changes

### Fixed

- Fixes incorrect counts in upstream status

## [3.0.5]

### Added

- Adds additional insiders support for GitLab, Bitbucket, and Visual Studio Team Services to the _Open x in Remote_ commands and quick pick menus &mdash; enabled via `"gitlens.insiders": true`
- Adds insiders line support to _Open File in Remote_ command (`gitlens.openFileInRemote`)
- Adds original file name for renamed files to the repository status and commit details quick pick menu

### Fixed

- Fixes [#56](https://github.com/eamodio/vscode-gitlens/issues/56) - Handle file names with spaces

## [3.0.4]

### Changed

- Changes telemetry a bit to reduce noise

### Fixed

- Fixes common telemetry error by switching to non-strict iso dates (since they are only available in later git versions)

## [3.0.3]

### Added

- Adds a fallback to work with Git version prior to `2.11.0` &mdash; terribly sorry for the inconvenience :(

### Fixed

- Fixes [#55](https://github.com/eamodio/vscode-gitlens/issues/55) - reverts Git requirement back to `2.2.0`
- Fixes issues with parsing merge commits

## [3.0.2]

### Changed

- Changes required Git version to `2.11.0`

## [3.0.1]

### Added

- Adds basic telemetry &mdash; honors the vscode telemetry configuration setting

## [3.0.0]

### Added

- Adds insiders support for _Open in GitHub_ to the relevant quick pick menus &mdash; enabled via `"gitlens.insiders": true`
- Adds insiders _Open Line Commit in Remote_ command (`gitlens.openCommitInRemote`) to open the current commit in the remote service (currently only GitHub)
- Adds insiders _Open File in Remote_ command (`gitlens.openFileInRemote`) to open the current file in the remote service (currently only GitHub)
- Adds an update notification for feature releases
- Adds _Show Branch History_ command (`gitlens.showQuickBranchHistory`) to show the history of the selected branch
- Adds _Show Last Opened Quick Pick_ command (`gitlens.showLastQuickPick`) to re-open the previously opened quick pick menu - helps to get back to previous context
- Adds `alt+-` shortcut for the _Show Last Opened Quick Pick_ command (`gitlens.showLastQuickPick`)
- Adds upstream status information (if available) to the repository status pick pick
- Adds file status rollup information to the repository status pick pick
- Adds file status rollup information to the commit details quick pick menu
- Adds _Compare with..._ (`gitlens.diffWithBranch`) command to compare working file to another branch (via branch quick pick menu)
- Adds branch quick pick menu to _Directory Compare_ (`gitlens.diffDirectory`) command
- Adds support for `gitlens.showQuickFileHistory` command execution via code lens to limit results to the code lens block
- Adds current branch to branch quick pick menu placeholder
- Adds _Show Branch History_ command to the branch history quick pick menu when showing only limited commits (e.g. starting at a specified commit)
- Adds _Show File History_ command to the file history quick pick menu when showing only limited commits (e.g. starting at a specified commit)
- Adds _Don't Show Again_ option to the unsupported git version notification

### Changed

- Changes _Show Repository History_ command to _Show Current Branch History_
- Changes _Repository History_ terminology to _Branch History_

### Fixed

- Fixes issue with `gitlens.diffWithPrevious` command execution via code lens when the code lens was not at the document/file level
- Fixes issue where full shas were displayed on the file/blame history explorers
- Fixes [#30](https://github.com/eamodio/vscode-gitlens/issues/30) - Diff with Working Tree fails from repo/commit quick pick list if file was renamed (and the commit was before the rename)
- Fixes various other quick pick menu command issues when a file was renamed
- Fixes various issues when caching is disabled
- Fixes issues with parsing commits history
- Fixes various issues with merge commits

## [2.12.2]

### Fixed

- Fixes [#50](https://github.com/eamodio/vscode-gitlens/issues/50) - excludes container-level code lens from `html` and `vue` language files

## [2.12.1]

### Added

- Adds `gitlens.advanced.codeLens.debug` setting to control whether to show debug information in code lens

### Fixed

- Fixes issue where `gitlens.showQuickRepoHistory` command fails to open when there is no active editor

## [2.12.0]

### Added

- Adds progress indicator for the `gitlens.showQuickFileHistory` & `gitlens.showQuickRepoHistory` quick pick menus
- Adds paging support to the `gitlens.showQuickFileHistory` & `gitlens.showQuickRepoHistory` quick pick menus
  - Adds _Show Previous Commits_ command
  - Adds _Show Next Commits_ command
- Adds keyboard page navigation via `alt+,` (previous) & `alt+.` (next) on the `gitlens.showQuickFileHistory` & `gitlens.showQuickRepoHistory` quick pick menus
- Adds keyboard commit navigation via `alt+,` (previous) & `alt+.` (next) on the `gitlens.showQuickCommitDetails` & `gitlens.showQuickCommitFileDetails` quick pick menus

### Changed

- Changes behavior of `gitlens.showQuickFileHistory` & `gitlens.showFileHistory` to no longer show merge commits
- Changes `gitlens.copyShaToClipboard` to copy the full sha, rather than short sha
- Changes internal tracking to use full sha (rather than short sha)

## [2.11.2]

### Added

- Adds `gitlens.diffWithNext` command to open a diff with the next commit
- Adds `alt+.` shortcut for the `gitlens.diffWithNext` command

### Changed

- Changes `shift+alt+p` shortcut to `alt+,` for the `gitlens.diffWithPrevious` command
- Changes `alt+p` shortcut to `shift+alt+,` for the `gitlens.diffLineWithPrevious` command

### Removed

- Removes `gitlens.toggleCodeLens` from Command Palette when not available
- Removes `gitlens.toggleCodeLens` shortcut key when not available

### Fixed

- Fixes (#45)[https://github.com/eamodio/vscode-gitlens/issues/45] - Keyboard Shortcut collision with Project Manager

## [2.11.1]

### Added

- Adds blame and active line annotation support to git diff split view (right side)
- Adds command (compare, copy sha/message, etc) support to git diff split view (right side)

### Fixed

- Fixes intermittent issues when toggling whitespace for blame annotations

## [2.11.0]

### Added

- Adds `gitlens.showQuickCommitFileDetails` command to show a quick pick menu of details for a file commit
- Adds `gitlens.showQuickCommitFileDetails` command to code lens
- Adds `gitlens.showQuickCommitFileDetails` command to the status bar
- Adds `gitlens.closeUnchangedFiles` command to close any editors that don't have uncommitted changes
- Adds `gitlens.openChangedFiles` command to open all files that have uncommitted changes
- Adds _Directory Compare_ (`gitlens.diffDirectory`) command to open the configured git difftool to compare directory versions
- Adds _Directory Compare with Previous Commit_ command on the `gitlens.showQuickCommitDetails` quick pick menu
- Adds _Directory Compare with Working Tree_ command on the `gitlens.showQuickCommitDetails` quick pick menu
- Adds a **Changed Files** grouping on the `gitlens.showQuickCommitDetails` quick pick menu
- Adds a _Close Unchanged Files_ command on the `gitlens.showQuickRepoStatus` quick pick menu
- Adds a contextual description to the _go back_ command in quick pick menus

### Changed

- Changes layout of the `gitlens.showQuickRepoStatus` quick pick menu for better clarity
- Changes behavior of `gitlens.showQuickCommitDetails` to show commit a quick pick menu of details for a commit
- Changes default of `gitlens.codeLens.recentChange.command` to be `gitlens.showQuickCommitFileDetails` (though there is no visible behavior change)
- Renames _Open Files_ to _Open Changed Files_ on the `gitlens.showQuickCommitDetails` quick pick menu
- Renames _Open Working Files_ to _Open Changed Working Files_ on the `gitlens.showQuickCommitDetails` quick pick menu
- Renames _Show Changed Files_ to _Show Commit Details_ on the `gitlens.showQuickCommitFileDetails` quick pick menu
- Renames _Open Files_ to _Open Changed Files_ on the `gitlens.showQuickRepoStatus` quick pick menu

### Fixed

- Fixes [#44](https://github.com/eamodio/vscode-gitlens/issues/43) by adding a warning message about Git version requirements
- Fixes intermittent errors when adding active line annotations
- Fixes intermittent errors when opening multiple files via quick pick menus

## [2.10.1]

### Fixed

- Fixes [#43](https://github.com/eamodio/vscode-gitlens/issues/43) - File-level code lens isn't using the blame of the whole file as it should
- Fixes issue with single quotes (') in annotations
- Fixes output channel logging (also adds more debug information to code lens &mdash; when enabled)

## [2.10.0]

### Added

- Adds blame and active line annotation support to git diff split view
- Adds command (compare, copy sha/message, etc) support to git diff split view

### Fixed

- Fixes startup failure if caching was disabled
- Fixes missing _Compare Line with Previous Commit_ context menu item
- Fixes [#41](https://github.com/eamodio/vscode-gitlens/issues/41) - Toggle Blame annotations on compare files page
- Fixes issue with undo (to a saved state) not causing annotations to reappear properly
- Attempts to fix [#42](https://github.com/eamodio/vscode-gitlens/issues/42) - Cursor on Uncommitted message

## [2.9.0]

### Changed

- To accommodate the realization that blame information is invalid when a file has unsaved changes, the following behavior changes have been made
  - Status bar blame information will hide
  - Code lens change to a `Cannot determine...` message and become unclickable
  - Many menu choices and commands will hide

### Fixed

- Fixes [#38](https://github.com/eamodio/vscode-gitlens/issues/38) - Toggle Blame Annotation button shows even when it isn't valid
- Fixes [#36](https://github.com/eamodio/vscode-gitlens/issues/36) - Blame information is invalid when a file has unsaved changes

## [2.8.2]

### Added

- Adds `gitlens.blame.annotation.dateFormat` to specify how absolute commit dates will be shown in the blame annotations
- Adds `gitlens.statusBar.date` to specify whether and how the commit date will be shown in the blame status bar
- Adds `gitlens.statusBar.dateFormat` to specify how absolute commit dates will be shown in the blame status bar

### Fixed

- Fixes [#39](https://github.com/eamodio/vscode-gitlens/issues/39) - Add date format options for status bar blame

## [2.8.1]

### Fixed

- Fixes issue where _Compare with \*_ commands fail to open when there is no active editor

## [2.8.0]

### Added

- Adds new _Open File_ command on the `gitlens.showQuickCommitDetails` quick pick menu to open the commit version of the file
- Adds new _Open File_ command on the `gitlens.showQuickCommitDetails` quick pick menu to open the commit version of the files
- Adds `alt+left` keyboard shortcut in quick pick menus to _go back_
- Adds `alt+right` keyboard shortcut in quick pick menus to execute the currently selected item while keeping the quick pick menu open (in most cases)
  - `alt+right` keyboard shortcut on commit details file name, will open the commit version of the file

### Changed

- Indents the file statuses on the `gitlens.showQuickCommitDetails` quick pick menu
- Renames _Open File_ to _Open Working File_ on the `gitlens.showQuickCommitDetails` quick pick menu
- Renames _Open File_ and _Open Working Files_ on the `gitlens.showQuickCommitDetails` quick pick menu
- Reorders some quick pick menus

### Fixed

- Fixes [#34](https://github.com/eamodio/vscode-gitlens/issues/34) - Open file should open the selected version of the file
- Fixes some issue where some editors opened by the quick pick would not be opened in preview tabs
- Fixes issue where copy to clipboard commands would fail if there was no active editor
- Fixes issue where active line annotations would show for opened versioned files
- Fixes issue where code lens compare commands on opened versioned files would fail

## [2.7.1]

### Added

- Adds proper support for multi-line commit messages

### Fixed

- Fixes [#33](https://github.com/eamodio/vscode-gitlens/issues/33) - Commit message styled as title in popup, when message starts with hash symbol

## [2.7.0]

### Added

- Adds file status icons (added, modified, deleted, etc) to the `gitlens.showQuickCommitDetails` quick pick menu
- Adds _Copy Commit Sha to Clipboard_ command to commit files quick pick menu
- Adds _Copy Commit Message to Clipboard_ command to commit files quick pick menu

### Changed

- Changes _Show Commit History_ to _Show File History_ on the `gitlens.showQuickCommitDetails` quick pick menu
- Changes _Show Previous Commit History_ to _Show Previous File History_ on the `gitlens.showQuickCommitDetails` quick pick menu

### Fixed

- Fixes issue with repository status when there are no changes
- Fixes issue with `.` showing in the path of quick pick menus
- Fixes logging to clean up on extension deactivate

## [2.6.0]

### Added

- Adds `gitlens.showQuickRepoStatus` command to show a quick pick menu of files changed including status icons (added, modified, deleted, etc)
- Adds `alt+s` shortcut for the `gitlens.showQuickRepoStatus` command

## [2.5.6]

### Fixed

- Fixes [#32](https://github.com/eamodio/vscode-gitlens/issues/32) - 00000000 Uncommitted changes distracting

## [2.5.5]

### Fixed

- Fixes [#25](https://github.com/eamodio/vscode-gitlens/issues/25) - Blame information isn't updated after git operations (commit, reset, etc)

## [2.5.4]

### Fixed

- Fixes extra spacing in annotations

## [2.5.3]

### Fixed

- Fixes [#27](https://github.com/eamodio/vscode-gitlens/issues/27) - Annotations are broken in vscode insider build

## [2.5.2]

### Added

- Adds _Open File_ command to `gitlens.showQuickCommitDetails` quick pick menu
- Adds _Open Files_ command to `gitlens.showQuickCommitDetails` quick pick menu
- Improves performance of git-log operations in `gitlens.diffWithPrevious` and `gitlens.diffWithWorking` commands

### Changed

- Changes _Not Committed Yet_ author for uncommitted changes to _Uncommitted_

### Fixed

- Fixes showing `gitlens.showQuickCommitDetails` quick pick menu for uncommitted changes &mdash; now shows the previous commit details

## [2.5.1]

### Added

- Adds `gitlens.copyMessageToClipboard` command to copy commit message to the clipboard
- Adds `gitlens.copyMessageToClipboard` to the editor content menu
- Adds _Copy Commit Message to Clipboard_ command to `gitlens.showQuickCommitDetails` quick pick menu

### Changed

- Changes behavior of `gitlens.copyShaToClipboard` to copy the sha of the most recent commit to the repository if there is no active editor
- Changes behavior of `gitlens.showQuickFileHistory` to execute `gitlens.showQuickRepoHistory` if there is no active editor

### Fixed

- Fixes issue where shortcut keys weren't disabled if GitLens was disabled

## [2.5.0]

### Added

- Overhauls the `gitlens.showQuickRepoHistory`, `gitlens.showQuickFileHistory`, and `gitlens.showQuickCommitDetails` quick pick menus
  - Adds _Show Repository History_ command to `gitlens.showQuickFileHistory` quick pick menu
  - Adds _Show Previous Commits History_ command to `gitlens.showQuickCommitDetails` quick pick menu
  - Adds _Show Commits History_ command to `gitlens.showQuickCommitDetails` quick pick menu
  - Adds _Copy Commit Sha to Clipboard_ command to `gitlens.showQuickCommitDetails` quick pick menu
  - Adds _Show Changed Files_ command to `gitlens.showQuickCommitDetails` quick pick menu
  - Adds more robust _go back_ navigation in quick pick menus
  - Adds commit message to placeholder text of many quick pick menus
  - Adds icons for some commands
- Adds `gitlens.diffWithPrevious` command to the editor content menu
- Adds `gitlens.diffWithWorking` command to the editor content menu
- Adds `gitlens.showQuickRepoHistory` and `gitlens.showQuickCommitDetails` commands to code lens
- Adds `gitlens.showQuickRepoHistory` and `gitlens.showQuickCommitDetails` commands to the status bar

### Changed

- Changes the default command of `gitlens.codeLens.recentChange.command` to `gitlens.showQuickCommitDetails`
- Changes the default command of `gitlens.statusBar.command` to `gitlens.showQuickCommitDetails`
- Changes behavior of `gitlens.showQuickCommitDetails` to show commit commands rather than file set (use `Show Changed Files` command to get to the file set)
- Changes `gitlens.diffWithPrevious` command to behave as `gitlens.diffWithWorking` if the file has uncommitted changes
- Renames `gitlens.diffWithPrevious` command from `Diff Commit with Previous` to `Compare with Previous Commit`
- Renames `gitlens.diffLineWithPrevious` command from `Diff Commit (line) with Previous` to `Compare Line with Previous Commit`
- Renames `gitlens.diffWithWorking` command from `Diff Commit with Working Tree` to `Compare with Working Tree`
- Renames `gitlens.diffLineWithWorking` command from `Diff Commit (line) with Working Tree` to `Compare Line with Working Tree`

### Fixed

- Fixes issues with certain git commands not working on Windows
- Fixes [#31](https://github.com/eamodio/vscode-gitlens/issues/31) - Disable gitlens if the project does not have `.git` folder
- Fixes issue where quick pick menus could fail if there was no active editor
- Fixes code lens not updating in response to configuration changes

## [2.1.1]

### Fixed

- Fixes overzealous active line annotation updating on document changes

## [2.1.0]

### Added

- Adds a new GitLens logo and changes all images to svg
- Adds `alt+p` shortcut for the `gitlens.diffLineWithPrevious` command
- Adds `shift+alt+p` shortcut for the `gitlens.diffWithPrevious` command
- Adds `alt+w` shortcut for the `gitlens.diffLineWithWorking` command
- Adds `shift+alt+w` shortcut for the `gitlens.diffWithWorking` command
- Adds `gitlens.copyShaToClipboard` command to copy commit sha to the clipboard ([#28](https://github.com/eamodio/vscode-gitlens/issues/28))
- Adds `gitlens.showQuickCommitDetails` command to show a quick pick menu of details for a commit
- Adds `go back` choice to `gitlens.showQuickCommitDetails`, `gitlens.showQuickFileHistory`, and `gitlens.showQuickRepoHistory` quick pick menus
- Adds `gitlens.blame.annotation.highlight` to specify whether and how to highlight blame annotations ([#24](https://github.com/eamodio/vscode-gitlens/issues/24))
- Greatly improves performance of line navigation when either active line annotations or status bar blame is enabled

### Fixed

- Fixes [#29](https://github.com/eamodio/vscode-gitlens/issues/29) - Commit info tooltip duplicated for current line when blame is enabled
- Fixes issue where sometimes the commit history shown wasn't complete
- Fixes issues with `gitlens.diffLineWithPrevious` and `gitlens.diffWithPrevious` not following renames properly
- Fixes issues with `gitlens.diffLineWithPrevious` and `gitlens.diffWithPrevious` not always grabbing the correct commit

## [2.0.2]

### Added

- Adds auto-enable of whitespace toggling when using font-ligatures because of [vscode issue](https://github.com/Microsoft/vscode/issues/11485)
- Adds `gitlens.blame.annotation.characters.*` settings to provide some control over how annotations are displayed

### Fixed

- Fixes [#22](https://github.com/eamodio/vscode-gitlens/issues/22) - Cannot read property 'sha' of undefined

## [2.0.1]

### Fixed

- Fixes [#26](https://github.com/eamodio/vscode-gitlens/issues/26) - Active line annotation doesn't disappear properly after delete

## [2.0.0]

### Added

- Adds `gitlens.blame.annotation.activeLine` to specify whether and how to show blame annotations on the active line
- Adds full commit message (rather than just summary) to active line hover if `gitlens.blame.annotation.activeLine` is not `off`
- Adds new `trailing` blame annotation style &mdash; adds annotations after the code lines rather than before
- Adds `gitlens.blame.annotation.message` to show the commit message in `expanded` and `trailing` blame annotation styles
- Adds support for relative dates in blame annotations. Use `gitlens.blame.annotation.date`
- Re-adds context menu for `gitlens.diffLineWithPrevious` &mdash; since [vscode issue](https://github.com/Microsoft/vscode/issues/15395)
- Re-adds context menu for `gitlens.diffLineWithWorking` &mdash; since [vscode issue](https://github.com/Microsoft/vscode/issues/15395)

### Changed

- Changes the design of hover annotations &mdash; much cleaner now
- Disables automatic whitespace toggling by default as it is seemingly no longer needed as [vscode issue](https://github.com/Microsoft/vscode/issues/11485) seems fixed. It can be re-enabled with `gitlens.advanced.toggleWhitespace.enabled`

### Fixed

- Fixes issue where the status bar blame would get stuck switching between editors
- Fixes issue where code lens aren't updated properly after a file is saved

## [1.4.3]

### Added

- Adds some logging to hopefully trap [#22](https://github.com/eamodio/vscode-gitlens/issues/22) - Cannot read property 'sha' of undefined

### Fixed

- Fixes issue with the latest insiders build (1.9.0-insider f67f87c5498d9361c0b29781c341fd032815314b) where there is a collision of document schemes

## [1.4.2]

### Fixed

- Fixes issue where file history wouldn't compare correctly to working tree if the filename had changed

## [1.4.1]

### Added

- Adds `gitlens.advanced.gitignore.enabled` to enable/disable .gitignore parsing. Addresses [#20](https://github.com/eamodio/vscode-gitlens/issues/20) - Nested .gitignore files can cause blame to fail with a repo within another repo

## [1.4.0]

### Added

- Adds `alt+h` shortcut for the `gitlens.showQuickFileHistory` command
- Adds `shift+alt+h` shortcut for the `gitlens.showQuickRepoHistory` command
- Adds `gitlens.advanced.maxQuickHistory` to limit the number of quick history entries to show (for better performance); Defaults to 200
- Adds `gitlens.diffLineWithPrevious` as `alt` context menu item for `gitlens.diffWithPrevious`
- Adds `gitlens.diffLineWithWorking` as `alt` context menu item for `gitlens.diffWithWorking`
- Adds `gitlens.showFileHistory` as `alt` context menu item for `gitlens.showQuickFileHistory`

### Removed

- Removes context menu for `gitlens.diffLineWithPrevious` &mdash; since it is now the `alt` of `gitlens.diffWithPrevious`
- Removes context menu for `gitlens.diffLineWithWorking` &mdash; since it is now the `alt` of `gitlens.diffWithWorking`
- Replaces `gitlens.menus.fileDiff.enabled` and `gitlens.menus.lineDiff.enabled` with `gitlens.menus.diff.enabled` &mdash; since the switch between file and line diff is now controlled by the `alt` key

## [1.3.1]

### Added

- Adds _Diff Commit with Working Tree_ to the explorer context menu (assuming `gitlens.menus.fileDiff.enabled` is `true`)
- Adds _Diff Commit with Working Tree_ & _Diff Commit with Previous_ to the editor title context menu (assuming `gitlens.menus.fileDiff.enabled` is `true`)

### Changed

- Renames _Diff_ commands for better clarity
- Removes _Git_ from the commands as it feels unnecessary
- Reorders the context menu commands

## [1.3.0]

### Added

- Adds support for blame and history (log) on files opened via compare commands &mdash; allows for deep navigation through git history

## [1.2.0]

### Added

- Adds compare (working vs previous) options to repository history
- Adds compare (working vs previous) options to file history

### Fixed

- Fixes issue with repository history compare with commits with multiple files

## [1.1.1]

### Added

- Adds logging for tracking [#18](https://github.com/eamodio/vscode-gitlens/issues/18) - GitLens only displayed for some files

### Changed

- Changes `gitlens.showQuickRepoHistory` command to run without an open editor (falls back to the folder repository)

## [1.1.0]

### Added

- Adds new `gitlens.showQuickFileHistory` command to show the file history in a quick-pick list (palette)
- Adds new `gitlens.showQuickRepoHistory` command to show the repository history in a quick-pick list (palette)
- Adds `gitlens.showQuickFileHistory` option to the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings

### Changed

- Changes the `gitlens.statusBar.command` settings default to `gitlens.showQuickFileHistory` instead of `gitlens.toggleBlame`

### Removed

- Removes `git.viewFileHistory` option from the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings

## [1.0.2]

### Fixed

- Fixes [#16](https://github.com/eamodio/vscode-gitlens/issues/16) - incorrect 'Unable to find Git' message

## [1.0.0]

### Added

- Adds support for git history (log)!
- Adds support for blame annotations and git commands on file revisions
- Adds ability to show multiple blame annotation at the same time (one per vscode editor)
- Adds new `gitlens.showFileHistory` command to open the history explorer
- Adds new `gitlens.showFileHistory` option to the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings
- Adds per-language code lens location customization using the `gitlens.codeLens.languageLocations` setting
- Adds new `gitlens.diffLineWithPrevious` command for line sensitive diffs
- Adds new `gitlens.diffLineWithWorking` command for line sensitive diffs
- Adds `gitlens.diffWithPrevious` command to the explorer context menu
- Adds output channel logging, controlled by the `gitlens.advanced.output.level` setting
- Improves performance of the code lens support
- Improves performance (significantly) when only showing code lens at the document level
- Improves performance of status bar blame support

### Changed

- Switches on-demand code lens to be a global toggle (rather than per file)
- Complete rewrite of the blame annotation provider to reduce overhead and provide better performance
- Changes `gitlens.diffWithPrevious` command to always be file sensitive diffs
- Changes `gitlens.diffWithWorking` command to always be file sensitive diffs
- Removes all debug logging, unless the `gitlens.advanced.debug` settings it on

### Fixed

- Fixes many (most?) issues with whitespace toggling (required because of https://github.com/Microsoft/vscode/issues/11485)
- Fixes issue where blame annotations would not be cleared properly when switching between open files

## [0.5.5]

### Fixed

- Fixes another off-by-one issue when diffing with caching

## [0.5.4]

### Fixed

- Fixes off-by-one issues with blame annotations without caching and when diffing with a previous version

## [0.5.3]

### Added

- Adds better uncommitted hover message in blame annotations
- Adds more protection for dealing with uncommitted lines

## [0.5.2]

### Fixed

- Fixes loading issue on Linux

## [0.5.1]

### Added

- Adds blame information in the status bar
- Add new status bar settings &mdash; see **Extension Settings** for details
- Adds new `gitlens.diffWithPrevious` option to the `gitlens.codeLens.recentChange.command` & `gitlens.codeLens.authors.command` settings

### Changed

- Renames the `gitlens.codeLens.recentChange.command` & `gitlens.codeLens.authors.command` settings options (to align with command names)

### Removed

- Removes `gitlens.blame.annotation.useCodeActions` setting and behavior

### Fixed

- Fixes Diff with Previous when the selection is uncommitted

## [0.3.3]

### Fixed

- Fixes [#7](https://github.com/eamodio/vscode-gitlens/issues/7) - missing spawn-rx dependency (argh!)

## [0.3.2]

### Fixed

- Fixes [#7](https://github.com/eamodio/vscode-gitlens/issues/7) - missing lodash dependency

## [0.3.1]

### Added

- Adds new code lens visibility & location settings &mdash; see **Extension Settings** for details
- Adds new command to toggle code lens on and off when `gitlens.codeLens.visibility` is set to `ondemand`

## [0.2.0]

### Changed

- Replaces blame regex parsing with a more robust parser

### Fixed

- Fixes [#1](https://github.com/eamodio/vscode-gitlens/issues/1) - Support blame on files outside the workspace repository
- Fixes failures with Diff with Previous command
- Fixes issues with blame explorer code lens when dealing with previous commits
- Fixes display issues with compact blame annotations (now skips blank lines)

## [0.1.3]

### Added

- Improved blame annotations, now with sha and author by default
- Add new blame annotation styles &mdash; compact and expanded (default)
- Adds many new configuration settings; see **Extension Settings** for details

## [0.0.7]

### Added

- Adds .gitignore checks to reduce the number of blame calls

### Fixed

- Fixes [#4](https://github.com/eamodio/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash (Really!)
- Fixes [#5](https://github.com/eamodio/vscode-gitlens/issues/5) - Finding first non-white-space fails sometimes

## [0.0.6]

### Added

- Adds attempt to scroll to the correct position when opening a diff

### Fixed

- Fixes [#2](https://github.com/eamodio/vscode-gitlens/issues/2) - [request] Provide some debug info when things fail
- Fixes [#4](https://github.com/eamodio/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash

## [0.0.5]

### Changed

- Removes code lens from fields and single-line properties to reduce visual noise
- Automatically turns off blame only when required now

### Fixed

- Fixes issues where filename changes in history would cause diffs to fails
- Fixes some issues with uncommitted blames

## [0.0.4]

### Added

- Candidate for preview release on the vscode marketplace.

## [0.0.1]

### Added

- Initial release but still heavily a work in progress.
