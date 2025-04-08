import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import type { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { deletedOrMissing } from '../git/models/revision';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

export interface OpenRevisionFileCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenRevisionFileCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.openRevisionFile');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRevisionFileCommandArgs): Promise<void> {
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
					const commit = await this.container.git.commits(gitUri.repoPath!).getCommit(gitUri.sha);

					args.revisionUri =
						commit?.file?.status === 'D'
							? this.container.git.getRevisionUri(
									commit.repoPath,
									(await commit.getPreviousSha()) ?? deletedOrMissing,
									commit.file,
							  )
							: this.container.git.getRevisionUriFromGitUri(gitUri);
				} else {
					args.revisionUri = this.container.git.getRevisionUriFromGitUri(gitUri);
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
