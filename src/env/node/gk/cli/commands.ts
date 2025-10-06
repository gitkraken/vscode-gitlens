/* eslint-disable @typescript-eslint/require-await */
import type { Disposable } from 'vscode';
import type { CompareWithCommandArgs } from '../../../../commands/compareWith';
import type { Container } from '../../../../container';
import { cherryPick, merge, rebase } from '../../../../git/actions/repository';
import type { Repository } from '../../../../git/models/repository';
import { executeCommand } from '../../../../system/-webview/command';
import { createCommandDecorator } from '../../../../system/decorators/command';
import type { CliCommandRequest, CliCommandResponse, CliIpcServer } from './integration';

type CliCommand = 'cherry-pick' | 'compare' | 'graph' | 'merge' | 'rebase';
type CliCommandHandler = (request: CliCommandRequest, repo?: Repository | undefined) => Promise<CliCommandResponse>;

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

	private wrapHandler(request: CliCommandRequest, handler: CliCommandHandler) {
		let repo: Repository | undefined;
		if (request?.cwd) {
			repo = this.container.git.getRepository(request.cwd);
		}

		return handler(request, repo);
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
}
