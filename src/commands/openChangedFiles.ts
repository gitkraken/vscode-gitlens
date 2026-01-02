import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { openTextEditors } from '../system/-webview/vscode/editors.js';
import { filterMap } from '../system/array.js';
import { Logger } from '../system/logger.js';
import { GlCommandBase } from './commandBase.js';

export interface OpenChangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class OpenChangedFilesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openChangedFiles');
	}

	async execute(args?: OpenChangedFilesCommandArgs): Promise<void> {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Open All Changed Files');
				if (repo == null) return;

				const status = await repo.git.status.getStatus();
				if (status == null) {
					void window.showWarningMessage('Unable to open changed files');

					return;
				}

				args.uris = filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
			}

			openTextEditors(args.uris);
		} catch (ex) {
			Logger.error(ex, 'OpenChangedFilesCommand');
			void showGenericErrorMessage('Unable to open all changed files');
		}
	}
}
