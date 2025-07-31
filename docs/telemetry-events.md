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
  // Promo discount code associated with the upgrade
  'global.subscription.promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'global.subscription.promo.key': string,
  'global.subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'global.subscription.stateString': 'verification' | 'free' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown',
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
  'changeType': 'wip' | 'stash' | 'commit' | 'branch' | 'draft-stash' | 'draft-patch' | 'draft-suggested_pr_change',
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
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

### ai/feedback

> Sent when a user provides feedback (rating and optional details) for an AI feature

```typescript
{
  'feature': string,
  'id': string,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'sentiment': 'helpful' | 'unhelpful',
  // The AI feature that feedback was submitted for
  'type': 'explain-changes' | 'generate-commitMessage' | 'generate-stashMessage' | 'generate-changelog' | 'generate-create-cloudPatch' | 'generate-create-codeSuggestion' | 'generate-create-pullRequest' | 'generate-rebase' | 'generate-searchQuery',
  // Custom feedback provided (if any)
  'unhelpful.custom': string,
  // Unhelpful reasons selected (if any) - comma-separated list of AIFeedbackUnhelpfulReasons values
  'unhelpful.reasons': string,
  'usage.completionTokens': number,
  'usage.limits.limit': number,
  'usage.limits.resetsOn': string,
  'usage.limits.used': number,
  'usage.promptTokens': number,
  'usage.totalTokens': number
}
```

### ai/generate

> Sent when generating summaries from commits, stashes, patches, etc.

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
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

or

```typescript
{
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'duration': number,
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
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
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
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
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
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
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'rebase',
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
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string,
  'output.length': number,
  'retry.count': number,
  'type': 'searchQuery',
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
  'failed': boolean,
  'failed.cancelled.reason': 'large-prompt',
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'user-declined' | 'user-cancelled' | 'error',
  'id': string,
  'input.length': number,
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
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

### ai/switchModel

> Sent when switching ai models

```typescript
{
  'model.id': string,
  'model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'model.provider.name': string
}
```

or

```typescript
{
  'failed': true
}
```

### aiAllAccess/bannerDismissed

> Sent when user dismisses the AI All Access banner

```typescript
void
```

### aiAllAccess/opened

> Sent when user opens the AI All Access page

```typescript
void
```

### aiAllAccess/optedIn

> Sent when user opts in to AI All Access

```typescript
void
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
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello'
}
```

### cloudIntegrations/hosting/disconnected

> Sent when a cloud-based hosting provider is disconnected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello'
}
```

### cloudIntegrations/issue/connected

> Sent when a cloud-based issue provider is connected

```typescript
{
  'issueProvider.key': string,
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello'
}
```

### cloudIntegrations/issue/disconnected

> Sent when a cloud-based issue provider is disconnected

```typescript
{
  'issueProvider.key': string,
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello'
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

### cloudIntegrations/refreshConnection/skippedUnusualToken

> Sent when a connection session has a missing expiry date
or when connection refresh is skipped due to being a non-cloud session

```typescript
{
  'cloud': boolean,
  'integration.id': string,
  'reason': 'skip-non-cloud' | 'missing-expiry'
}
```

### cloudIntegrations/settingsOpened

> Sent when a user chooses to manage the cloud integrations

```typescript
{
  'integration.id': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello'
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
  'branchesVisibility.new': 'all' | 'smart' | 'current' | 'favorited',
  'branchesVisibility.old': 'all' | 'smart' | 'current' | 'favorited',
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

> Sent when the user hovers over a row on the Commit Graph (first time and every 100 times after)

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
  'count': number
}
```

### graph/row/selected

> Sent when the user selects (clicks on) a row or rows on the Commit Graph (first time and every 100 times after)

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
  'count': number,
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
  'failed': boolean,
  'failed.error': string,
  'failed.error.detail': string,
  'failed.reason': 'cancelled' | 'error',
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
  'context.config.branchesVisibility': 'all' | 'smart' | 'current' | 'favorited',
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
  'context.config.multiselect': boolean | 'topological',
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

### home/changeBranchMergeTarget

> Sent when the user starts defining a user-specific merge target branch

```typescript
void
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

### home/enableAi

> Sent when the user chooses to enable AI from the integrations menu

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
  'source': 'account' | 'subscription' | 'graph' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'view' | 'code-suggest' | 'ai' | 'ai:markdown-preview' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'rebaseEditor' | 'remoteProvider' | 'scm-input' | 'startWork' | 'trial-indicator' | 'walkthrough' | 'whatsnew' | 'worktrees'
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
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello',
  // @deprecated: true
  'remoteProviders.key': string
}
```

### remoteProviders/disconnected

> Sent when a local (Git remote-based) hosting provider is disconnected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'trello',
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
  // Promo discount code associated with the upgrade
  'subscription.promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'subscription.promo.key': string,
  'subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'subscription.stateString': 'verification' | 'free' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
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
  // Promo discount code associated with the upgrade
  'subscription.promo.code': string,
  // Promo key (identifier) associated with the upgrade
  'subscription.promo.key': string,
  'subscription.state': -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6,
  'subscription.stateString': 'verification' | 'free' | 'trial' | 'trial-expired' | 'trial-reactivation-eligible' | 'paid' | 'unknown'
}
```

### timeline/action/openInEditor

> Sent when the user clicks on the "Open in Editor" button on the Visual History

```typescript
{
  'context.period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.scope.hasBase': boolean,
  'context.scope.hasHead': boolean,
  'context.scope.type': 'file' | 'folder' | 'repo',
  'context.showAllBranches': boolean,
  'context.sliceBy': 'branch' | 'author',
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'scope.hasBase': boolean,
  'scope.hasHead': boolean,
  'scope.type': 'file' | 'folder' | 'repo'
}
```

### timeline/commit/selected

> Sent when the user selects (clicks on) a commit on the Visual History

