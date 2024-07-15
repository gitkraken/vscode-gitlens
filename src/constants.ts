import type { AnthropicModels } from './ai/anthropicProvider';
import type { GeminiModels } from './ai/geminiProvider';
import type { OpenAIModels } from './ai/openaiProvider';
import type { VSCodeAIModels } from './ai/vscodeProvider';
import type { AnnotationStatus } from './annotations/annotationProvider';
import type { ViewShowBranchComparison } from './config';
import type { Environment } from './container';
import type { StoredSearchQuery } from './git/search';
import type { Subscription, SubscriptionPlanId, SubscriptionState } from './plus/gk/account/subscription';
import type { SupportedCloudIntegrationIds } from './plus/integrations/authentication/models';
import type { Integration } from './plus/integrations/integration';
import type { IntegrationId } from './plus/integrations/providers/models';
import type { TelemetryEventData } from './telemetry/telemetry';
import type { TrackedUsage, TrackedUsageKeys } from './telemetry/usageTracker';

export const extensionPrefix = 'gitlens';
export const quickPickTitleMaxChars = 80;

export const previewBadge = 'ᴘʀᴇᴠɪᴇᴡ';
export const proBadge = 'ᴘʀᴏ';
export const proBadgeSuperscript = 'ᴾᴿᴼ';

export const ImageMimetypes: Record<string, string> = Object.freeze({
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.jpe': 'image/jpeg',
	'.webp': 'image/webp',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.bmp': 'image/bmp',
});

export const urls = Object.freeze({
	codeSuggest: 'https://gitkraken.com/solutions/code-suggest?utm_source=gitlens-extension&utm_medium=in-app-links',
	cloudPatches: 'https://gitkraken.com/solutions/cloud-patches?utm_source=gitlens-extension&utm_medium=in-app-links',
	graph: 'https://gitkraken.com/solutions/commit-graph?utm_source=gitlens-extension&utm_medium=in-app-links',
	launchpad: 'https://gitkraken.com/solutions/launchpad?utm_source=gitlens-extension&utm_medium=in-app-links',
	platform: 'https://gitkraken.com/devex?utm_source=gitlens-extension&utm_medium=in-app-links',
	pricing: 'https://gitkraken.com/gitlens/pricing?utm_source=gitlens-extension&utm_medium=in-app-links',
	proFeatures: 'https://gitkraken.com/gitlens/pro-features?utm_source=gitlens-extension&utm_medium=in-app-links',
	security: 'https://help.gitkraken.com/gitlens/security?utm_source=gitlens-extension&utm_medium=in-app-links',
	workspaces: 'https://gitkraken.com/solutions/workspaces?utm_source=gitlens-extension&utm_medium=in-app-links',

	cli: 'https://gitkraken.com/cli?utm_source=gitlens-extension&utm_medium=in-app-links',
	browserExtension: 'https://gitkraken.com/browser-extension?utm_source=gitlens-extension&utm_medium=in-app-links',
	desktop: 'https://gitkraken.com/git-client?utm_source=gitlens-extension&utm_medium=in-app-links',

	releaseNotes: 'https://help.gitkraken.com/gitlens/gitlens-release-notes-current/',
	releaseAnnouncement:
		'https://www.gitkraken.com/blog/gitkraken-launches-devex-platform-acquires-codesee?utm_source=gitlens-extension&utm_medium=in-app-links',
});

export const enum CharCode {
	/**
	 * The `#` character.
	 */
	Hash = 35,
	/**
	 * The `/` character.
	 */
	Slash = 47,
	Digit0 = 48,
	Digit1 = 49,
	Digit2 = 50,
	Digit3 = 51,
	Digit4 = 52,
	Digit5 = 53,
	Digit6 = 54,
	Digit7 = 55,
	Digit8 = 56,
	Digit9 = 57,
	/**
	 * The `\` character.
	 */
	Backslash = 92,
	A = 65,
	B = 66,
	C = 67,
	D = 68,
	E = 69,
	F = 70,
	Z = 90,
	a = 97,
	b = 98,
	c = 99,
	d = 100,
	e = 101,
	f = 102,
	z = 122,
}

export type Colors =
	| `${typeof extensionPrefix}.closedAutolinkedIssueIconColor`
	| `${typeof extensionPrefix}.closedPullRequestIconColor`
	| `${typeof extensionPrefix}.decorations.addedForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchAheadForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchBehindForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchDivergedForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchMissingUpstreamForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchUpToDateForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchUnpublishedForegroundColor`
	| `${typeof extensionPrefix}.decorations.copiedForegroundColor`
	| `${typeof extensionPrefix}.decorations.deletedForegroundColor`
	| `${typeof extensionPrefix}.decorations.ignoredForegroundColor`
	| `${typeof extensionPrefix}.decorations.modifiedForegroundColor`
	| `${typeof extensionPrefix}.decorations.statusMergingOrRebasingConflictForegroundColor`
	| `${typeof extensionPrefix}.decorations.statusMergingOrRebasingForegroundColor`
	| `${typeof extensionPrefix}.decorations.renamedForegroundColor`
	| `${typeof extensionPrefix}.decorations.untrackedForegroundColor`
	| `${typeof extensionPrefix}.decorations.workspaceCurrentForegroundColor`
	| `${typeof extensionPrefix}.decorations.workspaceRepoMissingForegroundColor`
	| `${typeof extensionPrefix}.decorations.workspaceRepoOpenForegroundColor`
	| `${typeof extensionPrefix}.decorations.worktreeHasUncommittedChangesForegroundColor`
	| `${typeof extensionPrefix}.decorations.worktreeMissingForegroundColor`
	| `${typeof extensionPrefix}.gutterBackgroundColor`
	| `${typeof extensionPrefix}.gutterForegroundColor`
	| `${typeof extensionPrefix}.gutterUncommittedForegroundColor`
	| `${typeof extensionPrefix}.launchpadIndicatorMergeableColor`
	| `${typeof extensionPrefix}.launchpadIndicatorMergeableHoverColor`
	| `${typeof extensionPrefix}.launchpadIndicatorBlockedColor`
	| `${typeof extensionPrefix}.launchpadIndicatorBlockedHoverColor`
	| `${typeof extensionPrefix}.launchpadIndicatorAttentionColor`
	| `${typeof extensionPrefix}.launchpadIndicatorAttentionHoverColor`
	| `${typeof extensionPrefix}.lineHighlightBackgroundColor`
	| `${typeof extensionPrefix}.lineHighlightOverviewRulerColor`
	| `${typeof extensionPrefix}.mergedPullRequestIconColor`
	| `${typeof extensionPrefix}.openAutolinkedIssueIconColor`
	| `${typeof extensionPrefix}.openPullRequestIconColor`
	| `${typeof extensionPrefix}.trailingLineBackgroundColor`
	| `${typeof extensionPrefix}.trailingLineForegroundColor`
	| `${typeof extensionPrefix}.unpublishedChangesIconColor`
	| `${typeof extensionPrefix}.unpublishedCommitIconColor`
	| `${typeof extensionPrefix}.unpulledChangesIconColor`;

export type CoreColors =
	| 'editorOverviewRuler.addedForeground'
	| 'editorOverviewRuler.deletedForeground'
	| 'editorOverviewRuler.modifiedForeground'
	| 'list.foreground'
	| 'list.warningForeground'
	| 'statusBarItem.warningBackground';

