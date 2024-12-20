import type { TextEditor } from 'vscode';
import { FileType, Uri, workspace } from 'vscode';
import { GlyphChars } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { openFolderCompare } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/models/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { Logger } from '../system/logger';
import { pad } from '../system/string';
import { command } from '../system/vscode/command';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface DiffFolderWithRevisionFromCommandArgs {
	uri?: Uri;
	lhs?: string;
	rhs?: string;
}

@command()
export class DiffFolderWithRevisionFromCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.DiffFolderWithRevisionFrom);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffFolderWithRevisionFromCommandArgs): Promise<any> {
		const defaultRHS = args == null;
		args = { ...args };
		uri = args?.uri ?? getCommandUri(uri, editor);
		if (uri == null) return;

		try {
			const stat = await workspace.fs.stat(uri);
			if (stat.type !== FileType.Directory) {
				uri = Uri.joinPath(uri, '..');
			}
		} catch {}

		try {
			const repoPath = (
				await getBestRepositoryOrShowPicker(uri, editor, 'Open Folder Changes with Branch or Tag')
			)?.path;
			if (!repoPath) return;

			const relativePath = this.container.git.getRelativePath(uri, repoPath);
			if (args.rhs == null) {
				// Default to the current sha or the working tree, if args are missing
				if (defaultRHS) {
					const gitUri = await GitUri.fromUri(uri);
					args.rhs = gitUri.sha ?? '';
				} else {
					const pick = await showReferencePicker(
						repoPath,
						`Open Folder Changes with Branch or Tag${pad(GlyphChars.Dot, 2, 2)}${relativePath}`,
						'Choose a reference (branch, tag, etc) to compare',
						{
							allowRevisions: true,
							include: ReferencesQuickPickIncludes.All,
							sort: { branches: { current: true }, tags: {} },
						},
					);
					if (pick?.ref == null) return;

					args.rhs = pick.ref;
				}
			}

			if (!args.lhs) {
				const pick = await showReferencePicker(
					repoPath,
					`Open Folder Changes with Branch or Tag${pad(GlyphChars.Dot, 2, 2)}${relativePath}${
						args.rhs ? ` at ${shortenRevision(args.rhs)}` : ''
					}`,
					'Choose a reference (branch, tag, etc) to compare with',
					{
						allowRevisions: true,
						include:
							args.rhs === ''
								? ReferencesQuickPickIncludes.All & ~ReferencesQuickPickIncludes.WorkingTree
								: ReferencesQuickPickIncludes.All,
					},
				);
				if (pick?.ref == null) return;

				args.lhs = pick.ref;

				// If we are trying to compare to the working tree, swap the lhs and rhs
				if (args.rhs !== '' && args.lhs === '') {
					args.lhs = args.rhs;
					args.rhs = '';
				}
			}

			void openFolderCompare(uri, { repoPath: repoPath, lhs: args.lhs, rhs: args.rhs });
		} catch (ex) {
			Logger.error(ex, 'DiffFolderWithRevisionFromCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
