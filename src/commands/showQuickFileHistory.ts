'use strict';
import { Range, TextEditor, Uri } from 'vscode';
import { ActiveEditorCachedCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { Container } from '../container';
import { GitBranch, GitLog, GitReference, GitTag } from '../git/git';
import { executeGitCommand } from './gitCommands';
import { GitUri } from '../git/gitUri';
import { CommandQuickPickItem } from '../quickpicks';

export interface ShowQuickFileHistoryCommandArgs {
	reference?: GitBranch | GitTag | GitReference;
	log?: GitLog;
	limit?: number;
	range?: Range;
	showInSideBar?: boolean;

	goBackCommand?: CommandQuickPickItem;
	nextPageCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickFileHistoryCommand extends ActiveEditorCachedCommand {
	constructor() {
		super([Commands.ShowFileHistoryInView, Commands.ShowQuickFileHistory]);
	}

	protected preExecute(context: CommandContext, args?: ShowQuickFileHistoryCommandArgs) {
		if (context.command === Commands.ShowFileHistoryInView) {
			args = { ...args };
			args.showInSideBar = true;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickFileHistoryCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		if (args?.showInSideBar) {
			await Container.fileHistoryView.showHistoryForUri(gitUri);

			return;
		}

		void (await executeGitCommand({
			command: 'log',
			state:
				gitUri?.repoPath != null
					? {
							repo: gitUri.repoPath,
							reference: args?.reference ?? 'HEAD',
							fileName: gitUri.relativePath,
					  }
					: {},
		}));
	}
}
