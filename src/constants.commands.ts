import type { Keys } from './constants';
import type { CoreViewContainerIds, TreeViewIds, TreeViewTypes, ViewContainerIds, ViewIds } from './constants.views';

export const actionCommandPrefix = 'gitlens.action.';

export const enum GlCommand {
	AddAuthors = 'gitlens.addAuthors',
	AssociateIssueWithBranch = 'gitlens.associateIssueWithBranch',
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
	PastePatchFromClipboard = 'gitlens.pastePatchFromClipboard',
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
	GenerateCommitMessageScm = 'gitlens.scm.generateCommitMessage',
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
	PlusConnectCloudIntegrations = 'gitlens.plus.cloudIntegrations.connect',
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
	PlusContinueFeaturePreview = 'gitlens.plus.continueFeaturePreview',
	PlusUpgrade = 'gitlens.plus.upgrade',
	PlusValidate = 'gitlens.plus.validate',
	PlusSimulateSubscription = 'gitlens.plus.simulateSubscription',
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
	ShowLaunchpadView = 'gitlens.showLaunchpadView',
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
	ShowWorktreesView = 'gitlens.showWorktreesView',
	ShowWorkspacesView = 'gitlens.showWorkspacesView',
	StartWork = 'gitlens.startWork',
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
	WalkthroughConnectIntegrations = 'gitlens.walkthrough.connectIntegrations',
	WalkthroughGitLensInspect = 'gitlens.walkthrough.gitlensInspect',
	WalkthroughOpenAcceleratePrReviews = 'gitlens.walkthrough.openAcceleratePrReviews',
	WalkthroughOpenCommunityVsPro = 'gitlens.walkthrough.openCommunityVsPro',
	WalkthroughOpenHelpCenter = 'gitlens.walkthrough.openHelpCenter',
	WalkthroughOpenInteractiveCodeHistory = 'gitlens.walkthrough.openInteractiveCodeHistory',
	WalkthroughOpenStartIntegrations = 'gitlens.walkthrough.openStartIntegrations',
	WalkthroughOpenStreamlineCollaboration = 'gitlens.walkthrough.openStreamlineCollaboration',
	WalkthroughOpenWalkthrough = 'gitlens.walkthrough.openWalkthrough',
	WalkthroughPlusSignUp = 'gitlens.walkthrough.plus.signUp',
	WalkthroughPlusUpgrade = 'gitlens.walkthrough.plus.upgrade',
	WalkthroughPlusReactivate = 'gitlens.walkthrough.plus.reactivate',
	WalkthroughShowAutolinks = 'gitlens.walkthrough.showAutolinks',
	WalkthroughShowDraftsView = 'gitlens.walkthrough.showDraftsView',
	WalkthroughShowGraph = 'gitlens.walkthrough.showGraph',
	WalkthroughShowLaunchpad = 'gitlens.walkthrough.showLaunchpad',
	WalkthroughWorktreeCreate = 'gitlens.walkthrough.worktree.create',
	WalkthoughOpenDevExPlatform = 'gitlens.walkthrough.openDevExPlatform',

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

export type GlCommands =
	| `${GlCommand}`
	| `gitlens.action.${string}`
	| 'gitlens.annotations.nextChange'
	| 'gitlens.annotations.previousChange'
	| `gitlens.key.${Keys}`
	| 'gitlens.plus.refreshRepositoryAccess'
	| 'gitlens.launchpad.indicator.action';

export type Commands = GlCommands | TreeViewCommands | WebviewCommands | WebviewViewCommands;

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
	| 'workbench.extensions.action.switchToRelease'
	| 'workbench.extensions.installExtension'
	| 'workbench.extensions.uninstallExtension'
	| 'workbench.files.action.focusFilesExplorer'
	| 'workbench.view.explorer'
	| 'workbench.view.extension.gitlensInspect'
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

type BranchesViewCommands = `branches.${
	| 'copy'
	| 'refresh'
	| 'regroup'
	| `setLayoutTo${'List' | 'Tree'}`
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAvatars${'On' | 'Off'}`
	| `setShowBranchComparison${'On' | 'Off'}`
	| `setShowBranchPullRequest${'On' | 'Off'}`
	| `setShowRemoteBranches${'On' | 'Off'}`
	| `setShowStashes${'On' | 'Off'}`}`;

type CommitsViewCommands = `commits.${
	| 'copy'
	| 'refresh'
	| 'regroup'
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setCommitsFilter${'Authors' | 'Off'}`
	| `setShowAvatars${'On' | 'Off'}`
	| `setShowBranchComparison${'On' | 'Off'}`
	| `setShowBranchPullRequest${'On' | 'Off'}`
	| `setShowMergeCommits${'On' | 'Off'}`
	| `setShowStashes${'On' | 'Off'}`}`;

type ContributorsViewCommands = `contributors.${
	| 'copy'
	| 'refresh'
	| 'regroup'
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAllBranches${'On' | 'Off'}`
	| `setShowAvatars${'On' | 'Off'}`
	| `setShowMergeCommits${'On' | 'Off'}`
	| `setShowStatistics${'On' | 'Off'}`}`;

type DraftsViewCommands = `drafts.${
	| 'copy'
	| 'refresh'
	| 'info'
	| 'create'
	| 'delete'
	| `setShowAvatars${'On' | 'Off'}`}`;

type FileHistoryViewCommands = `fileHistory.${
	| 'copy'
	| 'refresh'
	| 'changeBase'
	| `setCursorFollowing${'On' | 'Off'}`
	| `setEditorFollowing${'On' | 'Off'}`
	| `setRenameFollowing${'On' | 'Off'}`
	| `setShowAllBranches${'On' | 'Off'}`
	| `setShowMergeCommits${'On' | 'Off'}`
	| `setShowAvatars${'On' | 'Off'}`}`;

type LaunchpadViewCommands = `launchpad.${
	| 'copy'
	| 'info'
	| 'refresh'
	| 'regroup'
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAvatars${'On' | 'Off'}`}`;

type LineHistoryViewCommands = `lineHistory.${
	| 'copy'
	| 'refresh'
	| 'changeBase'
	| `setEditorFollowing${'On' | 'Off'}`
	| `setShowAvatars${'On' | 'Off'}`}`;

type PullRequestViewCommands = `pullRequest.${
	| 'close'
	| 'copy'
	| 'refresh'
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAvatars${'On' | 'Off'}`}`;

type RemotesViewCommands = `remotes.${
	| 'copy'
	| 'refresh'
	| 'regroup'
	| `setLayoutTo${'List' | 'Tree'}`
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAvatars${'On' | 'Off'}`
	| `setShowBranchPullRequest${'On' | 'Off'}`}`;

type RepositoriesViewCommands = `repositories.${
	| 'copy'
	| 'refresh'
	| 'regroup'
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
	| `setShowSectionOff`}`;

type ScmGroupedViewCommands = `scm.grouped.${
	| 'welcome.restore'
	| 'welcome.dismiss'
	| 'focus'
	| 'refresh'
	| 'detachAll'
	| 'regroupAll'
	| `${
			| 'branches'
			| 'commits'
			| 'contributors'
			| 'launchpad'
			| 'remotes'
			| 'repositories'
			| 'searchAndCompare'
			| 'stashes'
			| 'tags'
			| 'worktrees'}${'' | '.regroup' | '.detach' | '.setAsDefault'}`
	| 'toggleSection'
	| 'toggleSectionByNode'}`;

type SearchAndCompareViewCommands = `searchAndCompare.${
	| 'copy'
	| 'refresh'
	| 'regroup'
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
	| 'setFilesFilterOff'}`;

type StashesViewCommands = `stashes.${'copy' | 'refresh' | 'regroup' | `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`}`;
type TagsViewCommands = `tags.${
	| 'copy'
	| 'refresh'
	| 'regroup'
	| `setLayoutTo${'List' | 'Tree'}`
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAvatars${'On' | 'Off'}`}`;

type WorkspacesViewCommands = `workspaces.${
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
	| `repo.${'locate' | 'open' | 'openInNewWindow' | 'addToWindow' | 'remove'}`}`;

type WorktreesViewCommands = `worktrees.${
	| 'copy'
	| 'refresh'
	| 'regroup'
	| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
	| `setShowAvatars${'On' | 'Off'}`
	| `setShowBranchComparison${'On' | 'Off'}`
	| `setShowBranchPullRequest${'On' | 'Off'}`
	| `setShowStashes${'On' | 'Off'}`}`;

export type TreeViewCommands = `gitlens.views.${
	| BranchesViewCommands
	| CommitsViewCommands
	| ContributorsViewCommands
	| DraftsViewCommands
	| FileHistoryViewCommands
	| LaunchpadViewCommands
	| LineHistoryViewCommands
	| PullRequestViewCommands
	| RemotesViewCommands
	| RepositoriesViewCommands
	| ScmGroupedViewCommands
	| SearchAndCompareViewCommands
	| StashesViewCommands
	| TagsViewCommands
	| WorkspacesViewCommands
	| WorktreesViewCommands
	| 'clearComparison'
	| 'clearReviewed'
	| 'copy'
	| 'copyAsMarkdown'
	| 'copyUrl'
	| 'copyUrl.multi'
	| 'openUrl'
	| 'openUrl.multi'
	| 'collapseNode'
	| 'dismissNode'
	| 'editNode'
	| 'expandNode'
	| 'loadMoreChildren'
	| 'loadAllChildren'
	| 'refreshNode'
	| 'setShowRelativeDateMarkersOn'
	| 'setShowRelativeDateMarkersOff'
	| 'fetch'
	| 'publishBranch'
	| 'publishRepository'
	| 'pull'
	| 'push'
	| 'pushWithForce'
	| 'closeRepository'
	| 'setAsDefault'
	| 'unsetAsDefault'
	| 'openInTerminal'
	| 'openInIntegratedTerminal'
	| 'star'
	| 'star.multi'
	| 'unstar'
	| 'unstar.multi'
	| 'browseRepoAtRevision'
	| 'browseRepoAtRevisionInNewWindow'
	| 'browseRepoBeforeRevision'
	| 'browseRepoBeforeRevisionInNewWindow'
	| 'addAuthors'
	| 'addAuthor'
	| 'addAuthor.multi'
	| 'associateIssueWithBranch'
	| 'openBranchOnRemote'
	| 'openBranchOnRemote.multi'
	| 'copyRemoteCommitUrl'
	| 'copyRemoteCommitUrl.multi'
	| 'openCommitOnRemote'
	| 'openCommitOnRemote.multi'
	| 'openChanges'
	| 'openChangesWithWorking'
	| 'openPreviousChangesWithWorking'
	| 'openFile'
	| 'openFileRevision'
	| 'openChangedFiles'
	| 'openOnlyChangedFiles'
	| 'openChangedFileDiffs'
	| 'openChangedFileDiffsWithWorking'
	| 'openChangedFileDiffsIndividually'
	| 'openChangedFileDiffsWithWorkingIndividually'
	| 'openChangedFileRevisions'
	| 'applyChanges'
	| 'highlightChanges'
	| 'highlightRevisionChanges'
	| 'restore'
	| 'switchToAnotherBranch'
	| 'switchToBranch'
	| 'switchToCommit'
	| 'switchToTag'
	| 'addRemote'
	| 'pruneRemote'
	| 'removeRemote'
	| 'stageDirectory'
	| 'stageFile'
	| 'unstageDirectory'
	| 'unstageFile'
	| 'openChangedFileDiffsWithMergeBase'
	| 'compareAncestryWithWorking'
	| 'compareWithHead'
	| 'compareBranchWithHead'
	| 'compareWithMergeBase'
	| 'compareWithUpstream'
	| 'compareWithSelected'
	| 'selectForCompare'
	| 'compareFileWithSelected'
	| 'selectFileForCompare'
	| 'compareWithWorking'
	| 'setBranchComparisonToWorking'
	| 'setBranchComparisonToBranch'
	| 'cherryPick'
	| 'cherryPick.multi'
	| 'title.createBranch'
	| 'createBranch'
	| 'deleteBranch'
	| 'deleteBranch.multi'
	| 'renameBranch'
	| 'stash.apply'
	| 'stash.delete'
	| 'stash.delete.multi'
	| 'stash.rename'
	| 'title.createTag'
	| 'createTag'
	| 'deleteTag'
	| 'deleteTag.multi'
	| 'mergeBranchInto'
	| 'pushToCommit'
	| 'rebaseOntoBranch'
	| 'rebaseOntoUpstream'
	| 'rebaseOntoCommit'
	| 'resetCommit'
	| 'resetToCommit'
	| 'resetToTip'
	| 'revert'
	| 'undoCommit'
	| 'createPullRequest'
	| 'openPullRequest'
	| 'openPullRequestChanges'
	| 'openPullRequestComparison'
	| 'draft.open'
	| 'draft.openOnWeb'
	| 'title.createWorktree'
	| 'createWorktree'
	| 'deleteWorktree'
	| 'deleteWorktree.multi'
	| 'openWorktree'
	| 'openInWorktree'
	| 'revealRepositoryInExplorer'
	| 'revealWorktreeInExplorer'
	| 'openWorktreeInNewWindow'
	| 'openWorktreeInNewWindow.multi'
	| 'setResultsCommitsFilterAuthors'
	| 'setResultsCommitsFilterOff'
	| 'setContributorsStatisticsOff'
	| 'setContributorsStatisticsOn'}`;

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

type HomeWebviewCommands = `home.${
	| 'openPullRequestChanges'
	| 'openPullRequestComparison'
	| 'openPullRequestOnRemote'
	| 'openPullRequestDetails'
	| 'createPullRequest'
	| 'openWorktree'
	| 'switchToBranch'
	| 'fetch'
	| 'openInGraph'
	| 'createBranch'
	| 'mergeIntoCurrent'
	| 'rebaseCurrentOnto'
	| 'startWork'
	| 'createCloudPatch'}`;

type GraphWebviewCommands = `graph.${
	| 'switchToEditorLayout'
	| 'switchToPanelLayout'
	| 'split'
	| 'push'
	| 'pull'
	| 'fetch'
	| 'pushWithForce'
	| 'associateIssueWithBranch'
	| 'publishBranch'
	| 'switchToAnotherBranch'
	| 'createBranch'
	| 'deleteBranch'
	| 'copyRemoteBranchUrl'
	| 'openBranchOnRemote'
	| 'mergeBranchInto'
	| 'rebaseOntoBranch'
	| 'rebaseOntoUpstream'
	| 'renameBranch'
	| 'switchToBranch'
	| 'hideLocalBranch'
	| 'hideRemoteBranch'
	| 'hideRemote'
	| 'hideRefGroup'
	| 'hideTag'
	| 'cherryPick'
	| 'copyRemoteCommitUrl'
	| 'copyRemoteCommitUrl.multi'
	| 'openCommitOnRemote'
	| 'openCommitOnRemote.multi'
	| 'commitViaSCM'
	| 'rebaseOntoCommit'
	| 'resetCommit'
	| 'resetToCommit'
	| 'resetToTip'
	| 'revert'
	| 'showInDetailsView'
	| 'switchToCommit'
	| 'undoCommit'
	| 'stash.save'
	| 'stash.apply'
	| 'stash.delete'
	| 'stash.rename'
	| 'createTag'
	| 'deleteTag'
	| 'switchToTag'
	| 'resetToTag'
	| 'createWorktree'
	| 'createPullRequest'
	| 'openPullRequest'
	| 'openPullRequestChanges'
	| 'openPullRequestComparison'
	| 'openPullRequestOnRemote'
	| 'openChangedFileDiffsWithMergeBase'
	| 'compareWithUpstream'
	| 'compareWithHead'
	| 'compareBranchWithHead'
	| 'compareWithWorking'
	| 'compareWithMergeBase'
	| 'compareAncestryWithWorking'
	| 'copy'
	| 'copyMessage'
	| 'copySha'
	| 'addAuthor'
	| 'columnAuthorOn'
	| 'columnAuthorOff'
	| 'columnDateTimeOn'
	| 'columnDateTimeOff'
	| 'columnShaOn'
	| 'columnShaOff'
	| 'columnChangesOn'
	| 'columnChangesOff'
	| 'columnGraphOn'
	| 'columnGraphOff'
	| 'columnMessageOn'
	| 'columnMessageOff'
	| 'columnRefOn'
	| 'columnRefOff'
	| 'columnGraphCompact'
	| 'columnGraphDefault'
	| 'scrollMarkerLocalBranchOn'
	| 'scrollMarkerLocalBranchOff'
	| 'scrollMarkerRemoteBranchOn'
	| 'scrollMarkerRemoteBranchOff'
	| 'scrollMarkerStashOn'
	| 'scrollMarkerStashOff'
	| 'scrollMarkerTagOn'
	| 'scrollMarkerTagOff'
	| 'scrollMarkerPullRequestOn'
	| 'scrollMarkerPullRequestOff'
	| 'copyDeepLinkToBranch'
	| 'copyDeepLinkToCommit'
	| 'copyDeepLinkToRepo'
	| 'copyDeepLinkToTag'
	| 'shareAsCloudPatch'
	| 'createPatch'
	| 'createCloudPatch'
	| 'openChangedFiles'
	| 'openOnlyChangedFiles'
	| 'openChangedFileDiffs'
	| 'openChangedFileDiffsWithWorking'
	| 'openChangedFileDiffsIndividually'
	| 'openChangedFileDiffsWithWorkingIndividually'
	| 'openChangedFileRevisions'
	| 'resetColumnsDefault'
	| 'resetColumnsCompact'
	| 'openInWorktree'
	| 'openWorktree'
	| 'openWorktreeInNewWindow'
	| 'copyWorkingChangesToWorktree'
	| 'generateCommitMessage'
	| 'compareSelectedCommits.multi'}`;

type TimelineWebviewCommands = `timeline.${'refresh' | 'split'}`;

export type WebviewCommands = `gitlens.${HomeWebviewCommands | GraphWebviewCommands | TimelineWebviewCommands}`;

type CommitDetailsWebviewViewCommands = `commitDetails.${'refresh'}`;

type HomeWebviewViewCommands = `home.${
	| 'refresh'
	| 'pull'
	| 'push'
	| 'publishBranch'
	| 'disablePreview'
	| 'enablePreview'
	| 'previewFeedback'
	| 'whatsNew'
	| 'help'
	| 'info'
	| 'issues'
	| 'discussions'
	| 'account.resync'}`;

type GraphDetailsWebviewViewCommands = `graphDetails.${'refresh'}`;

type GraphWebviewViewCommands = `graph.${'refresh' | 'openInTab'}`;

type PatchDetailsWebviewViewCommands = `patchDetails.${'refresh' | 'close'}`;

type TimelineWebviewViewCommands = `timeline.${'refresh' | 'openInTab'}`;

export type WebviewViewCommands = `gitlens.views.${
	| CommitDetailsWebviewViewCommands
	| HomeWebviewViewCommands
	| GraphDetailsWebviewViewCommands
	| GraphWebviewViewCommands
	| PatchDetailsWebviewViewCommands
	| TimelineWebviewViewCommands}`;
