import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { openTextEditors } from '../system/-webview/vscode/editors';
import { filterMap } from '../system/array';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';

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
				const repository = await getRepositoryOrShowPicker('Open All Changed Files');
				if (repository == null) return;

				const status = await this.container.git.status(repository.uri).getStatus();
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
