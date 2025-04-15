# GitLens Telemetry

> This is a generated file. Do not edit.

## Global Attributes

> Global attributes are sent (if available) with every telemetry event

```typescript
{
  'env': string,
  'extensionId': string,
  'extensionVersion': string,
  'language': string,
  'machineId': string,
  'platform': string,
  'sessionId': string,
  'vscodeEdition': string,
  'vscodeHost': string,
  'vscodeRemoteName': string,
  'vscodeShell': string,
  'vscodeUIKind': string,
  'vscodeVersion': string

  'global.account.createdOn': string,
  'global.account.id': string,
  'global.account.verified': boolean,
  'global.cloudIntegrations.connected.count': number,
  'global.cloudIntegrations.connected.ids': string,
  'global.debugging': boolean,
  // Cohort number between 1 and 100 to use for percentage-based rollouts
  'global.device.cohort': number,
  'global.enabled': boolean,
  'global.folders.count': number,
  'global.folders.schemes': string,
  'global.install': boolean,
  'global.prerelease': boolean,
  'global.providers.count': number,
  'global.providers.ids': string,
  'global.repositories.count': number,
  'global.repositories.hasConnectedRemotes': boolean,
  'global.repositories.hasRemotes': boolean,
  'global.repositories.hasRichRemotes': boolean,
  'global.repositories.remoteProviders': string,
  'global.repositories.schemes': string,
  'global.repositories.visibility': 'private' | 'public' | 'local' | 'mixed',
  'global.repositories.withHostingIntegrations': number,
  'global.repositories.withHostingIntegrationsConnected': number,
  'global.repositories.withRemotes': number,
  'global.subscription.actual.bundle': boolean,
  'global.subscription.actual.cancelled': boolean,
  'global.subscription.actual.expiresOn': string,
  'global.subscription.actual.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'global.subscription.actual.nextTrialOptInDate': string,
  'global.subscription.actual.organizationId': string,
  'global.subscription.actual.startedOn': string,
  'global.subscription.actual.trialReactivationCount': number,
  'global.subscription.effective.bundle': boolean,
  'global.subscription.effective.cancelled': boolean,
  'global.subscription.effective.expiresOn': string,
  'global.subscription.effective.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'global.subscription.effective.nextTrialOptInDate': string,
  'global.subscription.effective.organizationId': string,
  'global.subscription.effective.startedOn': string,
  'global.subscription.effective.trialReactivationCount': number,
  'global.subscription.featurePreviews.graph.day': number,
  [`global.subscription.featurePreviews.graph.day.${number}.startedOn`]: string,
  'global.subscription.featurePreviews.graph.startedOn': string,
  'global.subscription.featurePreviews.graph.status': 'eligible' | 'active' | 'expired',
  'global.subscription.previewTrial.expiresOn': string,
  'global.subscription.previewTrial.startedOn': string,
  // Promo discount code associated with the upgrade
  'global.subscription.promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'global.subscription.promo.key': string,
  'global.subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'global.subscription.stateString': 'verification' | 'free' | 'preview' | 'preview-expired' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown',
  'global.upgrade': boolean,
  'global.upgradedFrom': string,
  'global.workspace.isTrusted': boolean
}
```

## Events

### account/validation/failed

> Sent when account validation fails

```typescript
{
  'account.id': string,
  'code': string,
  'exception': string,
  'statusCode': number
}
```

### activate

> Sent when GitLens is activated

```typescript
{
  'activation.elapsed': number,
  'activation.mode': string,
  [`config.${string}`]: string | number | boolean
}
```

### ai/explain

> Sent when explaining changes from wip, commits, stashes, patches, etc.

```typescript
{
  'changeType': 'wip' | 'stash' | 'commit' | 'draft-stash' | 'draft-patch' | 'draft-suggested_pr_change',
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'change',
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number,
  'warning.exceededLargePromptThreshold': boolean,
  'warning.promptTruncated': boolean
}
```

### ai/generate

