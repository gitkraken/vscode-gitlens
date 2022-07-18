import { TextEditor, Uri, window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { ActiveEditorCommand, getCommandUri } from './base';

@command()
export class GetCurrentBranchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.GetCurrentBranch);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await RepositoryPicker.getBestRepositoryOrShow(gitUri, editor, 'Get Current Branch Name');
		if (repository == null) return;

		try {
			const branch = await repository.getBranch();
			if (branch?.name) {
				return branch.name;
			}
		} catch (ex) {
			Logger.error(ex, 'GetCurrentBranchCommand');
			void window.showErrorMessage('Unable to return current branch name. See output channel for more details');
		}

		return 'nobranchname';
	}
}
