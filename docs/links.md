# Supported Links into GitLens

This document covers the various VSCode link formats that work with GitLens, along with their formats, parameters and descriptions.

## Contents

### Repository Items

- [Repository](#repository 'Jump to Repository')
- [Branch](#branch 'Jump to Branch')
- [Commit](#commit 'Jump to Commit')
- [Tag](#tag 'Jump to Tag')
- [Comparison](#comparison 'Jump to Comparison')
- [File/Lines](#filelines 'Jump to File/Lines')

### GitKraken Cloud Items

- [Cloud Patch/Code Suggestion](#cloud-patchcode-suggestion 'Jump to Cloud Patch/Code Suggestion')
- [Cloud Workspace](#cloud-workspace 'Jump to Cloud Workspace')

### GitKraken Account Links

- [Login](#login 'Jump to Login')

### Other Links

- [Command](#command 'Jump to Command')

## Notation

The following are used in link notation in this document:

- _[option1|option2]_ notation means that either _option1_ or _option2_ can be used in the deep link. The actual deep link does not include the _[]_ or the _|_ symbols.

- _(contents)_ notation means that the _contents_ within the _()_ are optional in the deep link. The actual deep link does not include the _()_ symbols if the contents are included.

- _{reference}_ is a short-form reference to some content previously defined in the document. For example, if we define _branchLink_ as _b_ and _prefix_ as _vscode://eamodio.gitlens/link_, then the notation _{prefix}/{branchLink}_ is short-form for _vscode://eamodio.gitlens/link/b_. The reference name and _{}_ should not be included in the link.

## Repository Item Deep Links

### Common References

- _{prefix}_ = _vscode://eamodio.gitlens/link_

- _{remoteUrl}_ is the pull URL of a git remote, including the .git part. You can see this url when, for example, choosing “Clone” on the repo’s/remote’s page in GitHub.

- _{repoPath}_ is the local disk path to a git remote on the link creator’s machine.

- _{repoId}_ is the first commit SHA of the repo (the full SHA, not just the short version). This field is not required to locate the repo (remote url or repo path can be used, one of which should also be on the link). If it is not known, the value should be set to _-_.

- _{baseQuery}_ = _[url={remoteUrl}|path={repoPath}]_

### Notes

- **Repository Matching**: To find a matching repository in repo item deep links, we first check the list of GitLens' known/open repositories in state. We use the repo’s disk path first, if provided, and then the remote URL, if provided, and then the repo ID (first commit SHA), if provided, to find a match within this list. If no matches are found, we check the shared GK folder on the user’s machine to match against the remote URL provided. This shared folder contains a mapping of remote URL to disk path on machine. If matches are found there, we offer the user the option to open one of those matching repos in a prompt.

- **Remote URL**: Make sure you set a remote url on the deep link in which the target the link is pointing to exists.

### Repository

#### Description

Used to open a (remote) repository in GitLens. Once the repository is opened, the Commit Graph will open to that repository.

#### Format

_{prefix}/r/{repoId}?{baseQuery}_

#### Example Usage

Right click a remote in the Remotes view and choose "Share -> Copy Link to Repository", and share with a teammate. When they access the link, GitLens will help them clone the repository, open it in GitLens, add the remote you linked, and open the Commit Graph to the repository, step-by-step.

### Branch

#### Description

Used to open a (remote) branch in GitLens. Once the branch's repository is opened, GitLens will open the Commit Graph to that repository and select the branch, or perform another action if specified (see _{action}_ in _References_ below).

#### Format

_{prefix}/r/{repoId}/b/{branchName}?{baseQuery}(&action={action})_

#### References

- _{branchName}_ is the name of the branch. Note that the remote name should not be included. Instead, _{remoteUrl}_ is used to determine the remote for the branch. So if the branch _test_ is located on _origin_, for example, _{branchName}_ should just be _test_ and the remote url of _origin_ should be used for the _{remoteUrl}_ parameter. You should not set _{branchName}_ to _origin/test_ in this example.

- _{action}_ is an optional query parameter that represents the action to take on the branch target. By default, the action on all repository item deep links, including branch deep links, is to open the commit graph and select the row pertaining to the item. This parameter allows the link to complete other actions instead:

  - _switch_: Switch to the branch (with options to checkout, create a new local branch if desired, or create/open a worktree).

  - _switch-to-pr_: Does everything that the _switch_ action does, but also opens the inspect overview, which contains details about pull requests related to the branch.

  - _switch-to-and-suggest-pr_: Does everything that the _switch-to-pr_ action does, but also opens the form to submit a new code suggestion.

  - _switch-to-pr-worktree_: Does everything that the _switch-to-pr_ action does, but always chooses to open the branch in a worktree, creating a new one if needed and creating a new local branch if needed. For creating the local branch and worktree, default options are chosen. The worktree is then opened in a new window.

#### Example Usage

Right click a branch in the Commit Graph and choose "Share -> Copy Link to Branch", select a remote to copy the branch for, and share with a teammate. When they access the link, GitLens will help them clone the repository, open it in GitLens, add the remote you linked, and open the Commit Graph to the branch, step-by-step.

### Commit

#### Description

Used to open a (remote) commit in GitLens. Once the commit's repository is opened, GitLens will open the Commit Graph to that repository and select the commit.

#### Format

_{prefix}/r/{repoId}/c/{commitSha}?{baseQuery}_

#### References

- _{commitSha}_ is the full SHA of the commit.

#### Example Usage

Right click a commit in the Commit Graph and choose "Share -> Copy Link to Commit", select a remote to copy the commit for, and share with a teammate. When they access the link, GitLens will help them clone the repository, open it in GitLens, add the remote you linked, and open the Commit Graph to the commit, step-by-step.

### Tag

#### Description

Used to open a (remote) tag in GitLens. Once the tag's repository is opened, GitLens will open the Commit Graph to that repository and select the tag.

#### Format

_{prefix}/r/{repoId}/t/{tagName}?{baseQuery}_

#### References

- _{tagName}_ is the name of the tag. Note that the remote name should not be included. Instead, _{remoteUrl}_ is used to determine the remote for the tag. So if the tag _15.2.0_ is located on _origin_, for example, _{tagName}_ should just be _15.2.0_ and the remote url of _origin_ should be used for the _{remoteUrl}_ parameter. You should not set _{tagName}_ to _origin/15.2.0_ in this example.

#### Example Usage

Right click a tag in the Tags View and choose "Share -> Copy Link to Tag", select a remote to copy the tag for, and share with a teammate. When they access the link, GitLens will help them clone the repository, open it in GitLens, add the remote you linked, and open the Commit Graph to the tag, step-by-step.

### Comparison

#### Description

Used to open a comparison between two references in the _Search & Compare_ view.

#### Format

_{prefix}/r/{repoId}/compare/{ref1}[..|...]{ref2}?{baseQuery}(&prRepoUrl={prRepoUrl})_

#### References

- _{ref1}_ and _{ref2}_ are the two refs to compare, in reverse order i.e. GitLens will compare _{ref2}_ to _{ref1}_ in the _Search & Compare_ view. These refs can be a branch name, tag name, or commit SHA. A blank ref means “working tree”. Both refs cannot be blank.

- _{prRepoUrl}_ is an optional parameter, generally used for Pull Request comparisons, representing the pull URL of the git remote that represents the head commit of the Pull Request. It is formatted similar to _{remoteUrl}_, so see Common References section above to learn how to format it.

#### Example Usage

Share the changes of a pull request by right clicking the pull request's branch in the Commit Graph and choose "Compare with Common Base". The changes should be opened in the _Search & Compare_ view. Right click the Comparison item in the _Search & Compare_ view and choose "Share -> Copy Link to Comparison", and choose a remote to copy the comparison for. Share the link with a teammate. When they access the link, GitLens will help them clone the repository, open it in GitLens, add the remote, and open the _Search & Compare_ view to the pull request's changes, step-by-step.

### File/Lines

#### Description

Used to open a repository to a file, or specific lines of code within a file. Can open a file at a particular reference point or target the working copy of the file. Will highlight the specified lines of code if included.

#### Format

_{prefix}/r/{repoId}/f/{filePath}?{baseQuery}(&lines={lines})(&ref={ref})_

#### References

- _{filePath}_ is the path to the file relative to the root of the repo (such as _src/stuff.md_).

- _{lines}_ is an optional parameter representing the lines of code, and can be a single number or two separated by a dash.

- _{ref}_ is an optional parameter representing the ref at which the file is referenced. Can be a branch name or tag name, fully qualified ref like _refs/tags/…_ or a commit SHA/revision. If this is not supplied, the link points to the working version of the file.

#### Example Usage

To guide a teammate to a specific line of code, right click the line in the editor and choose "Share -> Copy Link to Code". Then choose which remote to target. If you prefer to target a block of code or multiple lines, highlight the lines and then right click the highlighted code and choose "Copy As -> Copy Link to Code". Then share the link with a teammate. When they access the link, GitLens will help them clone the repository, open it in GitLens, add the remote, and open the file to the specified lines of code, step-by-step.

## GitKraken Cloud Item Deep Links

### Common References

- _{prefix}_ = _vscode://eamodio.gitlens/link_

### Notes

- Accessing these deep links requires a GitKraken account.

### Cloud Patch/Code Suggestion

#### Description

Used to open a cloud patch or code suggestion in GitLens.

#### Format

_{prefix}/drafts/{draftId}(?patch={patchId})(&type=suggested_pr_change&prEntityId={prEntityId})_

#### References

- _{draftId}_ is the ID of the cloud patch.

- _{patchId}_ is an optional query parameter used to access a specific revision/patch within the cloud patch. If not set, the most recent is used.

- _type=suggested_pr_change&prEntityId={prEntityId}_ should be included in the query for deep links to code suggestions. These parameters should not be included for standard cloud patch links.

  - _{prEntityId}_ refers to the GK entity identifier for the Pull Request related to the code suggestion.

#### Example Usage

When you create a cloud patch from the _Cloud Patches_ view, you will receive a notification that the cloud patch has been successfully created. On that notification is a "Copy Link" button. Click it to copy a link to the cloud patch to your clipboard. Share the link with a teammate (ensure that the teammate has access based on the permissions/visibility you set for the cloud patch). When they access the link, GitLens will help them open the cloud patch in GitLens and view the patch changes, and even apply the changes to their local repository.

### Cloud Workspace

#### Description

Used to open a cloud workspace in GitLens.

#### Format

_{prefix}/workspace/{workspaceId}_

#### References

- _{workspaceId}_ is the ID of the cloud workspace.

#### Example Usage

Right click a cloud workspace in the _Cloud Workspaces_ view and choose "Share -> Copy Link to Workspace". Use this link to open the view to the chosen workspace in GitLens.

## GitKraken Account Links

### Login

#### Description

Used to log in to a GitKraken account from GitLens.

#### Format

_vscode://eamodio.gitlens/login?code={code}(&state={state})(&context={context})_

#### References

- _{code}_ is an exchange code used to authenticate the user with GitKraken’s API.

- _{state}_ is an optional parameter representing the state used to retrieve the code, if applicable. If a state was used to retrieve the code, it must be included in the link or the login will fail.

- _{context}_ is an optional parameter representing the context of the login. Currently supported values include:

  - _start_trial_ - Log in to start a Pro trial.

#### Example Usage

External sources, such as GitKraken web pages, can use these links internally to get you into GitLens and logged in to your GitKraken account.

## Other Links

### Command

#### Description

Used to run a GitLens command.

#### Format

_{prefix}/command/{command}_

#### References

- _{command}_ is the name of the command to run. Currently supported values include:

  - _cloud-patches_ - Runs the `GitLens: Show Cloud Patches View` command.

  - _graph_ - Runs the `GitLens: Show Graph` command.

  - _home_ - Runs the `GitLens: Show Home View` command.

  - _inspect_ - Runs the `GitLens: Inspect Commit Details` command.

  - _launchpad_ - Runs the `GitLens: Show Launchpad` command.

  - _walkthrough_ - Runs the `GitLens: Get Started` command.

  - _worktrees_ - Runs the `GitLens: Show Worktrees View` command.

#### Example Usage

External sources, such as GitKraken web pages, can use these links to directly run a GitLens command - for example, to show the Launchpad.
