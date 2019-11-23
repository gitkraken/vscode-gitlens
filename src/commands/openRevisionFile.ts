'use strict';
import { Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, CommandContext, Commands, findOrOpenEditor, getCommandUri } from './common';

export interface OpenRevisionFileCommandArgs {
	uri?: Uri;

	inDiffRightEditor?: boolean;
	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenRevisionFileCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenRevisionFile, Commands.OpenRevisionFileInDiffRight]);
	}

	protected preExecute(context: CommandContext, args?: OpenRevisionFileCommandArgs) {
		if (context.command === Commands.OpenRevisionFileInDiffRight) {
			args = { ...args };
			args.inDiffRightEditor = true;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRevisionFileCommandArgs) {
		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		try {
			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return undefined;
			} else {
				uri = args.uri;
			}

			const gitUri = await GitUri.fromUri(uri);
			if (gitUri?.sha) {
				if (args.inDiffRightEditor) {
					try {
						const diffUris = await Container.git.getPreviousDiffUris(
							gitUri.repoPath!,
							gitUri,
							gitUri.sha,
							0
						);
						args.uri = GitUri.toRevisionUri(diffUris?.previous ?? gitUri);
					} catch (ex) {
						Logger.error(
							ex,
							'OpenRevisionFileCommand',
							`getPreviousDiffUris(${gitUri?.repoPath}, ${gitUri.fsPath}, ${gitUri?.sha})`
						);
						return Messages.showGenericErrorMessage('Unable to open revision');
					}
				} else {
					const commit = await Container.git.getCommit(gitUri.repoPath!, gitUri.sha);

					args.uri =
						commit !== undefined && commit.status === 'D'
							? GitUri.toRevisionUri(commit.previousSha!, commit.previousUri.fsPath, commit.repoPath)
							: GitUri.toRevisionUri(gitUri);
				}
			} else {
				args.uri = GitUri.toRevisionUri(gitUri);
			}

			if (args.line !== undefined && args.line !== 0) {
				if (args.showOptions === undefined) {
					args.showOptions = {};
				}
				args.showOptions.selection = new Range(args.line, 0, args.line, 0);
			}

			const e = await findOrOpenEditor(args.uri, { ...args.showOptions, rethrow: true });
			if (args.annotationType === undefined) return e;

			return Container.fileAnnotations.show(e, args.annotationType, args.line);
		} catch (ex) {
			Logger.error(ex, 'OpenRevisionFileCommand');
			return Messages.showGenericErrorMessage('Unable to open file revision');
		}
	}
}
