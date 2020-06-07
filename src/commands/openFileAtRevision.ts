'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { FileAnnotationType } from '../configuration';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { Container } from '../container';
import { GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { GitActions } from './gitCommands';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommitPicker, DirectiveQuickPickItem } from '../quickpicks';
import { Strings } from '../system';

export interface OpenFileAtRevisionCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenFileAtRevisionCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(args: OpenFileAtRevisionCommandArgs): string;
	static getMarkdownCommandArgs(revisionUri: Uri, annotationType?: FileAnnotationType, line?: number): string;
	static getMarkdownCommandArgs(
		argsOrUri: OpenFileAtRevisionCommandArgs | Uri,
		annotationType?: FileAnnotationType,
		line?: number,
	): string {
		let args: OpenFileAtRevisionCommandArgs | Uri;
		if (argsOrUri instanceof Uri) {
			const revisionUri = argsOrUri;

			args = {
				revisionUri: revisionUri,
				line: line,
				annotationType: annotationType,
			};
		} else {
			args = argsOrUri;
		}

		return super.getMarkdownCommandArgsCore<OpenFileAtRevisionCommandArgs>(Commands.OpenFileAtRevision, args);
	}

	constructor() {
		super(Commands.OpenFileAtRevision);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		try {
			if (args.revisionUri == null) {
				const log = Container.git
					.getLogForFile(gitUri.repoPath, gitUri.fsPath)
					.then(
						log =>
							log ??
							(gitUri.sha
								? Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { ref: gitUri.sha })
								: undefined),
					);

				const title = `Open File at Revision${Strings.pad(GlyphChars.Dot, 2, 2)}`;
				const pick = await CommitPicker.show(
					log,
					`${title}${gitUri.getFormattedFilename({
						suffix: gitUri.sha ? `:${GitRevision.shorten(gitUri.sha)}` : undefined,
						truncateTo: quickPickTitleMaxChars - title.length,
					})}`,
					'Choose a commit to open the file revision from',
					{
						picked: gitUri.sha,
						keys: ['right', 'alt+right', 'ctrl+right'],
						onDidPressKey: async (key, quickpick) => {
							const [item] = quickpick.activeItems;
							if (item != null && !DirectiveQuickPickItem.is(item)) {
								void (await GitActions.Commit.openFileAtRevision(item.item.uri.fsPath, item.item, {
									annotationType: args!.annotationType,
									line: args!.line,
									preserveFocus: true,
									preview: false,
								}));
							}
						},
					},
				);
				if (pick == null) return;

				void (await GitActions.Commit.openFileAtRevision(pick.fileName, pick, {
					annotationType: args.annotationType,
					line: args.line,
					...args.showOptions,
				}));

				return;
			}

			void (await GitActions.Commit.openFileAtRevision(args.revisionUri, {
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenFileAtRevisionCommand');
			void Messages.showGenericErrorMessage('Unable to open file at revision');
		}
	}
}
