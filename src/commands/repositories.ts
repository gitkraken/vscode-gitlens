import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

@command()
export class FetchRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.fetchRepositories');
	}

	async execute(): Promise<void> {
		return executeGitCommand({
			command: 'fetch',
			state: { repos: this.container.git.openRepositories },
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
