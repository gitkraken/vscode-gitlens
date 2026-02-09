import type { ContributedCommands, ContributedPaletteCommands } from './constants.commands.generated.js';
import type {
	CoreViewContainerIds,
	CustomEditorTypes,
	TreeViewIds,
	TreeViewTypes,
	ViewContainerIds,
	ViewIds,
	WebviewPanelTypes,
	WebviewTypes,
	WebviewViewTypes,
} from './constants.views.js';

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
	| 'gitlens.git.branch.setMergeTarget:home'
	| 'gitlens.deleteBranchOrWorktree:home'
	| 'gitlens.ai.explainBranch:home'
	| 'gitlens.ai.explainWip:home'
	| 'gitlens.composeCommits:home'
	| 'gitlens.createBranch:home'
	| 'gitlens.createCloudPatch:home'
	| 'gitlens.createPullRequest:home'
	| 'gitlens.fetch:home'
	| 'gitlens.mergeIntoCurrent:home'
	| 'gitlens.openInView.branch:home'
	| 'gitlens.openMergeTargetComparison:home'
	| 'gitlens.openPullRequestChanges:home'
	| 'gitlens.openPullRequestComparison:home'
	| 'gitlens.openPullRequestDetails:home'
	// | 'gitlens.openPullRequestOnRemote:home'
	| 'gitlens.openWorktree:home'
	| 'gitlens.pausedOperation.abort:home'
	| 'gitlens.pausedOperation.continue:home'
	| 'gitlens.pausedOperation.open:home'
	| 'gitlens.pausedOperation.showConflicts:home'
	| 'gitlens.pausedOperation.skip:home'
	| 'gitlens.publishBranch:home'
	| 'gitlens.pull:home'
	| 'gitlens.push:home'
	| 'gitlens.pushBranch:home'
	| 'gitlens.rebaseCurrentOnto:home'
	| 'gitlens.showInCommitGraph:home'
	| 'gitlens.startWork:home'
	| 'gitlens.switchToBranch:home'
	| 'gitlens.visualizeHistory.repo:home'
	| 'gitlens.visualizeHistory.branch:home';

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
	| 'gitlens.walkthrough.enableAiSetting'
	| 'gitlens.walkthrough.gitlensInspect'
	| 'gitlens.walkthrough.openAcceleratePrReviews'
	| 'gitlens.walkthrough.openAiCustomInstructionsSettings'
	| 'gitlens.walkthrough.openAiSettings'
	| 'gitlens.walkthrough.openCommunityVsPro'
	| 'gitlens.walkthrough.openHelpCenter'
	| 'gitlens.walkthrough.openInteractiveCodeHistory'
	| 'gitlens.walkthrough.openLearnAboutAiFeatures'
	| 'gitlens.walkthrough.openWalkthrough'
	| 'gitlens.walkthrough.plus.login'
	| 'gitlens.walkthrough.plus.signUp'
	| 'gitlens.walkthrough.plus.upgrade'
	| 'gitlens.walkthrough.plus.reactivate'
	| 'gitlens.walkthrough.showDraftsView'
	| 'gitlens.walkthrough.showGraph'
	| 'gitlens.walkthrough.showComposer'
	| 'gitlens.walkthrough.showLaunchpad'
	| 'gitlens.walkthrough.switchAIProvider'
	| 'gitlens.walkthrough.worktree.create'
	| 'gitlens.walkthrough.openDevExPlatform';

type InternalWelcomeCommands =
	| 'gitlens.welcome.openCommunityVsPro'
	| 'gitlens.welcome.openHelpCenter'
	| 'gitlens.welcome.plus.login'
	| 'gitlens.welcome.plus.reactivate'
	| 'gitlens.welcome.plus.signUp'
	| 'gitlens.welcome.plus.upgrade'
	| 'gitlens.welcome.showComposer'
	| 'gitlens.welcome.showGraph'
	| 'gitlens.welcome.showLaunchpad';

