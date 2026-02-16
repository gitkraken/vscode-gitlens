# GitLens Telemetry

> This is a generated file. Do not edit.

## Global Attributes

> Global attributes are sent (if available) with every telemetry event

```typescript
{
  'env': string,
  'extensionId': string,
  'extensionMode': string,
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
  'global.gk.mcp.registrationCompleted': boolean,
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
  'global.subscription.actual.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'global.subscription.actual.nextTrialOptInDate': string,
  'global.subscription.actual.organizationId': string,
  'global.subscription.actual.startedOn': string,
  'global.subscription.actual.trialReactivationCount': number,
  'global.subscription.effective.bundle': boolean,
  'global.subscription.effective.cancelled': boolean,
  'global.subscription.effective.expiresOn': string,
  'global.subscription.effective.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
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

### ai/enabled

> Sent when AI is enabled

```typescript
void
```

### ai/explain

> Sent when explaining changes from wip, commits, stashes, patches, etc.

```typescript
{
  'changeType': 'wip' | 'stash' | 'commit' | 'branch' | 'draft-stash' | 'draft-patch' | 'draft-suggested_pr_change',
  'config.largePromptThreshold': number,
  'config.usedCustomInstructions': boolean,
  'correlationId': string,
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
  'type': 'explain-changes' | 'generate-commitMessage' | 'generate-stashMessage' | 'generate-changelog' | 'generate-create-cloudPatch' | 'generate-create-codeSuggestion' | 'generate-create-pullRequest' | 'generate-commits' | 'generate-searchQuery',
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
  'correlationId': string,
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
  'correlationId': string,
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
  'correlationId': string,
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
  'correlationId': string,
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
  'correlationId': string,
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
  'type': 'commits',
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
  'correlationId': string,
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
  'correlationId': string,
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

### cli/install/failed

> Sent when a CLI install attempt fails

```typescript
{
  'attempts': number,
  'autoInstall': boolean,
  'error.message': string,
  'insiders': boolean,
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### cli/install/started

> Sent when a CLI install attempt is started

```typescript
{
  'attempts': number,
  'autoInstall': boolean,
  'insiders': boolean,
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### cli/install/succeeded

> Sent when a CLI install attempt succeeds

```typescript
{
  'attempts': number,
  'autoInstall': boolean,
  'insiders': boolean,
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'version': string
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
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello'
}
```

### cloudIntegrations/hosting/disconnected

> Sent when a cloud-based hosting provider is disconnected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello'
}
```

### cloudIntegrations/issue/connected

> Sent when a cloud-based issue provider is connected

```typescript
{
  'issueProvider.key': string,
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello'
}
```

### cloudIntegrations/issue/disconnected

> Sent when a cloud-based issue provider is disconnected

```typescript
{
  'issueProvider.key': string,
  'issueProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello'
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
  'integration.id': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello'
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

### commit/signed

> Sent when a commit is signed

```typescript
{
  'format': 'gpg' | 'ssh' | 'x509' | 'openpgp'
}
```

### commit/signing/failed

> Sent when commit signing fails

```typescript
{
  'format': 'gpg' | 'ssh' | 'x509' | 'openpgp',
  'reason': 'unknown' | 'noKey' | 'gpgNotFound' | 'sshNotFound' | 'passphraseFailed'
}
```

### commit/signing/setup

> Sent when commit signing setup is completed

```typescript
{
  'format': 'gpg' | 'ssh' | 'x509' | 'openpgp',
  'keyGenerated': boolean
}
```

### commit/signing/setupWizard/opened

> Sent when commit signing setup wizard is opened

```typescript
{
  'alreadyConfigured': boolean
}
```

### commitDetails/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'mode.new': 'wip' | 'commit',
  'mode.old': 'wip' | 'commit'
}
```

### commitDetails/reachability/failed

> Sent when commit reachability fails to load

```typescript
{
  'duration': number,
  'failed.error': string,
  'failed.reason': 'unknown' | 'git-error' | 'timeout'
}
```

### commitDetails/reachability/loaded

> Sent when commit reachability is successfully loaded

```typescript
{
  'duration': number,
  'refs.count': number
}
```

### commitDetails/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### composer/action/changeAiModel

> Sent when the user changes the AI model in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/action/compose

> Sent when the user uses auto-compose in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.commitMessage.setting.length': number,
  'customInstructions.commitMessage.setting.used': boolean,
  'customInstructions.hash': string,
  'customInstructions.length': number,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'customInstructions.used': boolean
}
```

### composer/action/compose/failed

> Sent when the user fails an auto-compose operation in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.commitMessage.setting.length': number,
  'customInstructions.commitMessage.setting.used': boolean,
  'customInstructions.hash': string,
  'customInstructions.length': number,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'customInstructions.used': boolean,
  'failure.reason': 'cancelled'
}
```

or

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.commitMessage.setting.length': number,
  'customInstructions.commitMessage.setting.used': boolean,
  'customInstructions.hash': string,
  'customInstructions.length': number,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'customInstructions.used': boolean,
  'failure.error.message': string,
  'failure.reason': 'error'
}
```

