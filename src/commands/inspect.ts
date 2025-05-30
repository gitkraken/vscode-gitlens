import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { showDetailsView } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import type { GitRevisionReference } from '../git/models/reference';
import { createReference, getReferenceFromRevision } from '../git/models/reference';
import {
	showFileNotUnderSourceControlWarningMessage,
	showGenericErrorMessage,
	showLineUncommittedWarningMessage,
} from '../messages';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasCommit } from './base';

export interface InspectCommandArgs {
	ref?: GitRevisionReference;
}

@command()
export class InspectCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(sha: string, repoPath: string): string;
	static getMarkdownCommandArgs(args: InspectCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: InspectCommandArgs | string, repoPath?: string): string {
		const args =
			typeof argsOrSha === 'string'
				? { ref: createReference(argsOrSha, repoPath!, { refType: 'revision' }), repoPath: repoPath }
				: argsOrSha;
		return super.getMarkdownCommandArgsCore<InspectCommandArgs>(Commands.ShowCommitInView, args);
	}

	constructor(private readonly container: Container) {
		super([Commands.ShowCommitInView, Commands.ShowInDetailsView, Commands.ShowLineCommitInView]);
	}

	protected override preExecute(context: CommandContext, args?: InspectCommandArgs) {
		if (context.type === 'viewItem') {
			args = { ...args };
			if (isCommandContextViewNodeHasCommit(context)) {
				args.ref = getReferenceFromRevision(context.node.commit);
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: InspectCommandArgs) {
		args = { ...args };

		if (args.ref == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return undefined;

			const gitUri = await GitUri.fromUri(uri);

			const blameLine = editor?.selection.active.line;
			if (blameLine == null) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameLine);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage('Unable to inspect commit details');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					void showLineUncommittedWarningMessage('Unable to inspect commit details');

					return;
				}

				args.ref = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'InspectCommand', `getBlameForLine(${blameLine})`);
				void showGenericErrorMessage('Unable to inspect commit details');

				return;
			}
		}

		return showDetailsView(args.ref);
	}
}
