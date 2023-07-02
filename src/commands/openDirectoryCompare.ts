import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { openDirectoryCompare } from '../git/actions/commit';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { CompareResultsNode } from '../views/nodes/compareResultsNode';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasRef } from './base';

export interface OpenDirectoryCompareCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class OpenDirectoryCompareCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.DiffDirectory,
			Commands.DiffDirectoryWithHead,
			Commands.ViewsOpenDirectoryDiff,
			Commands.ViewsOpenDirectoryDiffWithWorking,
		]);
	}

	protected override async preExecute(context: CommandContext, args?: OpenDirectoryCompareCommandArgs) {
		switch (context.command) {
			case Commands.DiffDirectoryWithHead:
				args = { ...args };
				args.ref1 = 'HEAD';
				args.ref2 = undefined;
				break;

			case Commands.ViewsOpenDirectoryDiff:
				if (context.type === 'viewItem' && context.node instanceof CompareResultsNode) {
					args = { ...args };
					[args.ref1, args.ref2] = await context.node.getDiffRefs();
				}
				break;

			case Commands.ViewsOpenDirectoryDiffWithWorking:
				if (isCommandContextViewNodeHasRef(context)) {
					args = { ...args };
					args.ref1 = context.node.ref.ref;
					args.ref2 = undefined;
				}
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenDirectoryCompareCommandArgs) {
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
						allowEnteringRefs: true,
						// checkmarks: false,
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
