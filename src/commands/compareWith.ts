import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';

export interface CompareWithCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class CompareWithCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(
			['gitlens.compareWith', 'gitlens.compareHeadWith', 'gitlens.compareWorkingWith'],
			['gitlens.diffHeadWith', 'gitlens.diffWorkingWith'],
		);
	}

	protected override preExecute(context: CommandContext, args?: CompareWithCommandArgs): Promise<void> {
		switch (context.command) {
			case 'gitlens.compareWith':
				args = { ...args };
				break;

			case 'gitlens.compareHeadWith':
			case /** @deprecated */ 'gitlens.diffHeadWith':
				args = { ...args };
				args.ref1 = 'HEAD';
				break;

			case 'gitlens.compareWorkingWith':
			case /** @deprecated */ 'gitlens.diffWorkingWith':
				args = { ...args };
				args.ref1 = '';
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CompareWithCommandArgs): Promise<void> {
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

			const repoPath = (await getBestRepositoryOrShowPicker(this.container, uri, editor, title))?.path;
			if (!repoPath) return;

			if (args.ref1 != null && args.ref2 != null) {
				await this.container.views.searchAndCompare.compare(repoPath, args.ref1, args.ref2);
			} else {
				this.container.views.searchAndCompare.selectForCompare(repoPath, args.ref1, { prompt: true });
			}
		} catch (ex) {
			Logger.error(ex, 'CompareWithCommmand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
