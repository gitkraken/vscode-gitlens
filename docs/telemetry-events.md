# GitLens Telemetry

> This is a generated file. Do not edit.

## Global Attributes

> Global attributes are sent (if available) with every telemetry event

```typescript
{
  'global.cloudIntegrations.connected.count': number,
  'global.cloudIntegrations.connected.ids': string,
  'global.debugging': false | true,
  'global.enabled': false | true,
  'global.prerelease': false | true,
  'global.install': false | true,
  'global.upgrade': false | true,
  'global.upgradedFrom': string,
  'global.folders.count': number,
  'global.folders.schemes': string,
  'global.providers.count': number,
  'global.providers.ids': string,
  'global.repositories.count': number,
  'global.repositories.hasRemotes': false | true,
  'global.repositories.hasRichRemotes': false | true,
  'global.repositories.hasConnectedRemotes': false | true,
  'global.repositories.withRemotes': number,
  'global.repositories.withHostingIntegrations': number,
  'global.repositories.withHostingIntegrationsConnected': number,
  'global.repositories.remoteProviders': string,
  'global.repositories.schemes': string,
  'global.repositories.visibility': 'private' | 'public' | 'local' | 'mixed',
  'global.workspace.isTrusted': false | true,
  'global.subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'global.subscription.status': 'verification' | 'free' | 'preview' | 'preview-expired' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
}
```

## Events

### account/validation/failed

> Sent when account validation fails

```typescript
{
  'account.id': string,
  'exception': string,
  'code': string,
  'statusCode': string
}
```

### activate

> Sent when GitLens is activated

```typescript
{
  'activation.elapsed': number,
  'activation.mode': string
}
```

### ai/explain

> Sent when explaining changes from wip, commits, stashes, patches,etc.

```typescript
{
  'type': 'change',
  'changeType': 'wip' | 'stash' | 'commit' | 'draft-stash' | 'draft-patch' | 'draft-suggested_pr_change',
  'model.id': 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-16k' | 'claude-instant-1' | 'claude-2' | 'claude-2.1' | 'claude-3-opus-20240229' | 'claude-3-sonnet-20240229' | 'claude-3-5-sonnet-20240620' | 'claude-3-haiku-20240307' | 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest' | `${string}:${string}`,
  'model.provider.id': 'openai' | 'anthropic' | 'gemini' | 'vscode',
  'model.provider.name': string,
  'retry.count': number,
  'duration': number,
  'input.length': number,
  'output.length': number,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'failed.error': string
}
```

### ai/generate

> Sent when generating summaries from commits, stashes, patches, etc.

```typescript
{
  'type': 'commitMessage',
  'model.id': 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-16k' | 'claude-instant-1' | 'claude-2' | 'claude-2.1' | 'claude-3-opus-20240229' | 'claude-3-sonnet-20240229' | 'claude-3-5-sonnet-20240620' | 'claude-3-haiku-20240307' | 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest' | `${string}:${string}`,
  'model.provider.id': 'openai' | 'anthropic' | 'gemini' | 'vscode',
  'model.provider.name': string,
  'retry.count': number,
  'duration': number,
  'input.length': number,
  'output.length': number,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'failed.error': string
}
```

or

```typescript
{
  'type': 'draftMessage',
  'draftType': 'stash' | 'patch' | 'suggested_pr_change',
  'model.id': 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-16k' | 'claude-instant-1' | 'claude-2' | 'claude-2.1' | 'claude-3-opus-20240229' | 'claude-3-sonnet-20240229' | 'claude-3-5-sonnet-20240620' | 'claude-3-haiku-20240307' | 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest' | `${string}:${string}`,
  'model.provider.id': 'openai' | 'anthropic' | 'gemini' | 'vscode',
  'model.provider.name': string,
  'retry.count': number,
  'duration': number,
  'input.length': number,
  'output.length': number,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'failed.error': string
}
```

### cloudIntegrations/connecting

> Sent when connecting to one or more cloud-based integrations

```typescript
{
  'integration.ids': string
}
```

### cloudIntegrations/connected

