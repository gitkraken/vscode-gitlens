/* eslint-disable @typescript-eslint/require-await */
import type { Disposable } from 'vscode';
import type { CompareWithCommandArgs } from '../../../../commands/compareWith.js';
import type { Container } from '../../../../container.js';
import { cherryPick, merge, rebase } from '../../../../git/actions/repository.js';
import type { PullRequest } from '../../../../git/models/pullRequest.js';
import type { Repository } from '../../../../git/models/repository.js';
import { serializePullRequest } from '../../../../git/utils/pullRequest.utils.js';
import type { LaunchpadCategorizedResult, LaunchpadItem } from '../../../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadItemGroups } from '../../../../plus/launchpad/launchpadProvider.js';
import { launchpadCategoryToGroupMap } from '../../../../plus/launchpad/models/launchpad.js';
import { startReviewFromPullRequest } from '../../../../plus/launchpad/utils/-webview/startReview.utils.js';
import { startWorkFromIssue } from '../../../../plus/startWork/utils/-webview/startWork.utils.js';
import { executeCommand } from '../../../../system/-webview/command.js';
import { createCommandDecorator } from '../../../../system/decorators/command.js';
import type { ComposerWebviewShowingArgs } from '../../../../webviews/plus/composer/registration.js';
import type { WebviewPanelShowCommandArgs } from '../../../../webviews/webviewsController.js';
import type { CliCommandRequest, CliCommandResponse, CliIpcServer } from './integration.js';

type CliCommand =
	| 'cherry-pick'
	| 'compare'
	| 'compose'
	| 'graph'
	| 'merge'
	| 'rebase'
	| 'get-launchpad-item'
	| 'get-launchpad-list'
	| 'start-review'
	| 'start-work';
type CliCommandHandler = (
	request: CliCommandRequest | undefined,
	repo?: Repository | undefined,
) => Promise<CliCommandResponse>;

const { command, getCommands } = createCommandDecorator<CliCommand, CliCommandHandler>();

export class CliCommandHandlers implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly server: CliIpcServer,
	) {
		for (const { command, handler } of getCommands()) {
			this.server.registerHandler(command, rq => this.wrapHandler(rq, handler));
		}
	}

	dispose(): void {}

	private wrapHandler(request: CliCommandRequest | undefined, handler: CliCommandHandler) {
		let repo: Repository | undefined;
		if (request?.cwd) {
			repo = this.container.git.getRepository(request.cwd);
		}

		return handler.call(this, request, repo);
	}

	@command('cherry-pick')
	async handleCherryPickCommand(
		_request: CliCommandRequest,
		repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		void cherryPick(repo);
	}

	@command('compare')
	async handleCompareCommand(
		_request: CliCommandRequest,
		repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		if (!repo || !_request.args?.length) {
			void executeCommand('gitlens.compareWith');
			return;
		}

		const [ref1, ref2] = _request.args;
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
	async handleGraphCommand(request: CliCommandRequest, repo?: Repository | undefined): Promise<CliCommandResponse> {
		if (!repo || !request.args?.length) {
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
	async handleMergeCommand(request: CliCommandRequest, repo?: Repository | undefined): Promise<CliCommandResponse> {
		if (!repo || !request.args?.length) return merge(repo);

		const [ref] = request.args;
		const reference = await repo.git.refs.getReference(ref);

		void merge(repo, reference);

		if (ref && !reference) {
			return { stderr: `'${ref}' is an invalid reference` };
		}
	}

	@command('rebase')
	async handleRebaseCommand(request: CliCommandRequest, repo?: Repository | undefined): Promise<CliCommandResponse> {
		if (!repo || !request.args?.length) return rebase(repo);

		const [ref] = request.args;
		const reference = await repo.git.refs.getReference(ref);

		void rebase(repo, reference);

		if (ref && !reference) {
			return { stderr: `'${ref}' is an invalid reference` };
		}
	}

	@command('compose')
	async handleComposeCommand(
		_request: CliCommandRequest,
		repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		void executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(
			'gitlens.showComposerPage',
			undefined,
			{
				repoPath: repo?.path,
				source: 'gk-cli-integration',
			},
		);
	}

	@command('start-review')
	async handleStartReviewCommand(
		request: CliCommandRequest,
		_repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		if (!request?.args?.length) return { stderr: 'No Pull Request provided' };
		const [prSearch] = request.args;

		try {
			const { worktree, branch, pr } = await startReviewFromPullRequest(this.container, prSearch);

			const result = {
				worktreePath: worktree.path,
				branchName: branch.name,
				prUrl: pr.url,
				prTitle: pr.title,
			};

			return { stdout: JSON.stringify(result) };
		} catch (ex) {
			return { stderr: `Error reviewing PR: ${ex instanceof Error ? ex.message : String(ex)}` };
		}
	}

	@command('start-work')
	async handleStartWorkCommand(
		request: CliCommandRequest,
		_repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		if (!request?.args?.length) return { stderr: 'No issue identifier provided' };
		const [issueSearch] = request.args;

		try {
			const { worktree, branch } = await startWorkFromIssue(this.container, { search: issueSearch });

			// get branch name and worktree path for branch
			const result = {
				branchName: branch.name,
				worktreePath: worktree.path,
			};

			return { stdout: JSON.stringify(result) };
		} catch (ex) {
			return { stderr: `Error starting work on issue: ${ex}` };
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
		if (result.error != null) {
			throw new Error(`Error fetching Launchpad: ${result.error.message}`);
		}

		return result;
	}

	@command('get-launchpad-item')
	async handleGetLaunchpadInfoCommand(
		request: CliCommandRequest,
		_repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		if (!request.args?.length) return { stderr: 'No Launchpad item identifier provided' };
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
			return { stdout: JSON.stringify({ item: serializedResponse }) };
		} catch (ex) {
			return { stderr: `Error sending Launchpad item data: ${ex}` };
		}
	}

	@command('get-launchpad-list')
	async handleGetLaunchpadCommand(
		_request: CliCommandRequest,
		_repo?: Repository | undefined,
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
			return { stdout: JSON.stringify({ items: serializedItems }) };
		} catch (ex) {
			return { stderr: `Error sending Launchpad data: ${ex}` };
		}
	}
}

function serializeLaunchpadItem(item: LaunchpadItem): Record<string, unknown> {
	const toSafeAccount = (account: any) => {
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
