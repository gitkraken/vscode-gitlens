import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import type { DiffRange } from '../git/gitProvider';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages';
import { command, executeCommand } from '../system/-webview/command';
import { selectionToDiffRange } from '../system/-webview/vscode/editors';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs';
import { Logger } from '../system/logger';
import { areUrisEqual } from '../system/uri';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithPreviousCommandArgs {
	commit?: GitCommit;

	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithPreviousCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffLineWithPrevious');
	}

	protected override preExecute(context: CommandContext, args?: DiffLineWithPreviousCommandArgs): Promise<any> {
		if (context.type === 'editorLine') {
			args = { ...args, range: { startLine: context.line, endLine: context.line } };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithPreviousCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		args.range ??= selectionToDiffRange(editor?.selection);

		const gitUri = args.commit?.getGitUri() ?? (await GitUri.fromUri(uri));

		let skipFirstRev = false;

		// Figure out if we are in a diff editor and if so, which side
		const [tab] = getVisibleTabs(uri);
		if (tab != null) {
			const uris = getTabUris(tab);
			// If there is an original, then we are in a diff editor -- modified is right, original is left
			if (uris.original != null) {
				skipFirstRev = areUrisEqual(uri, uris.modified);
			}
		}

		try {
			const diffUris = await this.container.git
				.getRepositoryService(gitUri.repoPath!)
				.diff.getPreviousComparisonUrisForRange(gitUri, gitUri.sha, args.range, {
					skipFirstRev: skipFirstRev,
				});

			if (diffUris?.previous == null) {
				void showCommitHasNoPreviousCommitWarningMessage();

				return;
			}

			void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.previous.sha ?? '',
					uri: diffUris.previous.documentUri(),
				},
				rhs: {
					sha: diffUris.current.sha ?? '',
					uri: diffUris.current.documentUri(),
				},
				range: diffUris.range,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(
				ex,
				'DiffLineWithPreviousCommand',
				`getPreviousLineDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
