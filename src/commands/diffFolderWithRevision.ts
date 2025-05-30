import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { FileType, Uri, workspace } from 'vscode';
import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { openFolderCompare } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/models/reference';
import { showGenericErrorMessage } from '../messages';
import { showCommitPicker } from '../quickpicks/commitPicker';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { pad } from '../system/string';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface DiffFolderWithRevisionCommandArgs {
	uri?: Uri;
	ref1?: string;
	ref2?: string;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffFolderWithRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.DiffFolderWithRevision);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffFolderWithRevisionCommandArgs): Promise<any> {
		args = { ...args };
		uri = args?.uri ?? getCommandUri(uri, editor);
		if (uri == null) return;

		try {
			const stat = await workspace.fs.stat(uri);
			if (stat.type !== FileType.Directory) {
				uri = Uri.joinPath(uri, '..');
			}
		} catch {}

		const gitUri = await GitUri.fromUri(uri);

		try {
			const repoPath = (await getBestRepositoryOrShowPicker(uri, editor, `Open Folder Changes with Revision`))
				?.path;
			if (!repoPath) return;

			const log = this.container.git
				.getLogForFile(gitUri.repoPath, gitUri.fsPath)
				.then(
					log =>
						log ??
						(gitUri.sha
							? this.container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { ref: gitUri.sha })
							: undefined),
				);

			const relativePath = this.container.git.getRelativePath(uri, repoPath);
			const title = `Open Folder Changes with Revision${pad(GlyphChars.Dot, 2, 2)}${relativePath}${
				gitUri.sha ? ` at ${shortenRevision(gitUri.sha)}` : ''
			}`;
			const pick = await showCommitPicker(log, title, 'Choose a commit to compare with', {
				picked: gitUri.sha,
				showOtherReferences: [
					CommandQuickPickItem.fromCommand('Choose a Branch or Tag...', Commands.DiffFolderWithRevisionFrom),
				],
			});
			if (pick == null) return;

			void openFolderCompare(uri, { repoPath: repoPath, lhs: pick.ref, rhs: gitUri.sha ?? '' });
		} catch (ex) {
			Logger.error(ex, 'DiffFolderWithRevisionCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
