import type { Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { showGenericErrorMessage } from '../messages';
import { command, executeCommand } from '../system/-webview/command';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs';
import { Logger } from '../system/logger';
import { uriEquals } from '../system/uri';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithNextCommandArgs {
	commit?: GitCommit;
	range?: Range;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithNextCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffWithNext');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithNextCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		let isInLeftSideOfDiffEditor = false;

		if (args.commit == null) {
			// Figure out if we are in a diff editor and if so, which side
			const [tab] = getVisibleTabs(uri);
			if (tab != null) {
				const uris = getTabUris(tab);
				// If there is an original, then we are in a diff editor -- modified is right, original is left
				if (uris.original != null && uriEquals(uri, uris.original)) {
					isInLeftSideOfDiffEditor = true;
				}
			}
		}

		const gitUri = args.commit?.getGitUri() ?? (await GitUri.fromUri(uri));
		try {
			const diffUris = await this.container.git.diff(gitUri.repoPath!).getNextComparisonUris(
				gitUri,
				gitUri.sha,
				// If we are in the left-side of the diff editor, we need to skip forward 1 more revision
				isInLeftSideOfDiffEditor ? 1 : 0,
			);

			if (diffUris?.next == null) return;

			void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.current.sha ?? '',
					uri: diffUris.current.documentUri(),
				},
				rhs: {
					sha: diffUris.next.sha ?? '',
					uri: diffUris.next.documentUri(),
				},
				line: args.line,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(
				ex,
				'DiffWithNextCommand',
				`getNextDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
