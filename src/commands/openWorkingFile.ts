'use strict';
import { Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, findOrOpenEditor, getCommandUri } from './common';

export interface OpenWorkingFileCommandArgs {
	uri?: Uri;
	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenWorkingFileCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenWorkingFile, Commands.OpenWorkingFileInDiffLeft, Commands.OpenWorkingFileInDiffRight]);
	}

	async execute(editor: TextEditor, uri?: Uri, args?: OpenWorkingFileCommandArgs) {
		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line;
		}

		try {
			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return;
			} else {
				uri = args.uri;
			}

			args.uri = await GitUri.fromUri(uri);
			if (GitUri.is(args.uri) && args.uri.sha) {
				const workingUri = await Container.git.getWorkingUri(args.uri.repoPath!, args.uri);
				if (workingUri === undefined) {
					void window.showWarningMessage(
						'Unable to open working file. File could not be found in the working tree',
					);

					return;
				}

				args.uri = new GitUri(workingUri, args.uri.repoPath);
			}

			if (args.line !== undefined && args.line !== 0) {
				if (args.showOptions === undefined) {
					args.showOptions = {};
				}
				args.showOptions.selection = new Range(args.line, 0, args.line, 0);
			}

			const e = await findOrOpenEditor(args.uri, { ...args.showOptions, throwOnError: true });
			if (args.annotationType === undefined) return;

			void (await Container.fileAnnotations.show(e, args.annotationType, args.line));
		} catch (ex) {
			Logger.error(ex, 'OpenWorkingFileCommand');
			void Messages.showGenericErrorMessage('Unable to open working file');
		}
	}
}
