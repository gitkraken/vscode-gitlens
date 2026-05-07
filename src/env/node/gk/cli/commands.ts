/* eslint-disable @typescript-eslint/require-await */
import type { Account } from '@gitkraken/provider-apis';
import type { Disposable } from 'vscode';
import type { Account as AuthorAccount } from '@gitlens/git/models/author.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { serializePullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { defer } from '@gitlens/utils/promise.js';
import type { CompareWithCommandArgs } from '../../../../commands/compareWith.js';
import type { Container } from '../../../../container.js';
import { cherryPick, merge, rebase } from '../../../../git/actions/repository.js';
import type { GlRepository } from '../../../../git/models/repository.js';
import type { LaunchpadCategorizedResult, LaunchpadItem } from '../../../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadItemGroups } from '../../../../plus/launchpad/launchpadProvider.js';
import { launchpadCategoryToGroupMap } from '../../../../plus/launchpad/models/launchpad.js';
import type { StartReviewCommandArgs } from '../../../../plus/launchpad/startReview.js';
import type { StartWorkCommandArgs } from '../../../../plus/startWork/startWork.js';
import { executeCommand } from '../../../../system/-webview/command.js';
import { createCommandDecorator } from '../../../../system/decorators/command.js';
import type { ComposerWebviewShowingArgs } from '../../../../webviews/plus/composer/registration.js';
import type { WebviewPanelShowCommandArgs } from '../../../../webviews/webviewsController.js';
import type { CliCommandRequest, CliCommandResponse } from './integration.js';

type CliCommand =
	| 'cherry-pick'
	| 'compare'
	| 'graph'
	| 'ping'
	| 'rebase'
	| 'mcp/launchpad/item'
	| 'mcp/launchpad/list'
	| 'mcp/pr/review/start'
	| 'mcp/issue/start'
	| 'mcp/wip/compose/open'
	| 'merge';
type CliCommandHandler = (
	request: CliCommandRequest | undefined,
	repo?: GlRepository | undefined,
) => Promise<CliCommandResponse>;

const { command, getCommands } = createCommandDecorator<CliCommand, CliCommandHandler>();

export class CliCommandHandlers implements Disposable {
	private readonly _registrations: UnifiedDisposable[] = [];

	constructor(private readonly container: Container) {
		for (const { command, handler } of getCommands()) {
			this._registrations.push(
				this.container.ipc.registerHandler<CliCommandRequest, CliCommandResponse>(command, rq =>
					this.wrapHandler(command, rq, handler),
				),
			);
		}
	}

	dispose(): void {
		for (const d of this._registrations) {
			d.dispose();
		}
		this._registrations.length = 0;
	}

	@command('ping')
	async handlePingCommand(): Promise<CliCommandResponse> {
		return { stdout: JSON.stringify({ version: this.container.version }) };
	}

	private wrapHandler(command: CliCommand, request: CliCommandRequest | undefined, handler: CliCommandHandler) {
		let repo: GlRepository | undefined;
		// `ping` is a liveness check; skip repo lookup so it stays cheap.
		if (request?.cwd && command !== 'ping') {
			repo = this.container.git.getRepository(request.cwd);
		}

		// Track MCP IPC request usage (only for MCP-specific commands)
		if (command.startsWith('mcp/')) {
			void this.container.usage.track('action:gitlens.mcp.ipcRequest:happened');
		}

		return handler.call(this, request, repo);
	}

	@command('cherry-pick')
	async handleCherryPickCommand(
		_request: CliCommandRequest | undefined,
		repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		void cherryPick(repo);
	}

	@command('compare')
	async handleCompareCommand(
		request: CliCommandRequest | undefined,
		repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!repo || !request?.args?.length) {
			void executeCommand('gitlens.compareWith');
			return;
		}

		const [ref1, ref2] = request.args;
		if (!ref1 || !ref2) {
			void executeCommand('gitlens.compareWith');
			return;
		}

		if (ref1) {
			if (!(await repo.git.refs.isValidReference(ref1))) {
				void executeCommand('gitlens.compareWith');
				return { stderr: `'${ref1}' is an invalid reference` };
			}
		}

