import type { Container } from '../container.js';
import { executeGitCommand } from '../git/actions.js';
import { groupRepositories } from '../git/utils/-webview/repository.utils.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class FetchRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.fetchRepositories');
	}

	async execute(): Promise<void> {
		const grouped = groupRepositories(this.container.git.openRepositories);

		return executeGitCommand({
			command: 'fetch',
			state: { repos: [...grouped.keys()] },
		});
	}
}

@command()
export class PullRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.pullRepositories');
	}

	async execute(): Promise<void> {
		return executeGitCommand({
			command: 'pull',
			state: { repos: this.container.git.openRepositories },
		});
	}
}

@command()
export class PushRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.pushRepositories');
	}

	async execute(): Promise<void> {
		return executeGitCommand({
			command: 'push',
			state: { repos: this.container.git.openRepositories },
		});
	}
}
