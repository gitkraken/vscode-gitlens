'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { Container } from '../container';
import { GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, CommitPicker } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { GitActions } from './gitCommands';

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
		super([Commands.OpenFileAtRevision, Commands.OpenBlamePriorToChange]);
	}

	protected override async preExecute(context: CommandContext, args?: OpenFileAtRevisionCommandArgs) {
		if (context.command === Commands.OpenBlamePriorToChange) {
			args = { ...args, annotationType: FileAnnotationType.Blame };
			if (args.revisionUri == null && context.editor != null) {
				const blameline = context.editor.selection.active.line;
				if (blameline >= 0) {
					try {
						const gitUri = await GitUri.fromUri(context.editor.document.uri);
						const blame = await Container.git.getBlameForLine(gitUri, blameline);
						if (blame != null && !blame.commit.isUncommitted && blame.commit.previousSha != null) {
							args.revisionUri = GitUri.toRevisionUri(GitUri.fromCommit(blame.commit, true));
						}
					} catch {}
				}
			}
		}

		return this.execute(context.editor, context.uri, args);
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

				const title = `Open ${
					args.annotationType === FileAnnotationType.Blame ? 'Blame' : 'File'
				} at Revision${Strings.pad(GlyphChars.Dot, 2, 2)}`;
				const pick = await CommitPicker.show(
					log,
					`${title}${gitUri.getFormattedFilename({
						suffix: gitUri.sha ? `:${GitRevision.shorten(gitUri.sha)}` : undefined,
						truncateTo: quickPickTitleMaxChars - title.length,
					})}`,
					`Choose a commit to ${
						args.annotationType === FileAnnotationType.Blame ? 'blame' : 'open'
					} the file revision from`,
					{
						picked: gitUri.sha,
						keys: ['right', 'alt+right', 'ctrl+right'],
						onDidPressKey: async (key, item) => {
							void (await GitActions.Commit.openFileAtRevision(item.item.uri.fsPath, item.item, {
								annotationType: args!.annotationType,
								line: args!.line,
								preserveFocus: true,
								preview: false,
							}));
						},
						showOtherReferences: CommandQuickPickItem.fromCommand(
							'Choose a branch or tag...',
							Commands.OpenFileAtRevisionFrom,
						),
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
