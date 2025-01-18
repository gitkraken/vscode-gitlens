import type { Range, TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { GitUri } from '../git/gitUri';
import type { GitBranch } from '../git/models/branch';
import type { GitLog } from '../git/models/log';
import type { GitReference } from '../git/models/reference';
import type { GitTag } from '../git/models/tag';
import type { CommandQuickPickItem } from '../quickpicks/items/common';
import { command } from '../system/vscode/command';
import { getScmResourceFolderUri } from '../system/vscode/scm';
import type { CommandContext } from './base';
import { ActiveEditorCachedCommand, getCommandUri } from './base';

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
	constructor(private readonly container: Container) {
		super([
			GlCommand.OpenFileHistory,
			GlCommand.OpenFolderHistory,
			GlCommand.ShowQuickFileHistory,
			GlCommand.QuickOpenFileHistory,
			GlCommand.Deprecated_ShowFileHistoryInView,
		]);
	}

	protected override preExecute(context: CommandContext, args?: ShowQuickFileHistoryCommandArgs) {
		let uri = context.uri;
		if (
			context.command === GlCommand.OpenFileHistory ||
			context.command === GlCommand.Deprecated_ShowFileHistoryInView
		) {
			args = { ...args };
			args.showInSideBar = true;
		} else if (context.command === GlCommand.OpenFolderHistory) {
			args = { ...args };
			args.showInSideBar = true;
			if (context.type === 'scm-states') {
				uri = getScmResourceFolderUri(context.args) ?? context.uri;
			}
		}

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickFileHistoryCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		if (args?.showInSideBar) {
			await this.container.views.fileHistory.showHistoryForUri(gitUri);

			return;
		}

		await executeGitCommand({
			command: 'log',
			state:
				gitUri?.repoPath != null
					? {
							repo: gitUri.repoPath,
							reference: args?.reference ?? 'HEAD',
							fileName: gitUri.relativePath,
					  }
					: {},
		});
	}
}
