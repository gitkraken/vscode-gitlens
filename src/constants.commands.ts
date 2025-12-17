import type { ContributedCommands, ContributedPaletteCommands } from './constants.commands.generated';
import type {
	CoreViewContainerIds,
	CustomEditorTypes,
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
	| 'gitlens.pausedOperation.abort:graph'
	| 'gitlens.pausedOperation.continue:graph'
	| 'gitlens.pausedOperation.open:graph'
	| 'gitlens.pausedOperation.showConflicts:graph'
	| 'gitlens.pausedOperation.skip:graph'
	| 'gitlens.visualizeHistory.repo:graph';

type InternalHomeWebviewCommands =
	| 'gitlens.ai.explainWip:home'
	| 'gitlens.ai.explainBranch:home'
	| 'gitlens.composeCommits:home'
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
	| 'gitlens.pausedOperation.abort:home'
	| 'gitlens.pausedOperation.continue:home'
	| 'gitlens.pausedOperation.open:home'
	| 'gitlens.pausedOperation.showConflicts:home'
	| 'gitlens.pausedOperation.skip:home'
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

type InternalRebaseEditorCommands = 'gitlens.pausedOperation.showConflicts:rebase';

type InternalScmGroupedViewCommands =
	| 'gitlens.views.scm.grouped.welcome.dismiss'
	| 'gitlens.views.scm.grouped.welcome.restore';

type InternalTimelineWebviewViewCommands = 'gitlens.views.timeline.openInTab';

type InternalViewCommands = 'gitlens.views.loadMoreChildren';

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
	| 'gitlens.ai.explainCommit:editor'
	| 'gitlens.ai.explainWip:editor'
	| 'gitlens.ai.feedback.helpful'
	| 'gitlens.ai.feedback.unhelpful'
	| 'gitlens.ai.mcp.authCLI'
	| 'gitlens.changeBranchMergeTarget'
	| 'gitlens.diffWith'
	| 'gitlens.diffWithPrevious:codelens'
	| 'gitlens.diffWithPrevious:command'
	| 'gitlens.diffWithPrevious:views'
	| 'gitlens.diffWithWorking:command'
	| 'gitlens.diffWithWorking:views'
	| 'gitlens.openCloudPatch'
	| 'gitlens.openOnRemote'
	| 'gitlens.openWalkthrough'
	| 'gitlens.openWorkingFile:command'
	| 'gitlens.refreshHover'
	| 'gitlens.regenerateMarkdownDocument'
	| 'gitlens.showComposerPage'
	| 'gitlens.showInCommitGraphView'
	| 'gitlens.showQuickCommitDetails'
	| 'gitlens.storage.store'
	| 'gitlens.toggleFileBlame:codelens'
	| 'gitlens.toggleFileBlame:mode'
	| 'gitlens.toggleFileBlame:statusbar'
	| 'gitlens.toggleFileChanges:codelens'
	| 'gitlens.toggleFileChanges:mode'
	| 'gitlens.toggleFileChanges:statusbar'
	| 'gitlens.toggleFileHeatmap:codelens'
	| 'gitlens.toggleFileHeatmap:mode'
	| 'gitlens.toggleFileHeatmap:statusbar'
	| 'gitlens.visualizeHistory'
	| InternalGraphWebviewCommands
	| InternalHomeWebviewCommands
	| InternalHomeWebviewViewCommands
	| InternalLaunchPadCommands
	| InternalPlusCommands
	| InternalPullRequestViewCommands
	| InternalRebaseEditorCommands
	| InternalScmGroupedViewCommands
	| InternalTimelineWebviewViewCommands
	| InternalViewCommands
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
	| 'reopenActiveEditorWith' // Requires VS Code 1.100 or later
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
	| 'workbench.action.reopenTextEditor'
	| 'workbench.action.reopenWithEditor'
	| 'workbench.action.toggleMaximizedPanel'
	| 'workbench.action.focusPanel'
	| 'workbench.action.togglePanel'
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

export type WebviewCommands<T extends WebviewTypes = WebviewTypes> =
	| FilterCommands<`gitlens.${T}`, GlCommands>
	| FilterCommands<'gitlens.', GlCommands, `:${T}`>;
export type WebviewViewCommands<T extends WebviewViewTypes = WebviewViewTypes> =
	| FilterCommands<`gitlens.views.${T}`, GlCommands>
	| FilterCommands<'gitlens.views.', GlCommands, `:${T}`>
	| FilterCommands<'gitlens.', GlCommands, `:${T}`>;
export type CustomEditorCommands<T extends CustomEditorTypes = CustomEditorTypes> = FilterCommands<
	'gitlens.',
	GlCommands,
	`:${T}`
>;

/**
 * Extracts all possible prefixes (before the colon) from a union of commands.
 * Example: 'gitlens.foo:graph' | 'gitlens.bar:timeline' -> 'gitlens.foo' | 'gitlens.bar'
 */
type ExtractCommandPrefix<
	T extends GlCommands,
	U extends WebviewTypes | WebviewViewTypes,
> = T extends `${infer Prefix}:${U}` ? `${Prefix}:` : never;

type WebviewCommandPrefixes<T extends WebviewTypes = WebviewTypes> = ExtractCommandPrefix<WebviewCommands<T>, T>;
export type WebviewCommandsOrCommandsWithSuffix<T extends WebviewTypes = WebviewTypes> =
	| WebviewCommands<T>
	| WebviewCommandPrefixes<T>;

type WebviewViewCommandPrefixes<T extends WebviewViewTypes = WebviewViewTypes> = ExtractCommandPrefix<
	WebviewViewCommands<T>,
	T
>;
export type WebviewViewCommandsOrCommandsWithSuffix<T extends WebviewViewTypes = WebviewViewTypes> =
	| WebviewViewCommands<T>
	| WebviewViewCommandPrefixes<T>;
