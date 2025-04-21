import type { TextDocumentShowOptions, Uri } from 'vscode';
import { Range, ViewColumn } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import { deletedOrMissing } from '../git/models/revision';
import { isShaWithParentSuffix, isUncommitted, shortenRevision } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { openDiffEditor } from '../system/-webview/vscode/editors';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { basename } from '../system/path';
import { getSettledValue } from '../system/promise';
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

	fromComparison?: boolean;
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
					lhs: { sha: 'HEAD', uri: commit.file.uri },
					rhs: { sha: '', uri: commit.file.uri },
					line: line,
				};
			} else {
				args = {
					repoPath: commit.repoPath,
					// Don't need to worry about verifying the previous sha, as the DiffWith command will
					lhs: { sha: commit.unresolvedPreviousSha, uri: commit.file.originalUri ?? commit.file.uri },
					rhs: { sha: commit.sha, uri: commit.file.uri },
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

		const repo = args.repoPath ? this.container.git.getRepository(args.repoPath) : undefined;
		if (repo == null) return;

		try {
			let {
				lhs: { sha: lhsSha, uri: lhsUri, title: lhsTitle },
				rhs: { sha: rhsSha, uri: rhsUri, title: rhsTitle },
			} = args;
			const showOptions = { viewColumn: ViewColumn.Active, ...args.showOptions };

			let [lhsResolvedResult, rhsResolvedResult] = await Promise.allSettled([
				repo.git.revision().resolveRevision(lhsSha, lhsUri),
				repo.git.revision().resolveRevision(rhsSha, rhsUri),
			]);

			let lhsResolved = getSettledValue(lhsResolvedResult)!;
			let rhsResolved = getSettledValue(rhsResolvedResult)!;

			// If both are missing, check for renames by swapping the paths
			if (lhsResolved.sha === deletedOrMissing && rhsResolved.sha === deletedOrMissing) {
				[lhsResolvedResult, rhsResolvedResult] = await Promise.allSettled([
					repo?.git.revision().resolveRevision(lhsSha, rhsUri),
					repo?.git.revision().resolveRevision(rhsSha, lhsUri),
				]);

				lhsResolved = getSettledValue(lhsResolvedResult)!;
				rhsResolved = getSettledValue(rhsResolvedResult)!;

				if (lhsResolved.sha !== deletedOrMissing || rhsResolved.sha !== deletedOrMissing) {
					[lhsTitle, rhsTitle] = [rhsTitle, lhsTitle];
					[lhsUri, rhsUri] = [rhsUri, lhsUri];
				}
			}

			if (rhsResolved.status === 'D') {
				rhsResolved.sha = deletedOrMissing;
			} else if (rhsResolved.status === 'R' || rhsResolved.status === 'C') {
				rhsUri = this.container.git.getAbsoluteUri(rhsResolved.path!, args.repoPath);
			} else if (rhsResolved.status === 'A' && isShaWithParentSuffix(lhsResolved.sha)) {
				lhsResolved.sha = deletedOrMissing;
			}

			const [lhsResult, rhsResult] = await Promise.allSettled([
				repo.git.getBestRevisionUri(lhsUri.fsPath, lhsResolved.sha),
				repo.git.getBestRevisionUri(rhsUri.fsPath, rhsResolved.sha),
			]);

			const lhs = getSettledValue(lhsResult);
			const rhs = getSettledValue(rhsResult);

			let rhsSuffix = shortenRevision(rhsResolved.revision);
			if (rhs == null) {
				if (isUncommitted(rhsResolved.sha)) {
					rhsSuffix = 'Deleted';
				} else if (!rhsSuffix && rhsResolved.sha === deletedOrMissing) {
					rhsSuffix = 'Not in Working Tree';
				} else {
					rhsSuffix = `${args.fromComparison ? 'Missing' : 'Deleted'}${!rhsSuffix ? '' : ` in ${rhsSuffix}`}`;
				}
			} else if (lhs == null) {
				if (!args.fromComparison) {
					rhsSuffix = `Added${!rhsSuffix ? '' : ` in ${rhsSuffix}`}`;
				}
			}

			let lhsSuffix = shortenRevision(lhsResolved.revision);
			if (lhsResolved.sha === deletedOrMissing) {
				lhsSuffix = args.fromComparison ? `Missing${!lhsSuffix ? '' : ` in ${lhsSuffix}`}` : '';
			}
			if (lhs == null && !rhsResolved.sha) {
				if (rhs != null) {
					lhsSuffix = !lhsSuffix ? '' : `Not in ${lhsSuffix}`;
					rhsSuffix = '';
				} else {
					lhsSuffix = `${args.fromComparison ? 'Missing' : 'Deleted'}${!lhsSuffix ? '' : ` in ${lhsSuffix}`}`;
				}
			}

			if (lhsTitle == null && (lhs != null || lhsSuffix)) {
				lhsTitle = `${basename(args.lhs.uri.fsPath)}${lhsSuffix ? ` (${lhsSuffix})` : ''}`;
			}
			rhsTitle ??= `${basename(args.rhs.uri.fsPath)}${rhsSuffix ? ` (${rhsSuffix})` : ''}`;

			const title =
				lhsTitle != null && rhsTitle != null
					? `${lhsTitle} ${GlyphChars.ArrowLeftRightLong} ${rhsTitle}`
					: lhsTitle ?? rhsTitle;

			if (args.line) {
				showOptions.selection = new Range(args.line, 0, args.line, 0);
			}

			await openDiffEditor(
				lhs ?? repo.git.getRevisionUri(deletedOrMissing, args.lhs.uri.fsPath),
				rhs ?? repo.git.getRevisionUri(deletedOrMissing, args.rhs.uri.fsPath),
				title,
				args.showOptions,
			);
		} catch (ex) {
			Logger.error(ex, 'DiffWithCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
