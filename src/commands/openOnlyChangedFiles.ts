import type { Uri } from 'vscode';
import { TabInputCustom, TabInputNotebook, TabInputNotebookDiff, TabInputText, TabInputTextDiff, window } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { filterMap } from '../system/array';
import { UriComparer } from '../system/comparers';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import { findOrOpenEditors } from '../system/vscode/utils';
import { GlCommandBase } from './base';

export interface OpenOnlyChangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class OpenOnlyChangedFilesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.OpenOnlyChangedFiles);
	}

	async execute(args?: OpenOnlyChangedFilesCommandArgs) {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repository = await getRepositoryOrShowPicker('Open Changed & Close Unchanged Files');
				if (repository == null) return;

				const status = await this.container.git.getStatus(repository.uri);
				if (status == null) {
					void window.showWarningMessage('Unable to open changed & close unchanged files');

					return;
				}

				args.uris = filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
			}

			const hasNoChangedFiles = args.uris.length === 0;
			const openUris = new Set(args.uris);
			let inputUri: Uri | undefined = undefined;
			let matchingUri: Uri | undefined;

			for (const group of window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (hasNoChangedFiles) {
						void window.tabGroups.close(tab, true);
						continue;
					}

					if (
						tab.input instanceof TabInputText ||
						tab.input instanceof TabInputCustom ||
						tab.input instanceof TabInputNotebook
					) {
						inputUri = tab.input.uri;
					} else if (tab.input instanceof TabInputTextDiff || tab.input instanceof TabInputNotebookDiff) {
						inputUri = tab.input.modified;
					} else {
						inputUri = undefined;
					}

					if (inputUri == null) continue;
					// eslint-disable-next-line no-loop-func
					matchingUri = args.uris.find(uri => UriComparer.equals(uri, inputUri));
					if (matchingUri != null) {
						openUris.delete(matchingUri);
					} else {
						void window.tabGroups.close(tab, true);
					}
				}
			}

			if (openUris.size > 0) {
				findOrOpenEditors([...openUris]);
			}
		} catch (ex) {
			Logger.error(ex, 'OpenOnlyChangedFilesCommand');
			void showGenericErrorMessage('Unable to open changed & close unchanged files');
		}
	}
}
