import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container.js';
import { executeGitCommand } from '../git/actions.js';
import { GitUri } from '../git/gitUri.js';
import type { GitReference } from '../git/models/reference.js';
import { createReference } from '../git/utils/reference.utils.js';
import { command } from '../system/-webview/command.js';
import { ActiveEditorCachedCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';

export interface ShowQuickBranchHistoryCommandArgs {
	repoPath?: string;
	branch?: string;
	tag?: string;
}

@command()
export class ShowQuickBranchHistoryCommand extends ActiveEditorCachedCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.showQuickBranchHistory', 'gitlens.showQuickRepoHistory']);
	}

	protected override preExecute(context: CommandContext, args?: ShowQuickBranchHistoryCommandArgs): Promise<void> {
		if (context.command === 'gitlens.showQuickRepoHistory') {
			args = { ...args };
			args.branch = 'HEAD';
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickBranchHistoryCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = args?.repoPath ?? gitUri?.repoPath ?? this.container.git.highlander?.path;
		let ref: GitReference | 'HEAD' | undefined;
		if (repoPath != null) {
			if (args?.branch != null) {
				ref =
					args.branch === 'HEAD'
						? 'HEAD'
						: createReference(args.branch, repoPath, {
								refType: 'branch',
								name: args.branch,
								remote: false,
							});
			} else if (args?.tag != null) {
				ref = createReference(args.tag, repoPath, { refType: 'tag', name: args.tag });
			}
		}

		return executeGitCommand({
			command: 'log',
			state: repoPath != null ? { repo: repoPath, reference: ref } : {},
		});
	}
}
