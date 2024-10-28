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
  'model.id': 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-16k' | 'claude-instant-1' | 'claude-2' | 'claude-2.1' | 'claude-3-opus-20240229' | 'claude-3-opus-latest' | 'claude-3-sonnet-20240229' | 'claude-3-5-sonnet-20240620' | 'claude-3-5-sonnet-20241022' | 'claude-3-5-sonnet-latest' | 'claude-3-haiku-20240307' | 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest' | 'google/gemma-1.1-2b-it' | 'meta-llama/Llama-3.2-3B-Instruct' | 'microsoft/Phi-3-mini-4k-instruct' | 'HuggingFaceH4/starchat2-15b-v0.1' | 'mistralai/Mistral-Nemo-Instruct-2407' | `${string}:${string}` | 'grok-beta',
  'model.provider.id': 'openai' | 'anthropic' | 'gemini' | 'huggingchat' | 'vscode' | 'xai',
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
  'model.id': 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-16k' | 'claude-instant-1' | 'claude-2' | 'claude-2.1' | 'claude-3-opus-20240229' | 'claude-3-opus-latest' | 'claude-3-sonnet-20240229' | 'claude-3-5-sonnet-20240620' | 'claude-3-5-sonnet-20241022' | 'claude-3-5-sonnet-latest' | 'claude-3-haiku-20240307' | 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest' | 'google/gemma-1.1-2b-it' | 'meta-llama/Llama-3.2-3B-Instruct' | 'microsoft/Phi-3-mini-4k-instruct' | 'HuggingFaceH4/starchat2-15b-v0.1' | 'mistralai/Mistral-Nemo-Instruct-2407' | `${string}:${string}` | 'grok-beta',
  'model.provider.id': 'openai' | 'anthropic' | 'gemini' | 'huggingchat' | 'vscode' | 'xai',
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
  'model.id': 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-32k' | 'gpt-4-32k-0613' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-16k' | 'claude-instant-1' | 'claude-2' | 'claude-2.1' | 'claude-3-opus-20240229' | 'claude-3-opus-latest' | 'claude-3-sonnet-20240229' | 'claude-3-5-sonnet-20240620' | 'claude-3-5-sonnet-20241022' | 'claude-3-5-sonnet-latest' | 'claude-3-haiku-20240307' | 'gemini-1.0-pro' | 'gemini-1.5-pro-latest' | 'gemini-1.5-flash-latest' | 'google/gemma-1.1-2b-it' | 'meta-llama/Llama-3.2-3B-Instruct' | 'microsoft/Phi-3-mini-4k-instruct' | 'HuggingFaceH4/starchat2-15b-v0.1' | 'mistralai/Mistral-Nemo-Instruct-2407' | `${string}:${string}` | 'grok-beta',
  'model.provider.id': 'openai' | 'anthropic' | 'gemini' | 'huggingchat' | 'vscode' | 'xai',
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

### cloudIntegrations/disconnect/failed

> Sent when disconnecting a provider from the api fails

```typescript
{
  'code': number,
  'integration.id': string
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

### commitDetails/shown

> Sent when the Inspect view is shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.mode': 'wip',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.inReview': false | true,
  'context.codeSuggestions': number,
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string,
  'context.config.avatars': false | true,
  'context.config.files.compact': false | true,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.autolinks.enabled': false | true,
  'context.config.autolinks.enhanced': false | true,
  'context.config.pullRequests.enabled': false | true
}
```