### composer/action/finishAndCommit

> Sent when the user finishes and commits in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/action/finishAndCommit/failed

> Sent when the user fails to finish and commit in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'failure.error.message': string,
  'failure.reason': 'error'
}
```

### composer/action/generateCommitMessage

> Sent when the user uses generate commit message in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'overwriteExistingMessage': boolean
}
```

### composer/action/generateCommitMessage/failed

> Sent when the user fails a generate commit message operation in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'failure.reason': 'cancelled',
  'overwriteExistingMessage': boolean
}
```

or

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'failure.error.message': string,
  'failure.reason': 'error',
  'overwriteExistingMessage': boolean
}
```

### composer/action/includedUnstagedChanges

> Sent when the user adds unstaged changes to draft commits in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/action/recompose

> Sent when the user uses recompose in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.commitMessage.setting.length': number,
  'customInstructions.commitMessage.setting.used': boolean,
  'customInstructions.hash': string,
  'customInstructions.length': number,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'customInstructions.used': boolean
}
```

### composer/action/recompose/failed

> Sent when the user fails a recompose operation in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.commitMessage.setting.length': number,
  'customInstructions.commitMessage.setting.used': boolean,
  'customInstructions.hash': string,
  'customInstructions.length': number,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'customInstructions.used': boolean,
  'failure.reason': 'cancelled'
}
```

or

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'customInstructions.commitMessage.setting.length': number,
  'customInstructions.commitMessage.setting.used': boolean,
  'customInstructions.hash': string,
  'customInstructions.length': number,
  'customInstructions.setting.length': number,
  'customInstructions.setting.used': boolean,
  'customInstructions.used': boolean,
  'failure.error.message': string,
  'failure.reason': 'error'
}
```

### composer/action/reset

> Sent when the user uses the reset button in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/action/undo

> Sent when the user uses the undo button in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/loaded

> Sent when the Commit Composer is first loaded with repo data

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'failure.error.message': string,
  'failure.reason': 'error'
}
```

### composer/reloaded