		if (ref2) {
			if (!(await repo.git.refs.isValidReference(ref2))) {
				void executeCommand<CompareWithCommandArgs>('gitlens.compareWith', { ref1: ref1 });
				return { stderr: `'${ref2}' is an invalid reference` };
			}
		}

		void executeCommand<CompareWithCommandArgs>('gitlens.compareWith', { ref1: ref1, ref2: ref2 });
	}

	@command('graph')
	async handleGraphCommand(
		request: CliCommandRequest | undefined,
		repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!repo || !request?.args?.length) {
			void executeCommand('gitlens.showGraphView');
			return;
		}

		const [ref] = request.args;
		const reference = await repo.git.refs.getReference(ref);
		if (ref && !reference) {
			void executeCommand('gitlens.showInCommitGraph', repo);
			return { stderr: `'${ref}' is an invalid reference` };
		}

		void executeCommand('gitlens.showInCommitGraph', { ref: reference });
	}

	@command('merge')
	async handleMergeCommand(
		request: CliCommandRequest | undefined,
		repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!repo || !request?.args?.length) return merge(repo);

		const [ref] = request.args;
		const reference = await repo.git.refs.getReference(ref);

		void merge(repo, reference);

		if (ref && !reference) {
			return { stderr: `'${ref}' is an invalid reference` };
		}
	}

	@command('rebase')
	async handleRebaseCommand(
		request: CliCommandRequest | undefined,
		repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!repo || !request?.args?.length) return rebase(repo);

		const [ref] = request.args;
		const reference = await repo.git.refs.getReference(ref);

		void rebase(repo, reference);

		if (ref && !reference) {
			return { stderr: `'${ref}' is an invalid reference` };
		}
	}

	@command('mcp/wip/compose/open')
	async handleComposeCommand(
		request: CliCommandRequest | undefined,
		repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (request?.cwd && repo == null) {
			return { stderr: `'${request.cwd}' is an invalid or non-Git directory` };
		}

		const instructions = request?.args?.[0];

		void executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(
			'gitlens.showComposerPage',
			undefined,
			{
				repoPath: repo?.path,
				source: { source: 'mcp', detail: 'mcp/wip/compose/open' },
				autoComposeInstructions: instructions,
			},
		);
	}

	@command('mcp/pr/review/start')
	async handleStartReviewCommand(
		request: CliCommandRequest | undefined,
		_repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!request?.args?.length) return { stderr: 'No Pull Request provided' };
		const [prUrl, instructions] = request.args;

		try {
			const result = defer<{ branch: GitBranch; worktree?: GitWorktree; pr: PullRequest }>();

			await executeCommand<StartReviewCommandArgs>('gitlens.startReview', {
				command: 'startReview',
				source: { source: 'mcp', detail: 'mcp/pr/review/start' },
				prUrl: prUrl,
				instructions: instructions,
				useDefaults: true,
				openChatOnComplete: true,
				result: result,
			});

			const { branch, worktree, pr } = await result.promise;

			return {
				stdout: JSON.stringify({
					branchName: branch.name,
					worktreePath: worktree?.path,
					prUrl: pr.url,
					prTitle: pr.title,
				}),
			};
		} catch (ex) {
			return { stderr: `Error reviewing PR: ${ex instanceof Error ? ex.message : String(ex)}` };
		}
	}

	@command('mcp/issue/start')
	async handleStartWorkCommand(
		request: CliCommandRequest | undefined,
		_repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!request?.args?.length) return { stderr: 'No issue identifier provided' };
		const [issueUrl, instructions] = request.args;

		try {
			const result = defer<{ branch: GitBranch; worktree?: GitWorktree }>();

			await executeCommand<StartWorkCommandArgs>('gitlens.startWork', {
				command: 'startWork',
				source: { source: 'mcp', detail: 'mcp/issue/start' },
				issueUrl: issueUrl,
				instructions: instructions,
				useDefaults: true,
				openChatOnComplete: true,
				result: result,
			});

			const { branch, worktree } = await result.promise;

			return {
				stdout: JSON.stringify({
					branchName: branch.name,
					worktreePath: worktree?.path,
				}),
			};
		} catch (ex) {
			return { stderr: `Error starting work on issue: ${ex instanceof Error ? ex.message : String(ex)}` };
		}
	}

	private async handleGetLaunchpadCore(
		prSearch?: string | PullRequest[] | undefined,
	): Promise<LaunchpadCategorizedResult> {
		// Check if integrations are connected
		const hasConnectedIntegration = await this.container.launchpad.hasConnectedIntegration();
		if (!hasConnectedIntegration) {
			throw new Error('No connected integrations. Please connect a GitHub, GitLab, or other integration first.');
		}

		// Use Launchpad's search to find the PR by URL or number
		const result = await this.container.launchpad.getCategorizedItems(
			prSearch != null ? { search: prSearch } : undefined,
		);

		// Only throw on total failure (error with no items); partial success returns items alongside the error
		if (result.error != null && !result.items?.length) {
			throw new Error(`Error fetching Launchpad: ${result.error.message}`);
		}

		return result;
	}

	@command('mcp/launchpad/item')
	async handleGetLaunchpadInfoCommand(
		request: CliCommandRequest | undefined,
		_repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		if (!request?.args?.length) return { stderr: 'No Launchpad item identifier provided' };
		const [prSearch] = request.args;

		let result: LaunchpadCategorizedResult;
		try {
			result = await this.handleGetLaunchpadCore(prSearch);
		} catch (ex) {
			return { stderr: (ex as Error).message };
		}

		const items = result.items;
		if (items == null || items.length === 0) {
			return { stderr: `No Launchpad item found matching '${prSearch}'` };
		}

		// Return info for the first matching item (typically there's only one when searching by URL/number)
		const item = items[0];

		try {
			const serializedResponse = serializeLaunchpadItem(item);
			const response: Record<string, unknown> = { item: serializedResponse };
			if (result.error != null) {
				response.warning = `Some integrations failed to load: ${result.error.message}`;
			}
			return { stdout: JSON.stringify(response) };
		} catch (ex) {
			return { stderr: `Error sending Launchpad item data: ${ex}` };
		}
	}

	@command('mcp/launchpad/list')
	async handleGetLaunchpadCommand(
		_request: CliCommandRequest | undefined,
		_repo?: GlRepository | undefined,
	): Promise<CliCommandResponse> {
		let result: LaunchpadCategorizedResult;
		try {
			result = await this.handleGetLaunchpadCore();
		} catch (ex) {
			return { stderr: (ex as Error).message };
		}

		const items = result.items;
		if (items == null || items.length === 0) {
			return { stdout: JSON.stringify({ items: [] }) };
		}

		try {
			const serializedItems = items.map(serializeLaunchpadItem);
			const response: Record<string, unknown> = { items: serializedItems };
			if (result.error != null) {
				response.warning = `Some integrations failed to load: ${result.error.message}`;
			}
			return { stdout: JSON.stringify(response) };
		} catch (ex) {
			return { stderr: `Error sending Launchpad data: ${ex}` };
		}
	}
}

function serializeLaunchpadItem(item: LaunchpadItem): Record<string, unknown> {
	const toSafeAccount = (account: Account | AuthorAccount | null) => {
		if (!account) return undefined;
		return {
			id: account.id,
			username: account.username,
			name: account.name,
			email: account.email,
			avatarUrl: account.avatarUrl,
		};
	};

	return {
		id: item.id,
		title: item.title,
		url: item.url,
		author: toSafeAccount(item.author),
		state: item.state,
		mergeableState: item.mergeableState,
		refs: item.refs,
		updatedDate: item.updatedDate,
		closedDate: item.closedDate,
		mergedDate: item.mergedDate,
		currentViewer: toSafeAccount(item.currentViewer),
		codeSuggestionsCount: item.codeSuggestionsCount,
		isNew: item.isNew,
		isSearched: item.isSearched,
		actionableCategory: item.actionableCategory,
		underlyingPullRequest: serializePullRequest(item.underlyingPullRequest),
		suggestedActions: item.suggestedActions,
		group: launchpadCategoryToGroupMap.get(item.actionableCategory),
		groups: getLaunchpadItemGroups(item),
	};
}
