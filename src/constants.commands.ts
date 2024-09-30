import type { CoreViewContainerIds, TreeViewIds, TreeViewTypes, ViewContainerIds, ViewIds } from './constants.views';

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
	| `launchpad.${
			| 'copy'
			| 'info'
			| 'refresh'
			| `setFilesLayoutTo${'Auto' | 'List' | 'Tree'}`
			| `setShowAvatars${'On' | 'Off'}`}`
	| `lineHistory.${
			| 'copy'
			| 'refresh'
			| 'changeBase'
			| `setEditorFollowing${'On' | 'Off'}`
			| `setShowAvatars${'On' | 'Off'}`}`
	| `pullRequest.${
			| 'close'
			| 'copy'
			| 'refresh'
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