> Sent when the Commit Composer is reloaded

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'failure.error.message': string,
  'failure.reason': 'error'
}
```

### composer/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### composer/shown

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### composer/warning/indexChanged

> Sent when the user is warned that the index has changed in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### composer/warning/workingDirectoryChanged

> Sent when the user is warned that the working directory has changed in the Commit Composer

```typescript
{
  'context.ai.enabled.config': boolean,
  'context.ai.enabled.org': boolean,
  'context.ai.model.default': boolean,
  'context.ai.model.hidden': boolean,
  'context.ai.model.id': string,
  'context.ai.model.maxTokens.input': number,
  'context.ai.model.maxTokens.output': number,
  'context.ai.model.name': string,
  'context.ai.model.provider.id': 'anthropic' | 'azure' | 'deepseek' | 'gemini' | 'github' | 'gitkraken' | 'huggingface' | 'mistral' | 'ollama' | 'openai' | 'openaicompatible' | 'openrouter' | 'vscode' | 'xai',
  'context.ai.model.temperature': number,
  'context.commits.autoComposedCount': number,
  'context.commits.composedCount': number,
  'context.commits.finalCount': number,
  'context.commits.initialCount': number,
  'context.diff.files.count': number,
  'context.diff.hunks.count': number,
  'context.diff.lines.count': number,
  'context.diff.staged.exists': boolean,
  'context.diff.unstaged.exists': boolean,
  'context.diff.unstaged.included': boolean,
  'context.errors.operation.count': number,
  'context.errors.safety.count': number,
  'context.mode': 'experimental' | 'preview',
  'context.onboarding.dismissed': boolean,
  'context.onboarding.stepReached': number,
  'context.operations.finishAndCommit.error.count': number,
  'context.operations.generateCommitMessage.cancelled.count': number,
  'context.operations.generateCommitMessage.count': number,
  'context.operations.generateCommitMessage.error.count': number,
  'context.operations.generateCommits.cancelled.count': number,
  'context.operations.generateCommits.count': number,
  'context.operations.generateCommits.error.count': number,
  'context.operations.generateCommits.feedback.downvote.count': number,
  'context.operations.generateCommits.feedback.upvote.count': number,
  'context.operations.redo.count': number,
  'context.operations.reset.count': number,
  'context.operations.undo.count': number,
  'context.session.duration': number,
  'context.session.start': string,
  'context.source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees',
  'context.warnings.indexChanged': boolean,
  'context.warnings.workingDirectoryChanged': boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### graph/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.config.initialRowSelection': 'wip' | 'head',
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
  'context.config.stickyTimeline': boolean,
  'context.repository.closed': boolean,
  'context.repository.folder.scheme': string,
  'context.repository.id': string,
  'context.repository.provider.id': string,
  'context.repository.scheme': string,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### graphDetails/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'mode.new': 'wip' | 'commit',
  'mode.old': 'wip' | 'commit'
}
```

### graphDetails/reachability/failed

> Sent when commit reachability fails to load in Graph Details

```typescript
{
  'duration': number,
  'failed.error': string,
  'failed.reason': 'unknown' | 'git-error' | 'timeout'
}
```

### graphDetails/reachability/loaded

> Sent when commit reachability is successfully loaded in Graph Details

```typescript
{
  'duration': number,
  'refs.count': number
}
```

### graphDetails/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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

### home/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
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

### home/failed

> Sent when Home fails to load some state

```typescript
{
  'error': string,
  'error.detail': string,
  'reason': 'subscription'
}
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'action': 'soft-open' | 'code-suggest' | 'open' | 'merge' | 'switch' | 'open-worktree' | 'switch-and-code-suggest' | 'show-overview' | 'open-changes' | 'open-in-graph' | 'pin' | 'unpin' | 'snooze' | 'unsnooze' | 'open-suggestion' | 'open-suggestion-browser',
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

### mcp/registration/failed

> Sent when GitKraken MCP registration fails

