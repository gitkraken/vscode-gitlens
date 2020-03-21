'use strict';
import { Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Arrays } from '../system';
import { command, Command, Commands, findOrOpenEditor, getRepoPathOrPrompt } from './common';

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
			if (args.uris === undefined) {
				const repoPath = await getRepoPathOrPrompt(
					`Open all files changed in which repository${GlyphChars.Ellipsis}`,
				);
				if (!repoPath) return undefined;

				const status = await Container.git.getStatusForRepo(repoPath);
				if (status === undefined) return window.showWarningMessage('Unable to open changed files');

				args.uris = Arrays.filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
			}

			for (const uri of args.uris) {
				await findOrOpenEditor(uri, { preserveFocus: true, preview: false });
			}

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'OpenChangedFilesCommand');
			return Messages.showGenericErrorMessage('Unable to open all changed files');
		}
	}
}
