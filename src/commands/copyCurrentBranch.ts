import type { TextEditor, Uri } from 'vscode';
import { env, l10n } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { showGenericErrorMessage } from '../messages.js';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';

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
			l10n.t('Copy Current Branch Name'),
		);
		if (repository == null) return;

		try {
			const branch = await repository.git.branches.getBranch();
			if (branch?.name) {
				await env.clipboard.writeText(branch.name);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyCurrentBranchCommand');
			void showGenericErrorMessage(l10n.t('Unable to copy current branch name'));
		}
	}
}
