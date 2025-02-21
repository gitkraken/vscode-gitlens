import type { ContributedCommands, ContributedPaletteCommands } from './constants.commands.generated';
import type {
	CoreViewContainerIds,
	TreeViewIds,
	TreeViewTypes,
	ViewContainerIds,
	ViewIds,
	WebviewTypes,
	WebviewViewTypes,
} from './constants.views';

export const actionCommandPrefix = 'gitlens.action.';

export const enum GlCommand {
	BrowseRepoAtRevision = 'gitlens.browseRepoAtRevision',
	BrowseRepoAtRevisionInNewWindow = 'gitlens.browseRepoAtRevisionInNewWindow',
	BrowseRepoBeforeRevision = 'gitlens.browseRepoBeforeRevision',
	BrowseRepoBeforeRevisionInNewWindow = 'gitlens.browseRepoBeforeRevisionInNewWindow',
	CompareWith = 'gitlens.compareWith',
	CompareHeadWith = 'gitlens.compareHeadWith',
	CompareWorkingWith = 'gitlens.compareWorkingWith',
	ConnectRemoteProvider = 'gitlens.connectRemoteProvider',
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
	CreateCloudPatch = 'gitlens.createCloudPatch',
	CreatePullRequestOnRemote = 'gitlens.createPullRequestOnRemote',
	DiffFolderWithRevisionFrom = 'gitlens.diffFolderWithRevisionFrom',
	DiffWith = 'gitlens.diffWith',
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	DiffLineWithPrevious = 'gitlens.diffLineWithPrevious',
	DiffWithRevision = 'gitlens.diffWithRevision',
	DiffWithRevisionFrom = 'gitlens.diffWithRevisionFrom',
	DiffWithWorking = 'gitlens.diffWithWorking',
	DiffLineWithWorking = 'gitlens.diffLineWithWorking',
	DisconnectRemoteProvider = 'gitlens.disconnectRemoteProvider',
	GenerateCommitMessage = 'gitlens.generateCommitMessage',
	GenerateCommitMessageScm = 'gitlens.scm.generateCommitMessage',
	InviteToLiveShare = 'gitlens.inviteToLiveShare',
	OpenBlamePriorToChange = 'gitlens.openBlamePriorToChange',
	OpenBranchOnRemote = 'gitlens.openBranchOnRemote',
	OpenChangedFiles = 'gitlens.openChangedFiles',
	OpenCommitOnRemote = 'gitlens.openCommitOnRemote',
	OpenFileHistory = 'gitlens.openFileHistory',
	OpenFileOnRemote = 'gitlens.openFileOnRemote',
	OpenFileOnRemoteFrom = 'gitlens.openFileOnRemoteFrom',
	OpenFileAtRevision = 'gitlens.openFileRevision',
	OpenFileAtRevisionFrom = 'gitlens.openFileRevisionFrom',
	OpenFolderHistory = 'gitlens.openFolderHistory',
	OpenOnRemote = 'gitlens.openOnRemote',
	OpenCloudPatch = 'gitlens.openCloudPatch',
	OpenPullRequestOnRemote = 'gitlens.openPullRequestOnRemote',
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
	RevealCommitInView = 'gitlens.revealCommitInView',
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
	ShowInCommitGraph = 'gitlens.showInCommitGraph',
	ShowInCommitGraphView = 'gitlens.showInCommitGraphView',
	ShowInDetailsView = 'gitlens.showInDetailsView',
	ShowLaunchpadView = 'gitlens.showLaunchpadView',
	ShowLineHistoryView = 'gitlens.showLineHistoryView',
	OpenOnlyChangedFiles = 'gitlens.openOnlyChangedFiles',
	ShowPatchDetailsPage = 'gitlens.showPatchDetailsPage',
	ShowQuickBranchHistory = 'gitlens.showQuickBranchHistory',
	ShowQuickCommit = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFile = 'gitlens.showQuickCommitFileDetails',
	ShowRemotesView = 'gitlens.showRemotesView',
	ShowRepositoriesView = 'gitlens.showRepositoriesView',
	ShowSearchAndCompareView = 'gitlens.showSearchAndCompareView',
	ShowStashesView = 'gitlens.showStashesView',
	ShowTagsView = 'gitlens.showTagsView',
	ShowTimelineView = 'gitlens.showTimelineView',
	ShowWorktreesView = 'gitlens.showWorktreesView',
	ShowWorkspacesView = 'gitlens.showWorkspacesView',
	ViewsCopy = 'gitlens.views.copy',
	ViewsCopyUrl = 'gitlens.views.copyUrl',
	ViewsOpenDirectoryDiff = 'gitlens.views.openDirectoryDiff',
	ViewsOpenDirectoryDiffWithWorking = 'gitlens.views.openDirectoryDiffWithWorking',
	ViewsOpenUrl = 'gitlens.views.openUrl',
}

type GlCommandsDeprecated =
	| 'gitlens.diffHeadWith'
	| 'gitlens.diffWorkingWith'
	| 'gitlens.openBranchesInRemote'
	| 'gitlens.openBranchInRemote'
	| 'gitlens.openCommitInRemote'
	| 'gitlens.openFileInRemote'
	| 'gitlens.openInRemote'
	| 'gitlens.openRepoInRemote'
	| 'gitlens.showFileHistoryInView';