export const enum Commands {
	ActionPrefix = 'gitlens.action.',

	AddAuthors = 'gitlens.addAuthors',
	BrowseRepoAtRevision = 'gitlens.browseRepoAtRevision',
	BrowseRepoAtRevisionInNewWindow = 'gitlens.browseRepoAtRevisionInNewWindow',
	BrowseRepoBeforeRevision = 'gitlens.browseRepoBeforeRevision',
	BrowseRepoBeforeRevisionInNewWindow = 'gitlens.browseRepoBeforeRevisionInNewWindow',
	ClearFileAnnotations = 'gitlens.clearFileAnnotations',
	CloseUnchangedFiles = 'gitlens.closeUnchangedFiles',
	CompareWith = 'gitlens.compareWith',
	CompareHeadWith = 'gitlens.compareHeadWith',
	CompareWorkingWith = 'gitlens.compareWorkingWith',
	ComputingFileAnnotations = 'gitlens.computingFileAnnotations',
	ConnectRemoteProvider = 'gitlens.connectRemoteProvider',
	CopyCurrentBranch = 'gitlens.copyCurrentBranch',
	CopyDeepLinkToBranch = 'gitlens.copyDeepLinkToBranch',
	CopyDeepLinkToCommit = 'gitlens.copyDeepLinkToCommit',
	CopyDeepLinkToComparison = 'gitlens.copyDeepLinkToComparison',
	CopyDeepLinkToFile = 'gitlens.copyDeepLinkToFile',
	CopyDeepLinkToFileAtRevision = 'gitlens.copyDeepLinkToFileAtRevision',
	CopyDeepLinkToLines = 'gitlens.copyDeepLinkToLines',
	CopyDeepLinkToRepo = 'gitlens.copyDeepLinkToRepo',
	CopyDeepLinkToTag = 'gitlens.copyDeepLinkToTag',
	CopyDeepLinkToWorkspace = 'gitlens.copyDeepLinkToWorkspace',
	CopyMessageToClipboard = 'gitlens.copyMessageToClipboard',
	CopyRemoteBranchesUrl = 'gitlens.copyRemoteBranchesUrl',
	CopyRemoteBranchUrl = 'gitlens.copyRemoteBranchUrl',
	CopyRemoteCommitUrl = 'gitlens.copyRemoteCommitUrl',
	CopyRemoteComparisonUrl = 'gitlens.copyRemoteComparisonUrl',
	CopyRemoteFileUrl = 'gitlens.copyRemoteFileUrlToClipboard',
	CopyRemoteFileUrlWithoutRange = 'gitlens.copyRemoteFileUrlWithoutRange',
	CopyRemoteFileUrlFrom = 'gitlens.copyRemoteFileUrlFrom',
	CopyRemotePullRequestUrl = 'gitlens.copyRemotePullRequestUrl',
	CopyRemoteRepositoryUrl = 'gitlens.copyRemoteRepositoryUrl',
	CopyShaToClipboard = 'gitlens.copyShaToClipboard',
	CopyRelativePathToClipboard = 'gitlens.copyRelativePathToClipboard',
	ApplyPatchFromClipboard = 'gitlens.applyPatchFromClipboard',
	CopyPatchToClipboard = 'gitlens.copyPatchToClipboard',
	CopyWorkingChangesToWorktree = 'gitlens.copyWorkingChangesToWorktree',
	CreatePatch = 'gitlens.createPatch',
	CreateCloudPatch = 'gitlens.createCloudPatch',
	CreatePullRequestOnRemote = 'gitlens.createPullRequestOnRemote',
	DiffDirectory = 'gitlens.diffDirectory',
	DiffDirectoryWithHead = 'gitlens.diffDirectoryWithHead',
	DiffFolderWithRevision = 'gitlens.diffFolderWithRevision',
	DiffFolderWithRevisionFrom = 'gitlens.diffFolderWithRevisionFrom',
	DiffWith = 'gitlens.diffWith',
	DiffWithNext = 'gitlens.diffWithNext',
	DiffWithNextInDiffLeft = 'gitlens.diffWithNextInDiffLeft',
	DiffWithNextInDiffRight = 'gitlens.diffWithNextInDiffRight',
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	DiffWithPreviousInDiffLeft = 'gitlens.diffWithPreviousInDiffLeft',
	DiffWithPreviousInDiffRight = 'gitlens.diffWithPreviousInDiffRight',
	DiffLineWithPrevious = 'gitlens.diffLineWithPrevious',
	DiffWithRevision = 'gitlens.diffWithRevision',
	DiffWithRevisionFrom = 'gitlens.diffWithRevisionFrom',
	DiffWithWorking = 'gitlens.diffWithWorking',
	DiffWithWorkingInDiffLeft = 'gitlens.diffWithWorkingInDiffLeft',
	DiffWithWorkingInDiffRight = 'gitlens.diffWithWorkingInDiffRight',
	DiffLineWithWorking = 'gitlens.diffLineWithWorking',
	DisconnectRemoteProvider = 'gitlens.disconnectRemoteProvider',
	DisableDebugLogging = 'gitlens.disableDebugLogging',
	EnableDebugLogging = 'gitlens.enableDebugLogging',
	DisableRebaseEditor = 'gitlens.disableRebaseEditor',
	EnableRebaseEditor = 'gitlens.enableRebaseEditor',
	ExternalDiff = 'gitlens.externalDiff',
	ExternalDiffAll = 'gitlens.externalDiffAll',
	FetchRepositories = 'gitlens.fetchRepositories',
	GenerateCommitMessage = 'gitlens.generateCommitMessage',
	GetStarted = 'gitlens.getStarted',
	GKSwitchOrganization = 'gitlens.gk.switchOrganization',
	InviteToLiveShare = 'gitlens.inviteToLiveShare',
	OpenBlamePriorToChange = 'gitlens.openBlamePriorToChange',
	OpenBranchesOnRemote = 'gitlens.openBranchesOnRemote',
	OpenBranchOnRemote = 'gitlens.openBranchOnRemote',
	OpenCurrentBranchOnRemote = 'gitlens.openCurrentBranchOnRemote',
	OpenChangedFiles = 'gitlens.openChangedFiles',
	OpenCommitOnRemote = 'gitlens.openCommitOnRemote',
	OpenComparisonOnRemote = 'gitlens.openComparisonOnRemote',
	OpenFileHistory = 'gitlens.openFileHistory',
	OpenFileFromRemote = 'gitlens.openFileFromRemote',
	OpenFileOnRemote = 'gitlens.openFileOnRemote',
	OpenFileOnRemoteFrom = 'gitlens.openFileOnRemoteFrom',
	OpenFileAtRevision = 'gitlens.openFileRevision',
	OpenFileAtRevisionFrom = 'gitlens.openFileRevisionFrom',
	OpenFolderHistory = 'gitlens.openFolderHistory',
	OpenOnRemote = 'gitlens.openOnRemote',
	OpenCloudPatch = 'gitlens.openCloudPatch',
	OpenPatch = 'gitlens.openPatch',
	OpenPullRequestOnRemote = 'gitlens.openPullRequestOnRemote',
	OpenAssociatedPullRequestOnRemote = 'gitlens.openAssociatedPullRequestOnRemote',
	OpenRepoOnRemote = 'gitlens.openRepoOnRemote',
	OpenRevisionFile = 'gitlens.openRevisionFile',
	OpenRevisionFileInDiffLeft = 'gitlens.openRevisionFileInDiffLeft',
	OpenRevisionFileInDiffRight = 'gitlens.openRevisionFileInDiffRight',
	OpenWalkthrough = 'gitlens.openWalkthrough',
	OpenWorkingFile = 'gitlens.openWorkingFile',
	OpenWorkingFileInDiffLeft = 'gitlens.openWorkingFileInDiffLeft',
	OpenWorkingFileInDiffRight = 'gitlens.openWorkingFileInDiffRight',
	PullRepositories = 'gitlens.pullRepositories',
	PushRepositories = 'gitlens.pushRepositories',
	GitCommands = 'gitlens.gitCommands',
	GitCommandsBranch = 'gitlens.gitCommands.branch',
	GitCommandsBranchCreate = 'gitlens.gitCommands.branch.create',
	GitCommandsBranchDelete = 'gitlens.gitCommands.branch.delete',
	GitCommandsBranchPrune = 'gitlens.gitCommands.branch.prune',
	GitCommandsBranchRename = 'gitlens.gitCommands.branch.rename',
	GitCommandsCheckout = 'gitlens.gitCommands.checkout',
	GitCommandsCherryPick = 'gitlens.gitCommands.cherryPick',
	GitCommandsHistory = 'gitlens.gitCommands.history',
	GitCommandsMerge = 'gitlens.gitCommands.merge',
	GitCommandsRebase = 'gitlens.gitCommands.rebase',
	GitCommandsRemote = 'gitlens.gitCommands.remote',
	GitCommandsRemoteAdd = 'gitlens.gitCommands.remote.add',
	GitCommandsRemotePrune = 'gitlens.gitCommands.remote.prune',
	GitCommandsRemoteRemove = 'gitlens.gitCommands.remote.remove',
	GitCommandsReset = 'gitlens.gitCommands.reset',
	GitCommandsRevert = 'gitlens.gitCommands.revert',
	GitCommandsShow = 'gitlens.gitCommands.show',
	GitCommandsStash = 'gitlens.gitCommands.stash',
	GitCommandsStashDrop = 'gitlens.gitCommands.stash.drop',
	GitCommandsStashList = 'gitlens.gitCommands.stash.list',
	GitCommandsStashPop = 'gitlens.gitCommands.stash.pop',
	GitCommandsStashPush = 'gitlens.gitCommands.stash.push',
	GitCommandsStashRename = 'gitlens.gitCommands.stash.rename',
	GitCommandsStatus = 'gitlens.gitCommands.status',
	GitCommandsSwitch = 'gitlens.gitCommands.switch',
	GitCommandsTag = 'gitlens.gitCommands.tag',
	GitCommandsTagCreate = 'gitlens.gitCommands.tag.create',
	GitCommandsTagDelete = 'gitlens.gitCommands.tag.delete',
	GitCommandsWorktree = 'gitlens.gitCommands.worktree',
	GitCommandsWorktreeCreate = 'gitlens.gitCommands.worktree.create',
	GitCommandsWorktreeDelete = 'gitlens.gitCommands.worktree.delete',
	GitCommandsWorktreeOpen = 'gitlens.gitCommands.worktree.open',
	OpenOrCreateWorktreeForGHPR = 'gitlens.ghpr.views.openOrCreateWorktree',
	PlusHide = 'gitlens.plus.hide',
	PlusLogin = 'gitlens.plus.login',
	PlusLogout = 'gitlens.plus.logout',
	PlusManage = 'gitlens.plus.manage',
	PlusManageCloudIntegrations = 'gitlens.plus.cloudIntegrations.manage',
	PlusReactivateProTrial = 'gitlens.plus.reactivateProTrial',
	PlusResendVerification = 'gitlens.plus.resendVerification',
	PlusRestore = 'gitlens.plus.restore',
	PlusShowPlans = 'gitlens.plus.showPlans',
	PlusSignUp = 'gitlens.plus.signUp',
	PlusStartPreviewTrial = 'gitlens.plus.startPreviewTrial',
	PlusUpgrade = 'gitlens.plus.upgrade',
	PlusValidate = 'gitlens.plus.validate',
	QuickOpenFileHistory = 'gitlens.quickOpenFileHistory',
	RefreshLaunchpad = 'gitlens.launchpad.refresh',
	RefreshGraph = 'gitlens.graph.refresh',
	RefreshHover = 'gitlens.refreshHover',
	Reset = 'gitlens.reset',
	ResetAIKey = 'gitlens.resetAIKey',
	ResetViewsLayout = 'gitlens.resetViewsLayout',
	RevealCommitInView = 'gitlens.revealCommitInView',
	ShareAsCloudPatch = 'gitlens.shareAsCloudPatch',
	SearchCommits = 'gitlens.showCommitSearch',
	SearchCommitsInView = 'gitlens.views.searchAndCompare.searchCommits',
	ShowBranchesView = 'gitlens.showBranchesView',
	ShowCommitDetailsView = 'gitlens.showCommitDetailsView',
	ShowCommitInView = 'gitlens.showCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowCommitsView = 'gitlens.showCommitsView',
	ShowContributorsView = 'gitlens.showContributorsView',
	ShowDraftsView = 'gitlens.showDraftsView',
	ShowFileHistoryView = 'gitlens.showFileHistoryView',
	ShowFocusPage = 'gitlens.showFocusPage',
	ShowGraph = 'gitlens.showGraph',
	ShowGraphPage = 'gitlens.showGraphPage',
	ShowGraphView = 'gitlens.showGraphView',
	ShowHomeView = 'gitlens.showHomeView',
	ShowAccountView = 'gitlens.showAccountView',
	ShowInCommitGraph = 'gitlens.showInCommitGraph',
	ShowInCommitGraphView = 'gitlens.showInCommitGraphView',
	ShowInDetailsView = 'gitlens.showInDetailsView',
	ShowInTimeline = 'gitlens.showInTimeline',
	ShowLastQuickPick = 'gitlens.showLastQuickPick',
	ShowLaunchpad = 'gitlens.showLaunchpad',
	ShowLineCommitInView = 'gitlens.showLineCommitInView',
	ShowLineHistoryView = 'gitlens.showLineHistoryView',
	OpenOnlyChangedFiles = 'gitlens.openOnlyChangedFiles',
	ShowPatchDetailsPage = 'gitlens.showPatchDetailsPage',
	ShowQuickBranchHistory = 'gitlens.showQuickBranchHistory',
	ShowQuickCommit = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFile = 'gitlens.showQuickCommitFileDetails',
	ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
	ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
	ShowQuickRepoStatus = 'gitlens.showQuickRepoStatus',
	ShowQuickCommitRevision = 'gitlens.showQuickRevisionDetails',
	ShowQuickCommitRevisionInDiffLeft = 'gitlens.showQuickRevisionDetailsInDiffLeft',
	ShowQuickCommitRevisionInDiffRight = 'gitlens.showQuickRevisionDetailsInDiffRight',
	ShowQuickStashList = 'gitlens.showQuickStashList',
	ShowRemotesView = 'gitlens.showRemotesView',
	ShowRepositoriesView = 'gitlens.showRepositoriesView',
	ShowSearchAndCompareView = 'gitlens.showSearchAndCompareView',
	ShowSettingsPage = 'gitlens.showSettingsPage',
	ShowSettingsPageAndJumpToFileAnnotations = 'gitlens.showSettingsPage!file-annotations',
	ShowSettingsPageAndJumpToBranchesView = 'gitlens.showSettingsPage!branches-view',
	ShowSettingsPageAndJumpToCommitsView = 'gitlens.showSettingsPage!commits-view',
	ShowSettingsPageAndJumpToContributorsView = 'gitlens.showSettingsPage!contributors-view',
	ShowSettingsPageAndJumpToFileHistoryView = 'gitlens.showSettingsPage!file-history-view',
	ShowSettingsPageAndJumpToLineHistoryView = 'gitlens.showSettingsPage!line-history-view',
	ShowSettingsPageAndJumpToRemotesView = 'gitlens.showSettingsPage!remotes-view',
	ShowSettingsPageAndJumpToRepositoriesView = 'gitlens.showSettingsPage!repositories-view',
	ShowSettingsPageAndJumpToSearchAndCompareView = 'gitlens.showSettingsPage!search-compare-view',
	ShowSettingsPageAndJumpToStashesView = 'gitlens.showSettingsPage!stashes-view',
	ShowSettingsPageAndJumpToTagsView = 'gitlens.showSettingsPage!tags-view',
	ShowSettingsPageAndJumpToWorkTreesView = 'gitlens.showSettingsPage!worktrees-view',
	ShowSettingsPageAndJumpToViews = 'gitlens.showSettingsPage!views',
	ShowSettingsPageAndJumpToCommitGraph = 'gitlens.showSettingsPage!commit-graph',
	ShowSettingsPageAndJumpToAutolinks = 'gitlens.showSettingsPage!autolinks',
	ShowStashesView = 'gitlens.showStashesView',
	ShowTagsView = 'gitlens.showTagsView',
	ShowTimelinePage = 'gitlens.showTimelinePage',
	ShowTimelineView = 'gitlens.showTimelineView',
	ShowWelcomePage = 'gitlens.showWelcomePage',
	ShowWorktreesView = 'gitlens.showWorktreesView',
	ShowWorkspacesView = 'gitlens.showWorkspacesView',
	StashApply = 'gitlens.stashApply',
	StashSave = 'gitlens.stashSave',
	StashSaveFiles = 'gitlens.stashSaveFiles',
	SwitchAIModel = 'gitlens.switchAIModel',
	SwitchMode = 'gitlens.switchMode',
	ToggleCodeLens = 'gitlens.toggleCodeLens',
	ToggleFileBlame = 'gitlens.toggleFileBlame',
	ToggleFileBlameInDiffLeft = 'gitlens.toggleFileBlameInDiffLeft',
	ToggleFileBlameInDiffRight = 'gitlens.toggleFileBlameInDiffRight',
	ToggleFileChanges = 'gitlens.toggleFileChanges',
	ToggleFileChangesOnly = 'gitlens.toggleFileChangesOnly',
	ToggleFileHeatmap = 'gitlens.toggleFileHeatmap',
	ToggleFileHeatmapInDiffLeft = 'gitlens.toggleFileHeatmapInDiffLeft',
	ToggleFileHeatmapInDiffRight = 'gitlens.toggleFileHeatmapInDiffRight',
	ToggleLaunchpadIndicator = 'gitlens.launchpad.indicator.toggle',
	ToggleGraph = 'gitlens.toggleGraph',
	ToggleMaximizedGraph = 'gitlens.toggleMaximizedGraph',
	ToggleLineBlame = 'gitlens.toggleLineBlame',
	ToggleReviewMode = 'gitlens.toggleReviewMode',
	ToggleZenMode = 'gitlens.toggleZenMode',
	ViewsCopy = 'gitlens.views.copy',
	ViewsCopyAsMarkdown = 'gitlens.views.copyAsMarkdown',
	ViewsCopyUrl = 'gitlens.views.copyUrl',
	ViewsOpenDirectoryDiff = 'gitlens.views.openDirectoryDiff',
	ViewsOpenDirectoryDiffWithWorking = 'gitlens.views.openDirectoryDiffWithWorking',
	ViewsOpenUrl = 'gitlens.views.openUrl',

	Deprecated_DiffHeadWith = 'gitlens.diffHeadWith',
	Deprecated_DiffWorkingWith = 'gitlens.diffWorkingWith',
	Deprecated_OpenBranchesInRemote = 'gitlens.openBranchesInRemote',
	Deprecated_OpenBranchInRemote = 'gitlens.openBranchInRemote',
	Deprecated_OpenCommitInRemote = 'gitlens.openCommitInRemote',
	Deprecated_OpenFileInRemote = 'gitlens.openFileInRemote',
	Deprecated_OpenInRemote = 'gitlens.openInRemote',
	Deprecated_OpenRepoInRemote = 'gitlens.openRepoInRemote',
	Deprecated_ShowFileHistoryInView = 'gitlens.showFileHistoryInView',
}

