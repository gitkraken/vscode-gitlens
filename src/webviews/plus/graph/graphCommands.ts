import type { MessageItem, TextDocumentShowOptions, ViewColumn } from 'vscode';
import { env, ProgressLocation, Uri, window } from 'vscode';
import { getSquashSequenceEditor } from '@env/git/squashEditor.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitGraph, GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '@gitlens/git/models/reference.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { appendCoauthorsToMessage } from '@gitlens/git/utils/contributor.utils.js';
import {
	getComparisonRefsForPullRequest,
	getPullRequestNumberFromUrl,
	getRepositoryIdentityForPullRequest,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { decodeReachabilitySet } from '@gitlens/git/utils/reachability.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isSha, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../../../api/gitlens.d.js';
import type { CopyDeepLinkCommandArgs } from '../../../commands/copyDeepLink.js';
import type { CopyMessageToClipboardCommandArgs } from '../../../commands/copyMessageToClipboard.js';
import type { CopyShaToClipboardCommandArgs } from '../../../commands/copyShaToClipboard.js';
import type { ExplainBranchCommandArgs } from '../../../commands/explainBranch.js';
import type { ExplainCommitCommandArgs } from '../../../commands/explainCommit.js';
import type { ExplainStashCommandArgs } from '../../../commands/explainStash.js';
import type { ExplainWipCommandArgs } from '../../../commands/explainWip.js';
import type { GenerateChangelogCommandArgs } from '../../../commands/generateChangelog.js';
import type { OpenOnRemoteCommandArgs } from '../../../commands/openOnRemote.js';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote.js';
import type { ApplyPatchFromClipboardCommandArgs, CreatePatchCommandArgs } from '../../../commands/patches.js';
import type { RecomposeBranchCommandArgs } from '../../../commands/recomposeBranch.js';
import type { RecomposeFromCommitCommandArgs } from '../../../commands/recomposeFromCommit.js';
import type { GraphScrollMarkersAdditionalTypes } from '../../../config.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../constants.commands.js';
import { GlyphChars } from '../../../constants.js';
import type { StoredGraphWipDraft } from '../../../constants.storage.js';
import type { Container } from '../../../container.js';
import { executeGitCommand } from '../../../git/actions.js';
import * as BranchActions from '../../../git/actions/branch.js';
import {
	getOrderedComparisonRefs,
	openCommitChanges,
	openCommitChangesWithWorking,
	openComparisonChanges,
	openFiles,
	openFilesAtRevision,
	openOnlyChangedFiles,
} from '../../../git/actions/commit.js';
import {
	abortPausedOperation,
	continuePausedOperation,
	showPausedOperationStatus,
	skipPausedOperation,
} from '../../../git/actions/pausedOperation.js';
import * as RemoteActions from '../../../git/actions/remote.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import * as TagActions from '../../../git/actions/tag.js';
import * as WorktreeActions from '../../../git/actions/worktree.js';
import type { GlRepository } from '../../../git/models/repository.js';
import {
	getBranchAssociatedPullRequest,
	getBranchRemote,
	setBranchDisposition,
} from '../../../git/utils/-webview/branch.utils.js';
import { isCommitPushed } from '../../../git/utils/-webview/commit.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { getBestRemoteWithIntegration } from '../../../git/utils/-webview/remote.utils.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import type { RebaseTodoAction } from '../../../git/utils/rebaseTodo.js';
import { showPatchesView } from '../../../plus/drafts/actions.js';
import { getPullRequestBranchDeepLink } from '../../../plus/launchpad/launchpadProvider.js';
import { setupPullRequestBranch } from '../../../plus/launchpad/utils/-webview/startReview.utils.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../plus/startWork/associateIssueWithBranch.js';
import { executeActionCommand, executeCommand, executeCoreCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, setContext } from '../../../system/-webview/context.js';
import { getHostEditorCommand, revealInFileExplorer } from '../../../system/-webview/vscode.js';
import type { OpenWorkspaceLocation } from '../../../system/-webview/vscode/workspaces.js';
import { openWorkspace } from '../../../system/-webview/vscode/workspaces.js';
import { createCommandDecorator } from '../../../system/decorators/command.js';
import { DeepLinkActionType } from '../../../uris/deepLinks/deepLink.js';
import type { BranchAndTargetRefs, BranchRef } from '../../shared/branchRefs.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { Change } from '../patchDetails/protocol.js';
import * as branchRefCommands from '../shared/branchRefCommands.js';
import type { DetailsItemTypedContext } from './detailsProtocol.js';
import type { SelectedRowState } from './graphWebview.js';
import {
	compactGraphColumnsSettings,
	defaultGraphColumnsSettings,
	isGraphItemRefContext,
	isGraphItemRefGroupContext,
	isGraphItemTypedContext,
} from './graphWebview.utils.js';
import type {
	DidRequestOpenCompareModeParams,
	GraphColumnModeFor,
	GraphColumnName,
	GraphColumnsConfig,
	GraphExcludedRef,
	GraphItemContext,
	GraphPinnedRef,
	GraphPullRequestContextValue,
	GraphScopeBranch,
	GraphSelection,
} from './protocol.js';
import {
	createWipRowId,
	DidRequestGraphActionNotification,
	DidRequestOpenCompareModeNotification,
} from './protocol.js';
import type { ShowInCommitGraphCommandArgs } from './registration.js';

type GraphItemRefs<T> = {
	active: T | undefined;
	selection: T[];
};

/** A PR's display number. `id` is the provider's internal id on the providers-api path, so prefer the
 *  number parsed out of the PR's url. */
function getPullRequestNumber(pr: { id: string; url: string }): string {
	return getPullRequestNumberFromUrl(pr.url) ?? pr.id;
}

/** Collaborators the graph command handlers reach for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphCommandsContext()`. `getRepository`/`getSession`/`getActiveSelection`
 *  read live provider state; the rest forward to provider methods that remain there. */
export type GraphCommandsContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getActiveSelection: () => GitRevisionReference | undefined;
	toggleColumn: (name: GraphColumnName, visible: boolean) => Promise<void>;
	toggleColumnGrouping: (name: 'graph' | 'ref', grouped: boolean) => Promise<void>;
	toggleScrollMarker: (type: GraphScrollMarkersAdditionalTypes, enabled: boolean) => Promise<void>;
	setColumnMode: <T extends GraphColumnName>(name: T, mode?: GraphColumnModeFor<T>) => Promise<void>;
	updateColumns: (columnsCfg: GraphColumnsConfig) => void;
	setSelectedRows: (id: string | undefined, selection?: GraphSelection[], state?: SelectedRowState) => void;
	notifyDidChangeSelection: () => Promise<boolean>;
	writeWipDraftToStorage: (worktreePath: string, draft: StoredGraphWipDraft | null) => void;
	pushUpToCommit: (repoPath: string, sha: string) => Promise<void>;
	getOpenEditorShowOptions: () => (TextDocumentShowOptions & { sourceViewColumn?: ViewColumn }) | undefined;
	runStageConflictResolution: (
		item: DetailsItemTypedContext | undefined,
		resolution: 'current' | 'incoming',
	) => Promise<void>;
	updateExcludedRefs: (repoPath: string | undefined, refs: GraphExcludedRef[], visible: boolean) => void;
	showRemoteRefs: (repoPath: string | undefined, remoteName: string) => void;
	updatePinnedRef: (repoPath: string | undefined, ref: GraphPinnedRef | null) => void;
	_undoCommit: (ref: GitRevisionReference, worktreePath: string | undefined) => Promise<void>;
};

const graphCommandDecorator = createCommandDecorator<GlWebviewCommandsOrCommandsWithSuffix<'graph'>>();
const command = graphCommandDecorator.command;
export const getGraphCommands = graphCommandDecorator.getCommands;

/** Host-side handlers for every `@command`-decorated graph action, split out of `GraphWebviewProvider`
 *  (R3). The provider owns state/IPC and injects the collaborators via {@link GraphCommandsContext}. */
export class GraphCommands {
	constructor(private readonly context: GraphCommandsContext) {}

	private get container(): Container {
		return this.context.container;
	}
	private get host(): WebviewHost<'gitlens.views.graph' | 'gitlens.graph'> {
		return this.context.host;
	}
	private get repository(): GlRepository | undefined {
		return this.context.getRepository();
	}
	private get _graphSession(): GitGraphSession | undefined {
		return this.context.getSession();
	}
	private get activeSelection(): GitRevisionReference | undefined {
		return this.context.getActiveSelection();
	}

	// Reset columns wrappers
	@command('gitlens.graph.resetColumnsDefault')
	private resetColumnsDefault() {
		this.context.updateColumns(defaultGraphColumnsSettings);
	}

	@command('gitlens.graph.resetColumnsCompact')
	private resetColumnsCompact() {
		this.context.updateColumns(compactGraphColumnsSettings);
	}

	@command('gitlens.fetch:')
	@debug()
	private async fetch(item?: GraphItemContext | BranchRef) {
		if (item != null && 'branchId' in item) {
			await branchRefCommands.fetchBranch(this.container, item);
			return;
		}

		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.fetch(this.repository, ref);
	}

	@command('gitlens.git.branch.setMergeTarget:')
	@debug()
	private changeBranchMergeTarget(ref: BranchAndTargetRefs) {
		branchRefCommands.changeBranchMergeTarget(ref);
	}

	@command('gitlens.git.branch.setUpstream:')
	@debug()
	private async changeBranchUpstream(ref: BranchRef) {
		await branchRefCommands.changeBranchUpstream(this.container, ref);
	}

	@command('gitlens.mergeIntoCurrent:')
	@debug()
	private async mergeIntoCurrent(ref: BranchRef) {
		await branchRefCommands.mergeIntoCurrent(this.container, ref);
	}

	@command('gitlens.rebaseCurrentOnto:')
	@debug()
	private async rebaseCurrentOnto(ref: BranchRef) {
		await branchRefCommands.rebaseCurrentOnto(this.container, ref);
	}

	@command('gitlens.pushBranch:')
	@debug()
	private async pushBranch(ref: BranchRef) {
		await branchRefCommands.pushBranch(this.container, ref);
	}

	@command('gitlens.openMergeTargetComparison:')
	@debug()
	private openMergeTargetComparison(ref: BranchAndTargetRefs) {
		return branchRefCommands.openMergeTargetComparison(this.container, ref);
	}

	@command('gitlens.deleteBranchOrWorktree:')
	@debug()
	private async deleteBranchOrWorktree(ref: BranchRef, mergeTarget?: BranchRef) {
		await branchRefCommands.deleteBranchOrWorktree(this.container, ref, mergeTarget);
	}

	@command('gitlens.fetchRemote:')
	@debug()
	private fetchRemote(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		void RemoteActions.fetch(item.webviewItemValue.repoPath, item.webviewItemValue.name);
	}

	@command('gitlens.pruneRemote:')
	@debug()
	private pruneRemote(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		void RemoteActions.prune(item.webviewItemValue.repoPath, item.webviewItemValue.name);
	}

	@command('gitlens.removeRemote:')
	@debug()
	private removeRemote(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		void RemoteActions.remove(item.webviewItemValue.repoPath, item.webviewItemValue.name);
	}

