import type { TextEditor, Uri } from 'vscode';
import type { GlCommands } from '../constants.commands';
import type { Container } from '../container';
import type { GitRepositoryService } from '../git/gitRepositoryService';
import { GitUri } from '../git/gitUri';
import type { AIExplainSource } from '../plus/ai/aiProviderService';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { GlCommandBase } from './commandBase';
import { getCommandUri } from './commandBase.utils';

export interface ExplainBaseArgs {
	worktreePath?: string | Uri;
	repoPath?: string | Uri;
	source?: AIExplainSource;
}

export abstract class ExplainCommandBase extends GlCommandBase {
	abstract pickerTitle: string;
	abstract repoPickerPlaceholder: string;

	constructor(
		protected readonly container: Container,
		command: GlCommands | GlCommands[],
	) {
		super(command);
	}

	protected async getRepositoryService(
		editor?: TextEditor,
		uri?: Uri,
		args?: ExplainBaseArgs,
	): Promise<GitRepositoryService | undefined> {
		let svc;
		if (args?.worktreePath) {
			svc = this.container.git.getRepositoryService(args.worktreePath);
		} else if (args?.repoPath) {
			svc = this.container.git.getRepositoryService(args.repoPath);
		} else {
			uri = getCommandUri(uri, editor);
			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;
			const repository = await getBestRepositoryOrShowPicker(
				gitUri,
				editor,
				this.pickerTitle,
				this.repoPickerPlaceholder,
			);

			svc = repository?.git;
		}

		return svc;
	}
}
