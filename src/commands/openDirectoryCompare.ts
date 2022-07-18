import type { TextEditor, Uri } from 'vscode';
import * as nls from 'vscode-nls';
import { GitActions } from '../commands/gitCommands.actions';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { ReferencePicker } from '../quickpicks/referencePicker';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { CompareResultsNode } from '../views/nodes/compareResultsNode';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasRef } from './base';

const localize = nls.loadMessageBundle();

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
			const repoPath = (
				await RepositoryPicker.getBestRepositoryOrShow(
					uri,
					editor,
					localize('directoryCompareWorkingTreeWith', 'Directory Compare Working Tree With'),
				)
			)?.path;
			if (!repoPath) return;

			if (!args.ref1) {
				const pick = await ReferencePicker.show(
					repoPath,
					localize('directoryCompareWorkingTreeWith', 'Directory Compare Working Tree with'),
					localize('chooseBranchOrTagToCompareWith', 'Choose a branch or tag to compare with'),
					{
						allowEnteringRefs: true,
						// checkmarks: false,
					},
				);
				if (pick == null) return;

				args.ref1 = pick.ref;
				if (args.ref1 == null) return;
			}

			void GitActions.Commit.openDirectoryCompare(repoPath, args.ref1, args.ref2);
		} catch (ex) {
			Logger.error(ex, 'OpenDirectoryCompareCommand');
			void showGenericErrorMessage(localize('unableToOpenDirectoryCompare', 'Unable to open directory compare'));
		}
	}
}
