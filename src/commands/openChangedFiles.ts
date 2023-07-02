import type { Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { filterMap } from '../system/array';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { findOrOpenEditors } from '../system/utils';
import { Command } from './base';

export interface OpenChangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class OpenChangedFilesCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenChangedFiles);
	}

	async execute(args?: OpenChangedFilesCommandArgs) {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repository = await getRepositoryOrShowPicker('Open All Changed Files');
				if (repository == null) return;

				const status = await this.container.git.getStatusForRepo(repository.uri);
				if (status == null) {
					void window.showWarningMessage('Unable to open changed files');

					return;
				}

				args.uris = filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
			}

			findOrOpenEditors(args.uris);
		} catch (ex) {
			Logger.error(ex, 'OpenChangedFilesCommand');
			void showGenericErrorMessage('Unable to open all changed files');
		}
	}
}
