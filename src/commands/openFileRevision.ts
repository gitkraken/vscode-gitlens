'use strict';
import { CancellationTokenSource, commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitReference, GitTag, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, FileHistoryQuickPick, ShowFileHistoryFromQuickPickItem } from '../quickpicks';
import { Iterables, Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri, openEditor } from './common';

export interface OpenFileRevisionCommandArgs {
	reference?: GitBranch | GitTag | GitReference;
	uri?: Uri;
	maxCount?: number;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
	nextPageCommand?: CommandQuickPickItem;
}

@command()
export class OpenFileRevisionCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(args: OpenFileRevisionCommandArgs): string;
	static getMarkdownCommandArgs(uri: Uri, annotationType?: FileAnnotationType, line?: number): string;
	static getMarkdownCommandArgs(
		argsOrUri: OpenFileRevisionCommandArgs | Uri,
		annotationType?: FileAnnotationType,
		line?: number
	): string {
		let args: OpenFileRevisionCommandArgs | Uri;
		if (argsOrUri instanceof Uri) {
			const uri = argsOrUri;

			args = {
				uri: uri,
				line: line,
				annotationType: annotationType
			};
		} else {
			args = argsOrUri;
		}

		return super.getMarkdownCommandArgsCore<OpenFileRevisionCommandArgs>(Commands.OpenFileRevision, args);
	}

	constructor() {
		super(Commands.OpenFileRevision);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileRevisionCommandArgs) {
		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		let progressCancellation: CancellationTokenSource | undefined;

		try {
			let commandArgs: OpenFileRevisionCommandArgs;

			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return undefined;

				const gitUri = await GitUri.fromUri(uri);

				const placeHolder = `Open revision of ${gitUri.getFormattedPath({
					suffix: args.reference ? ` (${args.reference.name})` : undefined
				})}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''}${
					GlyphChars.Ellipsis
				}`;

				progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);

				const log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
					maxCount: args.maxCount,
					ref: (args.reference && args.reference.ref) || gitUri.sha
				});
				if (log === undefined) {
					if (args.reference) {
						return window.showWarningMessage(`The file could not be found in ${args.reference.name}`);
					}
					return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open history compare');
				}

				if (progressCancellation.token.isCancellationRequested) return undefined;

				let previousPageCommand: CommandQuickPickItem | undefined = undefined;

				if (log.truncated) {
					commandArgs = { ...args };
					const npc = new CommandQuickPickItem(
						{
							label: '$(arrow-right) Show Next Commits',
							description: `shows ${log.maxCount} newer commits`
						},
						Commands.OpenFileRevision,
						[uri, commandArgs]
					);

					const last = Iterables.last(log.commits.values());
					if (last != null) {
						commandArgs = { ...args, nextPageCommand: npc };
						previousPageCommand = new CommandQuickPickItem(
							{
								label: '$(arrow-left) Show Previous Commits',
								description: `shows ${log.maxCount} older commits`
							},
							Commands.OpenFileRevision,
							[new GitUri(uri, last), commandArgs]
						);
					}
				}

				commandArgs = { ...args };
				const icon = GitTag.isOfRefType(args.reference)
					? '$(tag) '
					: GitBranch.isOfRefType(args.reference)
					? '$(git-branch) '
					: '';
				const currentCommand = new CommandQuickPickItem(
					{
						label: `go back ${GlyphChars.ArrowBack}`,
						description: `to history of ${gitUri.getFormattedPath()}${
							args.reference
								? ` from ${GlyphChars.Space}${icon}${args.reference.name}`
								: gitUri.sha
								? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}`
								: ''
						}`
					},
					Commands.OpenFileRevision,
					[uri, commandArgs]
				);

				commandArgs = { ...args, maxCount: 0 };
				const pick = await FileHistoryQuickPick.show(log, gitUri, placeHolder, {
					pickerOnly: true,
					progressCancellation: progressCancellation,
					currentCommand: currentCommand,
					nextPageCommand: args.nextPageCommand,
					previousPageCommand: previousPageCommand,
					showAllCommand: log.truncated
						? new CommandQuickPickItem(
								{
									label: '$(sync) Show All Commits',
									description: 'this may take a while'
								},
								Commands.OpenFileRevision,
								[uri, commandArgs]
						  )
						: undefined
				});
				if (pick === undefined) return undefined;

				if (pick instanceof ShowFileHistoryFromQuickPickItem) {
					const reference = await pick.execute();
					if (reference === undefined) return undefined;
					if (reference instanceof CommandQuickPickItem) return reference.execute();

					commandArgs = {
						...args,
						reference: reference.item
					};
					return commands.executeCommand(Commands.OpenFileRevision, gitUri, commandArgs);
				}

				if (pick instanceof CommandQuickPickItem) return pick.execute();

				args.uri = GitUri.toRevisionUri(pick.item.sha, pick.item.uri.fsPath, pick.item.repoPath);
			}

			if (args.line !== undefined && args.line !== 0) {
				if (args.showOptions === undefined) {
					args.showOptions = {};
				}
				args.showOptions.selection = new Range(args.line, 0, args.line, 0);
			}

			const e = await openEditor(args.uri, { ...args.showOptions, rethrow: true });
			if (args.annotationType === undefined) return e;

			return Container.fileAnnotations.show(e, args.annotationType, args.line);
		} catch (ex) {
			Logger.error(ex, 'OpenFileRevisionCommand');
			return Messages.showGenericErrorMessage('Unable to open file revision');
		} finally {
			progressCancellation && progressCancellation.cancel();
		}
	}
}
