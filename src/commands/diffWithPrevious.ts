import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import type { DiffRange } from '../git/gitProvider';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { deletedOrMissing } from '../git/models/revision';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages';
import { command, executeCommand } from '../system/-webview/command';
import { getOrOpenTextEditor, selectionToDiffRange } from '../system/-webview/vscode/editors';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs';
import { Logger } from '../system/logger';
import { areUrisEqual } from '../system/uri';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithPreviousCommandArgs {
	commit?: GitCommit;

	uri?: Uri;
	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithPreviousCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			'gitlens.diffWithPrevious',
			'gitlens.diffWithPrevious:codelens',
			'gitlens.diffWithPrevious:command',
			'gitlens.diffWithPrevious:editor',
			'gitlens.diffWithPrevious:editor/title',
			'gitlens.diffWithPrevious:explorer',
			'gitlens.diffWithPrevious:key',
			'gitlens.diffWithPrevious:views',
		]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithPreviousCommandArgs): Promise<void> {
		args = { ...args };
		if (args.uri == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return;
		} else {
			uri = args.uri;
		}
		args.range ??= selectionToDiffRange(editor?.selection);

		let gitUri;
		if (args.commit?.file != null) {
			if (!args.commit.isUncommitted) {
				void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
					repoPath: args.commit.repoPath,
					lhs: {
						sha: `${args.commit.sha}^`,
						uri: args.commit.file.originalUri ?? args.commit.file.uri,
					},
					rhs: {
						// If the file is `?` (untracked), then this must be a stash, so get the ^3 commit to access the untracked file
						sha: args.commit.file.status === '?' ? `${args.commit.sha}^3` : args.commit.sha || '',
						uri: args.commit.file.uri,
					},
					range: args.range,
					showOptions: args.showOptions,
				}));

				return;
			}

			gitUri = args.commit?.getGitUri();
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		// If we are in the right diff editor, we can't really trust the line number
		// if (args.inDiffRightEditor && args.line !== 0) {
		// 	// TODO@eamodio figure out how to tell where the line moved in the previous commit (if at all)
		// }

		let isInRightSideOfDiffEditor = false;
		let isDirty = false;

		if (args.commit == null) {
			// Figure out if we are in a diff editor and if so, which side
			const [tab] = getVisibleTabs(uri);
			if (tab != null) {
				isDirty = tab.isDirty;

				const uris = getTabUris(tab);
				// If there is an original, then we are in a diff editor -- modified is right, original is left
				if (uris.original != null && areUrisEqual(uri, uris.modified)) {
					isInRightSideOfDiffEditor = true;
				}
			}
		}

		try {
			const diffUris = await this.container.git
				.getRepositoryService(gitUri.repoPath!)
				.diff.getPreviousComparisonUris(
					gitUri,
					gitUri.sha,
					// If we are in the right-side of the diff editor, we need to skip back 1 more revision
					isInRightSideOfDiffEditor ? 1 : 0,
					isDirty,
				);

			if (diffUris?.previous == null) {
				if (diffUris == null) {
					void showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is the working file, just open the working file
				if (diffUris.current.sha == null) {
					void (await getOrOpenTextEditor(diffUris.current, args.showOptions));

					return;
				}

				if (!diffUris.current.isUncommittedStaged) {
					void showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is staged, then diff staged with missing
				diffUris.previous = GitUri.fromFile(
					diffUris.current.fileName,
					diffUris.current.repoPath!,
					deletedOrMissing,
				);
			}

			void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				repoPath: diffUris.current.repoPath,
				lhs: { sha: diffUris.previous.sha ?? '', uri: diffUris.previous.documentUri() },
				rhs: { sha: diffUris.current.sha ?? '', uri: diffUris.current.documentUri() },
				range: args.range,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(
				ex,
				'DiffWithPreviousCommand',
				`getPreviousDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
