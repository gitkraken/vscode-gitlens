# GitLens &mdash; Supercharge Git in <!-- #vscode -->VS Code<!-- /#vscode: Your Editor -->

> Understand any line of code, keep every branch, worktree, and coding agent in view, and ship cleaner history &mdash; without leaving <!-- #vscode -->VS Code<!-- /#vscode: your editor -->.

[GitLens](https://gitkraken.com/gitlens?utm_source=gitlens-extension&utm_medium=in-app-links&utm_campaign=gitlens-logo-links 'Learn more about GitLens') is an [open-source](https://github.com/gitkraken/vscode-gitlens 'Open GitLens on GitHub') extension built and maintained by GitKraken, and installed more than 51 million times.

Your repository moves faster than it used to. Coding agents open branches, worktrees pile up, and pull requests stack while you're still reading a diff. GitLens pulls all of it into one interactive view &mdash; history, working changes, branches, worktrees, and live agent activity together &mdash; then helps you review it, rebase it, and shape it into commits someone can actually read.

<figure align="center">
  <a title="Watch the GitLens Getting Started video" href="https://www.youtube.com/watch?v=7cy4_M0lH6k">
    <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/get-started-video.png" alt="Watch the GitLens Getting Started video" />
  </a>
</figure>

**[Start your free 14-day Pro trial](https://gitkraken.dev/register?product=gitlens&source=marketing_page&redirect_uri=vscode%3A%2F%2Feamodio.gitlens%2Flogin&flow=gitlens_web&utm_source=gitlens-extension&utm_medium=readme&utm_content=hero)** &mdash; no credit card required.

GitLens Community is free and open-source, forever &mdash; and several Pro features, the Commit Graph among them, are free on public repos.

# Getting Started

1. **Install it** &mdash; search for GitLens in <!-- #vscode -->the Extensions side bar in VS Code<!-- /#vscode: your editor's Extensions side bar -->.
2. **Sign in** &mdash; a [free GitKraken account](https://gitkraken.dev/register?product=gitlens&source=marketing_page&redirect_uri=vscode%3A%2F%2Feamodio.gitlens%2Flogin&flow=gitlens_web&utm_source=gitlens-extension&utm_medium=readme&utm_content=getting-started) opens the Commit Graph on your public repos, and starts your trial if you want it everywhere.
3. **Open the Commit Graph** &mdash; click the **GitLens** icon in the activity bar, and there it is: your history, your working changes, and everything in flight. (`GitLens: Show Commit Graph` works too.)
4. **Connect what you use** &mdash; your Git host and issue tracker for pull requests, issues, and autolinks, then your coding agents for session tracking and the GitKraken MCP.<!-- #vscode -->

💡 Want new features first? Hit `Switch to Pre-Release Version` on the GitLens extension page in VS Code.<!-- /#vscode -->

`Preview` features require a free GitKraken account and may become Pro features in the future. `Experimental` features are on by default but still changing.

# See Everything in One Place &mdash; Commit Graph

Answering "what is actually going on in this repo right now" usually takes a view for branches, another for stashes, a terminal for status, and a browser tab for pull requests. The Commit Graph answers it in one place, and lets you act on the answer. [Learn more](https://gitkraken.com/solutions/commit-graph?utm_source=gitlens-extension&utm_medium=in-app-links)

- **Live state on every row** &mdash; ahead/behind, unpushed, unpulled, change size, and lanes you can fold away.
- **Your uncommitted work, in the history** &mdash; a row per worktree. Stage, commit, stash, or send it to _Compose Commits_.
- **Act from the row** &mdash; branch, merge, rebase, cherry-pick, revert, stash, push, pull, open a pull request.
- **Details in place** &mdash; commits, branches, stashes, pull requests, comparisons. They stack as sheets; `Esc` backs out.
- **The whole repo in the side bar** &mdash; Overview, Agents, Pull Requests, Worktrees, Branches, Remotes, Stashes, Tags. Click one to scope the graph.
- **Search that speaks Git** &mdash; `message:`, `author:`, `file:`, `change:`, or just describe what you're after.
- **Always know where you are** &mdash; jump to `HEAD`, upstream, or merge target. `/` finds any branch; the keyboard drives all of it.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commit-graph-preview.png" alt="The GitLens Commit Graph" />
</figure>

# Zoom Out and Spot the Patterns &mdash; Visualizations

Who should I ask about this file? Where is all the churn? What has that agent actually been touching? A list of commits can't tell you.

- **Visual History** &mdash; a timeline of how a file or a repository evolved: when changes landed, how big they were, who made them. Good for finding the moment something turned, or who to ask about it.
- **Files Treemap** `Experimental` &mdash; your repository as blocks sized by file and colored by type. Zoom into a folder to see what's actually in there.
- **Commits Treemap** `Experimental` &mdash; the same map, colored by how much each area has been changing.
- **Agent Activity Treemap** `Experimental` &mdash; the same map, live: where your agents are reading and editing right now, cooling as they move on.

Open these from the Commit Graph, or _Visual History_ on its own with `Show Visual History`.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/visual-history-preview.png" alt="Visual History for a repository" />
</figure>

# Work in Parallel &mdash; Worktrees and Agents

You stash to switch branches and lose your place. An agent is off working somewhere and you can't tell whether it's running, stuck, or waiting on you. Both get worse the more places your work lives.

## Worktrees Without Losing Track

A worktree is a second checkout of the same repository &mdash; a branch you can leave open without stashing a thing. GitLens takes over the bookkeeping around it.

- Create one from a branch, a commit, or a pull request, and open it in this window or a new one.
- Every worktree gets its own working-changes row in the Commit Graph, so you can see which are dirty without opening them.
- Move work across them &mdash; copy your working changes over, or apply a stash into another worktree.
- Open a terminal in one, reveal it in your file manager, or delete it when you're done.

## Know What Your Agents Are Doing

- **Agent sessions** &mdash; Claude Code sessions show up in the Commit Graph with live state: working, idle, or needs input. Resume one straight from the row it's working on.
- **Start Work with Agent** &mdash; pick an issue and GitLens creates the branch or worktree, then hands it to a coding agent.
- **Agent Kanban** `Experimental` &mdash; switch the Graph into a board view that groups agent sessions by what needs your attention first.
- **Terminal links** &mdash; your agent prints a SHA, branch, tag, or range in the terminal. Click it and land on it in the Commit Graph.
- **GitKraken MCP** &mdash; give your coding agents structured access to your Git history, pull requests, and issues. Install it into Claude Code, Codex, Gemini CLI, GitHub Copilot CLI, OpenCode, or your IDE's built-in chat.

<figure align="center">
  <img src="https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/agent-status-preview.png" alt="Agent status showing permission prompt" />
</figure>

# Keep Pull Requests Moving

Pull requests are where work goes to wait. GitLens brings the whole round trip into the editor: **Start Work** turns an issue into a branch or worktree, Launchpad tracks what comes back, and you review and land it without leaving the graph.

## Launchpad &mdash; Triage What's Waiting on You

Reviews shouldn't mean bouncing between your editor, GitHub, and your inbox. Launchpad puts every pull request you're involved in on one list, ordered by what's actually blocking someone. Check one out, or start its review with a coding agent, without opening a tab. [Learn more](https://gitkraken.com/solutions/launchpad?utm_source=gitlens-extension&utm_medium=in-app-links)

## Open, Review, and Merge in Place

Open pull requests live in the Graph's _Pull Requests_ panel, most recently updated first, marked with the same signals as Launchpad &mdash; mergeable, blocked, needs review, follow-up. Select one and its details open in place.

- **Review it here** &mdash; _Compare Changes_ for the diff, or hand the whole thing to a coding agent with _Review with Agent..._
- **Work on it** &mdash; switch to the branch, open it in a worktree, or _Focus_ the graph on just that branch, fetching the remote if you don't have it yet.
- **Land it** &mdash; merge, squash, or rebase from a split button that confirms in place.
- **Stacked pull requests** &mdash; GitHub stacks are grouped in the panel with each layer's position badged on its ref pills. Focusing any layer scopes the graph to the whole stack, and merging routes through GitHub's stack-aware merge, telling you how many pull requests will land.

# Less Time Between Done and Merged &mdash; AI Review, Compose, and Rebase

Code that works isn't code that's merged. In between sit the commits nobody can follow, the message you have to write, the review round trip, and the afternoon the rebase ate. These shorten that stretch.

- **Review Changes** &mdash; a review before you open the pull request, reading your change as a whole instead of file by file. Hand the findings to a coding agent and it makes the fixes.
- **Compose Commits** &mdash; you've changed thirty things across a dozen files and it's one shapeless pile. Compose sorts it into separate commits that each do one thing. **Recompose Commits** does the same for a branch you've already committed to.
- **Explain Changes** &mdash; ask what a commit, a stash, a branch, or your own working changes actually did, in plain English.
- **Generate Commit Message** &mdash; and stash messages, and pull request titles and descriptions, written from what actually changed rather than from a blank box.
- **Generate Changelog** &mdash; release notes for a branch, a tag, or any range of commits you've compared.

## Rebase Without the Dread

Rebasing replays your commits onto a newer starting point. Rearranging them is the easy half. The conflicts are the part you're actually afraid of, and the reason the branch sat there for a week.

The **Interactive Rebase Editor** lets you drag commits to reorder them, or mark them to be squashed together, reworded, or dropped. As you rearrange, it works out which commits are going to conflict and warns you before you run anything, then collects every conflicted file into one panel showing both sides.

**Automatic Rebase** does the whole thing for you. It runs the rebase, resolves each conflict with AI, and shows you what it decided and how sure it was &mdash; stopping to ask when it isn't confident. If you don't like where it ended up, a single undo puts your branch back exactly as it was.

# Integrations

Whatever you host on and track issues in, GitLens most likely speaks it &mdash; and pulls those pull requests and issues in beside your history.

Autolinking works across GitHub, GitLab, Jira, Gitea, Gerrit, Google Source, Bitbucket, Bitbucket Server, Azure DevOps, and custom servers. The self-managed editions, GitHub Enterprise and GitLab Self-Managed, need Pro. Rich integrations with GitHub, GitLab, and Jira add hover details for autolinks, correlations between pull requests, branches, and commits, and user avatars.

On an unusual domain? Add a custom remote to map it onto a built-in provider, or teach GitLens a service it doesn't know. You can define your own autolinks too, for references like Jira issues or Zendesk tickets.

# Blame, Hovers, and CodeLens

Everything GitLens built its reputation on: free, unchanged, and on by default.

- **Inline and status bar blame** &mdash; unobtrusive, line-by-line authorship at the end of the current line and in the status bar.
- **Rich hovers** &mdash; hover a blame annotation for commit details, linked issues and pull requests, and quick actions.
- **Git CodeLens** &mdash; recent change and authorship summaries at the top of each file and code block.
- **File annotations** &mdash; whole-file blame, recent changes, and a heatmap, rendered right in the editor.
- **Revision navigation** &mdash; step backward and forward through a file's history, one click at a time.
- **File History and Line History** &mdash; follow a whole file or a single line across renames and merges.
- **Git Command Palette** &mdash; a guided, step-by-step way to run Git commands without memorizing them, plus quick access to branch and file history, commit search, stashes, and repository status.

💡 Not for you? Every annotation is customizable, and `Toggle Line Blame` and `Toggle Git CodeLens` switch them off. The [Help Center](https://help.gitkraken.com/gitlens/gitlens-home/) has the full list of settings.

# Browse and Compare Anything &mdash; Side Bar Views

Every part of your repository gets its own view, and they act as well as list. Most share one tabbed **GitLens** view in Source Control, so they sit a click apart instead of as eight collapsed headers fighting for room.

- **Commits, Branches, Remotes, Stashes, Tags, Worktrees, and Contributors** &mdash; browse any of them and act on what you find: check out, compare, stash, create a worktree, see who wrote what.
- **Search & Compare** &mdash; search history, or compare any two branches, tags, or commits, and keep the results pinned as long as you need them.
- **Inspect** and **Pull Request** &mdash; full details for whatever you've selected, and the pull request for the branch you're on.
- **Repositories** &mdash; the same, grouped per repository, for multi-root workspaces.

💡 _Detach View_ pulls a tab out on its own, _Detach All Views_ splits them all up, and _Set as Default View_ picks which opens first. `Reset Views Layout` puts everything back.

# Sharing and Collaboration `Preview`

**Cloud Patches** share work-in-progress, a commit, or a stash as a private link, and **Cloud Workspaces** group repositories together across machines. Both views are hidden by default &mdash; open them with `Show Cloud Patches View` or `Show Cloud Workspaces View`.

# GitLens Community and GitLens Pro

**Community** is free and open-source: blame, hovers, CodeLens, file annotations, revision navigation, the side bar views, the Interactive Rebase Editor, the Git Command Palette, integrations, and the GitKraken MCP.

**On public repos**, the Commit Graph, Worktrees, and Visual History are free too &mdash; the Commit Graph just needs a free GitKraken account.

**Pro** opens those on private repos and adds the rest: agent sessions and Agent Kanban, the Pull Requests panel with in-graph review and merge, Launchpad, and every AI feature on this page.

**[Start your free 14-day Pro trial](https://gitkraken.dev/register?product=gitlens&source=marketing_page&redirect_uri=vscode%3A%2F%2Feamodio.gitlens%2Flogin&flow=gitlens_web&utm_source=gitlens-extension&utm_medium=readme&utm_content=editions)** &mdash; no credit card, and when it ends your public repos keep everything they had. Or read the full [Community vs. Pro comparison](https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/?utm_source=gitlens-extension&utm_medium=in-app-links&utm_campaign=readme&utm_term=ready-for-gitlens-pro).

# Support and Community

Support documentation can be found on the [GitLens Help Center](https://help.gitkraken.com/gitlens/gitlens-home/). If you need further assistance or have any questions, there are various support channels and community forums available:

- **Issues and feature requests** &mdash; reach out on our [GitHub Issues page](https://github.com/gitkraken/vscode-gitlens/issues).
- **Discussions** &mdash; connect with other users and talk to our engineering team on [GitHub Discussions](https://github.com/gitkraken/vscode-gitlens/discussions).
- **GitKraken Support** &mdash; for anything else, reach the support team via the [official support page](https://support.gitkraken.com/). GitLens Pro includes priority email support, plus custom onboarding and training to get your team up and running.

Having a positive experience with GitLens? <!-- #vscode -->[Write a review](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens&ssr=false#review-details)<!-- /#vscode: [Write a review](https://open-vsx.org/extension/eamodio/gitlens/reviews) --> &mdash; it genuinely helps.

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
- Daniel Asher ([@danielasher115](https://github.com/danielasher115)) &mdash; [contributions](https://github.com/gitkraken/vscode-gitlens/commits?author=danielasher115)

Also special thanks to the people that have provided support, testing, brainstorming, etc:

- Brian Canzanella ([@bcanzanella](https://github.com/bcanzanella))
- Matt King ([@KattMingMing](https://github.com/KattMingMing))

And of course the awesome [vscode](https://github.com/Microsoft/vscode/graphs/contributors) team!

# License

This repository contains both OSS-licensed and non-OSS-licensed files.

All files in or under any directory named "plus" fall under LICENSE.plus.

The remaining files fall under the MIT license.
