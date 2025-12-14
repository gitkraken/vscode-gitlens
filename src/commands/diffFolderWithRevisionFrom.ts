import type { TextEditor } from 'vscode';
import { Uri } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import { openFolderCompare } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker2 } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { isFolderUri } from '../system/-webview/path';
import { Logger } from '../system/logger';
import { pad } from '../system/string';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

export interface DiffFolderWithRevisionFromCommandArgs {
	uri?: Uri;
	lhs?: string;
	rhs?: string;
}

@command()
export class DiffFolderWithRevisionFromCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffFolderWithRevisionFrom');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffFolderWithRevisionFromCommandArgs): Promise<any> {
		const defaultRHS = args == null;
		args = { ...args };
		uri = args?.uri ?? getCommandUri(uri, editor);
		if (uri == null) return;

		if (!(await isFolderUri(uri))) {
			uri = Uri.joinPath(uri, '..');
		}

		try {
			const repoPath = (
				await getBestRepositoryOrShowPicker(
					this.container,
					uri,
					editor,
					'Open Folder Changes with Branch or Tag',
				)
			)?.path;
			if (!repoPath) return;

			const relativePath = this.container.git.getRelativePath(uri, repoPath);
			if (args.rhs == null) {
				// Default to the current sha or the working tree, if args are missing
				if (defaultRHS) {
					const gitUri = await GitUri.fromUri(uri);
					args.rhs = gitUri.sha ?? '';
				} else {
					const result = await showReferencePicker2(
						repoPath,
						`Open Folder Changes with Branch or Tag${pad(GlyphChars.Dot, 2, 2)}${relativePath}`,
						'Choose a reference (branch, tag, etc) to compare',
						{
							allowedAdditionalInput: { rev: true },
							include: ['branches', 'tags', 'workingTree', 'HEAD'],
							sort: { branches: { current: true }, tags: {} },
						},
					);
					if (result.value?.ref == null) return;

					args.rhs = result.value.ref;
				}
			}

			if (!args.lhs) {
				const result = await showReferencePicker2(
					repoPath,
					`Open Folder Changes with Branch or Tag${pad(GlyphChars.Dot, 2, 2)}${relativePath}${
						args.rhs ? ` at ${shortenRevision(args.rhs)}` : ''
					}`,
					'Choose a reference (branch, tag, etc) to compare with',
					{
						allowedAdditionalInput: { rev: true },
						include:
							args.rhs === ''
								? ['branches', 'tags', 'HEAD']
								: ['branches', 'tags', 'workingTree', 'HEAD'],
					},
				);
				if (result.value?.ref == null) return;

				args.lhs = result.value.ref;

				// If we are trying to compare to the working tree, swap the lhs and rhs
				if (args.rhs !== '' && args.lhs === '') {
					args.lhs = args.rhs;
					args.rhs = '';
				}
			}

			void openFolderCompare(this.container, uri, { repoPath: repoPath, lhs: args.lhs, rhs: args.rhs });
		} catch (ex) {
			Logger.error(ex, 'DiffFolderWithRevisionFromCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
