import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Range, window } from 'vscode';
import * as nls from 'vscode-nls';
import type { FileAnnotationType } from '../configuration';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri, isGitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { findOrOpenEditor } from '../system/utils';
import { ActiveEditorCommand, getCommandUri } from './base';

const localize = nls.loadMessageBundle();

export interface OpenWorkingFileCommandArgs {
	uri?: Uri;
	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenWorkingFileCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
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
			if (isGitUri(args.uri) && args.uri.sha) {
				const workingUri = await this.container.git.getWorkingUri(args.uri.repoPath!, args.uri);
				if (workingUri === undefined) {
					void window.showWarningMessage(
						localize(
							'unableToOpenWorkingFileNotFoundInWorkingTree',
							'Unable to open working file. File could not be found in the working tree',
						),
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

			void (await this.container.fileAnnotations.show(e, args.annotationType, {
				selection: { line: args.line },
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenWorkingFileCommand');
			void showGenericErrorMessage(localize('unableToOpenWorkingFile', 'Unable to open working file'));
		}
	}
}