> Sent when connected to one or more cloud-based integrations from gkdev

```typescript
{
  'integration.ids': string,
  'integration.connected.ids': string
}
```

### cloudIntegrations/getConnections/failed

> Sent when getting connected providers from the api fails

```typescript
{
  'code': number
}
```

### cloudIntegrations/getConnection/failed

> Sent when getting a provider token from the api fails

```typescript
{
  'code': number,
  'integration.id': string
}
```

### cloudIntegrations/refreshConnection/failed

> Sent when refreshing a provider token from the api fails

```typescript
{
  'code': number,
  'integration.id': string
}
```

### cloudIntegrations/hosting/connected

> Sent when a cloud-based hosting provider is connected

```typescript
{
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'github-enterprise' | 'gitlab-self-hosted',
  'hostingProvider.key': string
}
```

### cloudIntegrations/hosting/disconnected

> Sent when a cloud-based hosting provider is disconnected

```typescript
{
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'github-enterprise' | 'gitlab-self-hosted',
  'hostingProvider.key': string
}
```

### cloudIntegrations/issue/connected

> Sent when a cloud-based issue provider is connected

```typescript
{
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'github-enterprise' | 'gitlab-self-hosted',
  'issueProvider.key': string
}
```

### cloudIntegrations/issue/disconnected

> Sent when a cloud-based issue provider is disconnected

```typescript
{
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'github-enterprise' | 'gitlab-self-hosted',
  'issueProvider.key': string
}
```

### cloudIntegrations/settingsOpened

> Sent when a user chooses to manage the cloud integrations

```typescript
{
  'integration.id': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello'
}
```

### codeSuggestionArchived

> Sent when a code suggestion is archived

```typescript
{
  'provider': string,
  'repository.visibility': 'private' | 'public' | 'local',
  'repoPrivacy': 'private' | 'public' | 'local',
  'draftId': string,
  'reason': 'committed' | 'rejected' | 'accepted'
}
```

### codeSuggestionCreated

> Sent when a code suggestion is created

```typescript
{
  'provider': string,
  'repository.visibility': 'private' | 'public' | 'local',
  'repoPrivacy': 'private' | 'public' | 'local',
  'draftId': string,
  'draftPrivacy': 'private' | 'public' | 'invite_only' | 'provider_access',
  'filesChanged': number,
  'source': 'reviewMode'
}
```

### codeSuggestionViewed

> Sent when a code suggestion is opened

```typescript
{
  'provider': string,
  'repository.visibility': 'private' | 'public' | 'local',
  'repoPrivacy': 'private' | 'public' | 'local',
  'draftId': string,
  'draftPrivacy': 'private' | 'public' | 'invite_only' | 'provider_access',
  'source': string
}
```

### command

> Sent when a GitLens command is executed

```typescript
{
  'command': 'gitlens.gitCommands',
  // @deprecated: Nested objects should not be used in telemetry
  'context': {
    'mode': string,
    'submode': string
  },
  'context.mode': string,
  'context.submode': string,
  'webview': string
}
```

or

```typescript
{
  'command': string,
  'context': never,
  'context.mode': never,
  'context.submode': never,
  'webview': string
}
```

### command/core

> Sent when a VS Code command is executed by a GitLens provided action

```typescript
{
  'command': string
}
```

### graph/command

> Sent when a "Graph" command is executed

```typescript
{
  'command': string,
  'context.mode': string,
  'context.submode': string,
  'webview': string
}
```

### launchpad/title/action

> Sent when the user takes an action on a launchpad item

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'action': 'feedback' | 'open-on-gkdev' | 'refresh' | 'settings' | 'connect'
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'action': 'feedback' | 'open-on-gkdev' | 'refresh' | 'settings' | 'connect'
}
```

### launchpad/action

> Sent when the user takes an action on a launchpad item

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'action': 'open' | 'code-suggest' | 'merge' | 'soft-open' | 'switch' | 'open-worktree' | 'switch-and-code-suggest' | 'show-overview' | 'open-changes' | 'open-in-graph' | 'pin' | 'unpin' | 'snooze' | 'unsnooze' | 'open-suggestion' | 'open-suggestion-browser'
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'action': 'open' | 'code-suggest' | 'merge' | 'soft-open' | 'switch' | 'open-worktree' | 'switch-and-code-suggest' | 'show-overview' | 'open-changes' | 'open-in-graph' | 'pin' | 'unpin' | 'snooze' | 'unsnooze' | 'open-suggestion' | 'open-suggestion-browser'
}
```

