import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { getCommitGitUri } from '../git/utils/-webview/commit.utils.js';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { selectionToDiffRange } from '../system/-webview/vscode/range.js';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';
import type { DiffWithCommandArgs } from './diffWith.js';

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
			args = {
				...args,
				range: { startLine: context.line, startCharacter: 1, endLine: context.line, endCharacter: 1 },
			};
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithPreviousCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		args.range ??= selectionToDiffRange(editor?.selection);

		const gitUri = (args.commit != null ? getCommitGitUri(args.commit) : undefined) ?? (await GitUri.fromUri(uri));

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
					uri: diffUris.previous.uri,
				},
				rhs: {
					sha: diffUris.current.sha ?? '',
					uri: diffUris.current.uri,
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
