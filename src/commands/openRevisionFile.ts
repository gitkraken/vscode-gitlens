import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { deletedOrMissing } from '../git/models/constants';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface OpenRevisionFileCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenRevisionFileCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([Commands.OpenRevisionFile, Commands.OpenRevisionFileInDiffLeft, Commands.OpenRevisionFileInDiffRight]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRevisionFileCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		try {
			if (args.revisionUri == null) {
				if (gitUri?.sha) {
					const commit = await this.container.git.getCommit(gitUri.repoPath!, gitUri.sha);

					args.revisionUri =
						commit?.file?.status === 'D'
							? this.container.git.getRevisionUri(
									(await commit.getPreviousSha()) ?? deletedOrMissing,
									commit.file,
									commit.repoPath,
							  )
							: this.container.git.getRevisionUri(gitUri);
				} else {
					args.revisionUri = this.container.git.getRevisionUri(gitUri);
				}
			}

			await openFileAtRevision(args.revisionUri, {
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			});
		} catch (ex) {
			Logger.error(ex, 'OpenRevisionFileCommand');
			void showGenericErrorMessage('Unable to open file revision');
		}
	}
}