type InternalGraphWebviewCommands =
	| 'gitlens.graph.abortPausedOperation'
	| 'gitlens.graph.continuePausedOperation'
	| 'gitlens.graph.openRebaseEditor'
	| 'gitlens.graph.skipPausedOperation';

type InternalHomeWebviewCommands =
	| 'gitlens.home.openMergeTargetComparison'
	| 'gitlens.home.openPullRequestChanges'
	| 'gitlens.home.openPullRequestComparison'
	| 'gitlens.home.openPullRequestOnRemote'
	| 'gitlens.home.openPullRequestDetails'
	| 'gitlens.home.createPullRequest'
	| 'gitlens.home.openWorktree'
	| 'gitlens.home.switchToBranch'
	| 'gitlens.home.fetch'
	| 'gitlens.home.openInGraph'
	| 'gitlens.home.createBranch'
	| 'gitlens.home.mergeIntoCurrent'
	| 'gitlens.home.rebaseCurrentOnto'
	| 'gitlens.home.startWork'
	| 'gitlens.home.createCloudPatch'
	| 'gitlens.home.skipPausedOperation'
	| 'gitlens.home.continuePausedOperation'
	| 'gitlens.home.abortPausedOperation'
	| 'gitlens.home.openRebaseEditor';

type InternalHomeWebviewViewCommands =
	| 'gitlens.views.home.account.resync'
	| 'gitlens.views.home.publishBranch'
	| 'gitlens.views.home.pull'
	| 'gitlens.views.home.push';

type InternalLaunchPadCommands = 'gitlens.launchpad.indicator.action';

type InternalPlusCommands =
	| 'gitlens.plus.continueFeaturePreview'
	| 'gitlens.plus.resendVerification'
	| 'gitlens.plus.showPlans'
	| 'gitlens.plus.validate';

type InternalPullRequestViewCommands = 'gitlens.views.addPullRequestRemote';

type InternalScmGroupedViewCommands =
	| 'gitlens.views.scm.grouped.welcome.dismiss'
	| 'gitlens.views.scm.grouped.welcome.restore';

type InternalSearchAndCompareViewCommands = 'gitlens.views.searchAndCompare.compareWithSelected';

type InternalTimelineWebviewViewCommands = 'gitlens.views.timeline.openInTab';

type InternalWalkthroughCommands =
	| 'gitlens.walkthrough.connectIntegrations'
	| 'gitlens.walkthrough.gitlensInspect'
	| 'gitlens.walkthrough.openAcceleratePrReviews'
	| 'gitlens.walkthrough.openCommunityVsPro'
	| 'gitlens.walkthrough.openHelpCenter'
	| 'gitlens.walkthrough.openInteractiveCodeHistory'
	| 'gitlens.walkthrough.openStartIntegrations'
	| 'gitlens.walkthrough.openStreamlineCollaboration'
	| 'gitlens.walkthrough.openWalkthrough'
	| 'gitlens.walkthrough.plus.signUp'
	| 'gitlens.walkthrough.plus.upgrade'
	| 'gitlens.walkthrough.plus.reactivate'
	| 'gitlens.walkthrough.showAutolinks'
	| 'gitlens.walkthrough.showDraftsView'
	| 'gitlens.walkthrough.showGraph'
	| 'gitlens.walkthrough.showLaunchpad'
	| 'gitlens.walkthrough.worktree.create'
	| 'gitlens.walkthrough.openDevExPlatform';

type InternalGlCommands =
	| `gitlens.action.${string}`
	| 'gitlens.diffWith'
	| 'gitlens.openOnRemote'
	| 'gitlens.openWalkthrough'
	| 'gitlens.refreshHover'
	| InternalGraphWebviewCommands
	| InternalHomeWebviewCommands
	| InternalHomeWebviewViewCommands
	| InternalLaunchPadCommands
	| InternalPlusCommands
	| InternalPullRequestViewCommands
	| InternalScmGroupedViewCommands
	| InternalSearchAndCompareViewCommands
	| InternalTimelineWebviewViewCommands
	| InternalWalkthroughCommands;

export type GlCommands = ContributedCommands | InternalGlCommands | GlCommandsDeprecated;
export type GlPaletteCommands = ContributedPaletteCommands;

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

type ExtractSuffix<Prefix extends string, U> = U extends `${Prefix}${infer V}` ? V : never;
type FilterCommands<Prefix extends string, U> = U extends `${Prefix}${infer V}` ? `${Prefix}${V}` : never;

export type TreeViewCommands = FilterCommands<`gitlens.views.${TreeViewTypes}`, GlCommands>;

export type TreeViewCommandsByViewId<T extends TreeViewIds> = FilterCommands<T, GlCommands>;
export type TreeViewCommandsByViewType<T extends TreeViewTypes> = FilterCommands<`gitlens.views.${T}.`, GlCommands>;
export type TreeViewCommandSuffixesByViewType<T extends TreeViewTypes> = ExtractSuffix<
	`gitlens.views.${T}.`,
	TreeViewCommandsByViewType<T>
>;

export type WebviewCommands = FilterCommands<`gitlens.${WebviewTypes}`, GlCommands>;
export type WebviewViewCommands = FilterCommands<`gitlens.views.${WebviewViewTypes}`, GlCommands>;