> Sent when generating summaries from commits, stashes, patches, etc.

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'commitMessage',
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number,
  'warning.exceededLargePromptThreshold': boolean,
  'warning.promptTruncated': boolean
}
```

or

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'draftType': 'stash' | 'patch' | 'suggested_pr_change',
  'duration': number,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'draftMessage',
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number,
  'warning.exceededLargePromptThreshold': boolean,
  'warning.promptTruncated': boolean
}
```

or

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'stashMessage',
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number,
  'warning.exceededLargePromptThreshold': boolean,
  'warning.promptTruncated': boolean
}
```

or

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'createPullRequest',
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number,
  'warning.exceededLargePromptThreshold': boolean,
  'warning.promptTruncated': boolean
}
```

or

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'changelog',
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number,
  'warning.exceededLargePromptThreshold': boolean,
  'warning.promptTruncated': boolean
}
```

### ai/switchModel

> Sent when switching ai models

```typescript
{
  'model.id': string,
  'model.provider.id': 'anthropic' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'openai' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string
}
```

or

```typescript
{
  'failed': true
}
```

### associateIssueWithBranch/action

> Sent when the user chooses to manage integrations

```typescript
{
  'instance': number,
  'action': 'manage' | 'connect',
  'connected': boolean,
  'items.count': number
}
```

### associateIssueWithBranch/issue/action

> Sent when the user takes an action on an issue

```typescript
{
  'instance': number,
  'action': 'soft-open',
  'connected': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number
}
```

### associateIssueWithBranch/issue/chosen

> Sent when the user chooses an issue to associate with the branch in the second step

```typescript
{
  'instance': number,
  'connected': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number
}
```

### associateIssueWithBranch/open

> Sent when the user opens Start Work; use `instance` to correlate an Associate Issue with Branch "session"

```typescript
{
  'instance': number
}
```

### associateIssueWithBranch/opened

> Sent when the launchpad is opened; use `instance` to correlate an Associate Issue with Branch "session"

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### associateIssueWithBranch/steps/connect

> Sent when the user reaches the "connect an integration" step of Associate Issue with Branch

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### associateIssueWithBranch/steps/issue

> Sent when the user reaches the "choose an issue" step of Associate Issue with Branch

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### associateIssueWithBranch/title/action

> Sent when the user chooses to connect an integration

```typescript
{
  'instance': number,
  'action': 'connect',
  'connected': boolean,
  'items.count': number
}
```

### cloudIntegrations/connected

> Sent when connected to one or more cloud-based integrations from gkdev

```typescript
{
  'integration.connected.ids': string,
  'integration.ids': string
}
```

### cloudIntegrations/connecting

> Sent when connecting to one or more cloud-based integrations

```typescript
{
  'integration.ids': string
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

### cloudIntegrations/getConnection/failed

> Sent when getting a provider token from the api fails

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

### cloudIntegrations/hosting/connected

> Sent when a cloud-based hosting provider is connected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted'
}
```

### cloudIntegrations/hosting/disconnected

> Sent when a cloud-based hosting provider is disconnected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted'
}
```

### cloudIntegrations/issue/connected

> Sent when a cloud-based issue provider is connected

```typescript
{
  'issueProvider.key': string,
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted'
}
```

### cloudIntegrations/issue/disconnected

> Sent when a cloud-based issue provider is disconnected