export type TreeViewCommands = `gitlens.views.${
	| `branches.${
			| 'copy'
			| 'refresh'
			| `setLayoutTo${'List' | 'Tree'}`
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setShowBranchComparison${'On' | 'Off'}`
			| `setShowBranchPullRequest${'On' | 'Off'}`}`
	| `commits.${
			| 'copy'
			| 'refresh'
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setCommitsFilter${'Authors' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setShowBranchComparison${'On' | 'Off'}`
			| `setShowBranchPullRequest${'On' | 'Off'}`
			| `setShowMergeCommits${'On' | 'Off'}`}`
	| `contributors.${
			| 'copy'
			| 'refresh'
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAllBranches${'On' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setShowMergeCommits${'On' | 'Off'}`
			| `setShowStatistics${'On' | 'Off'}`}`
	| `drafts.${'copy' | 'refresh' | 'info' | 'create' | 'delete' | `setShowAvatars${'On' | 'Off'}`}`
	| `fileHistory.${
			| 'copy'
			| 'refresh'
			| 'changeBase'
			| `setCursorFollowing${'On' | 'Off'}`
			| `setEditorFollowing${'On' | 'Off'}`
			| `setRenameFollowing${'On' | 'Off'}`
			| `setShowAllBranches${'On' | 'Off'}`
			| `setShowMergeCommits${'On' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`}`
	| `lineHistory.${
			| 'copy'
			| 'refresh'
			| 'changeBase'
			| `setEditorFollowing${'On' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`}`
	| `pullRequest.${
			| 'copy'
			| 'refresh'
			| 'close'
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAvatars${'On' | 'Off'}`}`
	| `remotes.${
			| 'copy'
			| 'refresh'
			| `setLayoutTo${'List' | 'Tree'}`
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setShowBranchPullRequest${'On' | 'Off'}`}`
	| `repositories.${
			| 'copy'
			| 'refresh'
			| `setBranchesLayoutTo${'List' | 'Tree'}`
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setAutoRefreshTo${'On' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setShowBranchComparison${'On' | 'Off'}`
			| `setBranchesShowBranchComparison${'On' | 'Off'}`
			| `setShowBranches${'On' | 'Off'}`
			| `setShowCommits${'On' | 'Off'}`
			| `setShowContributors${'On' | 'Off'}`
			| `setShowRemotes${'On' | 'Off'}`
			| `setShowStashes${'On' | 'Off'}`
			| `setShowTags${'On' | 'Off'}`
			| `setShowWorktrees${'On' | 'Off'}`
			| `setShowUpstreamStatus${'On' | 'Off'}`
			| `setShowSectionOff`}`
	| `searchAndCompare.${
			| 'copy'
			| 'refresh'
			| 'clear'
			| 'pin'
			| 'unpin'
			| 'swapComparison'
			| 'selectForCompare'
			| 'compareWithSelected'
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setKeepResultsTo${'On' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setFilesFilterOn${'Left' | 'Right'}`
			| 'setFilesFilterOff'}`
	| `stashes.${'copy' | 'refresh' | `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`}`
	| `tags.${
			| 'copy'
			| 'refresh'
			| `setLayoutTo${'List' | 'Tree'}`
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAvatars${'On' | 'Off'}`}`
	| `workspaces.${
			| 'info'
			| 'copy'
			| 'refresh'
			| 'addRepos'
			| 'addReposFromLinked'
			| 'changeAutoAddSetting'
			| 'convert'
			| 'create'
			| 'createLocal'
			| 'delete'
			| 'locateAllRepos'
			| 'openLocal'
			| 'openLocalNewWindow'
			| `repo.${'locate' | 'open' | 'openInNewWindow' | 'addToWindow' | 'remove'}`}`
	| `worktrees.${
			| 'copy'
			| 'refresh'
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAvatars${'On' | 'Off'}`
			| `setShowBranchComparison${'On' | 'Off'}`
			| `setShowBranchPullRequest${'On' | 'Off'}`}`}`;

type ExtractSuffix<Prefix extends string, U> = U extends `${Prefix}${infer V}` ? V : never;
type FilterCommands<Prefix extends string, U> = U extends `${Prefix}${infer V}` ? `${Prefix}${V}` : never;

export type TreeViewCommandsByViewId<T extends TreeViewIds> = FilterCommands<T, TreeViewCommands>;
export type TreeViewCommandsByViewType<T extends TreeViewTypes> = FilterCommands<
	`gitlens.views.${T}.`,
	TreeViewCommands
>;
export type TreeViewCommandSuffixesByViewType<T extends TreeViewTypes> = ExtractSuffix<
	`gitlens.views.${T}.`,
	FilterCommands<`gitlens.views.${T}.`, TreeViewCommands>
>;

export type CustomEditorTypes = 'rebase';
export type CustomEditorIds = `gitlens.${CustomEditorTypes}`;

export type TreeViewTypes =
	| 'branches'
	| 'commits'
	| 'contributors'
	| 'drafts'
	| 'fileHistory'
	| 'lineHistory'
	| 'pullRequest'
	| 'remotes'
	| 'repositories'
	| 'searchAndCompare'
	| 'stashes'
	| 'tags'
	| 'workspaces'
	| 'worktrees';
export type TreeViewIds<T extends TreeViewTypes = TreeViewTypes> = `gitlens.views.${T}`;

export type WebviewTypes = 'focus' | 'graph' | 'patchDetails' | 'settings' | 'timeline' | 'welcome';
export type WebviewIds = `gitlens.${WebviewTypes}`;

export type WebviewViewTypes =
	| 'account'
	| 'commitDetails'
	| 'graph'
	| 'graphDetails'
	| 'home'
	| 'patchDetails'
	| 'timeline';
export type WebviewViewIds<T extends WebviewViewTypes = WebviewViewTypes> = `gitlens.views.${T}`;

export type ViewTypes = TreeViewTypes | WebviewViewTypes;
export type ViewIds = TreeViewIds | WebviewViewIds;

export type ViewContainerTypes = 'gitlens' | 'gitlensInspect' | 'gitlensPanel';
export type ViewContainerIds = `workbench.view.extension.${ViewContainerTypes}`;

export type CoreViewContainerTypes = 'scm';
export type CoreViewContainerIds = `workbench.view.${CoreViewContainerTypes}`;

// export const viewTypes: ViewTypes[] = [
// 	'account',
// 	'branches',
// 	'commits',
// 	'commitDetails',
// 	'contributors',
// 	'fileHistory',
// 	'graph',
// 	'graphDetails',
// 	'home',
// 	'lineHistory',
// 	'remotes',
// 	'repositories',
// 	'searchAndCompare',
// 	'stashes',
// 	'tags',
// 	'timeline',
// 	'workspaces',
// 	'worktrees',
// ];

export const viewIdsByDefaultContainerId = new Map<ViewContainerIds | CoreViewContainerIds, ViewTypes[]>([
	[
		'workbench.view.scm',
		['branches', 'commits', 'remotes', 'repositories', 'stashes', 'tags', 'worktrees', 'contributors'],
	],
	['workbench.view.extension.gitlensPanel', ['graph', 'graphDetails']],
	[
		'workbench.view.extension.gitlensInspect',
		['commitDetails', 'fileHistory', 'lineHistory', 'timeline', 'searchAndCompare'],
	],
	['workbench.view.extension.gitlens', ['home', 'workspaces', 'account']],
]);

export type TreeViewRefNodeTypes = 'branch' | 'commit' | 'stash' | 'tag';
export type TreeViewRefFileNodeTypes = 'commit-file' | 'file-commit' | 'results-file' | 'stash-file';
export type TreeViewFileNodeTypes =
	| TreeViewRefFileNodeTypes
	| 'conflict-file'
	| 'folder'
	| 'status-file'
	| 'uncommitted-file';
export type TreeViewSubscribableNodeTypes =
	| 'compare-branch'
	| 'compare-results'
	| 'file-history'
	| 'file-history-tracker'
	| 'line-history'
	| 'line-history-tracker'
	| 'repositories'
	| 'repository'
	| 'repo-folder'
	| 'search-results'
	| 'workspace';
export type TreeViewNodeTypes =
	| TreeViewRefNodeTypes
	| TreeViewFileNodeTypes
	| TreeViewSubscribableNodeTypes
	| 'autolink'
	| 'autolinks'
	| 'branch-tag-folder'
	| 'branches'
	| 'compare-picker'
	| 'contributor'
	| 'contributors'
	| 'conflict-files'
	| 'conflict-current-changes'
	| 'conflict-incoming-changes'
	| 'draft'
	| 'drafts'
	| 'drafts-code-suggestions'
	| 'grouping'
	| 'merge-status'
	| 'message'
	| 'pager'
	| 'pullrequest'
	| 'rebase-status'
	| 'reflog'
	| 'reflog-record'
	| 'remote'
	| 'remotes'
	| 'results-commits'
	| 'results-files'
	| 'search-compare'
	| 'stashes'
	| 'status-files'
	| 'tags'
	| 'tracking-status'
	| 'tracking-status-files'
	| 'uncommitted-files'
	| 'workspace-missing-repository'
	| 'workspaces-view'
	| 'worktree'
	| 'worktrees';

export type ContextKeys = {
	'gitlens:debugging': boolean;
	'gitlens:disabled': boolean;
	'gitlens:disabledToggleCodeLens': boolean;
	'gitlens:enabled': boolean;
	'gitlens:gk:hasOrganizations': boolean;
	'gitlens:gk:organization:ai:enabled': boolean;
	'gitlens:gk:organization:drafts:byob': boolean;
	'gitlens:gk:organization:drafts:enabled': boolean;
	'gitlens:hasVirtualFolders': boolean;
	'gitlens:plus': SubscriptionPlanId;
	'gitlens:plus:disallowedRepos': string[];
	'gitlens:plus:enabled': boolean;
	'gitlens:plus:required': boolean;
	'gitlens:plus:state': SubscriptionState;
	'gitlens:prerelease': boolean;
	'gitlens:readonly': boolean;
	'gitlens:repos:withRemotes': string[];
	'gitlens:repos:withHostingIntegrations': string[];
	'gitlens:repos:withHostingIntegrationsConnected': string[];
	'gitlens:tabs:annotated': string[];
	'gitlens:tabs:annotated:computing': string[];
	'gitlens:tabs:blameable': string[];
	'gitlens:tabs:tracked': string[];
	'gitlens:untrusted': boolean;
	'gitlens:views:canCompare': boolean;
	'gitlens:views:canCompare:file': boolean;
	'gitlens:views:commits:filtered': boolean;
	'gitlens:views:commits:hideMergeCommits': boolean;
	'gitlens:views:contributors:hideMergeCommits': boolean;
	'gitlens:views:fileHistory:canPin': boolean;
	'gitlens:views:fileHistory:cursorFollowing': boolean;
	'gitlens:views:fileHistory:editorFollowing': boolean;
	'gitlens:views:lineHistory:editorFollowing': boolean;
	'gitlens:views:patchDetails:mode': 'create' | 'view';
	'gitlens:views:pullRequest:visible': boolean;
	'gitlens:views:repositories:autoRefresh': boolean;
	'gitlens:vsls': boolean | 'host' | 'guest';
	'gitlens:window:annotated': AnnotationStatus;
} & Record<`gitlens:action:${string}`, number> &
	Record<`gitlens:key:${Keys}`, boolean> &
	Record<`gitlens:webview:${WebviewTypes | CustomEditorTypes}:visible`, boolean> &
	Record<`gitlens:webviewView:${WebviewViewTypes}:visible`, boolean>;

export type CoreCommands =
	| 'cursorMove'
	| 'editor.action.showHover'
	| 'editor.action.showReferences'
	| 'editor.action.webvieweditor.showFind'
	| 'editorScroll'
	| 'list.collapseAllToFocus'
	| 'openInIntegratedTerminal'
	| 'openInTerminal'
	| 'revealFileInOS'
	| 'revealInExplorer'
	| 'revealLine'
	| 'setContext'
	| 'vscode.open'
	| 'vscode.openFolder'
	| 'vscode.openWith'
	| 'vscode.changes'
	| 'vscode.diff'
	| 'vscode.executeCodeLensProvider'
	| 'vscode.executeDocumentSymbolProvider'
	| 'vscode.moveViews'
	| 'vscode.previewHtml'
	| 'workbench.action.closeActiveEditor'
	| 'workbench.action.closeAllEditors'
	| 'workbench.action.closePanel'
	| 'workbench.action.nextEditor'
	| 'workbench.action.openWalkthrough'
	| 'workbench.action.toggleMaximizedPanel'
	| 'workbench.extensions.installExtension'
	| 'workbench.extensions.uninstallExtension'
	| 'workbench.files.action.focusFilesExplorer'
	| 'workbench.view.explorer'
	| 'workbench.view.scm'
	| `${ViewContainerIds | CoreViewContainerIds}.resetViewContainerLocation`
	| `${ViewIds}.${'focus' | 'removeView' | 'resetViewLocation' | 'toggleVisibility'}`;

export type CoreGitCommands =
	| 'git.fetch'
	| 'git.publish'
	| 'git.pull'
	| 'git.pullRebase'
	| 'git.push'
	| 'git.pushForce'
	| 'git.undoCommit';

export const enum GlyphChars {
	AngleBracketLeftHeavy = '\u2770',
	AngleBracketRightHeavy = '\u2771',
	ArrowBack = '\u21a9',
	ArrowDown = '\u2193',
	ArrowDownUp = '\u21F5',
	ArrowDropRight = '\u2937',
	ArrowHeadRight = '\u27A4',
	ArrowLeft = '\u2190',
	ArrowLeftDouble = '\u21d0',
	ArrowLeftRight = '\u2194',
	ArrowLeftRightDouble = '\u21d4',
	ArrowLeftRightDoubleStrike = '\u21ce',
	ArrowLeftRightLong = '\u27f7',
	ArrowRight = '\u2192',
	ArrowRightDouble = '\u21d2',
	ArrowRightHollow = '\u21e8',
	ArrowUp = '\u2191',
	ArrowUpDown = '\u21C5',
	ArrowUpRight = '\u2197',
	ArrowsHalfLeftRight = '\u21cb',
	ArrowsHalfRightLeft = '\u21cc',
	ArrowsLeftRight = '\u21c6',
	ArrowsRightLeft = '\u21c4',
	Asterisk = '\u2217',
	Check = '✔',
	Dash = '\u2014',
	Dot = '\u2022',
	Ellipsis = '\u2026',
	EnDash = '\u2013',
	Envelope = '\u2709',
	EqualsTriple = '\u2261',
	Flag = '\u2691',
	FlagHollow = '\u2690',
	MiddleEllipsis = '\u22EF',
	MuchLessThan = '\u226A',
	MuchGreaterThan = '\u226B',
	Pencil = '\u270E',
	Space = '\u00a0',
	SpaceThin = '\u2009',
	SpaceThinnest = '\u200A',
	SquareWithBottomShadow = '\u274F',
	SquareWithTopShadow = '\u2750',
	Warning = '\u26a0',
	ZeroWidthSpace = '\u200b',
}

export const keys = [
	'left',
	'alt+left',
	'ctrl+left',
	'right',
	'alt+right',
	'ctrl+right',
	'alt+,',
	'alt+.',
	'alt+enter',
	'ctrl+enter',
	'escape',
] as const;
export type Keys = (typeof keys)[number];

export const enum Schemes {
	DebugConsole = 'debug',
	File = 'file',
	Git = 'git',
	GitHub = 'github',
	GitLens = 'gitlens',
	Output = 'output',
	PRs = 'pr',
	Terminal = 'vscode-terminal',
	Vsls = 'vsls',
	VslsScc = 'vsls-scc',
	Virtual = 'vscode-vfs',
}

export type Sources =
	| 'account'
	| 'code-suggest'
	| 'cloud-patches'
	| 'commandPalette'
	| 'deeplink'
	| 'git-commands'
	| 'graph'
	| 'home'
	| 'inspect'
	| 'inspect-overview'
	| 'integrations'
	| 'launchpad'
	| 'launchpad-indicator'
	| 'notification'
	| 'patchDetails'
	| 'prompt'
	| 'remoteProvider'
	| 'settings'
	| 'timeline'
	| 'trial-indicator'
	| 'scm-input'
	| 'subscription'
	| 'walkthrough'
	| 'welcome';

export interface Source {
	source: Sources;
	detail?: string | TelemetryEventData;
}

export type AIProviders = 'anthropic' | 'gemini' | 'openai' | 'vscode';
export type AIModels<Provider extends AIProviders = AIProviders> = Provider extends 'openai'
	? OpenAIModels
	: Provider extends 'anthropic'
	  ? AnthropicModels
	  : Provider extends 'gemini'
	    ? GeminiModels
	    : Provider extends 'vscode'
	      ? VSCodeAIModels
	      : AnthropicModels | GeminiModels | OpenAIModels;

export type SupportedAIModels =
	| `anthropic:${AIModels<'anthropic'>}`
	| `google:${AIModels<'gemini'>}`
	| `openai:${AIModels<'openai'>}`
	| 'vscode';

export type SecretKeys =
	| `gitlens.integration.auth:${IntegrationId}|${string}`
	| `gitlens.integration.auth.cloud:${IntegrationId}|${string}`
	| `gitlens.${AIProviders}.key`
	| `gitlens.plus.auth:${Environment}`;

export const enum SyncedStorageKeys {
	Version = 'gitlens:synced:version',
	PreReleaseVersion = 'gitlens:synced:preVersion',
	HomeViewWelcomeVisible = 'gitlens:views:welcome:visible',
}

export type DeprecatedGlobalStorage = {
	/** @deprecated use `confirm:ai:tos:${AIProviders}` */
	'confirm:sendToOpenAI': boolean;
	/** @deprecated */
	'home:actions:completed': ('dismissed:welcome' | 'opened:scm')[];
	/** @deprecated */
	'home:steps:completed': string[];
	/** @deprecated */
	'home:sections:dismissed': string[];
	/** @deprecated */
	'home:status:pinned': boolean;
	/** @deprecated */
	'home:banners:dismissed': string[];
	/** @deprecated */
	'plus:discountNotificationShown': boolean;
	/** @deprecated */
	'plus:migratedAuthentication': boolean;
	/** @deprecated */
	'plus:renewalDiscountNotificationShown': boolean;
	/** @deprecated */
	'views:layout': 'gitlens' | 'scm';
	/** @deprecated */
	'views:commitDetails:dismissed': 'sidebar'[];
} & {
	/** @deprecated */
	[key in `disallow:connection:${string}`]: any;
};

export type GlobalStorage = {
	avatars: [string, StoredAvatar][];
	repoVisibility: [string, StoredRepoVisibilityInfo][];
	'deepLinks:pending': StoredDeepLinkContext;
	pendingWelcomeOnFocus: boolean;
	pendingWhatsNewOnFocus: boolean;
	// Don't change this key name ('premium`) as its the stored subscription
	'premium:subscription': Stored<Subscription & { lastValidatedAt: number | undefined }>;
	'synced:version': string;
	// Keep the pre-release version separate from the released version
	'synced:preVersion': string;
	usages: Record<TrackedUsageKeys, TrackedUsage>;
	version: string;
	// Keep the pre-release version separate from the released version
	preVersion: string;
	'views:welcome:visible': boolean;
	'confirm:draft:storage': boolean;
	'home:sections:collapsed': string[];
	'launchpad:groups:collapsed': StoredFocusGroup[];
	'launchpad:indicator:hasLoaded': boolean;
	'launchpad:indicator:hasInteracted': string;
} & { [key in `confirm:ai:tos:${AIProviders}`]: boolean } & {
	[key in `provider:authentication:skip:${string}`]: boolean;
} & { [key in `gk:${string}:checkin`]: Stored<StoredGKCheckInResponse> } & {
	[key in `gk:${string}:organizations`]: Stored<StoredOrganization[]>;
} & { [key in `jira:${string}:organizations`]: Stored<StoredJiraOrganization[] | undefined> } & {
	[key in `jira:${string}:projects`]: Stored<StoredJiraProject[] | undefined>;
};

export type DeprecatedWorkspaceStorage = {
	/** @deprecated use `confirm:ai:tos:${AIProviders}` */
	'confirm:sendToOpenAI': boolean;
	/** @deprecated */
	'graph:banners:dismissed': Record<string, boolean>;
	/** @deprecated use `graph:filtersByRepo.excludeRefs` */
	'graph:hiddenRefs': Record<string, StoredGraphExcludedRef>;
	/** @deprecated */
	'views:searchAndCompare:keepResults': boolean;
};

export type WorkspaceStorage = {
	assumeRepositoriesOnStartup?: boolean;
	'branch:comparisons': StoredBranchComparisons;
	'gitComandPalette:usage': RecentUsage;
	gitPath: string;
	'graph:columns': Record<string, StoredGraphColumn>;
	'graph:filtersByRepo': Record<string, StoredGraphFilters>;
	'remote:default': string;
	'starred:branches': StoredStarred;
	'starred:repositories': StoredStarred;
	'views:repositories:autoRefresh': boolean;
	'views:searchAndCompare:pinned': StoredSearchAndCompareItems;
	'views:commitDetails:autolinksExpanded': boolean;
	'views:commitDetails:pullRequestExpanded': boolean;
} & { [key in `confirm:ai:tos:${AIProviders}`]: boolean } & {
	[key in `connected:${Integration['key']}`]: boolean;
};

export interface Stored<T, SchemaVersion extends number = 1> {
	v: SchemaVersion;
	data: T;
	timestamp?: number;
}

export interface StoredGKCheckInResponse {
	user: StoredGKUser;
	licenses: {
		paidLicenses: Record<StoredGKLicenseType, StoredGKLicense>;
		effectiveLicenses: Record<StoredGKLicenseType, StoredGKLicense>;
	};
}

export interface StoredGKUser {
	id: string;
	name: string;
	email: string;
	status: 'activated' | 'pending';
	createdDate: string;
	firstGitLensCheckIn?: string;
}

export interface StoredGKLicense {
	latestStatus: 'active' | 'canceled' | 'cancelled' | 'expired' | 'in_trial' | 'non_renewing' | 'trial';
	latestStartDate: string;
	latestEndDate: string;
	organizationId: string | undefined;
	reactivationCount?: number;
}

export type StoredGKLicenseType =
	| 'gitlens-pro'
	| 'gitlens-teams'
	| 'gitlens-hosted-enterprise'
	| 'gitlens-self-hosted-enterprise'
	| 'gitlens-standalone-enterprise'
	| 'bundle-pro'
	| 'bundle-teams'
	| 'bundle-hosted-enterprise'
	| 'bundle-self-hosted-enterprise'
	| 'bundle-standalone-enterprise'
	| 'gitkraken_v1-pro'
	| 'gitkraken_v1-teams'
	| 'gitkraken_v1-hosted-enterprise'
	| 'gitkraken_v1-self-hosted-enterprise'
	| 'gitkraken_v1-standalone-enterprise';

export interface StoredOrganization {
	id: string;
	name: string;
	role: 'owner' | 'admin' | 'billing' | 'user';
}

export interface StoredJiraOrganization {
	key: string;
	id: string;
	name: string;
	url: string;
	avatarUrl: string;
}

export interface StoredJiraProject {
	key: string;
	id: string;
	name: string;
	resourceId: string;
}

export interface StoredAvatar {
	uri: string;
	timestamp: number;
}

export type StoredRepositoryVisibility = 'private' | 'public' | 'local';

export interface StoredRepoVisibilityInfo {
	visibility: StoredRepositoryVisibility;
	timestamp: number;
	remotesHash?: string;
}

export interface StoredBranchComparison {
	ref: string;
	label?: string;
	notation: '..' | '...' | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
	checkedFiles?: string[];
}

export type StoredBranchComparisons = Record<string, string | StoredBranchComparison>;

export interface StoredDeepLinkContext {
	url?: string | undefined;
	repoPath?: string | undefined;
	targetSha?: string | undefined;
	secondaryTargetSha?: string | undefined;
	useProgress?: boolean | undefined;
}

export interface StoredGraphColumn {
	isHidden?: boolean;
	mode?: string;
	width?: number;
}

export interface StoredGraphFilters {
	includeOnlyRefs?: Record<string, StoredGraphIncludeOnlyRef>;
	excludeRefs?: Record<string, StoredGraphExcludedRef>;
	excludeTypes?: Record<string, boolean>;
}

export type StoredGraphRefType = 'head' | 'remote' | 'tag';

export interface StoredGraphExcludedRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredGraphIncludeOnlyRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredNamedRef {
	label?: string;
	ref: string;
}

export interface StoredComparison {
	type: 'comparison';
	timestamp: number;
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: '..' | '...';

	checkedFiles?: string[];
}

export interface StoredSearch {
	type: 'search';
	timestamp: number;
	path: string;
	labels: {
		label: string;
		queryLabel:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  };
	};
	search: StoredSearchQuery;
}

export type StoredSearchAndCompareItem = StoredComparison | StoredSearch;
export type StoredSearchAndCompareItems = Record<string, StoredSearchAndCompareItem>;
export type StoredStarred = Record<string, boolean>;
export type RecentUsage = Record<string, number>;

export type WalkthroughSteps =
	| 'get-started'
	| 'core-features'
	| 'pro-features'
	| 'pro-trial'
	| 'pro-upgrade'
	| 'pro-reactivate'
	| 'pro-paid'
	| 'visualize'
	| 'launchpad'
	| 'code-collab'
	| 'integrations'
	| 'more';

export type StoredFocusGroup =
	| 'current-branch'
	| 'pinned'
	| 'mergeable'
	| 'blocked'
	| 'follow-up'
	| 'needs-review'
	| 'waiting-for-review'
	| 'draft'
	| 'other'
	| 'snoozed';

export type TelemetryGlobalContext = {
	debugging: boolean;
	enabled: boolean;
	prerelease: boolean;
	install: boolean;
	upgrade: boolean;
	upgradedFrom: string | undefined;
	'folders.count': number;
	'folders.schemes': string;
	'providers.count': number;
	'providers.ids': string;
	'repositories.count': number;
	'repositories.hasRemotes': boolean;
	'repositories.hasRichRemotes': boolean;
	'repositories.hasConnectedRemotes': boolean;
	'repositories.withRemotes': number;
	'repositories.withHostingIntegrations': number;
	'repositories.withHostingIntegrationsConnected': number;
	'repositories.remoteProviders': string;
	'repositories.schemes': string;
	'repositories.visibility': 'private' | 'public' | 'local' | 'mixed';
	'workspace.isTrusted': boolean;
} & SubscriptionEventData;

export type TelemetryEvents = {
	/** Sent when account validation fails */
	'account/validation/failed': {
		'account.id': string;
		exception: string;
		code: string | undefined;
		statusCode: string | undefined;
	};

	/** Sent when GitLens is activated */
	activate: {
		'activation.elapsed': number;
		'activation.mode': string | undefined;
	} & Record<`config.${string}`, string | number | boolean | null>;

	/** Sent when explaining changes from wip, commits, stashes, patches,etc. */
	'ai/explain': {
		type: 'change';
		changeType: 'wip' | 'stash' | 'commit' | `draft-${'patch' | 'stash' | 'suggested_pr_change'}`;
	} & AIEventBase;

	/** Sent when generating summaries from commits, stashes, patches, etc. */
	'ai/generate': (AIGenerateCommitEvent | AIGenerateDraftEvent) & AIEventBase;

	/** Sent when a cloud-based hosting provider is connected */
	'cloudIntegrations/hosting/connected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;
	};
	/** Sent when a cloud-based hosting provider is disconnected */
	'cloudIntegrations/hosting/disconnected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;
	};
	/** Sent when a cloud-based issue provider is connected */
	'cloudIntegrations/issue/connected': {
		'issueProvider.provider': IntegrationId;
		'issueProvider.key': string;
	};
	/** Sent when a cloud-based issue provider is disconnected */
	'cloudIntegrations/issue/disconnected': {
		'issueProvider.provider': IntegrationId;
		'issueProvider.key': string;
	};
	/** Sent when a user chooses to manage the cloud integrations */
	'cloudIntegrations/settingsOpened': {
		'integration.id': SupportedCloudIntegrationIds | undefined;
	};

	/** Sent when a code suggestion is archived */
	codeSuggestionArchived: {
		provider: string | undefined;
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		repoPrivacy: 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		draftId: string;
		/** Named for compatibility with other GK surfaces */
		reason: 'committed' | 'rejected' | 'accepted';
	};
	/** Sent when a code suggestion is created */
	codeSuggestionCreated: {
		provider: string | undefined;
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		repoPrivacy: 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		draftId: string;
		/** Named for compatibility with other GK surfaces */
		draftPrivacy: 'public' | 'private' | 'invite_only' | 'provider_access';
		/** Named for compatibility with other GK surfaces */
		filesChanged: number;
		/** Named for compatibility with other GK surfaces */
		source: 'reviewMode';
	};
	/** Sent when a code suggestion is opened */
	codeSuggestionViewed: {
		provider: string | undefined;
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		repoPrivacy: 'private' | 'public' | 'local' | undefined;
		/** Named for compatibility with other GK surfaces */
		draftId: string;
		/** Named for compatibility with other GK surfaces */
		draftPrivacy: 'public' | 'private' | 'invite_only' | 'provider_access';
		/** Named for compatibility with other GK surfaces */
		source?: string;
	};

	/** Sent when a GitLens command is executed */
	command:
		| {
				command: Commands.GitCommands;
				context?: { mode?: string; submode?: string };
		  }
		| {
				command: string;
				context?: undefined;
				webview?: string;
		  };
	/** Sent when a VS Code command is executed by a GitLens provided action */
	'command/core': { command: string };

	/** Sent when the user takes an action on a launchpad item */
	'launchpad/title/action': LaunchpadEventData & {
		action: 'feedback' | 'open-on-gkdev' | 'refresh' | 'settings';
	};

	/** Sent when the user takes an action on a launchpad item */
	'launchpad/action': LaunchpadEventData & {
		action:
			| 'open'
			| 'code-suggest'
			| 'merge'
			| 'soft-open'
			| 'switch'
			| 'open-worktree'
			| 'switch-and-code-suggest'
			| 'show-overview'
			| 'open-changes'
			| 'open-in-graph'
			| 'pin'
			| 'unpin'
			| 'snooze'
			| 'unsnooze'
			| 'open-suggestion'
			| 'open-suggestion-browser';
	} & Partial<Record<`item.${string}`, string | number | boolean>>;
	/** Sent when the user changes launchpad configuration settings */
	'launchpad/configurationChanged': {
		'config.launchpad.staleThreshold': number | null;
		'config.launchpad.ignoredOrganizations': number;
		'config.launchpad.ignoredRepositories': number;
		'config.launchpad.indicator.enabled': boolean;
		'config.launchpad.indicator.openInEditor': boolean;
		'config.launchpad.indicator.icon': 'default' | 'group';
		'config.launchpad.indicator.label': false | 'item' | 'counts';
		'config.launchpad.indicator.useColors': boolean;
		'config.launchpad.indicator.groups': string;
		'config.launchpad.indicator.polling.enabled': boolean;
		'config.launchpad.indicator.polling.interval': number;
	};
	/** Sent when the user expands/collapses a launchpad group */
	'launchpad/groupToggled': LaunchpadEventData & {
		group: LaunchpadGroups;
		collapsed: boolean;
	};
	/** Sent when the user opens launchpad; use `instance` to correlate a launchpad "session" */
	'launchpad/open': LaunchpadEventDataBase;
	/** Sent when the launchpad is opened; use `instance` to correlate a launchpad "session" */
	'launchpad/opened': LaunchpadEventData & {
		connected: boolean;
	};
	/** Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is disconnected; use `instance` to correlate a launchpad "session" */
	'launchpad/steps/connect': LaunchpadEventData & {
		connected: boolean;
	};
	/** Sent when the launchpad has "reloaded" (while open, e.g. user refreshed or back button) and is connected; use `instance` to correlate a launchpad "session" */
	'launchpad/steps/main': LaunchpadEventData & {
		connected: boolean;
	};
	/** Sent when the user opens the details of a launchpad item (e.g. click on an item); use `instance` to correlate a launchpad "session" */
	'launchpad/steps/details': LaunchpadEventData & {
		action: 'select';
	} & Partial<Record<`item.${string}`, string | number | boolean>>;
	/** Sent when the user hides the launchpad indicator */
	'launchpad/indicator/hidden': void;
	/** Sent when the launchpad indicator loads (with data) for the first time ever for this device */
	'launchpad/indicator/firstLoad': void;
	/** Sent when a launchpad operation is taking longer than a set timeout to complete */
	'launchpad/operation/slow': {
		timeout: number;
		operation: 'getMyPullRequests' | 'getCodeSuggestions' | 'getEnrichedItems' | 'getCodeSuggestionCounts';
		duration: number;
	};

	/** Sent when a PR review was started in the inspect overview */
	openReviewMode: {
		provider: string;
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		/** Provided for compatibility with other GK surfaces */
		repoPrivacy: 'private' | 'public' | 'local' | undefined;
		filesChanged: number;
		/** Provided for compatibility with other GK surfaces */
		source: Sources;
	};

	/** Sent when the "context" of the workspace changes (e.g. repo added, integration connected, etc) */
	'providers/context': void;

	/** Sent when we've loaded all the git providers and their repositories */
	'providers/registrationComplete': {
		'config.git.autoRepositoryDetection': boolean | 'subFolders' | 'openEditors' | undefined;
	};

	/** Sent when a local (Git remote-based) hosting provider is connected */
	'remoteProviders/connected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;

		/** @deprecated */
		'remoteProviders.key': string;
	};
	/** Sent when a local (Git remote-based) hosting provider is disconnected */
	'remoteProviders/disconnected': {
		'hostingProvider.provider': IntegrationId;
		'hostingProvider.key': string;

		/** @deprecated */
		'remoteProviders.key': string;
	};

	/** Sent when the workspace's repositories change */
	'repositories/changed': {
		'repositories.added': number;
		'repositories.removed': number;
	};
	/** Sent when the workspace's repository visibility is first requested */
	'repositories/visibility': {
		'repositories.visibility': 'private' | 'public' | 'local' | 'mixed';
	};

	/** Sent when a repository is opened */
	'repository/opened': {
		'repository.id': string;
		'repository.scheme': string;
		'repository.closed': boolean;
		'repository.folder.scheme': string | undefined;
		'repository.provider.id': string;
		'repository.remoteProviders': string;
	};
	/** Sent when a repository's visibility is first requested */
	'repository/visibility': {
		'repository.visibility': 'private' | 'public' | 'local' | undefined;
		'repository.id': string | undefined;
		'repository.scheme': string | undefined;
		'repository.closed': boolean | undefined;
		'repository.folder.scheme': string | undefined;
		'repository.provider.id': string | undefined;
	};

	/** Sent when the subscription is loaded */
	subscription: SubscriptionEventData;
	'subscription/action':
		| {
				action:
					| 'sign-up'
					| 'sign-in'
					| 'sign-out'
					| 'manage'
					| 'reactivate'
					| 'resend-verification'
					| 'pricing'
					| 'start-preview-trial'
					| 'upgrade';
		  }
		| {
				action: 'visibility';
				visible: boolean;
		  };
	/** Sent when the subscription changes */
	'subscription/changed': SubscriptionEventData;

	/** Sent when a "tracked feature" is interacted with, today that is only when webview/webviewView/custom editor is shown */
	'usage/track': {
		'usage.key': TrackedUsageKeys;
		'usage.count': number;
	};

	/** Sent when the walkthrough is opened */
	walkthrough: {
		step?:
			| 'get-started'
			| 'core-features'
			| 'pro-features'
			| 'pro-trial'
			| 'pro-upgrade'
			| 'pro-reactivate'
			| 'pro-paid'
			| 'visualize'
			| 'launchpad'
			| 'code-collab'
			| 'integrations'
			| 'more';
	};
};

