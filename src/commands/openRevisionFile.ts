import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { FileAnnotationType } from '../configuration';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { GitActions } from './gitCommands';

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
						commit != null && commit.status === 'D'
							? this.container.git.getRevisionUri(
									commit.previousSha!,
									commit.previousUri.fsPath,
									commit.repoPath,
							  )
							: this.container.git.getRevisionUri(gitUri);
				} else {
					args.revisionUri = this.container.git.getRevisionUri(gitUri);
				}
			}

			void (await GitActions.Commit.openFileAtRevision(args.revisionUri, {
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenRevisionFileCommand');
			void Messages.showGenericErrorMessage('Unable to open file revision');
		}
	}
}
