'use strict';
import { TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, ReferencesQuickPick } from '../quickpicks';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	getRepoPathOrActiveOrPrompt
} from './common';

export interface DiffBranchWithCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class DiffBranchWithCommand extends ActiveEditorCommand {
	constructor() {
		super([
			Commands.DiffHeadWith,
			Commands.DiffWorkingWith,
			Commands.DiffHeadWithBranch,
			Commands.DiffWorkingWithBranch
		]);
	}

	protected preExecute(context: CommandContext, args: DiffBranchWithCommandArgs = {}) {
		switch (context.command) {
			case Commands.DiffHeadWith:
			case Commands.DiffHeadWithBranch:
				args.ref1 = 'HEAD';
				break;

			case Commands.DiffWorkingWith:
			case Commands.DiffWorkingWithBranch:
				args.ref1 = '';
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: DiffBranchWithCommandArgs = {}) {
		if (args.ref1 === undefined) return undefined;

		uri = getCommandUri(uri, editor);

		try {
			const repoPath = await getRepoPathOrActiveOrPrompt(
				uri,
				editor,
				`Compare in which repository${GlyphChars.Ellipsis}`
			);
			if (!repoPath) return undefined;

			if (!args.ref2) {
				let checkmarks;
				let placeHolder;
				switch (args.ref1) {
					case '':
						checkmarks = false;
						placeHolder = `Compare Working Tree with${GlyphChars.Ellipsis}`;
						break;
					case 'HEAD':
						checkmarks = false;
						placeHolder = `Compare HEAD with${GlyphChars.Ellipsis}`;
						break;
					default:
						checkmarks = true;
						placeHolder = `Compare ${args.ref1} with${GlyphChars.Ellipsis}`;
						break;
				}

				const pick = await new ReferencesQuickPick(repoPath).show(placeHolder, {
					allowEnteringRefs: true,
					checked: args.ref1,
					checkmarks: checkmarks
				});
				if (pick === undefined) return undefined;

				if (pick instanceof CommandQuickPickItem) return pick.execute();

				args.ref2 = pick.ref;
				if (args.ref2 === undefined) return undefined;
			}

			await Container.compareView.compare(repoPath, args.ref1, args.ref2);

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'DiffBranchWithBranchCommand');
			return Messages.showGenericErrorMessage('Unable to open branch compare');
		}
	}
}