	@command('gitlens.openRepoOnRemote:')
	@debug()
	private openRepoOnRemoteFromGraph(item?: GraphItemContext, clipboard?: boolean) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: item.webviewItemValue.repoPath,
			resource: { type: RemoteResourceType.Repo },
			remote: item.webviewItemValue.name,
			clipboard: clipboard,
		});
	}

	@command('gitlens.copyRemoteRepositoryUrl:')
	private copyRemoteRepositoryUrl(item?: GraphItemContext) {
		return this.openRepoOnRemoteFromGraph(item, true);
	}

	@command('gitlens.openBranchesOnRemote:')
	@debug()
	private openBranchesOnRemoteFromGraph(item?: GraphItemContext, clipboard?: boolean) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: item.webviewItemValue.repoPath,
			resource: { type: RemoteResourceType.Branches },
			remote: item.webviewItemValue.name,
			clipboard: clipboard,
		});
	}

	@command('gitlens.copyRemoteBranchesUrl:')
	private copyRemoteBranchesUrlFromGraph(item?: GraphItemContext) {
		return this.openBranchesOnRemoteFromGraph(item, true);
	}

	@command('gitlens.setRemoteAsDefault:')
	@debug()
	private async setRemoteAsDefault(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		const { repoPath, name } = item.webviewItemValue;
		await this.container.git.getRepositoryService(repoPath).remotes.setRemoteAsDefault(name, true);
	}

	@command('gitlens.unsetRemoteAsDefault:')
	@debug()
	private async unsetRemoteAsDefault(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		const { repoPath, name } = item.webviewItemValue;
		await this.container.git.getRepositoryService(repoPath).remotes.setRemoteAsDefault(name, false);
	}

	@command('gitlens.connectRemoteProvider:')
	@debug()
	private connectRemoteProviderFromGraph(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand('gitlens.connectRemoteProvider', {
			repoPath: item.webviewItemValue.repoPath,
			remote: item.webviewItemValue.name,
		});
	}

	@command('gitlens.disconnectRemoteProvider:')
	@debug()
	private disconnectRemoteProviderFromGraph(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'remote')) return;

		return executeCommand('gitlens.disconnectRemoteProvider', {
			repoPath: item.webviewItemValue.repoPath,
			remote: item.webviewItemValue.name,
		});
	}

	@command('gitlens.graph.pushWithForce')
	@debug()
	private forcePush(item?: GraphItemContext) {
		this.push(item, true);
	}

	@command('gitlens.graph.pull')
	@debug()
	private pull(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.pull(this.repository, ref);
	}

	@command('gitlens.graph.push')
	@debug()
	private push(item?: GraphItemContext, force?: boolean) {
		const ref = item != null ? this.getGraphItemRef(item) : undefined;
		void RepoActions.push(this.repository, force, ref);
	}

	@command('gitlens.graph.pushToCommit')
	@debug()
	private async pushToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return;

		await this.context.pushUpToCommit(ref.repoPath, ref.ref);
	}

	@command('gitlens.createBranch:')
	@debug()
	private createBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return BranchActions.create(ref.repoPath, ref);
	}

	@command('gitlens.graph.deleteBranch')
	@debug()
	private deleteBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.star.branch:')
	@debug()
	private async star(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return setBranchDisposition(this.container, branch, 'starred');
		}

		return Promise.resolve();
	}

	@command('gitlens.unstar.branch:')
	@debug()
	private async unstar(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return setBranchDisposition(this.container, branch, undefined);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.mergeBranchInto')
	@debug()
	private mergeBranchInto(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.merge(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.openBranchOnRemote')
	@debug()
	private openBranchOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			let remote;
			if (ref.remote) {
				remote = getRemoteNameFromBranchName(ref.name);
			} else if (ref.upstream != null) {
				remote = getRemoteNameFromBranchName(ref.upstream.name);
			}

			return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				repoPath: ref.repoPath,
				resource: {
					type: RemoteResourceType.Branch,
					branch: ref.name,
				},
				remote: remote,
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyRemoteBranchUrl')
	private copyRemoteBranchUrl(item?: GraphItemContext) {
		return this.openBranchOnRemote(item, true);
	}

	@command('gitlens.publishBranch:graph')
	@debug()
	private async publishBranch(item?: GraphItemContext | BranchRef) {
		let ref = await this.resolveBranchRef(item);
		if (ref == null) {
			// Header publish button passes no branch context — fall back to the current branch
			const branch = await this.repository?.git.branches.getBranch();
			ref = branch != null ? getReferenceFromBranch(branch) : undefined;
		}
		if (ref == null) return;

		await RepoActions.push(ref.repoPath, undefined, ref);
	}

	@command('gitlens.graph.rebaseOntoBranch')
	@command('gitlens.graph.rebaseOntoCommit')
	@debug()
	private rebase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.rebase(ref.repoPath, ref);
	}

	@command('gitlens.graph.rebaseOntoUpstream')
	@debug()
	private rebaseToRemote(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return RepoActions.rebase(
					ref.repoPath,
					createReference(ref.upstream.name, ref.repoPath, {
						refType: 'branch',
						name: ref.upstream.name,
						remote: true,
					}),
				);
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.renameBranch')
	@debug()
	private renameBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.rename(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.associateIssueWithBranch:graph')
	@debug()
	private associateIssueWithBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
				command: 'associateIssueWithBranch',
				branch: ref,
				source: 'graph',
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.cherryPick')
	@command('gitlens.graph.cherryPick.multi')
	@debug()
	private cherryPick(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return RepoActions.cherryPick(selection[0].repoPath, selection);
	}

	@command('gitlens.graph.squashCommits.multi')
	@debug()
	private async squashCommits(item?: GraphItemContext): Promise<void> {
		const prepared = await this.prepareCommitsForRewrite(item, 'squash');
		if (prepared == null) return;

		const { repoPath, ordered, published } = prepared;

		const squash: MessageItem = { title: 'Squash' };
		const fixup: MessageItem = { title: 'Keep First Message' };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
		const choice = await window.showWarningMessage(
			`Squash ${ordered.length} commits into one?`,
			{
				modal: true,
				detail: published
					? 'One or more of these commits have already been pushed. Squashing rewrites history and will require a force push.'
					: 'Choose Squash to review and edit the combined message, or Keep First Message to keep only the oldest commit message.',
			},
			squash,
			fixup,
			cancel,
		);
		if (choice !== squash && choice !== fixup) return;

		await this.runRebaseRewrite(repoPath, ordered, choice === fixup ? 'fixup' : 'squash');
	}

	@command('gitlens.graph.dropCommits.multi')
	@debug()
	private async dropCommits(item?: GraphItemContext): Promise<void> {
		const prepared = await this.prepareCommitsForRewrite(item, 'drop');
		if (prepared == null) return;

		const { repoPath, ordered, published } = prepared;

		const drop: MessageItem = { title: 'Drop' };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
		const choice = await window.showWarningMessage(
			`Drop ${ordered.length} commits?`,
			{
				modal: true,
				detail: published
					? 'One or more of these commits have already been pushed. Dropping rewrites history and will require a force push.'
					: 'This removes the selected commits from the current branch.',
			},
			drop,
			cancel,
		);
		if (choice !== drop) return;

		await this.runRebaseRewrite(repoPath, ordered, 'drop');
	}

	private validateRewriteableSelection(
		graph: GitGraph,
		refs: readonly GitRevisionReference[],
		verb: string,
	): boolean {
		const rewriteable = graph.rewriteableFromHEAD;
		if (rewriteable == null || refs.every(ref => rewriteable.has(ref.ref))) return true;

		void window.showWarningMessage(
			`Unable to ${verb}: you can only rewrite commits on the current branch up to the first merge.`,
		);
		return false;
	}

	private async prepareCommitsForRewrite(
		item: GraphItemContext | undefined,
		action: RebaseTodoAction,
	): Promise<{ repoPath: string; ordered: GitRevisionReference[]; published: boolean } | undefined> {
		const verb = action === 'drop' ? 'drop' : 'squash';

		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null || selection.length < 2) return undefined;

		// Page-scoped view (`current.rows`), preserving the prior `_graph.rows` semantics — the ordering map
		// only spans the last paged window, exactly as before.
		const graph = this._graphSession?.current;
		if (graph == null) return undefined;

		const repoPath = selection[0].repoPath;
		if (this.container.git.getRepositoryService(repoPath).ops?.rebase == null) {
			void window.showWarningMessage(`Rewriting commits is not supported in this repository.`);
			return undefined;
		}

		// Order by position in the loaded graph (rows are newest-first) so the oldest selected commit is
		// last — the rebase rewrites the current branch from that commit's parent.
		const rowIndexBySha = new Map(graph.rows.map((r, i) => [r.sha, i] as const));
		const ordered = selection
			.filter(ref => rowIndexBySha.has(ref.ref))
			.sort((a, b) => rowIndexBySha.get(a.ref)! - rowIndexBySha.get(b.ref)!);
		if (ordered.length !== selection.length) {
			void window.showWarningMessage(`Unable to ${verb}: some selected commits are not loaded in the graph.`);
			return undefined;
		}

		// squash/fixup fold each commit into the previous todo entry, so the selection must be a contiguous
		// chain. Validate here (not only via the menu `when`) since the command can be invoked programmatically.
		if (
			action !== 'drop' &&
			ordered.some(
				(ref, i) => i > 0 && graph.rows[rowIndexBySha.get(ordered[i - 1].ref)!]?.parents[0] !== ref.ref,
			)
		) {
			void window.showWarningMessage(`Unable to ${verb}: select a contiguous range of commits.`);
			return undefined;
		}

		if (ordered.some(ref => (graph.rows[rowIndexBySha.get(ref.ref)!]?.parents.length ?? 0) > 1)) {
			void window.showWarningMessage(`Unable to ${verb}: the selection includes a merge commit.`);
			return undefined;
		}

		// Reject selections that leave the first-parent chain from HEAD before the first merge (e.g. HEAD
		// is a merge, or the commits are an ancestor of one) — a plain interactive rebase would flatten it.
		if (!this.validateRewriteableSelection(graph, ordered, verb)) return undefined;

		const oldest = ordered.at(-1)!;
		if ((graph.rows[rowIndexBySha.get(oldest.ref)!]?.parents.length ?? 0) === 0) {
			void window.showWarningMessage(`Unable to ${verb}: the oldest selected commit has no parent.`);
			return undefined;
		}

		// Warn (don't block) when rewriting already-published commits — the rewrite requires a force push.
		let published = false;
		try {
			published = (await Promise.all(ordered.map(ref => isCommitPushed(repoPath, ref.ref)))).some(p => p);
		} catch {
			// Ignore — fall back to confirming without the published warning.
		}

		return { repoPath: repoPath, ordered: ordered, published: published };
	}

	private async runRebaseRewrite(
		repoPath: string,
		ordered: GitRevisionReference[],
		action: RebaseTodoAction,
	): Promise<void> {
		// Track the rebase as a user-initiated git op (this headless path bypasses the executeGitCommand flow).
		this.container.telemetry.sendEvent('gitCommand/run', { command: 'rebase' });

		const svc = this.container.git.getRepositoryService(repoPath);
		const oldest = ordered.at(-1)!;
		const verb =
			action === 'drop' ? 'Drop' : action === 'reword' ? 'Reword' : action === 'fixup' ? 'Fixup' : 'Squash';

		try {
			// Resolve inside the try so the browser/web stub's throw surfaces as a friendly message.
			const sequenceEditor = getSquashSequenceEditor(this.container);
			const result = await svc.ops!.rebase(
				`${oldest.ref}^`,
				{
					interactive: true,
					editor: sequenceEditor.editor,
					// The editor is a script that rewrites the todo by command + SHA, so force git to emit a
					// plain, natural-order todo (no autosquash reordering, no abbreviated `p` commands).
					programmaticEditor: true,
					// squash (combined message) and reword (per-commit message) open a commit-message editor.
					messageEditor:
						action === 'squash' || action === 'reword' ? await getHostEditorCommand(true) : undefined,
					updateRefs: true,
					autoStash: true,
				},
				{
					env: {
						...sequenceEditor.env,
						GL_SQUASH_SHAS: ordered.map(ref => ref.ref).join(','),
						GL_SQUASH_ACTION: action,
					},
				},
			);
			if (result?.conflicted) {
				void window.showWarningMessage(
					`${verb} stopped because of conflicts. Resolve them to continue, or abort the rebase to cancel.`,
				);
			}
		} catch (ex) {
			void window.showErrorMessage(
				`Unable to ${verb.toLowerCase()} commits: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
		}
	}

	@command('gitlens.graph.rewordCommit')
	@debug()
	private async rewordCommit(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return;

		// Page-scoped view (`current.rows`), preserving the prior `_graph.rows` semantics.
		const graph = this._graphSession?.current;
		if (graph == null) return;

		const repoPath = ref.repoPath;
		if (this.container.git.getRepositoryService(repoPath).ops?.rebase == null) {
			void window.showWarningMessage('Rewording commits is not supported in this repository.');
			return;
		}

		const row = graph.rows.find(r => r.sha === ref.ref);
		if ((row?.parents.length ?? 0) === 0) {
			void window.showWarningMessage('Unable to reword: the root commit has no parent to rebase onto.');
			return;
		}
		if ((row?.parents.length ?? 0) > 1) {
			void window.showWarningMessage('Unable to reword: cannot reword a merge commit.');
			return;
		}
		// Also reject commits off the first-parent chain from HEAD before the first merge (e.g. HEAD is a
		// merge, or this commit is an ancestor of one) — rewording rebases oldest..HEAD across the merge.
		if (!this.validateRewriteableSelection(graph, [ref], 'reword')) return;

		// Warn (don't block) when rewording an already-published commit — rewording requires a force push.
		let published = false;
		try {
			published = await isCommitPushed(repoPath, ref.ref);
		} catch {
			// Ignore — fall back to opening the message editor without the published warning.
		}
		if (published) {
			const confirm: MessageItem = { title: 'Reword' };
			const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
			const choice = await window.showWarningMessage(
				'Reword this commit?',
				{
					modal: true,
					detail: 'This commit has already been pushed. Rewording rewrites history and will require a force push.',
				},
				confirm,
				cancel,
			);
			if (choice !== confirm) return;
		}

		await this.runRebaseRewrite(repoPath, [ref], 'reword');
	}

	@command('gitlens.graph.modifyCommits')
	@command('gitlens.graph.modifyCommits.multi')
	@debug()
	private modifyCommits(item?: GraphItemContext): Promise<void> {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null || selection.length === 0) return Promise.resolve();

		// Page-scoped view (`current.rows`), preserving the prior `_graph.rows` semantics.
		const graph = this._graphSession?.current;
		if (graph == null) return Promise.resolve();

		// Interactively rebase from the parent of the oldest selected commit so the todo spans
		// oldest..HEAD — the user drives squash/reword/drop/reorder in the existing rebase editor.
		const rowIndexBySha = new Map(graph.rows.map((r, i) => [r.sha, i] as const));
		const ordered = selection
			.filter(ref => rowIndexBySha.has(ref.ref))
			.sort((a, b) => rowIndexBySha.get(a.ref)! - rowIndexBySha.get(b.ref)!);
		if (ordered.length !== selection.length) {
			void window.showWarningMessage('Unable to modify: some selected commits are not loaded in the graph.');
			return Promise.resolve();
		}

		// A standard interactive rebase flattens merges (no `--rebase-merges`), so a merge anywhere in the
		// selection won't appear in the todo as the user expects — reject it (as squash/drop/reword do).
		if (ordered.some(ref => (graph.rows[rowIndexBySha.get(ref.ref)!]?.parents.length ?? 0) > 1)) {
			void window.showWarningMessage('Unable to modify: the selection includes a merge commit.');
			return Promise.resolve();
		}

		// Reject selections that leave the first-parent chain from HEAD before the first merge (e.g. HEAD
		// is a merge, or the commits are an ancestor of one) — the rebase spans oldest..HEAD across the merge.
		if (!this.validateRewriteableSelection(graph, ordered, 'modify')) return Promise.resolve();

		const oldest = ordered.at(-1);
		const parentSha = oldest != null ? graph.rows[rowIndexBySha.get(oldest.ref)!]?.parents[0] : undefined;
		if (oldest == null || parentSha == null) {
			void window.showWarningMessage(
				'Unable to modify: the oldest selected commit has no parent to rebase onto.',
			);
			return Promise.resolve();
		}

		return RepoActions.rebase(
			oldest.repoPath,
			createReference(parentSha, oldest.repoPath, { refType: 'revision' }),
			true,
		);
	}

	@command('gitlens.graph.copy')
	@debug()
	private async copy(item?: GraphItemContext) {
		let data;

		// Worktree sidebar rows carry the worktree path on their ref context — prefer that
		if (isGraphItemRefContext(item)) {
			const values = item.webviewItemsValues?.length
				? item.webviewItemsValues.map(i => i.webviewItemValue)
				: [item.webviewItemValue];
			const paths = values
				.map(v => ('worktreePath' in v ? v.worktreePath : undefined))
				.filter((p): p is string => p != null);
			if (paths.length > 0 && paths.length === values.length) {
				data = paths.join('\n');
			}
		}

		if (data == null) {
			const { selection } = this.getGraphItemRefs(item);
			if (selection.length) {
				data = selection
					.map(r => (r.refType === 'revision' && r.message ? `${r.name}: ${r.message.trim()}` : r.name))
					.join('\n');
			} else if (isGraphItemTypedContext(item, 'contributor')) {
				const { name, email } = item.webviewItemValue;
				data = `${name}${email ? ` <${email}>` : ''}`;
			} else if (isGraphItemTypedContext(item, 'pullrequest')) {
				// The row's identity, not its url — Copy Pull Request URL covers that.
				const pr = item.webviewItemValue;
				data = `#${getPullRequestNumber(pr)} ${pr.title}`;
			}
		}

		if (data != null) {
			await env.clipboard.writeText(data);
		}
	}

	@command('gitlens.graph.copyMessage')
	@debug()
	private copyMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyMessageToClipboardCommandArgs>('gitlens.copyMessageToClipboard', {
			repoPath: ref.repoPath,
			sha: ref.ref,
			message: 'message' in ref ? ref.message : undefined,
		});
	}

	@command('gitlens.graph.copySha')
	@debug()
	private async copySha(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		let sha = ref.ref;
		if (!isSha(sha)) {
			sha = (await this.container.git.getRepositoryService(ref.repoPath).revision.resolveRevision(sha)).sha;
		}

		return executeCommand<CopyShaToClipboardCommandArgs, void>('gitlens.copyShaToClipboard', {
			sha: sha,
		});
	}

	@command('gitlens.graph.commitViaSCM')
	@debug()
	private async commitViaSCM(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');

		await executeCoreCommand('workbench.view.scm');
		if (ref != null) {
			const scmRepo = await this.container.git.getRepositoryService(ref.repoPath).getScmRepository();
			if (scmRepo == null) return;

			// Update the input box to trigger the focus event
			// oxlint-disable-next-line no-self-assign
			scmRepo.inputBox.value = scmRepo.inputBox.value;
		}
	}

	@command('gitlens.graph.openCommitOnRemote')
	@command('gitlens.graph.openCommitOnRemote.multi')
	@debug()
	private openCommitOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: selection[0].repoPath,
			resource: selection.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@command('gitlens.graph.copyRemoteCommitUrl')
	@command('gitlens.graph.copyRemoteCommitUrl.multi')
	private copyRemoteCommitUrl(item?: GraphItemContext) {
		return this.openCommitOnRemote(item, true);
	}

	@command('gitlens.graph.compareSelectedCommits.multi')
	@debug()
	private async compareSelectedCommits(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection?.length !== 2) return Promise.resolve();

		const [commit1, commit2] = selection;
		// `getOrderedComparisonRefs` returns `[newer, older]`. Compare convention is
		// `leftRef = Base (older)`, `rightRef = Compare (newer)`, so older goes on the left.
		const [newer, older] = await getOrderedComparisonRefs(
			this.container,
			commit1.repoPath,
			commit1.ref,
			commit2.ref,
		);

		return this.notifyOpenCompareMode({
			repoPath: commit1.repoPath,
			leftRef: older,
			leftRefType: 'commit',
			rightRef: newer,
			rightRefType: 'commit',
		});
	}

	@command('gitlens.pausedOperation.abort:')
	@debug()
	private async abortPausedOperation(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		await abortPausedOperation(svc);
	}

	@command('gitlens.pausedOperation.continue:')
	@debug()
	private async continuePausedOperation(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		await continuePausedOperation(this.container, svc, { source: 'graph' });
	}

	@command('gitlens.pausedOperation.open:')
	@debug()
	private async openRebaseEditor(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		const type = pausedOpArgs?.type ?? (await svc.pausedOps?.getPausedOperationStatus?.())?.type;
		if (type !== 'rebase') return;

		const gitDir = await svc.config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@command('gitlens.pausedOperation.skip:')
	@debug()
	private async skipPausedOperation(pausedOpArgs?: GitPausedOperationStatus) {
		const repoPath = pausedOpArgs?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		await skipPausedOperation(this.container, svc, { source: 'graph' });
	}

	@command('gitlens.pausedOperation.showConflicts:')
	@debug()
	private async showConflicts(pausedOpArgs: GitPausedOperationStatus) {
		await showPausedOperationStatus(this.container, pausedOpArgs.repoPath, { source: { source: 'graph' } });
	}

	@command('gitlens.graph.stageConflictCurrentChanges:')
	@debug()
	private async stageConflictCurrentChanges(item?: DetailsItemTypedContext): Promise<void> {
		await this.context.runStageConflictResolution(item, 'current');
	}

	@command('gitlens.graph.stageConflictIncomingChanges:')
	@debug()
	private async stageConflictIncomingChanges(item?: DetailsItemTypedContext): Promise<void> {
		await this.context.runStageConflictResolution(item, 'incoming');
	}

	@command('gitlens.ai.resolveConflicts:')
	@debug()
	private async resolveConflicts(item?: DetailsItemTypedContext): Promise<void> {
		const value = item?.webviewItemValue;
		if (value?.type !== 'file' || !value.path || !value.repoPath) return;

		// Enter the WIP details resolve mode scoped to this one conflicted file. Target that worktree's
		// WIP ROW id — a bare `uncommitted` would select the graph's own primary WIP row instead.
		const wipRowId = createWipRowId(value.repoPath);
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-resolve',
			target: { sha: wipRowId, worktreePath: value.repoPath, filePaths: [value.path] },
		});
	}

	@command('gitlens.ai.resolveConflicts.multi:')
	@debug()
	private async resolveConflictsMulti(item?: DetailsItemTypedContext): Promise<void> {
		// The right-clicked row carries the whole multi-selection in `webviewItemsValues`; keep just
		// the conflicted file entries (the menu gates on `webviewItemsUnion`, which matches when ANY
		// selected item is a conflict — others may be plain changes).
		const items = item?.webviewItemsValues ?? [];
		const files = items
			.filter(i => i.webviewItem.includes('+conflict'))
			.map(i => i.webviewItemValue)
			.filter(v => v?.type === 'file' && Boolean(v.path) && Boolean(v.repoPath));
		if (files.length === 0) return;

		// Target the worktree's WIP ROW id — a bare `uncommitted` would select the primary WIP row.
		const worktreePath = files[0].repoPath;
		const wipRowId = createWipRowId(worktreePath);
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-resolve',
			target: { sha: wipRowId, worktreePath: worktreePath, filePaths: files.map(f => f.path) },
		});
	}

	@command('gitlens.ai.resolveAllConflicts:')
	@debug()
	private async resolveAllConflicts(item?: GraphItemContext): Promise<void> {
		// Invoked from the WIP-row context menu (sibling to Compose/Review), so the item is a WIP-row
		// ref — mirror `composeCommits`. For a secondary WIP row `ref.repoPath` is that worktree's path.
		const ref = this.getGraphItemRef(item);
		const repoPath = ref?.repoPath ?? this.repository?.path;
		if (repoPath == null) return;

		// Enter resolve mode for all conflicts (no `filePath`). Target that worktree's WIP ROW id — a
		// bare `uncommitted` would select the graph's own primary WIP row instead.
		const wipRowId = createWipRowId(repoPath);
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-resolve',
			target: { sha: wipRowId, worktreePath: repoPath },
		});
	}

	@command('gitlens.graph.copyDeepLinkToBranch')
	@debug()
	private copyDeepLinkToBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToBranch', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyDeepLinkToCommit')
	@debug()
	private copyDeepLinkToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: ref });
	}

	@command('gitlens.graph.copyDeepLinkToRepo')
	@debug()
	private copyDeepLinkToRepo(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (!ref.remote) return Promise.resolve();

			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToRepo', {
				refOrRepoPath: ref.repoPath,
				remote: getRemoteNameFromBranchName(ref.name),
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyDeepLinkToTag')
	@debug()
	private copyDeepLinkToTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToTag', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.shareAsCloudPatch')
	@command('gitlens.graph.createPatch')
	@command('gitlens.createCloudPatch:')
	@debug()
	private async shareAsCloudPatch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');

		if (ref == null) return Promise.resolve();

		const { summary: title, body: description } = splitCommitMessage(ref.message);
		return executeCommand<CreatePatchCommandArgs, void>('gitlens.createCloudPatch', {
			to: ref.ref,
			repoPath: ref.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.shareWipAsCloudPatch:')
	@debug()
	private async shareWipAsCloudPatch(args?: { repoPath?: string }) {
		const repo = args?.repoPath != null ? this.container.git.getRepository(args.repoPath) : this.repository;
		if (repo == null) return;

		const status = await repo.git.status.getStatus();
		if (status == null) {
			void window.showErrorMessage('Unable to create cloud patch');
			return;
		}

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
			};

			files.push(change);
			if (file.staged && file.wip) {
				files.push({ ...change, staged: false });
			}
		}

		const change: Change = {
			type: 'wip',
			repository: {
				name: repo.name,
				path: repo.path,
				uri: repo.uri.toString(),
			},
			files: files,
			revision: { to: uncommitted, from: 'HEAD' },
		};

		void showPatchesView({ mode: 'create', create: { changes: [change] } });
	}

	@command('gitlens.copyPatchToClipboard:')
	@debug()
	private async copyPatchToClipboard(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		const { summary: title, body: description } = splitCommitMessage(ref.message);
		return executeCommand<CreatePatchCommandArgs, void>('gitlens.copyPatchToClipboard', {
			from: `${ref.ref}^`,
			to: ref.ref,
			repoPath: ref.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.graph.resetToCommit')
	@debug()
	private resetToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(ref.repoPath, ref);
	}

	@command('gitlens.graph.resetToTip')
	@debug()
	private resetToTip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(
			ref.repoPath,
			createReference(ref.ref, ref.repoPath, { refType: 'revision', name: ref.name }),
		);
	}

	@command('gitlens.graph.revert')
	@debug()
	private revertCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.revert(ref.repoPath, ref);
	}

	@command('gitlens.switchToBranch:')
	@command('gitlens.graph.switchToCommit')
	@command('gitlens.graph.switchToTag')
	@debug()
	private async switchTo(item?: GraphItemContext | BranchRef) {
		const ref = item != null && 'branchId' in item ? await this.resolveBranchRef(item) : this.getGraphItemRef(item);
		if (ref == null) return;

		await RepoActions.switchTo(ref.repoPath, ref);
	}

	@command('gitlens.graph.resetToTag')
	@debug()
	private resetToTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'tag');
		if (ref == null) return Promise.resolve();
		return RepoActions.reset(ref.repoPath, ref);
	}

	/** Shared body for the hide/show ref commands. `visible: false` (hide) accepts a ref group; `visible: true`
	 *  (show) never does — there's no "un-hide this whole group" command, only per-row un-hide. */
	private setRefVisibility(
		item: GraphItemContext | undefined,
		visible: boolean,
		options?: { group?: boolean; remote?: boolean },
	) {
		let refs;
		if (options?.group && isGraphItemRefGroupContext(item)) {
			({ refs } = item.webviewItemGroupValue);
		} else if (!options?.group && isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			if (ref.id != null) {
				refs = [ref];
			}
		}

		if (refs != null) {
			this.context.updateExcludedRefs(
				this._graphSession?.repoPath,
				refs.map(r => {
					const remoteBranch = r.refType === 'branch' && r.remote;
					return {
						id: r.id!,
						name: remoteBranch ? (options?.remote ? '*' : getBranchNameWithoutRemote(r.name)) : r.name,
						owner: remoteBranch ? getRemoteNameFromBranchName(r.name) : undefined,
						type: r.refType === 'branch' ? (r.remote ? 'remote' : 'head') : 'tag',
					};
				}),
				visible,
			);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.hideLocalBranch')
	@command('gitlens.graph.hideRemoteBranch')
	@command('gitlens.graph.hideTag')
	@debug()
	private hideRef(item?: GraphItemContext, options?: { group?: boolean; remote?: boolean }) {
		return this.setRefVisibility(item, false, options);
	}

	@command('gitlens.graph.hideRemote')
	private hideRemote(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'remote')) {
			const { name, repoPath } = item.webviewItemValue;
			this.context.updateExcludedRefs(
				repoPath,
				[{ id: `${repoPath}|remotes/${name}/*`, name: '*', owner: name, type: 'remote' }],
				false,
			);
			return Promise.resolve();
		}

		return this.hideRef(item, { remote: true });
	}

	@command('gitlens.graph.hideRefGroup')
	private hideRefGroup(item?: GraphItemContext) {
		return this.hideRef(item, { group: true });
	}

	@command('gitlens.graph.showLocalBranch')
	@command('gitlens.graph.showRemoteBranch')
	@command('gitlens.graph.showTag')
	@debug()
	private showRef(item?: GraphItemContext) {
		return this.setRefVisibility(item, true);
	}

	@command('gitlens.graph.showRemote')
	private showRemote(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'remote')) {
			const { name, repoPath } = item.webviewItemValue;
			this.context.showRemoteRefs(repoPath, name);
		} else if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.remote) {
				this.context.showRemoteRefs(
					ref.repoPath ?? this._graphSession?.repoPath,
					getRemoteNameFromBranchName(ref.name),
				);
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.pinBranchToEdge')
	@debug()
	private pinBranchToEdge(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item)) return Promise.resolve();

		const { ref } = item.webviewItemValue;
		if (ref.refType !== 'branch' || ref.id == null) return Promise.resolve();

		const remote = ref.remote;
		this.context.updatePinnedRef(ref.repoPath ?? this._graphSession?.repoPath, {
			id: ref.id,
			name: remote ? getBranchNameWithoutRemote(ref.name) : ref.name,
			owner: remote ? getRemoteNameFromBranchName(ref.name) : undefined,
			type: remote ? 'remote' : 'head',
		});
		return Promise.resolve();
	}

	@command('gitlens.graph.unpinBranchFromEdge')
	@debug()
	private unpinBranchFromEdge(_item?: GraphItemContext) {
		this.context.updatePinnedRef(this._graphSession?.repoPath, null);
		return Promise.resolve();
	}

	@command('gitlens.graph.soloBranch')
	@command('gitlens.graph.soloTag')
	@debug()
	private soloReference(item?: GraphItemContext): Promise<void> {
		// Branch/tag/worktree leaves & rows carry a real ref with an id. WIP rows carry an
		// uncommitted revision (no id) — fall through to resolve the worktree's branch.
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			if (ref.id != null) {
				this.soloByName(ref.repoPath, ref.name);
				return Promise.resolve();
			}
		}

		return this.soloWipReference(item);
	}

	private async soloWipReference(item?: GraphItemContext): Promise<void> {
		if (!isGraphItemRefContext(item, 'revision')) return;

		const { worktreePath } = item.webviewItemValue;
		if (worktreePath == null) return;

		const branch = await this.container.git.getRepositoryService(worktreePath).branches.getBranch();
		if (branch == null) return;

		this.soloByName(this.repository?.path ?? worktreePath, branch.name);
	}

	private soloByName(repoPath: string, name: string): void {
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return;

		// Show the graph with a ref: search query to filter the graph to this branch
		void executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			repository: repo,
			search: {
				query: `ref:${name}`,
				filter: true,
				matchAll: false,
				matchCase: false,
				matchRegex: false,
			},
			source: { source: 'graph' },
		});
	}

	// Two command ids, one handler — VS Code menu titles are static, so distinct ids let the menu
	// read "Focus on Branch" on branch rows/leaves and "Focus on Worktree" on worktree/WIP rows.
	@command('gitlens.focusBranch:graph')
	@command('gitlens.focusWorktree:graph')
	@debug()
	private async focusReference(item?: GraphItemContext): Promise<void> {
		const scopeBranch = await this.getScopeBranch(item);
		if (scopeBranch == null) return;

		// Invoked from a context menu inside the open graph (warm), so notify the webview directly to
		// focus (scope) onto the branch — mirrors the `scope-to-branch` action the popover/overview use.
		void this.host.notify(DidRequestGraphActionNotification, {
			action: 'scope-to-branch',
			scopeBranch: scopeBranch,
		});
	}

	/** Focuses the graph on a pull request — the same scope a branch focus produces, resolved from the
	 *  PR's head instead of a ref the user picked directly. */
	@command('gitlens.focusPullRequest:graph')
	@debug()
	private async focusPullRequest(item?: GraphItemContext): Promise<void> {
		if (!isGraphItemTypedContext(item, 'pullrequest')) return;

		const value = item.webviewItemValue;
		let target = await this.resolvePullRequestHeadTarget(value);
		// The ref isn't here — an unfetched head, or a fork whose remote this repository doesn't have. The row
		// offered Focus, so it has to mean something: fetch what's missing, then scope.
		if (target == null) {
			if (!(await this.ensurePullRequestHeadRef(value))) return;

			target = await this.resolvePullRequestHeadTarget(value);
			if (target == null) {
				void window.showErrorMessage(`Unable to find this pull request's branch after fetching.`);
				return;
			}
		}

		const upstreamName = `${target.remoteName}/${target.headBranch}`;

		// One layer, and only that layer — a stacked pull request's own commits against the layer below are
		// exactly the diff being reviewed, which is what makes a stack reviewable at all. Seeing the whole
		// stack is a different question, asked from the stack row in the pull requests panel.
		void this.host.notify(DidRequestGraphActionNotification, {
			action: 'scope-to-branch',
			scopeBranch:
				target.localBranch != null
					? { branchName: target.localBranch.name, upstreamName: upstreamName }
					: { branchName: upstreamName, remote: true },
			// So the header names the pull request that was focused rather than the branch it resolved to.
			// The display number, never `id` — the sidebar rows that route here come from the providers-api
			// path, where `id` is the provider's internal id.
			scopeOrigin: { kind: 'pullRequest', number: getPullRequestNumber(value) },
		});
	}

	/** Where a PR's head lands in this repo: the remote it's named against, plus the local branch tracking
	 *  it when there is one. Undefined for a fork head — it isn't nameable against this repo's remotes.
	 *  Must match how the panel built the row's focus target (`getSidebarPullRequests`): the best-ranked
	 *  remote isn't necessarily the one with the connected integration, and in a fork workflow they
	 *  differ — naming the head against the wrong one yields a ref that doesn't exist. */
	private async resolvePullRequestHeadTarget(
		value: GraphPullRequestContextValue,
	): Promise<{ remoteName: string; headBranch: string; localBranch: GitBranch | undefined } | undefined> {
		const headBranch = value.refs?.head?.branch;
		if (!headBranch) return undefined;

		const svc = this.container.git.getRepositoryService(value.repoPath);

		// A fork's head is named against the fork's own remote, which this repository may not have — that's
		// what the fetch below adds. Everything else is named against the remote the pull request was listed
		// from, which isn't necessarily the best-ranked one in a triangular setup.
		let remoteName;
		if (value.refs?.isCrossRepository === true) {
			const headUrl = value.refs.head?.url;
			if (!headUrl) return undefined;

			remoteName = (await svc.remotes.getRemotes({ filter: r => r.matches(headUrl) }))[0]?.name;
		} else {
			remoteName = (await getBestRemoteWithIntegration(value.repoPath))?.name;
		}
		if (remoteName == null) return undefined;

		const upstreamName = `${remoteName}/${headBranch}`;
		const localBranch = await svc.branches.getLocalBranchByUpstream?.(upstreamName);
		// A local branch tracking it is proof enough; otherwise the remote ref itself has to be here, or
		// scoping to it leaves the graph focused on nothing.
		if (localBranch == null && !(await svc.refs.isValidReference(upstreamName))) return undefined;

		return { remoteName: remoteName, headBranch: headBranch, localBranch: localBranch };
	}

	/**
	 * Adds the head's remote (for a fork this repository hasn't seen) and fetches it, so a pull request whose
	 * head ref isn't here yet can still be focused. Asked for rather than assumed — the row's other actions
	 * all prompt before touching the network — but the remote's name is derived rather than asked for, since
	 * nobody focusing a pull request wanted to name a remote.
	 */
	private async ensurePullRequestHeadRef(value: GraphPullRequestContextValue): Promise<boolean> {
		const { refs, repoPath } = value;
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null || !refs?.head?.url || !refs.head.branch) return false;

		if (
			getContext('gitlens:readonly', false) ||
			getContext('gitlens:untrusted', false) ||
			getContext('gitlens:hasVirtualFolders', false)
		) {
			void window.showWarningMessage(
				`This pull request's branch isn't in your repository, and it can't be fetched in this workspace.`,
			);
			return false;
		}

		const svc = this.container.git.getRepositoryService(repoPath);
		const headUrl = refs.head.url;
		const addsRemote = !(await svc.remotes.getRemotes({ filter: r => r.matches(headUrl) })).length;

		const confirm = { title: 'Fetch' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`Unable to find this pull request's branch in your repository.\nWould you like to fetch it?${
				addsRemote ? `\n\nThis will add a remote for the pull request's repository.` : ''
			}`,
			{ modal: true },
			confirm,
			cancel,
		);
		if (result !== confirm) return false;

		try {
			await window.withProgress(
				{ location: ProgressLocation.Notification, title: `Fetching the pull request's branch...` },
				async () => {
					const setup = await setupPullRequestBranch(repo, value);
					if (setup.addRemote != null) {
						await svc.remotes.addRemote?.(
							await this.getFreeRemoteName(svc, setup.addRemote.name),
							setup.addRemote.url,
							{ fetch: true },
						);
					}
				},
			);
		} catch (ex) {
			void window.showErrorMessage(
				`Unable to fetch the pull request's branch: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
			return false;
		}

		return true;
	}

	/** PR-row Switch to Branch — checks out the PR's head branch, adding the fork remote and creating
	 *  the tracking branch when they're missing (the deep link owns that setup). */
	@command('gitlens.switchToPullRequest:graph')
	@debug()
	private async switchToPullRequest(item?: GraphItemContext): Promise<void> {
		if (!isGraphItemTypedContext(item, 'pullrequest')) return;

		await this.openPullRequestBranchDeepLink(item.webviewItemValue, DeepLinkActionType.SwitchToPullRequest);
	}

	/** Runs the PR-branch deep link (switch or worktree flavor) from a row's context value.
	 *  {@link getPullRequestBranchDeepLink} reads only the PR's provider/id/title/refs, all of which the
	 *  row already carries, so this costs no PR re-fetch. */
	private async openPullRequestBranchDeepLink(
		value: GraphPullRequestContextValue,
		action: DeepLinkActionType,
	): Promise<void> {
		const { id, provider, refs, repoPath, title } = value;
		// The head's own remote (the fork's, for a cross-repository PR) is the one the link resolves
		// against. Truthiness, not null: the providers-api path fills a missing head with empty strings.
		const head = refs?.head;
		if (!head?.url || !head.branch) return;

		// `getPullRequestBranchDeepLink` writes `prBaseRef`/`prHeadRef` from `refs` unconditionally, and the
		// link's own test for them (`!= null`) passes for the empty strings a gone base ref leaves behind —
		// the worktree flavor then advances to opening the PR's changes and errors on them *after* the
		// worktree exists. Withhold `refs` instead of the whole action: the switch itself doesn't need shas.
		const comparableRefs = refs?.base?.sha && head.sha ? refs : undefined;

		const deepLink = getPullRequestBranchDeepLink(
			this.container,
			{ id: id, title: title, provider: provider, refs: comparableRefs },
			head.branch,
			head.url,
			action,
		);

		await this.container.deepLinks.processDeepLinkUri(deepLink, false, this.container.git.getRepository(repoPath));
	}

	private async getScopeBranch(item?: GraphItemContext): Promise<GraphScopeBranch | undefined> {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref != null) {
			if (!ref.remote) return { branchName: ref.name, upstreamName: ref.upstream?.name };

			// Scope is keyed on local heads, so a remote branch focuses its local counterpart when one
			// tracks it — only an untracked remote branch is scoped as a `remotes/*` ref.
			const local = this.findLocalBranchTracking(ref.name);
			return local != null
				? { branchName: local, upstreamName: ref.name }
				: { branchName: ref.name, remote: true };
		}

		if (!isGraphItemRefContext(item, 'revision')) return undefined;

		const { worktreePath } = item.webviewItemValue;
		if (worktreePath == null) return undefined;

		const branch = await this.container.git.getRepositoryService(worktreePath).branches.getBranch();
		return branch != null ? { branchName: branch.name, upstreamName: branch.upstream?.name } : undefined;
	}

	/** Name of the local branch tracking `upstreamName`, read off the in-memory graph snapshot so
	 *  resolving a remote branch's local counterpart costs no git calls. */
	private findLocalBranchTracking(upstreamName: string): string | undefined {
		const branches = this._graphSession?.current.branches;
		if (branches == null) return undefined;

		for (const b of branches.values()) {
			if (!b.remote && b.upstream?.name === upstreamName && !b.upstream.missing) return b.name;
		}
		return undefined;
	}

	/** WIP-row context menu — opens the resume-session picker for the row's worktree. */
	@command('gitlens.graph.resumeAgentSession')
	@debug()
	private resumeAgentSession(item?: GraphItemContext): void {
		if (!isGraphItemRefContext(item, 'revision')) return;

		const { worktreePath } = item.webviewItemValue;
		if (worktreePath == null) return;

		void executeCommand('gitlens.agents.showResumeSessionPicker', { worktreePath: worktreePath });
	}

	@command('gitlens.switchToAnotherBranch:graph')
	@debug()
	private switchToAnother(item?: GraphItemContext | unknown) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return RepoActions.switchTo(this.repository?.path);

		return RepoActions.switchTo(ref.repoPath);
	}

	// `undoCommitOnWorktree` shares the same handler as `undoCommit`. Both command ids exist
	// because VS Code menu titles are static and can't be templated per-row — we want the menu
	// to read "Undo Commit on Worktree" on `+worktreeHEAD` rows. Per-worktree routing flows via
	// `webviewItemValue.worktreePath`.
	@command('gitlens.graph.undoCommit')
	@command('gitlens.graph.undoCommitOnWorktree')
	@debug()
	private undoCommit(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		// For `+worktreeHEAD` rows, the row context carries `webviewItemValue.worktreePath` —
		// the secondary worktree we should target. We deliberately keep `ref.repoPath` as the
		// primary (so other right-click commands like cherryPick/reset/rebase don't silently
		// retarget the wrong worktree) and overlay the worktree path only here.
		// TODO(multi-worktree-same-sha): when two non-active worktrees share a sha, only the
		// first emitted `worktreePath` reaches us; the user has no UI to pick the other.
		const worktreePath = isGraphItemRefContext(item, 'revision') ? item.webviewItemValue.worktreePath : undefined;
		return this.context._undoCommit(ref, worktreePath);
	}

	@command('gitlens.stashSave:')
	@debug()
	private saveStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return StashActions.push(ref.repoPath);
	}

	@command('gitlens.stashApply:')
	@debug()
	private applyStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref != null) return StashActions.apply(ref.repoPath, ref);

		// A WIP row carries no stash ref — open the apply/pop picker rooted at the row's worktree
		const wip = this.getGraphItemRef(item, 'revision');
		if (wip == null || wip.ref !== uncommitted) return Promise.resolve();

		return StashActions.apply(this.getGraphItemWorktreePath(item) ?? wip.repoPath);
	}

	@command('gitlens.applyPatchFromClipboard:')
	@debug()
	private applyPatchFromClipboard(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null || ref.ref !== uncommitted) return Promise.resolve();

		// Apply INTO the row's own worktree — a sidebar worktree row's `ref.repoPath` is the graph's repo
		return executeCommand<ApplyPatchFromClipboardCommandArgs, void>('gitlens.applyPatchFromClipboard', {
			repoPath: this.getGraphItemWorktreePath(item) ?? ref.repoPath,
		});
	}

	@command('gitlens.stashDelete:')
	@debug()
	private deleteStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.drop(ref.repoPath, [ref]);
	}

	@command('gitlens.stashRename:')
	@debug()
	private renameStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.rename(ref.repoPath, ref);
	}

	@command('gitlens.graph.createTag')
	@debug()
	private async createTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return TagActions.create(ref.repoPath, ref);
	}

	@command('gitlens.graph.deleteTag')
	@debug()
	private deleteTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return TagActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.pushTag')
	@debug()
	private pushTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return TagActions.push(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.createWorktree')
	@debug()
	private async createWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		await WorktreeActions.create(ref.repoPath, undefined, ref);
	}

	@command('gitlens.createPullRequest:')
	@debug()
	private async createPullRequest(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.git.branches.getBranch(ref.name);
			const remote = branch != null ? await getBranchRemote(this.container, branch) : undefined;

			return executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
				repoPath: ref.repoPath,
				remote:
					remote != null
						? {
								name: remote.name,
								provider:
									remote.provider != null
										? {
												id: remote.provider.id,
												name: remote.provider.name,
												domain: remote.provider.domain,
											}
										: undefined,
								url: remote.url,
							}
						: undefined,
				branch: {
					name: ref.name,
					upstream: ref.upstream?.name,
					isRemote: ref.remote,
				},
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.openPullRequest:')
	@debug()
	private openPullRequest(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			return executeActionCommand<OpenPullRequestActionContext>('openPullRequest', {
				repoPath: pr.repoPath,
				provider: {
					id: pr.provider.id,
					name: pr.provider.name,
					domain: pr.provider.domain,
				},
				pullRequest: {
					id: pr.id,
					url: pr.url,
				},
				source: { source: 'graph' },
			});
		}

		return Promise.resolve();
	}

	/**
	 * Ensures a pull request's base and head commits are actually in the local object database before
	 * anything tries to diff them.
	 *
	 * `+shas` only proves the provider *reported* shas. This panel is the first surface that lists pull
	 * requests straight from the API, so a head this repository has never fetched — a brand-new pull
	 * request, or almost any pull request from a fork — carries perfectly good shas that git can't
	 * resolve, and the comparison would quietly come back empty.
	 *
	 * Fetching is asked for rather than assumed: reaching the network, and possibly adding a remote for a
	 * fork, is more than someone expects from opening a comparison. Declining leaves no error behind. `setupPullRequestBranch` fetches only a remote this repository already has — for a
	 * fork it hasn't seen it returns the remote to add rather than adding it, so the add-and-fetch happens
	 * here too; without it the fork case, which is most of why this exists, would report a fetch it never
	 * ran.
	 */
	/** In-flight revision recoveries, keyed by repository + pull request. Two entry points reach this for
	 *  one pull request (Open Changes and Compare), and a chip is easy to double-invoke; without this each
	 *  would raise its own modal and then run a concurrent add-remote/fetch against the same repository. */
	private readonly _ensuringRevisions = new Map<string, Promise<boolean>>();

	private ensurePullRequestRevisions(value: GraphPullRequestContextValue): Promise<boolean> {
		// The url, because it's the only identifier that's the same no matter which producer built this value
		// or when: `id` is `String(number)` on the provider-native path and the provider's own id on the
		// providers-api path, and the shas move whenever the head does. No host omits a pull request's url,
		// but the provider model's type permits an empty one, so fall back rather than key everything on `''`.
		const key = `${value.repoPath}|${value.url || `${value.provider.id}:${value.id}`}`;
		let promise = this._ensuringRevisions.get(key);
		if (promise == null) {
			promise = this.ensurePullRequestRevisionsCore(value).finally(() => {
				if (this._ensuringRevisions.get(key) === promise) {
					this._ensuringRevisions.delete(key);
				}
			});
			this._ensuringRevisions.set(key, promise);
		}
		return promise;
	}

	private async ensurePullRequestRevisionsCore(value: GraphPullRequestContextValue): Promise<boolean> {
		const { refs, repoPath } = value;
		// Empty rather than absent: several providers build a full `refs` and fill the shas with `''` when
		// the merge commits aren't available. There's nothing to diff, and saying so beats both the silent
		// return this used to do and the `HEAD`...`HEAD` comparison the shas would coerce to.
		if (!refs?.base?.sha || !refs.head?.sha) {
			void window.showWarningMessage(`This pull request doesn't report the commits needed to compare it.`);
			return false;
		}

		const svc = this.container.git.getRepositoryService(repoPath);
		// Which side is missing decides what to fetch: the head lives in the pull request's own (possibly
		// forked) repository, the base in the one it targets. Fetching the head can't produce a base tip a
		// shallow clone never had, so answering "yes" to the prompt has to cover both.
		const findMissing = async () => {
			const results = await Promise.allSettled([
				svc.refs.isValidReference(refs.base.sha),
				svc.refs.isValidReference(refs.head.sha),
			]);
			return {
				base: getSettledValue(results[0]) !== true,
				head: getSettledValue(results[1]) !== true,
			};
		};

		let missing = await findMissing();
		if (!missing.base && !missing.head) return true;

		const repo = this.container.git.getRepository(repoPath);
		// Without a head remote to fetch from there's nothing to try — but only when the head is the side
		// that's missing; a missing base is fetched from the remote hosting the base's own repository.
		if (repo == null || (missing.head && (!refs.head.url || !refs.head.branch))) {
			void window.showErrorMessage(`Unable to find this pull request's commits in your repository.`);
			return false;
		}

		// Comparing used to read only what was already here, so its menu entries carry none of the capability
		// gates the switch/worktree ones do. Now that answering the prompt fetches — and can add a remote —
		// the gate has to live here instead: the entry stays available, since a pull request whose commits are
		// present still compares fine, but the recovery that mutates doesn't run where the same mutation is
		// refused everywhere else in the UI.
		if (
			getContext('gitlens:readonly', false) ||
			getContext('gitlens:untrusted', false) ||
			getContext('gitlens:hasVirtualFolders', false)
		) {
			void window.showWarningMessage(
				`Unable to find this pull request's commits in your repository, and they can't be fetched in this workspace.`,
			);
			return false;
		}

		// Whether a remote is about to be added, decided before asking rather than inferred from the pull
		// request being cross-repository: a same-repository head whose clone url matches nothing configured
		// (an SSH host alias, or only an `upstream` remote) adds one too, and a prompt that didn't say so
		// would be the only warning the user got.
		const headUrl = refs.head.url;
		const addsRemote =
			missing.head && headUrl
				? !(await svc.remotes.getRemotes({ filter: r => r.matches(headUrl) })).length
				: false;

		const confirm = { title: 'Fetch' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`Unable to find this pull request's commits in your repository.\nWould you like to fetch them?${
				addsRemote ? `\n\nThis will add a remote for the pull request's repository.` : ''
			}`,
			{ modal: true },
			confirm,
			cancel,
		);
		// Declining isn't a failure — say nothing and leave the comparison unopened.
		if (result !== confirm) return false;

		try {
			await window.withProgress(
				{ location: ProgressLocation.Notification, title: `Fetching the pull request's commits...` },
				async () => {
					if (missing.head) {
						const setup = await setupPullRequestBranch(repo, value);
						if (setup.addRemote != null) {
							// The name comes from the head's owner and nothing has checked it's free — a
							// second fork by an owner you already have a remote for collides, and `addRemote`
							// fails outright. Take the next free suffix instead of dead-ending the action.
							await svc.remotes.addRemote?.(
								await this.getFreeRemoteName(svc, setup.addRemote.name),
								setup.addRemote.url,
								{ fetch: true },
							);
						}
					}

					// Re-checked rather than trusting the earlier answer: for a same-repository pull request
					// both sides live on one remote, so the head's fetch has usually just supplied the base
					// too — and fetching the same remote twice is the whole cost of this recovery paid over.
					if (missing.base && (!missing.head || (await findMissing()).base)) {
						// The remote hosting the base's own repository, which in a triangular setup is not
						// the best-ranked one with an integration — that's your fork, not the target.
						const baseUrl = refs.base.url;
						const remotes = await svc.remotes.getRemotes(
							baseUrl ? { filter: r => r.matches(baseUrl) } : undefined,
						);
						const baseRemote = remotes[0] ?? (await getBestRemoteWithIntegration(repoPath));
						if (baseRemote != null) {
							// `ops.fetch` throws; the service's own `fetch` swallows the failure and raises its
							// own notification, which would stack a second one on top of ours.
							await svc.ops?.fetch({ remote: baseRemote.name });
						}
					}
				},
			);
		} catch (ex) {
			void window.showErrorMessage(
				`Unable to fetch the pull request's commits: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
			return false;
		}

		missing = await findMissing();
		if (!missing.base && !missing.head) return true;

		void window.showErrorMessage(`Unable to find this pull request's commits after fetching.`);
		return false;
	}

	/** `name`, or the first `name-N` no configured remote is using. */
	private async getFreeRemoteName(
		svc: ReturnType<Container['git']['getRepositoryService']>,
		name: string,
	): Promise<string> {
		const taken = new Set((await svc.remotes.getRemotes()).map(r => r.name));
		if (!taken.has(name)) return name;

		let n = 2;
		while (taken.has(`${name}-${n}`)) {
			n++;
		}
		return `${name}-${n}`;
	}

	/** The pull request behind either entry point: a row's own context value, or the one associated with a
	 *  `BranchRef` (the overview card and branch hover). Returning one shape keeps the two paths on the same
	 *  gating and the same destination — they previously differed on both. */
	private async resolvePullRequestForComparison(
		item: GraphItemContext | BranchRef | undefined,
	): Promise<GraphPullRequestContextValue | undefined> {
		if (item != null && 'branchId' in item) {
			const branch = await this.container.git
				.getRepositoryService(item.repoPath)
				.branches.getBranch(item.branchName);
			if (branch == null) return undefined;

			const pr = await getBranchAssociatedPullRequest(this.container, branch);
			if (pr == null) return undefined;

			return {
				type: 'pullrequest',
				id: pr.id,
				title: pr.title,
				url: pr.url,
				repoPath: item.repoPath,
				refs: pr.refs,
				provider: pr.provider,
			};
		}

		return isGraphItemTypedContext(item, 'pullrequest') ? item.webviewItemValue : undefined;
	}

	@command('gitlens.openPullRequestChanges:')
	@debug()
	private async openPullRequestChanges(item?: GraphItemContext | BranchRef) {
		const pr = await this.resolvePullRequestForComparison(item);
		if (pr == null) return;
		if (!(await this.ensurePullRequestRevisions(pr))) return;

		const refs = getComparisonRefsForPullRequest(pr.repoPath, pr.refs!);
		await openComparisonChanges(
			this.container,
			{ repoPath: refs.repoPath, lhs: refs.base.ref, rhs: refs.head.ref },
			{ title: `Changes in Pull Request #${getPullRequestNumber(pr)}` },
		);
	}

	@command('gitlens.openPullRequestComparison:')
	@debug()
	private async openPullRequestComparison(item?: GraphItemContext | BranchRef) {
		const pr = await this.resolvePullRequestForComparison(item);
		if (pr == null) return;
		if (!(await this.ensurePullRequestRevisions(pr))) return;

		// The graph's own compare sheet, seeded with the pull request's base and head. Both refs are named
		// explicitly, so this holds for a fork exactly as it does for a same-repository head — nothing here
		// needs the head to be *nameable* against this repo's remotes. Reached from the branch hover and the
		// overview card too: one command id landing on two different surfaces is not a distinction anyone
		// asked for.
		const refs = getComparisonRefsForPullRequest(pr.repoPath, pr.refs!);
		void this.notifyOpenCompareMode({
			repoPath: refs.repoPath,
			leftRef: refs.base.ref,
			leftRefType: 'commit',
			rightRef: refs.head.ref,
			rightRefType: 'commit',
		});
	}

	// `public` because the provider's ref-metadata double-click handler invokes it directly, in
	// addition to the registered `gitlens.openPullRequestOnRemote:` command.
	@command('gitlens.openPullRequestOnRemote:')
	@debug()
	async openPullRequestOnRemote(item?: GraphItemContext, clipboard?: boolean): Promise<void> {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			await executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
				pr: { url: url },
				clipboard: clipboard,
			});
		}
	}

	@command('gitlens.copyRemotePullRequestUrl:graph')
	@debug()
	private copyPullRequestUrl(item?: GraphItemContext): Promise<void> {
		return this.openPullRequestOnRemote(item, true);
	}

	@command('gitlens.graph.compareAncestryWithWorking')
	@debug()
	private async compareAncestryWithWorking(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// Anchor on the user's current worktree — both the merge-base computation and the WT-files
		// fetch resolve relative to this. Avoids the multi-worktree degenerate case where
		// `getBranch(ref.repoPath)` returns the same ref as `ref.ref`.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const svc = this.container.git.getRepositoryService(currentRepoPath);
		const currentBranch = await svc.branches.getBranch();
		if (currentBranch == null) return undefined;

		const commonAncestor = await svc.refs.getMergeBase(currentBranch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		// Convention: leftRef = Base (older), rightRef = Compare (newer / has WT). The merge base
		// is the older anchor; the current branch carries the working tree.
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: commonAncestor,
			leftRefType: 'commit',
			rightRef: currentBranch.ref,
			rightRefType: 'branch',
			includeWorkingTree: true,
		});
	}

	@command('gitlens.graph.compareWithHead')
	@debug()
	private async compareHeadWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// Resolve HEAD against the user's current worktree before ordering — `'HEAD'` as an opaque
		// string would otherwise resolve against `ref.repoPath`, which may be a different worktree.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();
		const headRef = currentBranch?.ref ?? 'HEAD';

		// `getOrderedComparisonRefs` returns `[newer, older]`. Convention is leftRef = Base (older),
		// rightRef = Compare (newer), so the older ref lands on the left.
		const [newer, older] = await getOrderedComparisonRefs(this.container, currentRepoPath, headRef, ref.ref);
		const newerIsHead = newer === headRef;
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: older,
			leftRefType: newerIsHead ? this.graphCompareRefType(ref.refType) : 'branch',
			rightRef: newer,
			rightRefType: newerIsHead ? 'branch' : this.graphCompareRefType(ref.refType),
		});
	}

	@command('gitlens.graph.compareBranchWithHead')
	@debug()
	private async compareBranchWithHead(item?: GraphItemContext | BranchRef) {
		const ref = await this.resolveBranchRef(item);
		if (ref == null) return;

		// Resolve HEAD to the user's current worktree's branch — passing `'HEAD'` as a string would
		// resolve against the IPC `repoPath` on the host, which may be a different worktree.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();

		await this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: ref.ref,
			leftRefType: 'branch',
			rightRef: currentBranch?.ref ?? 'HEAD',
			rightRefType: 'branch',
		});
	}

	@command('gitlens.graph.compareWithMergeBase')
	@debug()
	private async compareWithMergeBase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// "Compare with Common Base" is conceptually "where this branch diverged from where I'm
		// working." Anchor the merge-base on the user's current worktree's branch, not the clicked
		// ref's worktree's branch — otherwise in multi-worktree the merge-base degenerates to the
		// ref itself when `getBranch(ref.repoPath)` returns `ref.ref`.
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const svc = this.container.git.getRepositoryService(currentRepoPath);
		const currentBranch = await svc.branches.getBranch();
		if (currentBranch == null) return undefined;

		const commonAncestor = await svc.refs.getMergeBase(currentBranch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		// Convention: leftRef = Base (older = merge base), rightRef = Compare (newer = clicked ref).
		return this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: commonAncestor,
			leftRefType: 'commit',
			rightRef: ref.ref,
			rightRefType: this.graphCompareRefType(ref.refType),
		});
	}

	@command('gitlens.graph.openChangedFileDiffsWithMergeBase')
	@debug()
	private async openChangedFileDiffsWithMergeBase(item?: GraphItemContext | BranchRef) {
		// Webview action-link path (graph overview card) passes a BranchRef rather than the
		// graph item context; resolve the target branch from the named ref.
		let repoPath: string;
		let targetRef: string;
		let targetName: string;
		if (item != null && 'branchId' in item) {
			repoPath = item.repoPath;
			const targetBranch = await this.container.git
				.getRepositoryService(repoPath)
				.branches.getBranch(item.branchName);
			if (targetBranch == null) return undefined;

			targetRef = targetBranch.ref;
			targetName = targetBranch.name;
		} else {
			const ref = this.getGraphItemRef(item, 'branch');
			if (ref == null) return undefined;

			repoPath = ref.repoPath;
			targetRef = ref.ref;
			targetName = ref.name;
		}

		const currentBranch = await this.container.git.getRepositoryService(repoPath).branches.getBranch();
		if (currentBranch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(repoPath)
			.refs.getMergeBase(currentBranch.ref, targetRef);
		if (commonAncestor == null) return undefined;

		return openComparisonChanges(
			this.container,
			{ repoPath: repoPath, lhs: commonAncestor, rhs: targetRef },
			{
				title: `Changes between ${targetName} (${shortenRevision(commonAncestor)}) ${
					GlyphChars.ArrowLeftRightLong
				} ${shortenRevision(targetRef, { strings: { working: 'Working Tree' } })}`,
			},
		);
	}

	@command('gitlens.graph.compareWithUpstream')
	@debug()
	private compareWithUpstream(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				// Convention: leftRef = Base (upstream / what we're comparing against),
				// rightRef = Compare (local branch we want to inspect for divergence).
				return this.notifyOpenCompareMode({
					repoPath: ref.repoPath,
					leftRef: ref.upstream.name,
					leftRefType: 'branch',
					rightRef: ref.ref,
					rightRefType: 'branch',
				});
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.changeUpstream:')
	@command('gitlens.setUpstream:')
	@debug()
	private changeUpstreamBranch(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item, 'branch')) return Promise.resolve();

		const { ref } = item.webviewItemValue;
		return BranchActions.changeUpstream(ref.repoPath, ref);
	}

	@command('gitlens.graph.compareWithWorking')
	@debug()
	private async compareWorkingWith(item?: GraphItemContext | BranchRef) {
		const ref = await this.resolveBranchRef(item);
		if (ref == null) return;

		// Anchor against the user's *current* worktree — `getBranch()` and the host's WT-files
		// fetch (`getBranchComparisonWorkingTreeFiles`) both run against this repoPath, so passing
		// the current worktree's path makes the WT and the resolved branch ref both belong to
		// where the user is actually working — not to whichever worktree the clicked ref happens
		// to live in.
		//
		// Convention: leftRef = Base (the clicked ref we're comparing against),
		// rightRef = Compare (the current branch, which carries the working tree).
		const currentRepoPath = this.getCurrentRepoPath(ref.repoPath);
		const currentBranch = await this.container.git.getRepositoryService(currentRepoPath).branches.getBranch();

		await this.notifyOpenCompareMode({
			repoPath: currentRepoPath,
			leftRef: ref.ref,
			leftRefType: 'branch',
			rightRef: currentBranch?.ref ?? 'HEAD',
			rightRefType: 'branch',
			includeWorkingTree: true,
		});
	}

	@command('gitlens.views.selectForCompare:')
	@debug()
	private selectForCompare(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		void setContext('gitlens:views:canCompare', { label: ref.name, ref: ref.ref, repoPath: ref.repoPath });
	}

	@command('gitlens.views.compareWithSelected:')
	@debug()
	private compareWithSelected(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		const selectedRef = getContext('gitlens:views:canCompare');
		if (selectedRef == null) return;

		void setContext('gitlens:views:canCompare', undefined);

		if (selectedRef.repoPath !== ref.repoPath) {
			this.selectForCompare(item);
			return;
		}

		// Anchor on the selected ref's repoPath — the user deliberately chose that side via
		// "Select for Compare", so it's their canonical anchor for this comparison. `selectedRef`
		// is a `StoredNamedRef` (no `refType`) — default to `commit`. The active ref carries its
		// own `refType` from the graph item context.
		void this.notifyOpenCompareMode({
			repoPath: selectedRef.repoPath,
			leftRef: selectedRef.ref,
			leftRefType: 'commit',
			rightRef: ref.ref,
			rightRefType: this.graphCompareRefType(ref.refType),
		});
	}

	@command('gitlens.copyWorkingChangesToWorktree:')
	@debug()
	private copyWorkingChangesToWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		// Copy FROM the row's own worktree — a sidebar worktree row's `ref.repoPath` is the graph's repo
		return WorktreeActions.copyChangesToWorktree(
			'working-tree',
			this.getGraphItemWorktreePath(item) ?? ref.repoPath,
		);
	}

	@command('gitlens.ai.explainUnpushed:')
	@debug()
	private aiExplainUnpushed(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			if (!ref.upstream) {
				return Promise.resolve();
			}

			return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
				repoPath: ref.repoPath,
				ref: ref.ref,
				baseBranch: ref.upstream.name,
				source: { source: 'graph', context: { type: 'branch' } },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.ai.explainBranch:')
	@debug()
	private explainBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: ref.repoPath,
			ref: ref.ref,
			source: { source: 'graph', context: { type: 'branch' } },
		});
	}

	@debug()
	private async recomposeBranch(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref != null) {
			await executeCommand<RecomposeBranchCommandArgs>('gitlens.ai.recomposeBranch', {
				repoPath: ref.repoPath,
				branchName: ref.name,
				source: 'graph',
			});
			return;
		}

		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null || selection.length < 2) return;

		const repoPath = selection[0].repoPath;
		const commitShas = selection.map(ref => ref.sha);

		// Page-scoped view (`current.rows`), preserving the prior `_graph.rows` semantics.
		const graph = this._graphSession?.current;
		if (graph == null) return;

		// We need to make sure commit shas are sorted in the order of the commits they are based on
		commitShas.sort((a, b) => {
			const rowA = graph.rows.find(r => r.sha === a);
			const rowB = graph.rows.find(r => r.sha === b);
			return (rowA?.date ?? 0) - (rowB?.date ?? 0);
		});

		const branchCounts = new Map<string, number>();

		for (const sha of commitShas) {
			const row = graph.rows.find(r => r.sha === sha);
			const refs = row != null ? this.getRowReachableRefs(row) : undefined;
			if (refs != null) {
				for (const ref of refs) {
					if (ref.refType === 'branch' && !ref.remote) {
						branchCounts.set(ref.name, (branchCounts.get(ref.name) ?? 0) + 1);
					}
				}
			}
		}

		const branchesReachingAll: string[] = [];
		for (const [branchName, count] of branchCounts) {
			if (count === commitShas.length) {
				branchesReachingAll.push(branchName);
			}
		}

		if (branchesReachingAll.length !== 1) {
			void window.showErrorMessage(
				branchesReachingAll.length === 0
					? 'The selected commits are not reachable from any single branch.'
					: 'The selected commits are reachable from multiple branches. Please select commits unique to a single branch.',
			);
			return;
		}

		const branchName = branchesReachingAll[0];

		await executeCommand<RecomposeBranchCommandArgs>('gitlens.ai.recomposeSelectedCommits', {
			repoPath: repoPath,
			branchName: branchName,
			commitShas: commitShas,
			source: 'graph',
		});
	}

	private getRowReachableRefs(row: GitGraphRow) {
		const table = this._graphSession?.current.reachability;
		const index = row.contexts?.reachabilityIndex;
		if (table == null || index == null) return undefined;

		return decodeReachabilitySet(table, index);
	}

	@debug()
	private async recomposeFromCommit(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return;

		// Page-scoped view (`current.rows`), preserving the prior `_graph.rows` semantics.
		const graph = this._graphSession?.current;
		if (graph == null) return;

		const row = graph.rows.find(r => r.sha === ref.ref);
		const localBranches = (row != null ? this.getRowReachableRefs(row) : undefined)?.filter(
			r => r.refType === 'branch' && !r.remote,
		);
		if (localBranches?.length !== 1) {
			void window.showErrorMessage('Unable to recompose: commit must belong to exactly one local branch');
			return;
		}

		const branchName = localBranches[0].name;
		const branch = graph.branches.get(branchName);
		if (branch == null) {
			void window.showErrorMessage(`Branch '${branchName}' not found`);
			return;
		}

		const headCommitSha = branch.sha;
		if (headCommitSha == null) {
			void window.showErrorMessage(`Unable to determine head commit for branch '${branchName}'`);
			return;
		}

		const commit = await this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);
		if (commit == null) {
			void window.showErrorMessage(`Commit '${ref.ref}' not found`);
			return;
		}

		const baseCommitSha = commit.parents.length > 0 ? commit.parents[0] : undefined;
		if (baseCommitSha == null) {
			void window.showErrorMessage('Unable to determine parent commit');
			return;
		}

		await executeCommand<RecomposeFromCommitCommandArgs>('gitlens.ai.recomposeFromCommit', {
			repoPath: ref.repoPath,
			commitSha: ref.ref,
			branchName: branchName,
			source: 'graph',
		});
	}

	// Recompose wrappers
	@command('gitlens.ai.recomposeBranch:')
	private recomposeBranchCommand(item?: GraphItemContext) {
		return this.recomposeBranch(item);
	}

	@command('gitlens.composeCommits:')
	private composeCommitsCommand(item?: GraphItemContext) {
		return this.composeCommits(item);
	}

	@command('gitlens.ai.recomposeSelectedCommits:')
	private recomposeSelectedCommitsCommand(item?: GraphItemContext) {
		return this.recomposeBranch(item);
	}

	@command('gitlens.ai.recomposeFromCommit:')
	private recomposeFromCommitCommand(item?: GraphItemContext) {
		return this.recomposeFromCommit(item);
	}

	@command('gitlens.reviewChanges:')
	private reviewChangesCommand(item?: GraphItemContext) {
		return this.reviewChanges(item);
	}

	@command('gitlens.ai.explainCommit:')
	@debug()
	private explainCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', context: { type: 'commit' } },
		});
	}

	@command('gitlens.ai.explainStash:')
	@debug()
	private explainStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainStashCommandArgs>('gitlens.ai.explainStash', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', context: { type: 'stash' } },
		});
	}

	@command('gitlens.ai.explainWip:')
	@debug()
	private async explainWip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		const worktree = await this.getGraphItemWorktree(item);

		await executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
			// When the worktree can't be resolved (e.g. a session without worktree data), the context's
			// path still names the row's worktree — a sidebar row's `ref.repoPath` is the graph's repo
			repoPath: worktree?.repoPath ?? this.getGraphItemWorktreePath(item) ?? ref.repoPath,
			worktreePath: worktree?.path,
			source: { source: 'graph', context: { type: 'wip' } },
		});
	}

	@command('gitlens.graph.openChangedFiles')
	@debug()
	private async openFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFiles(commit, this.context.getOpenEditorShowOptions());
	}

	@debug()
	private async openAllChanges(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChanges(this.container, commit, individually, this.context.getOpenEditorShowOptions());
	}

	@command('gitlens.graph.openChangedFileDiffs')
	private openChangedFileDiffs(item?: GraphItemContext) {
		return this.openAllChanges(item);
	}

	@command('gitlens.graph.openChangedFileDiffsIndividually')
	private openChangedFileDiffsIndividually(item?: GraphItemContext) {
		return this.openAllChanges(item, true);
	}

	@debug()
	private async openAllChangesWithWorking(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChangesWithWorking(
			this.container,
			commit,
			individually,
			this.context.getOpenEditorShowOptions(),
		);
	}

	@command('gitlens.graph.openChangedFileDiffsWithWorking')
	private openChangedFileDiffsWithWorking(item?: GraphItemContext) {
		return this.openAllChangesWithWorking(item);
	}

	@command('gitlens.graph.openChangedFileDiffsWithWorkingIndividually')
	private openChangedFileDiffsWithWorkingIndividually(item?: GraphItemContext) {
		return this.openAllChangesWithWorking(item, true);
	}

	@command('gitlens.graph.openChangedFileRevisions')
	@debug()
	private async openRevisions(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFilesAtRevision(commit, this.context.getOpenEditorShowOptions());
	}

	@command('gitlens.graph.openOnlyChangedFiles')
	@debug()
	private async openOnlyChangedFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openOnlyChangedFiles(this.container, commit);
	}

	@command('gitlens.graph.openInWorktree')
	@debug()
	private async openInWorktree(item?: GraphItemContext) {
		// PR rows deep-link straight to the worktree flavor — the link opens the branch's existing
		// worktree, or creates one when there isn't one yet.
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			return this.openPullRequestBranchDeepLink(
				item.webviewItemValue,
				DeepLinkActionType.SwitchToPullRequestWorktree,
			);
		}

		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.git.branches.getBranch(ref.name);
			const pr = branch != null ? await getBranchAssociatedPullRequest(this.container, branch) : undefined;
			if (branch != null && repo != null && pr != null) {
				const remoteUrl =
					(await getBranchRemote(this.container, branch))?.url ??
					getRepositoryIdentityForPullRequest(pr).remote.url;
				if (remoteUrl != null) {
					const deepLink = getPullRequestBranchDeepLink(
						this.container,
						pr,
						branch.nameWithoutRemote,
						remoteUrl,
						DeepLinkActionType.SwitchToPullRequestWorktree,
					);

					return this.container.deepLinks.processDeepLinkUri(deepLink, false, repo);
				}
			}

			await executeGitCommand({
				command: 'switch',
				state: {
					repos: ref.repoPath,
					reference: ref,
					worktreeDefaultOpen: 'new',
				},
			});
		}
	}

	@command('gitlens.openWorktree:')
	@debug()
	private async openWorktree(
		item?: GraphItemContext | BranchRef | { worktreeUri: string },
		options?: { location?: OpenWorkspaceLocation },
	) {
		// Webview action-link path (WIP details header): worktree identity arrives as a full URI
		// string — no branch lookup needed (so this also covers detached-HEAD worktrees), and the
		// scheme is preserved so remote-development worktrees (vscode-remote://, etc.) open on the
		// right host instead of falling back to a local file path.
		if (item != null && typeof item === 'object' && 'worktreeUri' in item && typeof item.worktreeUri === 'string') {
			openWorkspace(Uri.parse(item.worktreeUri), options);
			return;
		}

		// Webview action-link path (graph overview card): branch identity arrives as a BranchRef.
		if (item != null && 'branchId' in item) {
			const repoPath = item.repoPath;
			let worktreesByBranch;
			if (repoPath === this._graphSession?.repoPath) {
				worktreesByBranch = this._graphSession?.current.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(repoPath);
				if (repo == null) return;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			const worktree = worktreesByBranch?.get(item.branchId);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
			return;
		}

		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.id == null) return;

			let worktreesByBranch;
			if (ref.repoPath === this._graphSession?.repoPath) {
				worktreesByBranch = this._graphSession?.current.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(ref.repoPath);
				if (repo == null) return;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			const worktree = worktreesByBranch?.get(ref.id);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
		} else if (isGraphItemRefContext(item, 'revision')) {
			// Secondary WIP row: ref.ref is `uncommitted` AND ref.repoPath is the worktree's own
			// path. Detached worktree (commit row): resolve by sha. (Menu gating prevents the
			// primary-WIP case from reaching here, so it's not handled.)
			const { ref } = item.webviewItemValue;
			const worktree =
				ref.ref === uncommitted
					? this._graphSession?.current.worktrees?.find(w => w.path === ref.repoPath)
					: this._graphSession?.current.worktrees?.find(w => w.sha === ref.ref);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
		}
	}

	@command('gitlens.openWorktreeInNewWindow:')
	private openWorktreeInNewWindow(item?: GraphItemContext | BranchRef | { worktreeUri: string }) {
		return this.openWorktree(item, { location: 'newWindow' });
	}

	@command('gitlens.openInIntegratedTerminal:')
	@debug()
	private async openInIntegratedTerminal(item?: GraphItemContext | { worktreeUri: string }): Promise<void> {
		// Header button path: a full URI string is provided so remote-dev schemes are preserved.
		if (item != null && typeof item === 'object' && 'worktreeUri' in item && typeof item.worktreeUri === 'string') {
			void executeCoreCommand('openInIntegratedTerminal', Uri.parse(item.worktreeUri));
			return;
		}

		// Worktree sidebar / secondary-WIP path: worktree.uri preserves remote-dev schemes.
		const worktree = await this.getGraphItemWorktree(item);
		let uri = worktree?.uri;
		if (uri == null) {
			// Primary WIP row: the row's ref carries the worktree's own repoPath.
			const ref = this.getGraphItemRef(item);
			if (ref == null) return;

			uri = Uri.file(ref.repoPath);
		}

		void executeCoreCommand('openInIntegratedTerminal', uri);
	}

	@command('gitlens.graph.revealWorktreeInExplorer')
	@debug()
	private async revealWorktreeInExplorer(item?: GraphItemContext) {
		const worktree = await this.getGraphItemWorktree(item);
		// worktree.uri preserves remote-dev schemes for branch/secondary-worktree contexts.
		let uri = worktree?.uri;
		if (uri == null) {
			// Primary WIP has no resolved worktree (getGraphItemWorktree returns undefined to protect
			// explainWip); reveal the row's own repo folder, mirroring openInIntegratedTerminal.
			const ref = this.getGraphItemRef(item, 'revision');
			if (ref?.ref !== uncommitted) return;

			uri = Uri.file(ref.repoPath);
		}

		// Pass a sub-path (.git always exists in any worktree) so the OS file manager opens the
		// worktree folder itself rather than its parent — the default `revealFileInOS` selects
		// the folder in the parent on Windows/WSL, which isn't what users expect for a worktree.
		void revealInFileExplorer(Uri.joinPath(uri, '.git'));
	}

	@command('gitlens.graph.deleteWorktree')
	@debug()
	private async deleteWorktree(item?: GraphItemContext) {
		const worktree = await this.getGraphItemWorktree(item);
		if (worktree == null || worktree.isDefault || worktree.opened) return;

		await WorktreeActions.remove(worktree.repoPath, [worktree.uri]);
	}

	@command('gitlens.graph.unlockWorktree')
	@debug()
	private async unlockWorktree(item?: GraphItemContext) {
		const worktree = await this.getGraphItemWorktree(item);
		if (worktree == null) return;

		await WorktreeActions.unlock(worktree);
	}

	@command('gitlens.graph.addAuthor')
	@debug()
	private addAuthor(item?: GraphItemContext) {
		if (!isGraphItemTypedContext(item, 'contributor')) return;

		const { repoPath, name, email, current } = item.webviewItemValue;
		if (current) return; // can't co-author yourself (the menu `when` clause also excludes +current)

		const coauthor = new GitContributor(repoPath, name, email, current ?? false, 0).coauthor;

		// Seed the co-author into the graph's WIP commit box rather than the SCM input box. Mirror
		// undoCommit: select the WIP row, persist the draft, and notify the webview to show WIP with
		// the message — but APPEND to the existing draft instead of replacing it.
		const wipRowId = createWipRowId(repoPath);
		const existing = this.container.storage.getWorkspace('graph:wipDrafts')?.[repoPath];
		const message = appendCoauthorsToMessage(existing?.message ?? '', [coauthor]);

		this.context.writeWipDraftToStorage(repoPath, { ...existing, message: message, messageDirty: true });
		this.context.setSelectedRows(wipRowId);
		void this.context.notifyDidChangeSelection();
		void this.host.notify(DidRequestGraphActionNotification, {
			action: 'show-wip',
			target: { sha: wipRowId, worktreePath: repoPath },
			commitMessage: message,
		});
	}

	// Column toggle wrappers
	@command('gitlens.graph.columnAuthorOn')
	private columnAuthorOn() {
		return this.context.toggleColumn('author', true);
	}

	@command('gitlens.graph.columnAuthorOff')
	private columnAuthorOff() {
		return this.context.toggleColumn('author', false);
	}

	@command('gitlens.graph.columnDateTimeOn')
	private columnDateTimeOn() {
		return this.context.toggleColumn('datetime', true);
	}

	@command('gitlens.graph.columnDateTimeOff')
	private columnDateTimeOff() {
		return this.context.toggleColumn('datetime', false);
	}

	@command('gitlens.graph.columnShaOn')
	private columnShaOn() {
		return this.context.toggleColumn('sha', true);
	}

	@command('gitlens.graph.columnShaOff')
	private columnShaOff() {
		return this.context.toggleColumn('sha', false);
	}

	@command('gitlens.graph.columnChangesOn')
	private columnChangesOn() {
		return this.context.toggleColumn('changes', true);
	}

	@command('gitlens.graph.columnChangesOff')
	private columnChangesOff() {
		return this.context.toggleColumn('changes', false);
	}

	@command('gitlens.graph.columnGraphOn')
	private columnGraphOn() {
		return this.context.toggleColumn('graph', true);
	}

	@command('gitlens.graph.columnGraphOff')
	private columnGraphOff() {
		return this.context.toggleColumn('graph', false);
	}

	@command('gitlens.graph.columnGraphGroup')
	private columnGraphGroup() {
		return this.context.toggleColumnGrouping('graph', true);
	}

	@command('gitlens.graph.columnGraphUngroup')
	private columnGraphUngroup() {
		return this.context.toggleColumnGrouping('graph', false);
	}

	@command('gitlens.graph.columnMessageOn')
	private columnMessageOn() {
		return this.context.toggleColumn('message', true);
	}

	@command('gitlens.graph.columnMessageOff')
	private columnMessageOff() {
		return this.context.toggleColumn('message', false);
	}

	@command('gitlens.graph.columnRefOn')
	private columnRefOn() {
		return this.context.toggleColumn('ref', true);
	}

	@command('gitlens.graph.columnRefOff')
	private columnRefOff() {
		return this.context.toggleColumn('ref', false);
	}

	@command('gitlens.graph.columnRefGroup')
	private columnRefGroup() {
		return this.context.toggleColumnGrouping('ref', true);
	}

	@command('gitlens.graph.columnRefUngroup')
	private columnRefUngroup() {
		return this.context.toggleColumnGrouping('ref', false);
	}

	// Scroll marker toggle wrappers
	@command('gitlens.graph.scrollMarkerLocalBranchOn')
	private scrollMarkerLocalBranchOn() {
		return this.context.toggleScrollMarker('localBranches', true);
	}

	@command('gitlens.graph.scrollMarkerLocalBranchOff')
	private scrollMarkerLocalBranchOff() {
		return this.context.toggleScrollMarker('localBranches', false);
	}

	@command('gitlens.graph.scrollMarkerRemoteBranchOn')
	private scrollMarkerRemoteBranchOn() {
		return this.context.toggleScrollMarker('remoteBranches', true);
	}

	@command('gitlens.graph.scrollMarkerRemoteBranchOff')
	private scrollMarkerRemoteBranchOff() {
		return this.context.toggleScrollMarker('remoteBranches', false);
	}

	@command('gitlens.graph.scrollMarkerStashOn')
	private scrollMarkerStashOn() {
		return this.context.toggleScrollMarker('stashes', true);
	}

	@command('gitlens.graph.scrollMarkerStashOff')
	private scrollMarkerStashOff() {
		return this.context.toggleScrollMarker('stashes', false);
	}

	@command('gitlens.graph.scrollMarkerTagOn')
	private scrollMarkerTagOn() {
		return this.context.toggleScrollMarker('tags', true);
	}

	@command('gitlens.graph.scrollMarkerTagOff')
	private scrollMarkerTagOff() {
		return this.context.toggleScrollMarker('tags', false);
	}

	@command('gitlens.graph.scrollMarkerPullRequestOn')
	private scrollMarkerPullRequestOn() {
		return this.context.toggleScrollMarker('pullRequests', true);
	}

	@command('gitlens.graph.scrollMarkerPullRequestOff')
	private scrollMarkerPullRequestOff() {
		return this.context.toggleScrollMarker('pullRequests', false);
	}

	@command('gitlens.graph.scrollMarkerWipOn')
	private scrollMarkerWipOn() {
		return this.context.toggleScrollMarker('wip', true);
	}

	@command('gitlens.graph.scrollMarkerWipOff')
	private scrollMarkerWipOff() {
		return this.context.toggleScrollMarker('wip', false);
	}

	// Column mode wrappers
	@command('gitlens.graph.columnGraphCompact')
	private columnGraphCompact() {
		return this.context.setColumnMode('graph', 'compact');
	}

	@command('gitlens.graph.columnGraphDefault')
	private columnGraphDefault() {
		return this.context.setColumnMode('graph', undefined);
	}

	// Lane density wrappers — these toggle the `gitlens.graph.lanes.density` setting (not column state)
	@command('gitlens.graph.setLaneDensityToCompact')
	private setLaneDensityToCompact() {
		void configuration.updateEffective('graph.lanes.density', 'compact');
	}

	@command('gitlens.graph.setLaneDensityToExpanded')
	private setLaneDensityToExpanded() {
		void configuration.updateEffective('graph.lanes.density', 'expanded');
	}

	// Graph-style wrappers — toggle the `gitlens.graph.style` setting (whole-graph row layout, not column state)
	@command('gitlens.graph.setStyleAuto')
	private setStyleAuto() {
		void configuration.updateEffective('graph.style', 'auto');
	}

	@command('gitlens.graph.setStyleTable')
	private setStyleTable() {
		void configuration.updateEffective('graph.style', 'table');
	}

	@command('gitlens.graph.setStyleList')
	private setStyleList() {
		void configuration.updateEffective('graph.style', 'list');
	}

	@command('gitlens.ai.generateChangelogFrom:')
	@debug()
	private async generateChangelogFrom(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch') || isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;

			await executeCommand<GenerateChangelogCommandArgs>('gitlens.ai.generateChangelog', {
				repoPath: ref.repoPath,
				head: ref,
				source: { source: 'graph', detail: isGraphItemRefContext(item, 'branch') ? 'branch' : 'tag' },
			});
		}

		return Promise.resolve();
	}

	@debug()
	private async composeCommits(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		// Open the in-graph compose mode for the row that was right-clicked. For a WIP row `ref.repoPath`
		// is already that worktree's path, but a sidebar worktree row's is the graph's repo — take the
		// context's `worktreePath` first. Target that worktree's WIP ROW id — a bare `uncommitted` would
		// select the graph's own primary WIP row instead, regardless of `worktreePath`.
		const worktreePath = this.getGraphItemWorktreePath(item) ?? ref.repoPath;
		const wipRowId = createWipRowId(worktreePath);
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-compose',
			target: { sha: wipRowId, worktreePath: worktreePath },
		});
	}

	@debug()
	private async reviewChanges(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		// Mirrors `composeCommits` but enters the review mode instead, matching the in-header `review`
		// chip — same WIP ROW id targeting so a secondary worktree's row is the one selected, and the
		// same `worktreePath`-first resolution: a sidebar worktree row's `ref.repoPath` is the GRAPH's
		// repo, so using it alone would review the wrong worktree's changes.
		const worktreePath = this.getGraphItemWorktreePath(item) ?? ref.repoPath;
		const wipRowId = createWipRowId(worktreePath);
		await this.host.notify(DidRequestGraphActionNotification, {
			action: 'enter-review',
			target: { sha: wipRowId, worktreePath: worktreePath },
		});
	}

	private getCommitFromGraphItemRef(item?: GraphItemContext): Promise<GitCommit | undefined> {
		let ref: GitRevisionReference | GitStashReference | undefined = this.getGraphItemRef(item, 'revision');
		if (ref != null) return this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);

		ref = this.getGraphItemRef(item, 'stash');
		if (ref != null) return this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);

		return Promise.resolve(undefined);
	}

	private getCurrentRepoPath(refRepoPath: string): string {
		return this.repository?.path ?? refRepoPath;
	}

	private graphCompareRefType(refType: GitReference['refType']): 'branch' | 'tag' | 'commit' {
		switch (refType) {
			case 'branch':
				return 'branch';
			case 'tag':
				return 'tag';
			default:
				return 'commit';
		}
	}

	private notifyOpenCompareMode(params: DidRequestOpenCompareModeParams): Promise<void> {
		void this.host.notify(DidRequestOpenCompareModeNotification, params);
		return Promise.resolve();
	}

	private async resolveBranchRef(
		item: GraphItemContext | BranchRef | undefined,
	): Promise<GitBranchReference | undefined> {
		if (item != null && 'branchId' in item) {
			const branch = await this.container.git
				.getRepositoryService(item.repoPath)
				.branches.getBranch(item.branchName);
			return branch != null ? getReferenceFromBranch(branch) : undefined;
		}
		return this.getGraphItemRef(item, 'branch');
	}

	private getGraphItemRef(item?: GraphItemContext | unknown | undefined): GitReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'branch',
	): GitBranchReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'revision',
	): GitRevisionReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'stash',
	): GitStashReference | undefined;
	private getGraphItemRef(item: GraphItemContext | unknown | undefined, refType: 'tag'): GitTagReference | undefined;
	private getGraphItemRef(
		item?: GraphItemContext | unknown,
		refType?: 'branch' | 'revision' | 'stash' | 'tag',
	): GitReference | undefined {
		if (item == null) {
			const ref = this.activeSelection;
			return ref != null && (refType == null || refType === ref.refType) ? ref : undefined;
		}

		switch (refType) {
			case 'branch':
				return isGraphItemRefContext(item, 'branch') || isGraphItemTypedContext(item, 'upstreamStatus')
					? item.webviewItemValue.ref
					: undefined;
			case 'revision':
				return isGraphItemRefContext(item, 'revision') ? item.webviewItemValue.ref : undefined;
			case 'stash':
				return isGraphItemRefContext(item, 'stash') ? item.webviewItemValue.ref : undefined;
			case 'tag':
				return isGraphItemRefContext(item, 'tag') ? item.webviewItemValue.ref : undefined;
			default:
				return isGraphItemRefContext(item) ? item.webviewItemValue.ref : undefined;
		}
	}

	/** The worktree path a row's working-changes commands must act on. A SIDEBAR worktree row's
	 *  `ref.repoPath` is the GRAPH's repo, never that worktree, so only `worktreePath` names the right one;
	 *  a graph WIP row sets both to its own worktree, so preferring this changes nothing there. */
	private getGraphItemWorktreePath(item?: GraphItemContext | unknown): string | undefined {
		if (!isGraphItemRefContext(item)) return undefined;

		const value = item.webviewItemValue;
		return 'worktreePath' in value ? value.worktreePath : undefined;
	}

	private async getGraphItemWorktree(item?: GraphItemContext | unknown): Promise<GitWorktree | undefined> {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.id == null) return undefined;

			let worktreesByBranch;
			if (ref.repoPath === this._graphSession?.repoPath) {
				worktreesByBranch = this._graphSession?.current.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(ref.repoPath);
				if (repo == null) return undefined;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			return worktreesByBranch?.get(ref.id);
		}
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref, worktreePath } = item.webviewItemValue;
			// Secondary WIP row: ref.ref is `uncommitted` AND ref.repoPath is the worktree's own
			// path (different from the main repo path). Resolve by path. Primary WIP also has
			// ref.ref === uncommitted but ref.repoPath === main repo path — keep the original
			// `undefined` return so `explainWip` etc. don't pick up the primary worktree and
			// change their existing behavior.
			if (ref.ref === uncommitted && ref.repoPath !== this._graphSession?.repoPath) {
				return this._graphSession?.current.worktrees?.find(w => w.path === ref.repoPath);
			}
			// Worktree sidebar row for a detached worktree: the context carries the exact worktree
			// path. Prefer it over SHA matching, which is ambiguous when two worktrees share a HEAD
			// sha (e.g. a detached worktree created at the current tip). Excludes `uncommitted` so
			// primary WIP (whose `worktreePath` is the main repo path) still falls through to the
			// `undefined` return below that protects `explainWip`.
			if (ref.ref !== uncommitted && worktreePath != null) {
				const worktree = this._graphSession?.current.worktrees?.find(
					w => w.uri.fsPath === worktreePath || w.path === worktreePath,
				);
				if (worktree != null) return worktree;
			}
			return this._graphSession?.current.worktrees?.find(w => w.sha === ref.ref);
		}
		return undefined;
	}

	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'branch',
	): GraphItemRefs<GitBranchReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'revision',
	): GraphItemRefs<GitRevisionReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'stash',
	): GraphItemRefs<GitStashReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'tag',
	): GraphItemRefs<GitTagReference>;
	private getGraphItemRefs(item: GraphItemContext | unknown | undefined): GraphItemRefs<GitReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown,
		refType?: 'branch' | 'revision' | 'stash' | 'tag',
	): GraphItemRefs<GitReference> {
		if (item == null) return { active: undefined, selection: [] };

		switch (refType) {
			case 'branch':
				if (!isGraphItemRefContext(item, 'branch') && !isGraphItemTypedContext(item, 'upstreamStatus')) {
					return { active: undefined, selection: [] };
				}
				break;
			case 'revision':
				if (!isGraphItemRefContext(item, 'revision')) return { active: undefined, selection: [] };
				break;
			case 'stash':
				if (!isGraphItemRefContext(item, 'stash')) return { active: undefined, selection: [] };
				break;
			case 'tag':
				if (!isGraphItemRefContext(item, 'tag')) return { active: undefined, selection: [] };
				break;
			default:
				if (!isGraphItemRefContext(item)) return { active: undefined, selection: [] };
		}

		const selection = item.webviewItemsValues?.map(i => i.webviewItemValue.ref) ?? [];
		if (!selection.length) {
			selection.push(item.webviewItemValue.ref);
		}
		return { active: item.webviewItemValue.ref, selection: selection };
	}
}
