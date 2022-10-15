import type { Uri } from 'vscode';
import { window } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { filterMap } from '../system/array';
import { command } from '../system/command';
import { findOrOpenEditors } from '../system/utils';
import { Command } from './base';

const localize = nls.loadMessageBundle();

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
				const repository = await RepositoryPicker.getRepositoryOrShow(
					localize('openAllChangedFiles', 'Open All Changed Files'),
				);
				if (repository == null) return;

				const status = await this.container.git.getStatusForRepo(repository.uri);
				if (status == null) {
					void window.showWarningMessage(
						localize('unableToOpenChangedFiles', 'Unable to open changed files'),
					);

					return;
				}

				args.uris = filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
			}

			findOrOpenEditors(args.uris);
		} catch (ex) {
			Logger.error(ex, 'OpenChangedFilesCommand');
			void showGenericErrorMessage(localize('unableToOpenAllChangedFiles', 'Unable to open all changed files'));
		}
	}
}
