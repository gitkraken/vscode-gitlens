'use strict';
import { TextEditor, Uri } from 'vscode';
import { GitActions } from '../commands';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandContextViewNodeHasRef,
} from './common';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ReferencePicker } from '../quickpicks';
import { CompareResultsNode } from '../views/nodes';

export interface OpenDirectoryCompareCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class OpenDirectoryCompareCommand extends ActiveEditorCommand {
	constructor() {
		super([
			Commands.DiffDirectory,
			Commands.DiffDirectoryWithHead,
			Commands.ViewsOpenDirectoryDiff,
			Commands.ViewsOpenDirectoryDiffWithWorking,
		]);
	}

	protected async preExecute(context: CommandContext, args?: OpenDirectoryCompareCommandArgs) {
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
			const repoPath = await getRepoPathOrActiveOrPrompt(uri, editor, 'Directory Compare Working Tree With');
			if (!repoPath) return;

			if (!args.ref1) {
				const pick = await ReferencePicker.show(
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

			void GitActions.Commit.openDirectoryCompare(repoPath, args.ref1, args.ref2);
		} catch (ex) {
			Logger.error(ex, 'OpenDirectoryCompareCommand');
			void Messages.showGenericErrorMessage('Unable to open directory compare');
		}
	}
}
