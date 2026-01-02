import type { Uri } from 'vscode';
import { TabInputCustom, TabInputNotebook, TabInputNotebookDiff, TabInputText, TabInputTextDiff, window } from 'vscode';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { openTextEditors } from '../system/-webview/vscode/editors.js';
import { filterMap } from '../system/array.js';
import { Logger } from '../system/logger.js';
import { areUrisEqual } from '../system/uri.js';
import { GlCommandBase } from './commandBase.js';

export interface OpenOnlyChangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class OpenOnlyChangedFilesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openOnlyChangedFiles');
	}

	async execute(args?: OpenOnlyChangedFilesCommandArgs): Promise<void> {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Open Changed & Close Unchanged Files');
				if (repo == null) return;

				const status = await repo.git.status.getStatus();
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
					matchingUri = args.uris.find(uri => areUrisEqual(uri, inputUri));
					if (matchingUri != null) {
						openUris.delete(matchingUri);
					} else {
						void window.tabGroups.close(tab, true);
					}
				}
			}

			if (openUris.size > 0) {
				openTextEditors([...openUris]);
			}
		} catch (ex) {
			Logger.error(ex, 'OpenOnlyChangedFilesCommand');
			void showGenericErrorMessage('Unable to open changed & close unchanged files');
		}
	}
}
