import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { Uri } from 'vscode';
import { GlyphChars } from '../constants.js';
import type { Container } from '../container.js';
import { openFolderCompare } from '../git/actions/commit.js';
import { GitUri } from '../git/gitUri.js';
import { shortenRevision } from '../git/utils/revision.utils.js';
import { showGenericErrorMessage } from '../messages.js';
import { showCommitPicker } from '../quickpicks/commitPicker.js';
import { CommandQuickPickItem } from '../quickpicks/items/common.js';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { isFolderUri } from '../system/-webview/path.js';
import { Logger } from '../system/logger.js';
import { pad } from '../system/string.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { DiffFolderWithRevisionFromCommandArgs } from './diffFolderWithRevisionFrom.js';

export interface DiffFolderWithRevisionCommandArgs {
	uri?: Uri;
	ref1?: string;
	ref2?: string;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffFolderWithRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffFolderWithRevision');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffFolderWithRevisionCommandArgs): Promise<any> {
		args = { ...args };
		uri = args?.uri ?? getCommandUri(uri, editor);
		if (uri == null) return;

		if (!(await isFolderUri(uri))) {
			uri = Uri.joinPath(uri, '..');
		}
		const gitUri = await GitUri.fromUri(uri);

		try {
			const repo = await getBestRepositoryOrShowPicker(
				this.container,
				uri,
				editor,
				`Open Folder Changes with Revision`,
			);
			if (repo == null) return;

			const log = repo.git.commits
				.getLogForPath(gitUri.fsPath, undefined, { isFolder: true })
				.then(
					log =>
						log ??
						(gitUri.sha
							? repo.git.commits.getLogForPath(gitUri.fsPath, gitUri.sha, { isFolder: true })
							: undefined),
				);

			const relativePath = repo.git.getRelativePath(uri, repo.path);
			const title = `Open Folder Changes with Revision${pad(GlyphChars.Dot, 2, 2)}${relativePath}${
				gitUri.sha ? ` at ${shortenRevision(gitUri.sha)}` : ''
			}`;
			const pick = await showCommitPicker(log, title, 'Choose a commit to compare with', {
				picked: gitUri.sha,
				showOtherReferences: [
					CommandQuickPickItem.fromCommand<DiffFolderWithRevisionFromCommandArgs>(
						'Choose a Branch or Tag...',
						'gitlens.diffFolderWithRevisionFrom',
					),
				],
			});
			if (pick == null) return;

			void openFolderCompare(this.container, uri, { repoPath: repo.path, lhs: pick.ref, rhs: gitUri.sha ?? '' });
		} catch (ex) {
			Logger.error(ex, 'DiffFolderWithRevisionCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
