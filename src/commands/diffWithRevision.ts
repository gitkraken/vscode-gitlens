'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitReference, GitTag, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, FileHistoryQuickPick, ShowFileHistoryFromQuickPickItem } from '../quickpicks';
import { Iterables, Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithRevisionCommandArgs {
	reference?: GitBranch | GitTag | GitReference;
	maxCount?: number;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	nextPageCommand?: CommandQuickPickItem;
}

@command()
export class DiffWithRevisionCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.DiffWithRevision);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithRevisionCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		const gitUri = await GitUri.fromUri(uri);

		const placeHolder = `Compare ${gitUri.getFormattedPath({
			suffix: args.reference ? ` (${args.reference.name})` : undefined
		})}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''} with revision${
			GlyphChars.Ellipsis
		}`;

		const progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);
		try {
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

			let commandArgs: DiffWithRevisionCommandArgs;
			if (log.truncated) {
				commandArgs = { ...args };
				const npc = new CommandQuickPickItem(
					{
						label: '$(arrow-right) Show Next Commits',
						description: `shows ${log.maxCount} newer commits`
					},
					Commands.DiffWithRevision,
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
						Commands.DiffWithRevision,
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
				Commands.DiffWithRevision,
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
							Commands.DiffWithRevision,
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
				return commands.executeCommand(Commands.DiffWithRevision, gitUri, commandArgs);
			}

			if (pick instanceof CommandQuickPickItem) return pick.execute();

			const ref = pick.item.sha;

			const diffArgs: DiffWithCommandArgs = {
				repoPath: gitUri.repoPath,
				lhs: {
					sha: ref,
					uri: gitUri as Uri
				},
				rhs: {
					sha: '',
					uri: gitUri as Uri
				},
				line: args.line,
				showOptions: args.showOptions
			};
			return await commands.executeCommand(Commands.DiffWith, diffArgs);
		} catch (ex) {
			Logger.error(ex, 'DiffWithRevisionCommand');
			return Messages.showGenericErrorMessage('Unable to open compare');
		} finally {
			progressCancellation.cancel();
		}
	}
}