or

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.mode': 'commit',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.pinned': false | true,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': false | true,
  'context.config.avatars': false | true,
  'context.config.files.compact': false | true,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.autolinks.enabled': false | true,
  'context.config.autolinks.enhanced': false | true,
  'context.config.pullRequests.enabled': false | true
}
```

### commitDetails/mode/changed

> Sent when the user changes the selected tab (mode) on the Graph Details view

```typescript
{
  'mode.old': 'wip' | 'commit',
  'mode.new': 'wip' | 'commit',
  'context.mode': 'wip',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.inReview': false | true,
  'context.codeSuggestions': number,
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

or

```typescript
{
  'mode.old': 'wip' | 'commit',
  'mode.new': 'wip' | 'commit',
  'context.mode': 'commit',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.pinned': false | true,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### graph/shown

> Sent when the Commit Graph is shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string,
  'context.config.avatars': false | true,
  'context.config.pullRequests.enabled': false | true,
  'context.config.layout': 'editor' | 'panel',
  'context.config.allowMultiple': false | true,
  'context.config.branchesVisibility': 'all' | 'smart' | 'current',
  'context.config.commitOrdering': 'date' | 'author-date' | 'topo',
  'context.config.dateFormat': string,
  'context.config.dateStyle': 'absolute' | 'relative',
  'context.config.defaultItemLimit': number,
  'context.config.dimMergeCommits': false | true,
  'context.config.highlightRowsOnRefHover': false | true,
  'context.config.minimap.enabled': false | true,
  'context.config.minimap.dataType': 'commits' | 'lines',
  'context.config.minimap.additionalTypes': string,
  'context.config.onlyFollowFirstParent': false | true,
  'context.config.pageItemLimit': number,
  'context.config.scrollMarkers.enabled': false | true,
  'context.config.scrollMarkers.additionalTypes': string,
  'context.config.scrollRowPadding': number,
  'context.config.searchItemLimit': number,
  'context.config.showDetailsView': false | 'open' | 'selection',
  'context.config.showGhostRefsOnRowHover': false | true,
  'context.config.showRemoteNames': false | true,
  'context.config.showUpstreamStatus': false | true,
  'context.config.sidebar.enabled': false | true,
  'context.config.statusBar.enabled': false | true
}
```

### graph/command

> Sent when a Commit Graph command is executed

```typescript
{
  'command': string,
  'context.mode': string,
  'context.submode': string,
  'webview': string
}
```

### graph/action/jumpTo

> Sent when the user clicks on the Jump to HEAD/Reference (alt) header button on the Commit Graph

```typescript
{
  'target': 'HEAD' | 'choose',
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/action/openRepoOnRemote

> Sent when the user clicks on the "Jump to HEAD"/"Jump to Reference" (alt) header button on the Commit Graph

```typescript
{
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/action/sidebar

> Sent when the user clicks on the "Open Repository on Remote" header button on the Commit Graph

```typescript
{
  'action': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/branchesVisibility/changed

> Sent when the user changes the "branches visibility" on the Commit Graph

```typescript
{
  'branchesVisibility.old': 'all' | 'smart' | 'current',
  'branchesVisibility.new': 'all' | 'smart' | 'current',
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/columns/changed

> Sent when the user changes the columns on the Commit Graph

```typescript
{
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/filters/changed

> Sent when the user changes the filters on the Commit Graph

```typescript
{
  'key': string,
  'value': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/minimap/day/selected

> Sent when the user selects (clicks on) a day on the minimap on the Commit Graph

```typescript
{
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/repository/changed

> Sent when the user changes the current repository on the Commit Graph

```typescript
{
  'repository.id': string,
  'repository.scheme': string,
  'repository.closed': false | true,
  'repository.folder.scheme': string,
  'repository.provider.id': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/row/hovered

> Sent when the user hovers over a row on the Commit Graph

```typescript
{
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/row/selected

> Sent when the user selects (clicks on) a row or rows on the Commit Graph

```typescript
{
  'rows': number,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/rows/loaded

> Sent when rows are loaded into the Commit Graph

```typescript
{
  'duration': number,
  'rows': number,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graph/searched

> Sent when a search was performed on the Commit Graph

```typescript
{
  'types': string,
  'duration': number,
  'matches': number,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string
}
```

### graphDetails/shown

> Sent when the Graph Details view is shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.mode': 'wip',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.inReview': false | true,
  'context.codeSuggestions': number,
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string,
  'context.config.avatars': false | true,
  'context.config.files.compact': false | true,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.autolinks.enabled': false | true,
  'context.config.autolinks.enhanced': false | true,
  'context.config.pullRequests.enabled': false | true
}
```

or

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.mode': 'commit',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.pinned': false | true,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': false | true,
  'context.config.avatars': false | true,
  'context.config.files.compact': false | true,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.autolinks.enabled': false | true,
  'context.config.autolinks.enhanced': false | true,
  'context.config.pullRequests.enabled': false | true
}
```

### graphDetails/mode/changed

> Sent when the user changes the selected tab (mode) on the Graph Details view

```typescript
{
  'mode.old': 'wip' | 'commit',
  'mode.new': 'wip' | 'commit',
  'context.mode': 'wip',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.inReview': false | true,
  'context.codeSuggestions': number,
  'context.repository.id': string,
  'context.repository.scheme': string,
  'context.repository.closed': false | true,
  'context.repository.folder.scheme': string,
  'context.repository.provider.id': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

or

```typescript
{
  'mode.old': 'wip' | 'commit',
  'mode.new': 'wip' | 'commit',
  'context.mode': 'commit',
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.pinned': false | true,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### timeline/shown

> Sent when the Commit Graph is shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view',
  'context.period': string,
  'context.config.allowMultiple': false | true,
  'context.config.queryLimit': number
}
```

### timeline/action/openInEditor

> Sent when the user changes the period (timeframe) on the visual file history

```typescript
{
  'context.period': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### timeline/editor/changed

> Sent when the editor changes on the visual file history

```typescript
{
  'context.period': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### timeline/period/changed

> Sent when the user changes the period (timeframe) on the visual file history

```typescript
{
  'period.old': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'period.new': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.period': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### timeline/commit/selected

> Sent when the user selects (clicks on) a commit on the visual file history

```typescript
{
  'context.period': string,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### launchpad/title/action

> Sent when the user takes an action on the Launchpad title bar

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': false | true,
  'items.error': string,
  'action': 'settings' | 'feedback' | 'open-on-gkdev' | 'refresh' | 'connect'
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
  'action': 'settings' | 'feedback' | 'open-on-gkdev' | 'refresh' | 'connect'
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
  'config.launchpad.includedOrganizations': number,
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
  'operation': 'getPullRequest' | 'searchPullRequests' | 'getMyPullRequests' | 'getCodeSuggestions' | 'getEnrichedItems' | 'getCodeSuggestionCounts',
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
  'source': 'graph' | 'patchDetails' | 'settings' | 'timeline' | 'welcome' | 'home' | 'code-suggest' | 'account' | 'cloud-patches' | 'commandPalette' | 'deeplink' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'trial-indicator' | 'scm-input' | 'subscription' | 'walkthrough' | 'worktrees'
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
  'repository.remoteProviders': string,
  'repository.contributors.commits.count': number,
  'repository.contributors.commits.avgPerContributor': number,
  'repository.contributors.count': number,
  'repository.contributors.since': '1.year.ago',
  'repository.contributors.distribution.[1]': number,
  'repository.contributors.distribution.[2-5]': number,
  'repository.contributors.distribution.[6-10]': number,
  'repository.contributors.distribution.[11-50]': number,
  'repository.contributors.distribution.[51-100]': number,
  'repository.contributors.distribution.[101+]': number
}
```

### repository/visibility

> Sent when a repository's visibility is first requested

```typescript
{
  'repository.id': string,
  'repository.scheme': string,
  'repository.closed': false | true,
  'repository.folder.scheme': string,
  'repository.provider.id': string,
  'repository.visibility': 'private' | 'public' | 'local'
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

> Sent when the user takes an action on the subscription

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
  'usage.key': 'graphWebview:shown' | 'patchDetailsWebview:shown' | 'settingsWebview:shown' | 'timelineWebview:shown' | 'welcomeWebview:shown' | 'graphView:shown' | 'patchDetailsView:shown' | 'timelineView:shown' | 'commitDetailsView:shown' | 'graphDetailsView:shown' | 'homeView:shown' | 'commitsView:shown' | 'stashesView:shown' | 'tagsView:shown' | 'launchpadView:shown' | 'worktreesView:shown' | 'branchesView:shown' | 'contributorsView:shown' | 'draftsView:shown' | 'fileHistoryView:shown' | 'lineHistoryView:shown' | 'pullRequestView:shown' | 'remotesView:shown' | 'repositoriesView:shown' | 'searchAndCompareView:shown' | 'workspacesView:shown' | 'rebaseEditor:shown' | 'command:gitlens.action.:executed' | 'command:gitlens.addAuthors:executed' | 'command:gitlens.browseRepoAtRevision:executed' | 'command:gitlens.browseRepoAtRevisionInNewWindow:executed' | 'command:gitlens.browseRepoBeforeRevision:executed' | 'command:gitlens.browseRepoBeforeRevisionInNewWindow:executed' | 'command:gitlens.clearFileAnnotations:executed' | 'command:gitlens.closeUnchangedFiles:executed' | 'command:gitlens.compareWith:executed' | 'command:gitlens.compareHeadWith:executed' | 'command:gitlens.compareWorkingWith:executed' | 'command:gitlens.computingFileAnnotations:executed' | 'command:gitlens.connectRemoteProvider:executed' | 'command:gitlens.copyCurrentBranch:executed' | 'command:gitlens.copyDeepLinkToBranch:executed' | 'command:gitlens.copyDeepLinkToCommit:executed' | 'command:gitlens.copyDeepLinkToComparison:executed' | 'command:gitlens.copyDeepLinkToFile:executed' | 'command:gitlens.copyDeepLinkToFileAtRevision:executed' | 'command:gitlens.copyDeepLinkToLines:executed' | 'command:gitlens.copyDeepLinkToRepo:executed' | 'command:gitlens.copyDeepLinkToTag:executed' | 'command:gitlens.copyDeepLinkToWorkspace:executed' | 'command:gitlens.copyMessageToClipboard:executed' | 'command:gitlens.copyRemoteBranchesUrl:executed' | 'command:gitlens.copyRemoteBranchUrl:executed' | 'command:gitlens.copyRemoteCommitUrl:executed' | 'command:gitlens.copyRemoteComparisonUrl:executed' | 'command:gitlens.copyRemoteFileUrlToClipboard:executed' | 'command:gitlens.copyRemoteFileUrlWithoutRange:executed' | 'command:gitlens.copyRemoteFileUrlFrom:executed' | 'command:gitlens.copyRemotePullRequestUrl:executed' | 'command:gitlens.copyRemoteRepositoryUrl:executed' | 'command:gitlens.copyShaToClipboard:executed' | 'command:gitlens.copyRelativePathToClipboard:executed' | 'command:gitlens.applyPatchFromClipboard:executed' | 'command:gitlens.pastePatchFromClipboard:executed' | 'command:gitlens.copyPatchToClipboard:executed' | 'command:gitlens.copyWorkingChangesToWorktree:executed' | 'command:gitlens.createPatch:executed' | 'command:gitlens.createCloudPatch:executed' | 'command:gitlens.createPullRequestOnRemote:executed' | 'command:gitlens.diffDirectory:executed' | 'command:gitlens.diffDirectoryWithHead:executed' | 'command:gitlens.diffFolderWithRevision:executed' | 'command:gitlens.diffFolderWithRevisionFrom:executed' | 'command:gitlens.diffWith:executed' | 'command:gitlens.diffWithNext:executed' | 'command:gitlens.diffWithNextInDiffLeft:executed' | 'command:gitlens.diffWithNextInDiffRight:executed' | 'command:gitlens.diffWithPrevious:executed' | 'command:gitlens.diffWithPreviousInDiffLeft:executed' | 'command:gitlens.diffWithPreviousInDiffRight:executed' | 'command:gitlens.diffLineWithPrevious:executed' | 'command:gitlens.diffWithRevision:executed' | 'command:gitlens.diffWithRevisionFrom:executed' | 'command:gitlens.diffWithWorking:executed' | 'command:gitlens.diffWithWorkingInDiffLeft:executed' | 'command:gitlens.diffWithWorkingInDiffRight:executed' | 'command:gitlens.diffLineWithWorking:executed' | 'command:gitlens.disconnectRemoteProvider:executed' | 'command:gitlens.disableDebugLogging:executed' | 'command:gitlens.enableDebugLogging:executed' | 'command:gitlens.disableRebaseEditor:executed' | 'command:gitlens.enableRebaseEditor:executed' | 'command:gitlens.externalDiff:executed' | 'command:gitlens.externalDiffAll:executed' | 'command:gitlens.fetchRepositories:executed' | 'command:gitlens.generateCommitMessage:executed' | 'command:gitlens.getStarted:executed' | 'command:gitlens.gk.switchOrganization:executed' | 'command:gitlens.inviteToLiveShare:executed' | 'command:gitlens.openBlamePriorToChange:executed' | 'command:gitlens.openBranchesOnRemote:executed' | 'command:gitlens.openBranchOnRemote:executed' | 'command:gitlens.openCurrentBranchOnRemote:executed' | 'command:gitlens.openChangedFiles:executed' | 'command:gitlens.openCommitOnRemote:executed' | 'command:gitlens.openComparisonOnRemote:executed' | 'command:gitlens.openFileHistory:executed' | 'command:gitlens.openFileFromRemote:executed' | 'command:gitlens.openFileOnRemote:executed' | 'command:gitlens.openFileOnRemoteFrom:executed' | 'command:gitlens.openFileRevision:executed' | 'command:gitlens.openFileRevisionFrom:executed' | 'command:gitlens.openFolderHistory:executed' | 'command:gitlens.openOnRemote:executed' | 'command:gitlens.openCloudPatch:executed' | 'command:gitlens.openPatch:executed' | 'command:gitlens.openPullRequestOnRemote:executed' | 'command:gitlens.openAssociatedPullRequestOnRemote:executed' | 'command:gitlens.openRepoOnRemote:executed' | 'command:gitlens.openRevisionFile:executed' | 'command:gitlens.openRevisionFileInDiffLeft:executed' | 'command:gitlens.openRevisionFileInDiffRight:executed' | 'command:gitlens.openWalkthrough:executed' | 'command:gitlens.openWorkingFile:executed' | 'command:gitlens.openWorkingFileInDiffLeft:executed' | 'command:gitlens.openWorkingFileInDiffRight:executed' | 'command:gitlens.pullRepositories:executed' | 'command:gitlens.pushRepositories:executed' | 'command:gitlens.gitCommands:executed' | 'command:gitlens.gitCommands.branch:executed' | 'command:gitlens.gitCommands.branch.create:executed' | 'command:gitlens.gitCommands.branch.delete:executed' | 'command:gitlens.gitCommands.branch.prune:executed' | 'command:gitlens.gitCommands.branch.rename:executed' | 'command:gitlens.gitCommands.checkout:executed' | 'command:gitlens.gitCommands.cherryPick:executed' | 'command:gitlens.gitCommands.history:executed' | 'command:gitlens.gitCommands.merge:executed' | 'command:gitlens.gitCommands.rebase:executed' | 'command:gitlens.gitCommands.remote:executed' | 'command:gitlens.gitCommands.remote.add:executed' | 'command:gitlens.gitCommands.remote.prune:executed' | 'command:gitlens.gitCommands.remote.remove:executed' | 'command:gitlens.gitCommands.reset:executed' | 'command:gitlens.gitCommands.revert:executed' | 'command:gitlens.gitCommands.show:executed' | 'command:gitlens.gitCommands.stash:executed' | 'command:gitlens.gitCommands.stash.drop:executed' | 'command:gitlens.gitCommands.stash.list:executed' | 'command:gitlens.gitCommands.stash.pop:executed' | 'command:gitlens.gitCommands.stash.push:executed' | 'command:gitlens.gitCommands.stash.rename:executed' | 'command:gitlens.gitCommands.status:executed' | 'command:gitlens.gitCommands.switch:executed' | 'command:gitlens.gitCommands.tag:executed' | 'command:gitlens.gitCommands.tag.create:executed' | 'command:gitlens.gitCommands.tag.delete:executed' | 'command:gitlens.gitCommands.worktree:executed' | 'command:gitlens.gitCommands.worktree.create:executed' | 'command:gitlens.gitCommands.worktree.delete:executed' | 'command:gitlens.gitCommands.worktree.open:executed' | 'command:gitlens.ghpr.views.openOrCreateWorktree:executed' | 'command:gitlens.plus.cloudIntegrations.connect:executed' | 'command:gitlens.plus.hide:executed' | 'command:gitlens.plus.login:executed' | 'command:gitlens.plus.logout:executed' | 'command:gitlens.plus.manage:executed' | 'command:gitlens.plus.cloudIntegrations.manage:executed' | 'command:gitlens.plus.reactivateProTrial:executed' | 'command:gitlens.plus.resendVerification:executed' | 'command:gitlens.plus.restore:executed' | 'command:gitlens.plus.showPlans:executed' | 'command:gitlens.plus.signUp:executed' | 'command:gitlens.plus.startPreviewTrial:executed' | 'command:gitlens.plus.upgrade:executed' | 'command:gitlens.plus.validate:executed' | 'command:gitlens.plus.simulateSubscription:executed' | 'command:gitlens.quickOpenFileHistory:executed' | 'command:gitlens.launchpad.refresh:executed' | 'command:gitlens.graph.refresh:executed' | 'command:gitlens.refreshHover:executed' | 'command:gitlens.reset:executed' | 'command:gitlens.resetAIKey:executed' | 'command:gitlens.resetViewsLayout:executed' | 'command:gitlens.revealCommitInView:executed' | 'command:gitlens.shareAsCloudPatch:executed' | 'command:gitlens.showCommitSearch:executed' | 'command:gitlens.views.searchAndCompare.searchCommits:executed' | 'command:gitlens.showBranchesView:executed' | 'command:gitlens.showCommitDetailsView:executed' | 'command:gitlens.showCommitInView:executed' | 'command:gitlens.showCommitsInView:executed' | 'command:gitlens.showCommitsView:executed' | 'command:gitlens.showContributorsView:executed' | 'command:gitlens.showDraftsView:executed' | 'command:gitlens.showFileHistoryView:executed' | 'command:gitlens.showGraph:executed' | 'command:gitlens.showGraphPage:executed' | 'command:gitlens.showGraphView:executed' | 'command:gitlens.showHomeView:executed' | 'command:gitlens.showAccountView:executed' | 'command:gitlens.showInCommitGraph:executed' | 'command:gitlens.showInCommitGraphView:executed' | 'command:gitlens.showInDetailsView:executed' | 'command:gitlens.showInTimeline:executed' | 'command:gitlens.showLastQuickPick:executed' | 'command:gitlens.showLaunchpad:executed' | 'command:gitlens.showLaunchpadView:executed' | 'command:gitlens.showLineCommitInView:executed' | 'command:gitlens.showLineHistoryView:executed' | 'command:gitlens.openOnlyChangedFiles:executed' | 'command:gitlens.showPatchDetailsPage:executed' | 'command:gitlens.showQuickBranchHistory:executed' | 'command:gitlens.showQuickCommitDetails:executed' | 'command:gitlens.showQuickCommitFileDetails:executed' | 'command:gitlens.showQuickRepoHistory:executed' | 'command:gitlens.showQuickFileHistory:executed' | 'command:gitlens.showQuickRepoStatus:executed' | 'command:gitlens.showQuickRevisionDetails:executed' | 'command:gitlens.showQuickRevisionDetailsInDiffLeft:executed' | 'command:gitlens.showQuickRevisionDetailsInDiffRight:executed' | 'command:gitlens.showQuickStashList:executed' | 'command:gitlens.showRemotesView:executed' | 'command:gitlens.showRepositoriesView:executed' | 'command:gitlens.showSearchAndCompareView:executed' | 'command:gitlens.showSettingsPage:executed' | 'command:gitlens.showSettingsPage!file-annotations:executed' | 'command:gitlens.showSettingsPage!branches-view:executed' | 'command:gitlens.showSettingsPage!commits-view:executed' | 'command:gitlens.showSettingsPage!contributors-view:executed' | 'command:gitlens.showSettingsPage!file-history-view:executed' | 'command:gitlens.showSettingsPage!line-history-view:executed' | 'command:gitlens.showSettingsPage!remotes-view:executed' | 'command:gitlens.showSettingsPage!repositories-view:executed' | 'command:gitlens.showSettingsPage!search-compare-view:executed' | 'command:gitlens.showSettingsPage!stashes-view:executed' | 'command:gitlens.showSettingsPage!tags-view:executed' | 'command:gitlens.showSettingsPage!worktrees-view:executed' | 'command:gitlens.showSettingsPage!views:executed' | 'command:gitlens.showSettingsPage!commit-graph:executed' | 'command:gitlens.showSettingsPage!autolinks:executed' | 'command:gitlens.showStashesView:executed' | 'command:gitlens.showTagsView:executed' | 'command:gitlens.showTimelinePage:executed' | 'command:gitlens.showTimelineView:executed' | 'command:gitlens.showWelcomePage:executed' | 'command:gitlens.showWorktreesView:executed' | 'command:gitlens.showWorkspacesView:executed' | 'command:gitlens.stashApply:executed' | 'command:gitlens.stashSave:executed' | 'command:gitlens.stashSaveFiles:executed' | 'command:gitlens.switchAIModel:executed' | 'command:gitlens.switchMode:executed' | 'command:gitlens.toggleCodeLens:executed' | 'command:gitlens.toggleFileBlame:executed' | 'command:gitlens.toggleFileBlameInDiffLeft:executed' | 'command:gitlens.toggleFileBlameInDiffRight:executed' | 'command:gitlens.toggleFileChanges:executed' | 'command:gitlens.toggleFileChangesOnly:executed' | 'command:gitlens.toggleFileHeatmap:executed' | 'command:gitlens.toggleFileHeatmapInDiffLeft:executed' | 'command:gitlens.toggleFileHeatmapInDiffRight:executed' | 'command:gitlens.launchpad.indicator.toggle:executed' | 'command:gitlens.toggleGraph:executed' | 'command:gitlens.toggleMaximizedGraph:executed' | 'command:gitlens.toggleLineBlame:executed' | 'command:gitlens.toggleReviewMode:executed' | 'command:gitlens.toggleZenMode:executed' | 'command:gitlens.views.copy:executed' | 'command:gitlens.views.copyAsMarkdown:executed' | 'command:gitlens.views.copyUrl:executed' | 'command:gitlens.views.openDirectoryDiff:executed' | 'command:gitlens.views.openDirectoryDiffWithWorking:executed' | 'command:gitlens.views.openUrl:executed' | 'command:gitlens.diffHeadWith:executed' | 'command:gitlens.diffWorkingWith:executed' | 'command:gitlens.openBranchesInRemote:executed' | 'command:gitlens.openBranchInRemote:executed' | 'command:gitlens.openCommitInRemote:executed' | 'command:gitlens.openFileInRemote:executed' | 'command:gitlens.openInRemote:executed' | 'command:gitlens.openRepoInRemote:executed' | 'command:gitlens.showFileHistoryInView:executed' | 'home:walkthrough:dismissed',
  'usage.count': number
}
```

### walkthrough

> Sent when the walkthrough is opened

```typescript
{
  'step': 'welcome-in-trial' | 'welcome-paid' | 'welcome-in-trial-expired' | 'get-started-community' | 'visualize-code-history' | 'accelerate-pr-reviews' | 'streamline-collaboration' | 'improve-workflows-with-integrations'
}
```

### graph/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### patchDetails/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### settings/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### timeline/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### welcome/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### commitDetails/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### graphDetails/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### home/showAborted

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### patchDetails/shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### settings/shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### welcome/shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

### home/shown

```typescript
{
  'duration': number,
  'loading': false | true,
  'context.webview.id': string,
  'context.webview.type': string,
  'context.webview.instanceId': string,
  'context.webview.host': 'editor' | 'view'
}
```

