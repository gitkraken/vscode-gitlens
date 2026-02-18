import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config.js';
import type { Container } from '../container.js';
import { openFileAtRevision } from '../git/actions/commit.js';
import { GitUri } from '../git/gitUri.js';
import { deletedOrMissing } from '../git/models/revision.js';
import { showGenericErrorMessage } from '../messages.js';
import { command } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';

export interface OpenRevisionFileCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenRevisionFileCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.openRevisionFile', 'gitlens.openRevisionFile:editor/title']);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRevisionFileCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		args.line ??= editor?.selection.active.line ?? 0;

		try {
			if (args.revisionUri == null) {
				if (gitUri?.sha) {
					const svc = this.container.git.getRepositoryService(gitUri.repoPath!);
					const commit = await svc.commits.getCommit(gitUri.sha);

					args.revisionUri =
						commit?.file?.status === 'D'
							? svc.getRevisionUri((await commit.getPreviousSha()) ?? deletedOrMissing, commit.file)
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
