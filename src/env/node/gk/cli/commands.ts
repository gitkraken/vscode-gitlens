/* eslint-disable @typescript-eslint/require-await */
import type { Disposable } from 'vscode';
import type { CompareWithCommandArgs } from '../../../../commands/compareWith';
import type { Container } from '../../../../container';
import { cherryPick, merge, rebase } from '../../../../git/actions/repository';
import type { Repository } from '../../../../git/models/repository';
import { serializePullRequest } from '../../../../git/utils/pullRequest.utils';
import { getLaunchpadItemGroups } from '../../../../plus/launchpad/launchpadProvider';
import { launchpadCategoryToGroupMap } from '../../../../plus/launchpad/models/launchpad';
import { executeCommand } from '../../../../system/-webview/command';
import { createCommandDecorator } from '../../../../system/decorators/command';
import { serialize } from '../../../../system/serialize';
import type { CliCommandRequest, CliCommandResponse, CliIpcServer } from './integration';

type CliCommand = 'cherry-pick' | 'compare' | 'graph' | 'merge' | 'rebase' | 'get-launchpad-info';
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

	@command('get-launchpad-info')
	async handleGetLaunchpadInfoCommand(
		request: CliCommandRequest,
		_repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		if (!request.args?.length) return { stderr: 'No PR identifier provided' };
		const [prSearch] = request.args;

		// Check if integrations are connected
		const hasConnectedIntegration = await this.container.launchpad.hasConnectedIntegration();
		if (!hasConnectedIntegration) {
			return {
				stderr: 'No connected integrations. Please connect a GitHub, GitLab, or other integration first.',
			};
		}

		// Use Launchpad's search to find the PR by URL or number
		const result = await this.container.launchpad.getCategorizedItems({ search: prSearch });
		if (result.error != null) {
			return { stderr: `Error fetching PR: ${result.error.message}` };
		}

		const items = result.items;
		if (items == null || items.length === 0) {
			return { stderr: `No PR found matching '${prSearch}'` };
		}

		// Return info for the first matching item (typically there's only one when searching by URL/number)
		const item = items[0];

		try {
			const group = launchpadCategoryToGroupMap.get(item.actionableCategory);
			const groups = getLaunchpadItemGroups(item);

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

			// Extract only serializable properties to avoid circular references
			const response = {
				item: {
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
					suggestedActions: item.suggestedActions,
					underlyingPullRequest: serializePullRequest(item.underlyingPullRequest),
				},
				group: group,
				groups: groups,
			};

			const serializedResponse = serialize(response);
			return { stdout: JSON.stringify(serializedResponse) };
		} catch (ex) {
			return { stderr: `Error sending PR data: ${ex}` };
		}
	}
}
