import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { openDirectoryCompare } from '../git/actions/commit';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { CompareResultsNode } from '../views/nodes/compareResultsNode';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasRef } from './commandContext.utils';

export interface OpenDirectoryCompareCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class OpenDirectoryCompareCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			'gitlens.diffDirectory',
			'gitlens.diffDirectoryWithHead',
			GlCommand.ViewsOpenDirectoryDiff,
			GlCommand.ViewsOpenDirectoryDiffWithWorking,
		]);
	}

	protected override async preExecute(
		context: CommandContext,
		args?: OpenDirectoryCompareCommandArgs,
	): Promise<void> {
		switch (context.command) {
			case 'gitlens.diffDirectoryWithHead':
				args = { ...args };
				args.ref1 = 'HEAD';
				args.ref2 = undefined;
				break;

			case GlCommand.ViewsOpenDirectoryDiff:
				if (context.type === 'viewItem' && context.node instanceof CompareResultsNode) {
					args = { ...args };
					[args.ref1, args.ref2] = await context.node.getDiffRefs();
				}
				break;

			case GlCommand.ViewsOpenDirectoryDiffWithWorking:
				if (isCommandContextViewNodeHasRef(context)) {
					args = { ...args };
					args.ref1 = context.node.ref.ref;
					args.ref2 = '';
				}
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenDirectoryCompareCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			const repoPath = (await getBestRepositoryOrShowPicker(uri, editor, 'Directory Compare Working Tree With'))
				?.path;
			if (!repoPath) return;

			if (!args.ref1) {
				const pick = await showReferencePicker(
					repoPath,
					'Directory Compare Working Tree with',
					'Choose a branch or tag to compare with',
					{
						allowRevisions: true,
					},
				);
				if (pick == null) return;

				args.ref1 = pick.ref;
				if (args.ref1 == null) return;
			}

			void openDirectoryCompare(repoPath, args.ref1, args.ref2);
		} catch (ex) {
			Logger.error(ex, 'OpenDirectoryCompareCommand');
			void showGenericErrorMessage('Unable to open directory compare');
		}
	}
}
