import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { isUncommittedStaged } from '@gitlens/git/utils/revision.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { getCommitGitUri } from '../git/utils/-webview/commit.utils.js';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { getOrOpenTextEditor } from '../system/-webview/vscode/editors.js';
import { selectionToDiffRange } from '../system/-webview/vscode/range.js';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { DiffWithCommandArgs } from './diffWith.js';

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
			if (uri == null && args.commit == null) return;
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

			gitUri = args.commit != null ? getCommitGitUri(args.commit) : undefined;
		} else {
			if (uri == null) return;

			gitUri = await GitUri.fromUri(uri);
		}

		if (gitUri == null) return;

		// If we are in the right diff editor, we can't really trust the line number
		// if (args.inDiffRightEditor && args.line !== 0) {
		// 	// TODO@eamodio figure out how to tell where the line moved in the previous commit (if at all)
		// }

		let isInRightSideOfDiffEditor = false;
		let isDirty = false;

		if (args.commit == null && uri != null) {
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
			const svc = this.container.git.getRepositoryService(gitUri.repoPath!);
			const diffUris = await svc.diff.getPreviousComparisonUris(
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
					void (await getOrOpenTextEditor(diffUris.current.uri, args.showOptions));

					return;
				}

				if (!isUncommittedStaged(diffUris.current.sha)) {
					void showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is staged, then diff staged with missing
				const missingUri = svc.getRevisionUri(deletedOrMissing, diffUris.current.path);
				void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
					repoPath: diffUris.current.repoPath,
					lhs: { sha: deletedOrMissing, uri: missingUri },
					rhs: { sha: diffUris.current.sha ?? '', uri: diffUris.current.uri },
					range: args.range,
					showOptions: args.showOptions,
				}));

				return;
			}

			void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				repoPath: diffUris.current.repoPath,
				lhs: { sha: diffUris.previous.sha ?? '', uri: diffUris.previous.uri },
				rhs: { sha: diffUris.current.sha ?? '', uri: diffUris.current.uri },
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
