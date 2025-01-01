# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

### Added

- Adds go to home view button to the commit graph title section &mdash; closes [#3873](https://github.com/gitkraken/vscode-gitlens/issues/3873)
- Adds a _Contributors_ section to comparison results in the views

### Fixed

- Fixes [#3888](https://github.com/gitkraken/vscode-gitlens/issues/#3888) - Graph hover should disappear when right-clicking a row

## [16.1.1] - 2024-12-20

### Added

- Adds action to the launchpad status on PR's on _Home_ to open the _Launchpad_ directly to the item

### Changed

- Improves draft PR handling and launchpad grouping

### Fixed

- Fixes [#3899](https://github.com/gitkraken/vscode-gitlens/issues/#3899) - custom autolinks not being detected
- Fixes owner avatars from getting lost (progressively) on refresh of the _Home_ view
- Fixes launchpad status icon for 'waiting for review' state on _Home_
- Fixes missing _Delete Branch..._ command from branches on worktrees in the _Branches_ view

## [16.1.0] - 2024-12-19

### Added

- Remodels and polishes the _Home_ view:
  - Adds a new header bar with information, controls, and management for your account and integrations
  - Branch cards are now grouped, expandable sets which include information on the branch, its associated pull requests and issues
  - Adds "merge target" status to the active branch
    - Includes the status of the branch relative to the branch that it is most likely to be merged into (its "merge target")
    - Includes pre-emptive conflict detection with the merge target and _Merge_ and _Rebase_ actions
  - Adds merge and rebase status to the active branch while in a merge or rebase
  - Adds a _Commit_ action which automatically generates a commit message and focuses the SCM commit box
  - Integrates Launchpad status directly into pull requests and adds colored indicators reflecting Launchpad statuses: "Mergeable", "Blocked", and "Needs Attention"
  - Adds upstream status information to branch cards
  - Adds more pull request actions:
    - _Open Pull Request Changes_ which opens a pull request's changes in a multidiff editor tab
    - _Compare Pull Request_ which opens a pull request in the _Search & Compare_ view
    - _Open Pull Request Details_ which opens a pull request in the _Pull Request_ view
  - Adds the ability to share your working changes with teammates
  - Increases the prominence of the "branch owner's" avatar
    - The "branch owner" is the person who contributed the most changes across the commits between the branch's HEAD and branching point
  - Adds contextual tooltips throughout
- Adds pre-emptive conflict detection to _Merge_ and _Rebase_ git commands
- Adds the ability to show stashes in the _Commits_, _Branches_ and _Worktrees_ views &mdash; off by default, can be toggled in the _View Options_ context menu of each view
- Adds the ability to show remote branches (for the default remote) in the _Branches_ view &mdash; off by default, can be toggled in the _View Options_ context menu of each view
- Adds the ability to associate issues with branches &mdash; closes [#3870](https://github.com/gitkraken/vscode-gitlens/issues/3870)
  - Shows issues associated with branches in _Home_ view &mdash; closes [#3806](https://github.com/gitkraken/vscode-gitlens/issues/3806)
  - Shows issues associated with branches in the _Commit Graph_
  - Adds a new command _Associate Issue with Branch..._ command to the command palette and to the context menus of branches in views and the _Commit Graph_ allowing the user to associate an issue with an existing branch &mdash; closes [#3884](https://github.com/gitkraken/vscode-gitlens/issues/3884)
  - Associates issues chosen in the _Start Work_ command with branches created for them
- Adds the ability to get autolinks for branches via the branch name &mdash; closes [#3547](https://github.com/gitkraken/vscode-gitlens/issues/3547)
- Adds GitLab issues to the issues list in the _Start Work_ command when GitLab is connected &mdash; closes [#3779](https://github.com/gitkraken/vscode-gitlens/issues/3779)
- Adds the latest Gemini models to AI features
- Adds support for deep links to the _Home_ view
- Adds `gitlens.advanced.caching.gitPath` setting to specify whether to cache the git path &mdash; closes [#2877](https://github.com/gitkraken/vscode-gitlens/issues/2877)

### Changed

- Improves the _Launchpad_ search experience &mdash; closes [#3855](https://github.com/gitkraken/vscode-gitlens/issues/3855):
  - Adds a _Search for Pull Request..._ option that allows the user to search for pull requests outside of the listed ones in _Launchpad_. Currently supports GitHub pull requests, with GitLab soon to be added.
  - Pasting a pull request URL which does not match any listed _Launchpad_ issues will automatically trigger a GitHub search for the pull request
  - When in provider search mode, adds a _Cancel Searching_ option which will restore the original list of pull requests. Clearing the search input will automatically cancel the search.
- Improves the _Start Work_ flow and user experience &mdash; closes [#3807](https://github.com/gitkraken/vscode-gitlens/issues/3807):
  - Splits the _Start Work_ button into two buttons, a _Start Work on an Issue_ button for creating a branch from an issue, and a button for creating a branch without an associated issue &mdash; closes [#3808](https://github.com/gitkraken/vscode-gitlens/issues/3808)
  - Updates the command flow so that an issue is selected first, and the option to create a worktree is presented after creating the branch &mdash; closes [#3809](https://github.com/gitkraken/vscode-gitlens/issues/3809)
  - Adds an integration connection button to the title bar &mdash; closes [#3832](https://github.com/gitkraken/vscode-gitlens/issues/3832)
  - Adds a quickpick option to connect additional integrations when no issues are found &mdash; closes [#3833](https://github.com/gitkraken/vscode-gitlens/issues/3833)
  - Rewords the placeholder text for better clarity when choosing a base for the new branch &mdash; closes [#3834](https://github.com/gitkraken/vscode-gitlens/issues/3834)
  - Adds hover tooltip on issues showing their descriptions
  - Improves tooltips on "Open in Remote" icon
- Refines commit/file stats formatting and improves coloring and formatting in tooltips
- Moves the _Commit Graph_ filter commits toggle into the left of the search bar
- Improves the responsiveness of the _Worktrees_ view to changes in relevant state
- Improves the HEAD indicator icon to align more with VS Code
- Updates prep-release reference &mdash; thanks to [PR #3732](https://github.com/gitkraken/vscode-gitlens/pull/3732) by Emmanuel Ferdman ([@emmanuel-ferdman](https://github.com/emmanuel-ferdman))

### Fixed

- Fixes [#3747](https://github.com/gitkraken/vscode-gitlens/issues/3747) - _Rebase Current Branch onto Branch_ incorrectly shows that the current branch is caught up to the destination
- Fixes [#3836](https://github.com/gitkraken/vscode-gitlens/issues/3836) - Back button in _Start Work_ goes to the wrong step
- Fixes [#3791](https://github.com/gitkraken/vscode-gitlens/issues/3791) - Pin/snooze in Launchpad trigger a full refresh and are no longer optimistic
- Fixes [#3886](https://github.com/gitkraken/vscode-gitlens/issues/3886) - Jira orgs/projects accumulating size in global storage
- Fixes [#3849](https://github.com/gitkraken/vscode-gitlens/issues/3849) - _Launchpad_ view state does not sync properly when connecting/disconnecting integrations
- Fixes some cases where issues are not properly restricted to open repositories in _Start Work_
- Fixes issue bodies missing on Jira issue items in _Start Work_
- Fixes some Jira issues missing in _Start Work_
- Fixes Jira integration failing to fetch issues for all organizations when there is an issue with one of the organizations
- Fixes duplicate generic autolinks appearing in _Commit Details_ when the enriched version is shown
- Fixes the worktree icon in the _Commit Graph_
- Fixes hovers in the _Commit Graph_ to correctly show branch/tag tips and additions/deletions when the _Changes_ column is enabled
- Fixes incorrect subscription label in the _Account_ section when signed out

## [16.0.4] - 2024-11-25

### Changed

- Reduces the size of the _Commit Graph_ webview bundle which reduces memory usage and improves startup time &mdash; ~29% smaller (861KB -> 1209KB)

### Fixed

- Fixes [#3794](https://github.com/gitkraken/vscode-gitlens/issues/3794) - Interactive rebase on the same branch is not working

## [16.0.3] - 2024-11-22

### Changed

- Improves actions and workflows on the new _Home_ view
- Improves the "Start Work" experience

## [16.0.2] - 2024-11-18

### Changed

- Changes to expand the _GitLens_ view after upgrading (one time)

## [16.0.1] - 2024-11-15

### Added

- Adds context menu command in _Commit Graph_ to reset Current Branch to a tag.

### Changed

- Changes the _Search & Compare_ view to be separate (detached) from the new grouped _GitLens_ view

### Fixed

- Fixes Home's Recent section being hidden when there are no recent items

## [16.0.0] - 2024-11-14

### Added

- Adds the ability to group GitLens views into a single _GitLens_ view in the Source Control sidebar
  - Includes Commits, Branches, Remotes, Stashes, Tags, Worktrees, Contributors, Repositories, Search & Compare, and Launchpad views
  - Switch views by clicking on the specific view icons in the grouped _GitLens_ view header
  - Grouped views can be separated (detached) from the grouped _GitLens_ view via context menu commands from the view header
  - Detached views can be regrouped by clicking the close (`x`) icon in the view header
  - Adds a new `gitlens.views.scm.grouped.default` setting to specify the default view to show in the grouped _GitLens_ view on new workspaces/folders (otherwise the last selected view is remembered)
  - Adds a new `gitlens.views.scm.grouped.views` setting to specify which views to show in the grouped _GitLens_ view
- Adds a completely reimagined Home view
  - Active section:
    - Shows your current repository, branch, and repository state
    - Actions for syncing (push, pull, fetch), switching repos/branches, and viewing working directory changes
  - Launchpad section:
    - Shows pull requests that need your review, are blocked, or are ready to merge
    - Start work action to begin a new branch or worktree, or generate one from an existing issue
  - Recent section: return to previous work by showing recent branches, worktrees, and PRs with activity for your chosen timeframe
- Adds _Start Work_ command that opens a quick pick to initiate different flows for starting new work &mdash; closes [#3621](https://github.com/gitkraken/vscode-gitlens/issues/3621)
  - Start from an issue from GitHub or Jira (other integrations coming soon) and create a branch and/or worktree
- Adds new ability to search for a GitHub PR in the _Launchpad_ &mdash; closes [#3543](https://github.com/gitkraken/vscode-gitlens/issues/3543), [#3684](https://github.com/gitkraken/vscode-gitlens/issues/3684)
- Adds a new _Filter Commits_ button to the Commit Graph toolbar &mdash; closes [#3686](https://github.com/gitkraken/vscode-gitlens/issues/3686)
  - When toggled while searching the graph, it will be filtered to show only commits matching the search query
- Adds and expands AI support for GitLens' AI features, now out of experimental and in preview
  - Refines and improves commit message generation and explaining changes, through better prompting and context
  - Adds new model support from GitHub Copilot when installed — no api key needed
  - Adds the latest OpenAI and Claude models
  - Adds new models from xAI, GitHub Models, and HuggingFace
- Adds a new _Launchpad_ view, now out of experimental mode &mdash; closes [#3615](https://github.com/gitkraken/vscode-gitlens/issues/3615):
  - Remembers the collapsed/expanded state of groups and auto-expands the _Current Branch_ group & item, if applicable
  - Reflects changes better, including pinning and snoozing items
  - Pinned items should now appear above non-pinned items in their respective groups
- Adds new all-new onboarding walkthrough &mdash; closes [#3656](https://github.com/gitkraken/vscode-gitlens/issues/3656)
- Adds new deep links to certain GitLens features and views &mdash; closes [#3679](https://github.com/gitkraken/vscode-gitlens/issues/3679)
  - Adds support for deep links to the GitLens walkthrough &mdash; closes [#3677](https://github.com/gitkraken/vscode-gitlens/issues/3677)
  - Adds support for deep links to _Launchpad_ &mdash; closes [#3678](https://github.com/gitkraken/vscode-gitlens/issues/3678)
  - Adds support for deep links to the _Commit Graph_, _Worktrees_, _Inspect_, and _Cloud Patches_ &mdash; closes [#3703](https://github.com/gitkraken/vscode-gitlens/issues/3703)
- Adds _Copy Changes (Patch)_ command to the context menu of branch comparisons and their files in the _Commits_, _Branches_, and _Remotes_ views
- Adds an _Upgrade_ and _Switch to Release Version_ to the expiration notification when using the pre-release of GitLens

### Changed

- Changes the, no account, 3-day preview experience of GitLens Pro to be 3 non-consecutive days on the _Commit Graph_
- Changes the GitLens Pro 7-day trial to be 14 days, and 30 days if you invite a teamate
- Improves _Launchpad_ & the _Launchpad_ view &mdash; closes [#3614](https://github.com/gitkraken/vscode-gitlens/issues/3614):
  - Adds _Pin_ and _Snooze_ buttons to the header item in the action step
  - Draft pull requests for which the current user's review is needed are now also shown in the "Needs Your Review" group, with a draft icon
  - Renames _Switch to Branch or Worktree_ option to _Switch to Branch_, since it already includes options to create a worktree in the action flow
- Improves the open in worktree action flow &mdash; closes [#3549](https://github.com/gitkraken/vscode-gitlens/issues/3549):
- Changes to open a multi-diff editor of the changes when opening a new worktree from a PR to make reviewing easier &mdash; [#3734](https://github.com/gitkraken/vscode-gitlens/issues/3734)
- Improves the _Explain_ panel in _Inspect_ and _Graph Details_ with markdown formatting
- Changes how GitLens handles creating and deleting tags to avoid using the terminal &mdash; [#3670](https://github.com/gitkraken/vscode-gitlens/issues/3670)
- Improves quick pick workflows when no repositories are open
- Renames _GK Workspaces_ (GitKraken Workspaces) to _Cloud Workspaces_
- Improves revealing items in the GitLens views
- Limits buffering during logging to reduce memory usage

### Fixed

- Fixes [#3549](https://github.com/gitkraken/vscode-gitlens/issues/3549) - Webviews can have issues with high contrast themes
- Fixes [#3133](https://github.com/gitkraken/vscode-gitlens/issues/3133) - Infinite error loop when pushing stash from GUI
- Fixes branch creation and switch quickpicks failing to close when a worktree is created during the flow
- Fixes some cases where Launchpad can fail to detect a connected integration
- Fixed issues with renamed file status on comparisons and pull requests and ensures that renamed files get returned in file status and revision content git operations
- Fixes issues with failing to delete stored state
- Fixes issues with logging on some failure cases
- Fixes issues with log scope tracking

### Removed

- Removes the GitLens Welcome view in favor of the new onboarding walkthrough experience

## [15.6.3] - 2024-11-05

## [15.6.2] - 2024-10-17

### Fixed

- Fixes [#3680](https://github.com/gitkraken/vscode-gitlens/issues/3680) - GitLens Settings page (via _GitLens: Open Settings_) has double-encoded Html entities
- Fixes popover menu background colors on the Commit Graph
- Fixes [#3646](https://github.com/gitkraken/vscode-gitlens/issues/3646) - Interactive Rebase interface partially unreadable in high contrast dark color theme

## [15.6.1] - 2024-10-14

### Fixed

- Fixes [#3650](https://github.com/gitkraken/vscode-gitlens/issues/3650) - "Create & Switch to Local Branch" from remote branch no longer prefills local branch name to match remote branch name
- Fixes [#3651](https://github.com/gitkraken/vscode-gitlens/issues/3651) - "Open on Remote (Web)" does not use tracked branch name
- Fixes [#3657](https://github.com/gitkraken/vscode-gitlens/issues/3657) - Creating a worktree from within a worktree chooses the wrong path
- Fixes [#3090](https://github.com/gitkraken/vscode-gitlens/issues/3090) - Manually created empty bare clone repositories in a trusted directory crash worktree view since LocalGitProvider.findRepositoryUri returns just ".git" &mdash; thanks to [PR #3092](https://github.com/gitkraken/vscode-gitlens/pull/3092) by Dawn Hwang ([@hwangh95](https://github.com/hwangh95))
- Fixes [#3667](https://github.com/gitkraken/vscode-gitlens/issues/3667) - Makes Launchpad search by repo name
- Fixes failure to prompt to delete the branch after deleting a worktree when a modal was shown (e.g. when prompting for force)
- Fixes issues when git fails to delete the worktree folder on Windows

## [15.6.0] - 2024-10-07

### Added

- Adds [Cursor](https://cursor.so) support &mdash; closes [#3222](https://github.com/gitkraken/vscode-gitlens/issues/3222)
- Adds monospace formatting in commit messages &mdash; closes [#2350](https://github.com/gitkraken/vscode-gitlens/issues/2350)
- Adds a new `${authorFirst}` and `${authorLast}` commit formatting tokens that can be used in inline blame, commit hovers, etc &mdash; closes [#2980](https://github.com/gitkraken/vscode-gitlens/issues/2980)
- Adds a new _Create New Branch_ button to the _Commit Graph_ toolbar &mdash; closes [#3553](https://github.com/gitkraken/vscode-gitlens/issues/3553)
- Adds new ability to force push from the _Commit Graph_ toolbar &mdash; closes [#3493](https://github.com/gitkraken/vscode-gitlens/issues/3493)
- Adds a new `gitlens.launchpad.includedOrganizations` setting to specify which organizations to include in _Launchpad_ &mdash; closes [#3550](https://github.com/gitkraken/vscode-gitlens/issues/3550)
- Adds repository owner/name and code suggest to hovers on the experimental Launchpad view

### Changed

- Integrates the _GitKraken Account_ view into the bottom of the _Home_ view as a collapsible section &mdash; closes [#3536](https://github.com/gitkraken/vscode-gitlens/issues/3536)
- Changes the new _Commit Graph_ sidebar to be enabled by default; use the `gitlens.graph.sidebar.enabled` settings to disable it
- Changes how GitLens handles creating and renaming branches to avoid using the terminal &mdash; refs [#3528](https://github.com/gitkraken/vscode-gitlens/issues/3528)
- Changes patch generation (e.g. cloud patches, code suggest, _Copy as Patch_, _Copy WorkingChanges to Worktree..._, etc) to automatically include untracked files
- Improves _Switch_, _Open in Worktree_, and deeplink and Launchpad workflows
  - Reduces prompts for locating repositories which the user has previously opened &mdash; closes [#3555](https://github.com/gitkraken/vscode-gitlens/issues/3555)
  - Improves automatic detection of matching repositories for pull requests &mdash; closes [#3627](https://github.com/gitkraken/vscode-gitlens/issues/3627)
  - Automatically fetches the repository when needed rather than prompting the user
- Improves the integration connection indicator and connection button on the _Commit Graph_ &mdash; closes [#3538](https://github.com/gitkraken/vscode-gitlens/issues/3538)

### Fixed

- Fixes [#3548](https://github.com/gitkraken/vscode-gitlens/issues/3548) - Change the current branch icon on the Commit Graph to a worktree icon if its on a worktree
- Fixes [#3592](https://github.com/gitkraken/vscode-gitlens/issues/3592) - Connecting to an integration via Remotes view (but likely others) doesn't work
- Fixes [#3571](https://github.com/gitkraken/vscode-gitlens/issues/3571) - Gitlens fails to register buttons on top-right corner &mdash; thanks to [PR #3605](https://github.com/gitkraken/vscode-gitlens/pull/3605) by Jean Pierre ([@jeanp413](https://github.com/jeanp413))
- Fixes [#3617](https://github.com/gitkraken/vscode-gitlens/issues/3617) - Auto-links not working for alphanumberic issue numbers
- Fixes [#3573](https://github.com/gitkraken/vscode-gitlens/issues/3573) - 'Create Branch in Worktree' option in 'Create Branch' shows a repo picker if you have multiple repos open
- Fixes [#3612](https://github.com/gitkraken/vscode-gitlens/issues/3612) - Prevents cloud integration sync process from opening gkdev connect page/flow
- Fixes [#3519](https://github.com/gitkraken/vscode-gitlens/issues/3519) - Add fallback/cutoff to our backend calls similar to how we handle GitHub queries
- Fixes [#3608](https://github.com/gitkraken/vscode-gitlens/issues/3608) - Integration connection page opening on every launch of VS Code and on profile change
- Fixes [#3618](https://github.com/gitkraken/vscode-gitlens/issues/3618) -Reauthentication not working for cloud integrations
- Fixes an issue where virtual repositories for GitHub PRs from forks wouldn't load properly
- Fixes an issue where deleting a worktree would not always remove the worktree from the view
- Fixes actions not working on Launchpad items with special characters in their branch name
- Fixes _Open in Worktree_ command sometimes showing an unnecessary worktree confirmation step
- Fixes some instances where the progress notification lingers after canceling when connecting an integration

### Engineering

- Adds end-to-end testing infrastructure using [Playwright](https://playwright.dev)
- Adds vscode-test to run unit-tests &mdash; closes [#3570](https://github.com/gitkraken/vscode-gitlens/issues/3570)

## [15.5.1] - 2024-09-16

### Fixed

- Fixes [#3582](https://github.com/gitkraken/vscode-gitlens/issues/3582) - "Delete Branch" option is sometimes unexpectedly missing

## [15.5.0] - 2024-09-12

### Added

- Adds a `gitlens.views.showCurrentBranchOnTop` setting to specify whether the current branch is shown at the top of the views &mdash; closes [#3520](https://github.com/gitkraken/vscode-gitlens/issues/3520)
- Adds a sidebar to the _Commit Graph_
  - Shows counts of branches, remotes, stashes, tags, and worktrees
  - Clicking an item reveals its corresponding view
  - Try out this new feature by setting `gitlens.graph.sidebar.enabled` to `true`

### Changed

- Preview access of Launchpad is ending on September 27th
- Simplifies the _Create Worktree_ command flow by prompting to create a new branch only when necessary &mdash; closes [#3542](https://github.com/gitkraken/vscode-gitlens/issues/3542)
- Removes the use of VS Code Authentication API for GitKraken accounts

### Fixed

- Fixes [#3514](https://github.com/gitkraken/vscode-gitlens/issues/3514) - Attempting to delete the main worktree's branch causes a invalid prompt to delete the main worktree
- Fixes [#3518](https://github.com/gitkraken/vscode-gitlens/issues/3518) - Branches in worktrees are no longer collapsed into folder groupings

### Removed

- Removes (disables) legacy "focus" editor

## [15.4.0] - 2024-09-04

### Added

- Adds better support for branches in worktrees
  - Changes the branch icon to a "repo" icon when the branch is in a worktree in views, quick pick menus, and the _Commit Graph_
  - Adds an _Open in Worktree_ inline and context menu command and an _Open in Worktree in New Window_ context menu command to branches and pull requests in views and on the _Commit Graph_
  - Removes the _Switch to Branch..._ inline and context menu command from branches in views and on the _Commit Graph_ when the branch is in a worktree
- Adds ability to only search stashes when using `type:stash` (or `is:stash`) in commit search via the _Commit Graph_, _Search & Compare_ view, or the _Search Commits_ command
- Adds `...` inline command for stashes on the _GitLens Inspect_ view
- Adds an "up-to-date" indicator dot to the branch icon of branches in views
- Adds an "alt" _Pull_ command for the inline _Fetch_ command on branches in views
- Adds an "alt" _Fetch_ command for the inline _Pull_ command on branches in views
- Adds _Open Comparison on Remote_ command to branch comparisons in views
- Adds new options to the _Git Delete Worktree_ command to also delete the associated branch along with the worktree

### Changed

- Improves the branch comparisons in views to automatically select the base or target branch
- Improves tooltips on branches, remotes, and worktrees in views
- _Upgrade to Pro_ flows now support redirects back to GitLens

### Fixed

- Fixes [#3479](https://github.com/gitkraken/vscode-gitlens/issues/3479) - Tooltip flickering
- Fixes [#3472](https://github.com/gitkraken/vscode-gitlens/issues/3472) - "Compare working tree with.." often flashes open then closes the menu
- Fixes [#3448](https://github.com/gitkraken/vscode-gitlens/issues/3448) - "Select for Compare" on a Commit/Stash/etc causes the Search and Compare view to be forcibly shown
- Fixes the _Git Delete Branch_ command when deleting a branch that is open on a worktree by adding a step to delete the branch's worktree first
- Fixes an issue where pull requests in views could show the wrong comparison with the working tree when using worktrees
- Fixes _Copy Remote Comparison URL_ command to not open the URL, just copy it
- Fixes cloud integrations remaining disconnected after disconnecting and reconnecting to a GitKraken account
- Fixes "switch" deep links sometimes failing to complete in cases where the switch occurs in the current window

### Removed

- Removes status (ahead, behind, etc) decoration icons from branches in views

## [15.3.1] - 2024-08-21

### Added

- Adds DevEx Days promotion

### Changed

- Improves upgrade/purchase flow

## [15.3.0] - 2024-08-15

### Added

- Adds improvements and enhancements to _Launchpad_ to make it easier to manage and review pull requests
  - Adds GitLab (cloud-only for now) support to show and manage merge requests in _Launchpad_
  - Adds a new _Connect Additional Integrations_ button to the _Launchpad_ titlebar to allow connecting additional integrations (GitHub and GitLab currently)
  - Adds an new experimental _Launchpad_ view to provide a persistent view of the _Launchpad_ in the sidebar
    - To try it out, run the _Show Launchpad View_ command or set the `gitlens.views.launchpad.enabled` setting to `true` &mdash; let us know what you think!
    - While its functionality is currently limited, pull requests can be expanded to show changes, commits, and code suggestions, as well as actions to open changes in the multi-diff editor, open a comparision, and more
- Adds new features and improvements to the _Commit Graph_
  - Branch visibility options, formerly in the _Graph Filtering_ dropdown, are now moved to the new _Branches Visibility_ dropdown in the _Commit Graph_ header bar
  - Adds a new _Smart Branches_ visibility option to shows only relevant branches &mdash; the current branch, its upstream, and its base or target branch, to help you better focus
  - Improves interactions with hovers on rows &mdash; they should do a better job of staying out of your way
  - Adds pull request information to branches with missing upstreams
- Adds support for GitHub and GitLab cloud integrations &mdash; automatically synced with your GitKraken account
  - Adds an improved, streamlined experience for connecting cloud integrations to GitLens
  - Manage your connected integration via the the _Manage Integrations_ command or the _Integrations_ button on the _GitKraken Account_ view
- Adds comparison support to virtual (GitHub) repositories

### Changed

- Improves the _Compare to/from HEAD_ command (previously _Compare with HEAD_) to compare commits, stashes, and tags with the HEAD commit where directionality is determined by topology and time
- Improves the messaging of the merge and rebase commands
- Renames _Compare with Working Tree_ command to _Compare Working Tree to Here_
- Renames _Compare Common Base with Working Tree_ command to _Compare Working Tree to Common Base_
- Renames _Open Worktree in New Window_ Launchpad command to _Open in Worktree_
- Renames _Open Directory Compare_ command to _Open Directory Comparison_
- Renames _Open Directory Compare with Working Tree_ command to _Directory Compare Working Tree to Here_
- Improves some messaging on _Switch_ and _Checkout_ commands

### Fixed

- Fixes [#3445](https://github.com/gitkraken/vscode-gitlens/issues/3445) - Cannot merge branch into detached HEAD
- Fixes [#3443](https://github.com/gitkraken/vscode-gitlens/issues/3443) - Don't show gitlens context menu items in Copilot Chat codeblock editors
- Fixes [#3457](https://github.com/gitkraken/vscode-gitlens/issues/3457) - Enriched autolink duplication in graph hover (and possibly other places)
- Fixes [#3473](https://github.com/gitkraken/vscode-gitlens/issues/3473) - Plus features can't be restored after they are hidden
- Fixes column resizing being stuck when the mouse leaves the _Commit Graph_
- Fixes issues with incorrect commit count when using the merge and rebase commands
- Fixes issues where a merge or rebase operation says there or no changes when there are changes
- Fixes an error with queries that can cause Jira Cloud and other cloud integrations to stop working
- Fixes issues with some directory comparison commands

## [15.2.3] - 2024-07-26

### Fixed

- Fixes (for real) [#3423](https://github.com/gitkraken/vscode-gitlens/issues/3423) - Blame annotations & revision navigation are missing in 15.2.1 when using remote (WSL, SSH, etc) repositories

## [15.2.2] - 2024-07-26

### Fixed

- Fixes [#3423](https://github.com/gitkraken/vscode-gitlens/issues/3423) - Blame annotations & revision navigation are missing in 15.2.1 when using remote (WSL, SSH, etc) repositories
- Fixes [#3422](https://github.com/gitkraken/vscode-gitlens/issues/3422) - Extra logging
- Fixes [#3406](https://github.com/gitkraken/vscode-gitlens/issues/3406) - Worktrees typo in package.json &mdash; thanks to [PR #3407](https://github.com/gitkraken/vscode-gitlens/pull/3407) by Matthew Yu ([@matthewyu01](https://github.com/matthewyu01))
- Fixes cloud patch creation error on azure repos
- Fixes [#3385](https://github.com/gitkraken/vscode-gitlens/issues/3385) - Provides commit from stash on create patch from stash action
- Fixes [#3414](https://github.com/gitkraken/vscode-gitlens/issues/3414) - Patch creation may be done multiple times

## [15.2.1] - 2024-07-24

### Added

- Adds support for OpenAI's GPT-4o Mini model for GitLens' experimental AI features
- Adds a _Jump to HEAD_ button on the _Commit Graph_ header bar (next to the current branch) to quickly jump to the HEAD commit
  - Adds a _Jump to Reference_ as an `alt` modifier to the _Jump to HEAD_ button to jump to the selected branch or tag
- Adds support deep link documentation &mdash; closes [#3399](https://github.com/gitkraken/vscode-gitlens/issues/3399)
- Adds a pin status icon to Launchpad items when pinned

### Changed

- Changes the "What's new" icon on _Home_ to not conflict with _Launchpad_
- Improves working with worktrees by avoiding showing the root repo in worktrees during certain operations (e.g. rebase) and vice-versa
- Changes how we track open documents to improve performance, reduce UI jumping, and support VS Code's new ability to [show editor commands for all visible editors](https://code.visualstudio.com/updates/v1_90#_always-show-editor-actions) &mdash; closes[#3284](https://github.com/gitkraken/vscode-gitlens/issues/3284)
- Changes GitLab & GitLab self-managed access tokens to now require `api` scope instead of `read_api` to be able to merge Pull Requests
- Renames _Open Worktree in New Window_ option to _Open in Worktree_ in _Launchpad_

### Fixed

- Fixes [#3386](https://github.com/gitkraken/vscode-gitlens/issues/3386) - Clicking anywhere on "Get started" should expand the section &mdash; thanks to [PR #3402](https://github.com/gitkraken/vscode-gitlens/pull/3402) by Nikolay ([@nzaytsev](https://github.com/nzaytsev))
- Fixes [#3410](https://github.com/gitkraken/vscode-gitlens/issues/3410) - Adds stash commit message to commit graph row
- Fixes [#3397](https://github.com/gitkraken/vscode-gitlens/issues/3397) - Suppress auth error notifications for github triggered by Launchpad
- Fixes [#3367](https://github.com/gitkraken/vscode-gitlens/issues/3367) - Continually asked to reauthenticate
- Fixes [#3389](https://github.com/gitkraken/vscode-gitlens/issues/3389) - Unable to pull branch 'xxx' from origin
- Fixes [#3394](https://github.com/gitkraken/vscode-gitlens/issues/3394) - Pull request markers, when set in commit graph minimap or scroll, show as unsupported in settings JSON

## [15.2.0] - 2024-07-10

### Added

- Adds a _Generate Title & Description_ button to the title input in _Create Cloud Patch_ and in _Changes to Suggest_ of the _Inspect Overview_ tab
- Adds support for Anthropic's Claude 3.5 Sonnet model for GitLens' experimental AI features
- Adds a new `counts` option to the `gitlens.launchpad.indicator.label` setting to show the status counts of items which need your attention in the _Launchpad_ status bar indicator
- Adds _Search for Commits within Selection_ command to the editor context menu when there is a selection
- Adds a `gitlens.launchpad.ignoredOrganizations` setting to specify an array of organizations (or users) to ignore in the _Launchpad_
- Improves the tooltips of stashes in GitLens views
  - Adds a `gitlens.views.formats.stashes.tooltip` setting to specify the tooltip format of the stashes in GitLens views
- Improves the display of branch and tag tips in the _File History_ and _Line History_ and in commit tooltips in GitLens views
  - Adds provider-specific icons to tips of remote branches
- Adds Commit Graph improvements:
  - Adds pull request markers to the graph scroll and minimap
  - Adds rich hovers on commit rows which include detailed commit information and links to pull requests, issues, and inspect
- Adds Launchpad improvements:
  - Truncates long titles for Pull Requests so that the repository label is always visible
  - Adds _Open on GitHub_ button to other relevant rows in the action step
  - Adds a new _Open Worktree in New Window_ action and button to Launchpad items to more easily view the item in a worktree

### Changed

- Renames `Reset Stored AI Key` command to `Reset Stored AI Keys...` and adds confirmation prompt with options to reset only the current or all AI keys
- Renames _Open Inspect_ to _Inspect Commit Details_
- Renames _Open Line Inspect_ to _Inspect Line Commit Details_
- Renames _Open Details_ to _Inspect Commit Details_
- Replaces _Open in Editor_ link in the Launchpad with a link to _gitkraken.dev_
- The _Manage Account_ button in the GitKraken Account view and the _GitLens: Manage Your Account_ command now use the account management page at _gitkraken.dev_
- Fixes some cases where worktree state can be out-of-date after creation/deletion of a worktree

### Fixed

- Fixes [#3344](https://github.com/gitkraken/vscode-gitlens/issues/3344) - Make changing the AI key easier
- Fixes [#3377](https://github.com/gitkraken/vscode-gitlens/issues/3377) - Cannot read properties of undefined (reading 'start')
- Fixes [#3377](https://github.com/gitkraken/vscode-gitlens/issues/3378) - Deleting a worktree (without force) with working changes causes double prompts
- Fixes Open SCM command for the Commmit Graph showing in the command palette - Thanks to [PR #3376](https://github.com/gitkraken/vscode-gitlens/pull/3376) by Nikolay ([@nzaytsev](https://github.com/nzaytsev))
- Fixes fixes issue with Jira integration not refreshing
- Fixes the _Learn More_ link not working in the account verification dialog
- Upgrading to Pro, managing a GitKraken account, and managing or connecting cloud integrations now no longer require the user to log in again in their respective pages on _gitkraken.dev_
- Fixes deep links failing to cancel in the remote add stage

## [15.1.0] - 2024-06-05

### Added

- Adds support for GitHub Copilot and other VS Code extension-provided AI models for GitLens' experimental AI features
  - Adds a `gitlens.ai.experimental.model` setting to specify the AI model to use
  - Adds a `gitlens.ai.experimental.vscode.model` setting to specify the VS Code extension-provided AI model to use when `gitlens.ai.experimental.model` is set to `vscode`
- Adds new Launchpad improvements:
  - Collapsed state of Launchpad groups are now saved between uses
  - The _Draft_ and _Pinned_ categories in the Launchpad now always sort their items by date
  - The Launchpad and Launchpad status bar indicator now indicate when there is an error loading data
  - The Launchpad indicator now shows the Launchpad icon next to the loading spinner when the Launchpad is loading

### Changed

- Changes the settings used to configure the AI models for GitLens' experimental AI features
  - Adds a `gitlens.ai.experimental.model` setting to specify the AI model to use
  - Removes the `gitlens.ai.experimental.provider`, `gitlens.ai.experimental.openai.model`, `gitlens.ai.experimental.anthropic.model`, and `gitlens.ai.experimental.gemini.model` settings in favor of the above

### Fixed

- Fixes [#3295](https://github.com/gitkraken/vscode-gitlens/issues/3295) - Incorrect pluralization in Authors lens &mdash; thanks to [PR #3296](https://github.com/gitkraken/vscode-gitlens/pull/3296) by bm-w ([@bm-w](https://github.com/bm-w))
- Fixes [#3277](https://github.com/gitkraken/vscode-gitlens/issues/3277) - Unable to pull branch when the local branch whose name differs from its tracking branch

## [15.0.4] - 2024-05-20

### Added

- Adds a _Copy as Markdown_ context menu command to autolinks in the _Autolinked Issues and Pull Requests_ section in the _Search & Compare_ view
- Adds a _Connect Remote Integration_ command to the _Autolinked Issues and Pull Requests_ section in the _Search & Compare_ view
- Adds `gitlens.currentLine.fontFamily`, `gitlens.currentLine.fontSize`, `gitlens.currentLine.fontStyle`, `gitlens.currentLine.fontWeight` settings to specify the font (family, size, style, and weight respectively) of the _Inline Blame_ annotation &mdash; closes [#3306](https://github.com/gitkraken/vscode-gitlens/issues/3306)
- Adds `gitlens.blame.fontStyle` settings to specify the font style of the _File Blame_ annotations

### Changed

- Improves the _Copy_ context menu command on autolinks in the _Autolinked Issues and Pull Requests_ section in the _Search & Compare_ view
- Changes the _Open Issue on Remote_ context menu command on autolinks to _Open URL_ in the _Autolinked Issues and Pull Requests_ section in the _Search & Compare_ view
- Changes the _Copy Issue URL_ context menu command on autolinks to _Copy URL_ in the _Autolinked Issues and Pull Requests_ section in the _Search & Compare_ view
- Renames the _Connect to Remote_ command to _Connect Remote Integration_
- Renames the _Disconnect from Remote_ command to _Disconnect Remote Integration_

### Fixed

- Fixes [#3299](https://github.com/gitkraken/vscode-gitlens/issues/3299) - Branches view no longer displays text colors for branch status after updating to v15.0.0 or above
- Fixes [#3277](https://github.com/gitkraken/vscode-gitlens/issues/3277) (in pre-release only) - Unable to pull branch when the local branch whose name differs from its tracking branch
- Fixes "hang" in Worktrees view when a worktree is missing
- Fixes an issue where the Commit Graph header bar sometimes pushes "Fetch" to the right
- Fixes an issue where the autolink type (issue vs pull request) was not shown properly in the _Autolinked Issues and Pull Requests_ section in the _Search & Compare_ view

## [15.0.3] - 2024-05-14

### Fixed

- Fixes [#3288](https://github.com/gitkraken/vscode-gitlens/issues/3288) - Branch, Tags, Stashes, Local Branch, and Remote Branch "Markers" Are Missing/Removed From Minimap

## [15.0.2] - 2024-05-14

### Fixed

- Fixes [#3270](https://github.com/gitkraken/vscode-gitlens/issues/3270) - GitLens erroneously thinks certain branches are worktrees under some conditions

## [15.0.1] - 2024-05-14

## [15.0.0] - 2024-05-14

### Added

- Adds [Launchpad](https://gitkraken.com/solutions/launchpad?utm_source=gitlens-extension&utm_medium=in-app-links) `preview`, a new Pro feature bringing your GitHub pull requests into a unified, categorized list to keep you focused and your team unblocked
  - Open using the new _GitLens: Open Launchpad_ command
  - Categorizes pull requests by status
    - _Current Branch_: Pull requests associated with your current branch
    - _Ready to Merge_: Pull requests without conflicts, ci failures, change suggestions or other issues preventing merge
    - _Blocked_: Pull requests with conflicts, CI failures, or that have no reviewers assigned
    - _Needs Your Review_: Pull requests waiting for your review
    - _Requires Follow-Up_: Pull requests that have been reviewed and need follow-up
    - _Draft_: Draft pull requests
    - _Pinned_: Pull requests you have pinned
    - _Snoozed_: Pull requests you have snoozed
    - _Other_: Other pull requests
  - Action on a pull request directly from the Launchpad:
    - Merge a pull request
    - Open a pull request on GitHub
    - Switch to or create a branch or worktree for a pull request to review changes
    - Display a pull request's details in the _Overview_
    - Open a pull request's changes in the multi-diff editor
    - View a pull request's branch in the _Commit Graph_
    - View or create code suggestions for a pull request
    - Pin or snooze a pull request in the Launchpad
  - Adds a status bar indicator of the _Launchpad_
    - Opens the Launchpad when clicked
    - Shows the top pull request and its status in the status bar
      - Also highlights your top pull request in the launchpad when opened from the indicator
    - Provides a summary of your most critical pull requests on hover
      - Each summary line includes a link to open the Launchpad to that category
  - Adds new settings for the Launchpad and indicator
    - `gitlens.launchpad.ignoredRepositories`: Array of repositories with `owner/name` format to ignore in the Launchpad
    - `gitlens.launchpad.staleThreshold`: Value in days after which a pull request is considered stale and moved to the _Other_ category
    - `gitlens.launchpad.indicator.enabled`: Specifies whether to show the Launchpad indicator in the status bar
    - `gitlens.launchpad.indicator.icon`: Specifies the style of the Launchpad indicator icon
    - `gitlens.launchpad.indicator.label`: Specifies the style of the Launchpad indicator label
    - `gitlens.launchpad.indicator.groups`: Specifies which critical categories of pull requests to summarize in the indicator tooltip
    - `gitlens.launchpad.indicator.useColors`: Specifies whether to use colors in the indicator
    - `gitlens.launchpad.indicator.openInEditor`: Specifies whether to open the Launchpad in the editor when clicked
    - `gitlens.launchpad.indicator.polling.enabled`: Specifies whether to regularly check for changes to pull requests
    - `gitlens.launchpad.indicator.polling.interval`: Specifies the interval in minutes to check for changes to pull requests
- Adds new features that make code reviews easier
  - Adds [Code Suggest](https://gitkraken.com/solutions/code-suggest?utm_source=gitlens-extension&utm_medium=in-app-links) `preview`, a cloud feature, that frees your code reviews from unnecessary restrictions
    - Create a Code Suggestion from the _Inspect: Overview_ tab when on a PR's branch
    - Upon creation of a Code Suggestion, a comment will appear on the pull request
      - Code Suggestions can be viewed and apply directly from [gitkraken.dev](https://gitkraken.dev), or open in GitKraken Desktop or GitLens.
    - See a PR's Code Suggestions from anywhere we currently display PR information in our views (Commits, Branches, Remotes)
    - You can additionally start Code Suggestions from the Launchpad
  - Adds a _Pull Request_ view to view PR commits and review file changes
  - Adds a _Pull Request_ badge to the Graph and the Inspect Overview
- Adds rich Jira Cloud integration
  - Enables rich automatic Jira autolinks in commit messages everywhere autolinks are supported in GitLens
  - Adds a _Cloud Integrations_ button to the GitKraken Account view and a new `GitLens: Manage Cloud Integrations` command to manage connected cloud integrations
  - Adds a _Manage Jira_ button to _Inspect_ and a link in Autolink settings to connect to Jira
- Adds support for Google Gemini for GitLens' experimental AI features
  - Adds a `gitlens.ai.experimental.gemini.model` setting to specify the Gemini model
- Adds support for the latest OpenAI and Anthropic models for GitLens' experimental AI features
- Adds a new `gitlens.views.collapseWorktreesWhenPossible` setting to specify whether to try to collapse the opened worktrees into a single (common) repository in the views when possible

### Changed

- Reworks _Commit Details_, now called the _Inspect_ view
  - Revamps the _Working Changes_ tab into the _Overview_ tab
  - Provides richer branch status information and branch switching
  - Adds Push, Pull, and Fetch actions
  - Richer Pull Request Information
    - Open details in the Pull Request view
    - Links to open and compare changes
    - List of the PR's Code Suggestions
  - Create a Code Suggestion by clicking the _Suggest Changes for PR_ button
- Improves contributor and team member picking for the adding co-authors, _Code Suggest_, and _Cloud Patches_
- Improves performance when creating colors derived from the VS Code theme
- Changes the command to open the Launchpad in the editor (formerly _Focus View_) from _GitLens: Show Focus_ to _GitLens: Open Launchpad in Editor_
- Renames the setting `gitlens.focus.allowMultiple` to `gitlens.launchpad.allowMultiple`
- Updates most deep link prompts to quick picks or quick inputs, moves most prompts to before a repository is opened.
- Updates Pro upgrade links to use the newer gitkraken.dev site

### Fixed

- Fixes [#3221](https://github.com/gitkraken/vscode-gitlens/issues/3221) - Cannot use word "detached" in branch names
- Fixes [#3197](https://github.com/gitkraken/vscode-gitlens/issues/3197) - Only emojify standalone emojis &mdash; thanks to [PR #3208](https://github.com/gitkraken/vscode-gitlens/pull/3208) by may ([@m4rch3n1ng](https://github.com/m4rch3n1ng))
- Fixes [#3180](https://github.com/gitkraken/vscode-gitlens/issues/3180) - Focus View feedback button is not working
- Fixes [#3179](https://github.com/gitkraken/vscode-gitlens/issues/3179) - The checkmarks in cherry pick are not displayed
- Fixes [#3249](https://github.com/gitkraken/vscode-gitlens/issues/3249) - Error "Cannot read properties of null (reading 'map')
- Fixes [#3198](https://github.com/gitkraken/vscode-gitlens/issues/3198) - Repository location in cloud workspace doesn't work when the repo descriptor does not contain a url
- Fixes [#3143](https://github.com/gitkraken/vscode-gitlens/issues/3143) - File Annotation icon isn't themed according to the icons...

## [14.9.0] - 2024-03-06

### Added

- Adds support for Anthropic's Claude 3 Opus & Sonnet models for GitLens' experimental AI features
- Adds a _Compare with Common Base_ command to branches in the _Commit Graph_ and views to review the changes if the selected branch were to be merged by comparing the common ancestor (merge base) with the current branch to the selected branch
- Adds an _Open All Changes with Common Base_ command to branches in the _Commit Graph_ and views to review the changes if the selected branch were to be merged in the multi-diff editor
- Adds a _Stash All Changes_ command to Source Control repository toolbar (off by default)
- Adds the repository name as a prefix to worktree name when adding to the current workspace
- Adds a better message when stashing only untracked files without including untracked files
- Adds a new group of _Cloud Patches_ titled as “Suggested Changes” that includes suggestions coming from pull requests.

### Changed

- Re-adds _Add to Workspace_ option when creating a worktree &mdash; closes [#3160](https://github.com/gitkraken/vscode-gitlens/issues/3160)
- Changes _Commit Graph_ date style to default to the default date style &mdash; refs [#3153](https://github.com/gitkraken/vscode-gitlens/issues/3153)
- Renames the _Compare Ancestry with Working Tree_ command on branches to _Compare Common Base with Working Tree_ for better clarity
- Improves _File Blame_ annotations performance and layout accuracy with certain character sets
- Improves string formatting performance

### Fixed

- Fixes [#3146](https://github.com/gitkraken/vscode-gitlens/issues/3146) - Search & Compare fails to remember items after restart
- Fixes [#3152](https://github.com/gitkraken/vscode-gitlens/issues/3152) - Fixes double encoding of redirect URLs during account sign-in which affects certain environments
- Fixes [#3153](https://github.com/gitkraken/vscode-gitlens/issues/3153) - `gitlens.defaultDateStyle` not working in Commit Details view
- Fixes the _Open Pull Request Changes_ & _Compare Pull Request_ commands to scope the changes only to the pull request
- Fixes broken _Compare Common Base with Working Tree_ (previously _Compare Ancestry with Working Tree_)
- Fixes issue when switching to a worktree via branch switch when there are multiple repos in the workspace

## [14.8.2] - 2024-02-16

### Fixed

- Fixes incorrect organization self-hosting message when creating a Cloud Patch

## [14.8.1] - 2024-02-15

### Added

- Adds a _Create New Branch..._ option to the _Git Switch to..._ command to easily create a new branch to switch to &mdash; closes [#3138](https://github.com/gitkraken/vscode-gitlens/issues/3138)
- Adds the ability to start a new trial from the _Account View_ and feature gates for users without a Pro account whose Pro trial has been expired for over 90 days.

### Fixed

- Fixes AI features not being displayed when signed-out of an account

## [14.8.0] - 2024-02-08

### Added

- Adds support for Cloud Patches hosted on your own dedicated storage for the highest level of security (requires an Enterprise plan)
- Improves worktree usage, discoverability, and accessibility
  - Simplifies the create worktree and open worktree flows &mdash; reduces number of steps and options presented
  - Adds _Create Branch in New Worktree_ confirmation option when creating branches, e.g. via the _GitLens: Git Create Branch..._ command
  - Adds _Create Worktree for Branch_, _Create Worktree for Local Branch_, and _Create Worktree for New Local Branch_ confirmation options when switching branches, e.g. via the _GitLens: Git Switch to..._ command
  - Adds a _Copy Working Changes to Worktree..._ command to the _Commit Graph_ and command palette to copy the current working changes to an existing worktree
  - Avoids prompt to add a (required) remote and instead auto-adds the remote during worktree creation from a pull request
- Adds ability to open multiple changes in VS Code's new multi-diff editor, previously experimental and now enabled by default
  - Adds an inline _Open All Changes_ command to commits, stashes, and comparisons in the views
  - Changes _Open All Changes_ & _Open All Changes with Working Tree_ commands to use the new multi-diff editor when enabled
  - Adds _Open All Changes, Individually_ & _Open All Changes with Working Tree, Individually_ commands to provide access to the previous behavior
  - Renames the `gitlens.experimental.openChangesInMultiDiffEditor` setting to `gitlens.views.openChangesInMultiDiffEditor`, which is enabled by default, to specify whether to open changes in the multi-diff editor (single tab) or in individual diff editors (multiple tabs)
  - Requires VS Code `1.86` or later, or VS Code `1.85` with `multiDiffEditor.experimental.enabled` enabled
- Adds new comparison features to pull requests in GitLens views
  - Adds an _Open Pull Request Changes_ context menu command on pull requests in the _Commit Graph_ and other GitLens views to view pull request changes in a multi-diff editor (single tab)
    - Requires VS Code `1.86` or later, or VS Code `1.85` with `multiDiffEditor.experimental.enabled` enabled
  - Adds a _Compare Pull Request_ context menu command on pull requests in the _Commit Graph_ and other GitLens views to open a comparison between the head and base of the pull request for easy reviewing
- Adds an _Open in Commit Graph_ context menu command on pull requests in GitLens view to open the tip commit in the _Commit Graph_
- Adds ability to copy changes, commits, stashes, and comparison as a patch to the clipboard
  - Adds a _Copy as Patch_ context menu command on files, commits, stashes, and comparisons in GitLens views
  - Adds a _Copy as Patch_ context menu command on files in the _Changes_ and _Staged Changes_ groups as well as the groups themselves in the _Source Control_ view
  - Adds a _Apply Copied Patch_ command in the command palette to apply a patch from the clipboard
- Adds an _Open All Changes_ inline button to branch status (upstream) and branch status files in GitLens views
- Adds an _Open Changes_ submenu to branch status (upstream) and branch status files in GitLens views
- Adds ability to preserve inline and file annotations while editing, previously experimental and now enabled by default
  - Renames the `gitlens.experimental.allowAnnotationsWhenDirty` setting to `gitlens.fileAnnotations.preserveWhileEditing`, which is enabled by default, to specify whether file annotations will be preserved while editing &mdash; closes [#1988](https://github.com/gitkraken/vscode-gitlens/issues/1988), [#3016](https://github.com/gitkraken/vscode-gitlens/issues/3016)
  - Use the existing `gitlens.advanced.blame.delayAfterEdit` setting to control how long to wait (defaults to 5s) before the annotation will update while the file is still dirty, which only applies if the file is under the `gitlens.advanced.sizeThresholdAfterEdit` setting threshold (defaults to 5000 lines)
- Adds an _Open File Annotation Settings_ command to the _File Annotations_ submenu in the editor toolbar to open the GitLens Settings editor to the file annotations sections
- Adds `gitlens.blame.fontFamily`, `gitlens.blame.fontSize`, `gitlens.blame.fontWeight` settings to specify the font (family, size, and weight respectively) of the _File Blame_ annotations &mdash; closes [#3134](https://github.com/gitkraken/vscode-gitlens/issues/3134)
- Adds _Copy Link to Code_, _Copy Link to File_, and _Copy Link to File at Revision..._ commands to the _Share_ submenu in the editor line number (gutter) context menu
- Adds an alternate flow (pick another file) when using the _Open File at Revision..._ and _Open Changes with Revision..._ commands to open a file that has been renamed and the rename is currently unstaged &mdash; closes [#3109](https://github.com/gitkraken/vscode-gitlens/issues/3109)
- Adds access to most _Git Command Palette_ commands directly to the command palette
- Adds _Rename Stash..._ options to stash quick pick menus
- Adds support for the latest GPT-4 Turbo models

### Changed

- Changes adds avatars to commits in quick pick menus
- Changes the pull request to be first item in the _Commits_ view, when applicable
- Changes the branch comparison to be below the branch status in the _Commits_ view to keep top focus on the status over the comparison
- Renames "Open Worktree for Pull Request via GitLens..." to "Checkout Pull Request in Worktree (GitLens)..."
- Renames the `gitlens.experimental.openChangesInMultiDiffEditor` setting to `gitlens.views.openChangesInMultiDiffEditor` as it is no longer experimental and enabled by default

### Fixed

- Fixes [#3438](https://github.com/gitkraken/vscode-gitlens/issues/3438) - UsageTracker first track creates an object with count 0
- Fixes [#3115](https://github.com/gitkraken/vscode-gitlens/issues/3115) - Always-on file annotations
- Fixes ahead/behind diffs on files (root) in the _Commits_ view to correctly show the diff of the range rather than the base to the working tree
- Fixes missing repository icons in the _Repositories_ view
- Fixes [#3116](https://github.com/gitkraken/vscode-gitlens/issues/3116) - Fix typos in README.md and package.json &mdash; thanks to [PR #3117](https://github.com/gitkraken/vscode-gitlens/pull/3117) by yutotnh ([@yutotnh](https://github.com/yutotnh))

## [14.7.0] - 2024-01-17

### Added

- Adds the ability to share Cloud Patches with specific members of your GitKraken organization
  - You can now share Cloud Patches exclusively with specific members of your organization by selecting _Collaborators Only_ when viewing or creating a Cloud Patch
  - Click the _Invite_ button at the bottom of the _Patch Details_ view to add members of your organization to collaborate and click _Update Patch_ to save your changes
  - Cloud Patch collaborators will see these Patches under the _Shared with Me_ section of the _Cloud Patches_ view
- Adds support for deep links to files and code
  - Deep link format: `https://gitkraken.dev/link/r/{repoId}/f/{filePath}?[url={remoteUrl}|path={repoPath}]&lines={lines}&ref={ref}`
  - Adds _Copy Link to File_, _Copy Link to File at Revision..._, and _Copy Link to Code_ commands to the _Copy As_ submenu in the editor context menu and to the _Share_ submenu of files in GitLens views
- Adds the ability to choose multiple stashes to drop in the _Git Command Palette_'s _stash drop_ command &mdash; closes [#3102](https://github.com/gitkraken/vscode-gitlens/issues/3102)
- Adds a new _prune_ subcommand to the _Git Command Palette_'s _branch_ command to easily delete local branches with missing upstreams
- Adds a new _Push Stash Snapshot_ confirmation option to the _Git Command Palette_'s _stash push_ command to save a stash without changing the working tree
- Adds _Copy_ to search results in the _Search & Compare_ view to copy the search query to more easily share or paste queries into the _Commit Graph_
- Adds a status bar indicator when blame annotations (inline, statusbar, file annotations, etc) are paused because the file has unsaved changes (dirty), with a tooltip explaining why and how to configure/change the behavior
- Adds an experimental `gitlens.experimental.allowAnnotationsWhenDirty` setting to specify whether file annotations are allowed on files with unsaved changes (dirty) &mdash; closes [#1988](https://github.com/gitkraken/vscode-gitlens/issues/1988), [#3016](https://github.com/gitkraken/vscode-gitlens/issues/3016)
  - Use the existing `gitlens.advanced.blame.delayAfterEdit` setting to control how long to wait (defaults to 5s) before the annotation will update while the file is still dirty, which only applies if the file is under the `gitlens.advanced.sizeThresholdAfterEdit` setting threshold (defaults to 5000 lines)
- Adds a `gitlens.fileAnnotations.dismissOnEscape` setting to specify whether pressing the `ESC` key dismisses the active file annotations &mdash; closes [#3016](https://github.com/gitkraken/vscode-gitlens/issues/3016)

### Changed

- Changes the commit search by file to allow some fuzziness by default &mdash; closes [#3086](https://github.com/gitkraken/vscode-gitlens/issues/3086)
  - For example, if you enter `file:readme.txt`, we will treat it as `file:**/readme.txt`, or if you enter `file:readme` it will be treated as `file:*readme*`
- Improves the _Switch_ command to no longer fail when trying to switch to a branch that is linked to another worktree and instead offers to open the worktree
- Changes branch/tag "tips" that are shown on commits in many GitLens views to be truncated to 11 characters by default to avoid stealing to much real estate

### Fixed

- Fixes [#3087](https://github.com/gitkraken/vscode-gitlens/issues/3087) - Terminal executed commands fail if the GitLens terminal is closed
- Fixes [#2784](https://github.com/gitkraken/vscode-gitlens/issues/2784) - Git stash push error
- Fixes [#2926](https://github.com/gitkraken/vscode-gitlens/issues/2926) in more cases - "Open File at Revision" has incorrect editor label if revision contains path separator &mdash; thanks to [PR #3060](https://github.com/gitkraken/vscode-gitlens/issues/3060) by Ian Chamberlain ([@ian-h-chamberlain](https://github.com/ian-h-chamberlain))
- Fixes [#3066](https://github.com/gitkraken/vscode-gitlens/issues/3066) - Editing a large file and switching away to another file without saving causes current line blame to disappear; thanks to [PR #3067](https://github.com/gitkraken/vscode-gitlens/pulls/3067) by Brandon Cheng ([@gluxon](https://github.com/gluxon))
- Fixes [#3063](https://github.com/gitkraken/vscode-gitlens/issues/3063) - Missing icons in GitLens Settings UI
- Fixes issue with _Switch_ command not honoring the confirmation setting
- Fixes worktree delete from offering to delete main worktree (which isn't possible)
- Fixes worktree delete on windows when the worktree's folder is missing

### Removed

- Removes the `gitlens.experimental.nativeGit` setting as it is now the default experience &mdash; closes [#3055](https://github.com/gitkraken/vscode-gitlens/issues/3055)

## [14.6.1] - 2023-12-14

### Fixed

- Fixes [#3057](https://github.com/gitkraken/vscode-gitlens/issues/3057) - Uncommitted changes cause an error when gitlens.defaultDateSource is "committed"

## [14.6.0] - 2023-12-13

### Added

- Adds the ability to specify who can access a Cloud Patch when creating it
  - _Anyone with the link_ &mdash; allows anyone with the link and a GitKraken account to access the Cloud Patch
  - _Members of my Org with the link_ &mdash; allows only members of your selected GitKraken organization with the link to access the Cloud Patch
  - (Coming soon to GitLens) Ability to explicitly share to specific members from your organization and add them as collaborators on a Cloud Patch
  - Cloud Patches that have been explicitly shared with you, i.e. you are a collaborator, now will appear in the _Cloud Patches_ view under _Shared with Me_
- Adds timed snoozing for items in the _Focus View_ &mdash; choose from a selection of times when snoozing and the item will automatically move out of the snoozed tab when that time expires
- Adds the ability to open folder changes &mdash; closes [#3020](https://github.com/gitkraken/vscode-gitlens/issues/3020)
  - Adds _Open Folder Changes with Revision..._ & _Open Folder Changes with Branch or Tag..._ commands to the command palette and to the _Explorer_ and _Source Control_ views
  - Requires VS Code `1.85` or later and `multiDiffEditor.experimental.enabled` to be enabled
- Adds last modified time of the file when showing blame annotations for uncommitted changes
- Adds search results to the minimap tooltips on the _Commit Graph_
- Adds support for Anthropic's Claude 2.1 model for GitLens' experimental AI features
- Adds a status indicator when the upstream branch is missing in _Commits_ view
- Adds support for opening renamed/deleted files using the _Open File at Revision..._ & _Open File at Revision from..._ commands by showing a quick pick menu if the requested file doesn't exist in the selected revision &mdash; closes [#708](https://github.com/gitkraken/vscode-gitlens/issues/708) thanks to [PR #2825](https://github.com/gitkraken/vscode-gitlens/pull/2825) by Victor Hallberg ([@mogelbrod](https://github.com/mogelbrod))
- Adds an _Open Changes_ submenu to comparisons in the _Search & Compare_ view
- Adds experimental `gitlens.experimental.openChangesInMultiDiffEditor` setting to specify whether to open multiple changes in VS Code's experimental multi-diff editor (single tab) or in individual diff editors (multiple tabs)
  - Adds an inline _Open All Changes_ command to commits, stashes, and comparisons in the views
  - Changes _Open All Changes_ & _Open All Changes with Working Tree_ commands to use the new multi-diff editor when enabled
  - Adds _Open All Changes, Individually_ & _Open All Changes with Working Tree, Individually_ commands to provide access to the previous behavior
  - Requires VS Code `1.85` or later and `multiDiffEditor.experimental.enabled` to be enabled
- Adds a confirmation prompt when attempting to undo a commit with uncommitted changes
- Adds a _[Show|Hide] Merge Commits_ toggle to the _Contributors_ view
- Adds _Open in Integrated Terminal_ command to repositories in the views &mdash; closes [#3053](https://github.com/gitkraken/vscode-gitlens/issues/3053)
- Adds _Open in Terminal_ & _Open in Integrated Terminal_ commands to the upstream status in the _Commits_ view
- Adds the ability to choose an active GitKraken organization in the _Account View_ for users with multiple GitKraken organizations.

### Changed

- Improves AI model choice selection for GitLens' experimental AI features
- Improves performance when logging is enabled
- Changes the contextual view title from GL to GitLens

### Fixed

- Fixes [#2663](https://github.com/gitkraken/vscode-gitlens/issues/2663) - Debounce bug: file blame isn't cleared when editing document while text in output window changes
- Fixes [#3050](https://github.com/gitkraken/vscode-gitlens/issues/3050) - Opening revision of a renamed file is broken
- Fixes [#3019](https://github.com/gitkraken/vscode-gitlens/issues/3019) - Commits Views not working
- Fixes [#3026](https://github.com/gitkraken/vscode-gitlens/issues/3026) - Gitlens stopped working in sub-repositories
- Fixes [#2746](https://github.com/gitkraken/vscode-gitlens/issues/2746) - Remove 'undo commit' command from gitlens inspect
- Fixes [#2482](https://github.com/gitkraken/vscode-gitlens/issues/2482) - Unresponsive "commits" view and "branches" view update due to git log
- Fixes duplicate entries in the _Search & Compare_ view when adding a new comparison from outside the view and before the view has loaded
- Fixes _Load more_ in the _File History_ view when the file has been renamed
- Fixes broken _Open Changed & Close Unchanged Files_ (`gitlens.views.openOnlyChangedFiles`) command in the views
- Fixes issues with _Contributors_ view updating when changing toggles
- Fixes issues with _Open [Previous] Changes with Working File_ command in comparisons
- Fixes banner styling on the _Commit Graph_

## [14.5.2] - 2023-11-30

### Added

- Adds cyber week promotion

## [14.5.1] - 2023-11-21

### Added

- Adds support for OpenAI's GPT-4 Turbo and latest Anthropic models for GitLens' experimental AI features &mdash; closes [#3005](https://github.com/gitkraken/vscode-gitlens/issues/3005)

### Changed

- Improves the performance of the _Commit Graph_ when loading a large number of commits
- Refines AI prompts to provide better commit message generation and explanation results
- Updates Files Changed panel of _Commit Details_, which now supports indent settings and adds better accessibility

### Fixed

- Fixes [#3023](https://github.com/gitkraken/vscode-gitlens/issues/3023) - "Unable to show blame. Invalid or missing blame.ignoreRevsFile" with valid ignore revs file
- Fixes [#3018](https://github.com/gitkraken/vscode-gitlens/issues/3018) - Line blame overlay is broken when commit message contains a `)`
- Fixes [#2625](https://github.com/gitkraken/vscode-gitlens/issues/2625) - full issue ref has escape characters that break hover links
- Fixes stuck busy state of the _Commit Details_ Explain AI panel after canceling a request
- Fixes cloud patch deep links requiring a paid plan (while in preview)

## [14.5.0] - 2023-11-13

### Added

- Adds a preview of [Cloud Patches](https://www.gitkraken.com/solutions/cloud-patches), an all-new ☁️ feature &mdash; engage in early collaboration before the pull request:
  - Share your work with others by creating a Cloud Patch from Working Changes, Commits, Stashes or Comparisons
  - View Cloud Patches from URLs shared to you and apply them to your working tree or to a new or existing branch
  - Manage your Cloud Patches from the new _Cloud Patches_ view in the GitLens side bar
  - Adds a _Share as Cloud Patch..._ command to the command palette and to the _Share_ submenu in applicable GitLens views
  - Adds a `gitlens.cloudPatches.enabled` setting to specify whether to enable Cloud Patches (defaults to `true`)
- Adds support to open multiple instances of the _Commit Graph_, _Focus_, and _Visual File History_ in the editor area
  - Adds a _Split Commit Graph_ command to the _Commit Graph_ tab context menu
  - Adds a `gitlens.graph.allowMultiple` setting to specify whether to allow opening multiple instances of the _Commit Graph_ in the editor area
  - Adds a _Split Focus_ command to the _Focus_ tab context menu
  - Adds a `gitlens.focus.allowMultiple` setting to specify whether to allow opening multiple instances of the _Focus_ in the editor area
  - Adds a _Split Visual File History_ command to the _Visual File History_ tab context menu
  - Adds a `gitlens.visualHistory.allowMultiple` setting to specify whether to allow opening multiple instances of the _Visual File History_ in the editor area
- Adds a _Generate Commit Message (Experimental)_ button to the SCM input when supported (currently `1.84.0-insider` only)
  - Adds a `gitlens.ai.experimental.generateCommitMessage.enabled` setting to specify whether to enable GitLens' experimental, AI-powered, on-demand commit message generation &mdash; closes [#2652](https://github.com/gitkraken/vscode-gitlens/issues/2652)
- Improves the experience of the _Search Commits_ quick pick menu
  - Adds a stateful authors picker to make it much easier to search for commits by specific authors
  - Adds a file and folder picker to make it much easier to search for commits containing specific files or in specific folders
- Adds ability to sort repositories in the views and quick pick menus &mdash; closes [#2836](https://github.com/gitkraken/vscode-gitlens/issues/2836) thanks to [PR #2991](https://github.com/gitkraken/vscode-gitlens/pull/2991)
  - Adds a `gitlens.sortRepositoriesBy` setting to specify how repositories are sorted in quick pick menus and views by Aidos Kanapyanov ([@aidoskanapyanov](https://github.com/aidoskanapyanov))
- Adds a _[Show|Hide] Merge Commits_ toggle to the _Commits_ view &mdash; closes [#1399](https://github.com/gitkraken/vscode-gitlens/issues/1399) thanks to [PR #1540](https://github.com/gitkraken/vscode-gitlens/pull/1540) by Shashank Shastri ([@Shashank-Shastri](https://github.com/Shashank-Shastri))
- Adds a _Filter Commits by Author..._ commands to the _Commits_ view and comparisons context menus to filter commits in the _Commits_ view by specific authors
- Adds ability to publish to a remote branch to a specific commit using the _Push to Commit_ command
- Adds an _Open Comparison on Remote_ command to comparisons in views
- Adds a _Share > Copy Link to Repository_ command on branches in the views
- Adds _Share > Copy Link to Branch_ and _Share > Copy Link to Repository_ commands on the current branch status in the _Commits_ view
- Adds a _Clear Reviewed Files_ command to comparisons to clear all reviewed files &mdash; closes [#2987](https://github.com/gitkraken/vscode-gitlens/issues/2987)
- Adds a _Collapse_ command to many view nodes
- Adds a `gitlens.liveshare.enabled` setting to specify whether to enable integration with Visual Studio Live Share

### Changed

- Improves accuracy, performance, and memory usage related to parsing diffs, used in _Changes_ hovers, _Changes_ file annotations, etc
- Improves confirmation messaging in the _Git Command Palette_
- Refines merge/rebase messaging when there is nothing to do &mdash; refs [#1660](https://github.com/gitkraken/vscode-gitlens/issues/1660)
- Improves view messaging while loading/discovering repositories
- Honors VS Code's `git.useForcePushWithLease` and `git.useForcePushIfIncludes` settings when force pushing
- Changes _File Heatmap_ annotations to not color the entire line by default. Want it back, add `line` to the `gitlens.heatmap.locations` setting

### Fixed

- Fixes [#2997](https://github.com/gitkraken/vscode-gitlens/issues/2997) - "push to commit" pushes everything instead of up to the selected commit
- Fixes [#2615](https://github.com/gitkraken/vscode-gitlens/issues/2615) - Source Control views disappear after opening a file beyond a symbolic link
- Fixes [#2443](https://github.com/gitkraken/vscode-gitlens/issues/2443) - UNC-PATH: File History changes not displaying any changes when open
- Fixes [#2625](https://github.com/gitkraken/vscode-gitlens/issues/2625) - full issue ref has escape characters that break hover links
- Fixes [#2987](https://github.com/gitkraken/vscode-gitlens/issues/2987) - Unable to remove all marks on reviewed files with a single operation
- Fixes [#2923](https://github.com/gitkraken/vscode-gitlens/issues/2923) - TypeError: Only absolute URLs are supported
- Fixes [#2926](https://github.com/gitkraken/vscode-gitlens/issues/2926) - "Open File at Revision" has incorrect editor label if revision contains path separator
- Fixes [#2971](https://github.com/gitkraken/vscode-gitlens/issues/2971) - \[Regression\] The branch column header text disappears when you have a hidden ref
- Fixes [#2814](https://github.com/gitkraken/vscode-gitlens/issues/2814) - GitLens Inspect: "Files Changed" not following when switching between commits in File History
- Fixes [#2952](https://github.com/gitkraken/vscode-gitlens/issues/2952) - Inline blame not working because of missing ignoreRevsFile
- Fixes issue where _Changes_ hovers and _Changes_ file annotations sometimes weren't accurate
- Fixes intermittent issue where inline blame and other revision-based editor features are unavailable when repository discovery takes a bit
- Fixes intermittent issues where details sometimes get cleared/overwritten when opening the _Commit Details_ view
- Fixes issue when clicking on commits in the Visual File History to open the _Commit Details_ view
- Fixes issue opening stashes in the _Commit Details_ view from the _Stashes_ view
- Fixes issue where GitHub/GitLab enriched autolinks could incorrectly point to the wrong repository
- Fixes issue showing folder history in the _File History_ view when there are uncommitted changes (staged or unstaged)
- Fixes issue when pushing to a remote branch with different name than the local
- Fixes tooltip styling/theming on the _Commit Graph_
- Fixes issues staged files in repositories not "opened" (discovered) by the built-in Git extension

## [14.4.0] - 2023-10-13

### Added

- Adds a _Working Changes_ tab to the _Commit Details_ and _Graph Details_ views to show your working tree changes
  - Adds _Stage Changes_ and _Unstage Changes_ commands to files on the _Working Changes_ tab
- Adds a _[Show|Hide] Merge Commits_ toggle to the _File History_ view &mdash; closes [#2104](https://github.com/gitkraken/vscode-gitlens/issues/2104) & [#2944](https://github.com/gitkraken/vscode-gitlens/issues/2944)
  - Adds a `gitlens.advanced.fileHistoryShowMergeCommits` setting to specify whether merge commits will be show in file histories
- Adds deep link support for workspaces in the _GitKraken Workspaces_ view
  - Deep link format: `https://gitkraken.dev/link/workspaces/{workspaceId}`
  - Adds a _Share_ submenu with a _Copy Link to Workspace_ command to workspaces in the _GitKraken Workspaces_ view

### Changed

- Improves performance of inline blame, status bar blame, and hovers especially when working with remotes with connected integrations
- Changes the _File History_ view to follow renames and filters out merge commits by default &mdash; closes [#2104](https://github.com/gitkraken/vscode-gitlens/issues/2104) & [#2944](https://github.com/gitkraken/vscode-gitlens/issues/2944)
- Changes the _File History_ view to allow following renames while showing history across all branches (which was a previous limitation of Git) &mdash; closes [#2828](https://github.com/gitkraken/vscode-gitlens/issues/2828)
- Changes to use our own implementation of `fetch`, `push`, and `pull` Git operations, rather than delegating to VS Code to avoid limitations especially with GitKraken Workspaces. Please report any issues and you can revert this (for now) by setting `"gitlens.experimental.nativeGit"` to `"false"` in your settings
- Relaxes PR autolink detection for Azure DevOps to use `PR <number>` instead of `Merged PR <number>` &mdash; closes [#2908](https://github.com/gitkraken/vscode-gitlens/issues/2908)
- Changes wording on `Reset Stored OpenAI Key` command to `Reset Stored AI Key` to reflect support for other providers

### Fixed

- Fixes [#2941](https://github.com/gitkraken/vscode-gitlens/issues/2941) - Invalid Request when trying to generate a commit message using Anthropic API
- Fixes [#2940](https://github.com/gitkraken/vscode-gitlens/issues/2940) - Can't use Azure OpenAI model because i can't save the openai key because of the verification
- Fixes [#2928](https://github.com/gitkraken/vscode-gitlens/issues/2928) - Apply Changes should create new files when needed
- Fixes [#2896](https://github.com/gitkraken/vscode-gitlens/issues/2896) - Repositories view stuck in loading state
- Fixes [#2460](https://github.com/gitkraken/vscode-gitlens/issues/2460) - Gitlens Remote provider doesn't work properly in "Commit graph" view
- Fixes issue with "View as [List|Tree]" toggle not working in the _Commit Details_ view
- Fixes an issue with deep links sometimes failing to properly resolve when a matching repository without the remote is found
- Fixes an issue in the _Commit Graph_ where commits not in the history of a merge commit were showing in the same column
- Fixes `Reset Stored AI Key` command to work for the current provider
- Fixes an issue with parsing some renames in log output

## [14.3.0] - 2023-09-07

### Added

- Adds checkboxes to files in comparisons to allow for tracking review progress &mdash; closes [#836](https://github.com/gitkraken/vscode-gitlens/issues/836)
- Allows the _Commit Graph_ to be open in the panel and in the editor area simultaneously
- Adds an _Open Changes_ button to commits in the file history quick pick menu &mdash; closes [#2641](https://github.com/gitkraken/vscode-gitlens/issues/2641) thanks to [PR #2800](https://github.com/gitkraken/vscode-gitlens/pull/2800) by Omar Ghazi ([@omarfesal](https://github.com/omarfesal))

### Changed

- Changes the `gitlens.graph.layout` setting to be a default preference rather than a mode change

### Fixed

- Fixes [#2885](https://github.com/gitkraken/vscode-gitlens/issues/2885) - Folder History not show changed files of commit
- Fixes issues with opening changes (diffs) of renamed files
- Fixes issues with deep links including when opening VS Code from the deep link

## [14.2.1] - 2023-08-10

### Added

- Adds a _Refresh_ action to the _Commit Details_ view

### Fixed

- Fixes [#2850](https://github.com/gitkraken/vscode-gitlens/issues/2850) - For custom remotes, the URL resulting from the branches is truncated
- Fixes [#2841](https://github.com/gitkraken/vscode-gitlens/issues/2841) - Error when trying to browse commits
- Fixes [#2847](https://github.com/gitkraken/vscode-gitlens/issues/2847) - 14.2.0 Breaks "pull" action works fine in 14.1.1

## [14.2.0] - 2023-08-04

### Added

- Improves the _Focus_ view experience
  - Unifies pull requests and issues into a single view
  - Adds tabs to switch between showing Pull Requests, Issues, or All
  - Adds a filter/search box to quickly find pull request or issues by title
  - Adds ability to click on a branch name to show the branch on the _Commit Graph_
- Adds a new command _Open Changed & Close Unchanged Files..._ to the command palette, the context menu of the _Commit Graph_ work-in-progress (WIP) row, and the SCM group context menu to open all changed files and close all unchanged files.
- Adds a new command _Reset Current Branch to Tip..._ to branch context menus in the _Commit Graph_ and in GitLens views to reset the current branch to the commit at the chosen branch's tip.

### Changed

- Changes _Compact Graph Column Layout_ context menu command to _Use Compact Graph Column_ for better clarity
- Changes _Default Graph Column Layout_ context menu command to _Use Expanded Graph Column_ for better clarity
- Improves remote parsing for better integration support for some edge cases

### Fixed

- Fixes [#2823](https://github.com/gitkraken/vscode-gitlens/issues/2823) - Handle stdout/stderr Buffers in shell run() &mdash; thanks to [PR #2824](https://github.com/gitkraken/vscode-gitlens/pull/2824) by Victor Hallberg ([@mogelbrod](https://github.com/mogelbrod))
- Fixes issues with missing worktrees breaking the Worktrees view and Worktree quick pick menus

## [14.1.1] - 2023-07-18

### Added

- Adds the ability to provide a custom url to support Azure-hosted Open AI models &mdash; refs [#2743](https://github.com/gitkraken/vscode-gitlens/issues/2743)

### Changed

- Improves autolink URL generation by improving the "best" remote detection &mdash; refs [#2425](https://github.com/gitkraken/vscode-gitlens/issues/2425)
- Improves preserving the ref names in deeplinks to comparisons

### Fixed

- Fixes [#2744](https://github.com/gitkraken/vscode-gitlens/issues/2744) - GH enterprise access with _Focus_
- Fixes deeplink comparison ordering for a better experience
- Fixes deeplinks to comparisons with working tree not resolving

## [14.1.0] - 2023-07-13

### Added

- Adds the ability to link a GitKraken Cloud workspace with an associated VS Code workspace
  - Adds ability to automatically add repositories to the current VS Code workspace that were added to its associated GitKraken Cloud workspace, if desired
    - Adds a _Change Linked Workspace Auto-Add Behavior..._ context menu command on the _Current Window_ and linked workspace to control the desired behavior
    - Adds an _Add Repositories from Linked Workspace..._ context menu command on the _Current Window_ item to trigger this manually
  - Adds a new _Open VS Code Workspace_ command to open an existing VS Code workspace associated with a GitKraken Cloud workspace
  - Adds a highlight (green) to the linked GitKraken Cloud workspace when the current VS Code workspace is associated with it in the _GitKraken Workspaces_ view
- Adds deep link support for comparisons in the _Search & Compare_ view
  - Deep link format: `vscode://eamodio.gitlens/r/{repoId}/compare/{ref1}[..|...]{ref2}?[url={remoteUrl}|path={repoPath}]`
  - Adds a _Share_ submenu with a _Copy Link to Comparison_ command to comparisions in the _Search & Compare_ view
- Adds support for Anthropic's Claude 2 AI model
- Adds a progress notification while repositories are being added to a GitKraken Cloud workspace

### Changed

- Improves scrolling performance on the _Commit Graph_
- Renames _Convert to VS Code Workspace_ to _Create VS Code Workspace_ for workspaces in the _GitKraken Workspaces_ view to better reflect the behavior of the action
- Hides _Create VS Code Workspace_ and _Locate All Repositories_ commands on empty workspaces in the _GitKraken Workspaces_ view

### Fixed

- Fixes [#2798](https://github.com/gitkraken/vscode-gitlens/issues/2798) - Improve response from OpenAI if key used is tied to a free account
- Fixes [#2785](https://github.com/gitkraken/vscode-gitlens/issues/2785) - Remote Provider Integration URL is broken &mdash; thanks to [PR #2786](https://github.com/gitkraken/vscode-gitlens/pull/2786) by Neil Ghosh ([@neilghosh](https://github.com/neilghosh))
- Fixes [#2791](https://github.com/gitkraken/vscode-gitlens/issues/2791) - Unable to use contributors link in README.md &mdash; thanks to [PR #2792](https://github.com/gitkraken/vscode-gitlens/pull/2792) by Leo Dan Peña ([@leo9-py](https://github.com/leo9-py))
- Fixes [#2793](https://github.com/gitkraken/vscode-gitlens/issues/2793) - Requesting username change in contributors README page &mdash; thanks to [PR #2794](https://github.com/gitkraken/vscode-gitlens/pull/2794) by Leo Dan Peña ([@leo9-py](https://github.com/leo9-py))
- Fixes some rendering issues when scrolling in the _Commit Graph_
- Fixes an issue with some shared workspaces not showing up in the _GitKraken Workspaces_ view when they should
- Fixes an issue when adding repositories to a workspace in the _GitKraken Workspaces_ view where the added repository would show as missing until refreshing the view

## [14.0.1] - 2023-06-19

### Changed

- Changes view's contextual title to "GL" to appear more compact when rearranging views

### Fixed

- Fixes [#2731](https://github.com/gitkraken/vscode-gitlens/issues/2731) - Bug on Focus View Help Popup z-order
- Fixes [#2742](https://github.com/gitkraken/vscode-gitlens/issues/2742) - Search & Compare: Element with id ... is already registered
- Fixes an issue where the links in the _Search & Compare_ view failed to open the specific search type
- Fixes an issue when searching for commits and the results contain stashes

## [14.0.0] - 2023-06-14

### Added

- Adds an all-new Welcome experience to quickly get started with GitLens and discover features &mdash; even if you are familiar with GitLens, definitely check it out!
- Adds a new streamlined _Get Started with GitLens_ walkthrough
- Adds an all-new _Home_ view for quick access to GitLens features and _GitKraken Account_ for managing your account
- Adds a new reimagined views layout &mdash; see discussion [#2721](https://github.com/gitkraken/vscode-gitlens/discussions/2721) for more details
  - Rearranges the GitLens views for greater focus and productivity, including the new _GitLens Inspect_ and moved some of our views from Source Control into either _GitLens_ or _GitLens Inspect_.
  - Adds a new GitLens Inspect activity bar icon focuses on providing contextual information and insights to what you're actively working on
  - Adds a _Reset Views Layout_ command to reset all the GitLens views to the new default layout
- Adds an all-new _GitKraken Workspaces_ ☁️ feature as a side bar view, supporting interaction with local and cloud GitKraken workspaces, lists of repositories tied to your account.
  - Create, view, and manage repositories on GitKraken cloud workspaces, which are available with a GitKraken account across the range of GitKraken products
  - Automatically or manually link repositories in GitKraken cloud workspaces to matching repositories on your machine
  - Quickly create a GitKraken cloud workspace from the repositories in your current window
  - Open a GitKraken cloud workspace as a local, persisted, VS Code workspace file (further improvements coming soon)
  - Open a cloud workspace or repository in a new window (or your current window)
  - See your currently open repositories in the _Current Window_ section
  - Explore and interact with any repository in a GitKraken cloud workspace, some actions are currently limited to repositories which are open in your current window &mdash; ones highlighted in green
  - (Coming soon) Share your GitKraken cloud workspaces with your team or organization
- Adds new _Commit Graph_ ✨ features and improvements
  - Makes the _Panel_ layout the default for easy access to the Commit Graph with a dedicated details view
  - Adds two new options to the graph header context menu
    - `Reset Columns to Default Layout` - resets column widths, ordering, visibility, and graph column mode to default settings
    - `Reset Columns to Compact Layout` - resets column widths, ordering, visibility, and graph column mode to compact settings
  - Adds a _Toggle Commit Graph_ command to quickly toggle the graph on and off (requires the _Panel_ layout)
  - Adds a _Toggle Maximized Commit Graph_ command to maximize and restore the graph for a quick full screen experience (requires the _Panel_ layout)
  - Enables the _Minimap_ by default, as its no longer experimental, to provide a quick overview of of commit activity above the graph
    - Adds ability to toggle between showing commits vs lines changed in the minimap (note: choosing lines changed requires more computation)
    - Adds a legend and quick toggles for the markers shown on the minimap
    - Defers the loading of the minimap to avoid impacting graph performance and adds a loading progress indicator
    - Adds a `gitlens.graph.minimap.enabled` setting to specify whether to show the minimap
    - Adds a `gitlens.graph.minimap.dataType` setting to specify whether to show commits or lines changed in the minimap
    - Adds a `gitlens.graph.minimap.additionalTypes` setting to specify additional markers to show on the minimap
  - Makes the _Changes_ column visible by default (previously hidden)
    - Defers the loading of the _Changes_ column to avoid impacting graph performance and adds a loading progress indicator to the column header
    - Adds a changed file count in addition to the changed lines visualization
    - Improves the rendering of the changed line visualization and adds extra width to the bar for outlier changes so that they stand out a bit more
  - Adds an _Open Repo on Remote_ button to left of the repo name in the graph header
  - Improves contextual help on the search input as you type
  - Improves tooltips on _Branch/Tag_ icons to be more uniform and descriptive
  - Adds new context menu options to the _Commit Graph Settings_ (cog, above the scrollbar) to toggle which scroll marker to show
  - Improves alignment of scroll markers on the scrollbar, and adds a gap between the last column and the scrollbar
- Adds the ability to choose which AI provider, OpenAI or Anthropic, and AI model are used for GitLens' experimental AI features
  - Adds a _Switch AI Model_ command to the command palette and from the _Explain (AI)_ panel on the _Commit Details_ view
  - Adds a `gitlens.ai.experimental.provider` setting to specify the AI provider to use (defaults to `openai`)
  - Adds a `gitlens.ai.experimental.openai.model` setting to specify the OpenAI model (defaults to `gpt-3.5-turbo`) &mdash; closes [#2636](https://github.com/gitkraken/vscode-gitlens/issues/2636) thanks to [PR #2637](https://github.com/gitkraken/vscode-gitlens/pull/2637) by Daniel Rodríguez ([@sadasant](https://github.com/sadasant))
  - Adds a `gitlens.ai.experimental.anthropic.model` setting to specify the Anthropic model (defaults to `claude-v1`)
- Adds expanded deep link support
  - Adds cloning, adding a remote, and fetching from the target remote when resolving a deep link
  - Adds deep linking to a repository with direct file path support
- Adds the automatic restoration of all GitLens webviews when you restart VS Code
- Adds ability to control encoding for custom remote configuration &mdash; closes [#2336](https://github.com/gitkraken/vscode-gitlens/issues/2336)
- Improves performance and rendering of the _Visual File History_ and optimizes it for usage in the side bars
  - Adds a _Full history_ option to the _Visual File History_ &mdash; closes [#2690](https://github.com/gitkraken/vscode-gitlens/issues/2690)
  - Adds a loading progress indicator
- Adds _Reveal in File Explorer_ command to repositories
- Adds _Copy SHA_ command to stashes
- Adds new icons for virtual repositories

### Changed

- Changes header on _GitLens Settings_ to be consistent with the new Welcome experience
- Reduces the visual noise of currently inaccessible ✨ features in the side bars
- Performance: Improves rendering of large commits on the _Commit Details_ view
- Performance: Defers possibly duplicate repo scans at startup and waits until repo discovery is complete before attempting to find other repos
- Security: Disables Git access in Restricted Mode (untrusted)
- Security: Avoids dynamic execution in string interpolation

### Fixed

- Fixes [#2738](https://github.com/gitkraken/vscode-gitlens/issues/2738) - Element with id ... is already registered
- Fixes [#2728](https://github.com/gitkraken/vscode-gitlens/issues/2728) - Submodule commit graph will not open in the panel layout
- Fixes [#2734](https://github.com/gitkraken/vscode-gitlens/issues/2734) - 🐛 File History: Browse ... not working
- Fixes [#2671](https://github.com/gitkraken/vscode-gitlens/issues/2671) - Incorrect locale information provided GitLens
- Fixes [#2689](https://github.com/gitkraken/vscode-gitlens/issues/2689) - GitLens hangs on github.dev on Safari
- Fixes [#2680](https://github.com/gitkraken/vscode-gitlens/issues/2680) - Git path with spaces is not properly quoted in the command
- Fixes [#2677](https://github.com/gitkraken/vscode-gitlens/issues/2677) - Merging branch produces path error
- Fixes an issue with comparison commands on File/Line History views
- Fixes an issue with stale state on many webviews when shown after being hidden
- Fixes an issue with fetch/push/pull on the _Commit Graph_ header
- Fixes an issue where _Branch / Tag_ items on the _Commit Graph_ sometimes wouldn't expand on hover
- Fixes an issue where some command were showing up on unsupported schemes
- Fixes an issue where the file/line history views could break because of malformed URIs

## [13.6.0] - 2023-05-11

### Added

- Adds the ability to rename stashes &mdash; closes [#2538](https://github.com/gitkraken/vscode-gitlens/issues/2538)
  - Adds a new _Rename Stash..._ command to the _Stashes_ view
- Adds new _Commit Graph_ features and improvements
  - Adds a _Push_ or _Pull_ toolbar button depending the current branch being ahead or behind it's upstream
  - Adds support for the _Commit Graph_ over [Visual Studio Live Share](https://visualstudio.microsoft.com/services/live-share/) sessions
  - Adds the ability to move all of the columns, including the ones that were previously unmovable
  - Automatically switches column headers from text to icons when the column's width is too small for the text to be useful
  - Automatically switches the Author column to shows avatars rather than text when the column is sized to its minimum width
- Adds an experimental _Explain (AI)_ panel to the _Commit Details_ view to leverage OpenAI to provide an explanation of the changes of a commit
- Adds the ability to search stashes when using the commit search via the _Commit Graph_, _Search & Compare_ view, or the _Search Commits_ command
- Adds an _Open Visual File History_ command to the new _File History_ submenu on existing context menus
- Allows the _Repositories_ view for virtual repositories
- Honors the `git.repositoryScanIgnoredFolders` VS Code setting
- Adds _Share_, _Open Changes_, and _Open on Remote (Web)_ submenus to the new editor line numbers (gutter) context menu
- Adds an _Open Line Commit Details_ command to the _Open Changes_ submenus on editor context menus
- Adds an _Open Changes_ submenu to the row context menu on the _Commit Graph_

### Changed

- Refines and reorders many of the GitLens context menus and additions to VS Code context menus
  - Moves _Copy Remote \* URL_ commands from the _Copy As_ submenu into the _Share_ submenu in GitLens views
  - Adds a _Share_ submenu to Source Control items
  - Moves _Copy SHA_ and _Copy Message_ commands on commits from the _Copy As_ submenu into the root of the context menu
  - Moves _Copy Relative Path_ command on files from the _Copy As_ submenu into the root of the context menu
  - Moves file history commands into a _File History_ submenu
  - Moves _Open \* on Remote_ commands into _Open on Remote (Web)_ submenu
  - Renames the _Commit Changes_ submenu to _Open Changes_
  - Renames _Show Commit_ command to _Quick Show Commit_ and _Show Line Commit_ command to _Quick Show Line Commit_ for better clarity as it opens a quick pick menu
- Changes the file icons shown in many GitLens views to use the file type's theme icon (by default) rather than the status icon
  - Adds a `gitlens.views.commits.files.icon` setting to specify how the _Commits_ view will display file icons
  - Adds a `gitlens.views.repositories.files.icon` setting to specify how the _Repositories_ view will display file icons
  - Adds a `gitlens.views.branches.files.icon` setting to specify how the _Branches_ view will display file icons
  - Adds a `gitlens.views.remotes.files.icon` setting to specify how the _Remotes_ view will display file icons
  - Adds a `gitlens.views.stashes.files.icon` setting to specify how the _Stashes_ view will display file icons
  - Adds a `gitlens.views.tags.files.icon` setting to specify how the _Tags_ view will display file icons
  - Adds a `gitlens.views.worktrees.files.icon` setting to specify how the _Worktrees_ view will display file icons
  - Adds a `gitlens.views.contributors.files.icon` setting to specify how the _Contributors_ view will display file icons
  - Adds a `gitlens.views.searchAndCompare.files.icon` setting to specify how the _Search & Compare_ view will display file icons
- Renames _Delete Stash..._ command to _Drop Stash..._ in the _Stashes_ view
- Removes the commit icon when hiding avatars in the _Commits_ view to allow for a more compact layout
- Limits Git CodeLens on docker files &mdash; closes [#2153](https://github.com/gitkraken/vscode-gitlens/issues/2153)
- Shows progress notification for deep links earlier in the process &mdash; closes [#2662](https://github.com/gitkraken/vscode-gitlens/issues/2662)

### Fixed

- Fixes [#2664](https://github.com/gitkraken/vscode-gitlens/issues/2664) - Terminal run Git command can be "corrupted" if there is previous text waiting in the terminal
- Fixes [#2660](https://github.com/gitkraken/vscode-gitlens/issues/2660) - Commands executed in the terminal fail to honor found Git path
- Fixes [#2654](https://github.com/gitkraken/vscode-gitlens/issues/2654) - Toggle zen mode not working until you restart vscode
- Fixes [#2629](https://github.com/gitkraken/vscode-gitlens/issues/2629) - When on VSCode web, add handling for failing repo discovery
- Fixes many issues with using GitLens over [Visual Studio Live Share](https://visualstudio.microsoft.com/services/live-share/) sessions
- Fixes mouse scrubbing issues with the minimap on the _Commit Graph_
- Fixes _Refresh Repository Access_ and _Reset Repository Access Cache_ commands to always be available
- Fixes state not being restored on the Home webview
- Fixes getting the oldest unpushed commit when there is more than 1 remote
- Fixes an issue with the quick input on the _Git Command Palette_ unexpectedly going back to the previous step
- Fixes GitLens access tooltip not being visible when hovering in the _Commit Graph_
- Fixes last fetched messaging in the _Commit Graph_ when its never been fetched

### Removed

- Removes "Open Commit on Remote" command from the VS Code Timeline view as it can no longer be supported &mdash; see [microsoft/vscode/#177319](https://github.com/microsoft/vscode/issues/177319)

## [13.5.0] - 2023-04-07

### Added

- Adds the ability to switch to an alternate panel layout for the _Commit Graph_ &mdash; closes [#2602](https://github.com/gitkraken/vscode-gitlens/issues/2602) and [#2537](https://github.com/gitkraken/vscode-gitlens/issues/2537)
  - Adds a new context menu from the _Commit Graph Settings_ (cog) to switch between the "Editor" and "Panel" layouts
  - Adds a `gitlens.graph.layout` setting to specify the layout of the _Commit Graph_
    - `editor` - Shows the _Commit Graph_ in an editor tab
    - `panel` - Shows the _Commit Graph_ in the bottom panel with an additional _Commit Graph Details_ view alongside on the right
- Adds new _Commit Graph_ features and improvements
  - Adds a compact layout to the Graph column of the _Commit Graph_
    - Adds a context menu option to the header to toggle between the "Compact" and "Default" layouts &mdash; closes [#2611](https://github.com/gitkraken/vscode-gitlens/pull/2611)
  - Shows pull request icons on local branches when their upstream branch is associated with a pull request
  - Adds tooltips to work-in-progress (WIP) and stash nodes
  - Adds a "Publish Branch" context menu action to local branches without an upstream branch &mdash; closes [#2619](https://github.com/gitkraken/vscode-gitlens/pull/2619)
  - Lowers the minimum width of the "Branch / Tag" column
- Adds actions to _Focus_ Pull Requests
  - Switch to or create a local branch
  - Create or open a worktree from the branch
- Adds a _Generate Commit Message (Experimental)..._ command to the SCM context menus

### Changed

- Reduces the size of the GitLens (desktop) bundle which reduces memory usage and improves startup time &mdash; ~7% smaller (1.21MB -> 1.13MB)
  - Consolidates the "extension" side of all the GitLens webviews/webview-views into a unified controller and code-splits each webview/webview-view into its own bundle
    - Allows for very minimal code to be loaded for each webview/webview-view until its used, so if you never use a webview you never "pay" the cost of loading it
- Changes _Open Associated Pull Request_ command to support opening associated pull requests with the current branch or the HEAD commit if no branch association was found &mdash; closes [#2559](https://github.com/gitkraken/vscode-gitlens/issues/2559)
- Improves the "pinning" of the _Commit Details_ view
  - Avoids automatically pinning
  - Changes the pinned state to be much more apparent
- Changes _Commit Details_ to always open diffs in the same editor group as the currently active editor &mdash; closes [#2537](https://github.com/gitkraken/vscode-gitlens/issues/2537)

### Fixed

- Fixes [#2597](https://github.com/gitkraken/vscode-gitlens/issues/2597) - Allow disabling "Open worktree for pull request via GitLens..." from repository context menu
- Fixes [#2612](https://github.com/gitkraken/vscode-gitlens/issues/2612) - Clarify GitLens telemetry settings
- Fixes [#2583](https://github.com/gitkraken/vscode-gitlens/issues/2583) - Regression with _Open Worktree for Pull Request via GitLens..._ command
- Fixes [#2252](https://github.com/gitkraken/vscode-gitlens/issues/2252) - "Copy As"/"Copy Remote File Url" copies %23 instead of # in case of Gitea &mdash; thanks to [PR #2603](https://github.com/gitkraken/vscode-gitlens/pull/2603) by WofWca ([@WofWca](https://github.com/WofWca))
- Fixes [#2582](https://github.com/gitkraken/vscode-gitlens/issues/2582) - _Visual File History_ background color when in a panel
- Fixes [#2609](https://github.com/gitkraken/vscode-gitlens/issues/2609) - If you check out a branch that is hidden, GitLens should show the branch still
- Fixes [#2595](https://github.com/gitkraken/vscode-gitlens/issues/2595) - Error when stashing changes
- Fixes tooltips sometimes failing to show in _Commit Graph_ rows when the Date column is hidden
- Fixes an issue with incorrectly showing associated pull requests with branches that are partial matches of the true branch the pull request is associated with

## [13.4.0] - 2023-03-16

### Added

- Adds an experimental _Generate Commit Message (Experimental)_ command to use OpenAI to generate a commit message for staged changes
  - Adds a `gitlens.experimental.generateCommitMessagePrompt` setting to specify the prompt to use to tell OpenAI how to structure or format the generated commit message &mdash; can have fun with it and make your commit messages in the style of a pirate, etc
- Adds auto-detection for `.git-blame-ignore-revs` files and excludes the commits listed within from the blame annotations
- Adds a _Open Git Worktree..._ command to jump directly to opening a worktree in the _Git Command Palette_
- Adds a _Copy Relative Path_ context menu action for active editors and file nodes in sidebar views
- Adds the ability to see branches and tags on remote repositories (e.g. GitHub) on the _Commit Graph_
  - Currently limited to only showing them for commits on the current branch, as we aren't yet able to show all commits on all branches

### Changed

- Improves the display of items in the _Commit Graph_
  - When showing local branches, we now always display the upstream branches in the minimap, scrollbar markers, and graph rows
  - When laying out lanes in the Graph column, we now bias to be left aligned when possible for an easier to read and compact graph visualization
- Improves _Open Worktree for Pull Request via GitLens..._ command to use the qualified remote branch name, e.g. `owner/branch`, when creating the worktree
- Removes Insiders edition in favor of the pre-release edition

### Fixed

- Fixes [#2550](https://github.com/gitkraken/vscode-gitlens/issues/2550) - Related pull request disappears after refresh
- Fixes [#2549](https://github.com/gitkraken/vscode-gitlens/issues/2549) - toggle code lens does not work with gitlens.codeLens.enabled == false
- Fixes [#2553](https://github.com/gitkraken/vscode-gitlens/issues/2553) - Can't add remote url with git@ format
- Fixes [#2083](https://github.com/gitkraken/vscode-gitlens/issues/2083), [#2539](https://github.com/gitkraken/vscode-gitlens/issues/2539) - Fix stashing staged changes &mdash; thanks to [PR #2540](https://github.com/gitkraken/vscode-gitlens/pull/2540) by Nafiur Rahman Khadem ([@ShafinKhadem](https://github.com/ShafinKhadem))
- Fixes [#1968](https://github.com/gitkraken/vscode-gitlens/issues/1968) & [#1027](https://github.com/gitkraken/vscode-gitlens/issues/1027) - Fetch-> fatal: could not read Username &mdash; thanks to [PR #2481](https://github.com/gitkraken/vscode-gitlens/pull/2481) by Skyler Dawson ([@foxwoods369](https://github.com/foxwoods369))
- Fixes [#2495](https://github.com/gitkraken/vscode-gitlens/issues/2495) - Cannot use gitlens+ feature on public repo in some folders
- Fixes [#2530](https://github.com/gitkraken/vscode-gitlens/issues/2530) - Error when creating worktrees in certain conditions
- Fixed [#2566](https://github.com/gitkraken/vscode-gitlens/issues/2566) - hide context menu in output panel &mdash; thanks to [PR #2568](https://github.com/gitkraken/vscode-gitlens/pull/2568) by hahaaha ([@hahaaha](https://github.com/hahaaha))

## [13.3.2] - 2023-03-06

### Changed

- Reduces the size of the GitLens bundle which improves startup time
  - GitLens' extension bundle for desktop (node) is now ~24% smaller (1.58MB -> 1.21MB)
  - GitLens' extension bundle for web (vscode.dev/github.dev) is now ~6% smaller (1.32MB -> 1.24MB)

### Fixed

- Fixes [#2533](https://github.com/gitkraken/vscode-gitlens/issues/2533) - Current Branch Only graph filter sometimes fails
- Fixes [#2504](https://github.com/gitkraken/vscode-gitlens/issues/2504) - Graph header theme colors were referencing the titlebar color properties
- Fixes [#2527](https://github.com/gitkraken/vscode-gitlens/issues/2527) - shows added files for Open All Changes
- Fixes [#2530](https://github.com/gitkraken/vscode-gitlens/issues/2530) (potentially) - Error when creating worktrees in certain conditions
- Fixes an issue where trial status can be shown rather than a purchased license

## [13.3.1] - 2023-02-24

### Fixed

- Fixes graph issue where scroll markers do not update until mouseover when changing the `gitlens.graph.scrollMarkers.additionalTypes` setting.

## [13.3.0] - 2023-02-23

### Added

- ✨ Adds a preview of the all-new **Focus**, a [GitLens+ feature](https://gitkraken.com/gitlens/pro-features) &mdash; provides you with a comprehensive list of all your most important work across your connected GitHub repos:
  - My Pull Requests: shows all GitHub PRs opened by you, assigned to you, or awaiting your review
  - My Issues: shows all issues created by you, assigned to you, or that mention you
  - Open it via _GitLens+: Show Focus_ from the Command Palette
- Adds new _Commit Graph_ features and improvements
  - Adds a new experimental minimap of commit activity to the _Commit Graph_
  - Adds a new experimental _Changes_ column visualizing commit changes
  - Adds markers to the _Commit Graph_ scroll area indicating the location of the selected row, search results, current branch, upstream, and more
  - Adds the ability to show upstream (ahead/behind) status on local branches with an upstream
    - Adds a double-click action on the status to pull (when behind) or push (when ahead) pending changes
    - Adds context menu actions to _Push_, _Pull_, and _Fetch_ the local branch
    - Adds a `gitlens.graph.showUpstreamStatus` setting to toggle upstream (ahead/behind) indicators on branches
  - Adds the ability to show any associated pull requests with branches
    - Adds a double-click action on the PR icon to open the PR in the browser
    - Adds context menu actions to _Open Pull Request on Remote_ and _Copy_ the PR URL
    - Adds a `gitlens.graph.pullRequests.enabled` setting to toggle PR icons &mdash; closes [#2450](https://github.com/gitkraken/vscode-gitlens/issues/2450)
  - Adds a context menu to the WIP row &mdash; closes [#2458](https://github.com/gitkraken/vscode-gitlens/issues/2458)
  - Adds a double-click action on commit rows to open the _Commit Details_ view
  - Improves Author and Avatar tooltips to now also show the contributor's email address, if available
  - Improves Date tooltips to now always show both the absolute and relative date
- Adds the ability to copy and share links directly to repositories, branches, commits, and tags in the _Commit Graph_
  - Adds context menu actions to copy direct links in the _Share_ submenu
- Improves the Worktree creation experience
  - Adds a prompt after the worktree is created to choose how to open the worktree
    - Adds a `worktrees.openAfterCreate` setting to specify how and when to open a worktree after it is created
  - Ensures new worktrees are created from the "main" repo, if already in a worktree
- Adds a new _remote_ command to the _Git Command Palette_ to add, prune, and remove remotes
- Adds a _Open Worktree for Pull Request via GitLens..._ context menu command on pull requests in the _GitHub Pull Requests and Issues_ extension's views
  - Opens an associated worktree, if one exists, otherwise it creates a new worktree for the pull request
- Adds settings to control the format of commits in the GitLens views

### Changed

- Greatly reduces the size of many of GitLens' bundles which improves startup time
  - GitLens' extension bundle for desktop (node) is now ~18% smaller (1.91MB -> 1.57MB)
  - GitLens' extension bundle for web (vscode.dev/github.dev) is now ~37% smaller (2.05MB -> (1.30MB)
  - GitLens' Commit Graph webview bundle is now ~31% smaller (1.03MB -> 734KB)
- Changes the _Contributors_ view to be shown by default on the _GitLens_ sidebar

### Removed

- Removes the use of an external color library for the _File Heatmap_ annotations and webview themes &mdash; reduces the bundled extension size

### Fixed

- Fixes [#2355](https://github.com/gitkraken/vscode-gitlens/issues/2355) - Search by changes stops working in version 13.x.x
- Fixes [#2473](https://github.com/gitkraken/vscode-gitlens/issues/2473) - Commit graph status bar show wrong last fetched date
- Fixes [#2409](https://github.com/gitkraken/vscode-gitlens/issues/2409) - Commit Graph Show Current Branch Only shows unrelated commits from other branches
- Fixes an issue where pinning not being respected in Commit Details view
- Fixes graph issue where search results that are merge commits are not highlighted when the `gitlens.graph.dimMergeCommits` setting is enabled
- Fixes graph issue where rows with tags belonging to a hovered branch are not highlighted when the `gitlens.graph.highlightRowsOnRefHover` setting is enabled

## [13.2.0] - 2022-12-20

### Added

- Adds many all-new _Commit Graph_ features and improvements
  - Adds the ability to filter commits, branches, stashes, and tags
    - Adds a new _Filter Graph_ dropdown button at the start of the search bar
    - Adds ability to quickly switch between _Show All Local Branches_ and _Show Current Branch Only_ branch filtering options
      - _Show All Local Branches_ &mdash; displays all local branches (default)
      - _Show Current Branch Only_ &mdash; displays only the current branch and it's upstream remote (if exists and _Hide Remote Branches_ isn't enabled)
    - Adds ability to hide all remote branches, stashes, and tags
    - Adds the ability to dim (deemphasize) merge commits
  - Adds a new header bar to provide quick access to common actions
    - Shows the currently selected repository with the ability to switch repositories when clicked (if multiple repositories are open)
    - Shows the current branch with the ability to switch branches when clicked
    - Provides a fetch action which also shows the last fetched time
    - Also, moves GitLens+ feature status and feedback links to the top right
  - Adds new ability to reorder columns by dragging and dropping column headers (not all columns are reorderable)
  - Adds new keyboard shortcuts
    - Use `shift+down arrow` and `shift+up arrow` to move to the parent/child of the selected commit row
    - Holding the `ctrl` key with a commit row selected will highlight rows for that commit's branch
  - Adds new settings
    - Adds a `gitlens.graph.dimMergeCommits` setting to specify whether to dim (deemphasize) merge commit rows
    - Adds a `gitlens.graph.scrollRowPadding` setting to specify the number of rows from the edge at which the graph will scroll when using keyboard or search to change the selected row

### Changed

- Increases the delay to highlight associated rows when hovering over a branch to 1s in the _Commit Graph_

### Removed

- Removes the status bar from the _Commit Graph_ as it was replaced by the new header bar

### Fixed

- Fixes [#2394](https://github.com/gitkraken/vscode-gitlens/issues/2394) - Work in progress file diff compares working tree with working tree, instead of working tree with head
- Fixes [#2207](https://github.com/gitkraken/vscode-gitlens/issues/2207) - Error when trying to push individual commit
- Fixes [#2301](https://github.com/gitkraken/vscode-gitlens/issues/2301) - Create Worktree button doesn't work in certain cases
- Fixes [#2382](https://github.com/gitkraken/vscode-gitlens/issues/2382) - commits disappearing from commit details view when they shouldn't
- Fixes [#2318](https://github.com/gitkraken/vscode-gitlens/issues/2318) - GitLens need to login again after VS Code insiders upgrade every day
- Fixes [#2377](https://github.com/gitkraken/vscode-gitlens/issues/2377) - Missing Azure Devops Icon
- Fixes [#2380](https://github.com/gitkraken/vscode-gitlens/issues/2380) - Autolink fails with curly braces
- Fixes [#2362](https://github.com/gitkraken/vscode-gitlens/issues/2362) - Visual File History becomes unavailable when the workspace contains private repo
- Fixes [#2381](https://github.com/gitkraken/vscode-gitlens/issues/2381) - can't use scrollbar in 'Commit Graph' view
- Fixes an issue where focusout hides toolbar actions for the graph
- Fixes an issue where _Switch to Another Branch..._ doesn't work in the Graph editor toolbar
- Fixes graph issue with row highlighting/dimming sticking when the graph loses focus
- Fixes graph issue with branches remaining hovered/extended when the mouse leaves the graph

## [13.1.1] - 2022-11-21

### Fixed

- Fixes [#2354](https://github.com/gitkraken/vscode-gitlens/issues/2354) - 'GitLens: Compare working three with...' Not able to select branch using keyboard
- Fixes [#2359](https://github.com/gitkraken/vscode-gitlens/issues/2359) - rebase view shows 2 user icons even when they're the same

## [13.1.0] - 2022-11-17

### Added

- Adds _Commit Graph_ enhancements
  - Adds the ability to set keyboard shortcuts to commits and stashes on the _Commit Graph_ &mdash; closes [#2345](https://github.com/gitkraken/vscode-gitlens/issues/2345)
    - Keyboard shortcuts can be applied to many of the `gitlens.graph.*` commands and should use `gitlens:webview:graph:focus && !gitlens:webview:graph:inputFocus` for their "When Expression" to only apply when the _Commit Graph_ is focused
    - For example, add the following to your `keybindings.json` to allow <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy the selected commit's SHA to the clipboard
      ```json
      {
      	"key": "ctrl+c",
      	"command": "gitlens.graph.copySha",
      	"when": "gitlens:webview:graph:focus && !gitlens:webview:graph:inputFocus"
      }
      ```
  - Automatically selects the `HEAD` commit in the _Commit Graph_ when switching branches
  - Improves performance of updating the _Commit Graph_ when the repository changes
  - Improves performance by avoiding unnecessary updates to the _Commit Details_ view when selection changes
  - Adds a `@me` search filter to the search box
  - Adds history navigation to the search box in the _Commit Graph_
    - When the search field is focused, use the `up arrow` and `down arrow` to navigate through any previous searches that yielded results
  - Adds ability to reset to any commit in the _Commit Graph_ and GitLens views &mdash; closes [#2326](https://github.com/gitkraken/vscode-gitlens/issues/2326)
- Adds _Interactive Rebase Editor_ performance and UX improvements
  - Changes the header and footer to always be visible
  - Shows the _Commit Details_ view on commit selection
    - Adds a `gitlens.rebaseEditor.showDetailsView` setting to specify when to show the _Commit Details_ view for the selected row in the _Interactive Rebase Editor_
  - Adds full (multiline) commit message
  - Adds the `f` fixup shortcut key to UI
  - Consolidates the UI for author and committer information into a stack of avatars
  - Adds emoji support for commit messages &mdash; closes [#1789](https://github.com/gitkraken/vscode-gitlens/issues/1789)
  - Ensures that large rebases show rich commit details
- Adds _Commit Details_ view improvements
  - Adds custom and non-rich integration-based autolinks and improves autolink display
  - Improves performance by avoiding unnecessary updates
  - Avoids "pinning" commits by default when opened from the _Commit Graph_, _Visual File History_, quick picks, etc
  - Adds a _Open in Commit Graph_ button even when showing uncommitted changes
- Adds new sections and settings to the GitLens Interactive Settings
  - Adds a new _Commit Details_ view section
  - Adds a new _Terminal Links_ section
  - Adds autolink configuration to the _Hovers_ section
- Adds a `@me` search filter to commit search in the _Search & Compare_ view and quick pick
- Adds product usage telemetry
  - Honors the overall VS Code telemetry settings and add a `gitlens.telemetry.enabled` setting opt-out specifically for GitLens

### Changed

- Changes the _Home_ view to always be available and polishes the experience
- Changes SHA terminal links to use the _Commit Details_ view &mdash; closes [#2320](https://github.com/gitkraken/vscode-gitlens/issues/2320)
  - Adds a `gitlens.terminalLinks.showDetailsView` setting to specify whether to show the _Commit Details_ view when clicking on a commit link
- Changes to uses VS Code as Git's `core.editor` for terminal run commands &mdash; closes [#2134](https://github.com/gitkraken/vscode-gitlens/issues/2134) thanks to [PR #2135](https://github.com/gitkraken/vscode-gitlens/pull/2135) by Nafiur Rahman Khadem ([@ShafinKhadem](https://github.com/ShafinKhadem))
  - Adds a `gitlens.terminal.overrideGitEditor` setting to specify whether to use VS Code as Git's `core.editor` for GitLens terminal commands
- Polishes webview (_Commit Graph_, _Interactive Rebase Editor_, etc) scroll bars to match VS Code's style and behavior

### Fixed

- Fixes [#2339](https://github.com/gitkraken/vscode-gitlens/issues/2339) - Commit details "Autolinks" group shows wrong count
- Fixes [#2346](https://github.com/gitkraken/vscode-gitlens/issues/2346) - Multiple cursors on the same line duplicate inline annotations &mdash; thanks to [PR #2347](https://github.com/gitkraken/vscode-gitlens/pull/2347) by Yonatan Greenfeld ([@YonatanGreenfeld](https://github.com/YonatanGreenfeld))
- Fixes [#2344](https://github.com/gitkraken/vscode-gitlens/issues/2344) - copying abbreviated commit SHAs is not working
- Fixes [#2342](https://github.com/gitkraken/vscode-gitlens/issues/2342) - Local remotes are incorrectly treated as private
- Fixes [#2052](https://github.com/gitkraken/vscode-gitlens/issues/2052) - Interactive Rebase fails to start when using xonsh shell due to command quoting
- Fixes [#2141](https://github.com/gitkraken/vscode-gitlens/issues/2141) - GitLens' rebase UI randomly fails loading interactive rebase when performed outside of VSC
- Fixes [#1732](https://github.com/gitkraken/vscode-gitlens/issues/1732) - Phantom rebase-merge directory (`rm -rf ".git/rebase-merge"`)
- Fixes [#1652](https://github.com/gitkraken/vscode-gitlens/issues/1652) - Closing interactive rebase editor after "git rebase --edit" aborts rebase-in-progress
- Fixes [#1549](https://github.com/gitkraken/vscode-gitlens/issues/1549) - Fetch does not work when local branch name differs from remote branch name
- Fixes [#2292](https://github.com/gitkraken/vscode-gitlens/issues/2292) - Push button in BranchTrackingStatusNode of non-current branch does not trigger "Push force"
- Fixes [#1488](https://github.com/gitkraken/vscode-gitlens/issues/1488) - Open Folder History not working with non-English language pack
- Fixes [#2303](https://github.com/gitkraken/vscode-gitlens/issues/2303) - "Googlesource" gerrit only supports two levels of domain &mdash; thanks to [PR #2304](https://github.com/gitkraken/vscode-gitlens/pull/2304) by Matt Buckley ([@Mattadore](https://github.com/Mattadore))
- Fixes [#2315](https://github.com/gitkraken/vscode-gitlens/issues/2315) - Commit details secondary side bar banner doesn't stay dismissed
- Fixes [#2329](https://github.com/gitkraken/vscode-gitlens/issues/2329) - Remember UI settings in Commit Details panel
- Fixes [#1606](https://github.com/gitkraken/vscode-gitlens/issues/1606) - Adjusts capitalization of "URL" &mdash; thanks to [PR #2341](https://github.com/gitkraken/vscode-gitlens/pull/2341) by Dave Nicolson ([@dnicolson](https://github.com/dnicolson))
- Fixes issue where we weren't honoring the default gravatar style (`gitlens.defaultGravatarsStyle`) in certain cases
- Fixes graph issue where stashes are sometimes assigned the wrong column
- Fixes graph issue with commit rows being incorrectly hidden in some cases
- Fixes graph issue with merge commits not being hidden correctly in some cases
- Fixes some graph issues with hover on branch/tag labels

## [13.0.4] - 2022-11-03

### Fixed

- Fixes [#2298](https://github.com/gitkraken/vscode-gitlens/issues/2298) - Commit Graph does not update to current branch correctly
- Fixes [#2300](https://github.com/gitkraken/vscode-gitlens/issues/2300) - extra non-functional toolbar buttons when viewing PR diffs in VSCode web
- Fixes [#2281](https://github.com/gitkraken/vscode-gitlens/issues/2281) - Push and Pull buttons missing from the commits view w/ integrations disabled
- Fixes [#2276](https://github.com/gitkraken/vscode-gitlens/issues/2276) - Search commit by Sha not working in Gitlens side bar
- Fixes issues with PR uris (scheme: `pr`) from not working properly, especially with virtual repositories

## [13.0.3] - 2022-10-20

### Added

- Adds a banner to the _Commit Details_ view to let users know they can move the view to the Secondary Side Bar

### Changed

- Changes the _Commit Graph_ settings for improved clarity and ordering

### Fixed

- Fixes [#2271](https://github.com/gitkraken/vscode-gitlens/issues/2271) - Terminal commands should wrap path with quote to deal with path contains space
- Fixes an issue where the _Commit Details_ view fails to show the full commit message and changed files when following editor lines

## [13.0.2] - 2022-10-17

### Added

- ✨ All GitLens+ features on public and local repos are now available to everyone &mdash; no account required!
  - We are excited to bring the power of GitLens+ features to more people without gates
- ✨ Commit Graph is out of preview!
  - Contextual right-click menus with popular actions for commits, branches, tags, and authors
  - Double-click on a branch or tag to quickly switch your working tree to it
  - Rich search features to find exactly what you're looking for:
    - Powerful filters to search by commit, message, author, a changed file or files, or even a specific code change
    - Searches look at ALL commits in a repository, not just what's shown in the graph
  - PR support for connected rich integrations (GitHub/GitLab)
  - Significant performance improvements when opening the graph and loading in additional commits
  - Personalization of your graph experience
    - Show and hide remotes, branches, tags, and columns
    - Settings UI for easy fine-grain control over advanced settings
  - And so much more!
- Adds an all-new GitLens _Home_ view to help you get started with GitLens and GitLens+ features
- Adds autolinks and improves formatting of the commit message in the _Commit Details_ view
- Adds `View as Tree` toggle option for changed files in the _Commit Details_ view
- Adds an `Open in Commit Graph` action to branches, commits, stashes, and tags in GitLens views, hovers, and commit quick pick menus
- Adds a `Reveal in Side Bar` action to hovers

### Changed

- Changes the `Show Commit` action in the hovers to `Open Details` and opens the _Commit Details_ view

### Fixed

- Fixes [#2203](https://github.com/gitkraken/vscode-gitlens/issues/2203) - Autolinks missing under commit details
- Fixes [#2230](https://github.com/gitkraken/vscode-gitlens/issues/2230) - j and k are inverted in ascending rebase order
- Fixes [#2195](https://github.com/gitkraken/vscode-gitlens/issues/2195) - Cannot open new files from commit details
- Fixes Commit Details view showing incorrect diffs for certain commits
- Fixes Commit Details view showing incorrect actions for uncommitted changes
- Fixes prioritization of multiple PRs associated with the same commit to choose a merged PR over others
- Fixes Graph not showing account banners when access is not allowed and trial banners were previously dismissed

## [12.2.2] - 2022-09-06

### Fixed

- Fixes [#2177](https://github.com/gitkraken/vscode-gitlens/issues/2177) - Open Changes action unresponsive in Source Control view
- Fixes [#2185](https://github.com/gitkraken/vscode-gitlens/issues/2185) - Commits view files are sometimes not shown when expanding folders
- Fixes [#2180](https://github.com/gitkraken/vscode-gitlens/issues/2180) - Tree files view of commits is broken
- Fixes [#2187](https://github.com/gitkraken/vscode-gitlens/issues/2187) - scm/title commands shown against non-Git SCM providers &mdash; thanks to [PR #2186](https://github.com/gitkraken/vscode-gitlens/pull/2186) by Matt Seddon ([@mattseddon](https://github.com/mattseddon))

## [12.2.1] - 2022-09-01

### Fixed

- Fixes [#2185](https://github.com/gitkraken/vscode-gitlens/issues/2185) - Commits view files are sometimes not shown when expanding folders
- Fixes [#2180](https://github.com/gitkraken/vscode-gitlens/issues/2180) - Tree files view of commits is broken
- Fixes [#2179](https://github.com/gitkraken/vscode-gitlens/issues/2179) - Commit Graph content not displayed
- Fixes regression with _Contributors_ view not working

## [12.2.0] - 2022-08-30

### Added

- ✨ Adds an all-new [**Commit Graph**](https://github.com/gitkraken/vscode-gitlens#commit-graph-), a [GitLens+ feature](https://gitkraken.com/gitlens/pro-features) &mdash; helps you to easily visualize branch structure and commit history. Not only does it help you verify your changes, but also easily see changes made by others and when
  ![Commit Graph illustration](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commit-graph-illustrated.png)
- Adds a [**Commit Details view**](https://github.com/gitkraken/vscode-gitlens#commit-details-view-) &mdash; provides rich details for commits and stashes
  - Contextually updates as you navigate:
    - lines in the text editor
    - commits in the _Commit Graph_, _Visual File History_, or _Commits_ view
    - stashes in the _Stashes_ view
  - Alternatively, you can search for or choose a commit directly from the view
- ✨ Adds [**rich integration**](https://github.com/gitkraken/vscode-gitlens#remote-provider-integrations-) with GitHub Enterprise &mdash; closes [#1210](https://github.com/gitkraken/vscode-gitlens/issues/1210)
  - Adds associated pull request to line annotations and hovers
    ![Pull requests on line annotation and hovers](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/hovers-current-line-details.png)
  - Adds associated pull request to status bar blame
    ![Pull requests on status bar](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/status-bar.png)
  - Adds GitHub avatars
  - Adds associated pull requests to branches and commits in GitLens views
  - Adds rich autolinks for GitHub issues and merge requests, including titles, status, and authors
  - Adds rich support to _Autolinked Issues and Pull Requests_ within comparisons to list autolinked GitHub issues and merge requests in commit messages
- Adds new stash behaviors to use the Source Control (commit message) input box &mdash; closes [#2081](https://github.com/gitkraken/vscode-gitlens/issues/2081)
  - When a stash is applied or popped and the Source Control input is empty, we will now update the Source Control input to the stash message
  - When stashing changes and the Source Control input is not empty, we will now default the stash message input to the Source Control input value
- Adds the ability to search (<kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>F</kbd>) for text on the Interactive Rebase Editor &mdash; closes [#2050](https://github.com/gitkraken/vscode-gitlens/issues/2050)
- Adds stats (additions & deletions) to files nodes in comparisons &mdash; closes [#2078](https://github.com/gitkraken/vscode-gitlens/issues/2078) thanks to help via [PR #2079](https://github.com/gitkraken/vscode-gitlens/pull/2079) by Nafiur Rahman Khadem ([@ShafinKhadem](https://github.com/ShafinKhadem))
- Adds the ability to uniquely format uncommitted changes for the current line blame annotations &mdash; closes [#1987](https://github.com/gitkraken/vscode-gitlens/issues/1987)
  - Adds a `gitlens.currentLine.uncommittedChangesFormat` setting to specify the uncommitted changes format of the current line blame annotation. **NOTE**: Setting this to an empty string will disable current line blame annotations for uncommitted changes
- Adds variable expansion support to the `gitlens.worktrees.defaultLocation` setting
  - `${userHome}` &mdash; the path of the user's home folder
  - `${workspaceFolder}` &mdash; the path of the folder opened in VS Code containing the specified repository
  - `${workspaceFolderBasename}` &mdash; the name of the folder opened in VS Code containing the specified repository without any slashes (/)
- Adds owner avatars to remotes in the _Remotes_ view for GitHub remotes

### Changed

- Greatly improves performance of many view interactions when connected to a rich integration and pull request details are enabled, including:
  - Showing and refreshing the _Commits_ view
  - Expanding commits, branches, and worktrees
- Remembers chosen filter on files nodes in comparisons when refreshing
- Changes display of filtered state of files nodes in comparisons
- Improves diff stat parsing performance and reduced memory usage
- Disallows comparisons with the working tree on the right-side (left-side still works as expected) and disables swapping
- Uses VS Code as `core.editor` in rebase &mdash; closes [#2084](https://github.com/gitkraken/vscode-gitlens/issues/2084) thanks to [PR #2085](https://github.com/gitkraken/vscode-gitlens/pull/2085) by Nafiur Rahman Khadem ([@ShafinKhadem](https://github.com/ShafinKhadem))

### Fixed

- Fixes [#2017](https://github.com/gitkraken/vscode-gitlens/issues/2017) - Gitlens+ pro keeps signing out
- Fixes [#1935](https://github.com/gitkraken/vscode-gitlens/issues/1935) - Constant prompt "Your github credentials do not have the required access"
- Fixes [#2067](https://github.com/gitkraken/vscode-gitlens/issues/2067) - Your 'github' credentials are either invalid or expired
- Fixes [#2167](https://github.com/gitkraken/vscode-gitlens/issues/2167) - Rollup diff between working tree and fetched remote doesn't show changes
- Fixes [#2166](https://github.com/gitkraken/vscode-gitlens/issues/2166) - Don't always prompt for GitHub authentication on virtual repositories
- Fixes [#2156](https://github.com/gitkraken/vscode-gitlens/issues/2156) - Reduce extension package size
- Fixes [#2136](https://github.com/gitkraken/vscode-gitlens/issues/2136) - Search & Compare quickpick shouldn't select the mode text when opening
- Fixes [#1896](https://github.com/gitkraken/vscode-gitlens/issues/1896) - Cannot read property 'fsPath' of undefined
- Fixes [#1550](https://github.com/gitkraken/vscode-gitlens/issues/1550) - Push button in commit widget does not trigger "Push force" when ALT is pressed.
- Fixes [#1991](https://github.com/gitkraken/vscode-gitlens/issues/1991) - Git lens status bar entry has an incomprehensible accessibility label
- Fixes [#2125](https://github.com/gitkraken/vscode-gitlens/issues/2125) - "git log" command in version 12.x is very slow
- Fixes [#2121](https://github.com/gitkraken/vscode-gitlens/issues/2121) - Typo in GitLens header &mdash; thanks to [PR #2122](https://github.com/gitkraken/vscode-gitlens/pull/2122) by Chase Knowlden ([@ChaseKnowlden](https://github.com/ChaseKnowlden))
- Fixes [#2082](https://github.com/gitkraken/vscode-gitlens/issues/2082) - GitLens Home view unreadable in certain themes
- Fixes [#2070](https://github.com/gitkraken/vscode-gitlens/issues/2070) - Quoted HTML / JSX syntax is not escaped correctly
- Fixes [#2069](https://github.com/gitkraken/vscode-gitlens/issues/2069) - Heatmap - incorrect behavior of gitlens.heatmap.fadeLines with gitlens.heatmap.ageThreshold
- Fixes an issue where choosing "Hide Current Branch Pull Request" from the _Commits_ view overflow menu wouldn't hide the PR node
- Fixes an issue where stashes without a message aren't displayed properly
- Fixes an issue where the _Stashes_ view empty state isn't displayed properly when there are no stashes
- Fixes typos via [PR #2086](https://github.com/gitkraken/vscode-gitlens/pull/2086) by stampyzfanz ([@stampyzfanz](https://github.com/stampyzfanz)), and [PR #2043](https://github.com/gitkraken/vscode-gitlens/pull/2043), [PR #2040](https://github.com/gitkraken/vscode-gitlens/pull/2040), [PR #2042](https://github.com/gitkraken/vscode-gitlens/pull/2042) by jogo- ([@jogo-](https://github.com/jogo-))

## [12.1.2] - 2022-07-12

### Fixed

- Fixes [#2048](https://github.com/gitkraken/vscode-gitlens/issues/2048) - Gitlens not loading in vscode.dev

## [12.1.1] - 2022-06-16

### Added

- Adds getting started tutorial video to the Welcome, Get Started walkthrough, GitLens Home view, and README

### Fixed

- Fixes [#2037](https://github.com/gitkraken/vscode-gitlens/issues/2037) - Autolinks can end up getting saved with invalid (cached) properties

## [12.1.0] - 2022-06-14

### Added

- ✨ Adds [**rich integration**](https://github.com/gitkraken/vscode-gitlens#remote-provider-integrations-) with GitLab and GitLab self-managed instances &mdash; closes [#1236](https://github.com/gitkraken/vscode-gitlens/issues/1236)
  - Adds associated pull request to line annotations and hovers
    ![Pull requests on line annotation and hovers](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/hovers-current-line-details.png)
  - Adds associated pull request to status bar blame
    ![Pull requests on status bar](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/status-bar.png)
  - Adds GitLab avatars
  - Adds associated pull requests to branches and commits in GitLens views
  - Adds rich autolinks for GitLab issues and merge requests, including titles, status, and authors
  - Adds rich support to _Autolinked Issues and Pull Requests_ within comparisons to list autolinked GitLab issues and merge requests in commit messages
  - Additional thanks to Kevin Paxton ([kpaxton](https://github.com/kpaxton)) for help and contributions on this feature
- Adds editor line highlighting and code fading (dimming) to the _File Heatmap_ annotations to make it easier to tell recent vs old lines of code
  - Adds a `line` option to `gitlens.heatmap.locations` setting to specify whether to add a line highlight to the _File Heatmap_ annotations
  - Adds a `gitlens.heatmap.fadeLines` setting to specify whether to fade out older lines when showing the _File Heatmap_ annotations
- Adds editor line highlighting to the _File Changes_ annotations for easier discovery of the added or changed lines
  - Adds a `line` option to `gitlens.changes.locations` setting to specify whether to add a line highlight to the _File Changes_ annotations
- Adds "vanilla" [Gerrit](https://www.gerritcodereview.com/) remote provider support &mdash; closes [#1953](https://github.com/gitkraken/vscode-gitlens/issues/1953) thanks to [PR #1954](https://github.com/gitkraken/vscode-gitlens/pull/1954) by Felipe Santos ([@felipecrs](https://github.com/felipecrs))
- Adds "Oldest first" toggle to Interactive Rebase &mdash; closes [#1190](https://github.com/gitkraken/vscode-gitlens/issues/1190)
  - Adds a `gitlens.rebaseEditor.ordering` setting to specify how Git commits are displayed in the _Interactive Rebase Editor_
- Adds new and improved Autolink support
  - Adds an _Autolinks_ section in the _GitLens Settings Editor_ to visually add and update autolink entries &mdash; closes [#1315](https://github.com/gitkraken/vscode-gitlens/issues/1315)
  - Adds improved support to _Autolinked Issues and Pull Requests_ within comparisons to list autolinked issues in commit messages
    - You can now see all autolinks found in the commits in the comparison regardless of whether it's a provider-based autolink or a custom (user-provided) autolink
- Adds _Open Current Branch on Remote_ to the Command Palette &mdash; closes [#1718](https://github.com/gitkraken/vscode-gitlens/issues/1718)

### Changed

- Improves how stashes are shown in the _Stashes_ view by separating the associated branch from the stash message &mdash; closes [#1523](https://github.com/gitkraken/vscode-gitlens/issues/1523)
- Changes previous Gerrit remote support to Google Source remote support &mdash; thanks to [PR #1954](https://github.com/gitkraken/vscode-gitlens/pull/1954) by Felipe Santos ([@felipecrs](https://github.com/felipecrs))
- Renames "Gutter Blame" annotations to "File Blame"
- Renames "Gutter Changes" annotations to "File Changes"
- Renames "Gutter Heatmap" annotations to "File Heatmap"

### Fixed

- Fixes [#2033](https://github.com/gitkraken/vscode-gitlens/issues/2033) - Diffing, applying, and restoring untracked files in a stash doesn't work
- Fixes [#2028](https://github.com/gitkraken/vscode-gitlens/issues/2028) - Branch names with special characters '<' also causes errors on the command line &mdash; thanks to [PR #2030](https://github.com/gitkraken/vscode-gitlens/pull/2030) by mcy-kylin ([@mcy-kylin](https://github.com/mcy-kylin))
- Fixes [#2028](https://github.com/gitkraken/vscode-gitlens/issues/2028) - Branch names with special characters like ';$|>' causes errors on the command line (terminal executed git commands)
- Fixes [#2021](https://github.com/gitkraken/vscode-gitlens/issues/2021) - GitLab remote provider uses legacy routes &mdash; thanks to [PR #2022](https://github.com/gitkraken/vscode-gitlens/pull/2022) by Brian Williams ([@Brcrwilliams](https://github.com/Brcrwilliams))
- Fixes [#1998](https://github.com/gitkraken/vscode-gitlens/issues/1998) - Settings: time format reads 'Example date' instead of 'Example time' &mdash; thanks to [PR #1999](https://github.com/gitkraken/vscode-gitlens/pull/1999) by Barney Carroll ([@barneycarroll](https://github.com/barneycarroll))
- Fixes [#2012](https://github.com/gitkraken/vscode-gitlens/issues/2012) - 'Gitlens: Open Changes with Revision...' results in error
- Fixes [#2014](https://github.com/gitkraken/vscode-gitlens/issues/2014) - '#' encoded incorrectly
- Fixes [#1787](https://github.com/gitkraken/vscode-gitlens/issues/1787) - Remove '-review' from Gerrit Remote reviewDomain() &mdash; thanks to [PR #1954](https://github.com/gitkraken/vscode-gitlens/pull/1954) by Felipe Santos ([@felipecrs](https://github.com/felipecrs))
- Fixes [#1902](https://github.com/gitkraken/vscode-gitlens/issues/1902) - Support replacing mirror/replica domain with main domain for remote provider &mdash; thanks to [PR #1954](https://github.com/gitkraken/vscode-gitlens/pull/1954) by Felipe Santos ([@felipecrs](https://github.com/felipecrs))

## [12.0.7] - 2022-05-25

### Fixed

- Fixes [#1979](https://github.com/gitkraken/vscode-gitlens/issues/1979) - GitLens stopped working in v12.0.0 and later
- Fixes [#1882](https://github.com/gitkraken/vscode-gitlens/issues/1882) - Blame annotations not showing anymore after update
- Fixes [#1776](https://github.com/gitkraken/vscode-gitlens/issues/1776) - Can't follow symlinks
- Fixes [#2000](https://github.com/gitkraken/vscode-gitlens/issues/2000) - File Changes annotations fail to display in certain cases
- Fixes [#1936](https://github.com/gitkraken/vscode-gitlens/issues/1936) - Broken repositories view
- Fixes an issue where commit messages in views incorrectly had ellipsis at the end
- Fixes an issue where clicking on tokens on the Settings editor popup wouldn't add the token into the input

## [12.0.6] - 2022-04-12

### Fixed

- Fixes [#1928](https://github.com/gitkraken/vscode-gitlens/issues/1928) - Unable to get absolute uri between ex.txt and z:; Base path 'z:' must be an absolute path &mdash; thanks to [PR #1929](https://github.com/gitkraken/vscode-gitlens/pull/1929) by Ross Smith II ([@rasa](https://github.com/rasa))
- Fixes [#1932](https://github.com/gitkraken/vscode-gitlens/issues/1932) - Pull request autolink doesn't work for Bitbucket Server 7 &mdash; thanks to [PR #1933](https://github.com/gitkraken/vscode-gitlens/pull/1933) by Sam Martin ([@smartinio](https://github.com/smartinio))
- Fixes [#1938](https://github.com/gitkraken/vscode-gitlens/issues/1938) - Git CodeLens causes line jumping on new virtual files
- Fixes [#1925](https://github.com/gitkraken/vscode-gitlens/issues/1925) - Branches from remotes outside the repo aren't showing associated pull requests (for connected remotes)
- Fixes [#1920](https://github.com/gitkraken/vscode-gitlens/issues/1920) - Can't view tags on torvalds/linux
- Fixes [#1923](https://github.com/gitkraken/vscode-gitlens/issues/1923) - View titles fail to update properly when number of "opened" repos changes
- Fixes smooth scrolling and TOC jumping issues on the GitLens Interactive Settings

## [12.0.5] - 2022-03-17

### Changed

- Changes the current line blame hover to show at the cursor, rather than the start of the line, when showing the hover over the whole line (e.g. line & annotation)
- Changes [**_Gutter Changes_**](https://github.com/gitkraken/vscode-gitlens#gutter-changes-) file annotations to be theme-aware
- Changes to honor the new(ish) `git.repositoryScanMaxDepth` setting if the `gitlens.advanced.repositorySearchDepth` setting isn't specified

### Fixed

- Fixes [#1909](https://github.com/gitkraken/vscode-gitlens/issues/1909) - Should still "detect" repos directly in the workspace folder(s) even if `git.autoRepositoryDetection` is `false`
- Fixes [#1829](https://github.com/gitkraken/vscode-gitlens/issues/1829) - Reduce re-rendering by disabling animation in blame info in the status bar
- Fixes [#1864](https://github.com/gitkraken/vscode-gitlens/issues/1864) - Worktrees fail to load in working path with spaces
- Fixes [#1881](https://github.com/gitkraken/vscode-gitlens/issues/1881) - Worktrees icon is very small
- Fixes [#1898](https://github.com/gitkraken/vscode-gitlens/issues/1898) - Hovers display old Gravatar &mdash; thanks to [PR #1899](https://github.com/gitkraken/vscode-gitlens/pull/1899) by Leo Dan Peña ([@amouxaden](https://github.com/amouxaden))
- Fixes an issue where the [**_Gutter Changes_**](https://github.com/gitkraken/vscode-gitlens#gutter-changes-) file annotations could be rendered on the wrong lines in certain cases

## [12.0.4] - 2022-03-10

### Added

- Adds ability to paste in an authorization URL to complete a GitLens+ sign in

### Fixed

- Fixes [#1888](https://github.com/gitkraken/vscode-gitlens/issues/1888) - Gitlens breaks vscode auto repository detection settings
- Fixes an issue where the Visual File History wasn't correctly opening the commit file details quick pick menu
- Fixes an issue where the _Open Visual File History of Active File_ command wasn't showing in the Command Palette

## [12.0.3] - 2022-03-10

### Fixed

- Fixes [#1897](https://github.com/gitkraken/vscode-gitlens/issues/1897) - Repeated GitHub errors when offline

## [12.0.2] - 2022-03-09

### Added

- Adds proxy support to network requests
  - By default, uses a proxy configuration based on VS Code settings or OS configuration
  - Adds a `gitlens.proxy` setting to specify a GitLens specific proxy configuration

### Changed

- Changes local repositories to be considered public rather than private for GitLens+ features (so only a free account would be required)
- Changes relative dates >= 1 year but < 2 years to be shown in months for better granularity - related to [#1546](https://github.com/gitkraken/vscode-gitlens/issues/1546)

### Fixed

- Fixes [#1895](https://github.com/gitkraken/vscode-gitlens/issues/1895) - Honor defaultDateShortFormat setting on Visual File History
- Fixes [#1890](https://github.com/gitkraken/vscode-gitlens/issues/1890) - can no longer see untracked files in stashes

## [12.0.1] - 2022-03-03

### Added

- Adds `gitlens.defaultDateFormat` setting to specify the locale, a [BCP 47 language tag](https://en.wikipedia.org/wiki/IETF_language_tag#List_of_major_primary_language_subtags), to use for date formatting

### Changed

- Removes dependency on GitKraken Authentication extension
- Changes date formatting to follow the VS Code language locale by default
- Changes framing of premium features into GitLens+
- Changes repository naming to better reflect its folder name, related to [#1854](https://github.com/gitkraken/vscode-gitlens/issues/1854)

### Fixed

- Fixes [#2117](https://github.com/gitkraken/vscode-gitlens/issues/2117) - Gitlens freaks out when I'm off VPN
- Fixes [#1859](https://github.com/gitkraken/vscode-gitlens/issues/1859) - GitLens dates use system locale instead of vscode language setting
- Fixes [#1854](https://github.com/gitkraken/vscode-gitlens/issues/1854) - All repos have the same name
- Fixes [#1866](https://github.com/gitkraken/vscode-gitlens/issues/1866) - Copy SHA and Copy Message don't work from the views (commits, branches, etc)
- Fixes [#1865](https://github.com/gitkraken/vscode-gitlens/issues/1865) - Value shortOffset out of range for Intl.DateTimeFormat options property timeZoneName
- Fixes [#1742](https://github.com/gitkraken/vscode-gitlens/issues/1742) - New file lines keep jumping down
- Fixes [#1846](https://github.com/gitkraken/vscode-gitlens/issues/1846) - Restoring (checkout) a deleted file from a commit doesn't work
- Fixes [#1844](https://github.com/gitkraken/vscode-gitlens/issues/1844) - Autolinked issues aren't properly paged when there are too many commits
- Fixes [#1843](https://github.com/gitkraken/vscode-gitlens/issues/1843) - Compare references doesn't work if you have multiple repos open

## [12.0.0] - 2022-02-28

### Added

- Adds (preview) VS Code for Web support!
  - Get the power and insights of GitLens for any GitHub repository directly in your browser on vscode.dev or github.dev
- Introducing GitLens+ features &mdash; [learn about GitLens+ features](https://gitkraken.com/gitlens/pro-features)

  - GitLens+ adds all-new, completely optional, features that enhance your current GitLens experience when you sign in with a free account. A free GitLens+ account gives you access to these new GitLens+ features on local and public repos, while a paid account allows you to use them on private repos. All other GitLens features will continue to be free without an account, so you won't lose access to any of the GitLens features you know and love, EVER.
  - Visual File History &mdash; a visual way to analyze and explore changes to a file

    - The Visual File History allows you to quickly see the evolution of a file, including when changes were made, how large they were, and who made them

      ![Visual File History view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/visual-file-history-illustrated.png)

  - Worktrees &mdash; allow multiple branches to be checked-out at once

    - Worktrees allow you to easily work on different branches of a repository simultaneously. You can create multiple working trees, each of which can be opened in individual windows or all together in a single workspace

      ![Worktrees view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/worktrees-illustrated.png)

- Adds a new GitLens Home view &mdash; see welcome content, help resources, and subscription information
- Adds a _Get Started with GitLens_ walkthrough to introduce new (and existing) users to many of the powerful features of GitLens &mdash; try it via _GitLens: Get Started_ from the Command Palette
- Adds a new _Autolinked Issues and Pull Requests_ node to comparisons to list autolinked issues and pull requests in commit messages to quickly see all the issues fixed in a release and more
  - Currently only supported for connected GitHub remote providers
- Adds the ability to choose a stash when opening or comparing file revisions, via the _Open Changes with Revision..._ & _Open File at Revision..._ commands
- Adds improved hover information, including status and color-coding, shown on pull requests in the GitLens views
- Adds a `gitlens.codeLens.dateFormat` setting to specify how to format absolute dates in the Git CodeLens
- Adds an easier method to choose a specific commit to the _Git Command Palette_'s _merge_ & _rebase_ commands
- Adds a new commit format token: `${link}`

### Changed

- Completely refactors the internals of GitLens into a new flexible Git provider model to allow GitLens to work on the web and in virtual environments like vscode.dev and github.dev
- Improves the user experience of the commit details and file details quick pick menus
  - Commands are now grouped and easier to understand and access &mdash; thanks to Tyler Leonhardt ([@tylerLeonhardt](https://github.com/tylerLeonhardt)) on the VS Code team for the quick pick API additions
- Improves performance and reduces latency across many workflows
- Improves startup performance on previously opened workspaces by remembering details from the last time the workspace was opened
- Improves performance of the all GitLens webviews, most noticeable on the GitLens settings editor
- Improves GitLens view refreshing when folders are added or removed from a workspace
- Changes the icon of the _Open Changes_ action on the hovers to be clearer
- Changes footnotes in hovers to be above the command bar rather than below
- Reworks many internal Git parsers to reduce memory usage and improve performance

### Fixed

- Fixes [#1818](https://github.com/gitkraken/vscode-gitlens/issues/1818) - Ambiguous error message on GitHub authentication errors
- Fixes [#1645](https://github.com/gitkraken/vscode-gitlens/issues/1645) - Possible catastrophic backtracking with large inputs
- Fixes [#1506](https://github.com/gitkraken/vscode-gitlens/issues/1506) - Annoying Github login request
- Fixes [#1735](https://github.com/gitkraken/vscode-gitlens/issues/1735) - "gitlens.hovers.detailsMarkdownFormat" edit error
- Fixes [#1745](https://github.com/gitkraken/vscode-gitlens/issues/1745) - autolinks.url encodes hash char
- Fixes [#1572](https://github.com/gitkraken/vscode-gitlens/issues/1572) - Forced regular expression search in changes
- Fixes [#1473](https://github.com/gitkraken/vscode-gitlens/issues/1473) - Support VSCodium in interactive rebase editor
- Fixes [#1699](https://github.com/gitkraken/vscode-gitlens/issues/1699) - Exception has occurred: RangeError [ERR_OUT_OF_RANGE]
- Fixes [#1601](https://github.com/gitkraken/vscode-gitlens/issues/1601) - Add a better time sample in "Dates & Times" setting
- Fixes performance issue with the rich hover on the status bar blame
- Fixes cross repository branch switching via the _Git Command Palette_
- Fixes an issue with TOC entries in the VS Code settings editor
- Fixes issues using quotes when searching for commits in certain scenarios
- Fixes issues when revealing items in GitLens views the item wouldn't get selected properly
- Fixes issues with retries on _Git Command Palette_ command steps
- Fixes code splitting issue where GitHub support wasn't split out of the main bundle for better loading performance
- Fixes issue with quotes and commit search
- Fixes a leaked disposable on cancellable promises

## [11.7.0] - 2021-11-18

### Added

- Adds a new rich commit details hover to the blame information in the status bar
  - Adds a `gitlens.statusBar.tooltipFormat` setting to specify the format (in markdown) of hover shown over the blame information in the status bar
- Adds a new rich hover to the GitLens mode in the status bar
- Adds functional groupings to all GitLens settings when using the VS Code settings UI. Groups will be displayed in the table of contents in the settings UI &mdash; thanks to Raymond Zhao ([@rzhao271](https://github.com/rzhao271)) on the VS Code team for allowing extensions to add groups to VS Code settings UI
- Adds new action buttons on many quick pick menu options, including in the _Git Command Palette_ &mdash; thanks to Tyler Leonhardt ([@tylerLeonhardt](https://github.com/tylerLeonhardt)) on the VS Code team for the API support
- Adds [Gerrit](https://www.gerritcodereview.com/) remote provider support &mdash; closes [#720](https://github.com/gitkraken/vscode-gitlens/issues/720) thanks to [PR #1535](https://github.com/gitkraken/vscode-gitlens/pull/1535) by Andrew Savage ([@andrewsavage1](https://github.com/andrewsavage1))
- Adds new _Open File_ command (with _Open Revision_ as an `alt-click`) to files in comparisons &mdash; closes [#1710](https://github.com/gitkraken/vscode-gitlens/issues/1710)
- Adds a new _Cherry Pick without Committing_ confirmation option to the _Git Command Palette_'s _cherry-pick_ command &mdash; closes [#1693](https://github.com/gitkraken/vscode-gitlens/issues/1693)
- Adds a new _Merge without Fast-Forwarding or Committing_ confirmation option to the _Git Command Palette_'s _merge_ command &mdash; closes [#1178](https://github.com/gitkraken/vscode-gitlens/issues/1178) thanks to [PR #1621](https://github.com/gitkraken/vscode-gitlens/pull/1621) by Dmitry Ulupov ([@dimaulupov](https://github.com/dimaulupov))
- Adds commit message autolinking of merged pull requests for Azure Repos &mdash; closes [#1486](https://github.com/gitkraken/vscode-gitlens/issues/1486) thanks to [PR #1487](https://github.com/gitkraken/vscode-gitlens/pull/1487) by Mark Molinaro ([@markjm](https://github.com/markjm))
- Adds a new `AzureDevOps` type to `gitlens.remotes` to better support Azure DevOps remote matching &mdash; thanks to [PR #1487](https://github.com/gitkraken/vscode-gitlens/pull/1487) by Dmitry Gurovich ([@yrtimiD](https://github.com/yrtimiD))

### Changed

- Changes the _No Fast-forward Merge_ confirmation option in the _Git Command Palette_'s _merge_ command to _Merge without Fast-Forwarding_

### Fixed

- Fixes [#1669](https://github.com/gitkraken/vscode-gitlens/issues/1669) - Workitem Link (Hover ) for Repository (DevOps) with Blank is broken
- Fixes [#1695](https://github.com/gitkraken/vscode-gitlens/issues/1695) - gitlens.remotes: ${repo} has '%2520' instead of '%20' for a space
- Fixes [#1531](https://github.com/gitkraken/vscode-gitlens/issues/1531) - Typo in `gitlens.defaultGravatarsStyle` options &mdash; thanks to [PR #1532](https://github.com/gitkraken/vscode-gitlens/pull/1532) by Alwin Wang ([@alwinw](https://github.com/alwinw))
- Fixes [#1511](https://github.com/gitkraken/vscode-gitlens/issues/1511) - Avatars are blurry on retina displays &mdash; thanks to [PR #1595](https://github.com/gitkraken/vscode-gitlens/pull/1595) by Adaex Yang ([@adaex](https://github.com/adaex))
- Fixes [#1609](https://github.com/gitkraken/vscode-gitlens/issues/1609) - X.globalState.setKeysForSync is not a function &mdash; thanks to [PR #1610](https://github.com/gitkraken/vscode-gitlens/pull/1610) by Stanislav Lvovsky ([@slavik-lvovsky](https://github.com/slavik-lvovsky))
- Fixes [#1131](https://github.com/gitkraken/vscode-gitlens/issues/1131) - Order matters for search filters in 'search commits' &mdash; with help from [PR #1575](https://github.com/gitkraken/vscode-gitlens/pull/1575) by Lior Kletter ([@Git-Lior](https://github.com/Git-Lior))
- Fixes [#1583](https://github.com/gitkraken/vscode-gitlens/issues/1583) - Should hide the context menu on unrelated tabs &mdash; thanks to [PR #1589](https://github.com/gitkraken/vscode-gitlens/pull/1589) by Takashi Tamura ([@tamuratak](https://github.com/tamuratak))
- Fixes [#1587](https://github.com/gitkraken/vscode-gitlens/issues/1587) - Hover on blame can duplicate &mdash; thanks to [PR #1588](https://github.com/gitkraken/vscode-gitlens/pull/1588) by Takashi Tamura ([@tamuratak](https://github.com/tamuratak))

## [11.6.1] - 2021-10-08

### Changed

- GitLens joins forces with GitKraken! &mdash; [Learn more](https://gitkraken.com/blog/gitkraken-acquires-gitlens-for-visual-studio-code)

## [11.6.0] - 2021-07-13

### Added

- Adds new _Open Previous Changes with Working File_ command to commit files in views &mdash; closes [#1529](https://github.com/gitkraken/vscode-gitlens/issues/1529)
- Adopts new vscode `createStatusBarItem` API to allow for independent toggling &mdash; closes [#1543](https://github.com/gitkraken/vscode-gitlens/issues/1543)

### Changed

- Dynamically generates hashes and nonces for webview `<script>` and `<style>` tags for better security

### Fixed

- Fixes [#1432](https://github.com/gitkraken/vscode-gitlens/issues/1432) - Unhandled Timeout Promise
- Fixes [#1562](https://github.com/gitkraken/vscode-gitlens/issues/1562) - Yarn audit fails with 2 high sev vulnerabilities (dev dependencies only) &mdash; thanks to [PR #1563](https://github.com/gitkraken/vscode-gitlens/pull/1563) by Ivan Volzhev ([@ivolzhevbt](https://github.com/ivolzhevbt))
- Fixes [#1566](https://github.com/gitkraken/vscode-gitlens/issues/1566) - Bug: unable to open 'pr.url' when clicking PR link
- Fixes [#1545](https://github.com/gitkraken/vscode-gitlens/issues/1545) - Missing branch comparison controls in versions 11.5.0 and 11.5.1
- Fixes [#1548](https://github.com/gitkraken/vscode-gitlens/issues/1548) - "Don't show again" on debug log warning doesn't work
- Fixes [#1449](https://github.com/gitkraken/vscode-gitlens/issues/1449) - Configured remotes not showing up in quickpick menu when opening commit on remote
- Fixes issues where auto-linking of GitHub 3rd party issue links didn't always work
- Fixes issue with long commit messages on rebase editor
- Fixes compatibility issue with Live Share

## [11.5.1] - 2021-06-14

### Fixed

- Fixes up/down order of the alternate shortcuts on the Interactive Rebase Editor

## [11.5.0] - 2021-06-14

### Added

- Adds support for Workspace Trust
- Adds rich hovers to commits in the views &mdash; including associated pull requests (when connected to GitHub) and auto-linked issues
- Adds a new section for associated pull requests (when connected to GitHub) and auto-linked issues to the _Details_ hover
- Adds the ability to filter comparisons to show only either the left-side or right-side file differences
- Adds the _Open Folder History_ command to root folders &mdash; closes [#1505](https://github.com/gitkraken/vscode-gitlens/issues/1505)
- Adds alternate `j`/`k` and `shift+j`/`shift+k` keyboard shortcuts to the Interactive Rebase Editor &mdash; closes [#1538](https://github.com/gitkraken/vscode-gitlens/issues/1538)
- Adds the ability to show contributor statistics, files changed as well as lines added and deleted (can take a while to compute depending on the repository) &mdash; closes [#1489](https://github.com/gitkraken/vscode-gitlens/issues/1489)
  - Adds a _Show Statistics_ / _Hide Statistics_ toggle to the `...` menu of the _Contributors_ view
  - Adds a `gitlens.views.contributors.showStatistics` setting to specify whether to show contributor statistics in the _Contributors_ view
- Adds _Create Pull Request..._ inline command to branches in the views

### Changed

- Adopts more VS Code codicons
- Changes the _Restore_ command title to _Restore (Checkout)_ &mdash; closes [#1493](https://github.com/gitkraken/vscode-gitlens/issues/1493)
- Changes _Compare with Working_ icon to better align with VS Code compare changes codicon
- Renames the _Discuss / Collab..._ button on the _Details_ hover to _Team..._
- Reverses the resulting comparison of the _Compare with HEAD_, _Compare with Working_, and _Compare with Upstream_ commands in the views

### Fixed

- Fixes [#1538](https://github.com/gitkraken/vscode-gitlens/issues/1538) - Wrong initial keyboard focus in interactive rebase
- Fixes [#1498](https://github.com/gitkraken/vscode-gitlens/issues/1498) - "Search & Compare" broken entries
- Fixes [#1507](https://github.com/gitkraken/vscode-gitlens/issues/1507) - Communicate git error instead of "unable to find git"
- Fixes [#1512](https://github.com/gitkraken/vscode-gitlens/issues/1512) - Git tag command can add an extra `-m`
- Fixes [#1402](https://github.com/gitkraken/vscode-gitlens/issues/1402) - File history missing commits from other branches
- Fixes an issue where the current line blame intermittently fails to appear
- Fixes an issue where auto-linking of GitHub 3rd party issue links was broken
- Fixes an issue where view decorations on macOS wouldn't show the correct icon

## [11.4.1] - 2021-04-14

### Added

- Adds an alternate _Copy Remote File URL_ command (`gitlens.copyRemoteFileUrlWithoutRange`) to copy the remote url of the file without including any line range

### Fixed

- Fixes [#1458](https://github.com/gitkraken/vscode-gitlens/issues/1458) - "Copy Remote File URL" not showing line ranges

## [11.4.0] - 2021-04-08

### Added

- Adds a new status indicator (decoration), on the right, and a themeable colorization to branches in the views
  - `!` &mdash; indicates that the branch is missing its upstream (likely deleted from the remote)
- Adds a new `⚠` indicator to branches in quick pick menus when a branch is missing its upstream
- Adds _Open Folder History_ command to folders in the _Explorer_ view to show the folder's history in the _File History_ view
- Adds [Gitea](https://gitea.io/) remote provider support &mdash; closes [#1379](https://github.com/gitkraken/vscode-gitlens/issues/1379) thanks to [PR #1396](https://github.com/gitkraken/vscode-gitlens/pull/1396) by Nils K ([septatrix](https://github.com/septatrix))
- Adds a `gitlens.advanced.commitOrdering` setting to specify the order by which commits will be shown. If unspecified, commits will be shown in reverse chronological order &mdash; closes [#1257](https://github.com/gitkraken/vscode-gitlens/issues/1257) thanks to [PR #1344](https://github.com/gitkraken/vscode-gitlens/pull/1344) by Andy Tang ([thewindsofwinter](https://github.com/thewindsofwinter)) and Shashank Shastri ([Shashank-Shastri](https://github.com/Shashank-Shastri))
- Adds [documentation](https://github.com/gitkraken/vscode-gitlens#side-bar-views-) for the _GitLens: Set Views Layout_ command &mdash; thanks to [PR #1404](https://github.com/gitkraken/vscode-gitlens/pull/1404) by Asif Kamran Malick ([@akmalick](https://github.com/akmalick))
- Adds an _Enable Debug Logging_ command (`gitlens.enableDebugLogging`) to enable debug logging to the GitLens output channel
- Adds a _Disable Debug Logging_ command (`gitlens.disableDebugLogging`) to disable debug logging to the GitLens output channel

### Fixed

- Fixes [#1423](https://github.com/gitkraken/vscode-gitlens/issues/1423) - Create tag with message fails
- Fixes [#1428](https://github.com/gitkraken/vscode-gitlens/issues/1428) - Incorrect branch name when no commits exist on new repo
- Fixes [#1444](https://github.com/gitkraken/vscode-gitlens/issues/1444) - File history view "Open Changes with Working File" does not work for the very first commit
- Fixes [#1448](https://github.com/gitkraken/vscode-gitlens/issues/1448) - Hashes (#) are percent encoded in custom remote urls
- Fixes [#1447](https://github.com/gitkraken/vscode-gitlens/issues/1447) - _Open File on Remote From..._ is missing remote branches
- Fixes [#1442](https://github.com/gitkraken/vscode-gitlens/issues/1442) - Interactive Rebase Editor not opened but plain text file when called from terminal
- Fixes [#1439](https://github.com/gitkraken/vscode-gitlens/issues/1439) - Copying a remote file URL for a file on Azure DevOps does not work &mdash; thanks to [PR #1440](https://github.com/gitkraken/vscode-gitlens/pull/1440) by Lee Chang ([MeltingMosaic](https://github.com/MeltingMosaic))
- Fixes [#1445](https://github.com/gitkraken/vscode-gitlens/issues/1439) - Improve documentation for hiding default added editor actions
- Fixes [#1411](https://github.com/gitkraken/vscode-gitlens/issues/1411) - Click on branch compare node does not expand the tree
- Fixes an issue where the _Changes to pull from \*_'s _\* files changed_ was always 0

## [11.3.0] - 2021-03-05

### Added

- Adds new status indicators (decorations), on the right, and themeable colorizations to branches in the views
  - `✓` &mdash; indicates that the branch is the current branch
  - `▲` + green colorization &mdash; indicates that the branch has unpushed changes (ahead)
  - `▼` + red colorization &mdash; indicates that the branch has unpulled changes (behind)
  - `▼▲` + yellow colorization &mdash; indicates that the branch has diverged from its upstream; meaning it has both unpulled and unpushed changes
  - `▲+` + green colorization &mdash; indicates that the branch hasn't yet been published to an upstream remote
- Adds new status indicators (decorations), on the right, and themeable colorizations to files in the views
  - `M` &mdash; indicates that the file is/was modified
  - `A` + green colorization &mdash; indicates that the file is/was added
  - `D` + red colorization &mdash; indicates that the file is/was deleted
  - `R` + green colorization &mdash; indicates that the file is/was renamed
  - `C` + green colorization &mdash; indicates that the file is/was copied
  - `I` + grey colorization &mdash; indicates that the file is ignored
  - `U` + green colorization &mdash; indicates that the file is untracked
- Adds a new built-in _Create Pull Request_ flow that starts opening a pull request on github.com
- Adds a new _Open Blame Prior to Change_ command (`gitlens.openBlamePriorToChange`) to open the blame of prior revision of the selected line in the current file &mdash; closes [#1014](https://github.com/gitkraken/vscode-gitlens/issues/1014)
- Adds new Git CodeLens action options
  - _Opens the commit on the remote service (when available)_ and _Copies the remote commit url to the clipboard (when available)_
  - _Opens the file revision on the remote service (when available)_ and _Copies the remote file revision url to the clipboard (when available)_
  - _Toggles the file heatmap_
  - _Toggles the file changes since before the commit_
  - _Toggles the file changes from the commit_
- Adds new status bar blame action options
  - _Opens the commit on the remote service (when available)_ and _Copies the remote commit url to the clipboard (when available)_ &mdash; closes [#1378](https://github.com/gitkraken/vscode-gitlens/issues/1378)
  - _Opens the file revision on the remote service (when available)_ and _Copies the remote file revision url to the clipboard (when available)_
  - _Toggles the file heatmap_
  - _Toggles the file changes since before the commit_
  - _Toggles the file changes from the commit_
- Adds _Publish Repository_ command (`gitlens.publishRepository`) to publish the repository to a remote provider
- Adds supported remote types in README &mdash; thanks to [PR #1371](https://github.com/gitkraken/vscode-gitlens/pull/1371) by Vladislav Guleaev ([@vguleaev](https://github.com/vguleaev))
- Adds a new _Reset Avatar Cache_ command (`gitlens.resetAvatarCache`) to clear the avatar cache

### Changed

- Changes the _Blame Previous Revision_ command on the hover to _Open Blame Prior to this Change_
- Changes the _Blame Previous Revision_ command icon on the hover to the `versions` codicon

### Fixed

- Fixes [#1438](https://github.com/gitkraken/vscode-gitlens/issues/1438) - Messages in hovers wrong encoding using non UTF-8
- Fixes [#1372](https://github.com/gitkraken/vscode-gitlens/issues/1372) - Unexpected repository detection on editor startup after recent updates
- Fixes [#1394](https://github.com/gitkraken/vscode-gitlens/issues/1394) - Repository view settings appear disabled
- Fixes [#1391](https://github.com/gitkraken/vscode-gitlens/issues/1391) - Branch names are not properly escaped in git commands
- Fixes [#1336](https://github.com/gitkraken/vscode-gitlens/issues/1336) - Need to allow GitLens to connect to GitHub in every Codespace (requires VS Code v1.54-insiders or later)
- Fixes [#1363](https://github.com/gitkraken/vscode-gitlens/issues/1363) - Error 'Unable to open compare', when git setting log.showsignature is active
- Fixes [#1368](https://github.com/gitkraken/vscode-gitlens/issues/1368) - Suppress message "GitLens was unable to find Git"
- Fixes an issue where the rebase status in the views could get "stuck" after a rebase completed
- Fixes typo in README &mdash; thanks to [PR #1374](https://github.com/gitkraken/vscode-gitlens/pull/1374) by David Rees ([@studgeek](https://github.com/studgeek))

## [11.2.1] - 2021-02-02

### Changed

- Changes to additionally show merged pull requests at the root of the _Commits_ and _Repositories_ views

### Fixed

- Fixes [#1361](https://github.com/gitkraken/vscode-gitlens/issues/1361) - Interactive rebase editor fails when opened in a VS Code window that doesn't have the repository opened
- Fixes [#1357](https://github.com/gitkraken/vscode-gitlens/issues/1357) - Branch sorting may be reversed &mdash; thanks to [PR #1358](https://github.com/gitkraken/vscode-gitlens/pull/1358) by sueka ([@sueka](https://github.com/sueka))

## [11.2.0] - 2021-02-02

### Added

- Adds rebase and/or merge status when applicable to the _Commits_ and _Repositories_ views

  - **Merging into &lt;branch&gt;** or **Resolve conflicts before merging into &lt;branch&gt;** &mdash; lists any conflicted files. Conflicted files show comparisons with the common base of the current and incoming changes to aid in resolving the conflict by making it easier to see where changes originated

    ![Merging](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commits-view-merge.png)

  - **Rebasing &lt;branch&gt;** or **Resolve conflicts to continue rebasing &lt;branch&gt;** &mdash; shows the number of rebase steps left, the commit the rebase is paused at, and lists any conflicted files. Conflicted files show comparisons with the common base of the current and incoming changes to aid in resolving the conflict by making it easier to see where changes originated

    ![Rebasing](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commits-view-rebase.png)

- Adds rebase and/or merge conflict status when applicable to the _File History_ and _Line History_ views

  - **Merge Changes** &mdash; show comparisons with the common base of the current and incoming changes to aid in resolving the conflict by making it easier to see where changes originated

    ![Merge Conflicts](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/file-history-view-merge-conflict.png)

- Adds status indicator colors to pull request icons in GitLens views
- Adds a new _Quick Open File History_ command to all places where _Open File History_ already exists &mdash; closes [#1156](https://github.com/gitkraken/vscode-gitlens/issues/1156)
- Adds the _Add Remote_ command to the branch status in the _Branches_, _Commits_, and _Repositories_ views when there are no Git remotes configured
- Adds a new _Browse Repository from Before Here_ (`gitlens.browseRepoBeforeRevision`) and _Browse Repository from Before Here in New Window_ (`gitlens.browseRepoBeforeRevisionInNewWindow`) commands
- Adds _Repository from Before Here_ and _Repository from Before Here in New Window_ to the _Browse_ submenu of commits in the views
- Adds a new _Copy Current Branch Name_ (`gitlens.copyCurrentBranch`) command to copy the current branch name to the clipboard &mdash; closes [#1306](https://github.com/gitkraken/vscode-gitlens/issues/1306) &mdash; thanks to [PR #1307](https://github.com/gitkraken/vscode-gitlens/pull/1307) by Ken Hom ([@kh0m](https://github.com/kh0m))
- Adds a _Switch to Text_ button on the _Interactive Rebase Editor_ to open the text rebase todo file &mdash; note that closing either document will start the rebase
- Adds a notification which asks if you want to create a pull request after publishing a new branch
- Adds CodeStream partnership
- Adds a `gitlens.views.branches.reveal` setting to specify whether to reveal branches in the _Branches_ view, otherwise they will be revealed in the _Repositories_ view
- Adds a `gitlens.views.commits.reveal` setting to specify whether to reveal commits in the _Commits_ view, otherwise they will be revealed in the _Repositories_ view
- Adds a `gitlens.views.remotes.reveal` setting to specify whether to reveal remotes in the _Remotes_ view, otherwise they will be revealed in the _Repositories_ view
- Adds a `gitlens.views.stashes.reveal` setting to specify whether to reveal stashes in the _Stashes_ view, otherwise they will be revealed in the _Repositories_ view
- Adds a `gitlens.views.tags.reveal` setting to specify whether to reveal tags in the _Tags_ view, otherwise they will be revealed in the _Repositories_ view
- Adds a `gitlens.advanced.abbreviateShaOnCopy` setting to specify to whether to copy full or abbreviated commit SHAs to the clipboard. Abbreviates to the length of `gitlens.advanced.abbreviatedShaLength` &mdash; closes [#1062](https://github.com/gitkraken/vscode-gitlens/issues/1062) &mdash; thanks to [PR #1316](https://github.com/gitkraken/vscode-gitlens/pull/1316) by Brendon Smith ([@br3ndonland](https://github.com/br3ndonland))
- Adds a `gitlens.advanced.externalDiffTool` setting to specify an optional external diff tool to use when comparing files. Must be a configured [Git difftool](https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool).
- Adds a `gitlens.advanced.externalDirectoryDiffTool` setting to specify an optional external diff tool to use when comparing directories. Must be a configured [Git difftool](https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool).
- Adds a new `regex` option to `gitlens.remotes` to better support custom remote matching &mdash; closes [#1196](https://github.com/gitkraken/vscode-gitlens/issues/1196)

### Changed

- Changes `gitlens.statusBar.reduceFlicker` to be on by default and improves its display &mdash; closes [#1353](https://github.com/gitkraken/vscode-gitlens/issues/1353)
- Changes the _Interactive Rebase Editor_ to abort the rebase if you just close it without choosing an action
- Changes _Push to Commit..._ on the HEAD commit to be _Push_ instead as there is no need for a commit specific push in that case
- Renames _Browse from Here_ command to _Browse Repository from Here_ in the command palette and quick pick menus
- Renames _Browse from Here in New Window_ command to _Browse Repository from Here in New Window_ in the command palette and quick pick menus
- Renames _Browse from Here_ to _Repository from Here_ on the _Browse_ submenu of commits in the views
- Renames _Browse from Here in New Window_ to _Repository from Here in New Window_ on the _Browse_ submenu of commits in the views

### Fixed

- Fixes [#1267](https://github.com/gitkraken/vscode-gitlens/issues/1267) - File history fails on Git for Windows 2.27 ("There are no editors open that can provide file history information.")
- Fixes [#1006](https://github.com/gitkraken/vscode-gitlens/issues/1006) - "GitLens: Open File on Remote" opens wrong Bitbucket URL
- Fixes [#901](https://github.com/gitkraken/vscode-gitlens/issues/901) - Bitbucket Server fails when url = https://DOMAIN/stash/scm/PROJECT/REPO.git
- Fixes [#1354](https://github.com/gitkraken/vscode-gitlens/issues/1354) - Stuck after merge a branch with a single quote in the name
- Fixes [#863](https://github.com/gitkraken/vscode-gitlens/issues/863) - Pulling all repositories doesn't work unless built-in Git knows about the repo (requires VS Code v1.53 or later)
- Fixes [#1332](https://github.com/gitkraken/vscode-gitlens/issues/1332) - Stashes created with command line don't show up in the "Stashes" section
- Fixes [#1045](https://github.com/gitkraken/vscode-gitlens/issues/1045) - View File History not working - absolute path used &mdash; thanks to [PR #1334](https://github.com/gitkraken/vscode-gitlens/pull/1334) by egfx-notifications ([@egfx-notifications](https://github.com/egfx-notifications))
- Fixes [#1323](https://github.com/gitkraken/vscode-gitlens/issues/1323) - Interactive rebase hangs
- Fixes [#1183](https://github.com/gitkraken/vscode-gitlens/issues/1183) - stash all changes has no effect when the number of files is large
- Fixes [#1308](https://github.com/gitkraken/vscode-gitlens/issues/1308) - Escape quotes for PRs titles
- Fixes [#1309](https://github.com/gitkraken/vscode-gitlens/issues/1309) - "Fetch" not working on remote branches
- Fixes an issue where many views wouldn't refresh properly when going from no items to some items
- Fixes an issue where _Publish Branch_ was incorrectly showing up on remote branches
- Fixes an issue where the _Open Directory Compare \*_ commands failed to work
- Fixes an issue where pinning a file/line to the _File History_ view or _Line History_ view would get lost if the view was collapsed and expanded

### Removed

- Removes the `gitlens.repositories.enabled` setting, since the view is toggleable as any other view now
- Removes the `gitlens.lineHistory.enabled` setting, since the view is toggleable as any other view now
- Removes the _Hide Repositories view_ command, since the view is toggleable as any other view now
- Removes the _Hide Line History view_ command, since the view is toggleable as any other view now

## [11.1.3] - 2021-01-05

### Fixed

- Fixes [#1303](https://github.com/gitkraken/vscode-gitlens/issues/1303) - Open on Remote is creating invalid URLs for Azure Devops &mdash; thanks to [PR #1304](https://github.com/gitkraken/vscode-gitlens/pull/1304) by Travis Collins ([@TravisTX](https://github.com/TravisTX))

## [11.1.2] - 2021-01-03

### Fixed

- Fixes the outdated documentation url on the _Connect Remote Provider_ quick pick menu &mdash; thanks to [PR #1300](https://github.com/gitkraken/vscode-gitlens/pull/1300) by Ahmadou Waly Ndiaye ([@sir-kain](https://github.com/sir-kain))

## [11.1.1] - 2021-01-02

### Changes

- Improves the performance of the _Stashes_ and _Contributors_ views

### Fixed

- Fixes [#1302](https://github.com/gitkraken/vscode-gitlens/issues/1302) - Welcome screen on every editor window is very tedious
- Fixes [#1285](https://github.com/gitkraken/vscode-gitlens/issues/1285) - Uncommitted staged changes after pull
- Fixes [#1294](https://github.com/gitkraken/vscode-gitlens/issues/1294) - Error when open commits list

## [11.1.0] - 2020-12-23

### Added

- Refines the _Repositories_ view to better align its features with all the new views
  - Adds menu toggles, and the settings below to allow for far greater customization of the sections in the _Repositories_ view
  - Adds a `gitlens.views.repositories.branches.showBranchComparison` setting to specify whether to show a comparison of the branch with a user-selected reference (branch, tag, etc) under each branch in the _Repositories_ view
  - Adds a `gitlens.views.repositories.showBranches` setting to specify whether to show the branches for each repository
  - Adds a `gitlens.views.repositories.showCommits` setting to specify whether to show the commits on the current branch for each repository
  - Adds a `gitlens.views.repositories.showContributors` setting to specify whether to show the contributors for each repository
  - Adds a `gitlens.views.repositories.showIncomingActivity` setting to specify whether to show the experimental incoming activity for each repository
  - Adds a `gitlens.views.repositories.showRemotes` setting to specify whether to show the remotes for each repository
  - Adds a `gitlens.views.repositories.showStashes` setting to specify whether to show the stashes for each repository
  - Adds a `gitlens.views.repositories.showTags` setting to specify whether to show the tags for each repository
  - Adds a `gitlens.views.repositories.showUpstreamStatus` setting to specify whether to show the upstream status of the current branch for each repository
  - Adds all the settings above to the _Repositories_ view section in the GitLens Interactive Settings
- Adds better visibility to the, hidden by default, _Repositories_ and _Line History_ views
  - Adds a _Repositories_ view toggle command to the _Commits_ view's context menu
  - Adds a _Line History_ view toggle command to the _File History_ view's context menu
  - Re-adds the _Line History_ view settings to the GitLens Interactive Settings
- Adds usage-based sorting (on by default) to the _Git Command Palette_
  - Adds a `gitlens.gitCommands.sortBy` setting to specify how Git commands are sorted in the _Git Command Palette_
- Adds ability to show gutter heatmap in the gutter and/or on the scroll bar &mdash; closes [#297](https://github.com/gitkraken/vscode-gitlens/issues/297)
  - Adds a `gitlens.heatmap.locations` setting to specify where the indicators of the gutter heatmap annotations will be shown
- Adds a `gitlens.fileAnnotations.command` setting to specify whether the file annotations button in the editor title shows a menu or immediately toggles the specified file annotations &mdash; closes [#1165](https://github.com/gitkraken/vscode-gitlens/issues/1165) thanks to [PR #1171](https://github.com/gitkraken/vscode-gitlens/pull/1171) by Raaj Patil ([@arrpee](https://github.com/arrpee))
  - Adds this new option to the _Menus & Toolbars_ section of the GitLens Interactive Settings
- Adds a _Push to Commit..._ command to unpublished commits in the _Commits_, _Branches_, and _Repositories_ views, and to unpublished files in the _File History_ and _Line History_ views
- Adds a _Commit_ submenu to files in the _File History_ and _Line History_ views &mdash; closes [#1044](https://github.com/gitkraken/vscode-gitlens/issues/1044)
- Adds an _Open File on Remote From..._ command (`gitlens.openFileOnRemoteFrom`) to open a file or revision on a specific branch or tag on the remote provider &mdash; closes [#1071](https://github.com/gitkraken/vscode-gitlens/issues/1071)
- Adds a _Copy Remote File URL From..._ command (`gitlens.copyRemoteFileUrlFrom`) to copy the url of a file or revision on a specific branch or tag the remote provider &mdash; closes [#1071](https://github.com/gitkraken/vscode-gitlens/issues/1071)
- Adds a welcome, i.e. richer empty state, to the _Search & Compare_ view
- Adds dynamic updating of the last fetched date/time in the _Commits_ and _Repositories_ views
- Adds a _Connect to Remote_ command (`gitlens.connectRemoteProvider`) to connect to a supported remote service to enable a rich integration
- Adds a _Disconnect from Remote_ command (`gitlens.disconnectRemoteProvider`) to disconnect from a connected remote service
- Adds a `gitlens.integrations.enabled` setting to specify whether to enable rich integrations with any supported remote services &mdash; see [#1208](https://github.com/gitkraken/vscode-gitlens/issues/1208)
- Adds a `gitlens.terminalLinks.enabled` setting to specify whether to enable terminal links &mdash; autolinks in the integrated terminal to quickly jump to more details for commits, branches, tags, and more &mdash; closes [#1284](https://github.com/gitkraken/vscode-gitlens/issues/1284)
- Adds a `gitlens.defaultTimeFormat` setting to specify how times will be formatted by default
- Adds a `gitlens.showWelcomeOnInstall` setting to specify whether to show the Welcome (Quick Setup) experience on first install &mdash; closes [#1049](https://github.com/gitkraken/vscode-gitlens/issues/1049) thanks to [PR #1258](https://github.com/gitkraken/vscode-gitlens/pull/1258) by Rickard ([@rickardp](https://github.com/rickardp))
- Adds a ⭐ star as a favorite indicator on branches in the quick pick menus
- Adds ability to toggle the _Toggle Compare with: Working Tree / Branch_ command before a comparison is chosen
- Adds GitLens extensibility APIs
  - Adds an _action runner_ extensibility point to provide a runner (handler) for the new _createPullRequest_ and _openPullRequest_ actions &mdash; see [`gitlens.d.ts`](https://github.com/gitkraken/vscode-gitlens/blob/main/src/api/gitlens.d.ts) for API definitions

### Changed

- Changes the _Incoming Activity_ section of the _Repositories_ view to be hidden by default, as it is still experimental
- Changes the options on the _Git Command Palette_'s _revert_ command to now be _Revert_ (`--no-edit`) and _Revert & Edit_ (`--edit`) &mdash; closes [#1269](https://github.com/gitkraken/vscode-gitlens/issues/1269)
- Changes the thickness (boldness) of a handful of icons to better match VS Code codicons

### Fixed

- Fixes [#1016](https://github.com/gitkraken/vscode-gitlens/issues/1016) - "Last fetched" message is also updated when fetch failed
- Fixes [#1218](https://github.com/gitkraken/vscode-gitlens/issues/1218) - Opening Ahead/Behind files isn't showing the desire diff (e.g. diff with the merge base)
- Fixes [#1255](https://github.com/gitkraken/vscode-gitlens/issues/1255) - Repository folders are missing repository actions (e.g. favorites, close repo, etc)
- Fixes [#1246](https://github.com/gitkraken/vscode-gitlens/issues/1246) - Gutter Blame avatar does not use Gravatar fallback style
- Fixes [#1208](https://github.com/gitkraken/vscode-gitlens/issues/1208) - Connect to Github notification is noisy
- Fixes [#526](https://github.com/gitkraken/vscode-gitlens/issues/526) - FAILED in gitlens.outputLevel=verbose; likely due to regex not in quotes
- Fixes [#1222](https://github.com/gitkraken/vscode-gitlens/issues/1222) - GitLens: Open Associated Pull Request doesn't work
- Fixes [#1223](https://github.com/gitkraken/vscode-gitlens/issues/1223) - commit pane, ${tips} does not show tags
- Fixes [#1225](https://github.com/gitkraken/vscode-gitlens/issues/1225) - Changes hover is wrong if the original/new line number doesn't match
- Fixes [#1045](https://github.com/gitkraken/vscode-gitlens/issues/1045) - View File History not working - absolute path used &mdash; thanks to [PR #1209](https://github.com/gitkraken/vscode-gitlens/pull/1209) by Mike Surcouf ([@mikes-gh](https://github.com/mikes-gh))
- Fixes [#1087](https://github.com/gitkraken/vscode-gitlens/issues/1087) - Error retrieving line history from UNC path &mdash; thanks to [PR #1209](https://github.com/gitkraken/vscode-gitlens/pull/1209) by Mike Surcouf ([@mikes-gh](https://github.com/mikes-gh))
- Fixes [#1176](https://github.com/gitkraken/vscode-gitlens/issues/1176) - Can't selectively apply stash
- Fixes [#1212](https://github.com/gitkraken/vscode-gitlens/issues/1212) - Stashes list doesn't refresh on deletion
- Fixes [#1191](https://github.com/gitkraken/vscode-gitlens/issues/1191) - "Gitlens › Views › Repositories: Auto Refresh" not working
- Fixes [#1202](https://github.com/gitkraken/vscode-gitlens/issues/1202) - "Copy Remote File URL" url-encodes the URL
- Fixes an issue where _Gutter \*_ file annotations wouldn't dynamically update when changing certain default configuration settings
- Fixes an issue where `git shortlog` could hang (when there is no HEAD)
- Fixes an issue where _GitLens: Show Repositories View_ command wouldn't work unless the view was enabled first
- Fixes an issue where _GitLens: Show Line History View_ command wasn't showing up unless the view was enabled first
- Fixes an issue where trying to force push the current branch would fail
- Fixes an issue where _Push to Commit..._ would incorrectly show a repository picker
- Fixes an issue where the _Add Remote_ command wasn't working
- Fixes an issue where the `gitlens.sortBranchesBy` and `gitlens.sortTagsBy` settings where not honored in many quick pick menus
- Fixes an issue where the _Toggle Compare with: Working Tree / Branch_ command was showing incorrectly on the branch comparisons

## [11.0.6] - 2020-11.28

### Changed

- Changes the _Where did my views go?_ view to show on this next upgrade, since somehow (still not sure how) it was never shown to many (most?) users
- Changes GitHub connection rejection to be per-workspace (rather than global)

### Fixed

- Fixes [#1205](https://github.com/gitkraken/vscode-gitlens/issues/1205) - Setting heatmap's `coldColor` and `hotColor` breaks file blame & related functionality
- Fixes invalid branch status showing up for remote branches

## [11.0.5] - 2020-11-23

### Fixed

- Fixes [#1204](https://github.com/gitkraken/vscode-gitlens/issues/1204) - Compare file changes: "new" and "old" sides of the compare are backwards

## [11.0.4] - 2020-11-22

### Fixed

- Fixes [#1161](https://github.com/gitkraken/vscode-gitlens/issues/1161) - Compare file differences between branches
- Fixes [#1157](https://github.com/gitkraken/vscode-gitlens/issues/1157) - GitLens report `X files changed` when comparing working tree with a branch having identical files

## [11.0.3] - 2020-11-22

### Fixed

- Fixes [#1163](https://github.com/gitkraken/vscode-gitlens/issues/1163) - Use Interactive Rebase Editor when run from GitLens command (regardless of Git config)
- Fixes [#1197](https://github.com/gitkraken/vscode-gitlens/issues/1197) - Can't squash commit in interactive rebase editor
- Fixes the `gitlens.codeLens.scopes` setting json schema

## [11.0.2] - 2020-11-20

### Added

- Adds a quick-access button to the _Interactive Rebase Editor_ to disable it &mdash; closes [#1153](https://github.com/gitkraken/vscode-gitlens/issues/1153)
- Adds shortcut keys to start and abort a rebase in the _Interactive Rebase Editor_
- Adds a _Disable Interactive Rebase Editor_ command (`gitlens.disableRebaseEditor`) to disable the interactive rebase editor
- Adds an _Enable Interactive Rebase Editor_ command (`gitlens.enableRebaseEditor`) to enable the interactive rebase editor
- Adds an _Interactive Rebase Editor_ section to the GitLens Interactive Settings

### Changes

- Changes the layout spacing of the _Interactive Rebase Editor_ to allow for more commits to be shown at once

### Fixed

- Fixes [#1187](https://github.com/gitkraken/vscode-gitlens/issues/1187) - Warning about incorrect regexp in DevTools console &mdash; thanks to [PR #1188](https://github.com/gitkraken/vscode-gitlens/pull/1188) by Andrii Dieiev ([@IllusionMH](https://github.com/IllusionMH))
- Fixes [#1151](https://github.com/gitkraken/vscode-gitlens/issues/1151) - Icons not showing in interactive rebase
- Fixes [#1166](https://github.com/gitkraken/vscode-gitlens/issues/1166) - Enormous avatars in interactive rebase view

## [11.0.1] - 2020-11-16

### Added

- Adds a _Compare References..._ command (`gitlens.compareWith`) to compare two selected references
- Adds ability to enter reference ranges (e.g. `main...release/1.0`) to the _Git Command Palette_'s _history_ command

### Fixed

- Fixes [#1148](https://github.com/gitkraken/vscode-gitlens/issues/1148) - Follow renames on File History cannot load more history
- Fixes [#1157](https://github.com/gitkraken/vscode-gitlens/issues/1157) - GitLens report `X files changed` when comparing working tree with a branch having identical files
- Fixes [#1150](https://github.com/gitkraken/vscode-gitlens/issues/1150) - Cannot read property 'provider' of undefined

## [11.0.0] - 2020-11-14

### Added

- Adds all-new views side bar views

  - Moves all GitLens views to the _Source Control_ side bar by default. You can move them back to the _GitLens_ side bar via the _Set Views Layout_ (`gitlens.setViewsLayout`) command or individually via drag and drop

  - [**_Commits_ view**](https://github.com/gitkraken/vscode-gitlens#commits-view-) &mdash; visualize, explore, and manage Git commits

    ![Commits view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/commits-view.png)

    - Adds an indicator icon (up arrow) to unpublished (unpushed) commits

  - [**_Branches_ view**](https://github.com/gitkraken/vscode-gitlens#branches-view-) &mdash; visualize, explore, and manage Git branches

    ![Branches view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/branches-view.png)

  - [**_Remotes_ view**](https://github.com/gitkraken/vscode-gitlens#remotes-view-) &mdash; visualize, explore, and manage Git remotes and remote branches

    ![Remotes view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/remotes-view.png)

  - [**_Stashes_ view**](https://github.com/gitkraken/vscode-gitlens#stashes-view-) &mdash; visualize, explore, and manage Git stashes

    ![Stashes view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/stashes-view.png)

  - [**_Tags_ view**](https://github.com/gitkraken/vscode-gitlens#tags-view-) &mdash; visualize, explore, and manage Git tags

    ![Tags view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/tags-view.png)

  - [**_Contributors_ view**](https://github.com/gitkraken/vscode-gitlens#contributors-view-) &mdash; visualize, navigate, and explore contributors

    ![Contributors view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/contributors-view.png)

    - Moves the current user to be first and adds a `(you)` suffix

  - [**_Search & Compare_ view**](https://github.com/gitkraken/vscode-gitlens#search--compare-view-) &mdash; search and explore commit histories by message, author, files, id, etc, or visualize comparisons between branches, tags, commits, and more

    ![Search & Compare view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/search-and-compare-view.png)

    - Replaces the _Search Commits_ and _Compare Commits_ views
    - Adds persistence (pinning) for both searches and comparisons
    - Adds ability to edit existing searches

  - Disables the _Repositories_ view by default, as it has been superseded by many new views. You can re-enable it by setting `"gitlens.views.repositories.enabled": true` or via the GitLens Interactive Settings

  - Integrates line history into the [**_File History_ view**](https://github.com/gitkraken/vscode-gitlens#file-history-view-)

    ![File History view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/file-history-view.png)

    - Adds a new _Toggle History Mode_ command to toggle between showing file or line history
    - Adds an indicator icon (up arrow) to unpublished (unpushed) commits
    - Adds support for showing history across all branches via the _Toggle Filter_ menu command &mdash; closes [#974](https://github.com/gitkraken/vscode-gitlens/issues/974)
    - Adds staged changes

  - _Welcome_ view &mdash; quickly setup GitLens to meet your needs (for first time users only)

- Adds a user-friendly [**interactive rebase editor**](https://github.com/gitkraken/vscode-gitlens#interactive-rebase-editor-) to easily configure an interactive rebase session

  ![Rebase Editor](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/rebase.gif)

- Adds [**terminal links**](https://github.com/gitkraken/vscode-gitlens#terminal-links-) &mdash; `ctrl+click` on autolinks in the integrated terminal to quickly jump to more details for commits, branches, tags, and more

  ![Terminal Links](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/terminal-links.gif)

- Adds [**rich integration**](https://github.com/gitkraken/vscode-gitlens#remote-provider-integrations-) with GitHub

  - Adds GitHub avatar support!
  - Adds associated pull request to line annotations and hovers

    ![Pull requests on line annotation and hovers](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/hovers-current-line-details.png)

  - Adds associated pull request to status bar blame

    ![Pull requests on status bar](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/status-bar.png)

  - Adds associated pull requests to branches and commits in GitLens views
  - Adds rich autolinks for GitHub issues and pull requests, including titles, status, and authors

- Adds a new and improved [**_Gutter Heatmap_**](https://github.com/gitkraken/vscode-gitlens#gutter-heatmap-) file annotations, via the _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`)

  ![Gutter Heatmap](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/gutter-heatmap.png)

  - Displays the heatmap in the gutter for a cleaner look and avoids any code jumping
  - Adds improved heatmap colorization for better clarity of old and new code
  - Adds the hot/cold age threshold to the GitLens Interactive Settings

- Adds a new and improved [**_Gutter Changes_**](https://github.com/gitkraken/vscode-gitlens#gutter-changes-) file annotations, via the _Toggle File Changes Annotations_ command (`gitlens.toggleFileChanges`) &mdash; closes [#396](https://github.com/gitkraken/vscode-gitlens/issues/396)

  ![Gutter Changes](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/gutter-changes.png)

  - Provides indicators of local changes, if any, or recent commit changes, and distinguishes between added, changed, and removed lines
  - Similar to the built-in Git gutter changes for un-staged changes, but shows all local (un-pushed) changes
  - Shows a changes hover with the full set of changes (diff hunk) and even with unsaved changes

- Adds many refinements to the [**_Git Command Palette_**](https://github.com/gitkraken/vscode-gitlens#git-command-palette-) (previously _Git Commands_), and adds new commands

  ![Git Command Palette](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/main/images/docs/git-command-palette.png)

  - Adds many more options to existing commands
  - Adds improved titles for better clarity, context, and flow
  - Adds a new _history_ (log) command to show the commit history of a branch or tag
    - Adds a _Reveal in Side Bar_ button to the quick pick menu toolbar
    - Adds keyboard navigation
      - `right arrow` &mdash; reveals the selected branch in the _Branches_ or _Remotes_ view (or _Repositories_ view, if enabled), if there is no text in the quick pick menu
      - `alt+right arrow`, `ctrl+right arrow`, `cmd+right arrow` (macOS) &mdash; reveals the selected branch in the _Branches_ or _Remotes_ view
  - Adds a new _show_ command to show the details of a commit
    - Adds a _Reveal in Side Bar_ button to the quick pick menu toolbar
    - Adds keyboard navigation
      - `right arrow` &mdash; searches for the selected commit and shows the results in the _Search Commits_ view, if there is no text in the quick pick menu
      - `alt+right arrow` &mdash; searches for the selected commit and shows the results in the _Search Commits_ view
      - `ctrl+right arrow`, `cmd+right arrow` (macOS) &mdash; reveals the selected commit in the _Commits_ view (or _Repositories_ view, if enabled)
  - Adds a new _status_ command to show the current repository status
  - Adds a new _Delete Branch & Remote_ and _Force Delete Branch & Remote_ options to the _branch delete_ command &mdash; to more easily delete branches with tracking branches
  - Adds ability pull (fetch) a specific branch(es) to the _pull_ command &mdash; closes [#873](https://github.com/gitkraken/vscode-gitlens/issues/873)
  - Adds a new _Publish Branch_ option to the _push_ command
  - Adds ability to push a single branch to the _push_ command
  - Adds support for honoring the `git.useForcePushWithLease` setting on the _push_ command
  - Adds a new _Soft Reset_ (`--soft`) option to the _reset_ command

- Adds improved autolinks support
  - Adds a new `alphanumeric` flag to autolinks &mdash; closes [#946](https://github.com/gitkraken/vscode-gitlens/issues/946)
  - Adds autolink support in plain text (as footnotes)
  - Allows autolinks inside parentheses and square brackets
- Adds improved co-author support
  - Provides an updatable quick pick of co-authors
  - Adds the _Add Co-authors_ (`gitlens.addAuthors`) command to the Source Control context menu
  - Adds an option to show or hide the _Add Co-authors_ command on the Source Control context menu to the _Menus & Toolbars_ section of the GitLens Interactive Settings
- Adds many new commands
  - _Open File from Remote_ (`gitlens.openFileFromRemote`) command &mdash; opens the local file from a remote file url
  - _Set Views Layout_ (`gitlens.setViewsLayout`) command &mdash; quickly switch between showing GitLens views in _GitLens_ sidebar (default) and the _Source Control_ sidebar
  - Adds a _Switch to Another Branch_ (`gitlens.views.switchToAnotherBranch`) command &mdash; to quickly switch the current branch
  - _Copy Remote Commit URL_ command (`gitlens.copyRemoteCommitUrl`) &mdash; copies the url of the current line commit on the remote provider
  - _Copy Remote Branch URL_ command (`gitlens.copyRemoteBranchUrl`) &mdash; copies the url of a branch on the remote provider
  - _Copy Remote Branches URL_ command (`gitlens.copyRemoteBranchesUrl`) &mdash; copies the url of the branches on the remote provider
  - _Open Comparison on Remote_ command (`gitlens.openComparisonOnRemote`) &mdash; opens the comparison on the remote provider
  - _Copy Remote Comparison URL_ command (`gitlens.copyRemoteComparisonUrl`) &mdash; copies the url of the comparison on the remote provider
  - _Open Pull Request_ command (`gitlens.openPullRequestOnRemote`) &mdash; opens the pull request on the remote provider
  - _Copy Pull Request URL_ command (`gitlens.copyRemotePullRequestUrl`) &mdash; copies the url of the pull request on the remote provider
  - _Copy Remote Repository URL_ command (`gitlens.copyRemoteRepositoryUrl`) &mdash; copies the url of the repository on the remote provider
- Adds alternative `alt+click` commands for many of the _Open \* on Remote_ commands to alternatively copy the url to the clipboard
- Adds an _Open Commit on Remote_ command (with an _Copy Remote Commit URL_ `alt+click` command) to commits in the VS Code Timeline view
- Adds ability to set the default remote from any of the _Open \* on Remote_ command quick pick menus
- Adds _Git CodeLens_ to markdown headers
- Adds new _Git CodeLens_ options to disable the click actions on both the recent change and authors CodeLens &mdash; closes [#989](https://github.com/gitkraken/vscode-gitlens/issues/989) thanks to [PR #1009](https://github.com/gitkraken/vscode-gitlens/pull/1009) by Abdulrahman (Abdu) Assabri ([@abdusabri](https://github.com/abdusabri))
- Adds per-language customizations to the `gitlens.codeLens.scopes` and `gitlens.codeLens.symbolScopes` settings &mdash; closes [#977](https://github.com/gitkraken/vscode-gitlens/issues/977)
- Adds new click behavior for changed files in GitLens views to open a diff of all contained changes
- Adds a new `gitlens.hovers.avatarSize` setting to customize the size of avatars shown in hovers
  - Increases the default avatar size in hovers from 16px to 32px
- Adds _Hide Avatars_ or _Show Avatars_ menu command to many GitLens views to hide or show avatars
- Adds _Hide Date Markers_ or _Show Date Markers_ menu command to many GitLens views to hide or show relative date markers
- Adds real-time preview when editing format strings in the GitLens Interactive Settings
- Adds a new commit format tokens: `${authorNotYou}`, `${agoOrDateShort}`, `${authorAgoOrDateShort}`, `${committerAgoOrDateShort}`
- Adds synchronized storage to avoid opening the Welcome page or showing a What's New notification on new machines when Settings Sync is enabled
- Adds new _Welcome_ and _Open Settings_ menu commands to the GitLens gear menu in the _Extensions_ sidebar &mdash; closes [#952](https://github.com/gitkraken/vscode-gitlens/issues/952) & [#953](https://github.com/gitkraken/vscode-gitlens/issues/953) thanks to [PR #992](https://github.com/gitkraken/vscode-gitlens/pull/992) by Zeeshan Adnan ([@zeeshanadnan](https://github.com/zeeshanadnan))
- Adds a new _HEAD_ choice to the compare quick pick menu &mdash; closes [#927](https://github.com/gitkraken/vscode-gitlens/issues/927)
- Adds support for `.gitattributes` text conversion filters &mdash; closes [#866](https://github.com/gitkraken/vscode-gitlens/issues/866) thanks to [PR #1052](https://github.com/gitkraken/vscode-gitlens/pull/1052) by Martin Campbell ([@martin-css](https://github.com/martin-css))
- Adds week(s) ago to relative time formatting
- Adds a limit of 5000 commits to the _Load All_ command in GitLens views
- Adds a _Clear_ command to the branch comparison tool in GitLens views
- Adds compact mode for showing branch and tag tips on commits in GitLens views
- Adds _Copy SHA_ command to branches and tags in GitLens views

### Changed

- Changes all comparisons results to be split into ahead and behind groups
- Changes _Git CodeLens_ to be less intrusive when they are unavailable because of unsaved changes, via new defaults for the `gitlens.strings.codeLens.unsavedChanges.*` settings
- Refines all the GitLens contributed menus to reduce noise and improve usability
- Changes to use VS Code's built-in icons (codicons) where possible &mdash; closes [#985](https://github.com/gitkraken/vscode-gitlens/issues/985)
- Changes to use codicons in hovers &mdash; closes [#954](https://github.com/gitkraken/vscode-gitlens/issues/954)
- Changes revision navigation icons to better match VS Code
- Changes all the _Open \* on Remote_ command icons to use the _globe_ codicon
- Changes the comparison icons in GitLens views
- Changes the default blame annotation format to show 50 characters (instead of 40)
- Changes the relative date markers in GitLens views to be less prominent, and avoids showing the marker if it is first item
- Changes commit quick pick menu commands to align with commit context menu commands
- Changes the _Open Settings_ and _Welcome_ pages to open beside the active editor
- Changes the default sorting of branches so that _main_, _master_, and _develop_ are first
- Changes the sorting of branches in the _Git Commands Palette_ and other quick pick menus to be by date descending
- Changes the default sorting of remotes, so that _origin_ is first &mdash; closes [#924](https://github.com/gitkraken/vscode-gitlens/issues/924) &mdash; thanks to [PR #925](https://github.com/gitkraken/vscode-gitlens/pull/925) by Connor Peet ([@connor4312](https://github.com/connor4312))
- Changes the default sorting of tags to be by date descending
- Changes to limit `scm/resourceGroup/context` and `scm/resourceState/context` menu contributions
- Changes to support latest emojis in commit messages
- Improves VS Code startup performance by using the new `onStartupFinished` activation event
- Improves the performance of the _Details_ hover
- Improves the performance of loading _Contributors_ in the _Contributors_ and _Repositories_ views
- Improves the performance and experience when opening multiple files or revisions
- Improves the performance of the file system watching for repository changes (ignores `.gitignored` files)
- Moves the avatars in the _Gutter Blame_ file annotations to be part of the annotations rather than in the gutter itself
- Renames _Show More_ to _Load more_ in GitLens views
- Renames _Show Commit Details_ command to _Show Commit_
- Replaces _Push to Commit (via Terminal)_ command with a new _Push to Commit_ command
- Deprecates the _Line History_ view, as it has been integrated into the _File History_ view. While it will likely be removed in a future version, you can be re-enable it by setting `"gitlens.views.lineHistory.enabled": true`
- Deprecates the `gitlens.codeLens.scopesByLanguage` setting, use per-language `gitlens.codeLens.scopes`and`gitlens.codeLens.symbolScopes` settings instead
- Deprecates the `gitlens.gitCommands.search.showResultsInView` setting as it has been renamed to `gitlens.gitCommands.search.showResultsInSideBar`
- Deprecates the `gitlens.views.commitFileFormat` setting, use `gitlens.views.formats.files.label` instead
- Deprecates the `gitlens.views.commitFileDescriptionFormat` setting, use `gitlens.views.formats.files.description` instead
- Deprecates the `gitlens.views.commitFormat` setting, use `gitlens.views.formats.commits.label` instead
- Deprecates the `gitlens.views.commitDescriptionFormat` setting, use `gitlens.views.formats.commits.description` instead
- Deprecates the `gitlens.views.stashFileFormat` setting, use `gitlens.views.formats.files.label` instead
- Deprecates the `gitlens.views.stashFileDescriptionFormat` setting, use `gitlens.views.formats.files.description` instead
- Deprecates the `gitlens.views.stashFormat` setting, use `gitlens.views.formats.stashes.label` instead
- Deprecates the `gitlens.views.stashDescriptionFormat` setting, use `gitlens.views.formats.stashes.description` instead
- Deprecates the `gitlens.views.statusFileFormat` setting, use `gitlens.views.formats.files.label` instead
- Deprecates the `gitlens.views.statusFileDescriptionFormat` setting, use `gitlens.views.formats.files.description` instead
- Removes the sponsor heart icon from all GitLens views and simplifies the sponsor command
- Removes the useless _Collapse All_ command from the _File History_ view
- Removes the _Keep Open_ toggle button from the _Git Command Palette_ toolbar &mdash; the behavior is now automatically determined (unless overridden by the `gitlens.gitCommands.closeOnFocusOut` setting)
- Removes `${changes}` token from commit description format by default
- Removes the associated commit sha from tag descriptions
- Removes many view visibility (enablement) settings as the control over a views visibility is more easily controlled directly by unchecking the view itself
- Removes the `gitlens.views.repositories.showTrackingBranch` setting as it is now always enabled

### Fixed

- Fixes diffs of renamed files in certain cases
- Fixes [#1139](https://github.com/gitkraken/vscode-gitlens/issues/1139) - Git crash with v2.29.x
- Fixes typo forcably -> forcibly &mdash; thanks to [PR #1138](https://github.com/gitkraken/vscode-gitlens/pull/1138) by Andrea Cigana ([@ciganandrea](https://github.com/ciganandrea))
- Fixes missing empty (non-merge) commits
- Fixes issue with a blank branch name before any commits exist
- Fixes issues with missing repository or file system change events while vs code is unfocused
- Fixes remote url issues with spaces in the filename
- Fixes issue where <remote>/HEAD was showing up as a branch
- Fixes issues with revision navigation commands and diff editors
- Fixes show command with single file commits
- Fixes delete of remote branches on the _Git Command Palette_'s _branch_ command
- Fixes _Git Command Palette_'s back tracking in certain cases
- Fixes issue to ensure that dropping a stash drops the correct item even if the view is out of date
- Fixes the _Push Stash & Keep Staged_ option on the _Git Command Palette_'s _stash_ command
- Fixes issues with stashes and untracked files
- Fixes the wrong icon on the _Unstage All Changes_ command
- Fixes issue where a selection change wouldn't always trigger a Line History refresh
- Fixes issues where GitLens' files would not re-open properly on reload
- Fixes _Incomplete string escaping or encoding_ code scan warning &mdash; https://github.com/gitkraken/vscode-gitlens/security/code-scanning/1
- Fixes _Inefficient regular expression_ code scan warning &mdash; https://github.com/gitkraken/vscode-gitlens/security/code-scanning/2
- Fixes [#1072](https://github.com/gitkraken/vscode-gitlens/issues/1072) - Add whitespace to tree item tooltip &mdash; thanks to [PR #1073](https://github.com/gitkraken/vscode-gitlens/pull/1073) by Alex ([@deadmeu](https://github.com/deadmeu))
- Fixes _Git Command Palette_'s _stash drop_ command not working
- Fixes [#1033](https://github.com/gitkraken/vscode-gitlens/issues/1033) - Adopt VS Code's 'asWebviewUri' API
- Fixes issues with _Open Changes with Previous Revision_ and diff editors
- Fixes issues with _Open Changes with Working File_ and diff editors
- Fixes issue with the previous line diff line number being off
- Fixes issues with bogus merge commits that can show up in file histories; now using `--first-parent` for git log with `--follow`
- Fixes issues with paging git log with merge commits
- Fixes directory compare from waiting for external tool to exit
- Fixes [#996](https://github.com/gitkraken/vscode-gitlens/issues/996) - Rename branch should show existing name highlighted
- Fixes issues with folders that end with a space
- Fixes typo in contributing search tag link &mdash; thanks to [PR #981](https://github.com/gitkraken/vscode-gitlens/pull/981) by Guillem González Vela ([@guillemglez](https://github.com/guillemglez))
- Fixes [#970](https://github.com/gitkraken/vscode-gitlens/issues/970) - Stashes doesn't honor files layout
- Fixes _Load more_ in GitLens views with range notation comparisons
- Fixes `ignoreCase` flag on autolinks
- Fixes [#951](https://github.com/gitkraken/vscode-gitlens/issues/951) - Starring branch updates repository view properly &mdash; thanks to [PR #963](https://github.com/gitkraken/vscode-gitlens/pull/963) by Zeeshan Adnan ([@zeeshanadnan](https://github.com/zeeshanadnan))
- Fixes issues with switch branch command error handling
- Fixes issues with stash command error handling
- Fixes file history issues with copied and deleted files
- Fixes intermittent issues with _Reveal Commit in Repositories View_
- Fixes [#910](https://github.com/gitkraken/vscode-gitlens/issues/910) - "Show Commit in Search Commits View" doesn't work
- Fixes issues with hovers not showing on first editor
- Fixes autolinking with remote providers
- Fixes issues with some settings metadata

## [10.2.2] - 2020-06-10

### Added

- Adds unique icons for each GitLens view to better support view moving in VS Code 1.46

### Fixed

- Fixes an issue with some settings showing up with errors on the VS Code settings UI

## [10.2.1] - 2020-02-10

### Fixed

- Fixes [#932](https://github.com/gitkraken/vscode-gitlens/issues/932) - Absolute path used in compare on git version 2.25.0.windows.1
- Fixes an issue with showing changes of staged files in _File History_ view, _Open Changes with Previous Revision_ command, etc.
- Fixes certain error handling because of change in a VS Code error message
- Fixes file history issues w/ copied/deleted files

## [10.2.0] - 2019-11-18

### Added

- Adds user-defined autolinks to external resources in commit messages &mdash; closes [#897](https://github.com/gitkraken/vscode-gitlens/issues/897)
  - Adds a `gitlens.autolinks` setting to configure the autolinks
  - For example to autolink Jira issues (e.g. `JIRA-123 ⟶ https://jira.company.com/issue?query=123`):
    - Use `"gitlens.autolinks": [{ "prefix": "JIRA-", "url": "https://jira.company.com/issue?query=<num>" }]`
- Adds a _Highlight Changes_ command (`gitlens.views.highlightChanges`) to commits in GitLens views to highlight the changes lines in the current file
- Adds a _Highlight Revision Changes_ command (`gitlens.views.highlightRevisionChanges`) to commits in GitLens views to highlight the changes lines in the revision
- Adds branch and tag sorting options to the interactive settings editor

### Changed

- Changes commit search to auto-detect full commit shas without the need to prefix it with `commit:` or `#:`
- Changes paging in GitLens views to no longer be naive and now only loads the additional required data for much better performance
- Changes the _Toggle File Layout_ command icon when in tree layout to match VS Code
- Restores the original commit icon in the editor toolbar

### Fixed

- Fixes [#893](https://github.com/gitkraken/vscode-gitlens/issues/893) - Problems with # symbol in branch names &mdash; thanks to [PR #894](https://github.com/gitkraken/vscode-gitlens/pull/894) by Allan Karlson ([@bees4ever](https://github.com/bees4ever))
- Fixes [#677](https://github.com/gitkraken/vscode-gitlens/issues/677) - Line and file history not working in symlinked repository
- Fixes [#667](https://github.com/gitkraken/vscode-gitlens/issues/667) - Decoration rendered before code
- Fixes issues where line blame annotations would sometimes stop working
- Fixes compact view when branches are shown as a tree

## [10.1.2] - 2019-11-06

### Changed

- Changes commit icon to be closer to VS Code's
- Changes webviews (welcome, settings) to have inline CSS to avoid FOUC (flash of unstyled content)
- Only applies `--ignore-revs-file` custom blame flag if it is supported by the current Git version and the file exists

### Fixed

- Fixes [#882](https://github.com/gitkraken/vscode-gitlens/issues/882) - Search for changes command is malformed
- Fixes [#875](https://github.com/gitkraken/vscode-gitlens/issues/875) - Editing causes all contextual blames to disappear
- Fixes [#890](https://github.com/gitkraken/vscode-gitlens/issues/890) - Version warning "Don't Show Again" button not working
- Fixes [#889](https://github.com/gitkraken/vscode-gitlens/issues/889) - Make the heart icon (support GitLens) rounder
- Fixes broken view layout buttons in the interactive settings editor

## [10.1.1] - 2019-10-10

### Added

- Adds new options to sort tags by date, similar to branches via the `gitlens.sortTagsBy` setting
- Adds the tag reference and date to tags in the _Repositories_ view

### Changed

- Bumps the required version of Git to be at least 2.7.2

### Fixed

- Fixes [#872](https://github.com/gitkraken/vscode-gitlens/issues/872) - OpenFileInRemoteCommand Cannot read property 'range' of null
- Fixes [#855](https://github.com/gitkraken/vscode-gitlens/issues/855) - Missing tags in Repositories view
- Fixes an issue when creating tags with a message that contains spaces
- Fixes an issue when creating and switching to a new branch

## [10.1.0] - 2019-10-06

### Added

- Adds a new _Git Commands_ (`gitlens.gitCommands`)
  - Adds a new _branch_ command with sub-commands for _create_, _rename_, and _delete_
    - Adds a _Reveal Branch in Repositories View_ button to the quick pick menu toolbar
    - Adds keyboard navigation
      - `right arrow` &mdash; reveals the selected branch in the _Repositories_ view, if there is no text in the quick pick menu
      - `alt+right arrow`, `ctrl+right arrow`, `cmd+right arrow` (macOS) &mdash; reveals the selected branch in the _Repositories_ view
  - Adds a new _tag_ command with sub-commands for _create_, and _delete_
    - Adds a _Reveal Branch in Repositories View_ or _Reveal Tag in Repositories View_ button to the quick pick menu toolbar
    - Adds keyboard navigation
      - `right arrow` &mdash; reveals the selected branch or tag in the _Repositories_ view, if there is no text in the quick pick menu
      - `alt+right arrow`, `ctrl+right arrow`, `cmd+right arrow` (macOS) &mdash; reveals the selected branch or tag in the _Repositories_ view
- Adds better co-author support &mdash; closes [#373](https://github.com/gitkraken/vscode-gitlens/issues/373)
  - Adds a new _co-author_ command to the _Git Commands_ quick pick menu to add a co-author to a commit message
  - Adds a new _Add Co-authors_ command to the inline toolbar and context menu for the _Contributors_ node in the _Repositories_ view
  - Adds the _Add as Co-author_ command to the inline toolbar for the contributors in the _Repositories_ view
- Adds support for GitHub Pull Request uri schemes (`pr://`) &mdash; closes [#678](https://github.com/gitkraken/vscode-gitlens/issues/678)
- Adds new actions options to the status bar blame
  - Adds a `gitlens.showCommitsInView` option to show the commit in the _Search Commits_ view
  - Adds a `gitlens.revealCommitInView` option to reveal the commit in the _Repositories_ view
- Adds a new _Rename Branch..._ command to branches in the _Repositories_ view

### Changed

- Improves (drastically) the performance of revealing commits in the _Repositories_ view
- Changes the _Create Branch (via Terminal)..._ command to _Create Branch..._ and uses the _branch_ _create_ Git command
- Changes the _Delete Branch (via Terminal)..._ command to _Delete Branch..._ and uses the _branch_ _delete_ Git command
- Changes the _Create Tag (via Terminal)..._ command to _Create Tag..._ and uses the _tag_ _create_ Git command
- Changes the _Delete Tag (via Terminal)..._ command to _Delete Tag..._ and uses the _tag_ _delete_ Git command

### Fixed

- Fixes [#826](https://github.com/gitkraken/vscode-gitlens/issues/826) - Deleting stash doesn't remove the stash from the list - have to refresh
- Fixes [#769](https://github.com/gitkraken/vscode-gitlens/issues/769) - compacting causes duplicate names
- Fixes issues with issue linking in hovers
- Fixes issues with the _Show commits in Search Commits view_ Git CodeLens action with uncommitted changes
- Fixes missing prefix while search nodes are loading

## [10.0.1] - 2019-09-24

### Added

- Adds a button to toggle the file layout (list vs. tree vs. auto) to the _Repositories_, _Compare_, and _Search Commits_ views
- Adds a button to toggle the branch layout (list vs. tree) to the _Branches_ node of the _Repositories_ view

### Changed

- Changes the experimental _Incoming Activity_ node in the _Repositories_ view to be available for everyone (not just if `gitlens.insiders` is `true`)

### Fixed

- Fixes [#862](https://github.com/gitkraken/vscode-gitlens/issues/862) - Command failed when expanding a local branch
- Fixes [#860](https://github.com/gitkraken/vscode-gitlens/issues/860) - Unknown date format error
- Fixes [#858](https://github.com/gitkraken/vscode-gitlens/issues/858) - GitHub avatars in blame line hovers are huge
- Fixes issue with locating a working file when the file is staged or modified

## [10.0.0]- 2019-09-20

### Added

- Adds all-new iconography to better match VS Code's new visual style &mdash; thanks to John Letey ([@johnletey](https://github.com/johnletey)) and Jon Beaumont-Pike ([@jonbp](https://github.com/jonbp)) for their help!
- Adds an all-new Welcome experience with a simple quick setup of common GitLens features &mdash; accessible via the _GitLens: Welcome_ (`gitlens.showWelcomePage`) command
- Adds a new and improved interactive Settings editor experience &mdash; accessible via the _GitLens: Open Settings_ (`gitlens.showSettingsPage`) command
- Adds a new and improved _Git Commands_ (`gitlens.gitCommands`) experience
  - Adds a _Keep Open_ toggle button to the quick pick menu toolbar
    - Saves to the new `gitlens.gitCommands.closeOnFocusOut` setting to specify whether to dismiss the Git Commands menu when focus is lost (if not, press `ESC` to dismiss)
  - Adds a confirmation indicator / toggle button to the quick pick menu toolbar
    - Indicates whether the specified Git command will have a confirmation step &mdash; some commands require confirmation and can't be toggled
    - Saves to the new `gitlens.gitCommands.skipConfirmations` setting to specify which (and when) Git commands will skip the confirmation step
  - Adds keyboard navigation
    - `left arrow` &mdash; goes back to previous step, if there is no text in the quick pick menu
    - `alt+left arrow`, `ctrl+left arrow`, `cmd+left arrow` (macOS) &mdash; goes back to previous step
  - Adds a new _search_ command to search for specific commits &mdash; see below for more details on the all-new commit search experience
  - Adds a new _stash_ command with sub-commands for _apply_, _drop_, _list_, _pop_, and _push_
    - Adds a _Reveal Stash in Repositories View_ button to the quick pick menu toolbar
    - Adds keyboard navigation
    - `right arrow` &mdash; reveals the selected stash in the _Repositories_ view, if there is no text in the quick pick menu
    - `alt+right arrow`, `ctrl+right arrow`, `cmd+right arrow` (macOS) &mdash; reveals the selected stash in the _Repositories_ view
  - Adds a new _reset_ command to reset current HEAD to a specified commit
  - Adds a new _revert_ command to revert specific commits
  - Improves and enhances the _fetch_ command
    - Adds a new _Fetch All & Prune_ confirmation option
    - Adds the last fetched on date to the confirmation step, when a single repo is selected
  - Improves and enhances the _pull_ command
    - Adds a _Fetch_ button to the quick pick menu toolbar on the confirmation step, when a single repo is selected
    - Adds the last fetched on date to the confirmation step, when a single repo is selected
    - Adds the number of commits to pull on the confirmation step, when a single repo is selected
  - Improves and enhances the _push_ command
    - Adds a new _Force Push_ confirmation option
    - Adds the number of commits to push on the confirmation step, when a single repo is selected
  - Improves and enhances the _merge_ command
    - Adds a new _Squash Merge_ confirmation option
    - Adds the ability to choose an arbitrary reference (commit id) just by typing (pasting)
  - Improves and enhances the _rebase_ command
    - Adds the ability to switch between picking a branch/tag or a specific commit via a toggle button in the quick pick menu toolbar
    - Adds the ability to choose an arbitrary reference (commit id) just by typing (pasting)
  - Improves and enhances the _cherry-pick_ command
    - Adds the ability to choose an arbitrary reference (commit id) just by typing (pasting)
  - Improves and enhances the _checkout_ command &mdash; now renamed to _switch_ for better clarity and to align with the new Git 2.23 commands
    - Adds the ability to create a local branch from a remote branch
    - Adds the ability to choose an arbitrary reference (commit id) just by typing (pasting)
- Adds an all-new commit search experience, via the _Git Commands_ (`gitlens.gitCommands`) or _Search Commits_ (`gitlens.showCommitSearch`) commands
  - Adds the ability to match on more than one search pattern &mdash; closes [#410](https://github.com/gitkraken/vscode-gitlens/issues/410)
  - Adds case-\[in\]sensitive matching support &mdash; defaults to the new `gitlens.gitCommands.search.matchCase` setting
  - Adds support for regular expression matching &mdash; defaults to the new `gitlens.gitCommands.search.matchRegex` setting
  - Adds the ability to match on all or any patterns when searching commit messages &mdash; defaults to the new `gitlens.gitCommands.search.matchAll` setting
  - Adds the ability to show results in the _Search Commits_ view or within the quick pick menu via a toggle button in the quick pick menu toolbar
  - Adds a _Reveal Commit in Repositories View_ button to the quick pick menu toolbar
  - Adds a _Show Commit in Search Commits View_ button to the quick pick menu toolbar
  - Adds keyboard navigation
    - `right arrow` &mdash; shows the selected commit in the _Search Commits_ view, if there is no text in the quick pick menu
    - `alt+right arrow` &mdash; shows the selected commit in the _Search Commits_ view
    - `ctrl+right arrow`, `cmd+right arrow` (macOS) &mdash; reveals the selected commit in the _Repositories_ view
- Adds a _Reveal Commit in Repositories View_ (`gitlens.revealCommitInView`) command to reveal the current commit in the _Repositories_ view &mdash; this can take a while, so it will show a progress notification with the ability to cancel the operation
  - Adds _Reveal Commit in Repositories View_ command to the commit context menu in the views
  - Adds _Reveal Commit in Repositories View_ command in commit quick pick menu
- Adds a _Show Commits within Selection in Search Commits View_ (`gitlens.showCommitsInView`) command to show all the commits within the current selection in the _Search Commits_ view
- Adds new actions options to the Git CodeLens
  - Adds a `gitlens.showCommitsInView` option to the recent change CodeLens to show the recent commit in the _Search Commits_ view
  - Adds a `gitlens.showCommitsInView` option to the authors CodeLens to show the commits within the range of the CodeLens block in the _Search Commits_ view
  - Adds a `gitlens.revealCommitInView` option to the recent change CodeLens to reveal the recent commit in the _Repositories_ view
  - Adds a `gitlens.revealCommitInView` option to the authors CodeLens to reveal the primary author's commit in the _Repositories_ view
- Adds the _Open Changes with Working File_ command to the inline toolbar for files in views
- Adds the _Open Revision_ command to the editor toolbar and tabs context menu when a revision file is active in the diff editor
- Adds this _Explore Repository from Revision_ command to the editor toolbar and tabs context menu when a revision file is active
- Adds a _Prune_ command to remotes in the _Repositories_ view to prune remote references &mdash; closes [#556](https://github.com/gitkraken/vscode-gitlens/issues/556) thanks to [PR #815](https://github.com/gitkraken/vscode-gitlens/pull/815) by Zach Boyle ([@zaboyle](https://github.com/zaboyle))
- Adds ability to sort branches and tags in quick pick menus and views &mdash; closes [#745](https://github.com/gitkraken/vscode-gitlens/issues/745)
  - Adds a `gitlens.sortBranchesBy` setting to specify how branches are sorted in quick pick menus and views
  - Adds a `gitlens.sortTagsBy` setting to specify how tags are sorted in quick pick menus and views
- Adds the _Pull_ and/or _Push_ command to current branch in the _Repositories_ view if the current branch is not up to date with its upstream
- Adds ability to copy the selected item's details to the clipboard using the standard copy shortcut key when focused on a GitLens view
- Adds last commit date to branches in quick pick menus and views
- Adds support to use the GitHub avatar (if available) for authors with `@users.noreply.github.com` email addresses &mdash; partially addresses [#281](https://github.com/gitkraken/vscode-gitlens/issues/281) thanks to [PR #814](https://github.com/gitkraken/vscode-gitlens/pull/814) by bolte-17 ([@bolte-17](https://github.com/bolte-17))

### Changed

- Changes _Stash All Changes_ commands in the Source Control view to toggle --keep-index appropriately &mdash; closes [#698](https://github.com/gitkraken/vscode-gitlens/issues/698)
- Changes Ansible files to use document scope for CodeLens &mdash; thanks to [PR #813](https://github.com/gitkraken/vscode-gitlens/pull/813) by Ahmadali Shafiee ([@ahmadalli](https://github.com/ahmadalli))
- Changes fetch commands to use the _fetch_ Git command
- Changes pull commands to use the _pull_ Git command
- Changes push commands to use the _push_ Git command
- Changes stash commands to use the new _stash_ Git command
- Changes the _Checkout_ command on branches, commits, and tags to use the _switch_ Git command
- Changes the _Cherry Pick Commit (via Terminal)_ command to use the _cherry-pick_ Git command
- Changes the _Merge Branch (via Terminal)_, and _Squash Branch into Commit (via Terminal)_ commands to use the _merge_ Git command
- Changes the _Rebase (Interactive) Branch (via Terminal)_, _Rebase (Interactive) Branch to Remote (via Terminal)_, and _Rebase to Commit (via Terminal)_ commands to use the _rebase_ Git command
- Changes the _Reset to Commit (via Terminal)_ command to use the _reset_ Git command
- Changes the _Revert Commit (via Terminal)_ command to use the _revert_ Git command
- Renames _Checkout_ command to _Switch_ for branches and tags for better clarity and to align with the new Git 2.23 commands
- Renames _Checkout_ command to _Restore_ for commit/stash files for better clarity and to align with the new Git 2.23 commands
- Renames Stashed Changes to Stashes or Stash depending on the context
- Renames _Copy \* to Clipboard_ commands to _Copy \*_
- Renames _Show Commit in View_ (`gitlens.showCommitInView`) command to _Show Commit in Search Commits View_
- Renames _Show File History in View_ (`gitlens.showFileHistoryInView`) command to _Show in File History View_
- Rearranges the ordering and groupings of the view item context menus

### Removed

- Removes _Show Commit Details_ from view item context menus
- Removes _Show File History_ from view item context menus

### Fixed

- Fixes [#849](https://github.com/gitkraken/vscode-gitlens/issues/849) - Extra backslash in the hovers blame detail's link
- Fixes [#847](https://github.com/gitkraken/vscode-gitlens/issues/847) - Refresh button on Compare With Branch view is not working
- Fixes [#842](https://github.com/gitkraken/vscode-gitlens/issues/842) - List of changed files in comparison to working tree only shows changed files in comparison to HEAD
- Fixes [#828](https://github.com/gitkraken/vscode-gitlens/issues/828) - Version comparison to show welcome message is not future proof &mdash; thanks to [PR #829](https://github.com/gitkraken/vscode-gitlens/pull/829) by Arunprasad Rajkumar ([@arajkumar](https://github.com/arajkumar))
- Fixes [#821](https://github.com/gitkraken/vscode-gitlens/issues/821) - Wrong comparison order in the Compare view when using Compare [HEAD|Working Tree] With commands
- Fixes [#794](https://github.com/gitkraken/vscode-gitlens/issues/794) - Can't get back to settings page easily
- Fixes [#738](https://github.com/gitkraken/vscode-gitlens/issues/738) - Disable showWhatsNewAfterUpgrades notification
- Fixes [#723](https://github.com/gitkraken/vscode-gitlens/issues/723) (partially) - Top right tool loading/placement enhancement
- Fixes issues with the _Open Changes with Working File_ command when invoked from a stash
- Fixes issue where the _Open Line Changes with Previous Revision_ command would open the correct comparison in the diff editor
- Fixes some issues with the _Open Changes with Previous Revision_ and _Open Changes with Next Revision_ commands when in the right or left side of the diff editor
- Fixes an issue with branch sorting when the current branch was tree'd
- Fixes issues with the _Explore Repository from Revision_, _Open Revision_, _Open Files_, _Open Revisions_, _Open All Changes_, _Open All Changes with Working Tree_ commands in the latest VS Code
- Fixes typo of "workbench.colorCustomization" in README &mdash; thanks to [PR #823](https://github.com/gitkraken/vscode-gitlens/pull/823) by Kwok ([@mankwok](https://github.com/mankwok))

## [9.9.3] - 2019-08-06

### Added

- Adds an _Add Remote_ command to the _Remotes_ node of the _Repositories_ view &mdash; closes [#694](https://github.com/gitkraken/vscode-gitlens/issues/694) thanks to [PR #802](https://github.com/gitkraken/vscode-gitlens/pull/802) by Zach Boyle ([@zaboyle](https://github.com/zaboyle))

### Changed

- Reverses the order of comparisons in the _Compare_ view for consistent comparisons results

### Fixed

- Fixes [#812](https://github.com/gitkraken/vscode-gitlens/issues/812) - Regression in 9.9.2: Clicking changed file in Repository Browser opens diff view between WorkingTree <-> WorkingTree, not index

## [9.9.2] - 2019-08-01

### Added

- Adds a _Checkout_ command to the current branch in the _Repositories_ view which opens a quick pick menu to choose a new branch to checkout to

### Fixed

- Fixes [#806](https://github.com/gitkraken/vscode-gitlens/issues/806) - file diff in two-dot branch compare should only show the changes in one branch
- Fixes [#756](https://github.com/gitkraken/vscode-gitlens/issues/756) - Merge commit shows only the changes from the last commit on those files
- Fixes [#809](https://github.com/gitkraken/vscode-gitlens/issues/809) - Wrong commit diff in file history
- Fixes [#685](https://github.com/gitkraken/vscode-gitlens/issues/685) - GitLens not loading for a single repository
- Fixes [#789](https://github.com/gitkraken/vscode-gitlens/issues/789) - Line blame annotations not working when vscode root is home dir and .gnupg dir is inaccessible
- Fixes [#649](https://github.com/gitkraken/vscode-gitlens/issues/649) - GitLens can't see the remote but git can
- Fixes [#798](https://github.com/gitkraken/vscode-gitlens/issues/798) - git pull/fetch all repositories
- Fixes [#805](https://github.com/gitkraken/vscode-gitlens/issues/805) - Version 9.9.1 breaks working tree comparison
- Fixes an issue where the GitLens _Compare_ view was shown when using the _Select for Compare_ command in the _Repositories_ view

## [9.9.1] - 2019-07-23

### Fixed

- Fixes [#797](https://github.com/gitkraken/vscode-gitlens/issues/797) - Branch diff against master shows incorrect files in two-dot mode

## [9.9.0] - 2019-07-21

### Added

- Adds guided (step-by-step) access to common Git commands (and their flags) via the all-new _Git Commands_ command (`gitlens.gitCommands`)
  - Quickly navigate and execute Git commands through easy-to-use menus where each command requires an explicit confirm step before executing
- Adds _Open All Changes_, _Open All Changes with Working Tree_, _Open Files_, and _Open Revisions_ commands to files changed nodes in the views &mdash; closes [#760](https://github.com/gitkraken/vscode-gitlens/issues/760)
- Adds a new `${tips}` format token to show an indicator if the commit is a tip of any branches or tags &mdash; closes [#792](https://github.com/gitkraken/vscode-gitlens/issues/792)

### Changed

- Improves performance and memory consumption
- Changes the _Checkout_ command on remote branches to create and checkout a new local branch rather than checkout a detached HEAD &mdash; closes [#709](https://github.com/gitkraken/vscode-gitlens/issues/709)
- Changes folders in the views to expand by default when using _Tree Layout_

### Fixed

- Fixes [#791](https://github.com/gitkraken/vscode-gitlens/issues/791) - Notification of unstashed changes in working directory on failed checkout
- Fixes [#795](https://github.com/gitkraken/vscode-gitlens/issues/795) - Commit quick access icons replaced with open file actions in File History View
- Fixes issue with the JSON schema of a configuration setting

## [9.8.5] - 2019-07-10

### Changed

- Cleans up the layout and formatting of many quick pick menus

### Fixed

- Fixes issue where _Search Commits_ from repositories in the _Repositories_ view would incorrectly show a repository picker

## [9.8.4] - 2019-07-10

### Added

- Adds _Switch to Two-dot Comparison_ and _Switch to Three-dot Comparison_ commands to specify whether to use the symmetric difference (three-dot) notation or the range (two-dot) notation for the comparison &mdash; applies to all comparisons in the views

### Changed

- Changes the _Switch to Working Tree Comparison_ and _Switch to Branch Comparison_ commands to only affect the current comparison, rather than changing the `gitlens.views.repositories.showBranchComparison` setting

## [9.8.3] - 2019-07-09

### Added

- Adds working tree comparison support to the _Compare Current Branch with &lt;branch, tag, or ref&gt;_ node within each repository in the _Repositories_ view
  - Changes `gitlens.views.repositories.showBranchComparison` to also specify the type of comparison &mdash; either with the current branch or the working tree
  - Adds a _Switch to Working Tree Comparison_ command or _Switch to Branch Comparison_ command to the _Compare Current Branch with &lt;branch, tag, or ref&gt;_ node
- Adds the _Open Revision_ command as an `alt-click` of the _Open File_ command on files in the views
- Adds the _Open File_ command as an `alt-click` of the _Open Revision_ command on files in the views

### Changed

- Changes fetch, pull, and push commands to be executed in parallel, rather than sequentially
- Changes _Search Commits_ command (`gitlens.showCommitSearch`) to prompt for a repository, if there is more than one

### Removed

- Removes `gitlens.settings.mode` setting as the interactive settings editor (via the _GitLens: Open Settings_ command) will always show all settings now

### Fixed

- Fixes [#776](https://github.com/gitkraken/vscode-gitlens/issues/776) - File history sidebar having "Open file" instead of "Open revision"
- Fixes [#692](https://github.com/gitkraken/vscode-gitlens/issues/692) - Can't open remote on bitbucket &mdash; thanks to [PR #767](https://github.com/gitkraken/vscode-gitlens/pull/767) by Guillaume Rozan ([@grozan](https://github.com/grozan))
- Fixes a parsing issue with certain renamed files
- Fixes some issues with emoji rendering

## [9.8.2] - 2019-06-10

### Added

- Adds a changes indicator (+x -x) to the _File History_ view to quickly show the number of added and/or deleted lines

### Changed

- Preserve _Show More_ expansions during file system or repository changes &mdash; avoids losing view expansion and selection
- Changes to match authors exactly in the Contributors view

### Fixed

- Fixes [#734](https://github.com/gitkraken/vscode-gitlens/issues/734) - Not working with VS Code Remote - SSH extension (fixes the broken hover image)
- Fixes [#751](https://github.com/gitkraken/vscode-gitlens/issues/751) - Git Command failed
- Fixes [#756](https://github.com/gitkraken/vscode-gitlens/issues/756) - Merge commit shows only the changes from the last commit on those files
- Fixes issue with the _Open Changes with Previous Revision_ command when run from the diff editor and the file has unstaged changes
- Fixes an issue where view expansion and selection was getting lost with search and compare nodes
- Fixes the _Show More_ command in the _File History_ and _Line History_ views
- Fixes a caching issue with file histories

## [9.8.1] - 2019-05-23

### Fixed

- Fixes a regression where the _Copy Remote URL to Clipboard_ command fails to include the selected line range

## [9.8.0] - 2019-05-22

### Added

- Adds a new _Compare Current Branch with &lt;branch, tag, or ref&gt;_ node to each repository in the _Repositories_ view &mdash; closes [#293](https://github.com/gitkraken/vscode-gitlens/issues/293)
  - **Compare Current Branch with &lt;branch, tag, or ref&gt;** &mdash; optionally shows a comparison of the current branch to a user-selected reference
    - **\* Commits** &mdash; lists the commits between the compared revisions
      - Expands to provide the message, author, date, and change indicator of each revision (commit)
        - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
          - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
          - A context menu provides access to more common file revision commands
    - **\* Files Changed** &mdash; lists all of the files changed between the compared revisions
- Adds a _Show a comparison of the current branch to a user-selected reference_ (`gitlens.views.repositories.showBranchComparison`) setting to specify whether to show a comparison of the current branch to a user-selected reference in the _Repositories_ view
- Adds a `gitlens.advanced.useSymmetricDifferenceNotation` setting to specify whether to use the symmetric difference (three-dot) notation or the range (two-dot) notation for comparisons &mdash; closes [#330](https://github.com/gitkraken/vscode-gitlens/issues/330)
- Adds a _Copy Remote URL to Clipboard_ command to commit quick pick menus

### Changed

- Changes _Pull_ and _Pull Repositories_ commands to just fetch the repository if the current branch has no tracking branch

### Fixed

- Fixes [#734](https://github.com/gitkraken/vscode-gitlens/issues/734) - Not working with VS Code Remote - SSH extension
- Fixes [#739](https://github.com/gitkraken/vscode-gitlens/issues/739) - Breadcrumbs don't work on file revisions
- Fixes [#750](https://github.com/gitkraken/vscode-gitlens/issues/750) - Open file on GitHub does not include directory path
- Fixes an issue with the _Open Revision_ command in the quick pick menus not working properly

## [9.7.4] - 2019-05-15

### Added

- Adds a new experimental _Incoming Activity_ node to each repository in the _Repositories_ view (enabled via `"gitlens.insiders": true`) &mdash; closes [#735](https://github.com/gitkraken/vscode-gitlens/issues/735)
  - **Incoming Activity** &mdash; lists the recent incoming activity (merges and pulls) to your local repository
    - Provides the command, branch (if available), and date of each activity
      - A context menu provides access to the _Refresh_ command
      - Each activity expands to list the commits added by the command
        - An inline toolbar provides quick access to the _Compare with HEAD_ (`alt-click` for _Compare with Working Tree_), _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open Commit on Remote_ (if available) commands
        - A context menu provides access to more common revision (commit) commands
        - Each revision (commit) expands to list its set of changed files, complete with status indicators for adds, changes, renames, and deletes
          - An inline toolbar provides quick access to the _Open File_, _Copy Commit ID to Clipboard_ (`alt-click` for _Copy Commit Message to Clipboard_), and _Open File on Remote_ (if available) commands
          - A context menu provides access to more common file revision commands

### Fixed

- Fixes issues with the _Show More Actions_ button on the _Details_ hover not working with renamed files
- Fixes issues with the _Open File_, _Open Files_, _Open All Changes with Working Tree_, and _Apply Changes_ commands in the views not working with renamed files
- Fixes issues with the _Open File_, _Open Files_, and _Apply Changes_ commands in the quick pick menus not working with renamed files
- Fixes issues with the _Show Stashed Changes_ command (`gitlens.showQuickStashList`) and multiple repositories

## [9.7.3] - 2019-05-11

### Fixed

- Fixes [#740](https://github.com/gitkraken/vscode-gitlens/issues/740) - Opening untracked files from "files changed" section fails
- Fixes issue where the _Open Changes with Previous Revision_ command would compare the working file with HEAD even if there were no working file changes (now it will compare HEAD with the previous commit)
- Fixes issue where the _Open Changes_, _Open Changes with Working File_, and _Open Revision_ commands on files in the "files changed" section of the _Repositories_ view would either fail or do nothing

## [9.7.2] - 2019-05-10

### Fixed

- Fixes [#737](https://github.com/gitkraken/vscode-gitlens/issues/737) - failed to fetch commits and branches
- Fixes [#743](https://github.com/gitkraken/vscode-gitlens/issues/743) - Update activity bar icon size &mdash; thanks to [PR #744](https://github.com/gitkraken/vscode-gitlens/pull/744) by Miguel Solorio ([@misolori](https://github.com/misolori))

## [9.7.1] - 2019-05-06

### Fixed

- Fixes [#736](https://github.com/gitkraken/vscode-gitlens/issues/736) - git command error on GitLens 9.7.0 (unknown '-M' option)

## [9.7.0] - 2019-05-05

### Added

- Adds support for Live Share presence
  - Adds an avatar presence indicator and an invite button to start a Live Share session with the code author<br />![Live Share presence](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/images/docs/hovers-details-vsls.png)
  - Adds presence status and an _Invite to Live Share_ command to contributor nodes in the _Repositories_ view
- Adds a new _Views Side Bar Layout_ section to the interactive settings editor (via the _GitLens: Open Settings_ command) with 3 layout presets
  - _Default_ &mdash; shows all the views together on the GitLens side bar
  - _Source Control_ &mdash; shows all the views together on the Source Control side bar
  - _Contextual_ &mdash; shows _Repositories_ on the Source Control side bar, _File_ and _Line History_ on the Explorer side bar, and others on the GitLens side bar
- Improves the accuracy and experience of the following:
  - _Details_ hover
  - _Changes (diff)_ hover
  - _Open Changes with Previous Revision_ command
  - _Open Line Changes with Previous Revision_ command &mdash; closes [#719](https://github.com/gitkraken/vscode-gitlens/issues/719)
  - _Open Changes with Working File_ command
  - _Open Line Changes with Working File_ command
  - _Open Changes with Next Revision_ command
- Adds support to the _Details_ and _Changes (diff)_ hovers to differentiate between staged and unstaged changed
- Adds a _Show All_ command to the _Show More_ nodes in the views
- Adds _Show More_ support (i.e. paging) to the _File_ and _Line History_ views
- Adds an improved experience when starting a new commit search or comparison
- Adds the renamed path to the description and tooltip of file nodes in the views
- Adds a `gitlens.advanced.maxSearchItems` setting to specify the maximum number of items to show in a search &mdash; closes [#728](https://github.com/gitkraken/vscode-gitlens/issues/728)
- Adds a `gitlens.defaultDateSource` setting to specify whether commit dates should use the authored or committed date &mdash; closes [#537](https://github.com/gitkraken/vscode-gitlens/issues/537) thanks to [PR #707](https://github.com/gitkraken/vscode-gitlens/pull/707) by Mathew King ([@MathewKing](https://github.com/MathewKing))
- Adds a `gitlens.advanced.similarityThreshold` setting to specify the amount (percent) of similarity a deleted and added file pair must have to be considered a rename &mdash; closes [#670](https://github.com/gitkraken/vscode-gitlens/issues/670) thanks to [PR #714](https://github.com/gitkraken/vscode-gitlens/pull/714) by x13machine ([@x13machine](https://github.com/x13machine))
- Adds visual tracking to the table of contents of the interactive settings editor to make it easier to navigate and keep context
- Adds new documentation on how to use and customize GitLens' formatting settings: [View Docs](https://github.com/gitkraken/vscode-gitlens/wiki/Custom-Formatting)
- Adds an `${originalPath}` token for use with file formatting which provides the full file path of the original file, if renamed
- Adds better logging to show current mode on startup and when changed &mdash; closes [#725](https://github.com/gitkraken/vscode-gitlens/issues/725)

### Changed

- Changes path collapsing to also collapse root paths when using the compact file layout in the views
- Ensures file rename detection when getting the status of a repo or file

### Removed

- Removes searching for commits by changed occurrences (`-S` flag) as it is too confusing and searching by changes (`-G` flag) better matches user expectations &mdash; closes [#730](https://github.com/gitkraken/vscode-gitlens/issues/730)

### Fixed

- Fixes [#729](https://github.com/gitkraken/vscode-gitlens/issues/729) - "Show more results" in search commit show less results
- Fixes [#716](https://github.com/gitkraken/vscode-gitlens/issues/716) - Browsing history of a renamed file fails in forward direction
- Fixes [#724](https://github.com/gitkraken/vscode-gitlens/issues/724) - GitService.getBranches very very very long
- Fixes [#625](https://github.com/gitkraken/vscode-gitlens/issues/625) - Branches in _Repositories_ view shows some commit comment texts as branches
- Fixes issues with keyboard navigation (`alt+,` and `alt+.`) in commit details of the file history quick pick menu
- Fixes issues with keyboard navigation (`alt+,` and `alt+.`) in commit details of the branch history quick pick menu
- Fixes issues when showing all results in various lists and views
- Fixes issue with id collisions between branches, remotes, and tags in the _Repositories_ view
- Fixes the _Line History_ view when there are uncommitted and/or unsaved changes
- Fixes various issues when trying to find the working file from a commit
- Fixes issues where the _Changes (diff)_ hover wouldn't work properly with renamed files
- Fixes an intermittent issue where hovers fail to show

## [9.6.3] - 2019-04-22

### Added

- Adds a `gitlens.hovers.changesDiff` setting to specify whether to show just the changes to the line or the set of related changes in the _changes (diff)_ hover

### Changed

- Improves the maintaining of the line context when opening changes from the hovers
- Improves the accuracy of the _changes (diff)_ hover
- Improves the rendering of the diff in the _changes (diff)_ hover

### Fixed

- Fixes [#697](https://github.com/gitkraken/vscode-gitlens/issues/697) - fixes git error handling for some linux OS'

## [9.6.2] - 2019-04-17

### Fixed

- Fixes [#718](https://github.com/gitkraken/vscode-gitlens/issues/718) - Can't see changed files when comparing branches

## [9.6.1] - 2019-04-17

### Added

- Adds a _Checkout_ command to file nodes in the views to replace the local file with the specified revision &mdash; closes [#684](https://github.com/gitkraken/vscode-gitlens/issues/684)
- Adds a prompt to enable the view to the _Show \* View_ commands when the specified view is disabled &mdash; closes [#710](https://github.com/gitkraken/vscode-gitlens/issues/710) & [#711](https://github.com/gitkraken/vscode-gitlens/issues/711)

### Removed

- Removes `-m` flag from `git log` when following renames (`--follow`), because it returns **all** merge commits, whether the file was changed or not

### Fixed

- Fixes [#701](https://github.com/gitkraken/vscode-gitlens/issues/701) - Contributors shows no commits for mailmapped committer name
- Fixes issues with the _Line History_ view sometimes showing a duplicate and out of order commit
- Fixes broken _Open File_ command on the root node of the _File History_ and _Line History_ views
- Fixes broken _Open Revision_ command on status files of the _Repositories_ view

## [9.6.0] - 2019-04-08

### Added

- Adds a new _Contributors_ node to each repository in the _Repositories_ view
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
- Adds a _Collapse All_ command to the _Repositories_ view &mdash; closes [#688](https://github.com/gitkraken/vscode-gitlens/issues/688)
- Adds version links to the CHANGELOG &mdash; closes [#617](https://github.com/gitkraken/vscode-gitlens/issues/617) thanks to [PR #660](https://github.com/gitkraken/vscode-gitlens/pull/660) by John Gee ([@shadowspawn](https://github.com/shadowspawn))
- Adds a `gitlens.views.pageItemLimit` setting to specify the number of items to show in a each page when paginating a view list. Use 0 to specify no limit

### Changed

- Changes related commit highlighting to only appear on cursor movement after file blame annotations are shown &mdash; to improve performance and reduce initial visual overload
- Changes _Open Revision from..._ (`gitlens.openFileRevisionFrom`) command to allow entering references
- Improves the behavior of the _Show More Commits_ & _Show More Results_ commands &mdash; no longer loses the context of the last selected item before showing more
- Improves the behavior of the _Open Changes with Next Revision_ (`gitlens.diffWithNext`) command when in the diff editor
- Improves the behavior of the _Open Changes with Previous Revision_ (`gitlens.diffWithPrevious`) command when in the diff editor
- Improves the behavior of the _Open Changes with Working File_ (`gitlens.diffWithWorking`) command when in the diff editor
- Renames _Compare HEAD with Branch or Tag..._ (`gitlens.diffHeadWithBranch`) command to _Compare HEAD with..._ (`gitlens.diffHeadWith`)
- Renames _Compare Working Tree with Branch or Tag..._ (`gitlens.diffWorkingWithBranch`) command to _Compare Working Tree with..._ (`gitlens.diffWorkingWith`)
- Renames _Open Changes with Branch or Tag..._ (`gitlens.diffWithBranch`) command to _Open Changes with..._ (`gitlens.diffWithRef`)
- Renames _Open Revision from Branch or Tag..._ (`gitlens.openFileRevisionFromBranch`) command to _Open Revision from..._ (`gitlens.openFileRevisionFrom`)
- Renames _Compare Branch or Tag with..._ (`gitlens.views.compare.selectForCompare`) command to _Compare References..._
- Renames _Choose from Branch or Tag History..._ quick pick item to _Show File History from..._ for better clarity and to reflect that references are now allowed
- Changes to use [Day.js](https://github.com/iamkun/dayjs) instead of [date-fns](https://github.com/date-fns/date-fns) for a reduced bundle size

### Removed

- Removes the automatic suspension of the current line blame annotations while debugging &mdash; closes [#382](https://github.com/gitkraken/vscode-gitlens/issues/382)
- Removes the requirement of prefixing reference comparisons with `#` &mdash; closes [#690](https://github.com/gitkraken/vscode-gitlens/issues/690)

### Fixed

- Fixes [#683](https://github.com/gitkraken/vscode-gitlens/issues/683) - log.showSignature leads to stray files being displayed
- Fixes [#691](https://github.com/gitkraken/vscode-gitlens/issues/691) - Auto-expand tree view on Swap Comparison
- Fixes [#695](https://github.com/gitkraken/vscode-gitlens/issues/695) - Invalid URL in Open File in Remote when selecting origin/.. as comparison branch
- Fixes the behavior of the _Open Line Changes with Previous Revision_ (`gitlens.diffLineWithPrevious`) command to follow the line history much better
- Fixes missing _Compare References..._ (`gitlens.views.compare.selectForCompare`) from the command palette
- Fixes font issues in the _Welcome to GitLens_ and _GitLens Settings_ pages due to changes to the webview CSS font variables provided by VS Code
- Fixes the invite link to the [VS Code Development Community Slack](https://vscode-slack.amod.io)

## [9.5.1] - 2019-02-13

### Added

- Adds better tooltips for file revisions (`gitlen://` uris) — includes the commit id
- Adds an _Open Revision from Branch or Tag..._ (`gitlens.openFileRevisionFromBranch`) command to open the revision of the current file from the selected branch &mdash; closes [#646](https://github.com/gitkraken/vscode-gitlens/issues/646)

### Fixed

- Fixes issues with the welcome page and the interactive settings in the latest vscode insiders build

## [9.5.0] - 2019-02-06

### Added

- Adds a `mailto:` link to the author on the _commit details_ hover &mdash; closes [#642](https://github.com/gitkraken/vscode-gitlens/issues/642)
- Adds support for customizing the layout of the _commit details_ hover
  - Adds a `gitlens.hovers.detailsMarkdownFormat` setting to specify the format (in markdown) of the _commit details_ hover
- Adds the author's e-mail to the tooltip of commits in the views &mdash; closes [#642](https://github.com/gitkraken/vscode-gitlens/issues/642)
- Adds a new author e-mail format token (`${email}`) &mdash; closes [#642](https://github.com/gitkraken/vscode-gitlens/issues/642)
  - Supported in the following settings: `gitlens.blame.format`, `gitlens.currentLine.format`, `gitlens.hovers.detailsMarkdownFormat`, `gitlens.views.commitFormat`, `gitlens.views.commitDescriptionFormat`, `gitlens.views.stashFormat`, `gitlens.views.stashDescriptionFormat`, and `gitlens.statusBar.format`

### Changed

- Changes the sorting of remotes in the _Repositories_ view to sort the default remote first
- Changes relative date formatting of the last fetched date of repositories in the _Repositories_ view to instead use an absolute format and will additionally add the time of day if less than a day has passed
  - This avoids having to periodically refresh the repository (which causes all of its children to re-render) in order to update the relative time

### Fixed

- Fixes [#591](https://github.com/gitkraken/vscode-gitlens/issues/591) - GitLens Error: Unable to open
- Fixes [#620](https://github.com/gitkraken/vscode-gitlens/issues/620) - Wrong URL to open commit on Azure DevOps if cloned via SSH &mdash; thanks to [PR #621](https://github.com/gitkraken/vscode-gitlens/pull/621) by Yan Zhang ([@Eskibear](https://github.com/Eskibear))
- Fixes [#626](https://github.com/gitkraken/vscode-gitlens/issues/626) - Branch names with only digits always appear first &mdash; thanks to [PR #627](https://github.com/gitkraken/vscode-gitlens/pull/627) by Marc Lasson ([@mlasson](https://github.com/mlasson))
- Fixes [#631](https://github.com/gitkraken/vscode-gitlens/issues/631) - Remotes fail to show in gui
- Fixes [#633](https://github.com/gitkraken/vscode-gitlens/issues/633) - Compare File with Previous Revision doesn't work if path contains '#'
- Fixes [#635](https://github.com/gitkraken/vscode-gitlens/issues/635) - Show more commit not working properly
- Fixes an issue where the _Open File_, _Open File on Remote_, and _Copy Remote URL to Clipboard_ commands didn't always work on changed files in the _Repositories_ view
- Fixes an issue where the default remote wasn't used first to provide automatic issue linking

## [9.4.1] - 2019-01-08

### Fixed

- Reverts [#606](https://github.com/gitkraken/vscode-gitlens/issues/606) as it causes views to lose their expansion state

## [9.4.0] - 2019-01-08

### Added

- Adds pinning of comparisons in the _Compare_ view &mdash; pinned comparisons will persist across reloads
- Adds an _Open in Terminal_ command to repositories in the _Repositories_ view

### Changed

- Renames the _Copy Remote File URL to Clipboard_ command (`gitlens.copyRemoteFileUrlToClipboard`) to _Copy Remote URL to Clipboard_ for brevity

### Fixed

- Fixes [#606](https://github.com/gitkraken/vscode-gitlens/issues/606) - ID for xxx is already registered?!
- Fixes [#607](https://github.com/gitkraken/vscode-gitlens/issues/607) - Open file in Remote Doesn't URL encode
- Fixes [#608](https://github.com/gitkraken/vscode-gitlens/issues/608) - Add an option to change the abbreviated commit SHA length &mdash; thanks to [PR #611](https://github.com/gitkraken/vscode-gitlens/pull/611) by Skybbles // L5474 ([@Luxray5474](https://github.com/Luxray5474))
- Fixes [#613](https://github.com/gitkraken/vscode-gitlens/issues/613) - Change Copy Remote URL to Clipboard to always copy a permalink (e.g. revision link)

## [9.3.0] - 2019-01-02

### Added

- Adds favoriting of repositories and branches in the _Repositories_ view to allow for better (user-customized) sorting
- Adds the ability to specify a default remote selection when using the _Open \* in Remote_ commands &mdash; closes [#504](https://github.com/gitkraken/vscode-gitlens/issues/504)
  - Adds _Set as Default_ and _Unset as Default_ commands to remotes in the _Repositories_ view
- Adds the ability to turn on file annotations (blame, heatmap, and recent changes) via user-defined modes &mdash; closes [#542](https://github.com/gitkraken/vscode-gitlens/issues/542)
- Adds the ability to stage and unstage files by folders in the _Repositories_ view &mdash; closes [#599](https://github.com/gitkraken/vscode-gitlens/issues/599) thanks to [PR #600](https://github.com/gitkraken/vscode-gitlens/pull/600) by Tony Brix ([@UziTech](https://github.com/UziTech))
  - Adds _Stage All Changes_ and _Unstage All Changes_ commands to folders in the _Repositories_ view

## [9.2.4] - 2018-12-26

### Added

- Adds a repository indicator in the _Repositories_ view when we are unable to detect repository changes &mdash; related to [#583](https://github.com/gitkraken/vscode-gitlens/issues/583)
- Adds `gitlens.defaultDateShortFormat` setting to specify how short absolute dates will be formatted by default

### Changed

- Changes the fetch date in the _Repositories_ view to respect the date style setting (`gitlens.defaultDateStyle`) and uses the new `gitlens.defaultDateShortFormat` setting for formatting
- Avoids caching when we are unable to detect repository changes &mdash; related to [#583](https://github.com/gitkraken/vscode-gitlens/issues/583)

### Fixed

- Fixes [#605](https://github.com/gitkraken/vscode-gitlens/issues/605) &mdash; Show More Commits not working

## [9.2.3] - 2018-12-21

### Added

- Adds a `gitlens.views.showRelativeDateMarkers` setting to specify whether to show relative date markers (_Less than a week ago_, _Over a week ago_, _Over a month ago_, etc) on revision (commit) histories in the views &mdash; closes [#571](https://github.com/gitkraken/vscode-gitlens/issues/571)

### Changed

- Changes the icon of the _Open Changes with Working File_ command (`gitlens.diffWithWorking`) to align with VS Codes new _Open Changes_ icon
- Splits the `gitlens.views.avatars` setting into `gitlens.views.compare.avatars`, `gitlens.views.repositories.avatars`, and `gitlens.views.search.avatars` settings for more granular control

## [9.2.2] - 2018-12-19

### Changed

- Renames the _Stash Changes_ command (`gitlens.stashSave`) to _Stash All Changes_ and adds a new _Stash Changes_ command (`gitlens.stashSaveFiles`)
- Changes the icon of the _Stash All Changes_ command (`gitlens.stashSave`) &mdash; closes [Microsoft/vscode#64423](https://github.com/Microsoft/vscode/issues/64423)

### Fixed

- Fixes [#598](https://github.com/gitkraken/vscode-gitlens/issues/598) &mdash; Apply changes when comparing a file from two branches is not working

## [9.2.1] - 2018-12-16

### Changed

- Switches to use the new built-in clipboard apis &mdash; closes [#593](https://github.com/gitkraken/vscode-gitlens/issues/593)
- Improves the error messaging when applying a stash, that won't apply cleanly, by including the git output in the message

### Fixed

- Fixes missing icon when using the `alt`-command of the _Toggle File Blame Annotations_ command

## [9.2.0] - 2018-12-13

### Added

- Improves the commit search experience
  - Remembers and restores the last commit search string
  - Adds a _Search Commits_ command to the search results inline toolbar
  - Reopens the commit search when clicking on a search results without results
- Adds a _Collapse_ command to the toolbars of the _Compare_ and _Search Commits_ views &mdash; closes [#383](https://github.com/gitkraken/vscode-gitlens/issues/383)
- Adds support for the [new ability](https://code.visualstudio.com/updates/v1_30#_custom-views) to have descriptions on view nodes &mdash; provides a much cleaner layout
  - Adds a `gitlens.views.commitFileDescriptionFormat` setting to specify the description format of a committed file in the views
  - Adds a `gitlens.views.commitDescriptionFormat` setting to specify the description format of committed changes in the views
  - Adds a `gitlens.views.stashFileDescriptionFormat` setting to specify the description format of a stashed file in the views
  - Adds a `gitlens.views.stashDescriptionFormat` setting to specify the description format of stashed changes in the views
  - Adds a `gitlens.views.statusFileDescriptionFormat` setting to specify the description format of the status of a working or committed file in the views
- Adds a `gitlens.views.repositories.compact` setting to specify whether to show the _Repositories_ view in a compact display density &mdash; closes [#571](https://github.com/gitkraken/vscode-gitlens/issues/571)

### Fixed

- Fixes [#559](https://github.com/gitkraken/vscode-gitlens/issues/559) &mdash; Html encoding issues with the empty state of the _Compare_ and _Search Commits_ views
- Fixes [#574](https://github.com/gitkraken/vscode-gitlens/issues/574) &mdash; Apply Changes not working because of whitespace conflicts
- Fixes [#589](https://github.com/gitkraken/vscode-gitlens/issues/589) &mdash; Bad revision for stash

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
- Adds control over the menu commands contributed to the Source Control side bar to the GitLens Interactive Settings (via the `gitlens.menus` setting)

### Changed

- Changes the _Show Revision Details_ command (`gitlens.showQuickRevisionDetails`) to show file commit details
- Changes the `alt`-command of the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) to be the _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`)
- Changes searching for commits by message to be case-insensitive
- Renames the _Explore the Repository from Here_ command (`gitlens.views.exploreRepoRevision`) to _Explore Repository from Here_
- Reworks the layout of some contributed menu commands

### Fixed

- Fixes an issue where gravatar icons would sometimes not show up &mdash; thanks to [PR #579](https://github.com/gitkraken/vscode-gitlens/pull/579) by Ian Wilkinson ([@sgtwilko](https://github.com/sgtwilko))
- Fixes [#33](https://github.com/gitkraken/vscode-gitlens/issues/33) &mdash; Commit messages can causes markdown formatting in hovers
- Fixes [#501](https://github.com/gitkraken/vscode-gitlens/issues/501) &mdash; Azure DevOps ssh remotes aren't handled properly
- Fixes [#523](https://github.com/gitkraken/vscode-gitlens/issues/523) &mdash; File History doesn't show all commits on file
- Fixes [#552](https://github.com/gitkraken/vscode-gitlens/issues/552) &mdash; "Open Line Changes with..." doesn't work for renamed files
- Fixes [#566](https://github.com/gitkraken/vscode-gitlens/issues/566) &mdash; History error with UNC
- Fixes [#572](https://github.com/gitkraken/vscode-gitlens/issues/572) &mdash; Explorer can't expand some branch folders
- Fixes [#584](https://github.com/gitkraken/vscode-gitlens/issues/584) &mdash; Unexpected results when opening diff from file history
- Fixes [#588](https://github.com/gitkraken/vscode-gitlens/issues/588) &mdash; Output channel doesn't exist with `gitlens.outputLevel` default
- Fixes an issue where comparing a file with its staged revision doesn't show any content
- Fixes an issue where the workspace folder added by the _Explore Repository from Here_ command (`gitlens.views.exploreRepoRevision`) would fail to load in certain cases
- Fixes an issue where applying changes of an added file or an untracked file (in a stash) would fail

## [9.0.3] - 2018-12-06

### Fixed

- Fixes [#576](https://github.com/gitkraken/vscode-gitlens/issues/576) &mdash; Fails to load with older versions of git
- Fixes an issue where the _Copy Commit Message to Clipboard_ command fails (and probably others too) &mdash; a regression caused by the attempted fix for [#568](https://github.com/gitkraken/vscode-gitlens/issues/565)

## [9.0.2] - 2018-12-05

### Added

- Adds a _Directory Compare All Changes_ (`gitlens.diffDirectoryWithHead`) command to open the configured git difftool to compare the working directory with HEAD &mdash; closes [#569](https://github.com/gitkraken/vscode-gitlens/issues/569)

### Changed

- Renames _Open Changes (with difftool)_ command to _Open All Changes (with difftool)_ when shown on the SCM group context menu

### Fixed

- Fixes [#565](https://github.com/gitkraken/vscode-gitlens/issues/565) &mdash; Regression: Submodules don't work properly (missing repo in view, file and inline blame, etc)
- Fixes [#528](https://github.com/gitkraken/vscode-gitlens/issues/528) &mdash; Remotes not showing, being filtered on domain and file, but not complete path
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
- Adds a new Git virtual file system provider for the `gitlens:` scheme &mdash; closes [#430](https://github.com/gitkraken/vscode-gitlens/issues/430)
  - Replaces GitLens' internal handling of file revisions, which allows for better performance, as well as avoiding the use of temp files. It also provides a much better experience when dealing with file encodings, images, etc.
- Adds an _Explore the Repository from Here_ (`gitlens.views.exploreRepoRevision`) command which opens a virtual workspace folder (uses the new Git virtual file system provider) for the repository at the specified point in time (commit, branch, tag, etc) &mdash; closes [#398](https://github.com/gitkraken/vscode-gitlens/issues/398)
- Adds a new [_Repositories_ view](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#repositories-view- 'Jump to the Repositories view docs'), formerly the _GitLens_ view, to visualize, navigate, and explore Git repositories &mdash; closes [#456](https://github.com/gitkraken/vscode-gitlens/issues/456), [#470](https://github.com/gitkraken/vscode-gitlens/issues/470), [#494](https://github.com/gitkraken/vscode-gitlens/issues/494)
  <br/>[![Repositories view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/images/docs/view-repositories.png)](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#repositories-view- 'Jump to the Repositories view docs')
  - Provides a cleaner information-rich view of your opened repositories, more git commands (fetch, push, pull, checkout, stage, unstage, etc), better visibility and accessibility of existing features, and [more](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#repositories-view- 'Jump to the Repositories view docs')
  - Adds a `gitlens.views.repositories.autoReveal` setting to specify whether to automatically reveal repositories in the _Repositories_ view when opening files
- Adds a new [_File History_ view](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#file-history-view- 'Jump to the File History view docs'), formerly the _History_ view, to visualize, navigate, and explore the revision history of the current file
  <br/>[![File History view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/images/docs/view-file-history.png)](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#file-history-view- 'Jump to the File History view docs')
  - Provides similar features to the former _History_ view as well as quickly toggling file tracking on and off, changing the base (branch, tag, commit, etc) of the file's history, and [more](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#file-history-view- 'Jump to the File History view docs')
- Adds an all-new [_Line History_ view](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#line-history-view- 'Jump to the Line History view docs') to visualize, navigate, and explore the revision history of the selected lines of current file &mdash; closes [#354](https://github.com/gitkraken/vscode-gitlens/issues/354)
  <br/>[![Line History view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/images/docs/view-line-history.png)](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#line-history-view- 'Jump to the Line History view docs')
  - Provides similar features to the _File History_ view including quickly toggling line tracking on and off, changing the base (branch, tag, commit, etc) of the selected lines' history, and [more](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#line-history-view- 'Jump to the Line History view docs')
- Adds an all-new [_Search Commits_ view](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#search-commits-view- 'Jump to the Search Commits view docs') to search and explore commit histories by message, author, files, id, etc &mdash; closes [#455](https://github.com/gitkraken/vscode-gitlens/issues/455)
  <br/>[![Search Commits view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/images/docs/view-search.png)](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#search-commits-view- 'Jump to the Search Commits view docs')
  - Provides somewhat similar features to the former _Results_ view as well as it is now a persistent view, makes it easier to start a commit search, and [more](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#search-commits-view- 'Jump to the Search Commits view docs')
- Adds an all-new [_Compare_ view](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#compare-view- 'Jump to the Compare view docs') to visualize comparisons between branches, tags, commits, and more
  <br/>[![Compare view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/images/docs/view-compare.png)](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#compare-view- 'Jump to the Compare view docs')
  - Provides somewhat similar and powerful features to the former _Results_ view as well as it is now a persistent view, makes it easier to start a comparison, and [more](https://github.com/gitkraken/vscode-gitlens/tree/98e225f39a8ebfb5c5bdd3018bc47b35a7e63a6c/#compare-view- 'Jump to the Compare view docs')
- Reduces the overhead of all GitLens views &mdash; GitLens now only tracks changes and updates the views if they are visible, collapsed or hidden views should have almost zero overhead
- Adds relative date markers (_Less than a week ago_, _Over a week ago_, _Over a month ago_, etc) to revision (commit) histories in GitLens views
- Adds branch and tag tip markers to revision (commit) histories in GitLens views &mdash; closes [#560](https://github.com/gitkraken/vscode-gitlens/issues/560)
- Adds a changes indicator (+x ~x -x) to commits in GitLens views (uses the new `${changes}` token in the `gitlens.views.commitFormat` setting) &mdash; closes [#493](https://github.com/gitkraken/vscode-gitlens/issues/493)
- Adds the _Show Commit in View_ command to commits in GitLens views to quickly open the commit in the _Search Commits_ view &mdash; closes [#502](https://github.com/gitkraken/vscode-gitlens/issues/502)
- Adds the _Open Changes (with difftool)_ command to files in GitLens views &mdash; closes [#389](https://github.com/gitkraken/vscode-gitlens/issues/389)
- Adds an _Expand_ command to some GitLens view nodes to expand them &mdash; closes [#275](https://github.com/gitkraken/vscode-gitlens/issues/275)
- Adds a _Fetch Repositories_ (`gitlens.fetchRepositories`) command to fetch **all** of the open repositories
- Adds a _Pull Repositories_ (`gitlens.pullRepositories`) command to pull **all** of the open repositories
- Adds a _Push Repositories_ (`gitlens.pushRepositories`) command to push **all** of the open repositories (be careful with this one)
- Adds a _Show Line History View_ (`gitlens.showLineHistoryView`) command to open the _Line History_ view
- Adds a _Show Commit in View_ (`gitlens.showCommitInView`) command to open a commit in the _Search Commits_ view
- Adds a _Show File History in View_ (`gitlens.showFileHistoryInView`) command to open a file's revision (commit) history in the _File History_ view
- Adds a _Show Commit in View_ (`gitlens.showCommitInView`) command to quickly open the current line's commit in the _Search Commits_ view
- Adds a _Show Revision Details_ (`gitlens.showQuickRevisionDetails`) command to quickly show the revision (commit) details of the current file revision
- Adds the _Open Changes with Working File_ (`gitlens.diffWithWorking`) command to the editor toolbar when comparing revisions
- Adds comparisons to commit ids, by prefixing with a `#`, in addition to branches and tags &mdash; closes [#535](https://github.com/gitkraken/vscode-gitlens/issues/535)
- Adds support for git mailmap &mdash; closes [#388](https://github.com/gitkraken/vscode-gitlens/issues/388)
- Adds support for Azure DevOps (formerly VSTS) remotes &mdash; closes [#501](https://github.com/gitkraken/vscode-gitlens/issues/501)
- Adds better detection of on-prem BitBucket and GitLab remotes &mdash; closes [#214](https://github.com/gitkraken/vscode-gitlens/issues/214)
- Adds some missing gitmojis &mdash; thanks to [PR #510](https://github.com/gitkraken/vscode-gitlens/pull/510) by Loris Bettazza ([@Pustur](https://github.com/Pustur))
- Adds a `gitlens.codeLens.includeSingleLineSymbols` setting to specify whether to provide any Git CodeLens on symbols that span only a single line
- Adds smooth scrolling to the interactive settings editor when using the _Jump To_ links

### Changed

- Changes the sorting of branch, tags, and files in GitLens views to be a natural sort &mdash; closes [#547](https://github.com/gitkraken/vscode-gitlens/issues/547)
- Changes the _Apply Changes_ command to truly apply only the patch of the specified change &mdash; closes [#539](https://github.com/gitkraken/vscode-gitlens/issues/539)
- Changes Azure Pipelines documents to use document scope only by default &mdash; thanks to [PR #548](https://github.com/gitkraken/vscode-gitlens/pull/548) by Matt Cooper ([@vtbassmatt](https://github.com/vtbassmatt))
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

- Fixes [#405](https://github.com/gitkraken/vscode-gitlens/issues/405) - Secondary, blank repository appears repeatedly in _Repositories_ view
- Fixes [#430](https://github.com/gitkraken/vscode-gitlens/issues/430) - File revisions can end up being parsed by language servers (causing errors and warnings, etc)
- Fixes [#496](https://github.com/gitkraken/vscode-gitlens/issues/496) - Short hash length doesn't match git's default length
- Fixes [#503](https://github.com/gitkraken/vscode-gitlens/issues/503) - Open Changes (with difftool) opens one difftool window per changed file
- Fixes [#507](https://github.com/gitkraken/vscode-gitlens/issues/507) - Restrict commit message size
- Fixes [#527](https://github.com/gitkraken/vscode-gitlens/issues/527) - GitLens icon flashes on startup
- Fixes [#533](https://github.com/gitkraken/vscode-gitlens/issues/533) - Some descriptions not using markdown properly in Settings GUI
- Fixes [#544](https://github.com/gitkraken/vscode-gitlens/issues/544) - Some commit messages have one letter missing
- Fixes CHANGELOG issue &mdash; thanks to [PR #558](https://github.com/gitkraken/vscode-gitlens/pull/558) by Ash Clarke ([@ashclarke](https://github.com/ashclarke))

### Removed

- Removes `gitlens.advanced.git` setting as it is no longer needed

## [8.5.6] - 2018-08-21

### Fixed

- Fixes [#477](https://github.com/gitkraken/vscode-gitlens/issues/477) - Can't load any GitLens features or UI
- Fixes [#482](https://github.com/gitkraken/vscode-gitlens/issues/482) - UI displays "undefined" in results panel when comparing

## [8.5.5] - 2018-08-18

### Added

- Adds _Copy Remote File URL to Clipboard_ (`gitlens.copyRemoteFileUrlToClipboard`) command &mdash; copies the remote url of the current file and line to the clipboard &mdash; closes [#467](https://github.com/gitkraken/vscode-gitlens/issues/467)

### Fixed

- Fixes [#471](https://github.com/gitkraken/vscode-gitlens/issues/471) - Don't use Ctrl+Alt+[character] as a shortcut
- Fixes [#478](https://github.com/gitkraken/vscode-gitlens/issues/478) - `suppressShowKeyBindingsNotice` gets saved even when it is not required
- Fixes [#468](https://github.com/gitkraken/vscode-gitlens/issues/468) - Commit history for detached HEAD doesn't work properly

## [8.5.4] - 2018-07-31

### Added

- Adds _Checkout Commit (via Terminal)_ command (`gitlens.terminalCheckoutCommit`) to commit node(s) of the _GitLens_ explorer &mdash; closes [#463](https://github.com/gitkraken/vscode-gitlens/issues/463)

### Changed

- Improves performance of providing blame annotations, especially for large files (a ~33% improvement on some files)
- Changes commit search by sha to jump directly to the commit (if one is found), rather than having to click through to the commit
- Updates settings descriptions to better support the new settings editor in vscode
- Changes _Rebase to Commit (via Terminal)_ command (`gitlens.terminalRebaseCommit`) to apply to all commit node(s) of the _GitLens_ explorer
- Changes _Reset to Commit (via Terminal)_ command (`gitlens.terminalResetCommit`) to apply to all commit node(s) of the _GitLens_ explorer

### Fixed

- Fixes [#462](https://github.com/gitkraken/vscode-gitlens/issues/462) - Source Control shortcut on macOS (⌃⇧G) shouldn't be overridden
- Fixes [#457](https://github.com/gitkraken/vscode-gitlens/issues/457) - Displays the wrong username (You) &mdash; thanks to [PR #460](https://github.com/gitkraken/vscode-gitlens/pull/460) by Zyck ([@qzyse2017](https://github.com/qzyse2017))
- Fixes [#459](https://github.com/gitkraken/vscode-gitlens/issues/459) - File blame annotation text overflow with letter spacing setting
- Fixes issues with GitLens Welcome and the interactive settings editor with light themes

## [8.5.3] - 2018-07-25

### Fixed

- Fixes [#454](https://github.com/gitkraken/vscode-gitlens/issues/454) - Search for string returns merge commits (unlike raw `git log -S`)
- Fixes issue showing changes with untracked stashed files
- Fixes issue showing changes with working file when the file has been renamed

## [8.5.2] - 2018-07-20

### Fixed

- Fixes [#451](https://github.com/gitkraken/vscode-gitlens/issues/451) - "apply Changes" has discarded all my changes
- Fixes [#449](https://github.com/gitkraken/vscode-gitlens/issues/449) - Stop hiding explorers by default when in Zen mode

## [8.5.1] - 2018-07-18

### Added

- Adds emoji support, e.g. `:smile:` in commit messages will now be 😃 &mdash; closes [#429](https://github.com/gitkraken/vscode-gitlens/issues/429)
- Adds _Compare with Selected_ and _Select for Compare_ commands to file nodes in the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers &mdash; closes [#446](https://github.com/gitkraken/vscode-gitlens/issues/446)
- Adds `gitlens.historyExplorer.avatars` setting to specify whether to show avatar images instead of status icons in the `GitLens File History` explorer &mdash; allows for an independent value from the other explorers

### Fixed

- Fixes [#444](https://github.com/gitkraken/vscode-gitlens/issues/444) - GitLens custom viewlet icon slightly larger than standard
- Fixes [#437](https://github.com/gitkraken/vscode-gitlens/issues/437) - Remove `--first-parent` from git commands to show file history from merged in repositories
- Fixes [#252](https://github.com/gitkraken/vscode-gitlens/issues/252) - Cannot read property 'push' of undefined
- Fixes issue where GitLens saves a couple settings with default values into user settings (rather than just removing the setting)

## [8.5.0] - 2018-07-16

### Added

- Adds an all-new _GitLens_ sidebar view to contain the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers
- The new view is enabled by default, but can easily be configured back to the existing locations via the _GitLens_ interactive settings editor
- Adds tag annotations to the tag tooltips in the _GitLens_ explorer &mdash; closes [#431](https://github.com/gitkraken/vscode-gitlens/issues/431)
- Adds a `gitlens.hovers.avatars` setting to specify whether to show avatar images in hovers &mdash; closes [#432](https://github.com/gitkraken/vscode-gitlens/issues/432) thanks to [PR #441](https://github.com/gitkraken/vscode-gitlens/pull/441) by Segev Finer ([@segevfiner](https://github.com/segevfiner))
- Adds the `gitlens.hovers.avatars` setting to the _GitLens_ interactive settings editor to specify whether to show avatar images in hovers
- Adds _Choose from Branch or Tag History..._ command to the quick pick menu shown by the _Show File History..._ command (`gitlens.showQuickFileHistory`) &mdash; closes [#316](https://github.com/gitkraken/vscode-gitlens/issues/316)
- Adds the _Compare File with Revision..._ command (`gitlens.diffWithRevision`) as an alternate (`alt+click`) for the _Compare File with Previous Revision_ command in the editor toolbar

### Changed

- Renames the _GitLens History_ explorer to _GitLens File History_ explorer for better clarity
- Changes the _GitLens File History_ explorer to always show the full file history even when reviewing revisions
- Changes the behavior of and renames the _Show Branches and Tags_ command and on the quick pick menu shown by the _Compare File with Revision..._ command (`gitlens.diffWithRevision`) to _Choose from Branch or Tag History..._
- Changes the behavior of and renames the _Show Branches and Tags_ command on the quick pick menu shown by the _Open Revision..._ command (`gitlens.openFileRevision`) to _Choose from Branch or Tag History..._

### Removed

- Removes `gitlens:activeIsTracked`, `gitlens:activeIsBlameable`, `gitlens:activeIsRevision`, and `gitlens:activeHasRemotes` contexts and consolidates them into `gitlens:activeFileStatus` for better performance and UX

### Fixed

- Fixes [#436](https://github.com/gitkraken/vscode-gitlens/issues/436) - Copy to clipboard not working
- Fixes [#442](https://github.com/gitkraken/vscode-gitlens/issues/442) - GitLens File History fails if name (or path) starts with `-`
- Fixes [#440](https://github.com/gitkraken/vscode-gitlens/issues/440) - Searching for commits with an empty query yields to no results anymore
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
  ![cold heatmap](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-heatmap-cold.png)
  - The indicator's color, now customizable, will either be hot or cold based on the age of the most recent change (cold after 90 days by default) &mdash; closes [#419](https://github.com/gitkraken/vscode-gitlens/issues/419)
  - The indicator's brightness ranges from bright (newer) to dim (older) based on the relative age, which is calculated from the median age of all the changes in the file
  - Adds `gitlens.heatmap.ageThreshold` setting to specify the age of the most recent change (in days) after which the gutter heatmap annotations will be cold rather than hot (i.e. will use `gitlens.heatmap.coldColor` instead of `gitlens.heatmap.hotColor`)
  - Adds `gitlens.heatmap.coldColor` setting to specify the base color of the gutter heatmap annotations when the most recent change is older (cold) than the `gitlens.heatmap.ageThreshold` setting
  - Adds `gitlens.heatmap.hotColor` setting to specify the base color of the gutter heatmap annotations when the most recent change is newer (hot) than the `gitlens.heatmap.ageThreshold` setting
- Adds new branch history node under the _Repository Status_ node in the _GitLens_ explorer
- Adds GitLab and Visual Studio Team Services icons to the remote nodes in the _GitLens_ explorer &mdash; thanks to [PR #421](https://github.com/gitkraken/vscode-gitlens/pull/421) by Maxim Pekurin ([@pmaxim25](https://github.com/pmaxim25))

### Fixed

- Fixes [#400](https://github.com/gitkraken/vscode-gitlens/issues/412) - GitLens logging to debug console when debugging different extension
- Fixes [#409](https://github.com/gitkraken/vscode-gitlens/issues/409) - Literal \$(ellipsis) inserted into commit quick pick menu entry placeholder text
- Fixes [#415](https://github.com/gitkraken/vscode-gitlens/issues/415) - Branch names get mangled by color escapes &mdash; thanks to [PR #416](https://github.com/gitkraken/vscode-gitlens/pull/416) by Roy Ivy III ([@rivy](https://github.com/rivy))

## [8.3.5] - 2018-06-08

### Fixed

- Fixes more instances of [#295](https://github.com/gitkraken/vscode-gitlens/issues/295)and [#318](https://github.com/gitkraken/vscode-gitlens/issues/318) - Any error encountered during the search for repositories could cause GitLens to die

## [8.3.4] - 2018-06-06

### Added

- Adds clipboard support for Linux without requiring any external dependencies &mdash; thanks to [PR #394](https://github.com/gitkraken/vscode-gitlens/pull/394) by Cédric Malard ([@cmalard](https://github.com/cmalard))
- Adds a select branch quick pick menu to the _Open File in Remote_ command (`gitlens.openFileInRemote`) when the current branch has no upstream tracking branch &mdash; closes [#209](https://github.com/gitkraken/vscode-gitlens/issues/209)

### Changed

- Moves the _Open Working File_ command (`gitlens.openWorkingFile`) to the right of the _Compare File with \* Revision_ commands in the editor toolbar

### Fixed

- Fixes [#400](https://github.com/gitkraken/vscode-gitlens/issues/400) - Reset TO commit also resets chosen one
- Fixes [#399](https://github.com/gitkraken/vscode-gitlens/issues/399) - "Open x in Remote" commands aren't always available
- Fixes [#397](https://github.com/gitkraken/vscode-gitlens/issues/397) - Error while opening the gitlens view using `Open View` command
- Fixes [#391](https://github.com/gitkraken/vscode-gitlens/issues/391) - GitLens adds some settings in settings.json
- Fixes another case of [#343](https://github.com/gitkraken/vscode-gitlens/issues/343) - Can't show blame when VSCode starts on branch without upstream &mdash; thanks to [PR #390](https://github.com/gitkraken/vscode-gitlens/pull/390) by ryenus ([@ryenus](https://github.com/ryenus))
- Fixes [#392](https://github.com/gitkraken/vscode-gitlens/issues/392) - unable to contribute if default script shell is sh &mdash; thanks to [PR #393](https://github.com/gitkraken/vscode-gitlens/pull/393) by Cédric Malard ([@cmalard](https://github.com/cmalard))
- Fixes issue with the `chorded` keyboard shortcut for the _Compare File with Previous Revision_ command (`gitlens.diffWithPreviousInDiff`) &mdash; from [#395](https://github.com/gitkraken/vscode-gitlens/issues/395)
- Fixes the _Open Working File_ command (`gitlens.openWorkingFile`) not always showing in the editor toolbar when appropriate

## [8.3.3] - 2018-05-31

### Added

- Adds (re-adds) support for handling single files &mdash; closes [#321](https://github.com/gitkraken/vscode-gitlens/issues/321)
- Adds _Close Repository_ (`gitlens.explorers.closeRepository`) command to repository and repository status nodes in the _GitLens_ explorer &mdash; closes (hides) the repository in the _GitLens_ explorer

### Fixed

- Fixes [#362](https://github.com/gitkraken/vscode-gitlens/issues/362) - Too many CodeLenses in postcss files
- Fixes [#381](https://github.com/gitkraken/vscode-gitlens/issues/381) - Can't stash single files with older versions of Git
- Fixes [#384](https://github.com/gitkraken/vscode-gitlens/issues/384) - Absolute dates not always honored in _GitLens Results_ explorer
- Fixes [#385](https://github.com/gitkraken/vscode-gitlens/issues/385) - Wrong git command to delete remote branch

## [8.3.2] - 2018-05-21

### Fixed

- Fixes [#366](https://github.com/gitkraken/vscode-gitlens/issues/366) - Running a GitLens command from a keybinding fails (more cases)
- Fixes many issues where commands wouldn't work if the active file wasn't part of an open repository &mdash; now GitLens will try to find the best repository otherwise it will open a repository quick pick menu if there is more than one

## [8.3.1] - 2018-05-18

### Added

- Adds the ability to control where the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers are shown 🎉 &mdash; closes [#213](https://github.com/gitkraken/vscode-gitlens/issues/213), [#377](https://github.com/gitkraken/vscode-gitlens/issues/377)
  - Adds `gitlens.gitExplorer.location` setting to the interactive settings editor to specify where the _GitLens_ explorer is shown &mdash; either in the _Explorer_ or _Source Control_ view
  - Adds `gitlens.historyExplorer.location` setting to the interactive settings editor to specify where the _GitLens File History_ explorer is shown &mdash; either in the _Explorer_ or _Source Control_ view
  - Adds `gitlens.resultsView.location` setting to the interactive settings editor to specify where the _GitLens Results_ explorer is shown &mdash; either in the _Explorer_ or _Source Control_ view

### Changed

- Renames _GitLens Results_ view to _GitLens Results_ explorer for consistency

### Fixed

- Fixes [#372](https://github.com/gitkraken/vscode-gitlens/issues/372) - Wrong URL to VSTS work item when using hash work item id in commit

## [8.3.0] - 2018-05-17

### Added

- Adds user-defined modes for quickly toggling between sets of settings

  ![mode switch](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-mode-switch.png)

  - Adds _Switch Mode_ command (`gitlens.switchMode`) to quickly switch the active GitLens mode
  - Adds a built-in _Zen_ mode which for a zen-like experience, disables many visual features
    - Adds _Toggle Zen Mode_ command (`gitlens.toggleZenMode`) to toggle Zen mode
  - Adds a built-in _Review_ mode which for reviewing code, enables many visual features
    - Adds _Toggle Review Mode_ command (`gitlens.toggleReviewMode`) to toggle Review mode
  - Adds the active mode to the status bar, optional (on by default)
    - Adds `gitlens.mode.statusBar.enabled` setting to specify whether to provide the active GitLens mode in the status bar
    - Adds `gitlens.mode.statusBar.alignment` setting to specify the active GitLens mode alignment in the status bar
  - Adds modes settings (`gitlens.mode.*`) to the interactive settings editor

    ![modes settings](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-modes-settings.png)

  - Adds `gitlens.mode.active` setting to specify the active GitLens mode, if any
  - Adds `gitlens.modes` setting to specify the user-defined GitLens modes

- Adds an icon for the _Compare File with Previous Revision_ command (`gitlens.diffWithPrevious`) and moves it into the editor toolbar
- Adds an icon for the _Compare File with Next Revision_ command (`gitlens.diffWithNext`) and moves it into the editor toolbar
- Adds menu settings (`gitlens.menus.*`) to the interactive settings editor

  ![menu settings](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-menu-settings.png)

- Adds a display mode dropdown at the top of the interactive settings editor to reduce complexity

  ![settings mode](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-settings-mode.png)

  - Adds `gitlens.settings.mode` setting to specify the display mode of the interactive settings editor

- Adds a tree layout option to tags in the _GitLens_ explorer &mdash; closes [#358](https://github.com/gitkraken/vscode-gitlens/issues/358)
- Adds _Show GitLens Explorer_ (`gitlens.showGitExplorer`) command &mdash; shows/expands the _GitLens_ explorer
- Adds _Show File History Explorer_ (`gitlens.showHistoryExplorer`) command &mdash; shows/expands the _GitLens File History_ explorer
- Adds _Show Results Explorer_ (`gitlens.showResultsView`) command &mdash; shows/expands the _GitLens Results_ explorer

### Changed

- Moves the _GitLens_, _GitLens File History_, and _GitLens Results_ explorers under the Source Control activity (in the sidebar) 🎉 &mdash; closes [#213](https://github.com/gitkraken/vscode-gitlens/issues/213)
- Showing results in the _GitLens Results_ explorer now properly shows the explorer first
- Renames _Compare Line Revision with Previous_ command (`gitlens.diffLineWithPrevious`) to _Compare Commit with Previous_ for consistency with other commands
- Renames _Compare Line Revision with Working File_ command (`gitlens.diffLineWithWorking`) to _Compare Commit with Working File_ for consistency with other commands
- Renames _Show Commit File Details_ command (`gitlens.showQuickCommitFileDetails`) to _Show Commit Details_ for consistency with other commands
- Reworks GitLens menu contributions and configuration &mdash; see menu settings above
  - Renames the `gitlens.advanced.menus` setting to `gitlens.menus`
- Uses the new Webview API for better interactions and behavior with the interactive settings editor and welcome page

### Fixed

- Fixes [#366](https://github.com/gitkraken/vscode-gitlens/issues/366) - Running a GitLens command from a keybinding fails
- Fixes [#155](https://github.com/gitkraken/vscode-gitlens/issues/155) - Navigating file diffs with `alt+,` gets stuck
- Fixes [#359](https://github.com/gitkraken/vscode-gitlens/issues/359) - Show changes of an added file in the first commit
- Fixes _bronze_ typo thanks to [PR #361](https://github.com/gitkraken/vscode-gitlens/pull/361) by Cory Forsyth ([@bantic](https://github.com/bantic))
- Fixes _individually_ typo thanks to [PR #364](https://github.com/gitkraken/vscode-gitlens/pull/364) by Brett Cannon ([@brettcannon](https://github.com/brettcannon))
- Fixes issue where comparing previous revision during a merge/rebase conflict failed to show the correct contents
- Fixes issue with the current line blame toggle not working when current line blame starts disabled
- Fixes various issues when not on a branch

## [8.2.4] - 2018-04-22

### Added

- Adds a visible error message for when Git is disabled (`"git.enabled": false`) &mdash; for [#318](https://github.com/gitkraken/vscode-gitlens/issues/318)

## [8.2.3] - 2018-04-21

### Fixed

- Fixes [#313](https://github.com/gitkraken/vscode-gitlens/issues/313) - Unable to show branch history for branch that matches file or folder name
- Fixes [#348](https://github.com/gitkraken/vscode-gitlens/issues/348) - "Open in remote" commands disappeared from command palette
- Fixes JSON schema of the `gitlens.advanced.blame.customArguments` setting

## [8.2.2] - 2018-04-19

### Added

- Adds an indicator to the _GitLens_ explorer's branch history to mark the tips of all branches
- Adds `gitlens.advanced.blame.customArguments` setting to specify additional arguments to pass to the `git blame` command &mdash; closes [#337](https://github.com/gitkraken/vscode-gitlens/issues/337)

### Changed

- Changes the author name to "You" when appropriate &mdash; closes [#341](https://github.com/gitkraken/vscode-gitlens/issues/341)

### Fixed

- Fixes [#345](https://github.com/gitkraken/vscode-gitlens/issues/345) - Custom date formats don't work in the GitLens view
- Fixes [#336](https://github.com/gitkraken/vscode-gitlens/issues/336) - Default Settings Get Added Automatically
- Fixes [#342](https://github.com/gitkraken/vscode-gitlens/issues/342) - GitLens crashes while debugging with Chrome Debugger a larger project
- Fixes [#343](https://github.com/gitkraken/vscode-gitlens/issues/343) - Can't show blame when VSCode starts on branch without upstream
- Fixes issue where username and/or password in a remote urls could be shown

## [8.2.1] - 2018-04-11

### Added

- Adds better logging for failed git commands

### Changed

- Marks temporary files (used when showing comparisons with previous revisions) as read-only to help avoid accidental edits/saving

### Fixed

- Fixes [#320](https://github.com/gitkraken/vscode-gitlens/issues/320) - Stashes with a single untracked file created with "stash push" aren't shown in the GitLens explorer
- Fixes [#331](https://github.com/gitkraken/vscode-gitlens/issues/331) - CodeLens shows on every import in Python
- Fixes issues where quick pick menu progress indicators will get stuck in some cases because of a vscode api change in [Microsoft/vscode#46102](https://github.com/Microsoft/vscode/pull/46102)

## [8.2.0] - 2018-03-31

### Added

- Adds new stand-alone _GitLens File History_ explorer to visualize the history of the current file &mdash; undocked version of the _GitLens_ explorer history view

  ![GitLens File History explorer](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-gitlens-history-explorer.png)

- Adds richer tooltips to the _GitLens_ and _GitLens Results_ explorers, and richer working tree and upstream status to the _GitLens_ explorer

  ![Rich tooltips](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-rich-tooltips.png)

- Adds an indicator to the _GitLens_ explorer's branch history to mark the synchronization point between the local and remote branch (if available)

  ![Branch upstream indicator](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-branch-upstream-indicator.png)

- Adds ability to easily switch between relative and absolute dates via the `gitlens.defaultDateStyle` settings &mdash; closes [#312](https://github.com/gitkraken/vscode-gitlens/issues/312)

  - Adds `${agoOrDate}` and `${authorAgoOrDate}` tokens to `gitlens.blame.format`, `gitlens.currentLine.format`, `gitlens.explorers.commitFormat`, `gitlens.explorers.stashFormat`, and `gitlens.statusBar.format` settings which will honor the `gitlens.defaultDateStyle` setting

  ![General settings](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-general-settings.png)

- Adds annotation format settings (`gitlens.*.format`) to the interactive settings editor

  ![Annotation format settings](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-annotation-format.png)

- Adds new `gitlens.currentLine.scrollable` setting to specify whether the current line blame annotation can be scrolled into view when it is outside the viewport &mdash; closes [#149](https://github.com/gitkraken/vscode-gitlens/issues/149), [#290](https://github.com/gitkraken/vscode-gitlens/issues/290), [#265](https://github.com/gitkraken/vscode-gitlens/issues/265)

  ![Allow scrolling to annotation setting](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-current-line-scrollable.png)

- Adds `gitlens.statusBar.reduceFlicker` setting to the interactive settings editor

  ![Reduce status bar flashing setting](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-status-bar-reduce-flashing.png)

- Adds a one-time notification on startup if the `alt-based` keyboard shortcuts are in use, with options to easily switch to another set
- Adds _Copy Commit ID to Clipboard_ (`gitlens.copyShaToClipboard`) command to changed file nodes in the _GitLens_ explorer and _GitLens Results_ explorer
- Adds _Copy Commit Message to Clipboard_ (`gitlens.copyMessageToClipboard`) command to changed file nodes in the _GitLens_ explorer and _GitLens Results_ explorer

### Changed

- Moves _Keyboard Settings_ to the _General_ section of the interactive settings editor
- Renames _Compare with Index (HEAD)_ (`gitlens.explorers.compareWithHead`) command to _Compare with HEAD_ &mdash; closes [#309](https://github.com/gitkraken/vscode-gitlens/issues/309)
- Renames _Compare Index (HEAD) with Branch or Tag..._ (`gitlens.diffHeadWithBranch`) command to _Compare HEAD with Branch or Tag..._ &mdash; closes [#309](https://github.com/gitkraken/vscode-gitlens/issues/309)

### Removed

- Removes the unnecessary _Show File Blame Annotations_ (`gitlens.showFileBlame`) command &mdash; _Toggle File Blame Annotations_ (`gitlens.toggleFileBlame`) provides similar functionality
- Removes the unnecessary _Show Line Blame Annotations_ (`gitlens.showLineBlame`) command &mdash; _Toggle Line Blame Annotations_ (`gitlens.toggleLineBlame`) provides similar functionality
- Removes _Open Working File_ (`gitlens.openWorkingFile`) command from the editor toolbar when the built-in _Open File_ command is visible
- Removes _Compare with HEAD_ (`gitlens.explorers.compareWithHead`), _Compare with Working Tree_ (`gitlens.explorers.compareWithWorking`), and _Compare Compare Ancestry with Working Tree_ (`gitlens.explorers.compareAncestryWithWorking`) commands from the current branch since comparing a branch with itself doesn't make sense &mdash; closes [#309](https://github.com/gitkraken/vscode-gitlens/issues/309)

### Fixed

- Fixes [#314](https://github.com/gitkraken/vscode-gitlens/issues/314) - Toggle line annotation doesn't work properly
- Fixes [#310](https://github.com/gitkraken/vscode-gitlens/issues/310) - "via Terminal" commands need quoting around work directory
- Fixes issues with the active repository in the _GitLens_ explorer failed to update properly
- Fixes issues with _Open File_, _Open Revision_, and _Show File History_ commands and images and other binary files
- Fixes issues preventing nodes in the _GitLens_ explorer from expanding properly in certain cases
- Fixes issues when refreshing nodes in the _GitLens Results_ explorer

## [8.1.1] - 2018-03-12

### Fixed

- Fixes [#276](https://github.com/gitkraken/vscode-gitlens/issues/276) - Lookup for branches without upstreams fails
- Fixes the schema of the `gitlens.codeLens.scopesByLanguage` setting

## [8.1.0] - 2018-03-07

### Added

- Adds automatic issue linking to Bitbucket, GitHub, GitLab, and Visual Studio Team Services for commit messages in hovers

  ![Issue linking in commit messages](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-issue-linking.png)

- Adds support to toggle annotations for each file individually or for all files at once &mdash; closes [#289](https://github.com/gitkraken/vscode-gitlens/issues/289)

  ![Annotations toggle setting](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-annotations-toggle.png)

  - Adds new controls the interactive settings editor (_Open Settings_ from the Command Palette) to configure this new behavior
  - Adds `gitlens.blame.toggleMode` setting to specify how the gutter blame annotations will be toggled, per file or window
  - Adds `gitlens.heatmap.toggleMode` setting to specify how the gutter heatmap annotations will be toggled, per file or window
  - Adds `gitlens.recentChanges.toggleMode` setting to specify how the recently changed lines annotations will be toggled, per file or window

- Adds icons to remotes in the _GitLens_ explorer based on the remote service provider
- Adds multi-cursor support to current line annotations &mdash; closes [#291](https://github.com/gitkraken/vscode-gitlens/issues/291)

### Changed

- Renames _Compare Selected Ancestor with Working Tree_ command to _Compare Ancestry with Working Tree_ and removes the need to select a branch first, since all compares are performed with the working tree &mdash; closes [#279](https://github.com/gitkraken/vscode-gitlens/issues/279)

### Removed

- Removes tag icons from the _GitLens_ explorer

### Fixed

- Fixes [#294](https://github.com/gitkraken/vscode-gitlens/issues/294) - Keyboard shortcuts will now default to _chorded_ to avoid conflicts. Only affects new installs or if you remove the `gitlens.keymap` setting
- Fixes issue where Recent Changes annotations weren't restored properly on tab switch
- Fixes quick pick menu issue with commits with newlines in the message

## [8.0.2] - 2018-02-19

### Fixed

- Fixes button colors on the Welcome and Settings pages to follow the color theme properly

## [8.0.1] - 2018-02-18

### Added

- Adds _Compare Index (HEAD) with Branch or Tag..._ (`gitlens.explorers.diffHeadWithBranch`) command - compares the index (HEAD) to the selected branch or tag &mdash; thanks to [PR #278](https://github.com/gitkraken/vscode-gitlens/pull/278) by Geoffrey ([@g3offrey](https://github.com/g3offrey))!
- Adds _Compare Working Tree with Branch or Tag..._ (`gitlens.explorers.diffWorkingWithBranch`) command - compares the working tree to the selected branch or tag
- Adds `gitlens.statusBar.reduceFlicker` setting to specify whether to reduce the status bar "flickering" when changing lines by not first clearing the previous blame information &mdash; closes [#272](https://github.com/gitkraken/vscode-gitlens/issues/272)
- Adds the _Open File_ (`gitlens.explorers.openFile`) command to the _GitLens_ explorer's inline toolbar for file nodes
- Adds the _Clear Results_ (`gitlen.resultsExplorer.clearResultsNode`) command to the _GitLens Results_ explorer's inline toolbar for results nodes
- Adds the _Swap Comparison_ (`gitlen.resultsExplorer.swapComparison`) command to the _GitLens Results_ explorer's inline toolbar and context menu for comparison results nodes
- Adds _Push to Commit (via Terminal)_ (`gitlens.explorers.terminalPushCommit`) command to commit nodes on the current branch in the _GitLens_ explorer

### Changed

- Uses vscode's `git.path` setting when searching for the git executable

### Fixed

- Fixes [#276](https://github.com/gitkraken/vscode-gitlens/issues/276) - Lookup for branches without upstreams fails
- Fixes [#274](https://github.com/gitkraken/vscode-gitlens/issues/274) - TextEditor is closed/disposed occurs when this extension is enabled
- Fixes [#288](https://github.com/gitkraken/vscode-gitlens/issues/288) - CSS errors on welcome page (mask-\* properties)
- Fixes issues with settings migration &mdash; should now migrate any existing settings that haven't already been set

## [8.0.0] - 2018-02-07

### Added

- Adds an all-new GitLens welcome page via the _Welcome_ (`gitlens.showWelcomePage`) command &mdash; provides a welcome / onboarding experience &mdash; closes [#51](https://github.com/gitkraken/vscode-gitlens/issues/51)

  ![GitLens Welcome](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-welcome.png)

- Adds an all-new GitLens Settings editor via the _Open Settings_ (`gitlens.showSettingsPage`) command &mdash; provides an easy-to-use interactive settings editor for many of GitLens' features &mdash; closes [#167](https://github.com/gitkraken/vscode-gitlens/issues/167)

  ![GitLens Settings](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/cl-settings.png)

- Adds a tree layout option to branches in the _GitLens_ explorer &mdash; closes [#258](https://github.com/gitkraken/vscode-gitlens/issues/258) thanks to [PR #260](https://github.com/gitkraken/vscode-gitlens/pull/260) by Yukai Huang ([@Yukaii](https://github.com/Yukaii))!
- Adds _Follow Renames_ command (`gitlens.gitExplorer.setRenameFollowingOn`) to the _GitLens_ explorer _History_ view to follow file renames in the history
- Adds _Don't Follow Renames_ command (`gitlens.gitExplorer.setRenameFollowingOff`) to the _GitLens_ explorer _History_ view to not follow file renames in the history
- Adds `gitlens.advanced.fileHistoryFollowsRenames` setting to specify whether file histories will follow renames -- will affect how merge commits are shown in histories &mdash; closes [#259](https://github.com/gitkraken/vscode-gitlens/issues/259)
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

- Fixes [#35](https://github.com/gitkraken/vscode-gitlens/issues/35) - Copy Commit Sha to Clipboard not working (linux)
- Fixes issue where the last commit of a file history would be broken (failed to parse correctly)
- Fixes issue with _Open Working File_ command (`gitlens.openWorkingFile`) failing when a file was renamed

## [7.5.10] - 2018-02-01

### Added

- Adds support for custom remotes with split project/repo url structure &mdash; closes [#267](https://github.com/gitkraken/vscode-gitlens/issues/267)

### Fixed

- Fixes [#266](https://github.com/gitkraken/vscode-gitlens/issues/266) - Wrong time in Popup
- Fixes [#259](https://github.com/gitkraken/vscode-gitlens/issues/259) (again) - File history lists unrelated merge commits

## [7.5.9] - 2018-01-30

### Fixed

- Fixes [#265](https://github.com/gitkraken/vscode-gitlens/issues/265) - Delete line pushes screen to the right (even if word wrap is on)

## [7.5.8] - 2018-01-29

### Fixed

- Fixes regression working with submodules
- Fixes [#262](https://github.com/gitkraken/vscode-gitlens/issues/262) - GitLens only available in SCM diff windows
- Fixes [#261](https://github.com/gitkraken/vscode-gitlens/issues/261) - Unable to open compare. The file is probably not under source control
- Fixes missing avatars in file blame annotations in non-compact mode
- Fixes file blame annotation highlight not being restored properly on tab switch

## [7.5.7] - 2018-01-25

### Added

- Adds a repository quick pick menu to the _Show Commit Search_ command (`gitlens.showCommitSearch`) when there is no active repository

### Fixed

- Fixes [#257](https://github.com/gitkraken/vscode-gitlens/issues/257) - Some branches fail to show history
- Fixes [#259](https://github.com/gitkraken/vscode-gitlens/issues/259) - File history lists unrelated merge commits

## [7.5.6] - 2018-01-22

### Changed

- Changes `chorded` keymap on Windows to use `Ctrl+Shift+G` rather than `Ctrl+Alt+G` to avoid [issues](https://blogs.msdn.microsoft.com/oldnewthing/20040329-00/?p=40003)
  - Also remaps `Show SCM` to `Ctrl+Shift+G G` since by default it is `Ctrl+Shift+G` if the `chorded` keymap is used
- Refactors git log and stash output parsing &mdash; should be faster and far more robust

### Fixed

- Fixes [#256](https://github.com/gitkraken/vscode-gitlens/issues/256) - Fails to copy commit message
- Fixes [#255](https://github.com/gitkraken/vscode-gitlens/issues/255) - Lines after an empty line in the commit message are not copied to clipboard
- Fixes [#252](https://github.com/gitkraken/vscode-gitlens/issues/252) - Cannot read property 'push' of undefined
- Fixes issue where GitLens wouldn't detect the creation of a Git repository if there were no other repositories open
- Fixes issue where some GitLens commands would show in the palette even though there was no repository
- Fixes issue where navigating the history of a renamed file could cause errors
- Fixes issue with using the `gitlens.diffWithPrevious` command option for Git CodeLens

## [7.5.5] - 2018-01-18

### Fixed

- Fixes [#247](https://github.com/gitkraken/vscode-gitlens/issues/247) - File annotations button or ESC key does not turn off file annotations
- Fixes issue where sometimes blame context wasn't available for the open editor when starting vscode

## [7.5.4] - 2018-01-17

### Fixed

- Fixes [#249](https://github.com/gitkraken/vscode-gitlens/issues/249) - Gitlens disappears from the status bar
- Fixes issue where [Gravatars](https://en.gravatar.com/) in the gutter blame annotations weren't restored on tab switch
- Fixes issue where the id (sha) was missing in the hover blame annotations for uncommitted changes

## [7.5.3] - 2018-01-15

### Fixed

- Fixes [#245](https://github.com/gitkraken/vscode-gitlens/issues/245) - CodeLens disappears/and reappears when auto-saving

## [7.5.2] - 2018-01-15

### Fixed

- Fixes [#242](https://github.com/gitkraken/vscode-gitlens/issues/242) - Broken "gitlens.blame.line.enabled" setting

## [7.5.1] - 2018-01-15

### Added

- Adds [Gravatar](https://en.gravatar.com/) support to gutter and hover blame annotations
- Adds `gitlens.annotations.file.gutter.gravatars` setting to specify whether to show gravatar images in the gutter blame annotations
- Adds support for providing blame annotations, CodeLens, etc on files with unsaved changes &mdash; closes [#112](https://github.com/gitkraken/vscode-gitlens/issues/112)
- Adds `gitlens.defaultDateStyle` setting to specify how dates will be displayed by default &mdash; closes [#89](https://github.com/gitkraken/vscode-gitlens/issues/89)
- Adds _Compare with Working Tree_ command (`gitlens.explorers.compareWithWorking`) to branch, tag, and revision (commit) nodes in the _GitLens_ explorer to compare the current selection with the current working tree in the _GitLens Results_ explorer
- Adds _Compare Selected Ancestor with Working Tree_ command (`gitlens.explorers.compareSelectedAncestorWithWorking`) to branch nodes in the _GitLens_ explorer once another branch within the same repository has been selected to compare the [merge base](https://git-scm.com/docs/git-merge-base) of current and previously selected branches with the working tree in the _GitLens Results_ explorer &mdash; closes [#240](https://github.com/gitkraken/vscode-gitlens/issues/240)
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
- Fixes issue where showing commit search (file-based) results in the _GitLens Results_ explorer wouldn't only show the matching files &mdash; closes [#197](https://github.com/gitkraken/vscode-gitlens/issues/197)
- Fixes [#238](https://github.com/gitkraken/vscode-gitlens/issues/238) - Show merge commits in file history
- Fixes issue where the Tags node of the _GitLens_ explorer wasn't updated on changes
- Fixes issue where changes to .gitignore weren't detected properly
- Fixes [#241](https://github.com/gitkraken/vscode-gitlens/issues/241) - Adds default setting for .jsonc files to match Git CodeLens of .json files
- Fixes issue where blame annotations and commands were missing from vscode Git staged revision documents
- Fixes issue where opening changes for renamed files in the _GitLens_ explorer and _GitLens Results_ explorer wouldn't work properly
- Fixes issue where file-specific menu commands show up on folders in the explorer

## [7.2.0] - 2018-01-01

### Added

- Adds on-demand **heatmap annotations** of the whole file &mdash; closes [#182](https://github.com/gitkraken/vscode-gitlens/issues/182)
  - Displays a **heatmap** (age) indicator near the gutter, which provides an easy, at-a-glance way to tell the age of a line
    - Indicator ranges from bright yellow (newer) to dark brown (older)
- Adds _Toggle File Heatmap Annotations_ command (`gitlens.toggleFileHeatmap`) to toggle the heatmap annotations on and off
- Adds semi-persistent results for commit operations, via the _Show Commit Details_ command (`gitlens.showQuickCommitDetails`) in the _GitLens Results_ explorer &mdash; closes [#237](https://github.com/gitkraken/vscode-gitlens/issues/237)
- Adds _Show in Results_ option to the commit details quick pick menu to show the commit in the _GitLens Results_ explorer
- Adds _Compare with Index (HEAD)_ command (`gitlens.explorers.compareWithHead`) to branch, tag, and revision (commit) nodes in the _GitLens_ explorer to compare the current selection with the current index (HEAD) in the _GitLens Results_ explorer
- Adds _Compare with Remote_ command (`gitlens.explorers.compareWithRemote`) to branch nodes in the _GitLens_ explorer to compare the current selection with its remote tracking branch in the _GitLens Results_ explorer

### Changed

- Improves startup performance and reduces package size

### Fixed

- Fixes [#239](https://github.com/gitkraken/vscode-gitlens/issues/239) - `gitlens.advanced.quickPick.closeOnFocusOut` setting should be reversed
- Fixes [#208](https://github.com/gitkraken/vscode-gitlens/issues/208) - Gitlens doesn't work over UNC

## [7.1.0] - 2017-12-22

### Added

- Adds _Open Working File_ command (`gitlens.openWorkingFile`) - opens the working file for the active file revision &mdash; closes [#236](https://github.com/gitkraken/vscode-gitlens/issues/236)
- Adds _Open Revision..._ command (`gitlens.openFileRevision`) - opens the selected revision for the active file
- Adds tags to the _Compare File with Branch..._ command (`gitlens.diffWithBranch`) &mdash; closes [#204](https://github.com/gitkraken/vscode-gitlens/issues/204)
- Adds tags to the _Directory Compare Working Tree with..._ command (`gitlens.diffDirectory`) &mdash; closes [#204](https://github.com/gitkraken/vscode-gitlens/issues/204)
- Adds _Show Branches and Tags_ to quick pick menu shown by the _Compare File with Revision..._ command (`gitlens.diffWithRevision`) &mdash; closes [#204](https://github.com/gitkraken/vscode-gitlens/issues/204)
- Adds _Show Branches and Tags_ to quick pick menu shown by the _Open Revision..._ command (`gitlens.openFileRevision`) &mdash; closes [#204](https://github.com/gitkraken/vscode-gitlens/issues/204)

### Changed

- Improves startup performance by ~65% (on my very fast PC) and reduces package size by over 75%
- Renames _Compare File with Branch..._ command (`gitlens.diffWithBranch`) to _Compare File with Branch or Tag..._

### Fixed

- Fixes issues with commit paging in certain quick pick menus
- Fixes issues with certain quick pick menu progress indicators getting stuck in some cases
- Fixes issues with menu choice placements on the editor title menu

## [7.0.0] - 2017-12-18

### Added

- Adds a new **Active Repository** node to the **Repository View** of the _GitLens_ explorer &mdash; closes [#224](https://github.com/gitkraken/vscode-gitlens/issues/224)

  - Automatically updates to track the repository of the active editor
  - Only visible if there is more than 1 repository within the workspace

- Adds a new **Tags** node to the **Repository View** of the _GitLens_ explorer &mdash; closes [#234](https://github.com/gitkraken/vscode-gitlens/issues/234)

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

- Adds _Apply Changes_ option to the commit/stash file quick pick menu &mdash; closes [#232](https://github.com/gitkraken/vscode-gitlens/issues/232)
- Adds _Show All Commits_ option to the commit search quick pick menu to show all the results, if there are more than the threshold
- Adds _Show in Results_ option to the commit search quick pick menu to show the results in the _GitLens Results_ explorer
- Adds _Show in Results_ option to the file history quick pick menu to show the history in the _GitLens Results_ explorer

### Changed

- Improves startup performance a bit
- Renames _Compare Directory with Branch..._ command (`gitlens.diffDirectory`) to _Directory Compare Working Tree with..._
- Renames _Compare Directory with Previous Revision_ in quick pick menus to _Open Directory Compare with Previous Revision_
- Renames _Compare Directory with Working Tree_ in quick pick menus to _Open Directory Compare with Working Tree_

### Fixed

- Fixes [#228](https://github.com/gitkraken/vscode-gitlens/issues/228) - Gutter blame spills over heatmap
- Fixes incorrect blame highlighting &mdash; thanks to [PR #231](https://github.com/gitkraken/vscode-gitlens/pull/231) by Alexey Vasyukov ([@notmedia](https://github.com/notmedia))!
- Fixes issue with the _Open in File/Revision_ option in the file history quick pick menu
- Fixes issues with Git warnings when parsing log status output (can cause the _GitLens_ explorer to not show data in some cases)
- Fixes &#x1F91E; [#226](https://github.com/gitkraken/vscode-gitlens/issues/226) - Annotations show in Debug Console

## [6.4.0] - 2017-12-12

### Added

- Adds `gitlens.keymap` setting to specify the keymap to use for GitLens shortcut keys &mdash; closes [#104](https://github.com/gitkraken/vscode-gitlens/issues/104)
  - `standard` - adds a standard set of shortcut keys
  - `chorded` - adds a chorded set of shortcut keys that all start with `Ctrl+Alt+G` (<code>&#x2325;&#x2318;G</code> on macOS)
  - `none` - no shortcut keys will be added
- Adds progress indicator to the _Show Stashed Changes_ command (`gitlens.showQuickStashList`)
- Adds progress indicator to the _Apply Stashed Changes_ command (`gitlens.stashApply`)

### Changed

- Overhauls the internal way GitLens deals with Uris and revisions should be far more robust and lead to many fewer edge-case issues
- Aligns quick pick menu commands more with the _GitLens_ explorer context menus

### Fixed

- Fixes [#220](https://github.com/gitkraken/vscode-gitlens/issues/220) - Open Revision quick pick results in empty file
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
- Adds Git CodeLens to Git file revisions (GitLens or vscode's)

### Fixed

- Fixes &#x1F91E; [#202](https://github.com/gitkraken/vscode-gitlens/issues/202) - Staged change's vscode diff side-by-side view shows the wrong history
- Fixes &#x1F91E; [#216](https://github.com/gitkraken/vscode-gitlens/issues/216) - PowerShell session not started if GitLens is enabled
- Fixes [#217](https://github.com/gitkraken/vscode-gitlens/issues/217) - empty editor has git lens in status bar with old information
- Fixes [#218](https://github.com/gitkraken/vscode-gitlens/issues/218) - Cannot read property 'replace' of undefined
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

- Fixes [#211](https://github.com/gitkraken/vscode-gitlens/issues/211) - Unsaved CodeLens appears on untracked files
- Fixes issue where _Open \* in Remote_ commands are sometimes missing

## [6.1.2] - 2017-11-21

### Fixed

- Fixes [#207](https://github.com/gitkraken/vscode-gitlens/issues/207) - Applying and deleting stashes suddenly stopped working
- Fixes [#205](https://github.com/gitkraken/vscode-gitlens/issues/205) - Toggle Line Blame Annotations disappeared after last update
- Fixes [#203](https://github.com/gitkraken/vscode-gitlens/issues/203) - Open Changed Files is broken
- Fixes [#176](https://github.com/gitkraken/vscode-gitlens/issues/176) - Line annotations sometimes mess with white space

## [6.1.1] - 2017-11-17

### Fixed

- Fixes [#201](https://github.com/gitkraken/vscode-gitlens/issues/201) - "Open in Remote" commands should check for branch upstream tracking
- Fixes [#200](https://github.com/gitkraken/vscode-gitlens/issues/200) - Submodule using terminal command, root directory is incorrect

## [6.1.0] - 2017-11-13

### Added

- Adds support for nested repositories and submodules &mdash; closes [#198](https://github.com/gitkraken/vscode-gitlens/issues/198)
- Adds `gitlens.advanced.repositorySearchDepth` setting to specify how many folders deep to search for repositories

### Changed

- Changes to use `diff.guitool` first if available, before falling back to `diff.tool` &mdash; closes [#195](https://github.com/gitkraken/vscode-gitlens/issues/195)

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
- Adds code search support to the _Search Commits_ command (`gitlens.showCommitSearch`) &mdash; closes [#127](https://github.com/gitkraken/vscode-gitlens/issues/127)
  - Use `~<regex>` to search for commits with differences whose patch text contains added/removed lines that match `<regex>`
  - Use `=<regex>` to search for commits with differences that change the number of occurrences of the specified string (i.e. addition/deletion) in a file
- Adds support to the _Compare File with Branch..._ command (`gitlens.diffWithBranch`) work with renamed files &mdash; closes [#165](https://github.com/gitkraken/vscode-gitlens/issues/165)
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
- Adds ability to specify the url protocol used with user-defined remote services via `gitlens.remotes` setting &mdash; thanks to [PR #192](https://github.com/gitkraken/vscode-gitlens/pull/192) by Helmut Januschka ([@hjanuschka](https://github.com/hjanuschka))!

### Changed

- _GitLens_ explorer will no longer show if there is no Git repository &mdash; closes [#159](https://github.com/gitkraken/vscode-gitlens/issues/159)
- Optimizes event handling, executing git commands, and general processing to improve performance and reduce any lag
- Optimizes current line hover annotations to only be computed on hover (i.e. lazily evaluated) to reduce the compute required when changing lines
- Protects credentials from possibly being affected by poor network conditions via Git Credential Manager (GCM) for Windows environment variables
- Delays (slightly) the initial loading of the _GitLens_ explorer to improve startup performance

### Fixed

- Fixes jumpy CodeLens when deleting characters from a line with a Git CodeLens
- Fixes [#178](https://github.com/gitkraken/vscode-gitlens/issues/178) - Slight but noticeable keyboard lag with Gitlens
- Fixes [#183](https://github.com/gitkraken/vscode-gitlens/issues/183) - Remote with same url should only show once
- Fixes [#185](https://github.com/gitkraken/vscode-gitlens/issues/185) - Wrong relative date shows on mouse hover
- Fixes issue where using the _Refresh_ command on a _GitLens_ explorer node refreshed the whole view, rather than just the node
- Fixes issue where certain commands fail when there is no current branch (rebase, detached HEAD, etc)

## [5.7.1] - 2017-10-19

### Fixed

- Fixes [#174](https://github.com/gitkraken/vscode-gitlens/issues/174) - File Blame Annotations No Longer Working (and some other editor-based commands)

## [5.7.0] - 2017-10-19

### Added

- Adds _Open All Changes (with difftool)_ command (`gitlens.externalDiffAll`) - opens all working changes with the configured git difftool &mdash; closes [#164](https://github.com/gitkraken/vscode-gitlens/issues/164)
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

- Fixes [#163](https://github.com/gitkraken/vscode-gitlens/issues/163) - GitLens can cause git locking in the background
- Fixes issues tracking the active editor in the **History View** of the _GitLens_ explorer
- Fixes issue where the _GitLens_ explorer would refresh more than once when a file system change was detected
- Fixes issue where opening commit search could be filled out with `#00000000`

## [5.6.5] - 2017-10-16

### Removed

- Removes `gitlens.advanced.gitignore.enabled` setting since its usage has been replaced by a tracked file cache

### Fixed

- Fixes issues with tracked files which are ignored via `.gitignore` not working properly

## [5.6.4] - 2017-10-12

### Fixed

- Fixes [#168](https://github.com/gitkraken/vscode-gitlens/issues/168) - Git environment context was missing

## [5.6.3] - 2017-10-12

### Changed

- Swaps out Moment.js for date-fns to improve blame annotation performance and to reduce the GitLens bundle size (saves ~400kb)

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

  ![Details Blame Annotation (hover)](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-hovers-current-line-details.png)

  - Provides _Open Changes_, _Blame Previous Revision_, _Open in Remote_, and _Show More Actions_ command buttons

- Adds support for remembering file annotations when switching tabs
- Adds full GitLens support for file revisions &mdash; file & line annotations, commands, etc

### Changed

- Changes `gitlens.annotations.file.gutter.hover.wholeLine` setting to default to `true`

### Removed

- Removes peek-style file & blame history explorers - see [#66](https://github.com/gitkraken/vscode-gitlens/issues/66) for more details
  - Removes _Open Blame History Explorer_ command (`gitlens.showBlameHistory`)
  - Removes _Open File History Explorer_ command (`gitlens.showFileHistory`)
  - Removes `"gitlens.showBlameHistory"` & `"gitlens.showFileHistory"` option from `gitlens.codeLens.recentChange.command` setting
  - Removes `"gitlens.showBlameHistory"` & `"gitlens.showFileHistory"` option from `gitlens.codeLens.authors.command` setting
  - Removes `"gitlens.showBlameHistory"` & `"gitlens.showFileHistory"` option from `gitlens.statusBar.command` setting
- Removes `gitlens.advanced.toggleWhitespace.enabled` setting &mdash; as it is no longer required

### Fixed

- Fixes [#161](https://github.com/gitkraken/vscode-gitlens/issues/161) - Remove colors from output of git command calls

## 5.4.1 - 2017-10-03

### Changed

- Changes annotation hovers to only add _Open in Remote_ and _Show Commit Details_ commands when applicable &mdash; thanks to [PR #158](https://github.com/gitkraken/vscode-gitlens/pull/158) by SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC))!

### Fixed

- Fixes issue where **Changes** hover annotation displayed incorrect info when there was no previous commit &mdash; thanks to [PR #158](https://github.com/gitkraken/vscode-gitlens/pull/158) by SpaceEEC ([@SpaceEEC](https://github.com/SpaceEEC))!
- Fixes issue when checking for remotes could return no remotes even if remotes are configured

## [5.4.0] - 2017-09-30

### Added

- Adds support for user-defined remote services via `gitlens.remotes` setting &mdash; closes [#148](https://github.com/gitkraken/vscode-gitlens/issues/148)
- Adds _Open Changes (with difftool)_ command (`gitlens.externalDiff`) - opens the changes of a file or set of files with the configured git difftool &mdash; thanks to [PR #154](https://github.com/gitkraken/vscode-gitlens/pull/154) by Chris Kaczor ([@ckaczor](https://github.com/ckaczor))!
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

- Fixes [#153](https://github.com/gitkraken/vscode-gitlens/issues/153) - New folders treated as files in "Changed Files" section of the sidebar component

## [5.2.0] - 2017-09-23

### Added

- Adds new **Changed Files** node to the **Repository Status** node of the _GitLens_ explorer's **Repository View** &mdash; closes [#139](https://github.com/gitkraken/vscode-gitlens/issues/139)
  - Provides an at-a-glance view of all "working" changes
  - Expands to a file-based view of all changed files in the working tree (enabled via `"gitlens.insiders": true`) and/or all files in all commits ahead of the upstream
- Adds optional (on by default) working tree status information to the **Repository Status** node in the _GitLens_ explorer
- Adds `auto` value to `gitlens.gitExplorer.view` setting - closes [#150](https://github.com/gitkraken/vscode-gitlens/issues/150)
- Adds `gitlens.gitExplorer.enabled` setting to specify whether to show the _GitLens_ explorer - closes [#144](https://github.com/gitkraken/vscode-gitlens/issues/144)
- Adds `gitlens.gitExplorer.includeWorkingTree` setting to specify whether to include working tree files inside the **Repository Status** node of the _GitLens_ explorer
- Adds `gitlens.gitExplorer.statusFileFormat` setting to the format of the status of a working or committed file in the _GitLens_ explorer

### Changed

- Changes the sorting (now alphabetical) of files shown in the _GitLens_ explorer
- Changes the default of the `gitlens.gitExplorer.view` setting to `auto`
- Changes the default of the `gitlens.gitExplorer.commitFormat` setting to add parentheses around the commit id
- Removes many menu items from `editor/title` & `editor/title/context` by default &mdash; can be re-enabled via the `gitlens.advanced.menus` setting

### Fixed

- Fixes [#146](https://github.com/gitkraken/vscode-gitlens/issues/146) - Blame gutter annotation issue when commit contains emoji
- Fixes an issue when running _Open File in Remote_ with a multi-line selection wasn't properly opening the selection in GitLab &mdash; thanks to [PR #145](https://github.com/gitkraken/vscode-gitlens/pull/145) by Amanda Cameron ([@AmandaCameron](https://github.com/AmandaCameron))!
- Fixes an issue where the `gitlens.advanced.menus` setting wasn't controlling all the menu items properly

## [5.1.0] - 2017-09-15

### Added

- Adds full (multi-line) commit message to the **details** hover annotations &mdash; closes [#116](https://github.com/gitkraken/vscode-gitlens/issues/116)
- Adds an external link icon to the **details** hover annotations to run the _Open Commit in Remote_ command (`gitlens.openCommitInRemote`)

### Changed

- Optimizes performance of the providing blame annotations, especially for large files (saw a ~78% improvement on some files)
- Optimizes date handling (parsing and formatting) for better performance and reduced memory consumption

### Removed

- Removes `gitlens.annotations.file.recentChanges.hover.wholeLine` setting as it didn't really make sense

### Fixed

- Fixes an issue where stashes with only untracked files would not show in the **Stashes** node of the _GitLens_ explorer
- Fixes an issue where stashes with untracked files would not show its untracked files in the _GitLens_ explorer

## 5.0.0 - 2017-09-12

### Added

- Adds an all-new _GitLens_ explorer to the Explorer activity

  - **Repository View** - provides a full repository explorer

    ![GitLens Repository view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-gitlens-explorer-repository.png)

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

    ![GitLens File History view](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-gitlens-explorer-history.png)

    - Automatically updates to track the active editor
    - Provides a context menu with _Open File_, _Open File in Remote_, and _Refresh_ commands
    - Provides a context menu on each revision (commit) with _Open Changes_, _Open Changes with Working Tree_, _Open File_, _Open Revision_, _Open File in Remote_, _Open Revision in Remote_, _Apply Changes_, and _Show Commit File Details_ commands

  - Quickly switch between views using the _Switch to Repository View_ or _Switch to File History View_ commands
  - Provides toolbar commands to _Search Commits_, _Switch to Repository View_ or _Switch to File History View_, and _Refresh_

- Adds all-new interactivity to the hover annotations

  ![Hover Annotations](https://raw.githubusercontent.com/gitkraken/vscode-gitlens/4ddb871459a3a1a1e132c8bdf83ac12e3b699649/images/ss-hovers-annotations.png)

  - Adds the following command-links to the **details** hover annotation
    - Clicking the commit id will run the _Show Commit Details_ command
  - Adds the following command-links to the **changes** hover annotation
    - Clicking on **Changes** will run the _Open Changes_ command
    - Clicking the current and previous commit ids will run the _Show Commit Details_ command

- Adds support for remote services with custom domains &mdash; closes [#120](https://github.com/gitkraken/vscode-gitlens/issues/120)
- Adds support for the Bitbucket Server (previously called Stash) remote service &mdash; closes [#120](https://github.com/gitkraken/vscode-gitlens/issues/120)
- Adds `gitlens.blame.ignoreWhitespace` setting to specify whether to ignore whitespace when comparing revisions during blame operations &mdash; closes [#138](https://github.com/gitkraken/vscode-gitlens/issues/138)
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
- Fixes [#130](https://github.com/gitkraken/vscode-gitlens/issues/130) - First-run "Thank you for choosing GitLens! [...]" info message shown on every start up
- Fixes an issue where sometimes diffs (via branch name) wouldn't open properly
- Fixes an issue where remotes are queried more than once on startup

## 4.4.3 - 2017-08-30

### Fixed

- Fixes [#135](https://github.com/gitkraken/vscode-gitlens/issues/135) - Full-width characters break gutter annotations (really this time)

## 4.4.2 - 2017-08-29

### Fixed

- Fixes [#135](https://github.com/gitkraken/vscode-gitlens/issues/135) - Full-width characters break gutter annotations

## 4.4.1 - 2017-08-23

### Fixed

- Fixes [#114](https://github.com/gitkraken/vscode-gitlens/issues/114) - Stylus files makes CodeLens freak out

## 4.4.0 - 2017-08-18

### Added

- Adds a progress indicator to the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) icon &mdash; pulses while annotations are computed
- Adds an active state to the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`) icon &mdash; turns orange while the annotations are visible
- Adds automatic disabling of the current line blame annotations when starting a debug session and will restore them when the debug session ends &mdash; can still be manually toggled via the _Toggle Line Blame Annotations_ command (`gitlens.toggleLineBlame`)

### Changed

- Changes chat links from Gitter to [Slack](https://vscode-slack.amod.io)
- Changes the look of the line separators on the gutter blame annotations
- Changes the `gitlens.advanced.toggleWhitespace.enabled` configuration setting to default to `false` &mdash; thanks to the awesome work in vscode by Alexandru Dima ([@alexandrudima](https://github.com/alexandrudima)) this is no longer required!

### Removed

- Removes unneeded `gitlens.stashExplorer.enabled` configuration setting since users can add or remove views natively now
- Removes unneeded _Toggle Git Stashes Explorer_ command (`gitlens.stashExplorer.toggle`) since users can add or remove views natively now
- Removes the `gitlens.theme.annotations.file.hover.separateLines` configuration setting

### Fixed

- Fixes jumpiness when opening a diff to a certain line

## 4.3.3 - 2017-07-28

### Added

- Adds progress indicator for when computing annotations takes a while

### Changed

- Optimizes performance of the providing blame annotations, especially for large files (saw a 3.5x improvement on some files)

### Fixed

- Fixes [#107](https://github.com/gitkraken/vscode-gitlens/issues/107) - Double-byte characters break blame layout (still requires proper font support)

## 4.3.2 - 2017-07-20

### Fixed

- Fixes [#118](https://github.com/gitkraken/vscode-gitlens/issues/118) - GitLens stopped working on latest insiders build &mdash; thanks to [PR #121](https://github.com/gitkraken/vscode-gitlens/pull/121) by Johannes Rieken ([@jrieken](https://github.com/jrieken))

## 4.3.1 - 2017-07-03

### Added

- Adds `gitlens.stashExplorer.enabled` setting to specify whether to show the **Git Stashes** view
- Adds _Toggle Git Stashes Explorer_ command (`gitlens.stashExplorer.toggle`) - toggles the **Git Stashes** view on and off

### Changed

- Hides the **Git Stashes** view by default

### Fixed

- Fixes [#108](https://github.com/gitkraken/vscode-gitlens/issues/108) - Option to remove stash explorer from the main explorer?

## 4.3.0 - 2017-07-03

### Added

- Adds **Git Stashes** view to the Explorer activity
  - Shows all of the stashed changes in the repository
  - Provides toolbar buttons to _Stash Changes_ and _Refresh_
  - Provides a context menu with _Apply Stashed Changes_ and _Delete Stashed Changes_ commands - both require a confirmation
  - Expand each stash to quickly see the set of files changed, complete with status indicators for adds, changes, renames, and deletes
    - Provides a context menu with _Open Changes_, _Open File_, _Open Stashed File_, _Open File in Remote_, and _Compare File with Working Tree_ commands

## 4.2.0 - 2017-06-27

### Added

- Adds _Compare File with Revision..._ command (`gitlens.diffWithRevision`) - compares the active file with the selected revision of the same file
- Adds _Open Changed Files_ command (`gitlens.openChangedFiles`) to the source control group context menu
- Adds _Close Unchanged Files_ command (`gitlens.closeUnchangedFiles`) to the source control group context menu
- Adds _Open File in Remote_ command (`gitlens.openFileInRemote`) to the source control resource context menu
- Adds _Compare File with Revision..._ command (`gitlens.diffWithRevision`) to the source control resource context menu
- Adds _Show File History_ command (`gitlens.showQuickFileHistory`) to the source control resource context menu

### Changed

- Renames _Compare File with..._ command to `Compare File with Branch...`
- Renames _Open Line Commit in Remote_ command to `Open Commit in Remote`
- Renames _Show Line Commit Details_ command to `Show Commit File Details`
- Updates the description of `gitlens.blame.line.enabled` to be clearer about its behavior
- Updates the description of `gitlens.codeLens.enabled` to be clearer about its behavior

### Fixed

- Fixes [#103](https://github.com/gitkraken/vscode-gitlens/issues/103) - Toggle file blame annotations disables line blame annotations if line blame annotations are off by default
- Fixes another infinite loop in the _Close Unchanged Files_ command

## 4.1.4 - 2017-06-25

### Changed

- Optimizes performance of the _Compare with Previous_ commands - also avoids trying to focus a line if we don't have one

### Fixed

- Fixes **changes** (diff) hover not showing the correct previous line (for real this time)
- Attempts to fix [#99](https://github.com/gitkraken/vscode-gitlens/issues/99) - undo/redo spawns too many git processes

## 4.1.3 - 2017-06-20

### Fixed

- Fixes **changes** (diff) hover not showing the correct previous line when showing recent changes annotations of the whole-file

## 4.1.2 - 2017-06-15

### Fixed

- Fixes [#96](https://github.com/gitkraken/vscode-gitlens/issues/96) - External diff command can be unintentionally triggered

## 4.1.1 - 2017-06-13

### Added

- Adds an `alt` command to the _Toggle File Blame Annotations_ command button, which when you hold down `alt` and click it will execute the _Toggle Recent File Changes Annotations_ command instead

### Fixed

- Fixes missing _Toggle File Blame Annotations_ command icon

## 4.1.0 - 2017-06-13

### Added

- Adds all-new recent changes annotations of the whole-file - annotates and highlights all the lines changed in the most recent commit
  - Can customize the [layout](https://github.com/gitkraken/vscode-gitlens#file-recent-changes-annotation-settings), as well as the [theme](https://github.com/gitkraken/vscode-gitlens#theme-settings)
- Adds _Toggle Recent File Changes Annotations_ command (`gitlens.toggleFileRecentChanges`) - toggles the recent changes annotations on and off
- Adds ability to press `Escape` to quickly toggle any whole-file annotations off
- Improves performance
  - Optimized git output parsing to increase speed and dramatically reduce memory usage
  - Defers diff chunk parsing until it is actually required
- Adds `gitlens.defaultDateFormat` setting to specify how all absolute dates will be formatted by default

### Fixed

- Fixes excessive memory usage when parsing diffs
- Fixes extra newline in multi-line commit messages
- Fixes (again) [#33](https://github.com/gitkraken/vscode-gitlens/issues/33) - Commit messages can causes markdown formatting in hovers

## 4.0.1 - 2017-06-09

### Fixed

- Fixes [#87](https://github.com/gitkraken/vscode-gitlens/issues/87) - Can't open files in remote when using git@ urls (ssh)

## 4.0.0 - 2017-06-09

### Added

- Adds all-new, beautiful, highly customizable and themable, file blame annotations
  - Can now fully customize the [layout and content](https://github.com/gitkraken/vscode-gitlens#file-blame-annotation-settings), as well as the [theme](https://github.com/gitkraken/vscode-gitlens#theme-settings)
- Adds all-new configurability and themeability to the current line blame annotations
  - Can now fully customize the [layout and content](https://github.com/gitkraken/vscode-gitlens#line-blame-annotation-settings), as well as the [theme](https://github.com/gitkraken/vscode-gitlens#theme-settings)
- Adds all-new configurability to the status bar blame information
  - Can now fully customize the [layout and content](https://github.com/gitkraken/vscode-gitlens#status-bar-settings)
- Adds all-new [configurability](https://github.com/gitkraken/vscode-gitlens#advanced-settings) over which commands are added to which menus via the `gitlens.advanced.menus` setting
- Adds better [configurability](https://github.com/gitkraken/vscode-gitlens#code-lens-settings) over where Git CodeLens will be shown &mdash; both by default and per language
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

- (BREAKING) Almost all of the GitLens settings have either been renamed, removed, or otherwise changed - see the [README](https://github.com/gitkraken/vscode-gitlens#extension-settings)`
- Changes the positioning of the Git CodeLens to try to be at the end of any other CodeLens on the same line
- Changes the position of the _Open File in Remote_ command (`gitlens.openFileInRemote`) in the context menus - now in the `navigation` group
- Changes the _Toggle Git CodeLens_ command (`gitlens.toggleCodeLens`) to always toggle the Git CodeLens on and off
- Changes the default of `gitlens.advanced.toggleWhitespace.enabled` back to `true`, but automatically disables whitespace toggling if whitespace rendering is not on

### Removed

- Removes the on-demand **trailing** file blame annotations &mdash; didn't work out and just ended up with a ton of visual noise
- Removes _Toggle Blame Annotations_ command (`gitlens.toggleBlame`) - replaced by the _Toggle File Blame Annotations_ command (`gitlens.toggleFileBlame`)
- Removes _Show Blame Annotations_ command (`gitlens.showBlame`) - replaced by the _Show File Blame Annotations_ command (`gitlens.showFileBlame`)

### Fixed

- Fixes [#81](https://github.com/gitkraken/vscode-gitlens/issues/81) - Current line annotation feels too sticky
- Fixes [#83](https://github.com/gitkraken/vscode-gitlens/issues/83) - Calling "close unchanged files" results in no new files being openable
- Fixes issues with the zone.js monkey patching done by application insights (telemetry) - disables all the monkey patching
- Fixes issue with _Open Branch in Remote_ & _Open Repository in Remote_ not showing when there are no open editors

## 3.6.1 - 2017-06-07

### Fixed

- Fixes issues with the zone.js monkey patching done by application insights (telemetry) - disables all the monkey patching

## 3.6.0 - 2017-06-02

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

- Fixes [#79](https://github.com/gitkraken/vscode-gitlens/issues/79) - Application insights package breaks GitLens + eslint

## 3.5.1 - 2017-05-25

### Changed

- Changes certain CodeLens actions to be unavailable (unclickable) when the commit referenced is uncommitted - avoids unwanted error messages
- Debounces more events when tracking the active line to further reduce lag

### Fixed

- Fixes [#71](https://github.com/gitkraken/vscode-gitlens/issues/71) - Blame information is invalid when a file has changed outside of vscode
- Fixes issue with showing the incorrect blame for versioned files (i.e. files on the left of a diff, etc)

## 3.5.0 - 2017-05-24

### Added

- Improves performance
  - Reduces the number of git calls on known "untrackables"
  - Caches many more git commands to reduce git command round-trips and parsing
  - Increases the debounce (delay) on cursor movement to reduce lag when navigating around a file
- Adds diff information (the line's previous version) into the active line hover when the current line is uncommitted
- Adds `gitlens.statusBar.alignment` settings to control the alignment of the status bar &mdash; thanks to [PR #72](https://github.com/gitkraken/vscode-gitlens/pull/72) by Zack Schuster ([@zackschuster](https://github.com/zackschuster))!
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

- Fixes [#73](https://github.com/gitkraken/vscode-gitlens/issues/73) - GitLens doesn't work with Chinese filenames
- Fixes [#40](https://github.com/gitkraken/vscode-gitlens/issues/40) - Encoding issues
  - Given the limitations of the vscode api, I'm unable to fix all the encoding issues, but many of them should now be squashed
  - `files.encoding` is now honored for the cases where the encoding cannot currently be gleaned
- Fixes incorrect file selection from the commit details quick pick menu
- Fixes incorrect command execution when using `"gitlens.statusBar.command": "gitlens.showQuickRepoHistory"`
- Fixes a bunch of issues that were revealed by enabling Typescript `strict` mode

## 3.4.9 - 2017-05-03

### Added

- Adds better support for deleted files when choosing _Open Changed Files_ via in quick pick menus - now opens the file revision from the previous commit
- Adds better support for deleted files when using `alt+right arrow` shortcut on the commit details quick pick menu - now opens the file revision from the previous commit

### Changed

- Removes deleted files when choosing _Open Working Changed Files_ via in quick pick menus

## 3.4.8 - 2017-05-02

### Changed

- Changes display name in the marketplace to **Git Lens** because of the marketplace search ranking algorithm

## 3.4.6 - 2017-05-01

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

## 3.4.5 - 2017-04-13

### Added

- Completely overhauls the [GitLens documentation](https://github.com/gitkraken/vscode-gitlens) and messaging &mdash; make sure to check it out to see all the powerful features GitLens provides!
- Adds `gitlens.blame.annotation.activeLineDarkColor` & `gitlens.blame.annotation.activeLineLightColor` settings to control the colors of the active line blame annotation

### Changed

- Changes _Toggle Git CodeLens_ command to work when `gitlens.codeLens.visibility` is set to `auto` (the default)
- Renames _Compare with..._ command to _Compare File with..._
- Renames _Compare with Next Commit_ command to _Compare File with Next Commit_
- Renames _Compare with Previous Commit_ command to _Compare File with Previous Commit_
- Renames _Compare with Previous Commit_ command to _Compare File with Previous Commit_
- Renames _Compare with Working Tree_ command to _Compare File with Working Tree_

### Fixed

- Fixes issue with _Open Commit in Remote_ not working
- Fixes issue with many commands missing from the **Command Palette**

## 3.3.3 - 2017-04-10

### Fixed

- Fixes issue with newlines in commit messages in the file/branch/stash history quick pick menus (truncates and adds an ellipse icon)

## 3.3.2 - 2017-04-10

### Removed

- Removes `gitlens.blame.annotation.characters.*` settings since they were added to deal with unicode bugs in a previous version of vscode

### Fixed

- Closes [#63](https://github.com/gitkraken/vscode-gitlens/issues/63) - Switch commit message and author in commit pick list. Also reduces clutter in the commit quick pick menus

## 3.3.1 - 2017-04-09

### Changed

- Changes commit search prefixes &mdash; no prefix for message search, `@` for author, `:` for file pattern, `#` for commit id
- Changes `sha` terminology to `commit id` in the UI

### Fixed

- Fixes issues with author searching

## 3.3.0 - 2017-04-09

### Added

- Adds _Search commits_ command (`gitlens.showCommitSearch`) to allow commit searching by message, author, file pattern, or sha
- Adds `alt+f` shortcut for the _Search commits_ command (`gitlens.showCommitSearch`)
- Adds _Show Commit Search_ command to the branch history quick pick menu
- Adds _Show Stashed Changes_ command to the repository status quick pick menu
- Adds a _Don't Show Again_ option to the GitLens update notification

### Changed

- Changes _Open x in Remote_ commands to be no longer hidden behind the `gitlens.insiders` setting

### Fixed

- Fixes [#59](https://github.com/gitkraken/vscode-gitlens/issues/59) - Context menu shows gitlens commands even if folder/file is not under git

## 3.2.1

### Fixed

- Fixes [#57](https://github.com/gitkraken/vscode-gitlens/issues/57) - No more blank message if `diff.tool` is missing

## 3.2.0

### Added

- Adds support for single files opened in vscode &mdash; you are no longer required to open a folder for GitLens to work

### Fixed

- Fixes [#57](https://github.com/gitkraken/vscode-gitlens/issues/57) - Warn on directory compare when there is no diff tool configured
- Fixes [#58](https://github.com/gitkraken/vscode-gitlens/issues/58) - Work with git sub-modules
- Fixes issue with _Open \* in Remote_ commands with nested repositories and non-git workspace root folder

## 3.1.0

### Added

- Adds _Show Stashed Changes_ command (`gitlens.showQuickStashList`) to open a quick pick menu of all the stashed changes
- Adds insiders _Stash Changes_ option to stashed changes quick pick menu &mdash; enabled via `"gitlens.insiders": true`
- Adds insiders _Stash Unstaged Changes_ option to stashed changes quick pick menu
- Adds insiders _Apply Stashed Changes_ command (`gitlens.stashApply`) to apply the selected stashed changes to the working tree
- Adds insiders _Stash Changes_ command (`gitlens.stashSave`) to stash any working tree changes

### Fixed

- Fixes incorrect counts in upstream status

## 3.0.5

### Added

- Adds additional insiders support for GitLab, Bitbucket, and Visual Studio Team Services to the _Open x in Remote_ commands and quick pick menus &mdash; enabled via `"gitlens.insiders": true`
- Adds insiders line support to _Open File in Remote_ command (`gitlens.openFileInRemote`)
- Adds original file name for renamed files to the repository status and commit details quick pick menu

### Fixed

- Fixes [#56](https://github.com/gitkraken/vscode-gitlens/issues/56) - Handle file names with spaces

## 3.0.4

### Changed

- Changes telemetry a bit to reduce noise

### Fixed

- Fixes common telemetry error by switching to non-strict iso dates (since they are only available in later git versions)

## 3.0.3

### Added

- Adds a fallback to work with Git version prior to `2.11.0` &mdash; terribly sorry for the inconvenience :(

### Fixed

- Fixes [#55](https://github.com/gitkraken/vscode-gitlens/issues/55) - reverts Git requirement back to `2.2.0`
- Fixes issues with parsing merge commits

## 3.0.2

### Changed

- Changes required Git version to `2.11.0`

## 3.0.1

### Added

- Adds basic telemetry &mdash; honors the vscode telemetry configuration setting

## 3.0.0

### Added

- Adds insiders support for _Open in GitHub_ to the relevant quick pick menus &mdash; enabled via `"gitlens.insiders": true`
- Adds insiders _Open Line Commit in Remote_ command (`gitlens.openCommitInRemote`) to open the current commit in the remote service (currently only GitHub)
- Adds insiders _Open File in Remote_ command (`gitlens.openFileInRemote`) to open the current file in the remote service (currently only GitHub)
- Adds an update notification for feature releases
- Adds _Show Branch History_ command (`gitlens.showQuickBranchHistory`) to show the history of the selected branch
- Adds _Show Last Opened Quick Pick_ command (`gitlens.showLastQuickPick`) to re-open the previously opened quick pick menu - helps to get back to previous context
- Adds `alt+-` shortcut for the _Show Last Opened Quick Pick_ command (`gitlens.showLastQuickPick`)
- Adds upstream status information (if available) to the repository status quick pick
- Adds file status rollup information to the repository status quick pick
- Adds file status rollup information to the commit details quick pick menu
- Adds _Compare with..._ (`gitlens.diffWithBranch`) command to compare working file to another branch (via branch quick pick menu)
- Adds branch quick pick menu to _Directory Compare_ (`gitlens.diffDirectory`) command
- Adds support for `gitlens.showQuickFileHistory` command execution via CodeLens to limit results to the CodeLens block
- Adds current branch to branch quick pick menu placeholder
- Adds _Show Branch History_ command to the branch history quick pick menu when showing only limited commits (e.g. starting at a specified commit)
- Adds _Show File History_ command to the file history quick pick menu when showing only limited commits (e.g. starting at a specified commit)
- Adds _Don't Show Again_ option to the unsupported git version notification

### Changed

- Changes _Show Repository History_ command to _Show Current Branch History_
- Changes _Repository History_ terminology to _Branch History_

### Fixed

- Fixes issue with `gitlens.diffWithPrevious` command execution via CodeLens when the CodeLens was not at the document/file level
- Fixes issue where full shas were displayed on the file/blame history explorers
- Fixes [#30](https://github.com/gitkraken/vscode-gitlens/issues/30) - Diff with Working Tree fails from repo/commit quick pick list if file was renamed (and the commit was before the rename)
- Fixes various other quick pick menu command issues when a file was renamed
- Fixes various issues when caching is disabled
- Fixes issues with parsing commits history
- Fixes various issues with merge commits

## 2.12.2

### Fixed

- Fixes [#50](https://github.com/gitkraken/vscode-gitlens/issues/50) - excludes container-level CodeLens from `html` and `vue` language files

## 2.12.1

### Added

- Adds `gitlens.advanced.codeLens.debug` setting to control whether to show debug information in CodeLens

### Fixed

- Fixes issue where `gitlens.showQuickRepoHistory` command fails to open when there is no active editor

## 2.12.0

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

## 2.11.2

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

- Fixes (#45)[https://github.com/gitkraken/vscode-gitlens/issues/45] - Keyboard Shortcut collision with Project Manager

## 2.11.1

### Added

- Adds blame and active line annotation support to git diff split view (right side)
- Adds command (compare, copy sha/message, etc) support to git diff split view (right side)

### Fixed

- Fixes intermittent issues when toggling whitespace for blame annotations

## 2.11.0

### Added

- Adds `gitlens.showQuickCommitFileDetails` command to show a quick pick menu of details for a file commit
- Adds `gitlens.showQuickCommitFileDetails` command to CodeLens
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

- Fixes [#44](https://github.com/gitkraken/vscode-gitlens/issues/43) by adding a warning message about Git version requirements
- Fixes intermittent errors when adding active line annotations
- Fixes intermittent errors when opening multiple files via quick pick menus

## 2.10.1

### Fixed

- Fixes [#43](https://github.com/gitkraken/vscode-gitlens/issues/43) - File-level CodeLens isn't using the blame of the whole file as it should
- Fixes issue with single quotes (') in annotations
- Fixes output channel logging (also adds more debug information to CodeLens &mdash; when enabled)

## 2.10.0

### Added

- Adds blame and active line annotation support to git diff split view
- Adds command (compare, copy sha/message, etc) support to git diff split view

### Fixed

- Fixes startup failure if caching was disabled
- Fixes missing _Compare Line with Previous Commit_ context menu item
- Fixes [#41](https://github.com/gitkraken/vscode-gitlens/issues/41) - Toggle Blame annotations on compare files page
- Fixes issue with undo (to a saved state) not causing annotations to reappear properly
- Attempts to fix [#42](https://github.com/gitkraken/vscode-gitlens/issues/42) - Cursor on Uncommitted message

## 2.9.0

### Changed

- To accommodate the realization that blame information is invalid when a file has unsaved changes, the following behavior changes have been made
  - Status bar blame information will hide
  - CodeLens change to a `Cannot determine...` message and become unclickable
  - Many menu choices and commands will hide

### Fixed

- Fixes [#38](https://github.com/gitkraken/vscode-gitlens/issues/38) - Toggle Blame Annotation button shows even when it isn't valid
- Fixes [#36](https://github.com/gitkraken/vscode-gitlens/issues/36) - Blame information is invalid when a file has unsaved changes

## 2.8.2

### Added

- Adds `gitlens.blame.annotation.dateFormat` to specify how absolute commit dates will be shown in the blame annotations
- Adds `gitlens.statusBar.date` to specify whether and how the commit date will be shown in the blame status bar
- Adds `gitlens.statusBar.dateFormat` to specify how absolute commit dates will be shown in the blame status bar

### Fixed

- Fixes [#39](https://github.com/gitkraken/vscode-gitlens/issues/39) - Add date format options for status bar blame

## 2.8.1

### Fixed

- Fixes issue where _Compare with \*_ commands fail to open when there is no active editor

## 2.8.0

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

- Fixes [#34](https://github.com/gitkraken/vscode-gitlens/issues/34) - Open file should open the selected version of the file
- Fixes some issue where some editors opened by the quick pick would not be opened in preview tabs
- Fixes issue where copy to clipboard commands would fail if there was no active editor
- Fixes issue where active line annotations would show for opened versioned files
- Fixes issue where CodeLens compare commands on opened versioned files would fail

## 2.7.1

### Added

- Adds proper support for multi-line commit messages

### Fixed

- Fixes [#33](https://github.com/gitkraken/vscode-gitlens/issues/33) - Commit message styled as title in popup, when message starts with hash symbol

## 2.7.0

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

## 2.6.0

### Added

- Adds `gitlens.showQuickRepoStatus` command to show a quick pick menu of files changed including status icons (added, modified, deleted, etc)
- Adds `alt+s` shortcut for the `gitlens.showQuickRepoStatus` command

## 2.5.6

### Fixed

- Fixes [#32](https://github.com/gitkraken/vscode-gitlens/issues/32) - 00000000 Uncommitted changes distracting

## 2.5.5

### Fixed

- Fixes [#25](https://github.com/gitkraken/vscode-gitlens/issues/25) - Blame information isn't updated after git operations (commit, reset, etc)

## 2.5.4

### Fixed

- Fixes extra spacing in annotations

## 2.5.3

### Fixed

- Fixes [#27](https://github.com/gitkraken/vscode-gitlens/issues/27) - Annotations are broken in vscode insider build

## 2.5.2

### Added

- Adds _Open File_ command to `gitlens.showQuickCommitDetails` quick pick menu
- Adds _Open Files_ command to `gitlens.showQuickCommitDetails` quick pick menu
- Improves performance of git-log operations in `gitlens.diffWithPrevious` and `gitlens.diffWithWorking` commands

### Changed

- Changes _Not Committed Yet_ author for uncommitted changes to _Uncommitted_

### Fixed

- Fixes showing `gitlens.showQuickCommitDetails` quick pick menu for uncommitted changes &mdash; now shows the previous commit details

## 2.5.1

### Added

- Adds `gitlens.copyMessageToClipboard` command to copy commit message to the clipboard
- Adds `gitlens.copyMessageToClipboard` to the editor content menu
- Adds _Copy Commit Message to Clipboard_ command to `gitlens.showQuickCommitDetails` quick pick menu

### Changed

- Changes behavior of `gitlens.copyShaToClipboard` to copy the sha of the most recent commit to the repository if there is no active editor
- Changes behavior of `gitlens.showQuickFileHistory` to execute `gitlens.showQuickRepoHistory` if there is no active editor

### Fixed

- Fixes issue where shortcut keys weren't disabled if GitLens was disabled

## 2.5.0

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
- Adds `gitlens.showQuickRepoHistory` and `gitlens.showQuickCommitDetails` commands to CodeLens
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
- Fixes [#31](https://github.com/gitkraken/vscode-gitlens/issues/31) - Disable gitlens if the project does not have `.git` folder
- Fixes issue where quick pick menus could fail if there was no active editor
- Fixes CodeLens not updating in response to configuration changes

## 2.1.1

### Fixed

- Fixes overzealous active line annotation updating on document changes

## 2.1.0

### Added

- Adds a new GitLens logo and changes all images to svg
- Adds `alt+p` shortcut for the `gitlens.diffLineWithPrevious` command
- Adds `shift+alt+p` shortcut for the `gitlens.diffWithPrevious` command
- Adds `alt+w` shortcut for the `gitlens.diffLineWithWorking` command
- Adds `shift+alt+w` shortcut for the `gitlens.diffWithWorking` command
- Adds `gitlens.copyShaToClipboard` command to copy commit sha to the clipboard ([#28](https://github.com/gitkraken/vscode-gitlens/issues/28))
- Adds `gitlens.showQuickCommitDetails` command to show a quick pick menu of details for a commit
- Adds `go back` choice to `gitlens.showQuickCommitDetails`, `gitlens.showQuickFileHistory`, and `gitlens.showQuickRepoHistory` quick pick menus
- Adds `gitlens.blame.annotation.highlight` to specify whether and how to highlight blame annotations ([#24](https://github.com/gitkraken/vscode-gitlens/issues/24))
- Greatly improves performance of line navigation when either active line annotations or status bar blame is enabled

### Fixed

- Fixes [#29](https://github.com/gitkraken/vscode-gitlens/issues/29) - Commit info tooltip duplicated for current line when blame is enabled
- Fixes issue where sometimes the commit history shown wasn't complete
- Fixes issues with `gitlens.diffLineWithPrevious` and `gitlens.diffWithPrevious` not following renames properly
- Fixes issues with `gitlens.diffLineWithPrevious` and `gitlens.diffWithPrevious` not always grabbing the correct commit

## 2.0.2

### Added

- Adds auto-enable of whitespace toggling when using font-ligatures because of [vscode issue](https://github.com/Microsoft/vscode/issues/11485)
- Adds `gitlens.blame.annotation.characters.*` settings to provide some control over how annotations are displayed

### Fixed

- Fixes [#22](https://github.com/gitkraken/vscode-gitlens/issues/22) - Cannot read property 'sha' of undefined

## 2.0.1

### Fixed

- Fixes [#26](https://github.com/gitkraken/vscode-gitlens/issues/26) - Active line annotation doesn't disappear properly after delete

## 2.0.0

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
- Fixes issue where CodeLens aren't updated properly after a file is saved

## 1.4.3

### Added

- Adds some logging to hopefully trap [#22](https://github.com/gitkraken/vscode-gitlens/issues/22) - Cannot read property 'sha' of undefined

### Fixed

- Fixes issue with the latest insiders build (1.9.0-insider f67f87c5498d9361c0b29781c341fd032815314b) where there is a collision of document schemes

## 1.4.2

### Fixed

- Fixes issue where file history wouldn't compare correctly to working tree if the filename had changed

## 1.4.1

### Added

- Adds `gitlens.advanced.gitignore.enabled` to enable/disable .gitignore parsing. Addresses [#20](https://github.com/gitkraken/vscode-gitlens/issues/20) - Nested .gitignore files can cause blame to fail with a repo within another repo

## 1.4.0

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

## 1.3.1

### Added

- Adds _Diff Commit with Working Tree_ to the explorer context menu (assuming `gitlens.menus.fileDiff.enabled` is `true`)
- Adds _Diff Commit with Working Tree_ & _Diff Commit with Previous_ to the editor title context menu (assuming `gitlens.menus.fileDiff.enabled` is `true`)

### Changed

- Renames _Diff_ commands for better clarity
- Removes _Git_ from the commands as it feels unnecessary
- Reorders the context menu commands

## 1.3.0

### Added

- Adds support for blame and history (log) on files opened via compare commands &mdash; allows for deep navigation through git history

## 1.2.0

### Added

- Adds compare (working vs previous) options to repository history
- Adds compare (working vs previous) options to file history

### Fixed

- Fixes issue with repository history compare with commits with multiple files

## 1.1.1

### Added

- Adds logging for tracking [#18](https://github.com/gitkraken/vscode-gitlens/issues/18) - GitLens only displayed for some files

### Changed

- Changes `gitlens.showQuickRepoHistory` command to run without an open editor (falls back to the folder repository)

## 1.1.0

### Added

- Adds new `gitlens.showQuickFileHistory` command to show the file history in a quick-pick list (palette)
- Adds new `gitlens.showQuickRepoHistory` command to show the repository history in a quick-pick list (palette)
- Adds `gitlens.showQuickFileHistory` option to the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings

### Changed

- Changes the `gitlens.statusBar.command` settings default to `gitlens.showQuickFileHistory` instead of `gitlens.toggleBlame`

### Removed

- Removes `git.viewFileHistory` option from the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings

## 1.0.2

### Fixed

- Fixes [#16](https://github.com/gitkraken/vscode-gitlens/issues/16) - incorrect 'Unable to find Git' message

## 1.0.0

### Added

- Adds support for git history (log)!
- Adds support for blame annotations and git commands on file revisions
- Adds ability to show multiple blame annotation at the same time (one per vscode editor)
- Adds new `gitlens.showFileHistory` command to open the history explorer
- Adds new `gitlens.showFileHistory` option to the `gitlens.codeLens.recentChange.command`, `gitlens.codeLens.authors.command`, and `gitlens.statusBar.command` settings
- Adds per-language CodeLens location customization using the `gitlens.codeLens.languageLocations` setting
- Adds new `gitlens.diffLineWithPrevious` command for line sensitive diffs
- Adds new `gitlens.diffLineWithWorking` command for line sensitive diffs
- Adds `gitlens.diffWithPrevious` command to the explorer context menu
- Adds output channel logging, controlled by the `gitlens.advanced.output.level` setting
- Improves performance of the CodeLens support
- Improves performance (significantly) when only showing CodeLens at the document level
- Improves performance of status bar blame support

### Changed

- Switches on-demand CodeLens to be a global toggle (rather than per file)
- Complete rewrite of the blame annotation provider to reduce overhead and provide better performance
- Changes `gitlens.diffWithPrevious` command to always be file sensitive diffs
- Changes `gitlens.diffWithWorking` command to always be file sensitive diffs
- Removes all debug logging, unless the `gitlens.advanced.debug` settings it on

### Fixed

- Fixes many (most?) issues with whitespace toggling (required because of https://github.com/Microsoft/vscode/issues/11485)
- Fixes issue where blame annotations would not be cleared properly when switching between open files

## 0.5.5

### Fixed

- Fixes another off-by-one issue when diffing with caching

## 0.5.4

### Fixed

- Fixes off-by-one issues with blame annotations without caching and when diffing with a previous version

## 0.5.3

### Added

- Adds better uncommitted hover message in blame annotations
- Adds more protection for dealing with uncommitted lines

## 0.5.2

### Fixed

- Fixes loading issue on Linux

## 0.5.1

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

## 0.3.3

### Fixed

- Fixes [#7](https://github.com/gitkraken/vscode-gitlens/issues/7) - missing spawn-rx dependency (argh!)

## 0.3.2

### Fixed

- Fixes [#7](https://github.com/gitkraken/vscode-gitlens/issues/7) - missing lodash dependency

## 0.3.1

### Added

- Adds new CodeLens visibility & location settings &mdash; see **Extension Settings** for details
- Adds new command to toggle CodeLens on and off when `gitlens.codeLens.visibility` is set to `ondemand`

## 0.2.0

### Changed

- Replaces blame regex parsing with a more robust parser

### Fixed

- Fixes [#1](https://github.com/gitkraken/vscode-gitlens/issues/1) - Support blame on files outside the workspace repository
- Fixes failures with Diff with Previous command
- Fixes issues with blame explorer CodeLens when dealing with previous commits
- Fixes display issues with compact blame annotations (now skips blank lines)

## 0.1.3

### Added

- Improved blame annotations, now with sha and author by default
- Add new blame annotation styles &mdash; compact and expanded (default)
- Adds many new configuration settings; see **Extension Settings** for details

## 0.0.7

### Added

- Adds .gitignore checks to reduce the number of blame calls

### Fixed

- Fixes [#4](https://github.com/gitkraken/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash (Really!)
- Fixes [#5](https://github.com/gitkraken/vscode-gitlens/issues/5) - Finding first non-white-space fails sometimes

## 0.0.6

### Added

- Adds attempt to scroll to the correct position when opening a diff

### Fixed

- Fixes [#2](https://github.com/gitkraken/vscode-gitlens/issues/2) - [request] Provide some debug info when things fail
- Fixes [#4](https://github.com/gitkraken/vscode-gitlens/issues/4) - Absolute paths fail on Windows due to backslash

## 0.0.5

### Changed

- Removes CodeLens from fields and single-line properties to reduce visual noise
- Automatically turns off blame only when required now

### Fixed

- Fixes issues where filename changes in history would cause diffs to fails
- Fixes some issues with uncommitted blames

## 0.0.4

### Added

- Candidate for preview release on the vscode marketplace.

## 0.0.1

### Added

- Initial release but still heavily a work in progress.

[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/v16.1.1...HEAD
[16.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v16.1.0...gitkraken:v16.1.1
[16.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v16.0.4...gitkraken:v16.1.0
[16.0.4]: https://github.com/gitkraken/vscode-gitlens/compare/v16.0.3...gitkraken:v16.0.4
[16.0.3]: https://github.com/gitkraken/vscode-gitlens/compare/v16.0.2...gitkraken:v16.0.3
[16.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v16.0.1...gitkraken:v16.0.2
[16.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v16.0.0...gitkraken:v16.0.1
[16.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.6.3...gitkraken:v16.0.0
[15.6.3]: https://github.com/gitkraken/vscode-gitlens/compare/v15.6.2...gitkraken:v15.6.3
[15.6.2]: https://github.com/gitkraken/vscode-gitlens/compare/v15.6.1...gitkraken:v15.6.2
[15.6.1]: https://github.com/gitkraken/vscode-gitlens/compare/v15.6.0...gitkraken:v15.6.1
[15.6.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.5.1...gitkraken:v15.6.0
[15.5.1]: https://github.com/gitkraken/vscode-gitlens/compare/v15.5.0...gitkraken:v15.5.1
[15.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.4.0...gitkraken:v15.5.0
[15.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.3.1...gitkraken:v15.4.0
[15.3.1]: https://github.com/gitkraken/vscode-gitlens/compare/v15.3.0...gitkraken:v15.3.1
[15.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.2.3...gitkraken:v15.3.0
[15.2.3]: https://github.com/gitkraken/vscode-gitlens/compare/v15.2.2...gitkraken:v15.2.3
[15.2.2]: https://github.com/gitkraken/vscode-gitlens/compare/v15.2.1...gitkraken:v15.2.2
[15.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v15.2.0...gitkraken:v15.2.1
[15.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.1.0...gitkraken:v15.2.0
[15.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v15.0.4...gitkraken:v15.1.0
[15.0.4]: https://github.com/gitkraken/vscode-gitlens/compare/v15.0.3...gitkraken:v15.0.4
[15.0.3]: https://github.com/gitkraken/vscode-gitlens/compare/v15.0.2...gitkraken:v15.0.3
[15.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v15.0.1...gitkraken:v15.0.2
[15.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v15.0.0...gitkraken:v15.0.1
[15.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.9.0...gitkraken:v15.0.0
[14.9.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.8.2...gitkraken:v14.9.0
[14.8.2]: https://github.com/gitkraken/vscode-gitlens/compare/v14.8.1...gitkraken:v14.8.2
[14.8.1]: https://github.com/gitkraken/vscode-gitlens/compare/v14.8.0...gitkraken:v14.8.1
[14.8.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.7.0...gitkraken:v14.8.0
[14.7.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.6.1...gitkraken:v14.7.0
[14.6.1]: https://github.com/gitkraken/vscode-gitlens/compare/v14.6.0...gitkraken:v14.6.1
[14.6.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.5.1...gitkraken:v14.6.0
[14.5.1]: https://github.com/gitkraken/vscode-gitlens/compare/v14.5.0...gitkraken:v14.5.1
[14.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.4.0...gitkraken:v14.5.0
[14.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.3.0...gitkraken:v14.4.0
[14.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.2.1...gitkraken:v14.3.0
[14.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v14.2.0...gitkraken:v14.2.1
[14.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.1.1...gitkraken:v14.2.0
[14.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v14.1.0...gitkraken:v14.1.1
[14.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v14.0.1...gitkraken:v14.1.0
[14.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v14.0.0...gitkraken:v14.0.1
[14.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.6.0...gitkraken:v14.0.0
[13.6.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.5.0...gitkraken:v13.6.0
[13.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.4.0...gitkraken:v13.5.0
[13.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.3.2...gitkraken:v13.4.0
[13.3.2]: https://github.com/gitkraken/vscode-gitlens/compare/v13.3.1...gitkraken:v13.3.2
[13.3.1]: https://github.com/gitkraken/vscode-gitlens/compare/v13.3.0...gitkraken:v13.3.1
[13.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.2.0...gitkraken:v13.3.0
[13.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.1.1...gitkraken:v13.2.0
[13.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v13.1.0...gitkraken:v13.1.1
[13.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v13.0.4...gitkraken:v13.1.0
[13.0.4]: https://github.com/gitkraken/vscode-gitlens/compare/v13.0.3...gitkraken:v13.0.4
[13.0.3]: https://github.com/gitkraken/vscode-gitlens/compare/v13.0.2...gitkraken:v13.0.3
[13.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v12.2.2...gitkraken:v13.0.2
[12.2.2]: https://github.com/gitkraken/vscode-gitlens/compare/v12.2.1...gitkraken:v12.2.2
[12.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v12.2.0...gitkraken:v12.2.1
[12.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v12.1.2...gitkraken:v12.2.0
[12.1.2]: https://github.com/gitkraken/vscode-gitlens/compare/v12.1.1...gitkraken:v12.1.2
[12.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v12.1.0...gitkraken:v12.1.1
[12.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.7...gitkraken:v12.1.0
[12.0.6]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.6...gitkraken:v12.0.7
[12.0.6]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.5...gitkraken:v12.0.6
[12.0.5]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.4...gitkraken:v12.0.5
[12.0.4]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.3...gitkraken:v12.0.4
[12.0.3]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.2...gitkraken:v12.0.3
[12.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.1...gitkraken:v12.0.2
[12.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v12.0.0...gitkraken:v12.0.1
[12.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.7.0...gitkraken:v12.0.0
[11.7.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.6.1...gitkraken:v11.7.0
[11.6.1]: https://github.com/gitkraken/vscode-gitlens/compare/v11.6.0...gitkraken:v11.6.1
[11.6.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.5.1...gitkraken:v11.6.0
[11.5.1]: https://github.com/gitkraken/vscode-gitlens/compare/v11.5.0...gitkraken:v11.5.1
[11.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.4.0...gitkraken:v11.5.0
[11.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.3.0...gitkraken:v11.4.0
[11.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.2.1...gitkraken:v11.3.0
[11.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v11.2.0...gitkraken:v11.2.1
[11.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v11.1.3...gitkraken:v11.2.0
[11.1.3]: https://github.com/gitkraken/vscode-gitlens/compare/v11.1.2...gitkraken:v11.1.3
[11.1.2]: https://github.com/gitkraken/vscode-gitlens/compare/v11.1.1...gitkraken:v11.1.2
[11.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.6...gitkraken:v11.1.1
[11.0.6]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.5...gitkraken:v11.0.6
[11.0.5]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.4...gitkraken:v11.0.5
[11.0.4]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.3...gitkraken:v11.0.4
[11.0.3]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.2...gitkraken:v11.0.3
[11.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.1...gitkraken:v11.0.2
[11.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v11.0.0...gitkraken:v11.0.1
[11.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v10.2.2...gitkraken:v11.0.0
[10.2.2]: https://github.com/gitkraken/vscode-gitlens/compare/v10.2.1...gitkraken:v10.2.2
[10.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v10.2.0...gitkraken:v10.2.1
[10.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v10.1.2...gitkraken:v10.2.0
[10.1.2]: https://github.com/gitkraken/vscode-gitlens/compare/v10.1.1...gitkraken:v10.1.2
[10.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v10.1.0...gitkraken:v10.1.1
[10.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v10.0.1...gitkraken:v10.1.0
[10.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v10.0.0...gitkraken:v10.0.1
[10.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.9.3...gitkraken:v10.0.0
[9.9.3]: https://github.com/gitkraken/vscode-gitlens/compare/v9.9.2...gitkraken:v9.9.3
[9.9.2]: https://github.com/gitkraken/vscode-gitlens/compare/v9.9.1...gitkraken:v9.9.2
[9.9.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.9.0...gitkraken:v9.9.1
[9.9.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.8.5...gitkraken:v9.9.0
[9.8.5]: https://github.com/gitkraken/vscode-gitlens/compare/v9.8.4...gitkraken:v9.8.5
[9.8.4]: https://github.com/gitkraken/vscode-gitlens/compare/v9.8.3...gitkraken:v9.8.4
[9.8.3]: https://github.com/gitkraken/vscode-gitlens/compare/v9.8.2...gitkraken:v9.8.3
[9.8.2]: https://github.com/gitkraken/vscode-gitlens/compare/v9.8.1...gitkraken:v9.8.2
[9.8.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.8.0...gitkraken:v9.8.1
[9.8.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.7.4...gitkraken:v9.8.0
[9.7.4]: https://github.com/gitkraken/vscode-gitlens/compare/v9.7.3...gitkraken:v9.7.4
[9.7.3]: https://github.com/gitkraken/vscode-gitlens/compare/v9.7.2...gitkraken:v9.7.3
[9.7.2]: https://github.com/gitkraken/vscode-gitlens/compare/v9.7.1...gitkraken:v9.7.2
[9.7.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.7.0...gitkraken:v9.7.1
[9.7.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.6.3...gitkraken:v9.7.0
[9.6.3]: https://github.com/gitkraken/vscode-gitlens/compare/v9.6.2...gitkraken:v9.6.3
[9.6.2]: https://github.com/gitkraken/vscode-gitlens/compare/v9.6.1...gitkraken:v9.6.2
[9.6.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.6.0...gitkraken:v9.6.1
[9.6.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.5.1...gitkraken:v9.6.0
[9.5.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.5.0...gitkraken:v9.5.1
[9.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.4.1...gitkraken:v9.5.0
[9.4.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.4.0...gitkraken:v9.4.1
[9.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.3.0...gitkraken:v9.4.0
[9.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.2.4...gitkraken:v9.3.0
[9.2.4]: https://github.com/gitkraken/vscode-gitlens/compare/v9.2.3...gitkraken:v9.2.4
[9.2.3]: https://github.com/gitkraken/vscode-gitlens/compare/v9.2.2...gitkraken:v9.2.3
[9.2.2]: https://github.com/gitkraken/vscode-gitlens/compare/v9.2.1...gitkraken:v9.2.2
[9.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.2.0...gitkraken:v9.2.1
[9.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.1.0...gitkraken:v9.2.0
[9.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v9.0.3...gitkraken:v9.1.0
[9.0.3]: https://github.com/gitkraken/vscode-gitlens/compare/v9.0.2...gitkraken:v9.0.3
[9.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v9.0.1...gitkraken:v9.0.2
[9.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v9.0.0...gitkraken:v9.0.1
[9.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.6...gitkraken:v9.0.0
[8.5.6]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.5...gitkraken:v8.5.6
[8.5.5]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.4...gitkraken:v8.5.5
[8.5.4]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.3...gitkraken:v8.5.4
[8.5.3]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.2...gitkraken:v8.5.3
[8.5.2]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.1...gitkraken:v8.5.2
[8.5.1]: https://github.com/gitkraken/vscode-gitlens/compare/v8.5.0...gitkraken:v8.5.1
[8.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v8.4.1...gitkraken:v8.5.0
[8.4.1]: https://github.com/gitkraken/vscode-gitlens/compare/v8.4.0...gitkraken:v8.4.1
[8.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v8.3.5...gitkraken:v8.4.0
[8.3.5]: https://github.com/gitkraken/vscode-gitlens/compare/v8.3.4...gitkraken:v8.3.5
[8.3.4]: https://github.com/gitkraken/vscode-gitlens/compare/v8.3.3...gitkraken:v8.3.4
[8.3.3]: https://github.com/gitkraken/vscode-gitlens/compare/v8.3.2...gitkraken:v8.3.3
[8.3.2]: https://github.com/gitkraken/vscode-gitlens/compare/8.3.1...gitkraken:v8.3.2
[8.3.1]: https://github.com/gitkraken/vscode-gitlens/compare/v8.3.0...gitkraken:8.3.1
[8.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v8.2.4...gitkraken:v8.3.0
[8.2.4]: https://github.com/gitkraken/vscode-gitlens/compare/v8.2.3...gitkraken:v8.2.4
[8.2.3]: https://github.com/gitkraken/vscode-gitlens/compare/v8.2.2...gitkraken:v8.2.3
[8.2.2]: https://github.com/gitkraken/vscode-gitlens/compare/v8.2.1...gitkraken:v8.2.2
[8.2.1]: https://github.com/gitkraken/vscode-gitlens/compare/v8.2.0...gitkraken:v8.2.1
[8.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v8.1.1...gitkraken:v8.2.0
[8.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v8.1.0...gitkraken:v8.1.1
[8.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v8.0.2...gitkraken:v8.1.0
[8.0.2]: https://github.com/gitkraken/vscode-gitlens/compare/v8.0.1...gitkraken:v8.0.2
[8.0.1]: https://github.com/gitkraken/vscode-gitlens/compare/v8.0.0...gitkraken:v8.0.1
[8.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.10...gitkraken:v8.0.0
[7.5.10]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.9...gitkraken:v7.5.10
[7.5.9]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.8...gitkraken:v7.5.9
[7.5.8]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.7...gitkraken:v7.5.8
[7.5.7]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.6...gitkraken:v7.5.7
[7.5.6]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.5...gitkraken:v7.5.6
[7.5.5]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.4...gitkraken:v7.5.5
[7.5.4]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.3...gitkraken:v7.5.4
[7.5.3]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.2...gitkraken:v7.5.3
[7.5.2]: https://github.com/gitkraken/vscode-gitlens/compare/v7.5.1...gitkraken:v7.5.2
[7.5.1]: https://github.com/gitkraken/vscode-gitlens/compare/v7.2.0...gitkraken:v7.5.1
[7.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v7.1.0...gitkraken:v7.2.0
[7.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v7.0.0...gitkraken:v7.1.0
[7.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v6.4.0...gitkraken:v7.0.0
[6.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v6.3.0...gitkraken:v6.4.0
[6.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v6.2.0...gitkraken:v6.3.0
[6.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v6.1.2...gitkraken:v6.2.0
[6.1.2]: https://github.com/gitkraken/vscode-gitlens/compare/v6.1.1...gitkraken:v6.1.2
[6.1.1]: https://github.com/gitkraken/vscode-gitlens/compare/v6.1.0...gitkraken:v6.1.1
[6.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v6.0.0...gitkraken:v6.1.0
[6.0.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.7.1...gitkraken:v6.0.0
[5.7.1]: https://github.com/gitkraken/vscode-gitlens/compare/v5.7.0...gitkraken:v5.7.1
[5.7.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.6.5...gitkraken:v5.7.0
[5.6.5]: https://github.com/gitkraken/vscode-gitlens/compare/v5.6.4...gitkraken:v5.6.5
[5.6.4]: https://github.com/gitkraken/vscode-gitlens/compare/v5.6.3...gitkraken:v5.6.4
[5.6.3]: https://github.com/gitkraken/vscode-gitlens/compare/v5.6.2...gitkraken:v5.6.3
[5.6.2]: https://github.com/gitkraken/vscode-gitlens/compare/v5.6.1...gitkraken:v5.6.2
[5.6.1]: https://github.com/gitkraken/vscode-gitlens/compare/v5.6.0...gitkraken:v5.6.1
[5.6.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.5.0...gitkraken:v5.6.0
[5.5.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.4.0...gitkraken:v5.5.0
[5.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.3.0...gitkraken:v5.4.0
[5.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.2.0...gitkraken:v5.3.0
[5.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.1.0...gitkraken:v5.2.0
[5.1.0]: https://github.com/gitkraken/vscode-gitlens/compare/v5.0.0...gitkraken:v5.1.0
