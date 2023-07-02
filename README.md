# GitLens &mdash; Supercharge Git in VS Code

> Supercharge Git and unlock **untapped knowledge** within your repository to better **understand**, **write**, and **review** code. Focus, collaborate, accelerate.

[GitLens](https://gitkraken.com/gitlens?utm_source=gitlens-extension&utm_medium=in-app-links&utm_campaign=gitlens-logo-links 'Learn more about GitLens') is a powerful [open-source](https://github.com/gitkraken/vscode-gitlens 'Open GitLens on GitHub') extension for [Visual Studio Code](https://code.visualstudio.com).

GitLens supercharges your Git experience in VS Code. Maintaining focus is critical, extra time spent context switching or missing context disrupts your flow. GitLens is the ultimate tool for making Git work for you, designed to improve focus, productivity, and collaboration with a powerful set of tools to help you and your team better understand, write, and review code.

GitLens sets itself apart from other Git tools through its deep level of integration, versatility, and ease of use. GitLens sits directly within your editor, reducing context switching and promoting a more efficient workflow. We know Git is hard and strive to make it as easy as possible while also going beyond the basics with rich visualizations and step-by-step guidance and safety, just to name a few.

## Getting Started

<p>
  <a title="Watch the GitLens Getting Started video" href="https://www.youtube.com/watch?v=UQPb73Zz9qk"><img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/get-started-video.png" alt="Watch the GitLens Getting Started video" /></a>
</p>

Install GitLens by clicking `Install` on the banner above, or from the Extensions side bar in VS Code, by searching for GitLens.

Use `Switch to Pre-Release Version` on the extension banner to live on the edge and be the first to experience new features.

## Is GitLens Free?

All features are free to use on all repos, **except** for features,

- marked with a ✨ require a [trial or paid plan](https://www.gitkraken.com/gitlens/pricing) for use on privately hosted repos
- marked with a ☁️ require a GitKraken Account, with access level based on your [plan](https://www.gitkraken.com/gitlens/pricing), e.g. Free, Pro, etc

See the [FAQ](#is-gitlens-free-to-use 'Jump to FAQ') for more details.

[Features](#discover-powerful-features 'Jump to Discover Powerful Features')
| [Labs](#gitkraken-labs 'Jump to GitKraken Labs')
| [Pro](#ready-for-gitlens-pro 'Jump to Ready for GitLens Pro?')
| [FAQ](#faq 'Jump to FAQ')
| [Support and Community](#support-and-community 'Jump to Support and Community')
| [Contributing](#contributing 'Jump to Contributing')
| [Contributors](#contributors-🙏❤ 'Jump to Contributors')
| [License](#license 'Jump to License')

# Discover Powerful Features

Quickly glimpse into when, why, and by whom a line or code block was changed. Zero-in on the most important changes and effortlessly navigate through history to gain further insights as to how a file or individual line's code evolved. Visualize code authorship at a glance via Git blame annotations and Git CodeLens. Seamlessly explore Git repositories with the visually-rich Commit Graph. Gain valuable insights via GitLens Inspect, and much more.

- [**Blame, CodeLens, and Hovers**](#blame-codelens-and-hovers) &mdash; Gain a deeper understanding of how code changed and by whom through in-editor code annotations and rich hovers.
- [**File Annotations**](#file-annotations) &mdash; Toggle on-demand whole file annotations to see authorship, recent changes, and a heatmap.
- [**Revision Navigation**](#revision-navigation) &mdash; Explore the history of a file to see how the code evolved over time.
- [**Side Bar Views**](#side-bar-views) &mdash; Powerful views into Git that don't come in the box.
- [**Commit Graph ✨**](#commit-graph-✨) &mdash; Visualize your repository and keep track of all work in progress.
- [**GitKraken Workspaces ☁️ and Focus ✨**](#gitkraken-workspaces-☁️-and-focus-✨) &mdash; Easily group and manage multiple repositories and bring pull requests and issues into a unified view.
- [**Visual File History ✨**](#visual-file-history-✨) &mdash; Identify the most impactful changes to a file and by whom.
- [**Worktrees ✨**](#worktrees-✨) &mdash; Simultaneously work on different branches of a repository.
- [**Interactive Rebase Editor**](#interactive-rebase-editor) &mdash; Visualize and configure interactive rebase operations with a user-friendly editor.
- [**Comprehensive Commands**](#comprehensive-commands) &mdash; A rich set of commands to help you do everything you need.
- [**Integrations**](#integrations) &mdash; Simplify your workflow and quickly gain insights via integration with your Git hosting services.

## Blame, CodeLens, and Hovers

Gain a deeper understanding of how code changed and by whom through in-editor code annotations and rich hovers.

### Inline and Status Bar Blame

Provides historical context about line changes through unobtrusive **blame annotation** at the end of the current line and on the status bar.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/current-line-blame.png" alt="Inline Line Blame" />
  <figcaption>Inline blame annotations</figcaption>
</figure>
<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/status-bar.png" alt="Status Bar Blame" />
  <figcaption>Status bar blame annotations</figcaption>
</figure>

💡 Use the `Toggle Line Blame` and `Toggle Git CodeLens` commands from the Command Palette to turn the annotations on and off.

### Git CodeLens

Adds contextual and actionable authorship information at the top of each file and at the beginning of each block of code.

- **Recent Change** &mdash; author and date of the most recent commit for the file or code block
- **Authors** &mdash; number of authors of the file or code block and the most prominent author (if there is more than one)

### Rich Hovers

Hover over blame annotations to reveal rich details and actions.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/hovers-current-line.png" alt="Current Line Hovers" />
</figure>

## File Annotations

Use on-demand whole file annotations to see authorship, recent changes, and a heatmap. Annotations are rendered as visual indicators directly in the editor.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/gutter-blame.png" alt="File Blame">
  <figcaption>File Blame annotations</figcaption>
</figure>
<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/gutter-changes.png" alt="File Changes" />
  <figcaption>File Changes annotations</figcaption>
</figure>
<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/gutter-heatmap.png" alt="File Heatmap" />
  <figcaption>File Heatmap annotations</figcaption>
</figure>

💡 On an active file, use the `Toggle File Blame`, `Toggle File Changes`, and `Toggle File Heatmap` commands from the Command Palette to turn the annotations on and off.

## Revision Navigation

With just a click of a button, you can navigate backwards and forwards through the history of any file. Compare changes over time and see the revision history of the whole file or an individual line.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/revision-navigation.gif" alt="Revision Navigation" />
</figure>

## Side Bar Views

Our views are arranged for focus and productivity, although you can easily drag them around to suit your needs.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/side-bar-views.png" alt="Side Bar views" />
  <figcaption>GitLens Inspect as shown above has been manually moved into the Secondary Side Bar</figcaption>
</figure>

💡 Use the `Reset Views Layout` command to quickly get back to the default layout.

### GitLens Inspect

An x-ray or developer tools inspector into your code, focused on providing contextual information and insights to what you're actively working on.

- **Commit Details** &mdash; See rich details of a commit or stash.
- **Line History** &mdash; Jump through the revision history of the selected line(s).
- **File History** &mdash; Explore the revision history of a file, folder, or selected lines.
- [**Visual File History ✨**](#visual-file-history-✨) &mdash; Quickly see the evolution of a file, including when changes were made, how large they were, and who made them.
- **Search & Compare** &mdash; Search and explore for a specific commit, message, author, changed file or files, or even a specific code change, or visualize comparisons between branches, tags, commits, and more.

### GitLens

Quick access to many GitLens features. Also the home of GitKraken teams and collaboration services (e.g. GitKraken Workspaces), help, and support.

- **Home** &mdash; Quick access to many features.
- [**GitKraken Workspaces ☁️**](#gitkraken-workspaces-☁️-and-focus-✨) &mdash; Easily group and manage multiple repositories together, accessible from anywhere, streamlining your workflow.
- **GitKraken Account** &mdash; Power-up with GitKraken Cloud Services.

### Source Control

Shows additional views that are focused on exploring and managing your repositories.

- **Commits** &mdash; Comprehensive view of the current branch commit history, including unpushed changes, upstream status, quick comparisons, and more.
- **Branches** &mdash; Manage and navigate branches.
- **Remotes** &mdash; Manage and navigate remotes and remote branches.
- **Stashes** &mdash; Save and restore changes you are not yet ready to commit.
- **Tags** &mdash; Manage and navigate tags.
- [**Worktrees ✨**](#worktrees-✨) &mdash; Simultaneously work on different branches of a repository.
- **Contributors** &mdash; Ordered list of contributors, providing insights into individual contributions and involvement.
- **Repositories** &mdash; Unifies the above views for more efficient management of multiple repositories.

### (Bottom) Panel

Convenient and easy access to the Commit Graph with a dedicated details view.

- [**Commit Graph ✨**](#commit-graph-✨) &mdash; Visualize your repository and keep track of all work in progress.

## Commit Graph ✨

Easily visualize your repository and keep track of all work in progress.

Use the rich commit search to find exactly what you're looking for. Its powerful filters allow you to search by a specific commit, message, author, a changed file or files, or even a specific code change.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commit-graph-illustrated.png" alt="Commit Graph" />
</figure>

💡Quickly toggle the Graph via the `Toggle Commit Graph` command.

💡Maximize the Graph via the `Toggle Maximized Commit Graph` command.

## GitKraken Workspaces ☁️ and Focus ✨

GitKraken Workspaces allow you to easily group and manage multiple repositories together, accessible from anywhere, streamlining your workflow. Create workspaces just for yourself or share (coming soon in GitLens) them with your team for faster onboarding and better collaboration.

The Focus view brings all of your GitHub pull requests and issues into a unified actionable view to help to you more easily juggle work in progress, pending work, reviews, and more. Quickly see if anything requires your attention while keeping you focused.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/focus-view.png" alt="Focus View" />
</figure>

## Visual File History ✨

Quickly see the evolution of a file, including when changes were made, how large they were, and who made them. Use it to quickly find when the most impactful changes were made to a file or who best to talk to about file changes and more.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/visual-file-history-illustrated.png" alt="Visual File History view" />
</figure>

## Worktrees ✨

Efficiently multitask by minimizing the context switching between branches, allowing you to easily work on different branches of a repository simultaneously.

Avoid interrupting your work in progress when needing to review a pull request. Simply create a new worktree and open it in a new VS Code window, all without impacting your other work.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/worktrees-illustrated.png" alt="Worktrees view" />
</figure>

## Interactive Rebase Editor

Easily visualize and configure interactive rebase operations with the intuitive and user-friendly Interactive Rebase Editor. Simply drag & drop to reorder commits and select which ones you want to edit, squash, or drop.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/rebase.gif" alt="Interactive Rebase Editor" />
</figure>

## Comprehensive Commands

Stop worrying about memorizing Git commands; GitLens provides a rich set of commands to help you do everything you need.

### Git Command Palette

A guided, step-by-step experience for quickly and safely executing Git commands.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/git-command-palette.png" alt="Git Command Palette" />
</figure>

### Quick Access Commands

Use a series of new commands to:

- Expore the commit history of branches and files
- Quickly search for and navigate to (and action upon) commits
- Explore a file of a commit
- View and explore your stashes
- Visualize the current repository status

# Integrations

Context switching kills productivity. GitLens not only reveals buried knowledge within your repository, it also brings additional context from issues and pull requests providing you with a wealth of information and insights at your fingertips.

Simplify your workflow and quickly gain insights with automatic linking of issues and pull requests across multiple Git hosting services including GitHub, GitHub Enterprise ✨, GitLab, GitLab self-managed ✨, Gitea, Gerrit, Google Source, Bitbucket, Bitbucket Server, Azure DevOps, and custom servers.

All integration provide automatic linking, while rich integrations with GitHub & GitLab offer detailed hover information for autolinks, and correlations between pull requests, branches, and commits, as well as user avatars for added context.

## Define your own autolinks

Use autolinks to linkify external references, like Jira issues or Zendesk tickets, in commit messages.

# GitKraken Labs

Our incubator for experimentation and exploration with the community to gather early reactions and feedback. Below are some of our current experiments.

## 🧪AI Explain Commit

Use the Explain panel on the **Commit Details** view to leverage AI to help you understand the changes introduced by a commit.

## 🧪Automatically Generate Commit Message

Use the `Generate Commit Message` command from the Source Control view's context menu to automatically generate a commit message for your staged changes by leveraging AI.

# Ready for GitLens Pro?

When you're ready to unlock the full potential of GitLens and enjoy all the benefits on your privately hosted repos, consider upgrading to GitLens Pro. With GitLens Pro, you'll gain access to ✨ features on privately hosted repos and ☁️ features based on the Pro plan.

To learn more about the pricing and the additional ✨ and ☁️ features offered with GitLens Pro, visit the [GitLens Pricing page](https://www.gitkraken.com/gitlens/pricing). Upgrade to GitLens Pro today and take your Git workflow to the next level!

# FAQ

## Is GitLens free to use?

Yes. All features are free to use on all repos, **except** for features,

- marked with a ✨ require a [trial or paid plan](https://www.gitkraken.com/gitlens/pricing) for use on privately hosted repos
- marked with a ☁️ require a GitKraken Account, with access level based on your [plan](https://www.gitkraken.com/gitlens/pricing), e.g. Free, Pro, etc

While GitLens offers a remarkable set of free features, a subset of features tailored for professional developers and teams, marked with a ✨, require a trial or paid plan for use on privately hosted repos &mdash; use on local or publicly hosted repos is free for everyone. Additionally some features marked with a ☁️, rely on GitKraken Dev Services which requires an account and access is based on your plan, e.g. Free, Pro, etc.

Preview ✨ features instantly for free for 3 days without an account, or start a free Pro trial to get an additional 7 days and gain access to ☁️ features to experience the full power of GitLens.

## Are ✨ and ☁️ features free to use?

✨ features are free for use on local and publicly hosted repos, while a paid plan is required for use on privately hosted repos. ☁️ feature access is based on your plan including a Free plan.

## Where can I find pricing?

Visit the [GitLens Pricing page](https://www.gitkraken.com/gitlens/pricing) for detailed pricing information and feature matrix for plans.

# Support and Community

Support documentation can be found on the [GitLens Help Center](https://help.gitkraken.com/gitlens/gitlens-home/). If you need further assistance or have any questions, there are various support channels and community forums available for GitLens:

## Issue Reporting and Feature Requests

Found a bug? Have a feature request? Reach out on our [GitHub Issues page](https://github.com/gitkraken/vscode-gitlens/issues).

## Discussions

Join the GitLens community on [GitHub Discussions](https://github.com/gitkraken/vscode-gitlens/discussions) to connect with other users, share your experiences, and discuss topics related to GitLens.

## GitKraken Support

For any issues or inquiries related to GitLens, you can reach out to the GitKraken support team via the [official support page](https://support.gitkraken.com/). They will be happy to assist you with any problems you may encounter.

With GitLens Pro, you gain access to priority email support from our customer success team, ensuring higher priority and faster response times. Custom onboarding and training are also available to help you and your team quickly get up and running with a GitLens Pro plan.

# Contributing

GitLens is an open-source project that greatly benefits from the contributions and feedback from its community.

Your contributions, feedback, and engagement in the GitLens community are invaluable, and play a significant role in shaping the future of GitLens. Thank you for your support!

## Code Contributions

Want to contribute to GitLens? Follow the [CONTRIBUTING](https://github.com/gitkraken/vscode-gitlens/blob/main/CONTRIBUTING.md) docs to get started.

## Documentation Contributions

Contributions to the documentation are greatly appreciated. If you find any areas that can be improved or have suggestions for new documentation, you can submit them as pull requests to the [GitLens Docs](https://github.com/gitkraken/gitlens-docs) repository.

- Adds a _Show File History_ command (`gitlens.showQuickFileHistory`) to show quick pick menu to explore the commit history of the current file

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-file-history.png" alt="File History Quick Pick Menu" />
</p>

- Adds a _Search Commits_ command (`gitlens.showCommitSearch`) to show quick pick menu to search for commits
  - by message &mdash; use `<message>` to find commits with messages that match `<message>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt---grepltpatterngt 'Open Git docs')
  - or, by author &mdash; use `@<pattern>` to find commits with authors that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt---authorltpatterngt 'Open Git docs')
  - or, by commit SHA &mdash; use `#<sha>` to find a commit with id of `<sha>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt-ltrevisionrangegt 'Open Git docs')
  - or, by files &mdash; use `:<path/glob>` to find commits with file names that match `<path/glob>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt---ltpathgt82308203 'Open Git docs')
  - or, by changes &mdash; use `~<pattern>` to find commits with differences whose patch text contains added/removed lines that match `<pattern>` &mdash; See [Git docs](https://git-scm.com/docs/git-log#Documentation/git-log.txt--Gltregexgt 'Open Git docs')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-commit-search.png" alt="Commit Search Quick Pick Menu" />
</p>

- Adds a _Show Commit_ command (`gitlens.showQuickCommitDetails`) to show a quick pick menu to explore a commit and take action upon it

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-commit-details.png" alt="Commit Details Quick Pick Menu" />
</p>

- Adds a _Show Line Commit_ command (`gitlens.showQuickCommitFileDetails`) to show a quick pick menu to explore a file of a commit and take action upon it

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-commit-file-details.png" alt="Commit File Details Quick Pick Menu" />
</p>

### Quick Stash Access [#](#quick-stash-access- 'Quick Stash Access')

- Adds a _Show Stashes_ command (`gitlens.showQuickStashList`) to show a quick pick menu to explore your stashes

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-stash-list.png" alt="Stashes Quick Pick Menu" />
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-stash-details.png" alt="Stash Details Quick Pick Menu" />
</p>

### Quick Status Access [#](#quick-status-access- 'Quick Status Access')

- Adds a _Show Repository Status_ command (`gitlens.showQuickRepoStatus`) to show a quick pick menu to for visualizing the current repository status

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menu-repo-status.png" alt="Repository Status Quick Pick Menu" />
</p>

## Interactive Rebase Editor [#](#interactive-rebase-editor- 'Interactive Rebase Editor')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/rebase.gif" alt="Interactive Rebase Editor" />
</p>

- Adds a user-friendly interactive rebase editor to more easily configure an interactive rebase session
  - Quickly re-order, edit, squash, and drop commits
  - Includes drag & drop support!
- To use this directly from your terminal, e.g. when running `git rebase -i`,

  - set VS Code as your default Git editor
    - `git config --global core.editor "code --wait"`
  - or, to only affect rebase, set VS Code as your Git rebase editor
    - `git config --global sequence.editor "code --wait"`

  > To use the Insiders edition of VS Code, replace `code` in the above with `code-insiders`

## Terminal Links [#](#terminal-links- 'Terminal Links')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/terminal-links.gif" alt="Terminal Links" />
</p>

- [Optionally](##terminal-links-settings- 'Jump to the Terminal Links settings') adds autolinks for branches, tags, and commit ranges in the integrated terminal to quickly explore their commit history
- [Optionally](##terminal-links-settings- 'Jump to the Terminal Links settings') adds autolinks for commits in the integrated terminal to quickly explore the commit and take action upon it

## Remote Provider Integrations [#](#remote-provider-integrations- 'Remote Provider Integrations')

GitLens provides rich integrations with many remote providers, including GitHub, GitHub Enterprise, GitLab, Gitea, Gerrit, Bitbucket, Bitbucket Server, and Azure DevOps. You can also define [custom remote providers](#remote-provider-integration-settings- 'Jump to the Remote Provider Integration settings') or [remote providers with custom domains](#remote-provider-integration-settings- 'Jump to the Remote Provider Integration settings') as well.

Basic integrations provide issue and pull request auto-linking, while richer integrations (e.g. GitHub) can provide rich hover information provided for auto-linked issues and pull requests, associate pull requests with branches and commits, and provide avatars.

Additionally, these integrations provide commands to copy the url of or open, files, commits, branches, and the repository on the remote provider.

- _Open File from Remote_ command (`gitlens.openFileFromRemote`) &mdash; opens the local file from a url of a file on a remote provider
- _Open File on Remote_ command (`gitlens.openFileOnRemote`) &mdash; opens a file or revision on the remote provider
- _Copy Remote File Url_ command (`gitlens.copyRemoteFileUrlToClipboard`) &mdash; copies the url of a file or revision on the remote provider
- _Open File on Remote From..._ command (`gitlens.openFileOnRemoteFrom`) &mdash; opens a file or revision on a specific branch or tag on the remote provider
- _Copy Remote File Url From..._ command (`gitlens.copyRemoteFileUrlFrom`) &mdash; copies the url of a file or revision on a specific branch or tag the remote provider
- _Open Commit on Remote_ command (`gitlens.openCommitOnRemote`) &mdash; opens a commit on the remote provider
- _Copy Remote Commit Url_ command (`gitlens.copyRemoteCommitUrl`) &mdash; copies the url of a commit on the remote provider
- _Open Branch on Remote_ command (`gitlens.openBranchOnRemote`) &mdash; opens the branch on the remote provider
- _Copy Remote Branch Url_ command (`gitlens.copyRemoteBranchUrl`) &mdash; copies the url of a branch on the remote provider
- _Open Branches on Remote_ command (`gitlens.openBranchesOnRemote`) &mdash; opens the branches on the remote provider
- _Copy Remote Branches Url_ command (`gitlens.copyRemoteBranchesUrl`) &mdash; copies the url of the branches on the remote provider
- _Open Comparison on Remote_ command (`gitlens.openComparisonOnRemote`) &mdash; opens the comparison on the remote provider
- _Copy Remote Comparison Url_ command (`gitlens.copyRemoteComparisonUrl`) &mdash; copies the url of the comparison on the remote provider
- _Open Pull Request_ command (`gitlens.openPullRequestOnRemote`) &mdash; opens the pull request on the remote provider
- _Copy Pull Request Url_ command (`gitlens.copyRemotePullRequestUrl`) &mdash; copies the url of the pull request on the remote provider
- _Open Repository on Remote_ command (`gitlens.openRepoOnRemote`) &mdash; opens the repository on the remote provider
- _Copy Remote Repository Url_ command (`gitlens.copyRemoteRepositoryUrl`) &mdash; copies the url of the repository on the remote provider

## Powerful Commands [#](#powerful-commands- 'Powerful Commands')

- Adds an _Add Co-authors_ command (`gitlens.addAuthors`) to add a co-author to the commit message input box

- Adds a _Copy SHA_ command (`gitlens.copyShaToClipboard`) to copy the commit SHA of the current line to the clipboard or from the most recent commit to the current branch, if there is no current editor
- Adds a _Copy Message_ command (`gitlens.copyMessageToClipboard`) to copy the commit message of the current line to the clipboard or from the most recent commit to the current branch, if there is no current editor

- Adds a _Copy Current Branch_ command (`gitlens.copyCurrentBranch`) to copy the name of the current branch to the clipboard

- Adds a _Switch to Another Branch_ (`gitlens.views.switchToAnotherBranch`) command &mdash; to quickly switch the current branch

- Adds a _Compare References..._ command (`gitlens.compareWith`) to compare two selected references
- Adds a _Compare HEAD with..._ command (`gitlens.compareHeadWith`) to compare the index (HEAD) with the selected reference
- Adds a _Compare Working Tree with..._ command (`gitlens.compareWorkingWith`) to compare the working tree with the selected reference

- Adds an _Open Changes (difftool)_ command (`gitlens.externalDiff`) to open the changes of a file or set of files with the configured git difftool
- Adds an _Open All Changes (difftool)_ command (`gitlens.externalDiffAll`) to open all working changes with the configured git difftool
- Adds an _Open Directory Compare (difftool)_ command (`gitlens.diffDirectoryWithHead`) to compare the working tree with HEAD with the configured Git difftool
- Adds an _Open Directory Compare (difftool) with..._ command (`gitlens.diffDirectory`) to compare the working tree with the selected reference with the configured Git difftool

- Adds an _Open File_ command (`gitlens.openWorkingFile`) to open the working file for the current file revision
- Adds an _Open Revision..._ command (`gitlens.openFileRevision`) to open the selected revision for the current file
- Adds an _Open Revision from..._ command (`gitlens.openFileRevisionFrom`) to open the revision of the current file from the selected reference
- Adds an _Open Blame Prior to Change_ command (`gitlens.openBlamePriorToChange`) to open the blame of prior revision of the selected line in the current file

- Adds a _Open Changed Files_ command (`gitlens.openChangedFiles`) to open any files with working tree changes
- Adds a _Close Unchanged Files_ command (`gitlens.closeUnchangedFiles`) to close any files without working tree changes

- Adds an _Enable Debug Logging_ command (`gitlens.enableDebugLogging`) to enable debug logging to the GitLens output channel
- Adds a _Disable Debug Logging_ command (`gitlens.disableDebugLogging`) to disable debug logging to the GitLens output channel

## Menus & Toolbars [#](#menus--toolbars- 'Menus & Toolbars')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menus.png" alt="Menus &amp; Toolbars" />
</p>

GitLens provides [customizable](#menu--toolbar-settings-) menu and toolbar contributions to put you in control over where GitLens' commands are shown. The easiest way to configure these settings is via the GitLens [**interactive settings editor**](#configuration- 'Jump to Configuration').

For example, if you uncheck the _Add to the editor group toolbar_ you will see the following items removed from the toolbar:

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/menus-example.png" alt="Editor Group Toolbar example" />
</p>

You can also expand each group to control each area more granularly.

## Modes [#](#modes- 'Modes')

GitLens supports [user-defined](#modes-settings- 'Jump to the Modes settings') modes for quickly toggling between sets of settings.

- Adds _Switch Mode_ command (`gitlens.switchMode`) to quickly switch the active mode
- Adds a _Zen_ mode which for a zen-like experience, disables many visual features
  - Adds _Toggle Zen Mode_ command (`gitlens.toggleZenMode`) to toggle Zen mode
- Adds a _Review_ mode which for reviewing code, enables many visual features
  - Adds _Toggle Review Mode_ command (`gitlens.toggleReviewMode`) to toggle Review mode
- Adds the active mode to the **status bar** ([optional](#modes-settings- 'Jump to the Modes settings'), on by default)

# Configuration [#](#configuration- 'Configuration')

<p align="center">
  <img src="https://raw.githubusercontent.com/eamodio/vscode-gitlens/main/images/docs/settings.png" alt="GitLens Interactive Settings" />
</p>

GitLens provides a rich **interactive settings editor**, an easy-to-use interface, to configure many of GitLens' powerful features. It can be accessed via the _GitLens: Open Settings_ (`gitlens.showSettingsPage`) command from the [_Command Palette_](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette).

For more advanced customizations, refer to the [settings documentation](#gitlens-settings- 'Jump to the GitLens settings docs') below.

# GitLens Settings [#](#gitlens-settings- 'GitLens Settings')

GitLens is highly customizable and provides many configuration settings to allow the personalization of almost all features.

## Current Line Blame Settings [#](#current-line-blame-settings- 'Current Line Blame Settings')

| Name                                       | Description                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.currentLine.dateFormat`           | Specifies how to format absolute dates (e.g. using the `${date}` token) for the current line blame annotations. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                                                      |
| `gitlens.currentLine.enabled`              | Specifies whether to provide a blame annotation for the current line, by default. Use the _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`) to toggle the annotations on and off for the current window                                                                                       |
| `gitlens.currentLine.format`               | Specifies the format of the current line blame annotation. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs. Date formatting is controlled by the `gitlens.currentLine.dateFormat` setting                                             |
| `gitlens.currentLine.pullRequests.enabled` | Specifies whether to provide information about the Pull Request (if any) that introduced the commit in the current line blame annotation. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                     |
| `gitlens.currentLine.scrollable`           | Specifies whether the current line blame annotation can be scrolled into view when it is outside the viewport. **NOTE**: Setting this to `false` will inhibit the hovers from showing over the annotation; Set `gitlens.hovers.currentLine.over` to `line` to enable the hovers to show anywhere over the line. |

## Git Code Lens Settings [#](#git-code-lens-settings- 'Git Code Lens Settings')

| Name                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.codeLens.authors.command`          | Specifies the command to be executed when an _authors_ code lens is clicked, set to (`gitlens.toggleFileBlame`) by default. Can be set to `false` to disable click actions on the code lens.<br /><br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.toggleFileHeatmap` - toggles file heatmap<br />`gitlens.toggleFileChanges` - toggles file changes since before the commit<br />`gitlens.toggleFileChangesOnly` - toggles file changes from the commit<br />`gitlens.diffWithPrevious` - opens changes with the previous revision<br />`gitlens.revealCommitInView` - reveals the commit in the Side Bar<br />`gitlens.showCommitsInView` - searches for commits within the range<br />`gitlens.showQuickCommitDetails` - shows details of the commit<br />`gitlens.showQuickCommitFileDetails` - show file details of the commit<br />`gitlens.showQuickFileHistory` - shows the current file history<br />`gitlens.showQuickRepoHistory` - shows the current branch history<br />`gitlens.openCommitOnRemote` - opens the commit on the remote service (when available)<br />`gitlens.copyRemoteCommitUrl` - copies the remote commit url to the clipboard (when available)<br />`gitlens.openFileOnRemote` - opens the file revision on the remote service (when available)<br />`gitlens.copyRemoteFileUrl` - copies the remote file url to the clipboard (when available)                 |
| `gitlens.codeLens.authors.enabled`          | Specifies whether to provide an _authors_ code lens, showing number of authors of the file or code block and the most prominent author (if there is more than one)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.codeLens.enabled`                  | Specifies whether to provide any Git code lens, by default. Use the _Toggle Git Code Lens_ command (`gitlens.toggleCodeLens`) to toggle the Git code lens on and off for the current window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `gitlens.codeLens.includeSingleLineSymbols` | Specifies whether to provide any Git code lens on symbols that span only a single line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `gitlens.codeLens.recentChange.command`     | Specifies the command to be executed when a _recent change_ code lens is clicked, set to (`gitlens.showQuickCommitFileDetails`) by default. Can be set to `false` to disable click actions on the code lens.<br /><br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.toggleFileHeatmap` - toggles file heatmap<br />`gitlens.toggleFileChanges` - toggles file changes since before the commit<br />`gitlens.toggleFileChangesOnly` - toggles file changes from the commit<br />`gitlens.diffWithPrevious` - opens changes with the previous revision<br />`gitlens.revealCommitInView` - reveals the commit in the Side Bar<br />`gitlens.showCommitsInView` - searches for commits within the range<br />`gitlens.showQuickCommitDetails` - shows details of the commit<br />`gitlens.showQuickCommitFileDetails` - show file details of the commit<br />`gitlens.showQuickFileHistory` - shows the current file history<br />`gitlens.showQuickRepoHistory` - shows the current branch history<br />`gitlens.openCommitOnRemote` - opens the commit on the remote service (when available)<br />`gitlens.copyRemoteCommitUrl` - copies the remote commit url to the clipboard (when available)<br />`gitlens.openFileOnRemote` - opens the file revision on the remote service (when available)<br />`gitlens.copyRemoteFileUrl` - copies the remote file url to the clipboard (when available) |
| `gitlens.codeLens.recentChange.enabled`     | Specifies whether to provide a _recent change_ code lens, showing the author and date of the most recent commit for the file or code block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.codeLens.scopes`                   | Specifies where Git code lens will be shown in the document<br /><br />`document` - adds code lens at the top of the document<br />`containers` - adds code lens at the start of container-like symbols (modules, classes, interfaces, etc)<br />`blocks` - adds code lens at the start of block-like symbols (functions, methods, etc) lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `gitlens.codeLens.symbolScopes`             | Specifies a set of document symbols where Git code lens will or will not be shown in the document. Prefix with `!` to avoid providing a Git code lens for the symbol. Must be a member of [`SymbolKind`](https://code.visualstudio.com/docs/extensionAPI/vscode-api#_a-namesymbolkindaspan-classcodeitem-id660symbolkindspan)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Status Bar Settings [#](#status-bar-settings- 'Status Bar Settings')

| Name                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.statusBar.alignment`            | Specifies the blame alignment in the status bar<br /><br />`left` - aligns to the left<br />`right` - aligns to the right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `gitlens.statusBar.command`              | Specifies the command to be executed when the blame status bar item is clicked<br /><br />`gitlens.toggleFileBlame` - toggles file blame annotations<br />`gitlens.toggleFileHeatmap` - toggles file heatmap<br />`gitlens.toggleFileChanges` - toggles file changes since before the commit<br />`gitlens.toggleFileChangesOnly` - toggles file changes from the commit<br />`gitlens.diffWithPrevious` - opens changes with the previous revision<br />`gitlens.revealCommitInView` - reveals the commit in the Side Bar<br />`gitlens.showCommitsInView` - searches for commits within the range<br />`gitlens.showQuickCommitDetails` - shows details of the commit<br />`gitlens.showQuickCommitFileDetails` - show file details of the commit<br />`gitlens.showQuickFileHistory` - shows the current file history<br />`gitlens.showQuickRepoHistory` - shows the current branch history<br />`gitlens.openCommitOnRemote` - opens the commit on the remote service (when available)<br />`gitlens.copyRemoteCommitUrl` - copies the remote commit url to the clipboard (when available)<br />`gitlens.openFileOnRemote` - opens the file revision on the remote service (when available)<br />`gitlens.copyRemoteFileUrl` - copies the remote file url to the clipboard (when available) |
| `gitlens.statusBar.dateFormat`           | Specifies how to format absolute dates (e.g. using the `${date}` token) in the blame information in the status bar. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.statusBar.enabled`              | Specifies whether to provide blame information in the status bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `gitlens.statusBar.format`               | Specifies the format of the blame information in the status bar. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs. Date formatting is controlled by the `gitlens.statusBar.dateFormat` setting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gitlens.statusBar.pullRequests.enabled` | Specifies whether to provide information about the Pull Request (if any) that introduced the commit in the status bar. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `gitlens.statusBar.reduceFlicker`        | Specifies whether to avoid clearing the previous blame information when changing lines to reduce status bar "flashing"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.statusBar.tooltipFormat`        | Specifies the format (in markdown) of hover shown over the blame information in the status bar. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Hover Settings [#](#hover-settings- 'Hover Settings')

| Name                                   | Description                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.hovers.annotations.changes`   | Specifies whether to provide a _changes (diff)_ hover for all lines when showing blame annotations                                                                                                                       |
| `gitlens.hovers.annotations.details`   | Specifies whether to provide a _commit details_ hover for all lines when showing blame annotations                                                                                                                       |
| `gitlens.hovers.annotations.enabled`   | Specifies whether to provide any hovers when showing blame annotations                                                                                                                                                   |
| `gitlens.hovers.annotations.over`      | Specifies when to trigger hovers when showing blame annotations<br /><br />`annotation` - only shown when hovering over the line annotation<br />`line` - shown when hovering anywhere over the line                     |
| `gitlens.hovers.avatars`               | Specifies whether to show avatar images in hovers                                                                                                                                                                        |
| `gitlens.hovers.avatarSize`            | Specifies the size of the avatar images in hovers                                                                                                                                                                        |
| `gitlens.hovers.changesDiff`           | Specifies whether to show just the changes to the line or the set of related changes in the _changes (diff)_ hover<br /><br />`line` - Shows only the changes to the line<br />`hunk` - Shows the set of related changes |
| `gitlens.hovers.currentLine.changes`   | Specifies whether to provide a _changes (diff)_ hover for the current line                                                                                                                                               |
| `gitlens.hovers.currentLine.details`   | Specifies whether to provide a _commit details_ hover for the current line                                                                                                                                               |
| `gitlens.hovers.currentLine.enabled`   | Specifies whether to provide any hovers for the current line                                                                                                                                                             |
| `gitlens.hovers.currentLine.over`      | Specifies when to trigger hovers for the current line<br /><br />`annotation` - only shown when hovering over the line annotation<br />`line` - shown when hovering anywhere over the line                               |
| `gitlens.hovers.detailsMarkdownFormat` | Specifies the format (in markdown) of the _commit details_ hover. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs                              |
| `gitlens.hovers.enabled`               | Specifies whether to provide any hovers                                                                                                                                                                                  |
| `gitlens.hovers.autolinks.enabled`     | Specifies whether to automatically link external resources in commit messages                                                                                                                                            |
| `gitlens.hovers.autolinks.enhanced`    | Specifies whether to lookup additional details about automatically link external resources in commit messages. Requires a connection to a supported remote service (e.g. GitHub)                                         |
| `gitlens.hovers.pullRequests.enabled`  | Specifies whether to provide information about the Pull Request (if any) that introduced the commit in the hovers. Requires a connection to a supported remote service (e.g. GitHub)                                     |

## View Settings [#](#view-settings- 'View Settings')

| Name                                        | Description                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.defaultItemLimit`            | Specifies the default number of items to show in a view list. Use 0 to specify no limit                                                                                             |
| `gitlens.views.formats.commits.label`       | Specifies the format of commits in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs             |
| `gitlens.views.formats.commits.description` | Specifies the description format of commits in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs |
| `gitlens.views.formats.files.label`         | Specifies the format of a file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs                  |
| `gitlens.views.formats.files.description`   | Specifies the description format of a file in the views. See [_File Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#file-tokens) in the GitLens docs      |
| `gitlens.views.formats.stashes.label`       | Specifies the format of stashes in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs             |
| `gitlens.views.formats.stashes.description` | Specifies the description format of stashes in the views. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs |
| `gitlens.views.pageItemLimit`               | Specifies the number of items to show in a each page when paginating a view list. Use 0 to specify no limit                                                                         |
| `gitlens.views.showRelativeDateMarkers`     | Specifies whether to show relative date markers (_Less than a week ago_, _Over a week ago_, _Over a month ago_, etc) on revision (commit) histories in the views                    |

## Commits View Settings [#](#commits-view-settings- 'Commits View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                                 | Description                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.commits.avatars`                      | Specifies whether to show avatar images instead of commit (or status) icons in the _Commits_ view                                                                                                                                                                                                                                                              |
| `gitlens.views.commits.files.compact`                | Specifies whether to compact (flatten) unnecessary file nesting in the _Commits_ view.<br />Only applies when `gitlens.views.commits.files.layout` is set to `tree` or `auto`                                                                                                                                                                                  |
| `gitlens.views.commits.files.layout`                 | Specifies how the _Commits_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.commits.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree                           |
| `gitlens.views.commits.files.threshold`              | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Commits_ view<br />Only applies when `gitlens.views.commits.files.layout` is set to `auto`                                                                                                                                     |
| `gitlens.views.commits.pullRequests.enabled`         | Specifies whether to query for pull requests associated with the current branch and commits in the _Commits_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                                           |
| `gitlens.views.commits.pullRequests.showForBranches` | Specifies whether to query for pull requests associated with the current branch and commits in the _Commits_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                                           |
| `gitlens.views.commits.pullRequests.showForCommits`  | Specifies whether to show pull requests (if any) associated with the current branch in the _Commits_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                                                   |
| `gitlens.views.commits.reveal`                       | Specifies whether to reveal commits in the _Commits_ view, otherwise they will be revealed in the _Repositories_ view                                                                                                                                                                                                                                          |
| `gitlens.views.commits.showBranchComparison`         | Specifies whether to show a comparison of the current branch or the working tree with a user-selected reference (branch, tag. etc) in the _Commits_ view<br /><br />`false` - hides the branch comparison<br />`branch` - compares the current branch with a user-selected reference<br />`working` - compares the working tree with a user-selected reference |

## Repositories View Settings [#](#repositories-view-settings- 'Repositories View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                                       | Description                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.repositories.avatars`                       | Specifies whether to show avatar images instead of commit (or status) icons in the _Repositories_ view                                                                                                                                                                                                                                         |
| `gitlens.views.repositories.autoRefresh`                   | Specifies whether to automatically refresh the _Repositories_ view when the repository or the file system changes                                                                                                                                                                                                                              |
| `gitlens.views.repositories.autoReveal`                    | Specifies whether to automatically reveal repositories in the _Repositories_ view when opening files                                                                                                                                                                                                                                           |
| `gitlens.views.repositories.branches.layout`               | Specifies how the _Repositories_ view will display branches<br /><br />`list` - displays branches as a list<br />`tree` - displays branches as a tree when branch names contain slashes `/`                                                                                                                                                    |
| `gitlens.views.repositories.branches.showBranchComparison` | Specifies whether to show a comparison of the branch with a user-selected reference (branch, tag. etc) under each branch in the _Repositories_ view view                                                                                                                                                                                       |
| `gitlens.views.repositories.compact`                       | Specifies whether to show the _Repositories_ view in a compact display density                                                                                                                                                                                                                                                                 |
| `gitlens.views.repositories.files.compact`                 | Specifies whether to compact (flatten) unnecessary file nesting in the _Repositories_ view. Only applies when `gitlens.views.repositories.files.layout` is set to `tree` or `auto`                                                                                                                                                             |
| `gitlens.views.repositories.files.layout`                  | Specifies how the _Repositories_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.repositories.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.repositories.files.threshold`               | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Repositories_ view. Only applies when `gitlens.views.repositories.files.layout` is set to `auto`                                                                                                               |
| `gitlens.views.repositories.includeWorkingTree`            | Specifies whether to include working tree file status for each repository in the _Repositories_ view                                                                                                                                                                                                                                           |
| `gitlens.views.repositories.showBranchComparison`          | Specifies whether to show a comparison of a user-selected reference (branch, tag. etc) to the current branch or the working tree in the _Repositories_ view                                                                                                                                                                                    |
| `gitlens.views.repositories.showBranches`                  | Specifies whether to show the branches for each repository in the _Repositories_ view                                                                                                                                                                                                                                                          |
| `itlens.views.repositories.showCommits`                    | Specifies whether to show the commits on the current branch for each repository in the _Repositories_ view                                                                                                                                                                                                                                     |
| `gitlens.views.repositories.showContributors`              | Specifies whether to show the contributors for each repository in the _Repositories_ view                                                                                                                                                                                                                                                      |
| `gitlens.views.repositories.showIncomingActivity`          | Specifies whether to show the experimental incoming activity for each repository in the _Repositories_ view                                                                                                                                                                                                                                    |
| `gitlens.views.repositories.showRemotes`                   | Specifies whether to show the remotes for each repository in the _Repositories_ view                                                                                                                                                                                                                                                           |
| `gitlens.views.repositories.showStashes`                   | Specifies whether to show the stashes for each repository in the _Repositories_ view                                                                                                                                                                                                                                                           |
| `gitlens.views.repositories.showTags`                      | Specifies whether to show the tags for each repository in the _Repositories_ view                                                                                                                                                                                                                                                              |
| `gitlens.views.repositories.showUpstreamStatus`            | Specifies whether to show the upstream status of the current branch for each repository in the _Repositories_ view                                                                                                                                                                                                                             |

## File History View Settings [#](#file-history-view-settings- 'File History View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                | Description                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `gitlens.views.fileHistory.avatars` | Specifies whether to show avatar images instead of status icons in the _File History_ view |

## Line History View Settings [#](#line-history-view-settings- 'Line History View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                | Description                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `gitlens.views.lineHistory.avatars` | Specifies whether to show avatar images instead of status icons in the _Line History_ view |

## Branches View Settings [#](#branches-view-settings- 'Branches View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                                  | Description                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.branches.avatars`                      | Specifies whether to show avatar images instead of commit (or status) icons in the _Branches_ view                                                                                                                                                                                                                                    |
| `gitlens.views.branches.branches.layout`              | Specifies how the _Branches_ view will display branches<br /><br />`list` - displays branches as a list<br />`tree` - displays branches as a tree                                                                                                                                                                                     |
| `gitlens.views.branches.files.compact`                | Specifies whether to compact (flatten) unnecessary file nesting in the _Branches_ view.<br />Only applies when `gitlens.views.commits.files.layout` is set to `tree` or `auto`                                                                                                                                                        |
| `gitlens.views.branches.files.layout`                 | Specifies how the _Branches_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.commits.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.branches.files.threshold`              | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Branches_ view<br />Only applies when `gitlens.views.commits.files.layout` is set to `auto`                                                                                                           |
| `gitlens.views.branches.pullRequests.enabled`         | Specifies whether to query for pull requests associated with the current branch and commits in the _Branches_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                 |
| `gitlens.views.branches.pullRequests.showForBranches` | Specifies whether to query for pull requests associated with the current branch and commits in the _Branches_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                 |
| `gitlens.views.branches.pullRequests.showForCommits`  | Specifies whether to show pull requests (if any) associated with the current branch in the _Branches_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                         |
| `gitlens.views.branches.reveal`                       | Specifies whether to reveal branches in the _Branches_ view, otherwise they will be revealed in the _Repositories_ view                                                                                                                                                                                                               |
| `gitlens.views.branches.showBranchComparison`         | Specifies whether to show a comparison of the branch with a user-selected reference (branch, tag. etc) in the _Branches_ view<br /><br />`false` - hides the branch comparison<br />`branch` - compares the current branch with a user-selected reference                                                                             |

## Remotes View Settings [#](#remotes-view-settings- 'Remotes View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                                 | Description                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.views.remotes.avatars`                      | Specifies whether to show avatar images instead of commit (or status) icons in the _Remotes_ view                                                                                                                                                                                                                                    |
| `gitlens.views.remotes.branches.layout`              | Specifies how the _Remotes_ view will display branches<br /><br />`list` - displays branches as a list<br />`tree` - displays branches as a tree                                                                                                                                                                                     |
| `gitlens.views.remotes.files.compact`                | Specifies whether to compact (flatten) unnecessary file nesting in the _Remotes_ view.<br />Only applies when `gitlens.views.commits.files.layout` is set to `tree` or `auto`                                                                                                                                                        |
| `gitlens.views.remotes.files.layout`                 | Specifies how the _Remotes_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.commits.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.remotes.files.threshold`              | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Remotes_ view<br />Only applies when `gitlens.views.commits.files.layout` is set to `auto`                                                                                                           |
| `gitlens.views.remotes.pullRequests.enabled`         | Specifies whether to query for pull requests associated with the current branch and commits in the _Remotes_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                 |
| `gitlens.views.remotes.pullRequests.showForBranches` | Specifies whether to query for pull requests associated with the current branch and commits in the _Remotes_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                 |
| `gitlens.views.remotes.pullRequests.showForCommits`  | Specifies whether to show pull requests (if any) associated with the current branch in the _Remotes_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                         |
| `gitlens.views.remotes.reveal`                       | Specifies whether to reveal remotes in the _Remotes_ view, otherwise they will be revealed in the _Repositories_ view                                                                                                                                                                                                                |
| `gitlens.views.remotes.showBranchComparison`         | Specifies whether to show a comparison of the branch with a user-selected reference (branch, tag. etc) in the _Remotes_ view<br /><br />`false` - hides the branch comparison<br />`branch` - compares the current branch with a user-selected reference                                                                             |

## Stashes View Settings [#](#stashes-view-settings- 'Stashes View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                    | Description                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.views.stashes.files.compact`   | Specifies whether to compact (flatten) unnecessary file nesting in the _Stashes_ view.<br />Only applies when `gitlens.views.commits.files.layout` is set to `tree` or `auto`                                                                                                                                                        |
| `gitlens.views.stashes.files.layout`    | Specifies how the _Stashes_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.commits.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.stashes.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Stashes_ view<br />Only applies when `gitlens.views.commits.files.layout` is set to `auto`                                                                                                           |
| `gitlens.views.stashes.reveal`          | Specifies whether to reveal stashes in the _Stashes_ view, otherwise they will be revealed in the _Repositories_ view                                                                                                                                                                                                                |

## Tags View Settings [#](#tags-view-settings- 'Tags View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                 | Description                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.tags.avatars`         | Specifies whether to show avatar images instead of commit (or status) icons in the _Tags_ view                                                                                                                                                                                                                                    |
| `gitlens.views.tags.branches.layout` | Specifies how the _Tags_ view will display tags<br /><br />`list` - displays tags as a list<br />`tree` - displays tags as a tree                                                                                                                                                                                                 |
| `gitlens.views.tags.files.compact`   | Specifies whether to compact (flatten) unnecessary file nesting in the _Tags_ view.<br />Only applies when `gitlens.views.commits.files.layout` is set to `tree` or `auto`                                                                                                                                                        |
| `gitlens.views.tags.files.layout`    | Specifies how the _Tags_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.commits.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.tags.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Tags_ view<br />Only applies when `gitlens.views.commits.files.layout` is set to `auto`                                                                                                           |
| `gitlens.views.tags.reveal`          | Specifies whether to reveal tags in the _Tags_ view, otherwise they will be revealed in the _Repositories_ view                                                                                                                                                                                                                   |

## Contributors View Settings [#](#contributors-view-settings- 'Contributors View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                                     | Description                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.contributors.avatars`                     | Specifies whether to show avatar images instead of commit (or status) icons in the _Contributors_ view                                                                                                                                                                                                                                    |
| `gitlens.views.contributors.files.compact`               | Specifies whether to compact (flatten) unnecessary file nesting in the _Contributors_ view.<br />Only applies when `gitlens.views.commits.files.layout` is set to `tree` or `auto`                                                                                                                                                        |
| `gitlens.views.contributors.files.layout`                | Specifies how the _Contributors_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.commits.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |
| `gitlens.views.contributors.files.threshold`             | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Contributors_ view<br />Only applies when `gitlens.views.commits.files.layout` is set to `auto`                                                                                                           |
| `gitlens.views.contributors.pullRequests.enabled`        | Specifies whether to query for pull requests associated with the current branch and commits in the _Contributors_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                 |
| `gitlens.views.contributors.pullRequests.showForCommits` | Specifies whether to show pull requests (if any) associated with the current branch in the _Contributors_ view. Requires a connection to a supported remote service (e.g. GitHub)                                                                                                                                                         |
| `gitlens.views.contributors.showAllBranches`             | Specifies whether to show commits from all branches in the _Contributors_ view                                                                                                                                                                                                                                                            |
| `gitlens.views.contributors.showStatistics`              | Specifies whether to show contributor statistics in the _Contributors_ view. This can take a while to compute depending on the repository size                                                                                                                                                                                            |

## Search & Compare View Settings [#](#search-&-compare-view-settings- 'Search & Compare View Settings')

See also [View Settings](#view-settings- 'Jump to the View settings')

| Name                                    | Description                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.views.compare.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Search Commits_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `auto`                                                                                                     |
| `gitlens.views.compare.avatars`         | Specifies whether to show avatar images instead of commit (or status) icons in the _Compare_ view                                                                                                                                                                                                                                     |
| `gitlens.views.compare.files.compact`   | Specifies whether to compact (flatten) unnecessary file nesting in the _Compare_ view. Only applies when `gitlens.views.compare.files.layout` is set to `tree` or `auto`                                                                                                                                                              |
| `gitlens.views.compare.files.layout`    | Specifies how the _Compare_ view will display files<br /><br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.compare.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree  |
| `gitlens.views.compare.files.threshold` | Specifies when to switch between displaying files as a `tree` or `list` based on the number of files in a nesting level in the _Compare_ view. Only applies when `gitlens.views.compare.files.layout` is set to `auto`                                                                                                                |
| `gitlens.views.search.avatars`          | Specifies whether to show avatar images instead of commit (or status) icons in the _Search Commits_ view                                                                                                                                                                                                                              |
| `gitlens.views.search.files.compact`    | Specifies whether to compact (flatten) unnecessary file nesting in the _Search Commits_ view<br />Only applies when `gitlens.views.compare.files.layout` is set to `tree` or `auto`                                                                                                                                                   |
| `gitlens.views.search.files.layout`     | Specifies how the _Search Commits_ view will display files<br />`auto` - automatically switches between displaying files as a `tree` or `list` based on the `gitlens.views.compare.files.threshold` value and the number of files at each nesting level<br />`list` - displays files as a list<br />`tree` - displays files as a tree |

## Gutter Blame Settings [#](#gutter-blame-settings- 'Gutter Blame Settings')

| Name                                | Description                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.blame.avatars`             | Specifies whether to show avatar images in the gutter blame annotations                                                                                                                                                                                                      |
| `gitlens.blame.compact`             | Specifies whether to compact (deduplicate) matching adjacent gutter blame annotations                                                                                                                                                                                        |
| `gitlens.blame.dateFormat`          | Specifies how to format absolute dates (e.g. using the `${date}` token) in gutter blame annotations. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                                                                              |
| `gitlens.blame.format`              | Specifies the format of the gutter blame annotations. See [_Commit Tokens_](https://github.com/eamodio/vscode-gitlens/wiki/Custom-Formatting#commit-tokens) in the GitLens docs. Date formatting is controlled by the `gitlens.blame.dateFormat` setting                     |
| `gitlens.blame.heatmap.enabled`     | Specifies whether to provide a heatmap indicator in the gutter blame annotations                                                                                                                                                                                             |
| `gitlens.blame.heatmap.location`    | Specifies where the heatmap indicators will be shown in the gutter blame annotations<br /><br />`left` - adds a heatmap indicator on the left edge of the gutter blame annotations<br />`right` - adds a heatmap indicator on the right edge of the gutter blame annotations |
| `gitlens.blame.highlight.enabled`   | Specifies whether to highlight lines associated with the current line                                                                                                                                                                                                        |
| `gitlens.blame.highlight.locations` | Specifies where the associated line highlights will be shown<br /><br />`gutter` - adds a gutter indicator<br />`line` - adds a full-line highlight background color<br />`overview` - adds a decoration to the overview ruler (scroll bar)                                  |
| `gitlens.blame.ignoreWhitespace`    | Specifies whether to ignore whitespace when comparing revisions during blame operations                                                                                                                                                                                      |
| `gitlens.blame.separateLines`       | Specifies whether gutter blame annotations will have line separators                                                                                                                                                                                                         |
| `gitlens.blame.toggleMode`          | Specifies how the gutter blame annotations will be toggled<br /><br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                                                                                     |

## Gutter Changes Settings [#](#gutter-changes-settings- 'Gutter Changes Settings')

| Name                         | Description                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.changes.locations`  | Specifies where the indicators of the gutter changes annotations will be shown<br /><br />`gutter` - adds a gutter indicator<br />`overview` - adds a decoration to the overview ruler (scroll bar) |
| `gitlens.changes.toggleMode` | Specifies how the gutter changes annotations will be toggled<br /><br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                          |

## Gutter Heatmap Settings [#](#gutter-heatmap-settings- 'Gutter Heatmap Settings')

| Name                           | Description                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.heatmap.ageThreshold` | Specifies the age of the most recent change (in days) after which the gutter heatmap annotations will be cold rather than hot (i.e. will use `gitlens.heatmap.coldColor` instead of `gitlens.heatmap.hotColor`) |
| `gitlens.heatmap.coldColor`    | Specifies the base color of the gutter heatmap annotations when the most recent change is older (cold) than the `gitlens.heatmap.ageThreshold` value                                                            |
| `gitlens.heatmap.hotColor`     | Specifies the base color of the gutter heatmap annotations when the most recent change is newer (hot) than the `gitlens.heatmap.ageThreshold` value                                                             |
| `gitlens.heatmap.locations`    | Specifies where the indicators of the gutter heatmap annotations will be shown<br /><br />`gutter` - adds a gutter indicator<br />`overview` - adds a decoration to the overview ruler (scroll bar)             |
| `gitlens.heatmap.toggleMode`   | Specifies how the gutter heatmap annotations will be toggled<br /><br />`file` - toggles each file individually<br />`window` - toggles the window, i.e. all files at once                                      |

## Git Command Palette Settings [#](#git-command-palette-settings- 'Git Command Palette Settings')

| Name                                              | Description                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.gitCommands.closeOnFocusOut`             | Specifies whether to dismiss the _Git Commands Palette_ when focus is lost (if not, press `ESC` to dismiss)                                                   |
| `gitlens.gitCommands.search.matchAll`             | Specifies whether to match all or any commit message search patterns                                                                                          |
| `gitlens.gitCommands.search.matchCase`            | Specifies whether to match commit search patterns with or without regard to casing                                                                            |
| `gitlens.gitCommands.search.matchRegex`           | Specifies whether to match commit search patterns using regular expressions                                                                                   |
| `gitlens.gitCommands.search.showResultsInSideBar` | Specifies whether to show the commit search results directly in the quick pick menu, in the Side Bar, or will be based on the context                         |
| `gitlens.gitCommands.skipConfirmations`           | Specifies which (and when) Git commands will skip the confirmation step, using the format: `git-command-name:(menu/command)`                                  |
| `gitlens.gitCommands.sortBy`                      | Specifies how Git commands are sorted in the _Git Command Palette_<br /><br />`name` - sorts commands by name<br />`usage` - sorts commands by last used date |

## Terminal Links Settings [#](#terminal-links-settings- 'Terminal Links Settings')

| Name                            | Description                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.terminalLinks.enabled` | Specifies whether to enable terminal links &mdash; autolinks in the integrated terminal to quickly jump to more details for commits, branches, tags, and more |

## Remote Provider Integration Settings [#](#remote-provider-integration-settings- 'Remote Provider Integration Settings')

| Name                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.integrations.enabled` | Specifies whether to enable rich integrations with any supported remote services                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.remotes`              | Specifies custom remote services to be matched with Git remotes to detect custom domains for built-in remote services or provide support for custom remote services<br /><br />Supported Types (e.g. `"type": "GitHub"`):<ul><li>"GitHub"</li><li>"GitLab"</li><li>"Gerrit"</li><li>"Gitea"</li><li>"AzureDevOps"</li><li>"Bitbucket"</li><li>"BitbucketServer"</li><li>"Custom"</li></ul>Example:<br />`"gitlens.remotes": [{ "domain": "git.corporate-url.com", "type": "GitHub" }]`<br /><br />Example:<br />`"gitlens.remotes": [{ "regex": "ssh:\/\/(my\.company\.com):1234\/git\/(.+)", "type": "GitHub" }]`<br /><br />Example:<br />`"gitlens.remotes": [{`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"domain": "git.corporate-url.com",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"type": "Custom",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"name": "My Company",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"protocol": "https",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"urls": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"repository": "https://git.corporate-url.com/${repo}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branches": "https://git.corporate-url.com/${repo}/branches",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branch": "https://git.corporate-url.com/${repo}/commits/${branch}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"commit": "https://git.corporate-url.com/${repo}/commit/${id}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"file": "https://git.corporate-url.com/${repo}?path=${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInBranch": "https://git.corporate-url.com/${repo}/blob/${branch}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInCommit": "https://git.corporate-url.com/${repo}/blob/${id}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileLine": "#L${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileRange": "#L${start}-L${end}"`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}]`<br /><br />Example:<br />`"gitlens.remotes": [{`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"regex": "ssh:\\/\\/(my\\.company\\.com):1234\\/git\\/(.+)",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"type": "Custom",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"name": "My Company",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"protocol": "https",`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"urls": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"repository": "https://my.company.com/projects/${repoBase}/repos/${repoPath}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branches": "https://my.company.com/projects/${repoBase}/repos/${repoPath}/branches",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"branch": "https://my.company.com/projects/${repoBase}/repos/${repoPath}/commits/${branch}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"commit": "https://my.company.com/projects/${repoBase}/repos/${repoPath}/commit/${id}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"file": "https://my.company.com/projects/${repoBase}/repos/${repoPath}?path=${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInBranch": "https://my.company.com/projects/${repoBase}/repos/${repoPath}/blob/${branch}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileInCommit": "https://my.company.com/projects/${repoBase}/repos/${repoPath}/blob/${id}/${file}${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileLine": "#L${line}",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"fileRange": "#L${start}-L${end}"`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}]` |

## Date & Time Settings [#](#date--time-settings- 'Date & Time Settings')

| Name                             | Description                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.defaultDateFormat`      | Specifies how absolute dates will be formatted by default. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats       |
| `gitlens.defaultDateShortFormat` | Specifies how short absolute dates will be formatted by default. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats |
| `gitlens.defaultDateSource`      | Specifies whether commit dates should use the authored or committed date                                                                                    |
| `gitlens.defaultDateStyle`       | Specifies how dates will be displayed by default                                                                                                            |
| `gitlens.defaultTimeFormat`      | Specifies how times will be formatted by default. See the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/) for valid formats                |

## Menu & Toolbar Settings [#](#menu--toolbar-settings- 'Menu & Toolbar Settings')

| Name                              | Description                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.menus`                   | Specifies which commands will be added to which menus                                                                                                                                                                                                                                                                                                                        |
| `gitlens.fileAnnotations.command` | Specifies whether the file annotations button in the editor title shows a menu or immediately toggles the specified file annotations<br />`null` (default) - shows a menu to choose which file annotations to toggle<br />`blame` - toggles gutter blame annotations<br />`heatmap` - toggles gutter heatmap annotations<br />`changes` - toggles gutter changes annotations |

## Keyboard Shortcut Settings [#](#keyboard-shortcut-settings- 'Keyboard Shortcut Settings')

| Name             | Description                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.keymap` | Specifies the keymap to use for GitLens shortcut keys<br /><br />`alternate` - adds an alternate set of shortcut keys that start with `Alt` (&#x2325; on macOS)<br />`chorded` - adds a chorded set of shortcut keys that start with `Ctrl+Shift+G` (<code>&#x2325;&#x2318;G</code> on macOS)<br />`none` - no shortcut keys will be added |

## Modes Settings [#](#modes-settings- 'Modes Settings')

| Name                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.mode.active`              | Specifies the active GitLens mode, if any                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gitlens.mode.statusBar.enabled`   | Specifies whether to provide the active GitLens mode in the status bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.mode.statusBar.alignment` | Specifies the active GitLens mode alignment in the status bar<br /><br />`left` - aligns to the left<br />`right` - aligns to the right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gitlens.modes`                    | Specifies the user-defined GitLens modes<br /><br />Example &mdash; adds heatmap annotations to the _Reviewing_ mode<br />`"gitlens.modes": { "review": { "annotations": "heatmap" } }`<br /><br />Example &mdash; adds a new _Annotating_ mode with blame annotations<br />`"gitlens.modes": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;`"annotate": {`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"name": "Annotating",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"statusBarItemName": "Annotating",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"description": "for root cause analysis",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"annotations": "blame",`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"codeLens": false,`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"currentLine": false,`<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`"hovers": true`<br />&nbsp;&nbsp;&nbsp;&nbsp;`}`<br />`}` |

## Autolink Settingss [#](#autolink-settings- 'Autolink Settings')

| Name                | Description                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gitlens.autolinks` | Specifies autolinks to external resources in commit messages. Use `<num>` as the variable for the reference number<br /><br />Example to autolink Jira issues: (e.g. `JIRA-123 ⟶ https://jira.company.com/issue?query=123`)<br />`"gitlens.autolinks": [{ "prefix": "JIRA-", "url": "https://jira.company.com/issue?query=<num>" }]` |

## Misc Settings [#](#misc-settings- 'Misc Settings')

| Name                                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitlens.defaultGravatarsStyle`                                  | Specifies the style of the gravatar default (fallback) images<br /><br />`identicon` - a geometric pattern<br />`mp` - a simple, cartoon-style silhouetted outline of a person (does not vary by email hash)<br />`monsterid` - a monster with different colors, faces, etc<br />`retro` - 8-bit arcade-style pixelated faces<br />`robohash` - a robot with different colors, faces, etc<br />`wavatar` - a face with differing features and backgrounds |
| `gitlens.liveshare.allowGuestAccess`                             | Specifies whether to allow guest access to GitLens features when using Visual Studio Live Share                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.outputLevel`                                            | Specifies how much (if any) output will be sent to the GitLens output channel                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.showWelcomeOnInstall`                                   | Specifies whether to show the Welcome (Quick Setup) experience on first install                                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.showWhatsNewAfterUpgrades`                              | Specifies whether to show the What's New notification after upgrading to new feature releases                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.sortBranchesBy`                                         | Specifies how branches are sorted in quick pick menus and views                                                                                                                                                                                                                                                                                                                                                                                           |
| `gitlens.sortContributorsBy`                                     | Specifies how contributors are sorted in quick pick menus and views                                                                                                                                                                                                                                                                                                                                                                                       |
| `gitlens.sortTagsBy`                                             | Specifies how tags are sorted in quick pick menus and views                                                                                                                                                                                                                                                                                                                                                                                               |
| `gitlens.advanced.abbreviatedShaLength`                          | Specifies the length of abbreviated commit SHAs (shas)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `gitlens.advanced.abbreviateShaOnCopy`                           | Specifies whether to copy full or abbreviated commit SHAs to the clipboard. Abbreviates to the length of `gitlens.advanced.abbreviatedShaLength`..                                                                                                                                                                                                                                                                                                        |
| `gitlens.advanced.blame.customArguments`                         | Specifies additional arguments to pass to the `git blame` command                                                                                                                                                                                                                                                                                                                                                                                         |
| `gitlens.advanced.blame.delayAfterEdit`                          | Specifies the time (in milliseconds) to wait before re-blaming an unsaved document after an edit. Use 0 to specify an infinite wait                                                                                                                                                                                                                                                                                                                       |
| `gitlens.advanced.blame.sizeThresholdAfterEdit`                  | Specifies the maximum document size (in lines) allowed to be re-blamed after an edit while still unsaved. Use 0 to specify no maximum                                                                                                                                                                                                                                                                                                                     |
| `gitlens.advanced.caching.enabled`                               | Specifies whether git output will be cached &mdash; changing the default is not recommended                                                                                                                                                                                                                                                                                                                                                               |
| `gitlens.advanced.commitOrdering`                                | Specifies the order by which commits will be shown. If unspecified, commits will be shown in reverse chronological order<br /><br />`date` - shows commits in reverse chronological order of the commit timestamp<br />`author-date` - shows commits in reverse chronological order of the author timestamp<br />`topo` - shows commits in reverse chronological order of the commit timestamp, but avoids intermixing multiple lines of history          |
| `gitlens.advanced.externalDiffTool`                              | Specifies an optional external diff tool to use when comparing files. Must be a configured [Git difftool](https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool).                                                                                                                                                                                                                                                                     |
| `gitlens.advanced.externalDirectoryDiffTool`                     | Specifies an optional external diff tool to use when comparing directories. Must be a configured [Git difftool](https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool).                                                                                                                                                                                                                                                               |
| `gitlens.advanced.fileHistoryFollowsRenames`                     | Specifies whether file histories will follow renames -- will affect how merge commits are shown in histories                                                                                                                                                                                                                                                                                                                                              |
| `gitlens.advanced.fileHistoryShowAllBranches`                    | Specifies whether file histories will show commits from all branches                                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.advanced.maxListItems`                                  | Specifies the maximum number of items to show in a list. Use 0 to specify no maximum                                                                                                                                                                                                                                                                                                                                                                      |
| `gitlens.advanced.maxSearchItems`                                | Specifies the maximum number of items to show in a search. Use 0 to specify no maximum                                                                                                                                                                                                                                                                                                                                                                    |
| `gitlens.advanced.messages`                                      | Specifies which messages should be suppressed                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gitlens.advanced.quickPick.closeOnFocusOut`                     | Specifies whether to dismiss quick pick menus when focus is lost (if not, press `ESC` to dismiss)                                                                                                                                                                                                                                                                                                                                                         |
| `gitlens.advanced.repositorySearchDepth`                         | Specifies how many folders deep to search for repositories                                                                                                                                                                                                                                                                                                                                                                                                |
| `gitlens.advanced.similarityThreshold`                           | Specifies the amount (percent) of similarity a deleted and added file pair must have to be considered a rename                                                                                                                                                                                                                                                                                                                                            |
| `gitlens.strings.codeLens.unsavedChanges.recentChangeAndAuthors` | Specifies the string to be shown in place of both the _recent change_ and _authors_ code lens when there are unsaved changes                                                                                                                                                                                                                                                                                                                              |
| `gitlens.strings.codeLens.unsavedChanges.recentChangeOnly`       | Specifies the string to be shown in place of the _recent change_ code lens when there are unsaved changes                                                                                                                                                                                                                                                                                                                                                 |
| `gitlens.strings.codeLens.unsavedChanges.authorsOnly`            | Specifies the string to be shown in place of the _authors_ code lens when there are unsaved changes                                                                                                                                                                                                                                                                                                                                                       |

## Themable Colors [#](#themable-colors- 'Themable Colors')

GitLens defines a set of themable colors which can be provided by vscode themes or directly by the user using [`workbench.colorCustomizations`](https://code.visualstudio.com/docs/getstarted/themes#_customize-a-color-theme).

| Name                                       | Description                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `gitlens.gutterBackgroundColor`            | Specifies the background color of the gutter blame annotations                            |
| `gitlens.gutterForegroundColor`            | Specifies the foreground color of the gutter blame annotations                            |
| `gitlens.gutterUncommittedForegroundColor` | Specifies the foreground color of an uncommitted line in the gutter blame annotations     |
| `gitlens.trailingLineBackgroundColor`      | Specifies the background color of the trailing blame annotation                           |
| `gitlens.trailingLineForegroundColor`      | Specifies the foreground color of the trailing blame annotation                           |
| `gitlens.lineHighlightBackgroundColor`     | Specifies the background color of the associated line highlights in blame annotations     |
| `gitlens.lineHighlightOverviewRulerColor`  | Specifies the overview ruler color of the associated line highlights in blame annotations |

# Contributors &#x1F64F;&#x2764;

A big thanks to the people that have contributed to this project:

- Zeeshan Adnan ([@zeeshanadnan](https://github.com/zeeshanadnan)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=zeeshanadnan)
- Alex ([@deadmeu](https://github.com/deadmeu)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=deadmeu)
- Abdulrahman (Abdu) Assabri ([@abdusabri](https://github.com/abdusabri)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=abdusabri)
- Grey Baker ([@greysteil](https://github.com/greysteil)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=greysteil)
- Loris Bettazza ([@Pustur](https://github.com/Pustur)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Pustur)
- Brian Bolte ([@bolte-17](https://github.com/bolte-17)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=bolte-17)
- Zach Boyle ([@zaboyle](https://github.com/zaboyle)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=zaboyle)
- Tony Brix ([@UziTech](https://github.com/UziTech)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=UziTech)
- Matt Buckley ([@Mattadore](https://github.com/Mattadore)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Mattadore)
- Lee Chang ([@MeltingMosaic](https://github.com/MeltingMosaic)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=MeltingMosaic)
- Amanda Cameron ([@AmandaCameron](https://github.com/AmandaCameron)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=AmandaCameron)
- Martin Campbell ([@martin-css](https://github.com/martin-css)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=martin-css)
- Brett Cannon ([@brettcannon](https://github.com/brettcannon)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=brettcannon)
- Barney Carroll ([@barneycarroll](https://github.com/barneycarroll)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=barneycarroll)
- Andrea Cigana ([@ciganandrea](https://github.com/ciganandrea)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ciganandrea)
- Ash Clarke ([@ashclarke](https://github.com/ashclarke)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ashclarke)
- Travis Collins ([@TravisTX](https://github.com/TravisTX)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=TravisTX)
- Matt Cooper ([@vtbassmatt](https://github.com/vtbassmatt)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=vtbassmatt)
- Skyler Dawson ([@foxwoods369](https://github.com/foxwoods369)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=foxwoods369)
- Andrii Dieiev ([@IllusionMH](https://github.com/IllusionMH)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=IllusionMH)
- egfx-notifications ([@egfx-notifications](https://github.com/egfx-notifications)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=egfx-notifications)
- Segev Finer ([@segevfiner](https://github.com/segevfiner)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=segevfiner)
- Cory Forsyth ([@bantic](https://github.com/bantic)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=bantic)
- John Gee ([@shadowspawn](https://github.com/shadowspawn)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=shadowspawn)
- Geoffrey ([@g3offrey](https://github.com/g3offrey)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=g3offrey)
- Guillaume Rozan ([@grozan](https://github.com/grozan)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=grozan)
- Guillem González Vela ([@guillemglez](https://github.com/guillemglez)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=guillemglez)
- Vladislav Guleaev ([@vguleaev](https://github.com/vguleaev)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=vguleaev)
- Dmitry Gurovich ([@yrtimiD](https://github.com/yrtimiD)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=yrtimiD)
- hahaaha ([@hahaaha](https://github.com/hahaaha)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=hahaaha)
- Ken Hom ([@kh0m](https://github.com/kh0m)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=kh0m)
- Yukai Huang ([@Yukaii](https://github.com/Yukaii)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Yukaii)
- Justin Hutchings ([@jhutchings1](https://github.com/jhutchings1)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jhutchings1)
- Roy Ivy III ([@rivy](https://github.com/rivy)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=rivy)
- Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=hjanuschka)
- jogo- ([@jogo-](https://github.com/jogo-)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jogo-)
- Nils K ([@septatrix](https://github.com/septatrix)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=septatrix)
- Chris Kaczor ([@ckaczor](https://github.com/ckaczor)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ckaczor)
- Allan Karlson ([@bees4ever](https://github.com/bees4ever)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=bees4ever)
- Nafiur Rahman Khadem ([@ShafinKhadem](https://github.com/ShafinKhadem)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ShafinKhadem)
- Mathew King ([@MathewKing](https://github.com/MathewKing)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=MathewKing)
- Lior Kletter ([@Git-Lior](https://github.com/Git-Lior)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Git-Lior)
- Chase Knowlden ([@ChaseKnowlden](https://github.com/ChaseKnowlden)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ChaseKnowlden)
- Andrei Korigodski ([@korigod](https://github.com/korigod)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=korigod)
- Kwok ([@mankwok](https://github.com/mankwok)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=mankwok)
- Marc Lasson ([@mlasson](https://github.com/mlasson)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=mlasson)
- John Letey ([@johnletey](https://github.com/johnletey)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=johnletey)
- Stanislav Lvovsky ([@slavik-lvovsky](https://github.com/slavik-lvovsky)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=slavik-lvovsky)
- Peng Lyu ([@rebornix](https://github.com/rebornix)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=rebornix)
- Cédric Malard ([@cmalard](https://github.com/cmalard)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=cmalard)
- Asif Kamran Malick ([@akmalick](https://github.com/akmalick)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=akmalick)
- Sam Martin ([@smartinio](https://github.com/smartinio)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=smartinio)
- mcy-kylin ([@mcy-kylin](https://github.com/mcy-kylin)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=mcy-kylin)
- Mark Molinaro ([@markjm](https://github.com/markjm)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=markjm)
- Ahmadou Waly Ndiaye ([@sir-kain](https://github.com/sir-kain)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=sir-kain)
- Nguyen Long Nhat ([@torn4dom4n](https://github.com/torn4dom4n)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=torn4dom4n)
- Dave Nicolson ([@dnicolson](https://github.com/dnicolson)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=dnicolson)
- Aurelio Ogliari ([@nobitagit](https://github.com/nobitagit)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=nobitagit)
- Raaj Patil ([@arrpee](https://github.com/arrpee)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=arrpee)
- Kevin Paxton ([kpaxton](https://github.com/kpaxton)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=kpaxton)
- Connor Peet ([@connor4312](https://github.com/connor4312)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=connor4312)
- Maxim Pekurin ([@pmaxim25](https://github.com/pmaxim25)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=pmaxim25)
- Leo Dan Peña ([@amouxaden](https://github.com/amouxaden)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=amouxaden)
- Arunprasad Rajkumar ([@arajkumar](https://github.com/arajkumar)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=arajkumar)
- David Rees ([@studgeek](https://github.com/studgeek)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=studgeek)
- Rickard ([@rickardp](https://github.com/rickardp)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=rickardp)
- Johannes Rieken ([@jrieken](https://github.com/jrieken)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jrieken)
- Daniel Rodríguez ([@sadasant](https://github.com/sadasant)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=sadasant)
- Guillaume Rozan ([@rozangu1](https://github.com/rozangu1)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=rozangu1)
- ryenus ([@ryenus](https://github.com/ryenus)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ryenus)
- Felipe Santos ([@felipecrs](https://github.com/felipecrs)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=felipecrs)
- Andrew Savage ([@andrewsavage1](https://github.com/andrewsavage1)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=andrewsavage1)
- Zack Schuster ([@zackschuster](https://github.com/zackschuster)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=zackschuster)
- Matt Seddon ([@mattseddon](https://github.com/mattseddon)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=mattseddon)
- Ahmadali Shafiee ([@ahmadalli](https://github.com/ahmadalli)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ahmadalli)
- Shashank Shastri ([@Shashank-Shastri](https://github.com/Shashank-Shastri)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Shashank-Shastri)
- Skybbles ([@Luxray5474](https://github.com/Luxray5474)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Luxray5474)
- Brendon Smith ([@br3ndonland](https://github.com/br3ndonland)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=br3ndonland)
- Ross Smith II ([@rasa](https://github.com/rasa)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=rasa)
- Oleg Solomka ([@legomushroom](https://github.com/legomushroom)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=legomushroom)
- Miguel Solorio ([@misolori](https://github.com/misolori)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=misolori)
- SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=SpaceEEC)
- stampyzfanz ([@stampyzfanz](https://github.com/stampyzfanz)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=stampyzfanz)
- sueka ([@sueka](https://github.com/sueka)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=sueka)
- Mike Surcouf ([@mikes-gh](https://github.com/mikes-gh)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=mikes-gh)
- Alexey Svetliakov ([@asvetliakov](https://github.com/asvetliakov)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=asvetliakov)
- Takashi Tamura ([@tamuratak](https://github.com/tamuratak)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=tamuratak)
- Andy Tang ([@thewindsofwinter](https://github.com/thewindsofwinter)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=thewindsofwinter)
- Dmitry Ulupov ([@dimaulupov](https://github.com/dimaulupov)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=dimaulupov)
- Alexey Vasyukov ([@notmedia](https://github.com/notmedia)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=notmedia)
- Ivan Volzhev ([@ivolzhevbt](https://github.com/ivolzhevbt)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ivolzhevbt)
- x13machine ([@x13machine](https://github.com/x13machine)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=x13machine)
- Alwin Wang ([@alwinw](https://github.com/alwinw)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=alwinw)
- Ian Wilkinson ([@sgtwilko](https://github.com/sgtwilko)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=sgtwilko)
- Brian Williams ([@Brcrwilliams](https://github.com/Brcrwilliams)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Brcrwilliams)
- Adaex Yang ([@adaex](https://github.com/adaex)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=adaex)
- Yan Zhang ([@Eskibear](https://github.com/Eskibear)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Eskibear)
- Zyck ([@qzyse2017](https://github.com/qzyse2017)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=qzyse2017)
- Yonatan Greenfeld ([@YonatanGreenfeld](https://github.com/YonatanGreenfeld)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=YonatanGreenfeld)
- WofWca ([@WofWca](https://github.com/WofWca)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=WofWca)

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!

# License

This repository contains both OSS-licensed and non-OSS-licensed files.

All files in or under any directory named "plus" fall under LICENSE.plus.

The remaining files fall under the MIT license.
