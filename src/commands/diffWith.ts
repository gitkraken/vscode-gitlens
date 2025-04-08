import type { TextDocumentShowOptions, Uri } from 'vscode';
import { Range, ViewColumn } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import { deletedOrMissing } from '../git/models/revision';
import { isShaWithOptionalRevisionSuffix, isUncommitted, shortenRevision } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { openDiffEditor } from '../system/-webview/vscode/editors';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { basename } from '../system/path';
import { GlCommandBase } from './commandBase';

export interface DiffWithCommandArgsRevision {
	sha: string;
	uri: Uri;
	title?: string;
}

export interface DiffWithCommandArgs {
	lhs: DiffWithCommandArgsRevision;
	rhs: DiffWithCommandArgsRevision;
	repoPath: string | undefined;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: DiffWithCommandArgs): string;
	static createMarkdownCommandLink(commit: GitCommit, line?: number): string;
	static createMarkdownCommandLink(argsOrCommit: DiffWithCommandArgs | GitCommit, line?: number): string {
		let args: DiffWithCommandArgs | GitCommit;
		if (isCommit(argsOrCommit)) {
			const commit = argsOrCommit;
			if (commit.file == null || commit.unresolvedPreviousSha == null) {
				debugger;
				throw new Error('Commit has no file');
			}

			if (commit.isUncommitted) {
				args = {
					repoPath: commit.repoPath,
					lhs: {
						sha: 'HEAD',
						uri: commit.file.uri,
					},
					rhs: {
						sha: '',
						uri: commit.file.uri,
					},
					line: line,
				};
			} else {
				args = {
					repoPath: commit.repoPath,
					lhs: {
						// Don't need to worry about verifying the previous sha, as the DiffWith command will
						sha: commit.unresolvedPreviousSha,
						uri: commit.file.originalUri ?? commit.file.uri,
					},
					rhs: {
						sha: commit.sha,
						uri: commit.file.uri,
					},
					line: line,
				};
			}
		} else {
			args = argsOrCommit;
		}

		return createMarkdownCommandLink<DiffWithCommandArgs>('gitlens.diffWith', args);
	}

	constructor(private readonly container: Container) {
		super('gitlens.diffWith');
	}

	async execute(args?: DiffWithCommandArgs): Promise<any> {
		if (args?.lhs == null || args?.rhs == null) return;

		args = {
			...args,
			lhs: { ...args.lhs },
			rhs: { ...args.rhs },
			showOptions: args.showOptions == null ? undefined : { ...args.showOptions },
		};

		if (args.repoPath == null) return;

		try {
			let lhsSha = args.lhs.sha;
			let rhsSha = args.rhs.sha;

			[args.lhs.sha, args.rhs.sha] = await Promise.all([
				await this.container.git.refs(args.repoPath).resolveReference(args.lhs.sha, args.lhs.uri, {
					// If the ref looks like a sha, don't wait too long, since it should work
					timeout: isShaWithOptionalRevisionSuffix(args.lhs.sha) ? 100 : undefined,
				}),
				await this.container.git.refs(args.repoPath).resolveReference(args.rhs.sha, args.rhs.uri, {
					// If the ref looks like a sha, don't wait too long, since it should work
					timeout: isShaWithOptionalRevisionSuffix(args.rhs.sha) ? 100 : undefined,
				}),
			]);

			if (args.lhs.sha !== deletedOrMissing) {
				lhsSha = args.lhs.sha;
			}

			if (args.rhs.sha && args.rhs.sha !== deletedOrMissing) {
				// Ensure that the file still exists in this commit
				const status = await this.container.git
					.commits(args.repoPath)
					.getCommitFileStatus(args.rhs.uri, args.rhs.sha);
				if (status?.status === 'D') {
					args.rhs.sha = deletedOrMissing;
				} else {
					rhsSha = args.rhs.sha;
				}

				if (status?.status === 'A' && args.lhs.sha.endsWith('^')) {
					args.lhs.sha = deletedOrMissing;
				}
			}

			const [lhs, rhs] = await Promise.all([
				this.container.git.getBestRevisionUri(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha),
				this.container.git.getBestRevisionUri(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha),
			]);

			let rhsSuffix = shortenRevision(rhsSha, { strings: { uncommitted: 'Working Tree' } });
			if (rhs == null) {
				if (isUncommitted(args.rhs.sha)) {
					rhsSuffix = 'deleted';
				} else if (rhsSuffix.length === 0 && args.rhs.sha === deletedOrMissing) {
					rhsSuffix = 'not in Working Tree';
				} else {
					rhsSuffix = `deleted${rhsSuffix.length === 0 ? '' : ` in ${rhsSuffix}`}`;
				}
			} else if (lhs == null) {
				rhsSuffix = `added${rhsSuffix.length === 0 ? '' : ` in ${rhsSuffix}`}`;
			}

			let lhsSuffix = args.lhs.sha !== deletedOrMissing ? shortenRevision(lhsSha) : '';
			if (lhs == null && args.rhs.sha.length === 0) {
				if (rhs != null) {
					lhsSuffix = lhsSuffix.length === 0 ? '' : `not in ${lhsSuffix}`;
					rhsSuffix = '';
				} else {
					lhsSuffix = `deleted${lhsSuffix.length === 0 ? '' : ` in ${lhsSuffix}`}`;
				}
			}

			if (args.lhs.title == null && (lhs != null || lhsSuffix.length !== 0)) {
				args.lhs.title = `${basename(args.lhs.uri.fsPath)}${lhsSuffix ? ` (${lhsSuffix})` : ''}`;
			}
			if (args.rhs.title == null) {
				args.rhs.title = `${basename(args.rhs.uri.fsPath)}${rhsSuffix ? ` (${rhsSuffix})` : ''}`;
			}

			const title =
				args.lhs.title != null && args.rhs.title != null
					? `${args.lhs.title} ${GlyphChars.ArrowLeftRightLong} ${args.rhs.title}`
					: args.lhs.title ?? args.rhs.title;

			if (args.showOptions == null) {
				args.showOptions = {};
			}

			if (args.showOptions.viewColumn == null) {
				args.showOptions.viewColumn = ViewColumn.Active;
			}

			if (args.line != null && args.line !== 0) {
				args.showOptions.selection = new Range(args.line, 0, args.line, 0);
			}

			await openDiffEditor(
				lhs ?? this.container.git.getRevisionUri(args.repoPath, deletedOrMissing, args.lhs.uri.fsPath),
				rhs ?? this.container.git.getRevisionUri(args.repoPath, deletedOrMissing, args.rhs.uri.fsPath),
				title,
				args.showOptions,
			);
		} catch (ex) {
			Logger.error(ex, 'DiffWithCommand', 'getVersionedFile');
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