### launchpad/configurationChanged

> Sent when the user changes launchpad configuration settings

```typescript
{
  'config.launchpad.staleThreshold': number,
  'config.launchpad.ignoredOrganizations': number,
  'config.launchpad.ignoredRepositories': number,
  'config.launchpad.indicator.enabled': false | true,
  'config.launchpad.indicator.icon': 'default' | 'group',
  'config.launchpad.indicator.label': false | 'item' | 'counts',
  'config.launchpad.indicator.useColors': false | true,
  'config.launchpad.indicator.groups': string,
  'config.launchpad.indicator.polling.enabled': false | true,
  'config.launchpad.indicator.polling.interval': number
}
```

### launchpad/groupToggled

> Sent when the user expands/collapses a launchpad group

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'group': 'current-branch' | 'pinned' | 'mergeable' | 'blocked' | 'follow-up' | 'needs-review' | 'waiting-for-review' | 'draft' | 'other' | 'snoozed',
  'collapsed': false | true
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'group': 'current-branch' | 'pinned' | 'mergeable' | 'blocked' | 'follow-up' | 'needs-review' | 'waiting-for-review' | 'draft' | 'other' | 'snoozed',
  'collapsed': false | true
}
```

### launchpad/open

> Sent when the user opens launchpad; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true
}
```

### launchpad/opened

> Sent when the launchpad is opened; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'connected': false | true
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'connected': false | true
}
```

### launchpad/steps/connect

> Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is disconnected; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'connected': false | true
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'connected': false | true
}
```

### launchpad/steps/main

> Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is connected; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'connected': false | true
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'connected': false | true
}
```

### launchpad/steps/details

> Sent when the user opens the details of a launchpad item (e.g. click on an item); use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'action': 'select'
}
```