```typescript
{
  'issueProvider.key': string,
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted'
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

### cloudIntegrations/settingsOpened

> Sent when a user chooses to manage the cloud integrations

```typescript
{
  'integration.id': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted'
}
```

### codeSuggestionArchived

> Sent when a code suggestion is archived

```typescript
{
  // Named for compatibility with other GK surfaces
  'draftId': string,
  'provider': string,
  // Named for compatibility with other GK surfaces
  'reason': 'committed' | 'rejected' | 'accepted',
  // Named for compatibility with other GK surfaces
  'repoPrivacy': 'private' | 'public' | 'local',
  'repository.visibility': 'private' | 'public' | 'local'
}
```

### codeSuggestionCreated

> Sent when a code suggestion is created

```typescript
{
  // Named for compatibility with other GK surfaces
  'draftId': string,
  // Named for compatibility with other GK surfaces
  'draftPrivacy': 'private' | 'public' | 'invite_only' | 'provider_access',
  // Named for compatibility with other GK surfaces
  'filesChanged': number,
  'provider': string,
  // Named for compatibility with other GK surfaces
  'repoPrivacy': 'private' | 'public' | 'local',
  'repository.visibility': 'private' | 'public' | 'local',
  // Named for compatibility with other GK surfaces
  'source': 'reviewMode'
}
```

### codeSuggestionViewed

> Sent when a code suggestion is opened

```typescript
{
  // Named for compatibility with other GK surfaces
  'draftId': string,
  // Named for compatibility with other GK surfaces
  'draftPrivacy': 'private' | 'public' | 'invite_only' | 'provider_access',
  'provider': string,
  // Named for compatibility with other GK surfaces
  'repoPrivacy': 'private' | 'public' | 'local',
  'repository.visibility': 'private' | 'public' | 'local',
  // Named for compatibility with other GK surfaces
  'source': string
}
```

### command

> Sent when a GitLens command is executed

```typescript
{
  'command': string,
  'webview': string
}
```

or

```typescript
{
  'command': 'gitlens.gitCommands',
  'context.mode': string,
  'context.submode': string,
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

### commitDetails/mode/changed

> Sent when the user changes the selected tab (mode) on the Graph Details view

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.codeSuggestions': number,
  'context.inReview': boolean,
  'context.mode': 'wip',
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'mode.new': 'wip' | 'commit',
  'mode.old': 'wip' | 'commit'
}
```

or

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.mode': 'commit',
  'context.pinned': boolean,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'mode.new': 'wip' | 'commit',
  'mode.old': 'wip' | 'commit'
}
```

### commitDetails/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### commitDetails/shown

> Sent when the Inspect view is shown

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.codeSuggestions': number,
  'context.config.autolinks.enabled': boolean,
  'context.config.autolinks.enhanced': boolean,
  'context.config.avatars': boolean,
  'context.config.files.compact': boolean,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.pullRequests.enabled': boolean,
  'context.inReview': boolean,
  'context.mode': 'wip',
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

or

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.config.autolinks.enabled': boolean,
  'context.config.autolinks.enhanced': boolean,
  'context.config.avatars': boolean,
  'context.config.files.compact': boolean,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.pullRequests.enabled': boolean,
  'context.mode': 'commit',
  'context.pinned': boolean,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### graph/action/jumpTo

> Sent when the user clicks on the Jump to HEAD/Reference (alt) header button on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'target': 'HEAD' | 'choose'
}
```

### graph/action/openRepoOnRemote

> Sent when the user clicks on the "Jump to HEAD"/"Jump to Reference" (alt) header button on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/action/sidebar

> Sent when the user clicks on the "Open Repository on Remote" header button on the Commit Graph

```typescript
{
  'action': string,
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/branchesVisibility/changed

> Sent when the user changes the "branches visibility" on the Commit Graph

```typescript
{
  'branchesVisibility.new': 'all' | 'smart' | 'current',
  'branchesVisibility.old': 'all' | 'smart' | 'current',
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/columns/changed

> Sent when the user changes the columns on the Commit Graph

```typescript
{
  [`column.${string}.isHidden`]: boolean,
  [`column.${string}.mode`]: string,
  [`column.${string}.order`]: number,
  [`column.${string}.width`]: number,
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/command

> Sent when a Commit Graph command is executed

```typescript
{
  'command': string,
  'webview': string
}
```

### graph/filters/changed

> Sent when the user changes the filters on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'key': string,
  'value': boolean
}
```

### graph/minimap/day/selected

> Sent when the user selects (clicks on) a day on the minimap on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/repository/changed

> Sent when the user changes the current repository on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'repository.closed': boolean,
  'repository.folder.scheme': string,
  'repository.id': string,
  'repository.provider.id': string,
  'repository.scheme': string
}
```

### graph/row/hovered

> Sent when the user hovers over a row on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/row/selected

> Sent when the user selects (clicks on) a row or rows on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'rows': number
}
```

### graph/rows/loaded

> Sent when rows are loaded into the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'rows': number
}
```

