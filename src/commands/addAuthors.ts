import type { SourceControl } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

@command()
export class AddAuthorsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.AddAuthors);
	}

	execute(sourceControl: SourceControl) {
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