or

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.count': number,
  'items.timings.prs': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'groups.count': number,
  'groups.current-branch.count': number,
  'groups.pinned.count': number,
  'groups.mergeable.count': number,
  'groups.blocked.count': number,
  'groups.follow-up.count': number,
  'groups.needs-review.count': number,
  'groups.waiting-for-review.count': number,
  'groups.draft.count': number,
  'groups.other.count': number,
  'groups.snoozed.count': number,
  'groups.current-branch.collapsed': false | true,
  'groups.pinned.collapsed': false | true,
  'groups.mergeable.collapsed': false | true,
  'groups.blocked.collapsed': false | true,
  'groups.follow-up.collapsed': false | true,
  'groups.needs-review.collapsed': false | true,
  'groups.waiting-for-review.collapsed': false | true,
  'groups.draft.collapsed': false | true,
  'groups.other.collapsed': false | true,
  'groups.snoozed.collapsed': false | true,
  'action': 'select'
}
```

### launchpad/indicator/hidden

> Sent when the user hides the launchpad indicator

```typescript
void
```

### launchpad/indicator/firstLoad

> Sent when the launchpad indicator loads (with data) for the first time ever for this device

```typescript
void
```

### launchpad/operation/slow

> Sent when a launchpad operation is taking longer than a set timeout to complete

```typescript
{
  'timeout': number,
  'operation': 'getMyPullRequests' | 'getCodeSuggestions' | 'getEnrichedItems' | 'getCodeSuggestionCounts',
  'duration': number
}
```

### openReviewMode

> Sent when a PR review was started in the inspect overview

```typescript
{
  'provider': string,
  'repository.visibility': 'private' | 'public' | 'local',
  'repoPrivacy': 'private' | 'public' | 'local',
  'filesChanged': number,
  'source': 'settings' | 'code-suggest' | 'account' | 'cloud-patches' | 'commandPalette' | 'deeplink' | 'graph' | 'home' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'notification' | 'patchDetails' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'timeline' | 'trial-indicator' | 'scm-input' | 'subscription' | 'walkthrough' | 'welcome' | 'worktrees'
}
```

### providers/context

> Sent when the "context" of the workspace changes (e.g. repo added, integration connected, etc)

```typescript
void
```

### providers/registrationComplete

> Sent when we've loaded all the git providers and their repositories

```typescript
{
  'config.git.autoRepositoryDetection': false | true | 'subFolders' | 'openEditors'
}
```

### remoteProviders/connected

> Sent when a local (Git remote-based) hosting provider is connected

```typescript
{
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'github-enterprise' | 'gitlab-self-hosted',
  'hostingProvider.key': string,
  // @deprecated: 
  'remoteProviders.key': string
}
```

### remoteProviders/disconnected

> Sent when a local (Git remote-based) hosting provider is disconnected

```typescript
{
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'github-enterprise' | 'gitlab-self-hosted',
  'hostingProvider.key': string,
  // @deprecated: 
  'remoteProviders.key': string
}
```

### repositories/changed

> Sent when the workspace's repositories change

```typescript
{
  'repositories.added': number,
  'repositories.removed': number
}
```

### repositories/visibility

> Sent when the workspace's repository visibility is first requested

```typescript
{
  'repositories.visibility': 'private' | 'public' | 'local' | 'mixed'
}
```

### repository/opened

> Sent when a repository is opened

```typescript
{
  'repository.id': string,
  'repository.scheme': string,
  'repository.closed': false | true,
  'repository.folder.scheme': string,
  'repository.provider.id': string,
  'repository.remoteProviders': string
}
```

### repository/visibility

> Sent when a repository's visibility is first requested

```typescript
{
  'repository.visibility': 'private' | 'public' | 'local',
  'repository.id': string,
  'repository.scheme': string,
  'repository.closed': false | true,
  'repository.folder.scheme': string,
  'repository.provider.id': string
}
```

### subscription

> Sent when the subscription is loaded

```typescript
{
  'subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'subscription.status': 'verification' | 'free' | 'preview' | 'preview-expired' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
}
```

### subscription/action

```typescript
{
  'action': 'sign-up' | 'sign-in' | 'sign-out' | 'manage' | 'reactivate' | 'resend-verification' | 'pricing' | 'start-preview-trial' | 'upgrade'
}
```

or

```typescript
{
  'action': 'visibility',
  'visible': false | true
}
```

### subscription/changed

> Sent when the subscription changes

```typescript
{
  'subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'subscription.status': 'verification' | 'free' | 'preview' | 'preview-expired' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
}
```

### usage/track

> Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown

```typescript
{
  'usage.key': 'settingsWebview:shown' | 'graphWebview:shown' | 'patchDetailsWebview:shown' | 'timelineWebview:shown' | 'welcomeWebview:shown' | 'launchpadView:shown' | 'worktreesView:shown' | 'branchesView:shown' | 'commitsView:shown' | 'contributorsView:shown' | 'draftsView:shown' | 'fileHistoryView:shown' | 'lineHistoryView:shown' | 'pullRequestView:shown' | 'remotesView:shown' | 'repositoriesView:shown' | 'searchAndCompareView:shown' | 'stashesView:shown' | 'tagsView:shown' | 'workspacesView:shown' | 'graphView:shown' | 'homeView:shown' | 'patchDetailsView:shown' | 'timelineView:shown' | 'commitDetailsView:shown' | 'graphDetailsView:shown' | 'rebaseEditor:shown',
  'usage.count': number
}
```

### walkthrough

> Sent when the walkthrough is opened

```typescript
{
  'step': 'integrations' | 'launchpad' | 'get-started' | 'core-features' | 'pro-features' | 'pro-trial' | 'pro-upgrade' | 'pro-reactivate' | 'pro-paid' | 'visualize' | 'code-collab' | 'more'
}
```

