import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

@command()
export class CopyCurrentBranchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.copyCurrentBranch');
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await getBestRepositoryOrShowPicker(
			this.container,
			gitUri,
			editor,
			'Copy Current Branch Name',
		);
		if (repository == null) return;

		try {
			const branch = await repository.git.branches.getBranch();
			if (branch?.name) {
				await env.clipboard.writeText(branch.name);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranchCommand');
			void showGenericErrorMessage('Unable to copy current branch name');
		}
	}
}
