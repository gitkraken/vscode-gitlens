'use strict';
import { TextEditor, Uri } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
} from './common';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ReferencePicker, ReferencesQuickPickIncludes } from '../quickpicks';

export interface DiffBranchWithCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class DiffBranchWithCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.DiffHeadWith, Commands.DiffWorkingWith]);
	}

	protected preExecute(context: CommandContext, args?: DiffBranchWithCommandArgs) {
		switch (context.command) {
			case Commands.DiffHeadWith:
				args = { ...args };
				args.ref1 = 'HEAD';
				break;

			case Commands.DiffWorkingWith:
				args = { ...args };
				args.ref1 = '';
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffBranchWithCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		if (args.ref1 == null) return;

		try {
			// let checkmarks;
			let title;
			switch (args.ref1) {
				case '':
					// checkmarks = false;
					title = 'Compare Working Tree with';
					break;
				case 'HEAD':
					// checkmarks = false;
					title = 'Compare HEAD with';
					break;
				default:
					// checkmarks = true;
					title = `Compare ${args.ref1} with`;
					break;
			}

			const repoPath = await getRepoPathOrActiveOrPrompt(uri, editor, title);
			if (!repoPath) return;

			if (!args.ref2) {
				const pick = await ReferencePicker.show(repoPath, title, 'Choose a reference to compare with', {
					allowEnteringRefs: true,
					picked: args.ref1,
					// checkmarks: checkmarks,
					include:
						ReferencesQuickPickIncludes.BranchesAndTags |
						ReferencesQuickPickIncludes.HEAD |
						ReferencesQuickPickIncludes.WorkingTree,
				});
				if (pick == null) return;

				args.ref2 = pick.ref;
				if (args.ref2 == null) return;
			}

			void (await Container.compareView.compare(repoPath, args.ref1, args.ref2));
		} catch (ex) {
			Logger.error(ex, 'DiffBranchWithCommand');
			void Messages.showGenericErrorMessage('Unable to open branch compare');
		}
	}
}
