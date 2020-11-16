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

export interface CompareWithCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class CompareWithCommand extends ActiveEditorCommand {
	constructor() {
		super([
			Commands.CompareWith,
			Commands.CompareHeadWith,
			Commands.CompareWorkingWith,
			Commands.Deprecated_DiffHeadWith,
			Commands.Deprecated_DiffWorkingWith,
		]);
	}

	protected preExecute(context: CommandContext, args?: CompareWithCommandArgs) {
		switch (context.command) {
			case Commands.CompareWith:
				args = { ...args };
				break;

			case Commands.CompareHeadWith:
			case Commands.Deprecated_DiffHeadWith:
				args = { ...args };
				args.ref1 = 'HEAD';
				break;

			case Commands.CompareWorkingWith:
			case Commands.Deprecated_DiffWorkingWith:
				args = { ...args };
				args.ref1 = '';
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CompareWithCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			let title;
			switch (args.ref1) {
				case null:
					title = 'Compare';
					break;
				case '':
					title = 'Compare Working Tree with';
					break;
				case 'HEAD':
					title = 'Compare HEAD with';
					break;
				default:
					title = `Compare ${args.ref1} with`;
					break;
			}

			const repoPath = await getRepoPathOrActiveOrPrompt(uri, editor, title);
			if (!repoPath) return;

			if (args.ref1 != null && args.ref2 != null) {
				void (await Container.searchAndCompareView.compare(repoPath, args.ref1, args.ref2));
			} else {
				Container.searchAndCompareView.selectForCompare(repoPath, args.ref1, { prompt: true });
			}
		} catch (ex) {
			Logger.error(ex, 'CompareWithCommmand');
			void Messages.showGenericErrorMessage('Unable to open comparison');
		}
	}
}
