import type { TextEditor, Uri } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';

const localize = nls.loadMessageBundle();

export interface CompareWithCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class CompareWithCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.CompareWith,
			Commands.CompareHeadWith,
			Commands.CompareWorkingWith,
			Commands.Deprecated_DiffHeadWith,
			Commands.Deprecated_DiffWorkingWith,
		]);
	}

	protected override preExecute(context: CommandContext, args?: CompareWithCommandArgs) {
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
					title = localize('compare', 'Compare');
					break;
				case '':
					title = localize('compareWorkingTreeWith', 'Compare Working Tree with');
					break;
				case 'HEAD':
					title = localize('compareHeadWith', 'Compare HEAD with');
					break;
				default:
					title = localize('compareWith', 'Compare {0} with', args.ref1);
					break;
			}

			const repoPath = (await RepositoryPicker.getBestRepositoryOrShow(uri, editor, title))?.path;
			if (!repoPath) return;

			if (args.ref1 != null && args.ref2 != null) {
				await this.container.searchAndCompareView.compare(repoPath, args.ref1, args.ref2);
			} else {
				this.container.searchAndCompareView.selectForCompare(repoPath, args.ref1, { prompt: true });
			}
		} catch (ex) {
			Logger.error(ex, 'CompareWithCommmand');
			void showGenericErrorMessage(localize('unableToOpenComparison', 'Unable to open comparison'));
		}
	}
}
