import type { ViewShowBranchComparison } from './config';
import type { Environment } from './container';
import type { StoredSearchQuery } from './git/search';
import type { Subscription } from './subscription';
import type { TrackedUsage, TrackedUsageKeys } from './telemetry/usageTracker';
import type { CommitDetailsDismissed } from './webviews/commitDetails/protocol';
import type { CompletedActions } from './webviews/home/protocol';

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
	| `${typeof extensionPrefix}.decorations.renamedForegroundColor`
	| `${typeof extensionPrefix}.decorations.untrackedForegroundColor`
	| `${typeof extensionPrefix}.decorations.worktreeView.hasUncommittedChangesForegroundColor`
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
	CopyDeepLinkToRepo = 'gitlens.copyDeepLinkToRepo',
	CopyDeepLinkToTag = 'gitlens.copyDeepLinkToTag',
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
	CreatePullRequestOnRemote = 'gitlens.createPullRequestOnRemote',
	DiffDirectory = 'gitlens.diffDirectory',
	DiffDirectoryWithHead = 'gitlens.diffDirectoryWithHead',
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
	GitCommandsCherryPick = 'gitlens.gitCommands.cherryPick',
	GitCommandsMerge = 'gitlens.gitCommands.merge',
	GitCommandsRebase = 'gitlens.gitCommands.rebase',
	GitCommandsReset = 'gitlens.gitCommands.reset',
	GitCommandsRevert = 'gitlens.gitCommands.revert',
	GitCommandsSwitch = 'gitlens.gitCommands.switch',
	GitCommandsTag = 'gitlens.gitCommands.tag',
	GitCommandsWorktree = 'gitlens.gitCommands.worktree',
	GitCommandsWorktreeOpen = 'gitlens.gitCommands.worktree.open',
	OpenOrCreateWorktreeForGHPR = 'gitlens.ghpr.views.openOrCreateWorktree',
	PlusHide = 'gitlens.plus.hide',
	PlusLearn = 'gitlens.plus.learn',
	PlusLoginOrSignUp = 'gitlens.plus.loginOrSignUp',
	PlusLogout = 'gitlens.plus.logout',
	PlusManage = 'gitlens.plus.manage',
	PlusPurchase = 'gitlens.plus.purchase',
	PlusResendVerification = 'gitlens.plus.resendVerification',
	PlusRestore = 'gitlens.plus.restore',
	PlusShowPlans = 'gitlens.plus.showPlans',
	PlusStartPreviewTrial = 'gitlens.plus.startPreviewTrial',
	PlusValidate = 'gitlens.plus.validate',
	QuickOpenFileHistory = 'gitlens.quickOpenFileHistory',
	RefreshFocus = 'gitlens.focus.refresh',
	RefreshGraph = 'gitlens.graph.refresh',
	RefreshHover = 'gitlens.refreshHover',
	RefreshTimelinePage = 'gitlens.timeline.refresh',
	ResetAvatarCache = 'gitlens.resetAvatarCache',
	ResetOpenAIKey = 'gitlens.resetOpenAIKey',
	ResetSuppressedWarnings = 'gitlens.resetSuppressedWarnings',
	ResetTrackedUsage = 'gitlens.resetTrackedUsage',
	RevealCommitInView = 'gitlens.revealCommitInView',
	SearchCommits = 'gitlens.showCommitSearch',
	SearchCommitsInView = 'gitlens.views.searchAndCompare.searchCommits',
	SetViewsLayout = 'gitlens.setViewsLayout',
	ShowBranchesView = 'gitlens.showBranchesView',
	ShowCommitDetailsView = 'gitlens.showCommitDetailsView',
	ShowCommitInView = 'gitlens.showCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowCommitsView = 'gitlens.showCommitsView',
	ShowContributorsView = 'gitlens.showContributorsView',
	ShowFileHistoryView = 'gitlens.showFileHistoryView',
	ShowFocusPage = 'gitlens.showFocusPage',
	ShowGraph = 'gitlens.showGraph',
	ShowGraphPage = 'gitlens.showGraphPage',
	ShowGraphView = 'gitlens.showGraphView',
	ShowHomeView = 'gitlens.showHomeView',
	ShowAccountView = 'gitlens.showAccountView',
	ShowInCommitGraph = 'gitlens.showInCommitGraph',
	ShowInDetailsView = 'gitlens.showInDetailsView',
	ShowLastQuickPick = 'gitlens.showLastQuickPick',
	ShowLineCommitInView = 'gitlens.showLineCommitInView',
	ShowLineHistoryView = 'gitlens.showLineHistoryView',
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
	ShowSettingsPageAndJumpToBranchesView = 'gitlens.showSettingsPage#branches-view',
	ShowSettingsPageAndJumpToCommitsView = 'gitlens.showSettingsPage#commits-view',
	ShowSettingsPageAndJumpToContributorsView = 'gitlens.showSettingsPage#contributors-view',
	ShowSettingsPageAndJumpToFileHistoryView = 'gitlens.showSettingsPage#file-history-view',
	ShowSettingsPageAndJumpToLineHistoryView = 'gitlens.showSettingsPage#line-history-view',
	ShowSettingsPageAndJumpToRemotesView = 'gitlens.showSettingsPage#remotes-view',
	ShowSettingsPageAndJumpToRepositoriesView = 'gitlens.showSettingsPage#repositories-view',
	ShowSettingsPageAndJumpToSearchAndCompareView = 'gitlens.showSettingsPage#search-compare-view',
	ShowSettingsPageAndJumpToStashesView = 'gitlens.showSettingsPage#stashes-view',
	ShowSettingsPageAndJumpToTagsView = 'gitlens.showSettingsPage#tags-view',
	ShowSettingsPageAndJumpToWorkTreesView = 'gitlens.showSettingsPage#worktrees-view',
	ShowSettingsPageAndJumpToViews = 'gitlens.showSettingsPage#views',
	ShowSettingsPageAndJumpToCommitGraph = 'gitlens.showSettingsPage#commit-graph',
	ShowSettingsPageAndJumpToAutolinks = 'gitlens.showSettingsPage#autolinks',
	ShowStashesView = 'gitlens.showStashesView',
	ShowTagsView = 'gitlens.showTagsView',
	ShowTimelinePage = 'gitlens.showTimelinePage',
	ShowTimelineView = 'gitlens.showTimelineView',
	ShowWelcomePage = 'gitlens.showWelcomePage',
	ShowWorktreesView = 'gitlens.showWorktreesView',
	StashApply = 'gitlens.stashApply',
	StashSave = 'gitlens.stashSave',
	StashSaveFiles = 'gitlens.stashSaveFiles',
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