type InternalGlCommands =
	| `gitlens.action.${string}`
	| 'gitlens.ai.explainCommit:editor'
	| 'gitlens.ai.explainWip:editor'
	| 'gitlens.ai.feedback.helpful'
	| 'gitlens.ai.feedback.unhelpful'
	| 'gitlens.ai.mcp.authCLI'
	| 'gitlens.diffWith'
	| 'gitlens.diffWithPrevious:codelens'
	| 'gitlens.diffWithPrevious:command'
	| 'gitlens.diffWithPrevious:views'
	| 'gitlens.diffWithWorking:command'
	| 'gitlens.diffWithWorking:views'
	| 'gitlens.openChatAction'
	| 'gitlens.openCloudPatch'
	| 'gitlens.openOnRemote'
	| 'gitlens.openWalkthrough'
	| 'gitlens.openWorkingFile:command'
	| 'gitlens.refreshHover'
	| 'gitlens.regenerateMarkdownDocument'
	| 'gitlens.sendToChat'
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
	| InternalLaunchPadCommands
	| InternalPlusCommands
	| InternalPullRequestViewCommands
	| InternalRebaseEditorCommands
	| InternalScmGroupedViewCommands
	| InternalTimelineWebviewViewCommands
	| InternalViewCommands
	| InternalWalkthroughCommands
	| InternalWelcomeCommands;

export type GlCommands = ContributedCommands | InternalGlCommands; // | GlCommandsDeprecated;
/** Non-webview commands */
export type GlExtensionCommands = Exclude<GlCommands, GlWebviewCommands>;
export type GlPaletteCommands = ContributedPaletteCommands;

export type VendorChatCommands =
	| 'composer.newAgentChat'
	| 'kiroAgent.focusContinueInputWithoutClear'
	| 'kiroAgent.newSession'
	| 'windsurf.prioritized.chat.openNewConversation'
	| 'workbench.action.icube.aiChatSidebar.createNewSession';

export type CoreCommands =
	| '_open.mergeEditor'
	| 'composer.newAgentChat'
	| 'cursorMove'
	| 'editor.action.clipboardPasteAction'
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
	| 'workbench.action.chat.open'
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
	| 'workbench.extensions.action.extensionUpdates'
	| 'workbench.extensions.action.installExtensions'
	| 'workbench.extensions.action.switchToRelease'
	| 'workbench.extensions.installExtension'
	| 'workbench.extensions.uninstallExtension'
	| 'workbench.files.action.focusFilesExplorer'
	| 'workbench.view.explorer'
	| 'workbench.view.extension.gitlensInspect'
	| 'workbench.view.scm'
	| VendorChatCommands
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

export type GlPlusCommands = FilterCommands<'gitlens.plus.', GlCommands>;

export type GlTreeViewCommands =
	| FilterCommands<`gitlens.views.${TreeViewTypes}`, GlCommands>
	| FilterCommands<`gitlens.`, GlCommands, ':views'>;

export type GlTreeViewCommandsByViewId<T extends TreeViewIds> = FilterCommands<T, GlCommands>;
export type GlTreeViewCommandsByViewType<T extends TreeViewTypes> = FilterCommands<`gitlens.views.${T}.`, GlCommands>;
export type GlTreeViewCommandSuffixesByViewType<T extends TreeViewTypes> = ExtractSuffix<
	`gitlens.views.${T}.`,
	GlTreeViewCommandsByViewType<T>
>;

type CustomEditorOrWebviewPanelCommands<T extends CustomEditorTypes | WebviewPanelTypes> =
	| FilterCommands<`gitlens.${T}`, GlCommands>
	| FilterCommands<'gitlens.', GlCommands, `:${T}`>;

type WebviewViewCommands<T extends WebviewViewTypes> =
	| FilterCommands<`gitlens.views.${T}`, GlCommands>
	| FilterCommands<'gitlens.views.', GlCommands, `:${T}`>
	| FilterCommands<'gitlens.', GlCommands, `:${T}`>;

export type GlWebviewCommands<T extends WebviewTypes = WebviewTypes> =
	| (T extends CustomEditorTypes | WebviewPanelTypes ? CustomEditorOrWebviewPanelCommands<T> : never)
	| (T extends WebviewViewTypes ? WebviewViewCommands<T> : never);

/** Extracts command prefixes (before the type suffix) for use with decorated commands */
type ExtractCommandPrefix<T, U extends string> = T extends `${infer Prefix}:${U}` ? `${Prefix}:` : never;

export type GlWebviewCommandsOrCommandsWithSuffix<T extends WebviewTypes = WebviewTypes> =
	| GlWebviewCommands<T>
	| ExtractCommandPrefix<GlWebviewCommands<T>, T>;
