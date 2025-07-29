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

export type GlCommandsDeprecated =
	/** @deprecated use `gitlens.ai.generateCommitMessage` */
	| 'gitlens.generateCommitMessage'
	/** @deprecated use `gitlens.ai.generateCommitMessage:scm` */
	| 'gitlens.scm.generateCommitMessage'
	/** @deprecated use `gitlens.ai.generateCommitMessage:scm` */
	| 'gitlens.scm.ai.generateCommitMessage'
	/** @deprecated use `gitlens.ai.switchProvider` */
	| 'gitlens.switchAIModel'
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
	| 'gitlens.graph.skipPausedOperation'
	| 'gitlens.visualizeHistory.repo:graph';

type InternalHomeWebviewCommands =
	| 'gitlens.ai.explainWip:home'
	| 'gitlens.ai.explainBranch:home'
	| 'gitlens.ai.generateCommits:home'
	| 'gitlens.ai.composeCommitsWithAI:home'
	| 'gitlens.home.changeBranchMergeTarget'
	| 'gitlens.home.deleteBranchOrWorktree'
	| 'gitlens.home.pushBranch'
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
	| 'gitlens.openInView.branch:home'
	| 'gitlens.home.createBranch'
	| 'gitlens.home.mergeIntoCurrent'
	| 'gitlens.home.rebaseCurrentOnto'
	| 'gitlens.home.startWork'
	| 'gitlens.home.createCloudPatch'
	| 'gitlens.home.skipPausedOperation'
	| 'gitlens.home.continuePausedOperation'
	| 'gitlens.home.abortPausedOperation'
	| 'gitlens.home.openRebaseEditor'
	| 'gitlens.home.enableAi'
	| 'gitlens.visualizeHistory.repo:home'
	| 'gitlens.visualizeHistory.branch:home';

type InternalHomeWebviewViewCommands =
	| 'gitlens.views.home.account.resync'
	| 'gitlens.views.home.ai.allAccess.dismiss'
	| 'gitlens.views.home.publishBranch'
	| 'gitlens.views.home.pull'
	| 'gitlens.views.home.push';

type InternalLaunchPadCommands = 'gitlens.launchpad.indicator.action';

type InternalPlusCommands =
	| 'gitlens.plus.aiAllAccess.optIn'
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
	| 'gitlens.walkthrough.enableAiSetting'
	| 'gitlens.walkthrough.gitlensInspect'
	| 'gitlens.walkthrough.openAcceleratePrReviews'
	| 'gitlens.walkthrough.openAiCustomInstructionsSettings'
	| 'gitlens.walkthrough.openAiSettings'
	| 'gitlens.walkthrough.openCommunityVsPro'
	| 'gitlens.walkthrough.openHelpCenter'
	| 'gitlens.walkthrough.openHomeViewVideo'
	| 'gitlens.walkthrough.openInteractiveCodeHistory'
	| 'gitlens.walkthrough.openLearnAboutAiFeatures'
	| 'gitlens.walkthrough.openStartIntegrations'
	| 'gitlens.walkthrough.openStreamlineCollaboration'
	| 'gitlens.walkthrough.openWalkthrough'
	| 'gitlens.walkthrough.plus.signUp'
	| 'gitlens.walkthrough.plus.upgrade'
	| 'gitlens.walkthrough.plus.reactivate'
	| 'gitlens.walkthrough.showAutolinks'
	| 'gitlens.walkthrough.showDraftsView'
	| 'gitlens.walkthrough.showGraph'
	| 'gitlens.walkthrough.showHomeView'
	| 'gitlens.walkthrough.showLaunchpad'
	| 'gitlens.walkthrough.switchAIProvider'
	| 'gitlens.walkthrough.worktree.create'
	| 'gitlens.walkthrough.openDevExPlatform';

type InternalGlCommands =
	| `gitlens.action.${string}`
	| 'gitlens.changeBranchMergeTarget'
	| 'gitlens.diffWith'
	| 'gitlens.ai.explainCommit:editor'
	| 'gitlens.ai.explainWip:editor'
	| 'gitlens.ai.feedback.helpful'
	| 'gitlens.ai.feedback.unhelpful'
	| 'gitlens.openOnRemote'
	| 'gitlens.openWalkthrough'
	| 'gitlens.refreshHover'
	| 'gitlens.regenerateMarkdownDocument'
	| 'gitlens.visualizeHistory'
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

export type GlCommands = ContributedCommands | InternalGlCommands; // | GlCommandsDeprecated;
export type GlPaletteCommands = ContributedPaletteCommands;

export type CoreCommands =
	| '_open.mergeEditor'
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
	| 'workbench.action.closeWindow'
	| 'workbench.action.focusRightGroup'
	| 'workbench.action.nextEditor'
	| 'workbench.action.newGroupRight'
	| 'workbench.action.openSettings'
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
	| `${ViewIds}.${'focus' | 'open' | 'removeView' | 'resetViewLocation' | 'toggleVisibility'}`;

export type CoreGitCommands =
	| 'git.fetch'
	| 'git.publish'
	| 'git.pull'
	| 'git.pullRebase'
	| 'git.push'
	| 'git.pushForce'
	| 'git.undoCommit';

type ExtractSuffix<Prefix extends string, U> = U extends `${Prefix}${infer V}` ? V : never;
type FilterCommands<Prefix extends string, U, Suffix extends string = ''> = U extends `${Prefix}${infer V}${Suffix}`
	? U extends `${Prefix}${V}${Suffix}`
		? U
		: never
	: never;

export type PlusCommands = FilterCommands<'gitlens.plus.', GlCommands>;

export type TreeViewCommands =
	| FilterCommands<`gitlens.views.${TreeViewTypes}`, GlCommands>
	| FilterCommands<`gitlens.`, GlCommands, ':views'>;

export type TreeViewCommandsByViewId<T extends TreeViewIds> = FilterCommands<T, GlCommands>;
export type TreeViewCommandsByViewType<T extends TreeViewTypes> = FilterCommands<`gitlens.views.${T}.`, GlCommands>;
export type TreeViewCommandSuffixesByViewType<T extends TreeViewTypes> = ExtractSuffix<
	`gitlens.views.${T}.`,
	TreeViewCommandsByViewType<T>
>;

export type WebviewCommands =
	| FilterCommands<`gitlens.${WebviewTypes}`, GlCommands>
	| FilterCommands<'gitlens.', GlCommands, `:${WebviewTypes}`>;
export type WebviewViewCommands =
	| FilterCommands<`gitlens.views.${WebviewViewTypes}`, GlCommands>
	| FilterCommands<'gitlens.views.', GlCommands, `:${WebviewViewTypes}`>;