```typescript
{
  'cli.version': string,
  'error.message': string,
  'reason': string,
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### mcp/setup/completed

> Sent when GitKraken MCP setup is completed

```typescript
{
  'cli.version': string,
  'requiresUserCompletion': boolean,
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### mcp/setup/failed

> Sent when GitKraken MCP setup fails

```typescript
{
  'cli.version': string,
  'error.message': string,
  'reason': string,
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### mcp/setup/started

> Sent when GitKraken MCP setup is started

```typescript
{
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### op/gate/deadlock

```typescript
{
  'key': string,
  'prop': string,
  // Whether this is just a warning or the gate was forcibly cleared
  'status': 'warning' | 'aborted',
  'timeout': number
}
```

### op/git/aborted

```typescript
{
  'duration': number,
  'operation': string,
  'reason': 'unknown' | 'timeout' | 'cancellation',
  'timeout': number
}
```

### op/git/queueWait

> Sent when a background git command waited in the queue

```typescript
{
  // Number of active git processes when this command started
  'active': number,
  // Configured max concurrent processes
  'maxConcurrent': number,
  // Priority level of the command that waited
  'priority': 'interactive' | 'normal' | 'background',
  // Number of background commands queued
  'queued.background': number,
  // Number of interactive commands queued
  'queued.interactive': number,
  // Number of normal commands queued
  'queued.normal': number,
  // Time in ms the command waited in the queue before executing
  'waitTime': number
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
  'source': 'account' | 'subscription' | 'graph' | 'composer' | 'patchDetails' | 'settings' | 'timeline' | 'home' | 'welcome' | 'rebaseEditor' | 'ai' | 'ai:markdown-preview' | 'ai:markdown-editor' | 'ai:picker' | 'associateIssueWithBranch' | 'cloud-patches' | 'code-suggest' | 'commandPalette' | 'deeplink' | 'editor:hover' | 'feature-badge' | 'feature-gate' | 'gk-cli-integration' | 'gk-mcp-provider' | 'graph-details' | 'inspect' | 'inspect-overview' | 'integrations' | 'launchpad' | 'launchpad-indicator' | 'launchpad-view' | 'mcp' | 'mcp-welcome-message' | 'merge-target' | 'notification' | 'prompt' | 'quick-wizard' | 'remoteProvider' | 'scm' | 'scm-input' | 'startReview' | 'startWork' | 'statusbar:hover' | 'trial-indicator' | 'view' | 'view:hover' | 'walkthrough' | 'whatsnew' | 'worktrees'
}
```

### patchDetails/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### patchDetails/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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

### rebase/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebase/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### rebase/shown

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### rebaseEditor/action/abort

> Sent when the user aborts a rebase

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.duration': number,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/continue

> Sent when the user continues a paused rebase

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/recompose

> Sent when the user opens the Commit Composer from the rebase editor

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.duration': number,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/revealRef

> Sent when the user reveals a ref (commit/branch) in graph or commit details

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  // Where the ref is being revealed
  'location': 'graph' | 'commitDetails',
  // Type of ref being revealed
  'ref.type': 'commit' | 'branch'
}
```

### rebaseEditor/action/showConflicts

> Sent when the user clicks to show conflicts

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/skip

> Sent when the user skips a commit during a paused rebase

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/start

> Sent when the user starts a rebase (clicks "Start Rebase")

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.duration': number,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/switchToText

> Sent when the user switches to the text editor

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.duration': number,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/action/toggleOrdering

> Sent when the user toggles the commit ordering (ascending/descending)

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'ordering.new': 'asc' | 'desc',
  'ordering.old': 'asc' | 'desc'
}
```

### rebaseEditor/conflicts/detected

> Sent when conflict detection completes (check status for result)

```typescript
{
  // Number of conflicting commits (only when status is 'conflicts')
  'commits.conflicting': number,
  // Number of commits checked
  'commits.count': number,
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  // Duration of conflict detection in milliseconds
  'duration': number,
  // Result status
  'status': 'clean' | 'conflicts'
}
```

### rebaseEditor/conflicts/detecting

> Sent when conflict detection starts

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### rebaseEditor/conflicts/failed

> Sent when conflict detection fails

```typescript
{
  // Number of commits that were being checked
  'commits.count': number,
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  // Duration before failure in milliseconds
  'duration': number,
  // Error message
  'error': string
}
```

### rebaseEditor/entries/changed

> Sent when the user changes rebase entry action(s) (pick, squash, drop, etc.)

```typescript
{
  // The new action applied
  'action': string,
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  // Number of entries changed
  'count': number
}
```

### rebaseEditor/entries/moved

> Sent when the user moves/reorders entries

```typescript
{
  'context.ascending': boolean,
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  // Number of entries moved
  'count': number,
  // Method used to move entries
  'method': 'drag' | 'keyboard'
}
```

### rebaseEditor/shown

> Sent when the Rebase Editor is shown

```typescript
{
  'context.ascending': boolean,
  'context.config.density': 'compact' | 'comfortable',
  'context.config.openOnPausedRebase': boolean | 'interactive',
  'context.config.ordering': 'asc' | 'desc',
  'context.config.revealBehavior': 'onDoubleClick' | 'onSelection',
  'context.config.revealLocation': 'graph' | 'inspect',
  'context.done.count': number,
  'context.hasConflicts': boolean,
  'context.isPaused': boolean,
  'context.isRebasing': boolean,
  'context.preservesMerges': boolean,
  'context.session.start': string,
  'context.todo.count': number,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### remoteProviders/connected

> Sent when a local (Git remote-based) hosting provider is connected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello',
  // @deprecated: true
  'remoteProviders.key': string
}
```

### remoteProviders/disconnected

> Sent when a local (Git remote-based) hosting provider is disconnected

```typescript
{
  'hostingProvider.key': string,
  'hostingProvider.provider': 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'bitbucket-server' | 'github-enterprise' | 'cloud-github-enterprise' | 'gitlab-self-hosted' | 'cloud-gitlab-self-hosted' | 'azure-devops-server' | 'jira' | 'linear' | 'trello',
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
  'repository.scheme': string,
  'repository.submodules.openedCount': number,
  'repository.worktrees.openedCount': number
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

### settings/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### settings/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### startReview/action

> Sent when the user chooses to manage integrations

```typescript
{
  'instance': number,
  'action': 'manage' | 'connect',
  'connected': boolean,
  'items.count': number
}
```

### startReview/open

> Sent when the user opens Start Review; use `instance` to correlate a StartReview "session"

```typescript
{
  'instance': number
}
```

### startReview/opened

> Sent when the launchpad is opened; use `instance` to correlate a StartReview "session"

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### startReview/pr/action

> Sent when the user takes an action on a Start Review PR

```typescript
{
  'instance': number,
  'action': 'soft-open',
  'connected': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number
}
```

### startReview/pr/chosen

> Sent when the user chooses a PR to review in the second step

```typescript
{
  'instance': number,
  'connected': boolean,
  [`item.${string}`]: string | number | boolean,
  'items.count': number
}
```

### startReview/steps/connect

> Sent when the user reaches the "connect an integration" step of Start Review

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### startReview/steps/pr

> Sent when the user reaches the "choose a PR" step of Start Review

```typescript
{
  'instance': number,
  'connected': boolean,
  'items.count': number
}
```

### startReview/title/action

> Sent when the user chooses to connect an integration

```typescript
{
  'instance': number,
  'action': 'connect',
  'connected': boolean,
  'items.count': number
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
  'subscription.actual.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'subscription.actual.nextTrialOptInDate': string,
  'subscription.actual.organizationId': string,
  'subscription.actual.startedOn': string,
  'subscription.actual.trialReactivationCount': number,
  'subscription.effective.bundle': boolean,
  'subscription.effective.cancelled': boolean,
  'subscription.effective.expiresOn': string,
  'subscription.effective.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
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
  'previous.subscription.actual.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'previous.subscription.actual.nextTrialOptInDate': string,
  'previous.subscription.actual.organizationId': string,
  'previous.subscription.actual.startedOn': string,
  'previous.subscription.actual.trialReactivationCount': number,
  'previous.subscription.effective.bundle': boolean,
  'previous.subscription.effective.cancelled': boolean,
  'previous.subscription.effective.expiresOn': string,
  'previous.subscription.effective.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'previous.subscription.effective.nextTrialOptInDate': string,
  'previous.subscription.effective.organizationId': string,
  'previous.subscription.effective.startedOn': string,
  'previous.subscription.effective.trialReactivationCount': number,
  'subscription.actual.bundle': boolean,
  'subscription.actual.cancelled': boolean,
  'subscription.actual.expiresOn': string,
  'subscription.actual.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
  'subscription.actual.nextTrialOptInDate': string,
  'subscription.actual.organizationId': string,
  'subscription.actual.startedOn': string,
  'subscription.actual.trialReactivationCount': number,
  'subscription.effective.bundle': boolean,
  'subscription.effective.cancelled': boolean,
  'subscription.effective.expiresOn': string,
  'subscription.effective.id': 'community' | 'community-with-account' | 'student' | 'pro' | 'advanced' | 'teams' | 'enterprise',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'scope.hasBase': boolean,
  'scope.hasHead': boolean,
  'scope.type': 'file' | 'folder' | 'repo'
}
```

### timeline/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### timeline/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
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
  'context.webview.host': 'view' | 'editor',
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
  'usage.key': string /* TrackedUsageKeys */
}
```

### walkthrough

> Sent when the walkthrough is opened

```typescript
{
  'step': 'welcome-in-trial' | 'welcome-paid' | 'welcome-in-trial-expired-eligible' | 'welcome-in-trial-expired' | 'get-started-community' | 'visualize-code-history' | 'accelerate-pr-reviews' | 'improve-workflows-with-integrations',
  'usingFallbackUrl': boolean
}
```

### walkthrough/action

> Sent when the walkthrough is opened

```typescript
{
  'command': string,
  'detail': string,
  'name': 'open/ai-custom-instructions-settings' | 'open/ai-enable-setting' | 'open/ai-settings' | 'open/help-center/ai-features' | 'open/help-center/accelerate-pr-reviews' | 'open/help-center/interactive-code-history' | 'open/help-center/community-vs-pro' | 'open/devex-platform' | 'open/drafts' | 'connect/integrations' | 'open/composer' | 'open/graph' | 'open/launchpad' | 'create/worktree' | 'open/help-center' | 'plus/login' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'open/walkthrough' | 'open/inspect' | 'switch/ai-model',
  'type': 'command'
}
```

or

```typescript
{
  'detail': string,
  'name': 'open/ai-custom-instructions-settings' | 'open/ai-enable-setting' | 'open/ai-settings' | 'open/help-center/ai-features' | 'open/help-center/accelerate-pr-reviews' | 'open/help-center/interactive-code-history' | 'open/help-center/community-vs-pro' | 'open/devex-platform' | 'open/drafts' | 'connect/integrations' | 'open/composer' | 'open/graph' | 'open/launchpad' | 'create/worktree' | 'open/help-center' | 'plus/login' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'open/walkthrough' | 'open/inspect' | 'switch/ai-model',
  'type': 'url',
  'url': string
}
```

### walkthrough/completion

```typescript
{
  'context.key': 'gettingStarted' | 'visualizeCodeHistory' | 'gitBlame' | 'prReviews' | 'mcpSetup' | 'aiFeatures'
}
```

### welcome/action

> Sent when an action is taken in the welcome webview

```typescript
{
  'name': 'shown' | 'dismiss',
  'proButtonClicked': boolean,
  'viewedCarouselPages': number
}
```

or

```typescript
{
  'command': string,
  'name': 'open/help-center/community-vs-pro' | 'open/composer' | 'open/graph' | 'open/launchpad' | 'open/help-center' | 'plus/login' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'shown' | 'dismiss',
  'type': 'command'
}
```

or

```typescript
{
  'name': 'open/help-center/community-vs-pro' | 'open/composer' | 'open/graph' | 'open/launchpad' | 'open/help-center' | 'plus/login' | 'plus/sign-up' | 'plus/upgrade' | 'plus/reactivate' | 'shown' | 'dismiss',
  'type': 'url',
  'url': string
}
```

### welcome/closed

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string
}
```

### welcome/showAborted

```typescript
{
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

### welcome/shown

```typescript
{
  [`context.${string}`]: string | number | boolean,
  'context.webview.host': 'view' | 'editor',
  'context.webview.id': string,
  'context.webview.instanceId': string,
  'context.webview.type': string,
  'duration': number,
  'loading': boolean
}
```

