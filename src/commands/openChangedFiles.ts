'use strict';
import { Uri, window } from 'vscode';
import { Command, command, Commands, findOrOpenEditors, getRepoPathOrPrompt } from './common';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Arrays } from '../system';

export interface OpenChangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class OpenChangedFilesCommand extends Command {
	constructor() {
		super(Commands.OpenChangedFiles);
	}

	async execute(args?: OpenChangedFilesCommandArgs) {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repoPath = await getRepoPathOrPrompt('Open All Changed Files');
				if (!repoPath) return;

				const status = await Container.git.getStatusForRepo(repoPath);
				if (status == null) {
					void window.showWarningMessage('Unable to open changed files');

					return;
				}

				args.uris = Arrays.filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
			}

			findOrOpenEditors(args.uris);
		} catch (ex) {
			Logger.error(ex, 'OpenChangedFilesCommand');
			void Messages.showGenericErrorMessage('Unable to open all changed files');
		}
	}
}
