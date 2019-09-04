'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
	BranchHistoryQuickPick,
	CommandQuickPickItem,
	ReferencesQuickPick,
	ReferencesQuickPickIncludes
} from '../quickpicks';
import { ActiveEditorCachedCommand, command, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

export interface ShowQuickBranchHistoryCommandArgs {
	branch?: string;
	log?: GitLog;
	maxCount?: number;
	repoPath?: string;

	goBackCommand?: CommandQuickPickItem;
	nextPageCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickBranchHistoryCommand extends ActiveEditorCachedCommand {
	constructor() {
		super(Commands.ShowQuickBranchHistory);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickBranchHistoryCommandArgs = {}) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		args = { ...args };

		let progressCancellation =
			args.branch === undefined ? undefined : BranchHistoryQuickPick.showProgress(args.branch);
		try {
			const repoPath =
				args.repoPath ||
				(await getRepoPathOrActiveOrPrompt(
					gitUri,
					editor,
					`Show branch history in which repository${GlyphChars.Ellipsis}`
				));
			if (!repoPath) return undefined;

			if (args.branch === undefined) {
				let goBackCommand;
				if (!(await Container.git.getRepoPathOrActive(uri, editor))) {
					goBackCommand = new CommandQuickPickItem(
						{
							label: `go back ${GlyphChars.ArrowBack}`,
							description: 'to which repository'
						},
						Commands.ShowQuickBranchHistory,
						[uri, args]
					);
				}

				const pick = await new ReferencesQuickPick(repoPath).show(
					`Show history for branch${GlyphChars.Ellipsis}`,
					{
						checkmarks: false,
						goBack: goBackCommand,
						include: ReferencesQuickPickIncludes.Branches
					}
				);
				if (pick === undefined) return undefined;
				if (pick instanceof CommandQuickPickItem) return pick.execute();

				args.branch = pick.ref;
				if (args.branch === undefined) return undefined;

				progressCancellation = BranchHistoryQuickPick.showProgress(args.branch);
			}

			if (args.log === undefined) {
				args.log = await Container.git.getLog(repoPath, {
					maxCount: args.maxCount,
					ref: (gitUri && gitUri.sha) || args.branch
				});
				if (args.log === undefined) return window.showWarningMessage('Unable to show branch history');
			}

			if (progressCancellation !== undefined && progressCancellation.token.isCancellationRequested) {
				return undefined;
			}

			const pick = await BranchHistoryQuickPick.show(
				args.log,
				gitUri,
				args.branch,
				progressCancellation!,
				args.goBackCommand,
				args.nextPageCommand
			);
			if (pick === undefined) return undefined;

			if (pick instanceof CommandQuickPickItem) return pick.execute();

			// Create a command to get back to here
			const currentCommand = new CommandQuickPickItem(
				{
					label: `go back ${GlyphChars.ArrowBack}`,
					description: `to history of ${GlyphChars.Space}$(git-branch) ${args.branch}`
				},
				Commands.ShowQuickBranchHistory,
				[uri, { ...args }]
			);

			const commandArgs: ShowQuickCommitDetailsCommandArgs = {
				sha: pick.item.sha,
				commit: pick.item,
				repoLog: args.log,
				goBackCommand: currentCommand
			};
			return commands.executeCommand(Commands.ShowQuickCommitDetails, pick.item.toGitUri(), commandArgs);
		} catch (ex) {
			Logger.error(ex, 'ShowQuickBranchHistoryCommand');
			return Messages.showGenericErrorMessage('Unable to show branch history');
		} finally {
			progressCancellation && progressCancellation.cancel();
		}
	}
}
