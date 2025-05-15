# GitLens &mdash; Supercharge Git in VS Code

> Supercharge Git and unlock **untapped knowledge** within your repo to better **understand**, **write**, and **review** code. Focus, collaborate, accelerate.

[GitLens](https://gitkraken.com/gitlens?utm_source=gitlens-extension&utm_medium=in-app-links&utm_campaign=gitlens-logo-links 'Learn more about GitLens') is a powerful [open-source](https://github.com/gitkraken/vscode-gitlens 'Open GitLens on GitHub') extension for Visual Studio Code built and maintained by GitKraken.

Enhance your workflows with powerful Git functionality like in-editor blame annotations, hovers, CodeLens, and more—all fully customizable within VS Code. Try GitLens Pro's advanced workflows that accelerate PR reviews, provide rich interactive Git actions, and enhance collaboration for you and your team.

## Getting Started

Install GitLens by clicking `Install` on the banner above, or from the Extensions side bar in VS Code by searching for GitLens.

<p>
  <a title="Watch the GitLens Getting Started video" href="https://www.youtube.com/watch?v=UQPb73Zz9qk"><img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/get-started-video.png" alt="Watch the GitLens Getting Started video" /></a>
</p>

- Use `Switch to Pre-Release Version` on the extension banner to be the first to experience new features.

> Have questions or concerns? Talk to our engineering team directly through our [GitHub Discussions](https://github.com/gitkraken/vscode-gitlens/discussions/categories/feedback) page. Having a positive experience with GitLens? Feel free to [write a review](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens&ssr=false#review-details).

## GitLens Editions: Community and Pro

**GitLens Community** is free and gives you powerful tools to manage Git and understand how your code has evolved and by whom. With popular features like in-editor blame annotations, hovers, and CodeLens, you can see actionable authorship details at the top of each file. Track the history of any file over time using Revision Navigation to gain deeper insights into code changes.

**GitLens Pro** takes your workflow to the next level by unlocking advanced features and seamless integrations:

- **Accelerate PR reviews** and easily manage your end-to-end workflows with a clean and actionable PR, issue, and branch Home View built directly into VS Code.
- **Manage commits effortlessly** using the Commit Graph, where you can execute advanced actions like rebase, merge, and more. With powerful search and filtering, quickly locate commits, branches, or files.
- **Enhance collaboration** by integrating with platforms like GitHub, GitLab, and Bitbucket, reducing context switching. View and manage PRs directly in VS Code through Launchpad.

You can [try GitLens Pro for free](https://gitkraken.dev/register?product=gitlens&source=marketing_page&redirect_uri=vscode%3A%2F%2Feamodio.gitlens%2Flogin&flow=gitlens_web&utm_source=gitlens-extension&utm_medium=readme) by signing up for a GitKraken account. Some Pro features are available for free on public repos. `Preview` features may require a GitKraken account and could become Pro features in the future.

[Workflows](#discover-powerful-workflows 'Jump to Discover Powerful Workflows')
| [More Features](#more-features 'Jump to More Features')
| [Labs](#gitkraken-labs 'Jump to GitKraken Labs')
| [Pro](#ready-for-gitlens-pro 'Jump to Ready for GitLens Pro?')
| [Support and Community](#support-and-community 'Jump to Support and Community')
| [Contributing](#contributing 'Jump to Contributing')
| [Contributors](#contributors- 'Jump to Contributors')
| [License](#license 'Jump to License')

# Discover Powerful Workflows

GitLens offers a wide range of features—here are the three most popular workflows that users rely on to boost their productivity:

- [**Interactive Code History**](#interactive-code-history) &mdash; Understanding code in repositories with multiple branches and contributors can be difficult. GitLens provides the context you need with tools like blame, hovers, and file annotations. But it doesn’t stop there—the interactive Commit Graph lets you create branches, rebase, revert, and more, all with powerful search capabilities.

- [**Accelerate PR Reviews**](#accelerate-pr-reviews) &mdash; Reduce context switching and manage all your PRs in one place. Prioritize tasks and identify bottlenecks right in VS Code with Launchpad when you integrate Github or other host providers. Work on multiple branches at once without disrupting your main workspace with Worktrees.

- [**Streamline Collaboration**](#streamline-collaboration) &mdash; GitLens isn’t just for solo developers—it’s designed to enhance team collaboration. With Cloud Patches and Code Suggest, you can share and discuss suggested changes with any GitLens or GitKraken user, on multiple files and even PRs.

## Home View - Your VS Code Workflow Hub

Compact but powerful, the Home View lets you take your tasks and issues from code to merge. Start work on an issue and create PRs in one intelligent view. The perfect companion for developers looking to reduce tedious context switching and stay focused on their work in VS Code.

## Accelerate Your Workflow with AI (Preview)

GitLens leverages AI to simplify tedious tasks like writing commit messages, crafting pull request descriptions, generating changelogs and more—allowing you to focus on your code.

- **Generate Commit and Stash Messages**: Quickly create descriptive commit or stash messages tailored to your code changes.

- **Explain Commits**: Instantly understand the context of a commit through concise AI-generated explanations in the Inspect view.

- **Open Pull Requests**: Automatically generate clear PR titles and descriptions directly from your branch changes, speeding up review cycles.

- **Generate Changelogs**: Effortlessly summarize repository changes for release notes or documentation updates.
- More coming soon!

**Community Features**: Community users can generate commit messages for free if they are using GitHub Copilot or have a free [GitKraken](https://gitkraken.dev/register?product=gitlens&source=marketing_page&redirect_uri=vscode%3A%2F%2Feamodio.gitlens%2Flogin&flow=gitlens_web&utm_source=gitlens-extension&utm_medium=readme-ai) account with an API key connected to other providers like OpenAI, Anthropic, DeepSeek, Gemini, etc.

**Pro Features**: Subscribe to GitLens Pro to access all AI features with GitKraken AI (Preview)—no manual key management required.

# Interactive Code History

Understanding who made changes, when, and why can be challenging. GitLens simplifies this with tools like the Commit Graph, Inspect, Inline Blame, and Hovers, giving you clear context and insights. Quickly explore your repository's history with intuitive visuals and actionable tools.

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

## Commit Graph `Pro`

Easily visualize your repository and keep track of all work in progress.

Use the rich commit search to find exactly what you're looking for. Its powerful filters allow you to search by a specific commit, message, author, a changed file or files, or even a specific code change. [Learn more](https://gitkraken.com/solutions/commit-graph?utm_source=gitlens-extension&utm_medium=in-app-links)

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commit-graph.png" alt="Commit Graph" />
</figure>

💡Quickly toggle the Graph via the `Toggle Commit Graph` command.

💡Maximize the Graph via the `Toggle Maximized Commit Graph` command.

## Revision Navigation

With just a click of a button, you can navigate backwards and forwards through the history of any file. Compare changes over time and see the revision history of the whole file or an individual line.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/revision-navigation.gif" alt="Revision Navigation" />
</figure>

# Accelerate PR Reviews

PR reviews often require switching between GitHub, email, and your IDE. Launchpad is your centralized PR hub in VS Code where you can spot bottlenecks, prioritize reviews and unblock your team. With Worktrees, you can work on multiple branches—hotfixes, features, or experiments—without disrupting your workspace.

## Launchpad `Pro`

Launchpad consolidates all your GitHub pull requests into a unified, actionable list. Focus on the most important reviews and take action to keep your team moving forward.. [Learn more](https://gitkraken.com/solutions/launchpad?utm_source=gitlens-extension&utm_medium=in-app-links)

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/launchpad.png" alt="Launchpad" />
</figure>

## Worktrees `Pro`

Worktrees enable efficient multitasking by allowing you to work on multiple branches without stashing changes or leaving your current branch. They preserve your workflow while letting you shift focus when needed. For example, you can easily review a pull request on a worktree in a separate VS Code window with GitLens.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/worktrees.png" alt="Worktrees view" />
</figure>

# Streamline Collaboration

GitLens isn’t just for solo developers—it’s designed to enhance team collaboration. Sharing code can be tricky without adding noise to your repository with extra commits or branches. GitLens simplifies this with Cloud Patches and Code Suggest, letting you share or propose changes to any file in the repository without committing or pushing to a remote.

## Cloud Patches `Preview`

Privately and securely share code changes by creating a Cloud Patch from your work-in-progress, commit, or stash, and sharing a link with specific teammates and other developers. Cloud Patches enable early collaboration for feedback on direction and approach, reducing rework and streamlining your workflow, without adding noise to your repositories. [Learn more](https://gitkraken.com/solutions/cloud-patches?utm_source=gitlens-extension&utm_medium=in-app-links)

## Code Suggest `Preview`

Break free from GitHub's limited, comment-only review feedback. With GitLens, you can suggest code changes directly from your IDE, just like editing a Google Doc. Provide feedback on any part of your project during a review—not just the lines changed in a PR. [Learn more](https://gitkraken.com/solutions/code-suggest?utm_source=gitlens-extension&utm_medium=in-app-links)

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/code-suggest.png" alt="Code Suggest" />
</figure>

# More Features

## Side Bar Views

Our views are arranged for focus and productivity, although you can easily drag them around to suit your needs.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/side-bar-views.png" alt="Side Bar views" />
  <figcaption>GitLens Inspect as shown above has been manually moved into the Secondary Side Bar</figcaption>
</figure>

💡 Use the `Reset Views Layout` command to quickly get back to the default layout.

### GitLens Inspect

An x-ray or developer tools Inspect into your code, focused on providing contextual information and insights to what you're actively working on.

- **Inspect** &mdash; See rich details of a commit or stash.
- **Line History** &mdash; Jump through the revision history of the selected line(s).
- **File History** &mdash; Explore the revision history of a file, folder, or selected lines.
- [**Visual File History `Pro`**](#visual-file-history-pro) &mdash; Quickly see the evolution of a file, including when changes were made, how large they were, and who made them.
- **Search & Compare** &mdash; Search and explore for a specific commit, message, author, changed file or files, or even a specific code change, or visualize comparisons between branches, tags, commits, and more.

### GitLens

Quick access to many GitLens features. Also the home of GitKraken teams and collaboration services (e.g. Cloud Patches, Cloud Workspaces), help, and support.

- **Home** &mdash; Quick access to many features.
- [**Cloud Patches `Preview`**](#cloud-patches-preview) &mdash; Privately and securely share code with specific teammates
- [**Cloud Workspaces `Preview`**](#gitkraken-workspaces-preview) &mdash; Easily group and manage multiple repositories together, accessible from anywhere, streamlining your workflow.

### Source Control

Shows additional views that are focused on exploring and managing your repositories.

- **Commits** &mdash; Comprehensive view of the current branch commit history, including unpushed changes, upstream status, quick comparisons, and more.
- **Branches** &mdash; Manage and navigate branches.
- **Remotes** &mdash; Manage and navigate remotes and remote branches.
- **Stashes** &mdash; Save and restore changes you are not yet ready to commit.
- **Tags** &mdash; Manage and navigate tags.
- [**Worktrees `Pro`**](#worktrees-pro) &mdash; Simultaneously work on different branches of a repository.
- **Contributors** &mdash; Ordered list of contributors, providing insights into individual contributions and involvement.
- **Repositories** &mdash; Unifies the above views for more efficient management of multiple repositories.

### (Bottom) Panel

Convenient and easy access to the Commit Graph with a dedicated details view.

## Cloud Workspaces `Preview`

Cloud Workspaces allow you to easily group and manage multiple repositories together, accessible from anywhere, streamlining your workflow. Create workspaces just for yourself or share (coming soon in GitLens) them with your team for faster onboarding and better collaboration. [Learn more](https://gitkraken.com/solutions/workspaces?utm_source=gitlens-extension&utm_medium=in-app-links)

## Visual File History `Pro`

Quickly see the evolution of a file, including when changes were made, how large they were, and who made them. Use it to quickly find when the most impactful changes were made to a file or who best to talk to about file changes and more.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/visual-file-history-illustrated.png" alt="Visual File History view" />
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

- Explore the commit history of branches and files
- Quickly search for and navigate to (and action upon) commits
- Explore a file of a commit
- View and explore your stashes
- Visualize the current repository status

# Integrations

Context switching kills productivity. GitLens not only reveals buried knowledge within your repository, it also brings additional context from issues and pull requests providing you with a wealth of information and insights at your fingertips.

Simplify your workflow and quickly gain insights with automatic linking of issues and pull requests across multiple Git hosting services including GitHub, GitHub Enterprise `Pro`, GitLab, GitLab Self-Managed `Pro`, Jira, Gitea, Gerrit, Google Source, Bitbucket, Bitbucket Server, Azure DevOps, and custom servers.

All integrations provide automatic linking, while rich integrations with GitHub, GitLab and Jira offer detailed hover information for autolinks, and correlations between pull requests, branches, and commits, as well as user avatars for added context.

## Define your own autolinks

Use autolinks to linkify external references, like Jira issues or Zendesk tickets, in commit messages.

# Ready for GitLens Pro?

When you're ready to unlock the full potential of GitLens and enjoy all the benefits, consider [upgrading to GitLens Pro](https://gitkraken.dev/register?product=gitlens&source=marketing_page&redirect_uri=vscode%3A%2F%2Feamodio.gitlens%2Flogin&flow=gitlens_web). With GitLens Pro, you'll gain access to [Pro features](https://gitkraken.com/gitlens/pro-features?utm_source=gitlens-extension&utm_medium=in-app-links) on privately-hosted repos.

To learn more about the additional features offered with Pro, visit the [GitLens Community vs GitLens Pro](https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/?utm_source=gitlens-extension&utm_medium=in-app-links&utm_campaign=readme&utm_term=ready-for-gitlens-pro) page.

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

# Contributors

A big thanks to the people that have contributed to this project 🙏❤️:

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
- Omar Ghazi ([@omarfesal](https://github.com/omarfesal)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=omarfesal)
- Neil Ghosh ([@neilghosh](https://github.com/neilghosh)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=neilghosh)
- Guillaume Rozan ([@grozan](https://github.com/grozan)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=grozan)
- Guillem González Vela ([@guillemglez](https://github.com/guillemglez)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=guillemglez)
- Vladislav Guleaev ([@vguleaev](https://github.com/vguleaev)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=vguleaev)
- Dmitry Gurovich ([@yrtimiD](https://github.com/yrtimiD)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=yrtimiD)
- hahaaha ([@hahaaha](https://github.com/hahaaha)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=hahaaha)
- Victor Hallberg ([@mogelbrod](https://github.com/mogelbrod)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=mogelbrod)
- Ken Hom ([@kh0m](https://github.com/kh0m)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=kh0m)
- Yukai Huang ([@Yukaii](https://github.com/Yukaii)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=Yukaii)
- Justin Hutchings ([@jhutchings1](https://github.com/jhutchings1)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jhutchings1)
- Roy Ivy III ([@rivy](https://github.com/rivy)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=rivy)
- Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=hjanuschka)
- jogo- ([@jogo-](https://github.com/jogo-)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jogo-)
- Nils K ([@septatrix](https://github.com/septatrix)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=septatrix)
- Chris Kaczor ([@ckaczor](https://github.com/ckaczor)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ckaczor)
- Aidos Kanapyanov ([@aidoskanapyanov](https://github.com/aidoskanapyanov)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=aidoskanapyanov)
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
- Leo Dan Peña ([@leo9-py](https://github.com/leo9-py)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=leo9-py)
- Aman Prakash ([@gitgoap](https://github.com/gitgoap)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=gitgoap)
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
- 不见月 ([@nooooooom](https://github.com/nooooooom)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=nooooooom)
- Ian Chamberlain ([@ian-h-chamberlain](https://github.com/ian-h-chamberlain)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=ian-h-chamberlain)
- Brandon Cheng ([@gluxon](https://github.com/gluxon)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=gluxon)
- yutotnh ([@yutotnh](https://github.com/yutotnh)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=yutotnh)
- may ([@m4rch3n1ng](https://github.com/m4rch3n1ng)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=m4rch3n1ng)
- bm-w ([@bm-w](https://github.com/bm-w)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=bm-w)
- Tyler Johnson ([@TJohnsonSE](https://github.com/TJohnsonSE)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=TJohnsonSE)
- Jean Pierre ([@jeanp413](https://github.com/jeanp413)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jeanp413)
- Dawn Hwang ([@hwangh95](https://github.com/hwangh95)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=hwangh95)
- Emmanuel Ferdman ([@emmanuel-ferdman](https://github.com/emmanuel-ferdman)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=emmanuel-ferdman)
- Jordon Kashanchi ([@jordonkash](https://github.com/JordonKash)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=jordonkash)
- JounQin ([@JounQin](https://github.com/JounQin)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=JounQin)
- Noritaka Kobayashi ([@noritaka1166](https://github.com/noritaka1166)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=noritaka1166)

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!

# License

This repository contains both OSS-licensed and non-OSS-licensed files.

All files in or under any directory named "plus" fall under LICENSE.plus.

The remaining files fall under the MIT license.
