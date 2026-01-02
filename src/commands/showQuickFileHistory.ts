import type { Range, TextEditor, Uri } from 'vscode';
import type { Container } from '../container.js';
import { executeGitCommand } from '../git/actions.js';
import { GitUri } from '../git/gitUri.js';
import type { GitBranch } from '../git/models/branch.js';
import type { GitLog } from '../git/models/log.js';
import type { GitReference } from '../git/models/reference.js';
import type { GitTag } from '../git/models/tag.js';
import type { CommandQuickPickItem } from '../quickpicks/items/common.js';
import { command } from '../system/-webview/command.js';
import { getScmResourceFolderUri } from '../system/-webview/scm.js';
import { ActiveEditorCachedCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';

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
		super(
			[
				'gitlens.openFileHistory',
				'gitlens.openFolderHistory',
				'gitlens.showQuickFileHistory',
				'gitlens.quickOpenFileHistory',
			],
			['gitlens.showFileHistoryInView'],
		);
	}

	protected override preExecute(context: CommandContext, args?: ShowQuickFileHistoryCommandArgs): Promise<void> {
		let uri = context.uri;
		if (
			context.command === 'gitlens.openFileHistory' ||
			context.command === /** @deprecated */ 'gitlens.showFileHistoryInView'
		) {
			args = { ...args };
			args.showInSideBar = true;
		} else if (context.command === 'gitlens.openFolderHistory') {
			args = { ...args };
			args.showInSideBar = true;
			if (context.type === 'scm-states') {
				uri = getScmResourceFolderUri(context.args) ?? context.uri;
			}
		}

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickFileHistoryCommandArgs): Promise<void> {
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