### graph/searched

> Sent when a search was performed on the Commit Graph

```typescript
{
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'matches': number,
  'types': string
}
```

### graph/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### graph/shown

> Sent when the Commit Graph is shown

```typescript
{
  [`context.column.${string}.mode`]: string,
  [`context.column.${string}.visible`]: boolean,
  'context.config.allowMultiple': boolean,
  'context.config.avatars': boolean,
  'context.config.branchesVisibility': 'all' | 'smart' | 'current',
  'context.config.commitOrdering': 'date' | 'author-date' | 'topo',
  'context.config.dateFormat': string,
  'context.config.dateStyle': 'absolute' | 'relative',
  'context.config.defaultItemLimit': number,
  'context.config.dimMergeCommits': boolean,
  'context.config.experimental.renderer.enabled': boolean,
  'context.config.highlightRowsOnRefHover': boolean,
  'context.config.issues.enabled': boolean,
  'context.config.layout': 'editor' | 'panel',
  'context.config.minimap.additionalTypes': string,
  'context.config.minimap.dataType': 'commits' | 'lines',
  'context.config.minimap.enabled': boolean,
  'context.config.multiselect': boolean,
  'context.config.onlyFollowFirstParent': boolean,
  'context.config.pageItemLimit': number,
  'context.config.pullRequests.enabled': boolean,
  'context.config.scrollMarkers.additionalTypes': string,
  'context.config.scrollMarkers.enabled': boolean,
  'context.config.scrollRowPadding': number,
  'context.config.searchItemLimit': number,
  'context.config.showDetailsView': false | 'open' | 'selection',
  'context.config.showGhostRefsOnRowHover': boolean,
  'context.config.showRemoteNames': boolean,
  'context.config.showUpstreamStatus': boolean,
  'context.config.sidebar.enabled': boolean,
  'context.config.statusBar.enabled': boolean,
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### graphDetails/mode/changed

> Sent when the user changes the selected tab (mode) on the Graph Details view

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.codeSuggestions': number,
  'context.inReview': boolean,
  'context.mode': 'wip',
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'mode.new': 'wip' | 'commit',
  'mode.old': 'wip' | 'commit'
}
```

