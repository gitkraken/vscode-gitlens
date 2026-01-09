import type { Uri } from 'vscode';
import { TabInputCustom, TabInputNotebook, TabInputNotebookDiff, TabInputText, TabInputTextDiff, window } from 'vscode';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { areUrisEqual } from '../system/uri.js';
import { GlCommandBase } from './commandBase.js';

export interface CloseUnchangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class CloseUnchangedFilesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.closeUnchangedFiles');
	}

	async execute(args?: CloseUnchangedFilesCommandArgs): Promise<void> {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Close All Unchanged Files');
				if (repo == null) return;

				const status = await repo.git.status.getStatus();
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
						if (hasNoChangedFiles || !args.uris.some(uri => areUrisEqual(uri, inputUri))) {
							void window.tabGroups.close(tab, true);
						}
					} else if (tab.input instanceof TabInputTextDiff || tab.input instanceof TabInputNotebookDiff) {
						const inputUri = tab.input.modified;
						if (hasNoChangedFiles || !args.uris.some(uri => areUrisEqual(uri, inputUri))) {
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