export type CustomEditorIds = 'rebase';
export type WebviewIds = 'graph' | 'settings' | 'timeline' | 'welcome' | 'focus';
export type WebviewViewIds = 'commitDetails' | 'graph' | 'graphDetails' | 'home' | 'timeline' | 'account';

export type ContextKeys =
	| `${typeof extensionPrefix}:action:${string}`
	| `${typeof extensionPrefix}:key:${Keys}`
	| `${typeof extensionPrefix}:webview:${WebviewIds | CustomEditorIds}:${'active' | 'focus' | 'inputFocus'}`
	| `${typeof extensionPrefix}:webviewView:${WebviewViewIds}:${'active' | 'focus' | 'inputFocus'}`
	| `${typeof extensionPrefix}:activeFileStatus`
	| `${typeof extensionPrefix}:annotationStatus`
	| `${typeof extensionPrefix}:debugging`
	| `${typeof extensionPrefix}:disabledToggleCodeLens`
	| `${typeof extensionPrefix}:disabled`
	| `${typeof extensionPrefix}:enabled`
	| `${typeof extensionPrefix}:focus:focused` // TODO@eamodio do we need this
	| `${typeof extensionPrefix}:hasConnectedRemotes`
	| `${typeof extensionPrefix}:hasRemotes`
	| `${typeof extensionPrefix}:hasRichRemotes`
	| `${typeof extensionPrefix}:hasVirtualFolders`
	| `${typeof extensionPrefix}:prerelease`
	| `${typeof extensionPrefix}:readonly`
	| `${typeof extensionPrefix}:untrusted`
	| `${typeof extensionPrefix}:views:canCompare`
	| `${typeof extensionPrefix}:views:canCompare:file`
	| `${typeof extensionPrefix}:views:commits:myCommitsOnly`
	| `${typeof extensionPrefix}:views:fileHistory:canPin`
	| `${typeof extensionPrefix}:views:fileHistory:cursorFollowing`
	| `${typeof extensionPrefix}:views:fileHistory:editorFollowing`
	| `${typeof extensionPrefix}:views:lineHistory:editorFollowing`
	| `${typeof extensionPrefix}:views:repositories:autoRefresh`
	| `${typeof extensionPrefix}:views:searchAndCompare:keepResults`
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
	| 'openInTerminal'
	| 'revealFileInOS'
	| 'revealInExplorer'
	| 'revealLine'
	| 'setContext'
	| 'vscode.open'
	| 'vscode.openFolder'
	| 'vscode.openWith'
	| 'vscode.diff'
	| 'vscode.executeCodeLensProvider'
	| 'vscode.executeDocumentSymbolProvider'
	| 'vscode.moveViews'
	| 'vscode.previewHtml'
	| 'workbench.action.closeActiveEditor'
	| 'workbench.action.openWalkthrough'
	| 'workbench.action.closeAllEditors'
	| 'workbench.action.nextEditor'
	| 'workbench.extensions.installExtension'
	| 'workbench.extensions.uninstallExtension'
	| 'workbench.files.action.focusFilesExplorer'
	| 'workbench.view.explorer'
	| 'workbench.view.scm';

