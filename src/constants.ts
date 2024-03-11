import type { AnthropicModels } from './ai/anthropicProvider';
import type { OpenAIModels } from './ai/openaiProvider';
import type { ViewShowBranchComparison } from './config';
import type { Environment } from './container';
import type { StoredSearchQuery } from './git/search';
import type { Subscription } from './plus/gk/account/subscription';
import type { Integration } from './plus/integrations/integration';
import type { TrackedUsage, TrackedUsageKeys } from './telemetry/usageTracker';

export const extensionPrefix = 'gitlens';
export const quickPickTitleMaxChars = 80;

export const ImageMimetypes: Record<string, string> = {
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.jpe': 'image/jpeg',
	'.webp': 'image/webp',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.bmp': 'image/bmp',
};

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
	CloseWelcomeView = 'gitlens.closeWelcomeView',
	CompareWith = 'gitlens.compareWith',
	CompareHeadWith = 'gitlens.compareHeadWith',
	CompareWorkingWith = 'gitlens.compareWorkingWith',
	ComputingFileAnnotations = 'gitlens.computingFileAnnotations',
	ConnectRemoteProvider = 'gitlens.connectRemoteProvider',
	CopyAutolinkUrl = 'gitlens.copyAutolinkUrl',
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
	CopyRemoteIssueUrl = 'gitlens.copyRemoteIssueUrl',
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
	OpenAutolinkUrl = 'gitlens.openAutolinkUrl',
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
	OpenIssueOnRemote = 'gitlens.openIssueOnRemote',
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
	PlusPurchase = 'gitlens.plus.purchase',
	PlusReactivateProTrial = 'gitlens.plus.reactivateProTrial',
	PlusResendVerification = 'gitlens.plus.resendVerification',
	PlusRestore = 'gitlens.plus.restore',
	PlusShowPlans = 'gitlens.plus.showPlans',
	PlusSignUp = 'gitlens.plus.signUp',
	PlusStartPreviewTrial = 'gitlens.plus.startPreviewTrial',
	PlusValidate = 'gitlens.plus.validate',
	QuickOpenFileHistory = 'gitlens.quickOpenFileHistory',
	RefreshFocus = 'gitlens.focus.refresh',
	RefreshGraph = 'gitlens.graph.refresh',
	RefreshHover = 'gitlens.refreshHover',
	ResetAvatarCache = 'gitlens.resetAvatarCache',
	ResetAIKey = 'gitlens.resetAIKey',
	ResetSuppressedWarnings = 'gitlens.resetSuppressedWarnings',
	ResetTrackedUsage = 'gitlens.resetTrackedUsage',
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
	ToggleGraph = 'gitlens.toggleGraph',
	ToggleMaximizedGraph = 'gitlens.toggleMaximizedGraph',
	ToggleLineBlame = 'gitlens.toggleLineBlame',
	ToggleReviewMode = 'gitlens.toggleReviewMode',
	ToggleZenMode = 'gitlens.toggleZenMode',
	ViewsCopy = 'gitlens.views.copy',
	ViewsOpenDirectoryDiff = 'gitlens.views.openDirectoryDiff',
	ViewsOpenDirectoryDiffWithWorking = 'gitlens.views.openDirectoryDiffWithWorking',

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
	| `drafts.${'copy' | 'refresh' | 'create' | 'delete' | 'open'}`
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

export type ContextKeys =
	| `${typeof extensionPrefix}:action:${string}`
	| `${typeof extensionPrefix}:key:${Keys}`
	| `${typeof extensionPrefix}:webview:${WebviewTypes | CustomEditorTypes}:visible`
	| `${typeof extensionPrefix}:webviewView:${WebviewViewTypes}:visible`
	| `${typeof extensionPrefix}:activeFileStatus`
	| `${typeof extensionPrefix}:annotationStatus`
	| `${typeof extensionPrefix}:debugging`
	| `${typeof extensionPrefix}:disabledToggleCodeLens`
	| `${typeof extensionPrefix}:disabled`
	| `${typeof extensionPrefix}:enabled`
	| `${typeof extensionPrefix}:gk:hasOrganizations`
	| `${typeof extensionPrefix}:gk:organization:ai:enabled`
	| `${typeof extensionPrefix}:gk:organization:drafts:byob`
	| `${typeof extensionPrefix}:gk:organization:drafts:enabled`
	| `${typeof extensionPrefix}:hasConnectedRemotes`
	| `${typeof extensionPrefix}:hasRemotes`
	| `${typeof extensionPrefix}:hasRichRemotes`
	| `${typeof extensionPrefix}:hasVirtualFolders`
	| `${typeof extensionPrefix}:prerelease`
	| `${typeof extensionPrefix}:readonly`
	| `${typeof extensionPrefix}:untrusted`
	| `${typeof extensionPrefix}:views:canCompare`
	| `${typeof extensionPrefix}:views:canCompare:file`
	| `${typeof extensionPrefix}:views:commits:filtered`
	| `${typeof extensionPrefix}:views:commits:hideMergeCommits`
	| `${typeof extensionPrefix}:views:contributors:hideMergeCommits`
	| `${typeof extensionPrefix}:views:fileHistory:canPin`
	| `${typeof extensionPrefix}:views:fileHistory:cursorFollowing`
	| `${typeof extensionPrefix}:views:fileHistory:editorFollowing`
	| `${typeof extensionPrefix}:views:lineHistory:editorFollowing`
	| `${typeof extensionPrefix}:views:patchDetails:mode`
	| `${typeof extensionPrefix}:views:repositories:autoRefresh`
	| `${typeof extensionPrefix}:vsls`
	| `${typeof extensionPrefix}:plus`
	| `${typeof extensionPrefix}:plus:disallowedRepos`
	| `${typeof extensionPrefix}:plus:enabled`
	| `${typeof extensionPrefix}:plus:required`
	| `${typeof extensionPrefix}:plus:state`;

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

export type TelemetryEvents =
	| 'account/validation/failed'
	| 'activate'
	| 'command'
	| 'command/core'
	| 'remoteProviders/connected'
	| 'remoteProviders/disconnected'
	| 'providers/changed'
	| 'providers/context'
	| 'providers/registrationComplete'
	| 'repositories/changed'
	| 'repositories/visibility'
	| 'repository/opened'
	| 'repository/visibility'
	| 'subscription'
	| 'subscription/changed'
	| 'usage/track';

export type AIProviders = 'anthropic' | 'openai';
export type AIModels<Provider extends AIProviders = AIProviders> = Provider extends 'openai'
	? OpenAIModels
	: Provider extends 'anthropic'
	  ? AnthropicModels
	  : OpenAIModels | AnthropicModels;

export type SecretKeys =
	| `gitlens.integration.auth:${string}`
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
