import type { TextEditor, Uri } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { showCommitInDetailsView } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import type { GitRevisionReference } from '../git/models/reference';
import { getReferenceFromRevision } from '../git/utils/-webview/reference.utils';
import { createReference } from '../git/utils/reference.utils';
import {
	showFileNotUnderSourceControlWarningMessage,
	showGenericErrorMessage,
	showLineUncommittedWarningMessage,
} from '../messages';
import { command } from '../system/-webview/command';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasCommit } from './commandContext.utils';

export interface InspectCommandArgs {
	ref?: GitRevisionReference;
	source?: Source;
}

@command()
export class InspectCommand extends ActiveEditorCommand {
	static createMarkdownCommandLink(sha: string, repoPath: string, source?: Source): string;
	static createMarkdownCommandLink(args: InspectCommandArgs): string;
	static createMarkdownCommandLink(
		argsOrSha: InspectCommandArgs | string,
		repoPath?: string,
		source?: Source,
	): string {
		const args =
			typeof argsOrSha === 'string'
				? {
						ref: createReference(argsOrSha, repoPath!, { refType: 'revision' }),
						repoPath: repoPath,
						source: source,
					}
				: argsOrSha;
		return createMarkdownCommandLink<InspectCommandArgs>('gitlens.showCommitInView', args);
	}

	constructor(private readonly container: Container) {
		super(['gitlens.showCommitInView', 'gitlens.showInDetailsView', 'gitlens.showLineCommitInView']);
	}

	protected override preExecute(context: CommandContext, args?: InspectCommandArgs): Promise<void> {
		if (context.type === 'viewItem') {
			args = { ...args };
			if (isCommandContextViewNodeHasCommit(context)) {
				args.ref = getReferenceFromRevision(context.node.commit);
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: InspectCommandArgs): Promise<void> {
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

		return showCommitInDetailsView(args.ref);
	}
}
