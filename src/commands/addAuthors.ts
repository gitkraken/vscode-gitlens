'use strict';
import { SourceControl } from 'vscode';
import type { Container } from '../container';
import { command, Command, Commands } from './common';
import { executeGitCommand } from './gitCommands';

@command()
export class AddAuthorsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.AddAuthors);
	}

	async execute(sourceControl: SourceControl) {
		let repo;
		if (sourceControl?.rootUri != null) {
			repo = await this.container.git.getRepository(sourceControl.rootUri);
		}

		return executeGitCommand({
			command: 'co-authors',
			state: { repo: repo, contributors: undefined },
		});
	}
}