type AIEventBase = {
	model: {
		id: AIModels;
		provider: { id: AIProviders; name: string };
	};
	duration?: number;
	failed?: { reason: 'user-declined' | 'user-cancelled' } | { reason: 'error'; error: string };
};

export type AIGenerateCommitEvent = {
	type: 'commitMessage';
};

export type AIGenerateDraftEvent = {
	type: 'draftMessage';
	draftType: 'patch' | 'stash' | 'suggested_pr_change';
};

export type LaunchpadTelemetryContext = LaunchpadEventData;

type LaunchpadEventDataBase = {
	instance: number;
	'initialState.group': string | undefined;
	'initialState.selectTopItem': boolean;
};

type LaunchpadEventData = LaunchpadEventDataBase &
	(
		| Partial<{ 'items.error': string }>
		| Partial<
				{
					'items.count': number;
					'items.timings.prs': number;
					'items.timings.codeSuggestionCounts': number;
					'items.timings.enrichedItems': number;
					'groups.count': number;
				} & Record<`groups.${LaunchpadGroups}.count`, number> &
					Record<`groups.${LaunchpadGroups}.collapsed`, boolean | undefined>
		  >
	);

type LaunchpadGroups =
	| 'current-branch'
	| 'pinned'
	| 'mergeable'
	| 'blocked'
	| 'follow-up'
	| 'needs-review'
	| 'waiting-for-review'
	| 'draft'
	| 'other'
	| 'snoozed';

type SubscriptionEventData = {
	'subscription.state'?: SubscriptionState;
	'subscription.status'?:
		| 'verification'
		| 'free'
		| 'preview'
		| 'preview-expired'
		| 'trial'
		| 'trial-expired'
		| 'trial-reactivation-eligible'
		| 'paid'
		| 'unknown';
} & Partial<
	Record<`account.${string}`, string | number | boolean | undefined> &
		Record<`subscription.${string}`, string | number | boolean | undefined> &
		Record<`subscription.previewTrial.${string}`, string | number | boolean | undefined> &
		Record<`previous.account.${string}`, string | number | boolean | undefined> &
		Record<`previous.subscription.${string}`, string | number | boolean | undefined> &
		Record<`previous.subscription.previewTrial.${string}`, string | number | boolean | undefined>
>;
