import type { SourceControl } from 'vscode';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { Command } from './base';

@command()
export class AddAuthorsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.AddAuthors);
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
