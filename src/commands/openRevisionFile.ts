'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitActions } from './gitCommands';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface OpenRevisionFileCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenRevisionFileCommand extends ActiveEditorCommand {
	constructor() {
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
					const commit = await Container.git.getCommit(gitUri.repoPath!, gitUri.sha);

					args.revisionUri =
						commit != null && commit.status === 'D'
							? GitUri.toRevisionUri(commit.previousSha!, commit.previousUri.fsPath, commit.repoPath)
							: GitUri.toRevisionUri(gitUri);
				} else {
					args.revisionUri = GitUri.toRevisionUri(gitUri);
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
