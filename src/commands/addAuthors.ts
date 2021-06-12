'use strict';
import { SourceControl } from 'vscode';
import { Container } from '../container';
import { command, Command, Commands } from './common';
import { executeGitCommand } from './gitCommands';

@command()
export class AddAuthorsCommand extends Command {
	constructor() {
		super(Commands.AddAuthors);
	}

	async execute(sourceControl: SourceControl) {
		let repo;
		if (sourceControl?.rootUri != null) {
			repo = await Container.git.getRepository(sourceControl.rootUri);
		}

		return executeGitCommand({
			command: 'co-authors',
			state: { repo: repo, contributors: undefined },
		});
	}
}