```typescript
{
  'context.period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.scope.hasBase': boolean,
  'context.scope.hasHead': boolean,
  'context.scope.type': 'file' | 'folder' | 'repo',
  'context.showAllBranches': boolean,
  'context.sliceBy': 'branch' | 'author',
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### timeline/config/changed

> Sent when the user changes the configuration of the Visual History (e.g. period, show all branches, etc)

```typescript
{
  'context.period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.scope.hasBase': boolean,
  'context.scope.hasHead': boolean,
  'context.scope.type': 'file' | 'folder' | 'repo',
  'context.showAllBranches': boolean,
  'context.sliceBy': 'branch' | 'author',
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'showAllBranches': boolean,
  'sliceBy': 'branch' | 'author'
}
```

### timeline/editor/changed

> Sent when the editor changes on the Visual History

```typescript
{
  'context.period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.scope.hasBase': boolean,
  'context.scope.hasHead': boolean,
  'context.scope.type': 'file' | 'folder' | 'repo',
  'context.showAllBranches': boolean,
  'context.sliceBy': 'branch' | 'author',
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### timeline/scope/changed

> Sent when the scope (file/folder/repo) changes on the Visual History

```typescript
{
  'context.period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.scope.hasBase': boolean,
  'context.scope.hasHead': boolean,
  'context.scope.type': 'file' | 'folder' | 'repo',
  'context.showAllBranches': boolean,
  'context.sliceBy': 'branch' | 'author',
  'context.webview.host': 'editor' | 'view',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
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
  'context.period': 'all' | `${number}|D` | `${number}|M` | `${number}|Y`,
  'context.scope.hasBase': boolean,
  'context.scope.hasHead': boolean,
  'context.scope.type': 'file' | 'folder' | 'repo',
  'context.showAllBranches': boolean,
  'context.sliceBy': 'branch' | 'author',
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
  'usage.key': 'rebaseEditor:shown' | 'graphWebview:shown' | 'patchDetailsWebview:shown' | 'settingsWebview:shown' | 'timelineWebview:shown' | 'graphView:shown' | 'patchDetailsView:shown' | 'timelineView:shown' | 'commitDetailsView:shown' | 'graphDetailsView:shown' | 'homeView:shown' | 'pullRequestView:shown' | 'commitsView:shown' | 'stashesView:shown' | 'tagsView:shown' | 'launchpadView:shown' | 'worktreesView:shown' | 'branchesView:shown' | 'contributorsView:shown' | 'draftsView:shown' | 'fileHistoryView:shown' | 'scm.groupedView:shown' | 'lineHistoryView:shown' | 'remotesView:shown' | 'repositoriesView:shown' | 'searchAndCompareView:shown' | 'workspacesView:shown' | 'command:gitlens.key.alt+,:executed' | 'command:gitlens.key.alt+.:executed' | 'command:gitlens.key.alt+enter:executed' | 'command:gitlens.key.alt+left:executed' | 'command:gitlens.key.alt+right:executed' | 'command:gitlens.key.ctrl+enter:executed' | 'command:gitlens.key.ctrl+left:executed' | 'command:gitlens.key.ctrl+right:executed' | 'command:gitlens.key.escape:executed' | 'command:gitlens.key.left:executed' | 'command:gitlens.key.right:executed' | 'command:gitlens.addAuthors:executed' | 'command:gitlens.ai.explainBranch:executed' | 'command:gitlens.ai.explainCommit:executed' | 'command:gitlens.ai.explainStash:executed' | 'command:gitlens.ai.explainWip:executed' | 'command:gitlens.ai.generateChangelog:executed' | 'command:gitlens.ai.generateCommitMessage:executed' | 'command:gitlens.ai.generateCommits:executed' | 'command:gitlens.ai.generateRebase:executed' | 'command:gitlens.ai.switchProvider:executed' | 'command:gitlens.applyPatchFromClipboard:executed' | 'command:gitlens.associateIssueWithBranch:executed' | 'command:gitlens.browseRepoAtRevision:executed' | 'command:gitlens.browseRepoAtRevisionInNewWindow:executed' | 'command:gitlens.browseRepoBeforeRevision:executed' | 'command:gitlens.browseRepoBeforeRevisionInNewWindow:executed' | 'command:gitlens.changeBranchMergeTarget:executed' | 'command:gitlens.clearFileAnnotations:executed' | 'command:gitlens.closeUnchangedFiles:executed' | 'command:gitlens.compareHeadWith:executed' | 'command:gitlens.compareWith:executed' | 'command:gitlens.compareWorkingWith:executed' | 'command:gitlens.connectRemoteProvider:executed' | 'command:gitlens.copyCurrentBranch:executed' | 'command:gitlens.copyDeepLinkToRepo:executed' | 'command:gitlens.copyMessageToClipboard:executed' | 'command:gitlens.copyPatchToClipboard:executed' | 'command:gitlens.copyRelativePathToClipboard:executed' | 'command:gitlens.copyRemoteCommitUrl:executed' | 'command:gitlens.copyRemoteFileUrlFrom:executed' | 'command:gitlens.copyRemoteFileUrlToClipboard:executed' | 'command:gitlens.copyShaToClipboard:executed' | 'command:gitlens.copyWorkingChangesToWorktree:executed' | 'command:gitlens.createCloudPatch:executed' | 'command:gitlens.createPatch:executed' | 'command:gitlens.createPullRequestOnRemote:executed' | 'command:gitlens.diffDirectory:executed' | 'command:gitlens.diffDirectoryWithHead:executed' | 'command:gitlens.diffFolderWithRevision:executed' | 'command:gitlens.diffFolderWithRevisionFrom:executed' | 'command:gitlens.diffLineWithPrevious:executed' | 'command:gitlens.diffLineWithWorking:executed' | 'command:gitlens.diffWithNext:executed' | 'command:gitlens.diffWithPrevious:executed' | 'command:gitlens.diffWithRevision:executed' | 'command:gitlens.diffWithRevisionFrom:executed' | 'command:gitlens.diffWithWorking:executed' | 'command:gitlens.disableDebugLogging:executed' | 'command:gitlens.disableRebaseEditor:executed' | 'command:gitlens.disconnectRemoteProvider:executed' | 'command:gitlens.enableDebugLogging:executed' | 'command:gitlens.enableRebaseEditor:executed' | 'command:gitlens.externalDiff:executed' | 'command:gitlens.externalDiffAll:executed' | 'command:gitlens.fetchRepositories:executed' | 'command:gitlens.getStarted:executed' | 'command:gitlens.gitCommands:executed' | 'command:gitlens.gitCommands.branch:executed' | 'command:gitlens.gitCommands.branch.create:executed' | 'command:gitlens.gitCommands.branch.delete:executed' | 'command:gitlens.gitCommands.branch.prune:executed' | 'command:gitlens.gitCommands.branch.rename:executed' | 'command:gitlens.gitCommands.checkout:executed' | 'command:gitlens.gitCommands.cherryPick:executed' | 'command:gitlens.gitCommands.history:executed' | 'command:gitlens.gitCommands.merge:executed' | 'command:gitlens.gitCommands.rebase:executed' | 'command:gitlens.gitCommands.remote:executed' | 'command:gitlens.gitCommands.remote.add:executed' | 'command:gitlens.gitCommands.remote.prune:executed' | 'command:gitlens.gitCommands.remote.remove:executed' | 'command:gitlens.gitCommands.reset:executed' | 'command:gitlens.gitCommands.revert:executed' | 'command:gitlens.gitCommands.show:executed' | 'command:gitlens.gitCommands.stash:executed' | 'command:gitlens.gitCommands.stash.drop:executed' | 'command:gitlens.gitCommands.stash.list:executed' | 'command:gitlens.gitCommands.stash.pop:executed' | 'command:gitlens.gitCommands.stash.push:executed' | 'command:gitlens.gitCommands.stash.rename:executed' | 'command:gitlens.gitCommands.status:executed' | 'command:gitlens.gitCommands.switch:executed' | 'command:gitlens.gitCommands.tag:executed' | 'command:gitlens.gitCommands.tag.create:executed' | 'command:gitlens.gitCommands.tag.delete:executed' | 'command:gitlens.gitCommands.worktree:executed' | 'command:gitlens.gitCommands.worktree.create:executed' | 'command:gitlens.gitCommands.worktree.delete:executed' | 'command:gitlens.gitCommands.worktree.open:executed' | 'command:gitlens.gk.switchOrganization:executed' | 'command:gitlens.graph.split:executed' | 'command:gitlens.graph.switchToEditorLayout:executed' | 'command:gitlens.graph.switchToPanelLayout:executed' | 'command:gitlens.launchpad.indicator.toggle:executed' | 'command:gitlens.openAssociatedPullRequestOnRemote:executed' | 'command:gitlens.openBlamePriorToChange:executed' | 'command:gitlens.openBranchOnRemote:executed' | 'command:gitlens.openBranchesOnRemote:executed' | 'command:gitlens.openChangedFiles:executed' | 'command:gitlens.openCommitOnRemote:executed' | 'command:gitlens.openCurrentBranchOnRemote:executed' | 'command:gitlens.openFileFromRemote:executed' | 'command:gitlens.openFileHistory:executed' | 'command:gitlens.openFileOnRemote:executed' | 'command:gitlens.openFileOnRemoteFrom:executed' | 'command:gitlens.openFileRevision:executed' | 'command:gitlens.openFileRevisionFrom:executed' | 'command:gitlens.openOnlyChangedFiles:executed' | 'command:gitlens.openPatch:executed' | 'command:gitlens.openRepoOnRemote:executed' | 'command:gitlens.openRevisionFile:executed' | 'command:gitlens.openRevisionFromRemote:executed' | 'command:gitlens.openWorkingFile:executed' | 'command:gitlens.pastePatchFromClipboard:executed' | 'command:gitlens.plus.cloudIntegrations.manage:executed' | 'command:gitlens.plus.hide:executed' | 'command:gitlens.plus.login:executed' | 'command:gitlens.plus.logout:executed' | 'command:gitlens.plus.manage:executed' | 'command:gitlens.plus.reactivateProTrial:executed' | 'command:gitlens.plus.referFriend:executed' | 'command:gitlens.plus.refreshRepositoryAccess:executed' | 'command:gitlens.plus.restore:executed' | 'command:gitlens.plus.signUp:executed' | 'command:gitlens.plus.simulateSubscription:executed' | 'command:gitlens.plus.upgrade:executed' | 'command:gitlens.pullRepositories:executed' | 'command:gitlens.pushRepositories:executed' | 'command:gitlens.quickOpenFileHistory:executed' | 'command:gitlens.reset:executed' | 'command:gitlens.resetViewsLayout:executed' | 'command:gitlens.revealCommitInView:executed' | 'command:gitlens.shareAsCloudPatch:executed' | 'command:gitlens.showAccountView:executed' | 'command:gitlens.showBranchesView:executed' | 'command:gitlens.showCommitDetailsView:executed' | 'command:gitlens.showCommitInView:executed' | 'command:gitlens.showCommitSearch:executed' | 'command:gitlens.showCommitsInView:executed' | 'command:gitlens.showCommitsView:executed' | 'command:gitlens.showContributorsView:executed' | 'command:gitlens.showDraftsView:executed' | 'command:gitlens.showFileHistoryView:executed' | 'command:gitlens.showGraph:executed' | 'command:gitlens.showGraphPage:executed' | 'command:gitlens.showGraphView:executed' | 'command:gitlens.showHomeView:executed' | 'command:gitlens.showLastQuickPick:executed' | 'command:gitlens.showLaunchpad:executed' | 'command:gitlens.showLaunchpadView:executed' | 'command:gitlens.showLineCommitInView:executed' | 'command:gitlens.showLineHistoryView:executed' | 'command:gitlens.showPatchDetailsPage:executed' | 'command:gitlens.showQuickBranchHistory:executed' | 'command:gitlens.showQuickCommitFileDetails:executed' | 'command:gitlens.showQuickFileHistory:executed' | 'command:gitlens.showQuickRepoHistory:executed' | 'command:gitlens.showQuickRepoStatus:executed' | 'command:gitlens.showQuickRevisionDetails:executed' | 'command:gitlens.showQuickStashList:executed' | 'command:gitlens.showRemotesView:executed' | 'command:gitlens.showRepositoriesView:executed' | 'command:gitlens.showSearchAndCompareView:executed' | 'command:gitlens.showSettingsPage:executed' | 'command:gitlens.showSettingsPage!autolinks:executed' | 'command:gitlens.showStashesView:executed' | 'command:gitlens.showTagsView:executed' | 'command:gitlens.showTimelinePage:executed' | 'command:gitlens.showTimelineView:executed' | 'command:gitlens.showWorkspacesView:executed' | 'command:gitlens.showWorktreesView:executed' | 'command:gitlens.startWork:executed' | 'command:gitlens.stashSave:executed' | 'command:gitlens.stashSave.staged:scm:executed' | 'command:gitlens.stashSave.unstaged:scm:executed' | 'command:gitlens.stashSave:scm:executed' | 'command:gitlens.stashesApply:executed' | 'command:gitlens.switchMode:executed' | 'command:gitlens.timeline.split:executed' | 'command:gitlens.toggleCodeLens:executed' | 'command:gitlens.toggleFileBlame:executed' | 'command:gitlens.toggleFileChanges:executed' | 'command:gitlens.toggleFileHeatmap:executed' | 'command:gitlens.toggleGraph:executed' | 'command:gitlens.toggleLineBlame:executed' | 'command:gitlens.toggleMaximizedGraph:executed' | 'command:gitlens.toggleReviewMode:executed' | 'command:gitlens.toggleZenMode:executed' | 'command:gitlens.views.workspaces.create:executed' | 'command:gitlens.visualizeHistory.file:executed' | 'command:gitlens.ai.explainBranch:graph:executed' | 'command:gitlens.ai.explainBranch:views:executed' | 'command:gitlens.ai.explainCommit:graph:executed' | 'command:gitlens.ai.explainCommit:views:executed' | 'command:gitlens.ai.explainStash:graph:executed' | 'command:gitlens.ai.explainStash:views:executed' | 'command:gitlens.ai.explainWip:graph:executed' | 'command:gitlens.ai.explainWip:views:executed' | 'command:gitlens.ai.feedback.helpful:executed' | 'command:gitlens.ai.feedback.helpful.chosen:executed' | 'command:gitlens.ai.feedback.unhelpful:executed' | 'command:gitlens.ai.feedback.unhelpful.chosen:executed' | 'command:gitlens.ai.generateChangelog:views:executed' | 'command:gitlens.ai.generateChangelogFrom:graph:executed' | 'command:gitlens.ai.generateChangelogFrom:views:executed' | 'command:gitlens.ai.generateCommitMessage:graph:executed' | 'command:gitlens.ai.generateCommitMessage:scm:executed' | 'command:gitlens.ai.generateCommits:graph:executed' | 'command:gitlens.ai.generateCommits:views:executed' | 'command:gitlens.ai.rebaseOntoCommit:graph:executed' | 'command:gitlens.ai.rebaseOntoCommit:views:executed' | 'command:gitlens.ai.undoGenerateRebase:executed' | 'command:gitlens.annotations.nextChange:executed' | 'command:gitlens.annotations.previousChange:executed' | 'command:gitlens.changeUpstream:graph:executed' | 'command:gitlens.changeUpstream:views:executed' | 'command:gitlens.computingFileAnnotations:executed' | 'command:gitlens.copyDeepLinkToBranch:executed' | 'command:gitlens.copyDeepLinkToCommit:executed' | 'command:gitlens.copyDeepLinkToComparison:executed' | 'command:gitlens.copyDeepLinkToFile:executed' | 'command:gitlens.copyDeepLinkToFileAtRevision:executed' | 'command:gitlens.copyDeepLinkToLines:executed' | 'command:gitlens.copyDeepLinkToTag:executed' | 'command:gitlens.copyDeepLinkToWorkspace:executed' | 'command:gitlens.copyRemoteBranchUrl:executed' | 'command:gitlens.copyRemoteBranchesUrl:executed' | 'command:gitlens.copyRemoteComparisonUrl:executed' | 'command:gitlens.copyRemoteFileUrlWithoutRange:executed' | 'command:gitlens.copyRemotePullRequestUrl:executed' | 'command:gitlens.copyRemoteRepositoryUrl:executed' | 'command:gitlens.copyWorkingChangesToWorktree:views:executed' | 'command:gitlens.ghpr.views.openOrCreateWorktree:executed' | 'command:gitlens.graph.addAuthor:executed' | 'command:gitlens.graph.associateIssueWithBranch:executed' | 'command:gitlens.graph.cherryPick:executed' | 'command:gitlens.graph.cherryPick.multi:executed' | 'command:gitlens.graph.columnAuthorOff:executed' | 'command:gitlens.graph.columnAuthorOn:executed' | 'command:gitlens.graph.columnChangesOff:executed' | 'command:gitlens.graph.columnChangesOn:executed' | 'command:gitlens.graph.columnDateTimeOff:executed' | 'command:gitlens.graph.columnDateTimeOn:executed' | 'command:gitlens.graph.columnGraphCompact:executed' | 'command:gitlens.graph.columnGraphDefault:executed' | 'command:gitlens.graph.columnGraphOff:executed' | 'command:gitlens.graph.columnGraphOn:executed' | 'command:gitlens.graph.columnMessageOff:executed' | 'command:gitlens.graph.columnMessageOn:executed' | 'command:gitlens.graph.columnRefOff:executed' | 'command:gitlens.graph.columnRefOn:executed' | 'command:gitlens.graph.columnShaOff:executed' | 'command:gitlens.graph.columnShaOn:executed' | 'command:gitlens.graph.commitViaSCM:executed' | 'command:gitlens.graph.compareAncestryWithWorking:executed' | 'command:gitlens.graph.compareBranchWithHead:executed' | 'command:gitlens.graph.compareSelectedCommits.multi:executed' | 'command:gitlens.graph.compareWithHead:executed' | 'command:gitlens.graph.compareWithMergeBase:executed' | 'command:gitlens.graph.compareWithUpstream:executed' | 'command:gitlens.graph.compareWithWorking:executed' | 'command:gitlens.graph.copy:executed' | 'command:gitlens.graph.copyDeepLinkToBranch:executed' | 'command:gitlens.graph.copyDeepLinkToCommit:executed' | 'command:gitlens.graph.copyDeepLinkToRepo:executed' | 'command:gitlens.graph.copyDeepLinkToTag:executed' | 'command:gitlens.graph.copyMessage:executed' | 'command:gitlens.graph.copyRemoteBranchUrl:executed' | 'command:gitlens.graph.copyRemoteCommitUrl:executed' | 'command:gitlens.graph.copyRemoteCommitUrl.multi:executed' | 'command:gitlens.graph.copySha:executed' | 'command:gitlens.graph.copyWorkingChangesToWorktree:executed' | 'command:gitlens.graph.createBranch:executed' | 'command:gitlens.graph.createCloudPatch:executed' | 'command:gitlens.graph.createPatch:executed' | 'command:gitlens.graph.createPullRequest:executed' | 'command:gitlens.graph.createTag:executed' | 'command:gitlens.graph.createWorktree:executed' | 'command:gitlens.graph.deleteBranch:executed' | 'command:gitlens.graph.deleteTag:executed' | 'command:gitlens.graph.fetch:executed' | 'command:gitlens.graph.hideLocalBranch:executed' | 'command:gitlens.graph.hideRefGroup:executed' | 'command:gitlens.graph.hideRemote:executed' | 'command:gitlens.graph.hideRemoteBranch:executed' | 'command:gitlens.graph.hideTag:executed' | 'command:gitlens.graph.mergeBranchInto:executed' | 'command:gitlens.graph.openBranchOnRemote:executed' | 'command:gitlens.graph.openChangedFileDiffs:executed' | 'command:gitlens.graph.openChangedFileDiffsIndividually:executed' | 'command:gitlens.graph.openChangedFileDiffsWithMergeBase:executed' | 'command:gitlens.graph.openChangedFileDiffsWithWorking:executed' | 'command:gitlens.graph.openChangedFileDiffsWithWorkingIndividually:executed' | 'command:gitlens.graph.openChangedFileRevisions:executed' | 'command:gitlens.graph.openChangedFiles:executed' | 'command:gitlens.graph.openCommitOnRemote:executed' | 'command:gitlens.graph.openCommitOnRemote.multi:executed' | 'command:gitlens.graph.openInWorktree:executed' | 'command:gitlens.graph.openOnlyChangedFiles:executed' | 'command:gitlens.graph.openPullRequest:executed' | 'command:gitlens.graph.openPullRequestChanges:executed' | 'command:gitlens.graph.openPullRequestComparison:executed' | 'command:gitlens.graph.openPullRequestOnRemote:executed' | 'command:gitlens.graph.openWorktree:executed' | 'command:gitlens.graph.openWorktreeInNewWindow:executed' | 'command:gitlens.graph.publishBranch:executed' | 'command:gitlens.graph.pull:executed' | 'command:gitlens.graph.push:executed' | 'command:gitlens.graph.pushWithForce:executed' | 'command:gitlens.graph.rebaseOntoBranch:executed' | 'command:gitlens.graph.rebaseOntoCommit:executed' | 'command:gitlens.graph.rebaseOntoUpstream:executed' | 'command:gitlens.graph.refresh:executed' | 'command:gitlens.graph.renameBranch:executed' | 'command:gitlens.graph.resetColumnsCompact:executed' | 'command:gitlens.graph.resetColumnsDefault:executed' | 'command:gitlens.graph.resetCommit:executed' | 'command:gitlens.graph.resetToCommit:executed' | 'command:gitlens.graph.resetToTag:executed' | 'command:gitlens.graph.resetToTip:executed' | 'command:gitlens.graph.revert:executed' | 'command:gitlens.graph.scrollMarkerLocalBranchOff:executed' | 'command:gitlens.graph.scrollMarkerLocalBranchOn:executed' | 'command:gitlens.graph.scrollMarkerPullRequestOff:executed' | 'command:gitlens.graph.scrollMarkerPullRequestOn:executed' | 'command:gitlens.graph.scrollMarkerRemoteBranchOff:executed' | 'command:gitlens.graph.scrollMarkerRemoteBranchOn:executed' | 'command:gitlens.graph.scrollMarkerStashOff:executed' | 'command:gitlens.graph.scrollMarkerStashOn:executed' | 'command:gitlens.graph.scrollMarkerTagOff:executed' | 'command:gitlens.graph.scrollMarkerTagOn:executed' | 'command:gitlens.graph.shareAsCloudPatch:executed' | 'command:gitlens.graph.showInDetailsView:executed' | 'command:gitlens.graph.switchToAnotherBranch:executed' | 'command:gitlens.graph.switchToBranch:executed' | 'command:gitlens.graph.switchToCommit:executed' | 'command:gitlens.graph.switchToTag:executed' | 'command:gitlens.graph.undoCommit:executed' | 'command:gitlens.inviteToLiveShare:executed' | 'command:gitlens.openCloudPatch:executed' | 'command:gitlens.openComparisonOnRemote:executed' | 'command:gitlens.openFolderHistory:executed' | 'command:gitlens.openPullRequestOnRemote:executed' | 'command:gitlens.plus.cloudIntegrations.connect:executed' | 'command:gitlens.regenerateMarkdownDocument:executed' | 'command:gitlens.setUpstream:graph:executed' | 'command:gitlens.setUpstream:views:executed' | 'command:gitlens.showInCommitGraph:executed' | 'command:gitlens.showInCommitGraphView:executed' | 'command:gitlens.showInDetailsView:executed' | 'command:gitlens.showQuickCommitDetails:executed' | 'command:gitlens.showSettingsPage!branches-view:executed' | 'command:gitlens.showSettingsPage!commit-graph:executed' | 'command:gitlens.showSettingsPage!commits-view:executed' | 'command:gitlens.showSettingsPage!contributors-view:executed' | 'command:gitlens.showSettingsPage!file-annotations:executed' | 'command:gitlens.showSettingsPage!file-history-view:executed' | 'command:gitlens.showSettingsPage!line-history-view:executed' | 'command:gitlens.showSettingsPage!remotes-view:executed' | 'command:gitlens.showSettingsPage!repositories-view:executed' | 'command:gitlens.showSettingsPage!search-compare-view:executed' | 'command:gitlens.showSettingsPage!stashes-view:executed' | 'command:gitlens.showSettingsPage!tags-view:executed' | 'command:gitlens.showSettingsPage!views:executed' | 'command:gitlens.showSettingsPage!worktrees-view:executed' | 'command:gitlens.star.branch.multi:views:executed' | 'command:gitlens.star.branch:graph:executed' | 'command:gitlens.star.branch:views:executed' | 'command:gitlens.star.repository.multi:views:executed' | 'command:gitlens.star.repository:views:executed' | 'command:gitlens.stashApply:graph:executed' | 'command:gitlens.stashApply:views:executed' | 'command:gitlens.stashDelete.multi:views:executed' | 'command:gitlens.stashDelete:graph:executed' | 'command:gitlens.stashDelete:views:executed' | 'command:gitlens.stashRename:graph:executed' | 'command:gitlens.stashRename:views:executed' | 'command:gitlens.stashSave.files:scm:executed' | 'command:gitlens.stashSave.files:views:executed' | 'command:gitlens.stashSave:graph:executed' | 'command:gitlens.stashSave:views:executed' | 'command:gitlens.stashesApply:views:executed' | 'command:gitlens.timeline.refresh:executed' | 'command:gitlens.toggleFileChangesOnly:executed' | 'command:gitlens.toggleFileHeatmapInDiffLeft:executed' | 'command:gitlens.toggleFileHeatmapInDiffRight:executed' | 'command:gitlens.unstar.branch.multi:views:executed' | 'command:gitlens.unstar.branch:graph:executed' | 'command:gitlens.unstar.branch:views:executed' | 'command:gitlens.unstar.repository.multi:views:executed' | 'command:gitlens.unstar.repository:views:executed' | 'command:gitlens.views.abortPausedOperation:executed' | 'command:gitlens.views.addAuthor:executed' | 'command:gitlens.views.addAuthor.multi:executed' | 'command:gitlens.views.addAuthors:executed' | 'command:gitlens.views.addPullRequestRemote:executed' | 'command:gitlens.views.addRemote:executed' | 'command:gitlens.views.applyChanges:executed' | 'command:gitlens.views.associateIssueWithBranch:executed' | 'command:gitlens.views.branches.attach:executed' | 'command:gitlens.views.branches.copy:executed' | 'command:gitlens.views.branches.refresh:executed' | 'command:gitlens.views.branches.setFilesLayoutToAuto:executed' | 'command:gitlens.views.branches.setFilesLayoutToList:executed' | 'command:gitlens.views.branches.setFilesLayoutToTree:executed' | 'command:gitlens.views.branches.setLayoutToList:executed' | 'command:gitlens.views.branches.setLayoutToTree:executed' | 'command:gitlens.views.branches.setShowAvatarsOff:executed' | 'command:gitlens.views.branches.setShowAvatarsOn:executed' | 'command:gitlens.views.branches.setShowBranchComparisonOff:executed' | 'command:gitlens.views.branches.setShowBranchComparisonOn:executed' | 'command:gitlens.views.branches.setShowBranchPullRequestOff:executed' | 'command:gitlens.views.branches.setShowBranchPullRequestOn:executed' | 'command:gitlens.views.branches.setShowRemoteBranchesOff:executed' | 'command:gitlens.views.branches.setShowRemoteBranchesOn:executed' | 'command:gitlens.views.branches.setShowStashesOff:executed' | 'command:gitlens.views.branches.setShowStashesOn:executed' | 'command:gitlens.views.branches.viewOptionsTitle:executed' | 'command:gitlens.views.browseRepoAtRevision:executed' | 'command:gitlens.views.browseRepoAtRevisionInNewWindow:executed' | 'command:gitlens.views.browseRepoBeforeRevision:executed' | 'command:gitlens.views.browseRepoBeforeRevisionInNewWindow:executed' | 'command:gitlens.views.cherryPick:executed' | 'command:gitlens.views.cherryPick.multi:executed' | 'command:gitlens.views.clearComparison:executed' | 'command:gitlens.views.clearReviewed:executed' | 'command:gitlens.views.closeRepository:executed' | 'command:gitlens.views.collapseNode:executed' | 'command:gitlens.views.commitDetails.refresh:executed' | 'command:gitlens.views.commits.attach:executed' | 'command:gitlens.views.commits.copy:executed' | 'command:gitlens.views.commits.refresh:executed' | 'command:gitlens.views.commits.setCommitsFilterAuthors:executed' | 'command:gitlens.views.commits.setCommitsFilterOff:executed' | 'command:gitlens.views.commits.setFilesLayoutToAuto:executed' | 'command:gitlens.views.commits.setFilesLayoutToList:executed' | 'command:gitlens.views.commits.setFilesLayoutToTree:executed' | 'command:gitlens.views.commits.setShowAvatarsOff:executed' | 'command:gitlens.views.commits.setShowAvatarsOn:executed' | 'command:gitlens.views.commits.setShowBranchComparisonOff:executed' | 'command:gitlens.views.commits.setShowBranchComparisonOn:executed' | 'command:gitlens.views.commits.setShowBranchPullRequestOff:executed' | 'command:gitlens.views.commits.setShowBranchPullRequestOn:executed' | 'command:gitlens.views.commits.setShowMergeCommitsOff:executed' | 'command:gitlens.views.commits.setShowMergeCommitsOn:executed' | 'command:gitlens.views.commits.setShowStashesOff:executed' | 'command:gitlens.views.commits.setShowStashesOn:executed' | 'command:gitlens.views.commits.viewOptionsTitle:executed' | 'command:gitlens.views.compareAncestryWithWorking:executed' | 'command:gitlens.views.compareBranchWithHead:executed' | 'command:gitlens.views.compareFileWithSelected:executed' | 'command:gitlens.views.compareWithHead:executed' | 'command:gitlens.views.compareWithMergeBase:executed' | 'command:gitlens.views.compareWithSelected:executed' | 'command:gitlens.views.compareWithUpstream:executed' | 'command:gitlens.views.compareWithWorking:executed' | 'command:gitlens.views.continuePausedOperation:executed' | 'command:gitlens.views.contributors.attach:executed' | 'command:gitlens.views.contributors.copy:executed' | 'command:gitlens.views.contributors.refresh:executed' | 'command:gitlens.views.contributors.setFilesLayoutToAuto:executed' | 'command:gitlens.views.contributors.setFilesLayoutToList:executed' | 'command:gitlens.views.contributors.setFilesLayoutToTree:executed' | 'command:gitlens.views.contributors.setShowAllBranchesOff:executed' | 'command:gitlens.views.contributors.setShowAllBranchesOn:executed' | 'command:gitlens.views.contributors.setShowAvatarsOff:executed' | 'command:gitlens.views.contributors.setShowAvatarsOn:executed' | 'command:gitlens.views.contributors.setShowMergeCommitsOff:executed' | 'command:gitlens.views.contributors.setShowMergeCommitsOn:executed' | 'command:gitlens.views.contributors.setShowStatisticsOff:executed' | 'command:gitlens.views.contributors.setShowStatisticsOn:executed' | 'command:gitlens.views.contributors.viewOptionsTitle:executed' | 'command:gitlens.views.copy:executed' | 'command:gitlens.views.copyAsMarkdown:executed' | 'command:gitlens.views.copyRemoteCommitUrl:executed' | 'command:gitlens.views.copyRemoteCommitUrl.multi:executed' | 'command:gitlens.views.copyUrl:executed' | 'command:gitlens.views.copyUrl.multi:executed' | 'command:gitlens.views.createBranch:executed' | 'command:gitlens.views.createPullRequest:executed' | 'command:gitlens.views.createTag:executed' | 'command:gitlens.views.createWorktree:executed' | 'command:gitlens.views.deleteBranch:executed' | 'command:gitlens.views.deleteBranch.multi:executed' | 'command:gitlens.views.deleteTag:executed' | 'command:gitlens.views.deleteTag.multi:executed' | 'command:gitlens.views.deleteWorktree:executed' | 'command:gitlens.views.deleteWorktree.multi:executed' | 'command:gitlens.views.dismissNode:executed' | 'command:gitlens.views.draft.open:executed' | 'command:gitlens.views.draft.openOnWeb:executed' | 'command:gitlens.views.drafts.copy:executed' | 'command:gitlens.views.drafts.create:executed' | 'command:gitlens.views.drafts.delete:executed' | 'command:gitlens.views.drafts.info:executed' | 'command:gitlens.views.drafts.refresh:executed' | 'command:gitlens.views.drafts.setShowAvatarsOff:executed' | 'command:gitlens.views.drafts.setShowAvatarsOn:executed' | 'command:gitlens.views.editNode:executed' | 'command:gitlens.views.expandNode:executed' | 'command:gitlens.views.fetch:executed' | 'command:gitlens.views.fileHistory.attach:executed' | 'command:gitlens.views.fileHistory.changeBase:executed' | 'command:gitlens.views.fileHistory.copy:executed' | 'command:gitlens.views.fileHistory.refresh:executed' | 'command:gitlens.views.fileHistory.setCursorFollowingOff:executed' | 'command:gitlens.views.fileHistory.setCursorFollowingOn:executed' | 'command:gitlens.views.fileHistory.setEditorFollowingOff:executed' | 'command:gitlens.views.fileHistory.setEditorFollowingOn:executed' | 'command:gitlens.views.fileHistory.setModeCommits:executed' | 'command:gitlens.views.fileHistory.setModeContributors:executed' | 'command:gitlens.views.fileHistory.setRenameFollowingOff:executed' | 'command:gitlens.views.fileHistory.setRenameFollowingOn:executed' | 'command:gitlens.views.fileHistory.setShowAllBranchesOff:executed' | 'command:gitlens.views.fileHistory.setShowAllBranchesOn:executed' | 'command:gitlens.views.fileHistory.setShowAvatarsOff:executed' | 'command:gitlens.views.fileHistory.setShowAvatarsOn:executed' | 'command:gitlens.views.fileHistory.setShowMergeCommitsOff:executed' | 'command:gitlens.views.fileHistory.setShowMergeCommitsOn:executed' | 'command:gitlens.views.fileHistory.viewOptionsTitle:executed' | 'command:gitlens.views.graph.openInTab:executed' | 'command:gitlens.views.graph.refresh:executed' | 'command:gitlens.views.graphDetails.refresh:executed' | 'command:gitlens.views.highlightChanges:executed' | 'command:gitlens.views.highlightRevisionChanges:executed' | 'command:gitlens.views.home.disablePreview:executed' | 'command:gitlens.views.home.discussions:executed' | 'command:gitlens.views.home.enablePreview:executed' | 'command:gitlens.views.home.help:executed' | 'command:gitlens.views.home.info:executed' | 'command:gitlens.views.home.issues:executed' | 'command:gitlens.views.home.previewFeedback:executed' | 'command:gitlens.views.home.refresh:executed' | 'command:gitlens.views.home.whatsNew:executed' | 'command:gitlens.views.launchpad.attach:executed' | 'command:gitlens.views.launchpad.copy:executed' | 'command:gitlens.views.launchpad.info:executed' | 'command:gitlens.views.launchpad.refresh:executed' | 'command:gitlens.views.launchpad.setFilesLayoutToAuto:executed' | 'command:gitlens.views.launchpad.setFilesLayoutToList:executed' | 'command:gitlens.views.launchpad.setFilesLayoutToTree:executed' | 'command:gitlens.views.launchpad.setShowAvatarsOff:executed' | 'command:gitlens.views.launchpad.setShowAvatarsOn:executed' | 'command:gitlens.views.launchpad.viewOptionsTitle:executed' | 'command:gitlens.views.lineHistory.changeBase:executed' | 'command:gitlens.views.lineHistory.copy:executed' | 'command:gitlens.views.lineHistory.refresh:executed' | 'command:gitlens.views.lineHistory.setEditorFollowingOff:executed' | 'command:gitlens.views.lineHistory.setEditorFollowingOn:executed' | 'command:gitlens.views.lineHistory.setShowAvatarsOff:executed' | 'command:gitlens.views.lineHistory.setShowAvatarsOn:executed' | 'command:gitlens.views.loadAllChildren:executed' | 'command:gitlens.views.loadMoreChildren:executed' | 'command:gitlens.views.mergeBranchInto:executed' | 'command:gitlens.views.mergeChangesWithWorking:executed' | 'command:gitlens.views.openBranchOnRemote:executed' | 'command:gitlens.views.openBranchOnRemote.multi:executed' | 'command:gitlens.views.openChangedFileDiffs:executed' | 'command:gitlens.views.openChangedFileDiffsIndividually:executed' | 'command:gitlens.views.openChangedFileDiffsWithMergeBase:executed' | 'command:gitlens.views.openChangedFileDiffsWithWorking:executed' | 'command:gitlens.views.openChangedFileDiffsWithWorkingIndividually:executed' | 'command:gitlens.views.openChangedFileRevisions:executed' | 'command:gitlens.views.openChangedFiles:executed' | 'command:gitlens.views.openChanges:executed' | 'command:gitlens.views.openChangesWithMergeBase:executed' | 'command:gitlens.views.openChangesWithWorking:executed' | 'command:gitlens.views.openCommitOnRemote:executed' | 'command:gitlens.views.openCommitOnRemote.multi:executed' | 'command:gitlens.views.openDirectoryDiff:executed' | 'command:gitlens.views.openDirectoryDiffWithWorking:executed' | 'command:gitlens.views.openFile:executed' | 'command:gitlens.views.openFileRevision:executed' | 'command:gitlens.views.openInIntegratedTerminal:executed' | 'command:gitlens.views.openInTerminal:executed' | 'command:gitlens.views.openInWorktree:executed' | 'command:gitlens.views.openOnlyChangedFiles:executed' | 'command:gitlens.views.openPausedOperationInRebaseEditor:executed' | 'command:gitlens.views.openPreviousChangesWithWorking:executed' | 'command:gitlens.views.openPullRequest:executed' | 'command:gitlens.views.openPullRequestChanges:executed' | 'command:gitlens.views.openPullRequestComparison:executed' | 'command:gitlens.views.openUrl:executed' | 'command:gitlens.views.openUrl.multi:executed' | 'command:gitlens.views.openWorktree:executed' | 'command:gitlens.views.openWorktreeInNewWindow:executed' | 'command:gitlens.views.openWorktreeInNewWindow.multi:executed' | 'command:gitlens.views.patchDetails.close:executed' | 'command:gitlens.views.patchDetails.refresh:executed' | 'command:gitlens.views.pruneRemote:executed' | 'command:gitlens.views.publishBranch:executed' | 'command:gitlens.views.publishRepository:executed' | 'command:gitlens.views.pull:executed' | 'command:gitlens.views.pullRequest.close:executed' | 'command:gitlens.views.pullRequest.copy:executed' | 'command:gitlens.views.pullRequest.refresh:executed' | 'command:gitlens.views.pullRequest.setFilesLayoutToAuto:executed' | 'command:gitlens.views.pullRequest.setFilesLayoutToList:executed' | 'command:gitlens.views.pullRequest.setFilesLayoutToTree:executed' | 'command:gitlens.views.pullRequest.setShowAvatarsOff:executed' | 'command:gitlens.views.pullRequest.setShowAvatarsOn:executed' | 'command:gitlens.views.push:executed' | 'command:gitlens.views.pushToCommit:executed' | 'command:gitlens.views.pushWithForce:executed' | 'command:gitlens.views.rebaseOntoBranch:executed' | 'command:gitlens.views.rebaseOntoCommit:executed' | 'command:gitlens.views.rebaseOntoUpstream:executed' | 'command:gitlens.views.refreshNode:executed' | 'command:gitlens.views.remotes.attach:executed' | 'command:gitlens.views.remotes.copy:executed' | 'command:gitlens.views.remotes.refresh:executed' | 'command:gitlens.views.remotes.setFilesLayoutToAuto:executed' | 'command:gitlens.views.remotes.setFilesLayoutToList:executed' | 'command:gitlens.views.remotes.setFilesLayoutToTree:executed' | 'command:gitlens.views.remotes.setLayoutToList:executed' | 'command:gitlens.views.remotes.setLayoutToTree:executed' | 'command:gitlens.views.remotes.setShowAvatarsOff:executed' | 'command:gitlens.views.remotes.setShowAvatarsOn:executed' | 'command:gitlens.views.remotes.setShowBranchPullRequestOff:executed' | 'command:gitlens.views.remotes.setShowBranchPullRequestOn:executed' | 'command:gitlens.views.remotes.viewOptionsTitle:executed' | 'command:gitlens.views.removeRemote:executed' | 'command:gitlens.views.renameBranch:executed' | 'command:gitlens.views.repositories.attach:executed' | 'command:gitlens.views.repositories.copy:executed' | 'command:gitlens.views.repositories.refresh:executed' | 'command:gitlens.views.repositories.setAutoRefreshToOff:executed' | 'command:gitlens.views.repositories.setAutoRefreshToOn:executed' | 'command:gitlens.views.repositories.setBranchesLayoutToList:executed' | 'command:gitlens.views.repositories.setBranchesLayoutToTree:executed' | 'command:gitlens.views.repositories.setBranchesShowBranchComparisonOff:executed' | 'command:gitlens.views.repositories.setBranchesShowBranchComparisonOn:executed' | 'command:gitlens.views.repositories.setBranchesShowStashesOff:executed' | 'command:gitlens.views.repositories.setBranchesShowStashesOn:executed' | 'command:gitlens.views.repositories.setFilesLayoutToAuto:executed' | 'command:gitlens.views.repositories.setFilesLayoutToList:executed' | 'command:gitlens.views.repositories.setFilesLayoutToTree:executed' | 'command:gitlens.views.repositories.setShowAvatarsOff:executed' | 'command:gitlens.views.repositories.setShowAvatarsOn:executed' | 'command:gitlens.views.repositories.setShowSectionBranchComparisonOff:executed' | 'command:gitlens.views.repositories.setShowSectionBranchComparisonOn:executed' | 'command:gitlens.views.repositories.setShowSectionBranchesOff:executed' | 'command:gitlens.views.repositories.setShowSectionBranchesOn:executed' | 'command:gitlens.views.repositories.setShowSectionCommitsOff:executed' | 'command:gitlens.views.repositories.setShowSectionCommitsOn:executed' | 'command:gitlens.views.repositories.setShowSectionContributorsOff:executed' | 'command:gitlens.views.repositories.setShowSectionContributorsOn:executed' | 'command:gitlens.views.repositories.setShowSectionOff:executed' | 'command:gitlens.views.repositories.setShowSectionRemotesOff:executed' | 'command:gitlens.views.repositories.setShowSectionRemotesOn:executed' | 'command:gitlens.views.repositories.setShowSectionStashesOff:executed' | 'command:gitlens.views.repositories.setShowSectionStashesOn:executed' | 'command:gitlens.views.repositories.setShowSectionTagsOff:executed' | 'command:gitlens.views.repositories.setShowSectionTagsOn:executed' | 'command:gitlens.views.repositories.setShowSectionUpstreamStatusOff:executed' | 'command:gitlens.views.repositories.setShowSectionUpstreamStatusOn:executed' | 'command:gitlens.views.repositories.setShowSectionWorktreesOff:executed' | 'command:gitlens.views.repositories.setShowSectionWorktreesOn:executed' | 'command:gitlens.views.repositories.viewOptionsTitle:executed' | 'command:gitlens.views.resetCommit:executed' | 'command:gitlens.views.resetToCommit:executed' | 'command:gitlens.views.resetToTip:executed' | 'command:gitlens.views.restore:executed' | 'command:gitlens.views.revealRepositoryInExplorer:executed' | 'command:gitlens.views.revealWorktreeInExplorer:executed' | 'command:gitlens.views.revert:executed' | 'command:gitlens.views.scm.grouped.attachAll:executed' | 'command:gitlens.views.scm.grouped.branches:executed' | 'command:gitlens.views.scm.grouped.branches.attach:executed' | 'command:gitlens.views.scm.grouped.branches.detach:executed' | 'command:gitlens.views.scm.grouped.branches.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.branches.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.branches.visibility.show:executed' | 'command:gitlens.views.scm.grouped.commits:executed' | 'command:gitlens.views.scm.grouped.commits.attach:executed' | 'command:gitlens.views.scm.grouped.commits.detach:executed' | 'command:gitlens.views.scm.grouped.commits.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.commits.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.commits.visibility.show:executed' | 'command:gitlens.views.scm.grouped.contributors:executed' | 'command:gitlens.views.scm.grouped.contributors.attach:executed' | 'command:gitlens.views.scm.grouped.contributors.detach:executed' | 'command:gitlens.views.scm.grouped.contributors.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.contributors.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.contributors.visibility.show:executed' | 'command:gitlens.views.scm.grouped.detachAll:executed' | 'command:gitlens.views.scm.grouped.fileHistory:executed' | 'command:gitlens.views.scm.grouped.fileHistory.attach:executed' | 'command:gitlens.views.scm.grouped.fileHistory.detach:executed' | 'command:gitlens.views.scm.grouped.fileHistory.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.fileHistory.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.fileHistory.visibility.show:executed' | 'command:gitlens.views.scm.grouped.launchpad:executed' | 'command:gitlens.views.scm.grouped.launchpad.attach:executed' | 'command:gitlens.views.scm.grouped.launchpad.detach:executed' | 'command:gitlens.views.scm.grouped.launchpad.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.launchpad.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.launchpad.visibility.show:executed' | 'command:gitlens.views.scm.grouped.refresh:executed' | 'command:gitlens.views.scm.grouped.remotes:executed' | 'command:gitlens.views.scm.grouped.remotes.attach:executed' | 'command:gitlens.views.scm.grouped.remotes.detach:executed' | 'command:gitlens.views.scm.grouped.remotes.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.remotes.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.remotes.visibility.show:executed' | 'command:gitlens.views.scm.grouped.repositories:executed' | 'command:gitlens.views.scm.grouped.repositories.attach:executed' | 'command:gitlens.views.scm.grouped.repositories.detach:executed' | 'command:gitlens.views.scm.grouped.repositories.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.repositories.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.repositories.visibility.show:executed' | 'command:gitlens.views.scm.grouped.resetAll:executed' | 'command:gitlens.views.scm.grouped.searchAndCompare:executed' | 'command:gitlens.views.scm.grouped.searchAndCompare.attach:executed' | 'command:gitlens.views.scm.grouped.searchAndCompare.detach:executed' | 'command:gitlens.views.scm.grouped.searchAndCompare.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.searchAndCompare.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.searchAndCompare.visibility.show:executed' | 'command:gitlens.views.scm.grouped.stashes:executed' | 'command:gitlens.views.scm.grouped.stashes.attach:executed' | 'command:gitlens.views.scm.grouped.stashes.detach:executed' | 'command:gitlens.views.scm.grouped.stashes.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.stashes.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.stashes.visibility.show:executed' | 'command:gitlens.views.scm.grouped.tags:executed' | 'command:gitlens.views.scm.grouped.tags.attach:executed' | 'command:gitlens.views.scm.grouped.tags.detach:executed' | 'command:gitlens.views.scm.grouped.tags.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.tags.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.tags.visibility.show:executed' | 'command:gitlens.views.scm.grouped.worktrees:executed' | 'command:gitlens.views.scm.grouped.worktrees.attach:executed' | 'command:gitlens.views.scm.grouped.worktrees.detach:executed' | 'command:gitlens.views.scm.grouped.worktrees.setAsDefault:executed' | 'command:gitlens.views.scm.grouped.worktrees.visibility.hide:executed' | 'command:gitlens.views.scm.grouped.worktrees.visibility.show:executed' | 'command:gitlens.views.searchAndCompare.attach:executed' | 'command:gitlens.views.searchAndCompare.clear:executed' | 'command:gitlens.views.searchAndCompare.copy:executed' | 'command:gitlens.views.searchAndCompare.refresh:executed' | 'command:gitlens.views.searchAndCompare.searchCommits:executed' | 'command:gitlens.views.searchAndCompare.selectForCompare:executed' | 'command:gitlens.views.searchAndCompare.setFilesLayoutToAuto:executed' | 'command:gitlens.views.searchAndCompare.setFilesLayoutToList:executed' | 'command:gitlens.views.searchAndCompare.setFilesLayoutToTree:executed' | 'command:gitlens.views.searchAndCompare.setShowAvatarsOff:executed' | 'command:gitlens.views.searchAndCompare.setShowAvatarsOn:executed' | 'command:gitlens.views.searchAndCompare.swapComparison:executed' | 'command:gitlens.views.searchAndCompare.viewOptionsTitle:executed' | 'command:gitlens.views.selectFileForCompare:executed' | 'command:gitlens.views.selectForCompare:executed' | 'command:gitlens.views.setAsDefault:executed' | 'command:gitlens.views.setBranchComparisonToBranch:executed' | 'command:gitlens.views.setBranchComparisonToWorking:executed' | 'command:gitlens.views.setContributorsStatisticsOff:executed' | 'command:gitlens.views.setContributorsStatisticsOn:executed' | 'command:gitlens.views.setResultsCommitsFilterAuthors:executed' | 'command:gitlens.views.setResultsCommitsFilterOff:executed' | 'command:gitlens.views.setResultsFilesFilterOff:executed' | 'command:gitlens.views.setResultsFilesFilterOnLeft:executed' | 'command:gitlens.views.setResultsFilesFilterOnRight:executed' | 'command:gitlens.views.setShowRelativeDateMarkersOff:executed' | 'command:gitlens.views.setShowRelativeDateMarkersOn:executed' | 'command:gitlens.views.skipPausedOperation:executed' | 'command:gitlens.views.stageDirectory:executed' | 'command:gitlens.views.stageFile:executed' | 'command:gitlens.views.stashes.attach:executed' | 'command:gitlens.views.stashes.copy:executed' | 'command:gitlens.views.stashes.refresh:executed' | 'command:gitlens.views.stashes.setFilesLayoutToAuto:executed' | 'command:gitlens.views.stashes.setFilesLayoutToList:executed' | 'command:gitlens.views.stashes.setFilesLayoutToTree:executed' | 'command:gitlens.views.stashes.viewOptionsTitle:executed' | 'command:gitlens.views.switchToAnotherBranch:executed' | 'command:gitlens.views.switchToBranch:executed' | 'command:gitlens.views.switchToCommit:executed' | 'command:gitlens.views.switchToTag:executed' | 'command:gitlens.views.tags.attach:executed' | 'command:gitlens.views.tags.copy:executed' | 'command:gitlens.views.tags.refresh:executed' | 'command:gitlens.views.tags.setFilesLayoutToAuto:executed' | 'command:gitlens.views.tags.setFilesLayoutToList:executed' | 'command:gitlens.views.tags.setFilesLayoutToTree:executed' | 'command:gitlens.views.tags.setLayoutToList:executed' | 'command:gitlens.views.tags.setLayoutToTree:executed' | 'command:gitlens.views.tags.setShowAvatarsOff:executed' | 'command:gitlens.views.tags.setShowAvatarsOn:executed' | 'command:gitlens.views.tags.viewOptionsTitle:executed' | 'command:gitlens.views.timeline.refresh:executed' | 'command:gitlens.views.title.createBranch:executed' | 'command:gitlens.views.title.createTag:executed' | 'command:gitlens.views.title.createWorktree:executed' | 'command:gitlens.views.undoCommit:executed' | 'command:gitlens.views.unsetAsDefault:executed' | 'command:gitlens.views.unstageDirectory:executed' | 'command:gitlens.views.unstageFile:executed' | 'command:gitlens.views.workspaces.addRepos:executed' | 'command:gitlens.views.workspaces.addReposFromLinked:executed' | 'command:gitlens.views.workspaces.changeAutoAddSetting:executed' | 'command:gitlens.views.workspaces.convert:executed' | 'command:gitlens.views.workspaces.copy:executed' | 'command:gitlens.views.workspaces.createLocal:executed' | 'command:gitlens.views.workspaces.delete:executed' | 'command:gitlens.views.workspaces.info:executed' | 'command:gitlens.views.workspaces.locateAllRepos:executed' | 'command:gitlens.views.workspaces.openLocal:executed' | 'command:gitlens.views.workspaces.openLocalNewWindow:executed' | 'command:gitlens.views.workspaces.refresh:executed' | 'command:gitlens.views.workspaces.repo.addToWindow:executed' | 'command:gitlens.views.workspaces.repo.locate:executed' | 'command:gitlens.views.workspaces.repo.open:executed' | 'command:gitlens.views.workspaces.repo.openInNewWindow:executed' | 'command:gitlens.views.workspaces.repo.remove:executed' | 'command:gitlens.views.worktrees.attach:executed' | 'command:gitlens.views.worktrees.copy:executed' | 'command:gitlens.views.worktrees.refresh:executed' | 'command:gitlens.views.worktrees.setFilesLayoutToAuto:executed' | 'command:gitlens.views.worktrees.setFilesLayoutToList:executed' | 'command:gitlens.views.worktrees.setFilesLayoutToTree:executed' | 'command:gitlens.views.worktrees.setLayoutToList:executed' | 'command:gitlens.views.worktrees.setLayoutToTree:executed' | 'command:gitlens.views.worktrees.setShowAvatarsOff:executed' | 'command:gitlens.views.worktrees.setShowAvatarsOn:executed' | 'command:gitlens.views.worktrees.setShowBranchComparisonOff:executed' | 'command:gitlens.views.worktrees.setShowBranchComparisonOn:executed' | 'command:gitlens.views.worktrees.setShowBranchPullRequestOff:executed' | 'command:gitlens.views.worktrees.setShowBranchPullRequestOn:executed' | 'command:gitlens.views.worktrees.setShowStashesOff:executed' | 'command:gitlens.views.worktrees.setShowStashesOn:executed' | 'command:gitlens.views.worktrees.viewOptionsTitle:executed' | 'command:gitlens.visualizeHistory.file:editor:executed' | 'command:gitlens.visualizeHistory.file:explorer:executed' | 'command:gitlens.visualizeHistory.file:scm:executed' | 'command:gitlens.visualizeHistory.file:views:executed' | 'command:gitlens.visualizeHistory.folder:explorer:executed' | 'command:gitlens.visualizeHistory.folder:scm:executed' | `command:gitlens.action.${string}:executed` | 'command:gitlens.diffWith:executed' | 'command:gitlens.ai.explainCommit:editor:executed' | 'command:gitlens.ai.explainWip:editor:executed' | 'command:gitlens.openOnRemote:executed' | 'command:gitlens.openWalkthrough:executed' | 'command:gitlens.refreshHover:executed' | 'command:gitlens.visualizeHistory:executed' | 'command:gitlens.graph.abortPausedOperation:executed' | 'command:gitlens.graph.continuePausedOperation:executed' | 'command:gitlens.graph.openRebaseEditor:executed' | 'command:gitlens.graph.skipPausedOperation:executed' | 'command:gitlens.visualizeHistory.repo:graph:executed' | 'command:gitlens.ai.explainWip:home:executed' | 'command:gitlens.ai.explainBranch:home:executed' | 'command:gitlens.ai.generateCommits:home:executed' | 'command:gitlens.home.changeBranchMergeTarget:executed' | 'command:gitlens.home.deleteBranchOrWorktree:executed' | 'command:gitlens.home.pushBranch:executed' | 'command:gitlens.home.openMergeTargetComparison:executed' | 'command:gitlens.home.openPullRequestChanges:executed' | 'command:gitlens.home.openPullRequestComparison:executed' | 'command:gitlens.home.openPullRequestOnRemote:executed' | 'command:gitlens.home.openPullRequestDetails:executed' | 'command:gitlens.home.createPullRequest:executed' | 'command:gitlens.home.openWorktree:executed' | 'command:gitlens.home.switchToBranch:executed' | 'command:gitlens.home.fetch:executed' | 'command:gitlens.home.openInGraph:executed' | 'command:gitlens.openInView.branch:home:executed' | 'command:gitlens.home.createBranch:executed' | 'command:gitlens.home.mergeIntoCurrent:executed' | 'command:gitlens.home.rebaseCurrentOnto:executed' | 'command:gitlens.home.startWork:executed' | 'command:gitlens.home.createCloudPatch:executed' | 'command:gitlens.home.skipPausedOperation:executed' | 'command:gitlens.home.continuePausedOperation:executed' | 'command:gitlens.home.abortPausedOperation:executed' | 'command:gitlens.home.openRebaseEditor:executed' | 'command:gitlens.home.enableAi:executed' | 'command:gitlens.visualizeHistory.repo:home:executed' | 'command:gitlens.visualizeHistory.branch:home:executed' | 'command:gitlens.views.home.account.resync:executed' | 'command:gitlens.views.home.ai.allAccess.dismiss:executed' | 'command:gitlens.views.home.publishBranch:executed' | 'command:gitlens.views.home.pull:executed' | 'command:gitlens.views.home.push:executed' | 'command:gitlens.launchpad.indicator.action:executed' | 'command:gitlens.plus.aiAllAccess.optIn:executed' | 'command:gitlens.plus.continueFeaturePreview:executed' | 'command:gitlens.plus.resendVerification:executed' | 'command:gitlens.plus.showPlans:executed' | 'command:gitlens.plus.validate:executed' | 'command:gitlens.views.scm.grouped.welcome.dismiss:executed' | 'command:gitlens.views.scm.grouped.welcome.restore:executed' | 'command:gitlens.views.searchAndCompare.compareWithSelected:executed' | 'command:gitlens.views.timeline.openInTab:executed' | 'command:gitlens.walkthrough.connectIntegrations:executed' | 'command:gitlens.walkthrough.enableAiSetting:executed' | 'command:gitlens.walkthrough.gitlensInspect:executed' | 'command:gitlens.walkthrough.openAcceleratePrReviews:executed' | 'command:gitlens.walkthrough.openAiCustomInstructionsSettings:executed' | 'command:gitlens.walkthrough.openAiSettings:executed' | 'command:gitlens.walkthrough.openCommunityVsPro:executed' | 'command:gitlens.walkthrough.openHelpCenter:executed' | 'command:gitlens.walkthrough.openHomeViewVideo:executed' | 'command:gitlens.walkthrough.openInteractiveCodeHistory:executed' | 'command:gitlens.walkthrough.openLearnAboutAiFeatures:executed' | 'command:gitlens.walkthrough.openStartIntegrations:executed' | 'command:gitlens.walkthrough.openStreamlineCollaboration:executed' | 'command:gitlens.walkthrough.openWalkthrough:executed' | 'command:gitlens.walkthrough.plus.signUp:executed' | 'command:gitlens.walkthrough.plus.upgrade:executed' | 'command:gitlens.walkthrough.plus.reactivate:executed' | 'command:gitlens.walkthrough.showAutolinks:executed' | 'command:gitlens.walkthrough.showDraftsView:executed' | 'command:gitlens.walkthrough.showGraph:executed' | 'command:gitlens.walkthrough.showHomeView:executed' | 'command:gitlens.walkthrough.showLaunchpad:executed' | 'command:gitlens.walkthrough.switchAIProvider:executed' | 'command:gitlens.walkthrough.worktree.create:executed' | 'command:gitlens.walkthrough.openDevExPlatform:executed' | 'command:gitlens.generateCommitMessage:executed' | 'command:gitlens.scm.generateCommitMessage:executed' | 'command:gitlens.scm.ai.generateCommitMessage:executed' | 'command:gitlens.switchAIModel:executed' | 'command:gitlens.diffHeadWith:executed' | 'command:gitlens.diffWorkingWith:executed' | 'command:gitlens.openBranchesInRemote:executed' | 'command:gitlens.openBranchInRemote:executed' | 'command:gitlens.openCommitInRemote:executed' | 'command:gitlens.openFileInRemote:executed' | 'command:gitlens.openInRemote:executed' | 'command:gitlens.openRepoInRemote:executed' | 'command:gitlens.showFileHistoryInView:executed' | 'home:walkthrough:dismissed'
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
  'detail': string,
  'name': 'open/ai-custom-instructions-settings' | 'open/ai-enable-setting' | 'open/ai-settings' | 'open/help-center/ai-features' | 'open/help-center/start-integrations' | 'open/help-center/accelerate-pr-reviews' | 'open/help-center/streamline-collaboration' | 'open/help-center/interactive-code-history' | 'open/help-center/community-vs-pro' | 'open/help-center/home-view' | 'open/devex-platform' | 'open/drafts' | 'open/home' | 'connect/integrations' | 'open/autolinks' | 'open/graph' | 'open/launchpad' | 'create/worktree' | 'open/help-center' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'open/walkthrough' | 'open/inspect' | 'switch/ai-model',
  'type': 'command'
}
```

or

```typescript
{
  'detail': string,
  'name': 'open/ai-custom-instructions-settings' | 'open/ai-enable-setting' | 'open/ai-settings' | 'open/help-center/ai-features' | 'open/help-center/start-integrations' | 'open/help-center/accelerate-pr-reviews' | 'open/help-center/streamline-collaboration' | 'open/help-center/interactive-code-history' | 'open/help-center/community-vs-pro' | 'open/help-center/home-view' | 'open/devex-platform' | 'open/drafts' | 'open/home' | 'connect/integrations' | 'open/autolinks' | 'open/graph' | 'open/launchpad' | 'create/worktree' | 'open/help-center' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'open/walkthrough' | 'open/inspect' | 'switch/ai-model',
  'type': 'url',
  'url': string
}
```

### walkthrough/completion

```typescript
{
  'context.key': 'integrations' | 'homeView' | 'gettingStarted' | 'visualizeCodeHistory' | 'prReviews' | 'streamlineCollaboration' | 'aiFeatures'
}
```