export type CoreGitCommands =
	| 'git.fetch'
	| 'git.publish'
	| 'git.pull'
	| 'git.pullRebase'
	| 'git.push'
	| 'git.pushForce'
	| 'git.undoCommit';

export type CoreConfiguration =
	| 'editor.letterSpacing'
	| 'files.encoding'
	| 'files.exclude'
	| 'http.proxy'
	| 'http.proxySupport'
	| 'http.proxyStrictSSL'
	| 'search.exclude'
	| 'workbench.editorAssociations'
	| 'workbench.tree.renderIndentGuides';

export type CoreGitConfiguration =
	| 'git.autoRepositoryDetection'
	| 'git.enabled'
	| 'git.fetchOnPull'
	| 'git.path'
	| 'git.repositoryScanIgnoredFolders'
	| 'git.repositoryScanMaxDepth'
	| 'git.useForcePushWithLease';

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
	/** @deprecated use `confirm:ai:send:openai` */
	'confirm:sendToOpenAI': boolean;
} & {
	/** @deprecated */
	[key in `disallow:connection:${string}`]: any;
};

export type GlobalStorage = {
	avatars: [string, StoredAvatar][];
	repoVisibility: [string, StoredRepoVisibilityInfo][];
	'deepLinks:pending': StoredDeepLinkContext;
	'home:actions:completed': CompletedActions[];
	'home:steps:completed': string[];
	'home:sections:dismissed': string[];
	'home:status:pinned': boolean;
	'home:banners:dismissed': string[];
	pendingWelcomeOnFocus: boolean;
	pendingWhatsNewOnFocus: boolean;
	'plus:migratedAuthentication': boolean;
	'plus:discountNotificationShown': boolean;
	'plus:renewalDiscountNotificationShown': boolean;
	// Don't change this key name ('premium`) as its the stored subscription
	'premium:subscription': Stored<Subscription>;
	'synced:version': string;
	// Keep the pre-release version separate from the released version
	'synced:preVersion': string;
	usages: Record<TrackedUsageKeys, TrackedUsage>;
	version: string;
	// Keep the pre-release version separate from the released version
	preVersion: string;
	'views:layout': StoredViewsLayout;
	'views:welcome:visible': boolean;
	'views:commitDetails:dismissed': CommitDetailsDismissed[];
} & { [key in `confirm:ai:tos:${AIProviders}`]: boolean } & {
	[key in `provider:authentication:skip:${string}`]: boolean;
};

export type DeprecatedWorkspaceStorage = {
	/** @deprecated use `confirm:ai:send:openai` */
	'confirm:sendToOpenAI': boolean;
	/** @deprecated use `graph:filtersByRepo.excludeRefs` */
	'graph:hiddenRefs': Record<string, StoredGraphExcludedRef>;
	/** @deprecated use `views:searchAndCompare:pinned` */
	'pinned:comparisons': Record<string, DeprecatedPinnedComparison>;
};

export type WorkspaceStorage = {
	assumeRepositoriesOnStartup?: boolean;
	'branch:comparisons': StoredBranchComparisons;
	'gitComandPalette:usage': RecentUsage;
	gitPath: string;
	'graph:banners:dismissed': Record<string, boolean>;
	'graph:columns': Record<string, StoredGraphColumn>;
	'graph:filtersByRepo': Record<string, StoredGraphFilters>;
	'remote:default': string;
	'starred:branches': StoredStarred;
	'starred:repositories': StoredStarred;
	'views:repositories:autoRefresh': boolean;
	'views:searchAndCompare:keepResults': boolean;
	'views:searchAndCompare:pinned': StoredPinnedItems;
	'views:commitDetails:autolinksExpanded': boolean;
} & { [key in `confirm:ai:tos:${AIProviders}`]: boolean } & { [key in `connected:${string}`]: boolean };

export type StoredViewsLayout = 'gitlens' | 'scm';
export interface Stored<T, SchemaVersion extends number = 1> {
	v: SchemaVersion;
	data: T;
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
	notation: '..' | '...' | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
}

export interface StoredBranchComparisons {
	[id: string]: string | StoredBranchComparison;
}

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

export interface StoredPinnedComparison {
	type: 'comparison';
	timestamp: number;
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: '..' | '...';
}

export interface StoredPinnedSearch {
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

export type StoredPinnedItem = StoredPinnedComparison | StoredPinnedSearch;
export type StoredPinnedItems = Record<string, StoredPinnedItem>;
export type StoredStarred = Record<string, boolean>;
export type RecentUsage = Record<string, number>;

interface DeprecatedPinnedComparison {
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: '..' | '...';
}
