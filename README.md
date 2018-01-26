[![](https://vsmarketplacebadge.apphb.com/version-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/installs-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://vsmarketplacebadge.apphb.com/rating-short/eamodio.gitlens.svg)](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
[![](https://img.shields.io/badge/vscode--dev--community-gitlens-blue.svg?logo=slack)](https://join.slack.com/t/vscode-dev-community/shared_invite/enQtMjIxOTgxNDE3NzM0LWU5M2ZiZDU1YjBlMzdlZjA2YjBjYzRhYTM5NTgzMTAxMjdiNWU0ZmQzYWI3MWU5N2Q1YjBiYmQ4MzY0NDE1MzY)

<p align="center">
  <br /><br />
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/gitlens-icon.png" alt="logo" width="192">
</p>

# GitLens

GitLens **supercharges** the built-in Visual Studio Code Git capabilities. It helps you to **visualize code authorship** at a glance via Git blame annotations and code lens, **seamlessly navigate and explore** the history of a file or branch, **gain valuable insights** via powerful comparison commands, and so much more.

GitLens provides an unobtrusive blame annotation at the end of the current line, a status bar item showing the commit information (author and date, by default) of the current line, code lens showing the most recent commit and # of authors of the file and/or code block, and many commands for exploring commits and histories, comparing and navigating revisions, stash access, repository status, and more. GitLens is also [highly customizable](#extension-settings) to meet your specific needs — find code lens intrusive or the current line blame annotation distracting — no problem, it is easy to [turn them off or change how they behave](#extension-settings).

### Preview
>![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/gitlens-preview.gif)
>###### Features blame annotations, code lens, status bar details, quick pick menus for navigation and exploration, compare with previous, and more

### Quick Access Settings

While GitLens is highly customizable and provides many [configuration settings](#extension-settings), here are the most important ones for controlling GitLens' behavior

|Name | Description
|-----|------------
|`gitlens.blame.line.enabled`|Specifies whether or not to provide a blame annotation for the current line, by default<br />Use the *Toggle Line Blame Annotations* command (`gitlens.toggleLineBlame`) to toggle the annotations on and off for the current session
|`gitlens.codeLens.enabled`|Specifies whether or not to provide any Git code lens, by default<br />Use the *Toggle Git Code Lens* command (`gitlens.toggleCodeLens`) to toggle the Git code lens on and off for the current session
|`gitlens.gitExplorer.enabled`|Specifies whether or not to show the **GitLens** view
|`gitlens.statusBar.enabled`|Specifies whether or not to provide blame information on the status bar
|`gitlens.keymap`|Specifies the keymap to use for GitLens shortcut keys<br />`standard` - adds a standard set of shortcut keys<br />`chorded` - adds a chorded set of shortcut keys that all start with `Ctrl+Shift+G` (`⌥⌘G` on macOS)<br />`none` - no shortcut keys will be added

## Features

### Git Blame Annotations

- Adds an unobtrusive, highly [customizable](#line-blame-annotation-settings) and [themable](#themable-colors), **Git blame annotation** to the end of the current line ([optional](#line-blame-annotation-settings), on by default)

  ![Line Blame Annotation](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-line-blame-annotation.png)
  ![Line Blame Annotations (hover)](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-line-blame-annotations.png)
  - Contains the author, date, and message of the line's most recent commit, by [default](#line-blame-annotation-settings)
  - Adds a **details** hover annotation to the current line annotation, which provides more commit details ([optional](#line-blame-annotation-settings), on by default)

    ![Details Blame Annotation (hover)](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-line-blame-annotations-details.png)

    - Provides a **quick-access command bar** with *Open Changes*, *Blame Previous Revision*, *Open in Remote*, and *Show More Actions* command buttons
    - Clicking the commit id will run the *Show Commit Details* command (`gitlens.showQuickCommitDetails`)

  - Adds a **changes** (diff) hover annotation to the current line annotation, which provides **instant access** to the line's previous version ([optional](#line-blame-annotation-settings), on by default)

    ![Changes Blame Annotation (hover)](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-line-blame-annotations-changes.png)

    - Clicking on **Changes** will run the *Compare File Revisions* command (`gitlens.diffWith`)
    - Clicking the current and previous commit ids will run the *Show Commit Details* command (`gitlens.showQuickCommitDetails`)

- Adds on-demand, beautiful, highly [customizable](#file-blame-annotation-settings) and [themable](#themable-colors), **Git blame annotations** of the whole file

  ![File Blame Annotation](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-file-blame-annotation.png)

  - Choose between *gutter* (default) and *hover* [annotation styles](#file-blame-annotation-settings)
  - Contains the commit message and date, by [default](#file-blame-annotation-settings)
  - Adds a **details** hover annotation to the line's annotation, which provides more commit details ([optional](#file-blame-annotation-settings), on by default)

    ![File Details Blame Annotations (hover)](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-file-blame-annotations.png)

    - Provides a **quick-access command bar** with *Open Changes*, *Blame Previous Revision*, *Open in Remote*, and *Show More Actions* command buttons
    - Clicking the commit id will run the *Show Commit Details* command (`gitlens.showQuickCommitDetails`)
  - Adds a **changes**` (diff) hover annotation to the line's annotation, which provides **instant access** to the line's previous version ([optional](#file-blame-annotation-settings), on by default)
    - Clicking on **Changes** will run the *Compare File Revisions* command (`gitlens.diffWith`)
    - Clicking the current and previous commit ids will run the *Show Commit Details* command (`gitlens.showQuickCommitDetails`)
  - Adds a **heatmap** (age) indicator to the gutter annotations (on right edge by [default](#file-blame-annotation-settings)), which provides an easy, at-a-glance way to tell the age of a line ([optional](#file-blame-annotation-settings), on by default)
    - Indicator ranges from bright yellow (newer) to dark brown (older)
  - Press `Escape` to quickly toggle the annotations off

- Adds [customizable](#status-bar-settings) **blame information** about the current line to the **status bar**  ([optional](#status-bar-settings), on by default)

  ![Status Bar Blame](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-status-bar.png)
  - Contains the commit author and date, by [default](#status-bar-settings)
  - Clicking the status bar item will, by [default](#status-bar-settings), show a **commit details quick pick menu** with commands for comparing, navigating and exploring commits, and more
  - Provides [customizable](#status-bar-settings) click behavior — choose between one of the following
    - Toggle file blame annotations on and off
    - Toggle code lens on and off
    - Compare the line commit with the previous commit
    - Compare the line commit with the working tree
    - Show a quick pick menu with details and commands for the commit (default)
    - Show a quick pick menu with file details and commands for the commit
    - Show a quick pick menu with the commit history of the file
    - Show a quick pick menu with the commit history of the current branch

- Adds a *Toggle File Blame Annotations* command (`gitlens.toggleFileBlame`) with a shortcut of `alt+b` to toggle the file blame annotations on and off
  - Also adds a *Show File Blame Annotations* command (`gitlens.showFileBlame`)

- Adds a *Toggle Line Blame Annotations* command (`gitlens.toggleLineBlame`) to toggle the current line blame annotations on and off
  - Also adds a *Show Line Blame Annotations* command (`gitlens.showLineBlame`)

### Git Heatmap Annotations

- Adds on-demand **heatmap annotations** of the whole file
  - Displays a **heatmap** (age) indicator near the gutter, which provides an easy, at-a-glance way to tell the age of a line
    - Indicator ranges from bright yellow (newer) to dark brown (older)
  - Press `Escape` to quickly toggle the annotations off

- Adds *Toggle File Heatmap Annotations* command (`gitlens.toggleFileHeatmap`) to toggle the heatmap annotations on and off

### Git Recent Changes Annotations

- Adds on-demand, [customizable](#file-recent-changes-annotation-settings) and [themable](#themable-colors), **recent changes annotations** of the whole file
  - Highlights all of lines changed in the most recent commit
  - Adds a **details** hover annotation to each line, which provides more commit details ([optional](#file-recent-changes-annotation-settings), on by default)
    - Clicking the commit id will run the *Show Commit Details* command (`gitlens.showQuickCommitDetails`)
  - Adds a **changes** (diff) hover annotation to each line, which provides **instant** access to the line's previous version ([optional](#file-recent-changes-annotation-settings), on by default)
    - Clicking on **Changes** will run the *Compare File Revisions* command (`gitlens.diffWith`)
    - Clicking the current and previous commit ids will run the *Show Commit Details* command (`gitlens.showQuickCommitDetails`)
  - Press `Escape` to quickly toggle the annotations off

- Adds *Toggle Recent File Changes Annotations* command (`gitlens.toggleFileRecentChanges`) to toggle the recent changes annotations on and off

### Git Code Lens

- Adds **code lens** to the top of the file and on code blocks ([optional](#code-lens-settings), on by default)

  ![Git Code Lens](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-code-lens.png)
  - **Recent Change** — author and date of the most recent commit for the file or code block
    - Clicking the code lens will, by [default](#code-lens-settings), show a **commit file details quick pick menu** with commands for comparing, navigating and exploring commits, and more
  - **Authors** — number of authors of the file or code block and the most prominent author (if there is more than one)
    - Clicking the code lens will, by [default](#code-lens-settings), toggle the file Git blame annotations on and off of the whole file
    - Will be hidden if the author of the most recent commit is also the only author of the file or block, to avoid duplicate information and reduce visual noise

- Provides [customizable](#code-lens-settings) click behavior for each code lens — choose between one of the following
  - Toggle file blame annotations on and off
  - Compare the commit with the previous commit
  - Show a quick pick menu with details and commands for the commit
  - Show a quick pick menu with file details and commands for the commit
  - Show a quick pick menu with the commit history of the file
  - Show a quick pick menu with the commit history of the current branch

- Adds a *Toggle Git Code Lens* command (`gitlens.toggleCodeLens`) with a shortcut of `shift+alt+b` to toggle the code lens on and off

### Navigate and Explore

- Adds a [customizable](#gitlens-view-settings) **GitLens** view to the Explorer activity

  - **Repository View** - provides a full repository explorer

    ![GitLens Repository view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-git-custom-view-repository.png)

    - **Repository Status** node — provides the status of the repository
      - Provides the name of the current branch, [optionally](#gitlens-view-settings) its working tree status, and its upstream tracking branch and status (if available)
      - Provides indicator dots on the repository icon which denote the following:
        - *None* - up-to-date with the upstream
        - *Green* - ahead of the upstream
        - *Red* - behind the upstream
        - *Yellow* - both ahead of and behind the upstream
      - Provides additional upstream status nodes, if the current branch is tracking a remote branch and
        - is behind the upstream — quickly see and explore the specific commits behind the upstream (i.e. commits that haven't been pulled)
        - is ahead of the upstream — quickly see and explore the specific commits ahead of the upstream (i.e. commits that haven't been pushed)
      - **Changed Files** node — provides a at-a-glance view of all "working" changes
        - Expands to a file-based view of all changed files in the working tree ([optionally](#gitlens-view-settings)) and/or all files in all commits ahead of the upstream
      - Provides a context menu with *Open Repository in Remote*, and *Refresh* commands

    - **Branches** node — provides a list of the local branches
      - Indicates which branch is the current branch and [optionally](#gitlens-view-settings) shows the remote tracking branch
      - Expand each branch to easily see its revision (commit) history
        - Provides indicator dots on each branch icon which denote the following:
          - *None* - no upstream or up-to-date with the upstream
          - *Green* - ahead of the upstream
          - *Red* - behind the upstream
          - *Yellow* - both ahead of and behind the upstream
        - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
          - Provides a context menu on each revision (commit) with *Open Commit in Remote*, *Open All Changes*, *Open All Changes with Working Tree*, *Open Files*, *Open Revisions*, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*, *Show Commit Details*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, *Cherry Pick Commit (via Terminal)*, *Revert Commit (via Terminal)*, *Rebase to Commit (via Terminal)*, *Reset to Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Create Tag (via Terminal)...*, and *Refresh* commands
           - Provides a context menu on each changed file with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, and *Show Commit File Details* commands
        - Provides a context menu on each branch with *Open Branch in Remote*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Remote*, *Compare with Selected*, *Compare Selected Ancestor with Working Tree*, *Select for Compare*, *Open Directory Compare with Working Tree*, *Checkout Branch (via Terminal)*, *Merge Branch (via Terminal)*, *Rebase (Interactive) Branch (via Terminal)*, *Rebase (Interactive) Branch to Remote (via Terminal)*, *Squash Branch into Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Delete Branch (via Terminal)*, *Create Tag (via Terminal)...*, and *Refresh* commands
      - Provides a context menu with *Open Branches in Remote*, and *Refresh* commands

    - **Remotes** node — provides a list of remotes
      - Indicates the direction of the remote (fetch, push, both), remote service (if applicable), and repository path
      - Expand each remote to see its list of branches
        - Expand each branch to easily see its revision (commit) history
          - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
            - Provides a context menu on each revision (commit) with *Open Commit in Remote*, *Open All Changes*, *Open All Changes with Working Tree*, *Open Files*, *Open Revisions*, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*,*Show Commit Details*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, *Cherry Pick Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Create Tag (via Terminal)...*, and *Refresh* commands
            - Provides a context menu on each changed file with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, *Show File History*, and *Show Commit File Details* commands
          - Provides a context menu on each remote branch with *Open Branch in Remote*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Compare Selected Ancestor with Working Tree*, *Select for Compare*, *Open Directory Compare with Working Tree*, *Checkout Branch (via Terminal)*, *Merge Branch (via Terminal)*, *Rebase (Interactive) Branch (via Terminal)*, *Squash Branch into Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Delete Branch (via Terminal)*, *Create Tag (via Terminal)...*, and *Refresh* commands
        - Provides a context menu on each remote with *Open Branches in Remote*, *Open Repository in Remote*, *Remove Remote (via Terminal)*, and *Refresh* commands
      - Provides a context menu with a *Refresh* command

    - **Stashes** node — provides a list of stashed changes
      - Expand each stash to quickly see the set of files stashed, complete with status indicators for adds, changes, renames, and deletes
        - Provides a context menu on each stash with *Apply Stashed Changes* (confirmation required), *Delete Stashed Changes* (confirmation required), *Open All Changes*, *Open All Changes with Working Tree*, *Open Files*, *Open Revisions*, *Copy Commit Message to Clipboard*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, and *Refresh* commands
         - Provides a context menu on each stashed file with *Apply Changes*, *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, and *Show File History* commands
      - Provides a context menu with *Stash Changes*, and *Refresh* commands

    - **Tags** node — provides a list of tags
      - Expand each tag to easily see its revision (commit) history
        - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
          - Provides a context menu on each revision (commit) with *Open Commit in Remote*, *Open All Changes*, *Open All Changes with Working Tree*, *Open Files*, *Open Revisions*, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*, *Show Commit Details*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, *Cherry Pick Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Create Tag (via Terminal)...*, and *Refresh* commands
           - Provides a context menu on each changed file with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, and *Show Commit File Details* commands
        - Provides a context menu on each tag with *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, *Open Directory Compare with Working Tree*, *Delete Tag (via Terminal)*, and *Refresh* commands
      - Provides a context menu with a *Refresh* command

  - **History View** - provides the revision history of the active file

    ![GitLens History view](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-git-custom-view-history.png)

    - Automatically updates to track the active editor
    - Provides a context menu with *Open File*, *Open File in Remote*, and *Refresh* commands
    - Provides a context menu on each revision (commit) with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, and *Show Commit File Details* commands

  - Quickly switch between views using the *Switch to Repository View* or *Switch to History View* commands
  - Provides toolbar commands to *Search Commits*, *Switch to Repository View* or *Switch to History View*, and *Refresh*

- Adds a *Search Commits* command (`gitlens.showCommitSearch`) with a shortcut of `alt+/` to search for commits by message, author, file(s), commit id, or code changes
  - Use `<message>` to search for commits with messages that match `<message>` -- See [Git docs](https://git-scm.com/docs/git-log#git-log---grepltpatterngt)
  - Use `@<pattern>` to search for commits with authors that match `<pattern>` -- See [Git docs](https://git-scm.com/docs/git-log#git-log---authorltpatterngt)
  - Use `:<pattern>` to search for commits with file names that match `<pattern>` -- See [Git docs](https://git-scm.com/docs/git-log)
  - Use `#<sha>` to search for a commit with id of `<sha>` -- See [Git docs](https://git-scm.com/docs/git-log)
  - Use `~<pattern>` to search for commits with differences whose patch text contains added/removed lines that match `<pattern>` -- See [Git docs](https://git-scm.com/docs/git-log#git-log--Gltregexgt)
  - Use `=<string>` to search for commits with differences that change the number of occurrences of the specified string (i.e. addition/deletion) in a file -- See [Git docs](https://git-scm.com/docs/git-log#git-log--Sltstringgt)
  - Provides a *Show in Results* option to show the search results in the **GitLens Results** view

- Adds an on-demand, [customizable](#gitlens-results-view-settings) **GitLens Results** view to the Explorer activity

  - Provides semi-persistent results for commit search, file history, and commit operations
    - Accessible via the following: *Show Commit Search* command (`gitlens.showCommitSearch`), *Show File History* command (`gitlens.showQuickFileHistory`), and *Show Commit Details* command (`gitlens.showQuickCommitDetails`)
    - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
      - Provides a context menu on each revision (commit) with *Open Commit in Remote*, *Open All Changes*, *Open All Changes with Working Tree*, *Open Files*, *Open Revisions*, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*, *Show Commit Details*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, *Cherry Pick Commit (via Terminal)*, *Revert Commit (via Terminal)*, *Rebase to Commit (via Terminal)*, *Reset to Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Create Tag (via Terminal)...*, and *Refresh* commands
        - Provides a context menu on each changed file with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, and *Show Commit File Details* commands

  - Provides semi-persistent results for revision comparison operations
    - Accessible via the following: *Compare with Index (HEAD)* command (`gitlens.explorers.compareWithHead`), *Compare with Remote* command (`gitlens.explorers.compareWithRemote`), *Compare with Working Tree* command (`gitlens.explorers.compareWithWorking`), *Compare with Selected* command (`gitlens.explorers.compareWithSelected`), and *Compare Selected Ancestor with Working Tree* command (`gitlens.explorers.compareSelectedAncestorWithWorking`)
    - **Commits** node — provides a list of the commits between the compared revisions (branches or commits)
      - Expand each revision (commit) to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
        - Provides a context menu on each revision (commit) with *Open Commit in Remote*, *Open All Changes*, *Open All Changes with Working Tree*, *Open Files*, *Open Revisions*, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*, *Show Commit Details*, *Compare with Index (HEAD)*, *Compare with Working Tree*, *Compare with Selected*, *Select for Compare*, *Cherry Pick Commit (via Terminal)*, *Revert Commit (via Terminal)*, *Rebase to Commit (via Terminal)*, *Reset to Commit (via Terminal)*, *Create Branch (via Terminal)...*, *Create Tag (via Terminal)...*, and *Refresh* commands
          - Provides a context menu on each changed file with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, and *Show Commit File Details* commands
    - **Changed Files** node — provides a list of all the files changed between the compared revisions (branches or commits)
        - Expands to a file-based view of all changed files
           - Provides a context menu on each changed file with *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in Remote*, *Open Revision in Remote*, *Apply Changes*, and *Show Commit File Details* commands
    - Provides a context menu with *Open Directory Compare* and *Refresh* commands
  - Provides toolbar commands to *Search Commits*, *Keep Results*, *Refresh*, *Show Files in Automatic View* or *Show Files in List View* or *Show Files in Tree View*, and *Close*

- Adds commands to open files, commits, branches, and the repository in the supported remote services, **BitBucket, GitHub, GitLab, and Visual Studio Team Services** or a [**user-defined** remote services](#custom-remotes-settings) — only available if a Git upstream service is configured in the repository
  - Also supports [remote services with custom domains](#custom-remotes-settings), such as **BitBucket, Bitbucket Server (previously called Stash), GitHub, GitHub Enterprise, GitLab**
  - *Open Branches in Remote* command (`gitlens.openBranchesInRemote`) — opens the branches in the supported remote service
  - *Open Branch in Remote* command (`gitlens.openBranchInRemote`) — opens the current branch commits in the supported remote service
  - *Open Commit in Remote* command (`gitlens.openCommitInRemote`) — opens the commit revision of the active line in the supported remote service
  - *Open File in Remote* command (`gitlens.openFileInRemote`) — opens the active file/revision in the supported remote service
  - *Open Repository in Remote* command (`gitlens.openRepoInRemote`) — opens the repository in the supported remote service

- Adds a *Show Current Branch History* command (`gitlens.showQuickRepoHistory`) with a shortcut of `shift+alt+h` to show a paged **branch history quick pick menu** of the current branch for exploring its commit history

  ![Branch History Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-branch-history.png)

  - Provides entries to *Show Commit Search* and *Open Branch in <remote-service>* when available
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

- Adds a *Show Branch History* command (`gitlens.showQuickBranchHistory`) to show a paged **branch history quick pick menu** of the selected branch for exploring its commit history
  - Provides the same features as *Show Current Branch History* above

- Adds a *Show File History* command (`gitlens.showQuickFileHistory`) to show a paged **file history quick pick menu** of the active file for exploring its commit history

  ![File History Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-file-history.png)

  - Provides additional entries to *Show in Results*, *Show Branch History*, and *Open File in <remote-service>* when available
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Navigate pages via `alt+,` and `alt+.` to go backward and forward respectively

- Adds a *Show Commit Details* command (`gitlens.showQuickCommitDetails`) to show a **commit details quick pick menu** of the most recent commit of the active file

  ![Commit Details Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-commit-details.png)

  - Quickly see the set of files changed in the commit, complete with status indicators for adds, changes, renames, and deletes
  - Provides additional entries to *Show in Results*, *Open Commit in <remote-service>* when available, *Open Files*, *Open Revisions*, *Open Directory Compare with Previous Revision*, *Open Directory Compare with Working Tree*, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings) is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to preview the comparison of the current revision with the previous one

- Adds a *Show Commit File Details* command (`gitlens.showQuickCommitFileDetails`) with a shortcut of `alt+c` to show a **file commit details quick pick menu** of the most recent commit of the active file

  ![Commit File Details Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-commit-file-details.png)

  - Provides entries to *Open Changes*, *Open Changes with Working File*, *Open File*, *Open Revision*, *Open File in <remote-service>* when available, *Open Revision in <remote-service>* when available, *Copy Commit ID to Clipboard*, *Copy Commit Message to Clipboard*, *Show Commit Details*, *Show File History*, and *Show Previous File History*
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings) is set

- Adds a *Show Repository Status* command (`gitlens.showQuickRepoStatus`) with a shortcut of `alt+s` to show a **repository status quick pick menu** for visualizing the current repository status

  ![Repository Status Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-repo-status.png)

  - Quickly see upstream status (if an Git upstream is configured) — complete with ahead and behind information
    - If you are ahead of the upstream, an entry will be shown with the number of commits ahead. Choosing it will show a limited **branch history quick pick menu** containing just the commits ahead of the upstream
    - If you are behind the upstream, an entry will be shown with the number of commits behind. Choosing it will show a limited **branch history quick pick menu** containing just the commits behind the upstream
  - Quickly see all working changes, both staged and unstaged, complete with status indicators for adds, changes, renames, and deletes
  - Provides entries to *Show Stashed Changes*, *Open Changed Files*, and *Close Unchanged Files*
  - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings) is set
  - Use the `alt+right arrow` shortcut on a file entry in the `Staged Files` or `Unstaged Files` sections to preview the comparison of the working file with the previous revision

- Adds a *Show Stashed Changes* command (`gitlens.showQuickStashList`) to show a **stashed changes quick pick menu** for exploring your repository stash history

  ![Stashed Changes Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-stash-list.png)

  - Provides additional entries to *Stash Changes*
  - Navigate back to the previous quick pick menu via `alt+left arrow`, if available

  - Choosing a stash entry shows a **stash details quick pick menu** which is very similar to the **commit details quick pick menu** above

    ![Stash Details Quick Pick Menu](https://raw.githubusercontent.com/eamodio/vscode-gitlens/master/images/screenshot-stash-details.png)

    - Quickly see the set of files changed in the stash, complete with status indicators for adds, changes, renames, and deletes
    - Provides additional entries to *Apply Stashed Changes* (requires confirmation), *Delete Stashed Changes* (requires confirmation), *Open Files*, *Open Revisions*, *Open Directory Compare with Previous Revision*, *Open Directory Compare with Working Tree*, *Copy Commit Message to Clipboard*
    - Navigate back to the previous quick pick menu via `alt+left arrow`, if available
    - Use the `alt+right arrow` shortcut on an entry to execute it without closing the quick pick menu, if possible — commands that open windows outside of VS Code will still close the quick pick menu unless [`"gitlens.advanced.quickPick.closeOnFocusOut": false`](#advanced-settings) is set
    - Use the `alt+right arrow` shortcut on a file entry in the `Changed Files` section to  preview the comparison of the current revision with the previous one

- Adds a *Show Last Opened Quick Pick* command (`gitlens.showLastQuickPick`) with a shortcut of `alt+-` to quickly get back to where you were when the last GitLens quick pick menu closed

### Powerful Comparison Tools

- Effortlessly navigate between comparisons via the `alt+,` and `alt+.` shortcut keys to go back and forth through a file's revisions

- Provides easy access to the following comparison commands via the `Command Palette` as well as in context via the many provided quick pick menus

- Adds a *Directory Compare Working Tree with...* command (`gitlens.diffDirectory`) to open the configured Git difftool to compare the working tree with the selected branch or tag

- Adds a *Compare File with Branch or Tag...* command (`gitlens.diffWithBranch`) to compare the active file with the same file on the selected branch or tag

- Adds a *Compare File with Next Revision* command (`gitlens.diffWithNext`) with a shortcut of `alt+.` to compare the active file/diff with the next commit revision

- Adds a *Compare File with Previous Revision* command (`gitlens.diffWithPrevious`) with a shortcut of `alt+,` to compare the active file/diff with the previous commit revision

- Adds a *Compare Line Revision with Previous* command (`gitlens.diffLineWithPrevious`) with a shortcut of `shift+alt+,` to compare the active file/diff with the previous line commit revision

- Adds a *Compare File with Revision...* command (`gitlens.diffWithRevision`) to compare the active file with the selected revision of the same file

- Adds a *Compare File with Working Revision* command (`gitlens.diffWithWorking`) with a shortcut of `shift+alt+w` to compare the most recent commit revision of the active file/diff with the working tree

- Adds a *Compare Line Revision with Working File* command (`gitlens.diffLineWithWorking`) with a shortcut of `alt+w` to compare the commit revision of the active line with the working tree

### And More

- Adds a *Copy Commit ID to Clipboard* command (`gitlens.copyShaToClipboard`) to copy the commit id (sha) of the active line to the clipboard or from the most recent commit to the current branch, if there is no active editor

- Adds a *Copy Commit Message to Clipboard* command (`gitlens.copyMessageToClipboard`) to copy the commit message of the active line to the clipboard or from the most recent commit to the current branch, if there is no active editor

- Adds a *Open Working File"* command (`gitlens.openWorkingFile`) to open the working file for the active file revision

- Adds a *Open Revision...* command (`gitlens.openFileRevision`) to open the selected revision for the active file

- Adds a *Open Changes (with difftool)* command (`gitlens.externalDiff`) to the source control group and source control resource context menus to open the changes of a file or set of files with the configured git difftool

- Adds a *Open All Changes (with difftool)* command (`gitlens.externalDiffAll`) to open all working changes with the configured git difftool
  - Also adds the command to the Source Control group context menu

- Adds a *Open Changed Files* command (`gitlens.openChangedFiles`) to open any files with working tree changes

- Adds a *Close Unchanged Files* command (`gitlens.closeUnchangedFiles`) to close any files without working tree changes

- Adds a *Apply Stashed Changes* command (`gitlens.stashApply`) to chose a stash entry to apply to the working tree from a quick pick menu

- Adds a *Stash Changes* command (`gitlens.stashSave`) to save any working tree changes to the stash — can optionally provide a stash message
  - Also adds the command to the Source Control items context menu to stash an individual or group of files, works with multi-select too!

## Insiders

Add [`"gitlens.insiders": true`](#general-settings) to your settings to join the insiders channel and get early access to upcoming features. Be aware that because this provides early access expect there to be issues.

## Themable Colors

GitLens defines a set of themable colors which can be provided by vscode themes or directly by the user using [`workbench.colorCustomization`](https://code.visualstudio.com/docs/getstarted/themes#_customize-a-color-theme).

|Name | Description
|-----|------------
|`gitlens.gutterBackgroundColor`|Specifies the background color of the gutter blame annotations
|`gitlens.gutterForegroundColor`|Specifies the foreground color of the gutter blame annotations
|`gitlens.gutterUncommittedForegroundColor`|Specifies the foreground color of an uncommitted line in the gutter blame annotations
|`gitlens.trailingLineBackgroundColor`|Specifies the background color of the trailing blame annotation
|`gitlens.trailingLineForegroundColor`|Specifies the foreground color of the trailing blame annotation
|`gitlens.lineHighlightBackgroundColor`|Specifies the background color of the associated line highlights in blame annotations
|`gitlens.lineHighlightOverviewRulerColor`|Specifies the overview ruler color of the associated line highlights in blame annotations

## Extension Settings

GitLens is highly customizable and provides many configuration settings to allow the personalization of almost all features

### General Settings

|Name | Description
|-----|------------
|`gitlens.defaultDateFormat`|Specifies how absolute dates will be formatted by default<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats
|`gitlens.defaultDateStyle`|Specifies how dates will be displayed by default
|`gitlens.defaultGravatarsStyle`|Specifies the style of the gravatar default (fallback) images<br />`identicon` - a geometric pattern<br />`mm` - (mystery-man) a simple, cartoon-style silhouetted outline of a person (does not vary by email hash)<br />`monsterid` - a monster with different colors, faces, etc<br />`retro` - 8-bit arcade-style pixelated faces<br />`robohash` - a robot with different colors, faces, etc<br />`wavatar` - faces with differing features and backgrounds
|`gitlens.insiders`|Opts into the insiders channel -- provides access to upcoming features
|`gitlens.keymap`|Specifies the keymap to use for GitLens shortcut keys<br />`standard` - adds a standard set of shortcut keys<br />`chorded` - adds a chorded set of shortcut keys that all start with `Ctrl+Shift+G` (`⌥⌘G` on macOS)<br />`none` - no shortcut keys will be added
|`gitlens.outputLevel`|Specifies how much (if any) output will be sent to the GitLens output channel

### Blame Settings

|Name | Description
|-----|------------
|`gitlens.blame.ignoreWhitespace`|Specifies whether or not to ignore whitespace when comparing revisions during blame operations

#### File Blame Annotation Settings

|Name | Description
|-----|------------
|`gitlens.blame.file.annotationType`|Specifies the type of blame annotations that will be shown for the current file<br />`gutter` - adds an annotation to the beginning of each line<br />`hover` - shows annotations when hovering over each line
|`gitlens.blame.file.lineHighlight.enabled`|Specifies whether or not to highlight lines associated with the current line
|`gitlens.blame.file.lineHighlight.locations`|Specifies where the associated line highlights will be shown<br />`gutter` - adds a gutter glyph<br />`line` - adds a full-line highlight background color<br />`overviewRuler` - adds a decoration to the overviewRuler (scroll bar)
|`gitlens.annotations.file.gutter.format`|Specifies the format of the gutter blame annotations<br />Available tokens<br />`${id}` - commit id<br />`${author}` - commit author<br />`${message}` - commit message<br />`${ago}` - relative commit date (e.g. 1 day ago)<br />`${date}` - formatted commit date (format specified by `gitlens.annotations.file.gutter.dateFormat`)<br />`${authorAgo}` - commit author, relative commit date<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.annotations.file.gutter.dateFormat`|Specifies how to format absolute dates (using the `${date}` token) in gutter blame annotations<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats
|`gitlens.annotations.file.gutter.compact`|Specifies whether or not to compact (deduplicate) matching adjacent gutter blame annotations
|`gitlens.annotations.file.gutter.gravatars`|Specifies whether or not to show gravatar images in the gutter blame annotations
|`gitlens.annotations.file.gutter.heatmap.enabled`|Specifies whether or not to provide a heatmap indicator in the gutter blame annotations
|`gitlens.annotations.file.gutter.heatmap.location`|Specifies where the heatmap indicators will be shown in the gutter blame annotations<br />`left` - adds a heatmap indicator on the left edge of the gutter blame annotations<br />`right` - adds a heatmap indicator on the right edge of the gutter blame annotations
|`gitlens.annotations.file.gutter.hover.details`|Specifies whether or not to provide a commit details hover annotation over the gutter blame annotations
|`gitlens.annotations.file.gutter.hover.changes`|Specifies whether or not to provide a changes (diff) hover annotation over the gutter blame annotations
|`gitlens.annotations.file.gutter.hover.wholeLine`|Specifies whether or not to trigger hover annotations over the whole line
|`gitlens.annotations.file.gutter.separateLines`|Specifies whether or not gutter blame annotations will have line separators
|`gitlens.annotations.file.hover.details`|Specifies whether or not to provide a commit details hover annotation over each line
|`gitlens.annotations.file.hover.changes`|Specifies whether or not to provide a changes (diff) hover annotation over each line
|`gitlens.annotations.file.hover.heatmap.enabled`|Specifies whether or not to provide heatmap indicators on the left edge of each line

#### Line Blame Annotation Settings

|Name | Description
|-----|------------
|`gitlens.blame.line.enabled`|Specifies whether or not to provide a blame annotation for the current line, by default<br />Use the *Toggle Line Blame Annotations* command (`gitlens.toggleLineBlame`) to toggle the annotations on and off for the current session
|`gitlens.blame.line.annotationType`|Specifies the type of blame annotations that will be shown for the current line<br />`trailing` - adds an annotation to the end of the current line<br />`hover` - shows annotations when hovering over the current line
|`gitlens.annotations.line.trailing.format`|Specifies the format of the trailing blame annotations<br />Available tokens<br />`${id}` - commit id<br />`${author}` - commit author<br />`${message}` - commit message<br />`${ago}` - relative commit date (e.g. 1 day ago)<br />`${date}` - formatted commit date (format specified by `gitlens.annotations.line.trailing.dateFormat`)<br />`${authorAgo}` - commit author, relative commit date<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.annotations.line.trailing.dateFormat`|Specifies how to format absolute dates (using the `${date}` token) in trailing blame annotations<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats
|`gitlens.annotations.line.trailing.hover.details`|Specifies whether or not to provide a commit details hover annotation over the trailing blame annotations
|`gitlens.annotations.line.trailing.hover.changes`|Specifies whether or not to provide a changes (diff) hover annotation over the trailing blame annotations
|`gitlens.annotations.line.trailing.hover.wholeLine`|Specifies whether or not to trigger hover annotations over the whole line
|`gitlens.annotations.line.hover.details`|Specifies whether or not to provide a commit details hover annotation for the current line
|`gitlens.annotations.line.hover.changes`|Specifies whether or not to provide a changes (diff) hover annotation for the current line

### File Recent Changes Annotation Settings

|Name | Description
|-----|------------
|`gitlens.recentChanges.file.lineHighlight.locations`|Specifies where the highlights of the recently changed lines will be shown<br />`gutter` - adds a gutter glyph<br />`line` - adds a full-line highlight background color<br />`overviewRuler` - adds a decoration to the overviewRuler (scroll bar)
|`gitlens.annotations.file.recentChanges.hover.details`|Specifies whether or not to provide a commit details hover annotation
|`gitlens.annotations.file.recentChanges.hover.changes`|Specifies whether or not to provide a changes (diff) hover annotation

### Code Lens Settings

|Name | Description
|-----|------------
|`gitlens.codeLens.enabled`|Specifies whether or not to provide any Git code lens, by default<br />Use the *Toggle Git Code Lens* command (`gitlens.toggleCodeLens`) to toggle the Git code lens on and off for the current session
|`gitlens.codeLens.recentChange.enabled`|Specifies whether or not to show a `recent change` code lens showing the author and date of the most recent commit for the file or code block
|`gitlens.codeLens.recentChange.command`|Specifies the command to be executed when the `recent change` code lens is clicked<br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current committed file with the previous commit<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick
|`gitlens.codeLens.authors.enabled`|Specifies whether or not to show an `authors` code lens showing number of authors of the file or code block and the most prominent author (if there is more than one)
|`gitlens.codeLens.authors.command`|Specifies the command to be executed when the `authors` code lens is clicked<br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current committed file with the previous commit<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick
|`gitlens.codeLens.scopes`|Specifies where Git code lens will be shown in the document<br />`document` - adds code lens at the top of the document<br />`containers` - adds code lens at the start of container-like symbols (modules, classes, interfaces, etc)<br />`blocks` - adds code lens at the start of block-like symbols (functions, methods, etc) lines
|`gitlens.codeLens.scopesByLanguage`|Specifies where Git code lens will be shown in the document for the specified languages
|`gitlens.codeLens.symbolScopes`|Specifies a set of document symbols where Git code lens will or will not be shown in the document<br />Prefix with `!` to not show Git code lens for the symbol<br />Must be a member of `SymbolKind`

### GitLens View Settings

|Name | Description
|-----|------------
|`gitlens.gitExplorer.enabled`|Specifies whether or not to show the **GitLens** view"
|`gitlens.gitExplorer.view`|Specifies the starting view (mode) of the **GitLens** view<br /> `auto` - shows the last selected view, defaults to `repository`<br />`history` - shows the commit history of the active file<br />`repository` - shows a repository explorer"
|`gitlens.gitExplorer.autoRefresh`|Specifies whether or not to automatically refresh the **GitLens** view when the repository or the file system changes
|`gitlens.gitExplorer.files.layout`|Specifies how the **GitLens** view will display files<br /> `auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.gitExplorer.files.threshold` setting and the number of files at each nesting level<br /> `list` - displays files as a list<br /> `tree` - displays files as a tree
|`gitlens.gitExplorer.files.compact`|Specifies whether or not to compact (flatten) unnecessary file nesting in the **GitLens** view<br />Only applies when displaying files as a `tree` or `auto`
|`gitlens.gitExplorer.files.threshold`|Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the **GitLens** view<br />Only applies when displaying files as `auto`
|`gitlens.gitExplorer.commitFormat`|Specifies the format of committed changes in the **GitLens** view<br />Available tokens<br /> ${id} - commit id<br /> ${author} - commit author<br /> ${message} - commit message<br /> ${ago} - relative commit date (e.g. 1 day ago)<br /> ${date} - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br /> ${authorAgo} - commit author, relative commit date<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.gitExplorer.commitFileFormat`|Specifies the format of a committed file in the **GitLens** view<br />Available tokens<br /> ${directory} - directory name<br /> ${file} - file name<br /> ${filePath} - formatted file name and path<br /> ${path} - full file path
|`gitlens.gitExplorer.gravatars`|Specifies whether or not to show gravatar images instead of commit (or status) icons in the **GitLens** view
|`gitlens.gitExplorer.includeWorkingTree`|Specifies whether or not to include working tree files inside the `Repository Status` node of the **GitLens** view
|`gitlens.gitExplorer.showTrackingBranch`|Specifies whether or not to show the tracking branch when displaying local branches in the **GitLens** view"
|`gitlens.gitExplorer.stashFormat`|Specifies the format of stashed changes in the **GitLens** view<br />Available tokens<br /> ${id} - commit id<br /> ${author} - commit author<br /> ${message} - commit message<br /> ${ago} - relative commit date (e.g. 1 day ago)<br /> ${date} - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br /> ${authorAgo} - commit author, relative commit date<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.gitExplorer.stashFileFormat`|Specifies the format of a stashed file in the **GitLens** view<br />Available tokens<br /> ${directory} - directory name<br /> ${file} - file name<br /> ${filePath} - formatted file name and path<br /> ${path} - full file path
|`gitlens.gitExplorer.statusFileFormat`|Specifies the format of the status of a working or committed file in the **GitLens** view<br />Available tokens<br /> ${directory} - directory name<br /> ${file} - file name<br /> ${filePath} - formatted file name and path<br /> ${path} - full file path<br />${working} - optional indicator if the file is uncommitted

### GitLens Results View Settings

|Name | Description
|-----|------------
|`gitlens.resultsExplorer.files.layout`|Specifies how the **GitLens Results** view will display files<br /> `auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.resultsExplorer.files.threshold` setting and the number of files at each nesting level<br /> `list` - displays files as a list<br /> `tree` - displays files as a tree
|`gitlens.resultsExplorer.files.compact`|Specifies whether or not to compact (flatten) unnecessary file nesting in the **GitLens Results** view<br />Only applies when displaying files as a `tree` or `auto`
|`gitlens.resultsExplorer.files.threshold`|Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the **GitLens Results** view<br />Only applies when displaying files as `auto`
|`gitlens.resultsExplorer.commitFormat`|Specifies the format of committed changes in the **GitLens Results** view<br />Available tokens<br /> ${id} - commit id<br /> ${author} - commit author<br /> ${message} - commit message<br /> ${ago} - relative commit date (e.g. 1 day ago)<br /> ${date} - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br /> ${authorAgo} - commit author, relative commit date<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.resultsExplorer.commitFileFormat`|Specifies the format of a committed file in the **GitLens Results** view<br />Available tokens<br /> ${directory} - directory name<br /> ${file} - file name<br /> ${filePath} - formatted file name and path<br /> ${path} - full file path
|`gitlens.resultsExplorer.gravatars`|Specifies whether or not to show gravatar images instead of commit (or status) icons in the **GitLens Results** view
|`gitlens.resultsExplorer.showTrackingBranch`|Specifies whether or not to show the tracking branch when displaying local branches in the **GitLens Results** view"
|`gitlens.resultsExplorer.stashFormat`|Specifies the format of stashed changes in the **GitLens Results** view<br />Available tokens<br /> ${id} - commit id<br /> ${author} - commit author<br /> ${message} - commit message<br /> ${ago} - relative commit date (e.g. 1 day ago)<br /> ${date} - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br /> ${authorAgo} - commit author, relative commit date<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.resultsExplorer.stashFileFormat`|Specifies the format of a stashed file in the **GitLens Results** view<br />Available tokens<br /> ${directory} - directory name<br /> ${file} - file name<br /> ${filePath} - formatted file name and path<br /> ${path} - full file path
|`gitlens.resultsExplorer.statusFileFormat`|Specifies the format of the status of a working or committed file in the **GitLens Results** view<br />Available tokens<br /> ${directory} - directory name<br /> ${file} - file name<br /> ${filePath} - formatted file name and path<br /> ${path} - full file path<br />${working} - optional indicator if the file is uncommitted

### Custom Remotes Settings

|Name | Description
|-----|------------
|`gitlens.remotes`|Specifies user-defined remote (code-hosting) services or custom domains for built-in remote services<br /><br />Example:<br />```"gitlens.remotes": [{ "domain": "git.corporate-url.com", "type": "GitHub" }]```<br /><br />Example:<br />```"gitlens.remotes": [{ ```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"domain": "git.corporate-url.com",```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"type": "Custom",```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"name": "My Company", ```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"protocol": "https",```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"urls": {```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"repository": "https://git.corporate-url.com/${repo}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"branches": "https://git.corporate-url.com/${repo}/branches",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"branch": "https://git.corporate-url.com/${repo}/commits/${branch}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"commit": "https://git.corporate-url.com/${repo}/commit/${id}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"file": "https://git.corporate-url.com/${repo}?path=${file}${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileInBranch": "https://git.corporate-url.com/${repo}/blob/${branch}/${file}${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileInCommit": "https://git.corporate-url.com/${repo}/blob/${id}/${file}${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileLine": "#L${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileRange": "#L${start}-L${end}"```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```}```<br />&nbsp;&nbsp;&nbsp;&nbsp;```}]```<br /><br />Example:<br />```"gitlens.remotes": [{ ```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"domain": "git.corporate-url.com",```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"type": "Custom",```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"name": "My Company", ```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"protocol": "https",```<br />&nbsp;&nbsp;&nbsp;&nbsp;```"urls": {```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"repository": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"branches": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/branches",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"branch": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/commits/${branch}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"commit": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/commit/${id}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"file": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}?path=${file}${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileInBranch": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/blob/${branch}/${file}${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileInCommit": "https://git.corporate-url.com/projects/${repoBase}/repos/${repoPath}/blob/${id}/${file}${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileLine": "#L${line}",```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```"fileRange": "#L${start}-L${end}"```<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;```}```<br />&nbsp;&nbsp;&nbsp;&nbsp;```}]```

### Status Bar Settings

|Name | Description
|-----|------------
|`gitlens.statusBar.enabled`|Specifies whether or not to provide blame information on the status bar
|`gitlens.statusBar.alignment`|Specifies the blame alignment in the status bar<br />`left` - align to the left,  `right` - align to the right
|`gitlens.statusBar.command`|Specifies the command to be executed when the blame status bar item is clicked<br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.diffWithPrevious` - compares the current line commit with the previous<br />`gitlens.diffWithWorking` - compares the current line commit with the working tree<br />`gitlens.toggleCodeLens` - toggles Git code lens<br />`gitlens.showQuickCommitDetails` - shows a commit details quick pick<br />`gitlens.showQuickCommitFileDetails` - shows a commit file details quick pick<br />`gitlens.showQuickFileHistory` - shows a file history quick pick<br />`gitlens.showQuickRepoHistory` - shows a branch history quick pick
|`gitlens.statusBar.format`|Specifies the format of the blame information on the status bar<br />Available tokens<br />`${id}` - commit id<br />`${author}` - commit author<br />`${message}` - commit message<br />`${ago}` - relative commit date (e.g. 1 day ago)<br />`${date}` - formatted commit date (format specified by `gitlens.statusBar.dateFormat`)<br />See https://github.com/eamodio/vscode-gitlens/wiki/Advanced-Formatting for advanced formatting
|`gitlens.statusBar.dateFormat`|Specifies the date format of absolute dates shown in the blame information on the status bar<br />See https://momentjs.com/docs/#/displaying/format/ for valid formats

### Strings Settings

|Name | Description
|-----|------------
|`gitlens.strings.codeLens.unsavedChanges.recentChangeAndAuthors`|Specifies the string to be shown in place of both the `recent change` and `authors` code lens when there are unsaved changes
|`gitlens.strings.codeLens.unsavedChanges.recentChangeOnly`|Specifies the string to be shown in place of the `recent change` code lens when there are unsaved changes
|`gitlens.strings.codeLens.unsavedChanges.authorsOnly`|Specifies the string to be shown in place of the `authors` code lens when there are unsaved changes

### Advanced Settings

|Name | Description
|-----|------------
|`gitlens.advanced.blame.delayAfterEdit`|Specifies the time (in milliseconds) to wait before re-blaming an unsaved document after an edit. Use 0 to specify an infinite wait
|`gitlens.advanced.blame.sizeThresholdAfterEdit`|Specifies the maximum document size (in lines) allowed to be re-blamed after an edit while still unsaved. Use 0 to specify no maximum
|`gitlens.advanced.caching.enabled`|Specifies whether git output will be cached -- changing the default is not recommended
|`gitlens.advanced.git`|Specifies the git path to use
|`gitlens.advanced.maxListItems`|Specifies the maximum number of items to show in a list. Use 0 to specify no maximum
|`gitlens.advanced.menus`|Specifies which commands will be added to which menus
|`gitlens.advanced.messages`|Specifies which messages should be suppressed
|`gitlens.advanced.quickPick.closeOnFocusOut`|Specifies whether or not to close QuickPick menus when focus is lost
|`gitlens.advanced.repositorySearchDepth`|Specifies how many folders deep to search for repositories
|`gitlens.advanced.telemetry.enabled`|Specifies whether or not to enable GitLens telemetry (even if enabled still abides by the overall `telemetry.enableTelemetry` setting

## Known Issues

- If the `Copy to * clipboard` commands don't work on Linux -- `xclip` needs to be installed. You can install it via `sudo apt-get install xclip`

## Contributors

A big thanks to the people that have contributed to this project:

- Amanda Cameron ([@AmandaCameron](https://github.com/AmandaCameron)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=AmandaCameron))
- Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=hjanuschka))
- Chris Kaczor ([@ckaczor](https://github.com/ckaczor)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=ckaczor))
- Peng Lyu ([@rebornix](https://github.com/rebornix)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=rebornix))
- Aurelio Ogliari ([@nobitagit](https://github.com/nobitagit)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=nobitagit)
- Johannes Rieken ([@jrieken](https://github.com/jrieken)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=jrieken))
- Zack Schuster ([@zackschuster](https://github.com/zackschuster)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=zackschuster)
- SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=SpaceEEC)
- Alexey Vasyukov ([@notmedia](https://github.com/notmedia)) — [contributions](https://github.com/eamodio/vscode-gitlens/commits?author=notmedia))

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!
