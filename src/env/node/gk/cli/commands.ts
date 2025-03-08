import type { Disposable } from 'vscode';
import type { CompareWithCommandArgs } from '../../../../commands/compareWith';
import type { Container } from '../../../../container';
import { cherryPick, merge, rebase } from '../../../../git/actions/repository';
import type { Repository } from '../../../../git/models/repository';
import { executeCommand } from '../../../../system/-webview/command';
import type { CliCommandRequest, CliCommandResponse, CliIpcServer } from './integration';

interface CliCommand {
	command: string;
	handler: (request: CliCommandRequest, repo?: Repository | undefined) => Promise<CliCommandResponse>;
}

const commandHandlers: CliCommand[] = [];
function command(command: string) {
	return function (
		target: unknown,
		contextOrKey?: string | ClassMethodDecoratorContext,
		descriptor?: PropertyDescriptor,
	) {
		// ES Decorator
		if (contextOrKey && typeof contextOrKey === 'object' && 'kind' in contextOrKey) {
			if (contextOrKey.kind !== 'method') {
				throw new Error('The command decorator can only be applied to methods');
			}

			commandHandlers.push({ command: command, handler: target as CliCommand['handler'] });
			return;
		}

		// TypeScript experimental decorator
		if (descriptor) {
			commandHandlers.push({ command: command, handler: descriptor.value as CliCommand['handler'] });
			return descriptor;
		}

		throw new Error('Invalid decorator usage');
	};
}

export class CliCommandHandlers implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly server: CliIpcServer,
	) {
		for (const { command, handler } of commandHandlers) {
			this.server.registerHandler(command, rq => this.wrapHandler(rq, handler));
		}
	}

	dispose(): void {}

	private wrapHandler(
		request: CliCommandRequest,
		handler: (request: CliCommandRequest, repo?: Repository | undefined) => Promise<CliCommandResponse>,
	) {
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
		return cherryPick(repo);
	}

	@command('compare')
	async handleCompareCommand(
		_request: CliCommandRequest,
		repo?: Repository | undefined,
	): Promise<CliCommandResponse> {
		if (!repo || !_request.args?.length) {
			await executeCommand('gitlens.compareWith');
			return;
		}

		const [ref1, ref2] = _request.args;
		if (!ref1 || !ref2) {
			await executeCommand('gitlens.compareWith');
			return;
		}

		if (ref1) {
			if (!(await repo.git.refs().validateReference(ref1))) {
				// TODO: Send an error back to the CLI?
				await executeCommand('gitlens.compareWith');
				return;
			}
		}

		if (ref2) {
			if (!(await repo.git.refs().validateReference(ref2))) {
				// TODO: Send an error back to the CLI?
				await executeCommand<CompareWithCommandArgs>('gitlens.compareWith', { ref1: ref1 });
				return;
			}
		}

		await executeCommand<CompareWithCommandArgs>('gitlens.compareWith', { ref1: ref1, ref2: ref2 });
	}

	@command('graph')
	async handleGraphCommand(request: CliCommandRequest, repo?: Repository | undefined): Promise<CliCommandResponse> {
		if (!repo || !request.args?.length) {
			await executeCommand('gitlens.showGraphView');
			return;
		}

		const [ref] = request.args;
		const reference = await repo.git.refs().getReference(ref);
		if (ref && !reference) {
			// TODO: Send an error back to the CLI?
			await executeCommand('gitlens.showInCommitGraph', repo);
			return;
		}

		await executeCommand('gitlens.showInCommitGraph', { ref: reference });
	}

	@command('merge')
	async handleMergeCommand(request: CliCommandRequest, repo?: Repository | undefined): Promise<CliCommandResponse> {
		if (!repo || !request.args?.length) return merge(repo);

		const [ref] = request.args;
		const reference = await repo.git.refs().getReference(ref);
		if (ref && !reference) {
			// TODO: Send an error back to the CLI?
		}
		return merge(repo, reference);
	}

	@command('rebase')
	async handleRebaseCommand(request: CliCommandRequest, repo?: Repository | undefined): Promise<CliCommandResponse> {
		if (!repo || !request.args?.length) return rebase(repo);

		const [ref] = request.args;
		const reference = await repo.git.refs().getReference(ref);
		if (ref && !reference) {
			// TODO: Send an error back to the CLI?
		}

		return rebase(repo, reference);
	}
}
