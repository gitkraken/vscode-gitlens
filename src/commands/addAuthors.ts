import type { SourceControl } from 'vscode';
import type { Container } from '../container.js';
import { executeGitCommand } from '../git/actions.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class AddAuthorsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.addAuthors');
	}

	execute(sourceControl: SourceControl): Promise<void> {
		let repo;
		if (sourceControl?.rootUri != null) {
			repo = this.container.git.getRepository(sourceControl.rootUri);
		}

		return executeGitCommand({
			command: 'co-authors',
			state: { repo: repo, contributors: undefined },
		});
	}
}
