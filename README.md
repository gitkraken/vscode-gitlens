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
- marked with a ☁️ require a GitKraken account, with access level based on your [plan](https://www.gitkraken.com/gitlens/pricing), e.g. Free, Pro, etc

See the [FAQ](#is-gitlens-free-to-use 'Jump to FAQ') for more details.

[Features](#discover-powerful-features 'Jump to Discover Powerful Features')
| [Labs](#gitkraken-labs 'Jump to GitKraken Labs')
| [Pro](#ready-for-gitlens-pro 'Jump to Ready for GitKraken Pro?')
| [FAQ](#faq 'Jump to FAQ')
| [Support and Community](#support-and-community 'Jump to Support and Community')
| [Contributing](#contributing 'Jump to Contributing')
| [Contributors](#contributors- 'Jump to Contributors')
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

Focus brings all of your GitHub pull requests and issues into a unified actionable view to help to you more easily juggle work in progress, pending work, reviews, and more. Quickly see if anything requires your attention while keeping you focused.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/focus-view.png" alt="Focus view" />
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

- Explore the commit history of branches and files
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

# Ready for GitKraken Pro?

When you're ready to unlock the full potential of GitLens and enjoy all the benefits on your privately hosted repos, consider upgrading to GitKraken Pro. With GitKraken Pro, you'll gain access to ✨ features on privately hosted repos and ☁️ features based on the Pro plan.

To learn more about the pricing and the additional ✨ and ☁️ features offered with GitKraken Pro, visit the [GitLens Pricing page](https://www.gitkraken.com/gitlens/pricing). Upgrade to GitKraken Pro today and take your Git workflow to the next level!

# FAQ

## Is GitLens free to use?

Yes. All features are free to use on all repos, **except** for features,

- marked with a ✨ require a [trial or paid plan](https://www.gitkraken.com/gitlens/pricing) for use on privately hosted repos
- marked with a ☁️ require a GitKraken Account, with access level based on your [plan](https://www.gitkraken.com/gitlens/pricing), e.g. Free, Pro, etc

While GitLens offers a remarkable set of free features, a subset of features tailored for professional developers and teams, marked with a ✨, require a trial or paid plan for use on privately hosted repos &mdash; use on local or publicly hosted repos is free for everyone. Additionally some features marked with a ☁️, rely on GitKraken Dev Services which requires a GitKraken account and access is based on your plan, e.g. Free, Pro, etc.

Preview ✨ features instantly for free for 3 days without an account, or start a free GitKraken trial to get an additional 7 days and gain access to ☁️ features to experience the full power of GitLens.

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

With GitKraken Pro, you gain access to priority email support from our customer success team, ensuring higher priority and faster response times. Custom onboarding and training are also available to help you and your team quickly get up and running with a GitKraken Pro plan.

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

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!

# License

This repository contains both OSS-licensed and non-OSS-licensed files.

All files in or under any directory named "plus" fall under LICENSE.plus.

The remaining files fall under the MIT license.