or

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.mode': 'commit',
  'context.pinned': boolean,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'mode.new': 'wip' | 'commit',
  'mode.old': 'wip' | 'commit'
}
```

### graphDetails/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### graphDetails/shown

> Sent when the Graph Details view is shown

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.codeSuggestions': number,
  'context.config.autolinks.enabled': boolean,
  'context.config.autolinks.enhanced': boolean,
  'context.config.avatars': boolean,
  'context.config.files.compact': boolean,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.pullRequests.enabled': boolean,
  'context.inReview': boolean,
  'context.mode': 'wip',
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

or

```typescript
{
  'context.attachedTo': 'graph' | 'default',
  'context.autolinks': number,
  'context.config.autolinks.enabled': boolean,
  'context.config.autolinks.enhanced': boolean,
  'context.config.avatars': boolean,
  'context.config.files.compact': boolean,
  'context.config.files.icon': 'status' | 'type',
  'context.config.files.layout': 'auto' | 'list' | 'tree',
  'context.config.files.threshold': number,
  'context.config.pullRequests.enabled': boolean,
  'context.mode': 'commit',
  'context.pinned': boolean,
  'context.type': 'stash' | 'commit',
  'context.uncommitted': boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### home/command

> Sent when a Home command is executed

```typescript
{
  'command': string,
  'webview': string
}
```

### home/createBranch

> Sent when the user chooses to create a branch from the home view

```typescript
void
```

### home/preview/toggled

> Sent when the new Home view preview is toggled on/off

```typescript
{
  'enabled': boolean,
  'version': string
}
```

### home/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### home/shown

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### home/startWork

> Sent when the user chooses to start work on an issue from the home view

```typescript
void
```

### launchpad/action

> Sent when the user takes an action on a launchpad item

```typescript
{
  'instance': number,
  'items.error': string,
  'action': 'soft-open' | 'open' | 'code-suggest' | 'merge' | 'switch' | 'open-worktree' | 'switch-and-code-suggest' | 'show-overview' | 'open-changes' | 'open-in-graph' | 'pin' | 'unpin' | 'snooze' | 'unsnooze' | 'open-suggestion' | 'open-suggestion-browser',
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### launchpad/configurationChanged

> Sent when the user changes launchpad configuration settings

```typescript
{
  'config.launchpad.ignoredOrganizations': number,
  'config.launchpad.ignoredRepositories': number,
  'config.launchpad.includedOrganizations': number,
  'config.launchpad.indicator.enabled': boolean,
  'config.launchpad.indicator.groups': string,
  'config.launchpad.indicator.icon': 'default' | 'group',
  'config.launchpad.indicator.label': false | 'item' | 'counts',
  'config.launchpad.indicator.polling.enabled': boolean,
  'config.launchpad.indicator.polling.interval': number,
  'config.launchpad.indicator.useColors': boolean,
  'config.launchpad.staleThreshold': number
}
```

### launchpad/groupToggled

> Sent when the user expands/collapses a launchpad group

```typescript
{
  'instance': number,
  'items.error': string,
  'collapsed': boolean,
  'group': 'current-branch' | 'pinned' | 'mergeable' | 'blocked' | 'follow-up' | 'needs-review' | 'waiting-for-review' | 'draft' | 'other' | 'snoozed',
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### launchpad/indicator/firstLoad

> Sent when the launchpad indicator loads (with data) for the first time ever for this device

```typescript
void
```

### launchpad/indicator/hidden

> Sent when the user hides the launchpad indicator

```typescript
void
```

### launchpad/open

> Sent when the user opens launchpad; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean
}
```

### launchpad/opened

> Sent when the launchpad is opened; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'items.error': string,
  'connected': boolean,
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### launchpad/operation/slow

> Sent when a launchpad operation is taking longer than a set timeout to complete

```typescript
{
  'duration': number,
  'operation': 'getPullRequest' | 'searchPullRequests' | 'getMyPullRequests' | 'getCodeSuggestions' | 'getEnrichedItems' | 'getCodeSuggestionCounts',
  'timeout': number
}
```

### launchpad/steps/connect

> Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is disconnected; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'items.error': string,
  'connected': boolean,
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### launchpad/steps/details

> Sent when the user opens the details of a launchpad item (e.g. click on an item); use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'items.error': string,
  'action': 'select',
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### launchpad/steps/main

> Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is connected; use `instance` to correlate a launchpad "session"

```typescript
{
  'instance': number,
  'items.error': string,
  'connected': boolean,
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### launchpad/title/action

> Sent when the user takes an action on the Launchpad title bar

```typescript
{
  'instance': number,
  'items.error': string,
  'action': 'settings' | 'connect' | 'feedback' | 'open-on-gkdev' | 'refresh',
  'groups.blocked.collapsed': boolean,
  'groups.blocked.count': number,
  'groups.count': number,
  'groups.current-branch.collapsed': boolean,
  'groups.current-branch.count': number,
  'groups.draft.collapsed': boolean,
  'groups.draft.count': number,
  'groups.follow-up.collapsed': boolean,
  'groups.follow-up.count': number,
  'groups.mergeable.collapsed': boolean,
  'groups.mergeable.count': number,
  'groups.needs-review.collapsed': boolean,
  'groups.needs-review.count': number,
  'groups.other.collapsed': boolean,
  'groups.other.count': number,
  'groups.pinned.collapsed': boolean,
  'groups.pinned.count': number,
  'groups.snoozed.collapsed': boolean,
  'groups.snoozed.count': number,
  'groups.waiting-for-review.collapsed': boolean,
  'groups.waiting-for-review.count': number,
  'initialState.group': string,
  'initialState.selectTopItem': boolean,
  'items.count': number,
  'items.timings.codeSuggestionCounts': number,
  'items.timings.enrichedItems': number,
  'items.timings.prs': number
}
```

### openReviewMode

> Sent when a PR review was started in the inspect overview

```typescript
{
  'filesChanged': number,
  'provider': string,
  // Provided for compatibility with other GK surfaces
  'repoPrivacy': 'private' | 'public' | 'local',
  'repository.visibility': 'private' | 'public' | 'local',
  // Provided for compatibility with other GK surfaces
  'source': 'account' | 'subscription' | 'graph' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'view' | 'code-suggest' | 'ai' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'commandPalette' | 'deeplink' | 'feature-badge' | 'feature-gate' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'startWork' | 'trial-indicator' | 'scm-input' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### patchDetails/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### patchDetails/shown

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### productConfig/failed

> Sent when fetching the product config fails

```typescript
{
  'exception': string,
  'json': string,
  'reason': 'fetch' | 'validation',
  'statusCode': number
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
  'config.git.autoRepositoryDetection': boolean | 'subFolders' | 'openEditors'
}
```

### remoteProviders/connected

> Sent when a local (Git remote-based) hosting provider is connected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted',
  // @deprecated: true
  'remoteProviders.key': string
}
```

### remoteProviders/disconnected

> Sent when a local (Git remote-based) hosting provider is disconnected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'jira' | 'trello' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'cloud-gitlab-self-hosted' | 'gitlab-self-hosted',
  // @deprecated: true
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
  'repository.closed': boolean,
  'repository.contributors.commits.avgPerContributor': number,
  'repository.contributors.commits.count': number,
  'repository.contributors.count': number,
  'repository.contributors.distribution.[1]': number,
  'repository.contributors.distribution.[101+]': number,
  'repository.contributors.distribution.[11-50]': number,
  'repository.contributors.distribution.[2-5]': number,
  'repository.contributors.distribution.[51-100]': number,
  'repository.contributors.distribution.[6-10]': number,
  'repository.contributors.since': '1.year.ago',
  'repository.folder.scheme': string,
  'repository.id': string,
  'repository.provider.id': string,
  'repository.remoteProviders': string,
  'repository.scheme': string
}
```

### repository/visibility

> Sent when a repository's visibility is first requested

```typescript
{
  'repository.closed': boolean,
  'repository.folder.scheme': string,
  'repository.id': string,
  'repository.provider.id': string,
  'repository.scheme': string,
  'repository.visibility': 'private' | 'public' | 'local'
}
```

### settings/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### settings/shown

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### startWork/action

> Sent when the user chooses to manage integrations

```typescript
{
  'instance': number,
  'action': 'manage' | 'connect',
  'connected': boolean,
  'items.count': number
}
```

### startWork/issue/action

> Sent when the user takes an action on a StartWork issue

```typescript
{
  'instance': number,
  'action': 'soft-open',
  'connected': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number
}
```

### startWork/issue/chosen

> Sent when the user chooses an issue to start work in the second step

```typescript
{
  'instance': number,
  'connected': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number
}
```

### startWork/open

> Sent when the user opens Start Work; use `instance` to correlate a StartWork "session"

```typescript
{
  'instance': number
}
```

### startWork/opened

> Sent when the launchpad is opened; use `instance` to correlate a StartWork "session"

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### startWork/steps/connect

> Sent when the user reaches the "connect an integration" step of Start Work

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### startWork/steps/issue

> Sent when the user reaches the "choose an issue" step of Start Work

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### startWork/title/action

> Sent when the user chooses to connect an integration

```typescript
{
  'instance': number,
  'action': 'connect',
  'connected': boolean,
  'items.count': number
}
```

### subscription

> Sent when the subscription is loaded

```typescript
{
  'account.createdOn': string,
  'account.id': string,
  'account.verified': boolean,
  'subscription.actual.bundle': boolean,
  'subscription.actual.cancelled': boolean,
  'subscription.actual.expiresOn': string,
  'subscription.actual.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'subscription.actual.nextTrialOptInDate': string,
  'subscription.actual.organizationId': string,
  'subscription.actual.startedOn': string,
  'subscription.actual.trialReactivationCount': number,
  'subscription.effective.bundle': boolean,
  'subscription.effective.cancelled': boolean,
  'subscription.effective.expiresOn': string,
  'subscription.effective.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'subscription.effective.nextTrialOptInDate': string,
  'subscription.effective.organizationId': string,
  'subscription.effective.startedOn': string,
  'subscription.effective.trialReactivationCount': number,
  'subscription.featurePreviews.graph.day': number,
  [`subscription.featurePreviews.graph.day.${number}.startedOn`]: string,
  'subscription.featurePreviews.graph.startedOn': string,
  'subscription.featurePreviews.graph.status': 'eligible' | 'active' | 'expired',
  'subscription.previewTrial.expiresOn': string,
  'subscription.previewTrial.startedOn': string,
  // Promo discount code associated with the upgrade
  'subscription.promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'subscription.promo.key': string,
  'subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'subscription.stateString': 'verification' | 'free' | 'preview' | 'preview-expired' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
}
```

### subscription/action

> Sent when the user takes an action on the subscription

```typescript
{
  'action': 'manage' | 'sign-up' | 'sign-in' | 'sign-out' | 'manage-subscription' | 'reactivate' | 'refer-friend' | 'resend-verification' | 'pricing' | 'start-preview-trial'
}
```

or

```typescript
{
  // `true` if the user cancels the VS Code prompt to open the browser
  'aborted': boolean,
  'action': 'upgrade',
  // Promo discount code associated with the upgrade
  'promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'promo.key': string
}
```

or

```typescript
{
  'action': 'visibility',
  'visible': boolean
}
```

or

```typescript
{
  'action': 'start-preview-trial:graph',
  'day': number,
  [`day.${number}.startedOn`]: string,
  'feature': 'graph',
  'startedOn': string,
  'status': 'eligible' | 'active' | 'expired'
}
```

### subscription/changed

> Sent when the subscription changes

```typescript
{
  'account.createdOn': string,
  'account.id': string,
  'account.verified': boolean,
  'previous.account.createdOn': string,
  'previous.account.id': string,
  'previous.account.verified': boolean,
  'previous.subscription.actual.bundle': boolean,
  'previous.subscription.actual.cancelled': boolean,
  'previous.subscription.actual.expiresOn': string,
  'previous.subscription.actual.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'previous.subscription.actual.nextTrialOptInDate': string,
  'previous.subscription.actual.organizationId': string,
  'previous.subscription.actual.startedOn': string,
  'previous.subscription.actual.trialReactivationCount': number,
  'previous.subscription.effective.bundle': boolean,
  'previous.subscription.effective.cancelled': boolean,
  'previous.subscription.effective.expiresOn': string,
  'previous.subscription.effective.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'previous.subscription.effective.nextTrialOptInDate': string,
  'previous.subscription.effective.organizationId': string,
  'previous.subscription.effective.startedOn': string,
  'previous.subscription.effective.trialReactivationCount': number,
  'previous.subscription.previewTrial.expiresOn': string,
  'previous.subscription.previewTrial.startedOn': string,
  'subscription.actual.bundle': boolean,
  'subscription.actual.cancelled': boolean,
  'subscription.actual.expiresOn': string,
  'subscription.actual.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'subscription.actual.nextTrialOptInDate': string,
  'subscription.actual.organizationId': string,
  'subscription.actual.startedOn': string,
  'subscription.actual.trialReactivationCount': number,
  'subscription.effective.bundle': boolean,
  'subscription.effective.cancelled': boolean,
  'subscription.effective.expiresOn': string,
  'subscription.effective.id': 'community' | 'community-with-account' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'subscription.effective.nextTrialOptInDate': string,
  'subscription.effective.organizationId': string,
  'subscription.effective.startedOn': string,
  'subscription.effective.trialReactivationCount': number,
  'subscription.featurePreviews.graph.day': number,
  [`subscription.featurePreviews.graph.day.${number}.startedOn`]: string,
  'subscription.featurePreviews.graph.startedOn': string,
  'subscription.featurePreviews.graph.status': 'eligible' | 'active' | 'expired',
  'subscription.previewTrial.expiresOn': string,
  'subscription.previewTrial.startedOn': string,
  // Promo discount code associated with the upgrade
  'subscription.promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'subscription.promo.key': string,
  'subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'subscription.stateString': 'verification' | 'free' | 'preview' | 'preview-expired' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
}
```

### timeline/action/openInEditor

> Sent when the user changes the period (timeframe) on the Visual History

```typescript
{
  'context.period': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### timeline/commit/selected

> Sent when the user selects (clicks on) a commit on the Visual History

```typescript
{
  'context.period': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### timeline/editor/changed

> Sent when the editor changes on the Visual History

```typescript
{
  'context.period': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### timeline/period/changed

> Sent when the user changes the period (timeframe) on the Visual History

```typescript
{
  'context.period': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'period.new': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'period.old': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`
}
```

### timeline/showAborted

```typescript
{
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### timeline/shown

> Sent when the Visual History is shown

```typescript
{
  'context.config.allowMultiple': boolean,
  'context.config.queryLimit': number,
  'context.period': string,
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### usage/track

> Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown

```typescript
{
  'usage.count': number,
  'usage.key': 'graphWebview:shown' | 'patchDetailsWebview:shown' | 'settingsWebview:shown' | 'timelineWebview:shown' | 'graphView:shown' | 'patchDetailsView:shown' | 'timelineView:shown' | 'commitDetailsView:shown' | 'graphDetailsView:shown' | 'homeView:shown' | 'commitsView:shown' | 'stashesView:shown' | 'tagsView:shown' | 'launchpadView:shown' | 'worktreesView:shown' | 'branchesView:shown' | 'contributorsView:shown' | 'draftsView:shown' | 'fileHistoryView:shown' | 'scm.groupedView:shown' | 'lineHistoryView:shown' | 'pullRequestView:shown' | 'remotesView:shown' | 'repositoriesView:shown' | 'searchAndCompareView:shown' | 'workspacesView:shown' | 'rebaseEditor:shown' | `command:${string}:executed` | 'home:walkthrough:dismissed'
}
```

### walkthrough

> Sent when the walkthrough is opened

```typescript
{
  'step': 'welcome-in-trial' | 'welcome-paid' | 'welcome-in-trial-expired-eligible' | 'welcome-in-trial-expired' | 'get-started-community' | 'visualize-code-history' | 'accelerate-pr-reviews' | 'streamline-collaboration' | 'improve-workflows-with-integrations'
}
```

### walkthrough/action

> Sent when the walkthrough is opened

```typescript
{
  'command': string,
  'name': 'open/help-center/start-integrations' | 'open/help-center/accelerate-pr-reviews' | 'open/help-center/streamline-collaboration' | 'open/help-center/interactive-code-history' | 'open/help-center/community-vs-pro' | 'open/help-center/home-view' | 'open/devex-platform' | 'open/drafts' | 'open/home' | 'connect/integrations' | 'open/autolinks' | 'open/graph' | 'open/launchpad' | 'create/worktree' | 'open/help-center' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'open/walkthrough' | 'open/inspect',
  'type': 'command'
}
```

or

```typescript
{
  'name': 'open/help-center/start-integrations' | 'open/help-center/accelerate-pr-reviews' | 'open/help-center/streamline-collaboration' | 'open/help-center/interactive-code-history' | 'open/help-center/community-vs-pro' | 'open/help-center/home-view' | 'open/devex-platform' | 'open/drafts' | 'open/home' | 'connect/integrations' | 'open/autolinks' | 'open/graph' | 'open/launchpad' | 'create/worktree' | 'open/help-center' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'open/walkthrough' | 'open/inspect',
  'type': 'url',
  'url': string
}
```

### walkthrough/completion

```typescript
{
  'context.key': 'integrations' | 'homeView' | 'gettingStarted' | 'visualizeCodeHistory' | 'prReviews' | 'streamlineCollaboration'
}
```

