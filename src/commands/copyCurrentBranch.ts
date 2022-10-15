import type { TextEditor, Uri } from 'vscode';
import { env, window } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { ActiveEditorCommand, getCommandUri } from './base';

const localize = nls.loadMessageBundle();

@command()
export class CopyCurrentBranchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.CopyCurrentBranch);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await RepositoryPicker.getBestRepositoryOrShow(
			gitUri,
			editor,
			localize('copyCurrentBranchName', 'Copy Current Branch Name'),
		);
		if (repository == null) return;

		try {
			const branch = await repository.getBranch();
			if (branch?.name) {
				await env.clipboard.writeText(branch.name);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranchCommand');
			void window.showErrorMessage(
				localize(
					'unableToCopyCurrentBranchName',
					'Unable to copy current branch name. See output channel for more details',
				),
			);
		}
	}
}
