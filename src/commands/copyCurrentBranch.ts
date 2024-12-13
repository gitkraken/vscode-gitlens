import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import { ActiveEditorCommand, getCommandUri } from './base';

@command()
export class CopyCurrentBranchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.CopyCurrentBranch);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await getBestRepositoryOrShowPicker(gitUri, editor, 'Copy Current Branch Name');
		if (repository == null) return;

		try {
			const branch = await repository.git.getBranch();
			if (branch?.name) {
				await env.clipboard.writeText(branch.name);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranchCommand');
			void showGenericErrorMessage('Unable to copy current branch name');
		}
	}
}
