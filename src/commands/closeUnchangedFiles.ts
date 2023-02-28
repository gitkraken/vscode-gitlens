import type { Uri } from 'vscode';
import { TabInputCustom, TabInputNotebook, TabInputNotebookDiff, TabInputText, TabInputTextDiff, window } from 'vscode';
import { UriComparer } from '../comparers';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { Command } from './base';

export interface CloseUnchangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class CloseUnchangedFilesCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.CloseUnchangedFiles);
	}

	async execute(args?: CloseUnchangedFilesCommandArgs) {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repository = await getRepositoryOrShowPicker('Close All Unchanged Files');
				if (repository == null) return;

				const status = await this.container.git.getStatusForRepo(repository.uri);
				if (status == null) {
					void window.showWarningMessage('Unable to close unchanged files');

					return;
				}

				args.uris = status.files.map(f => f.uri);
			}

			const hasNoChangedFiles = args.uris.length === 0;

			for (const group of window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (
						tab.input instanceof TabInputText ||
						tab.input instanceof TabInputCustom ||
						tab.input instanceof TabInputNotebook
					) {
						const inputUri = tab.input.uri;
						if (hasNoChangedFiles || !args.uris.some(uri => UriComparer.equals(uri, inputUri))) {
							void window.tabGroups.close(tab, true);
						}
					} else if (tab.input instanceof TabInputTextDiff || tab.input instanceof TabInputNotebookDiff) {
						const inputUri = tab.input.modified;
						if (hasNoChangedFiles || !args.uris.some(uri => UriComparer.equals(uri, inputUri))) {
							void window.tabGroups.close(tab, true);
						}
					}
				}
			}
		} catch (ex) {
			Logger.error(ex, 'CloseUnchangedFilesCommand');
			void showGenericErrorMessage('Unable to close all unchanged files');
		}
	}
}
