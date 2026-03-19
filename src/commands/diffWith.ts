import type { TextDocumentShowOptions, Uri } from 'vscode';
import { ViewColumn } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { isShaWithParentSuffix, isUncommitted, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { basename } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { GlyphChars } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { command } from '../system/-webview/command.js';
import { openDiffEditor } from '../system/-webview/vscode/editors.js';
import { diffRangeToSelection } from '../system/-webview/vscode/range.js';
import { createMarkdownCommandLink } from '../system/commands.js';
import { GlCommandBase } from './commandBase.js';

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
	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
	source?: Source;
}

@command()
export class DiffWithCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: DiffWithCommandArgs): string;
	static createMarkdownCommandLink(commit: GitCommit, range?: DiffRange, source?: Source): string;
	static createMarkdownCommandLink(
		argsOrCommit: DiffWithCommandArgs | GitCommit,
		range?: DiffRange,
		source?: Source,
	): string {
		let args: DiffWithCommandArgs | GitCommit;
		if (GitCommit.is(argsOrCommit)) {
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
					range: range,
					source: source,
				};
			} else {
				args = {
					repoPath: commit.repoPath,
					// Don't need to worry about verifying the previous sha, as the DiffWith command will
					lhs: { sha: commit.unresolvedPreviousSha, uri: commit.file.originalUri ?? commit.file.uri },
					rhs: { sha: commit.sha, uri: commit.file.uri },
					range: range,
					source: source,
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
		if (args.repoPath == null) {
			debugger;
			return;
		}

		const svc = this.container.git.getRepositoryService(args.repoPath);

		try {
			let {
				lhs: { sha: lhsSha, uri: lhsUri, title: lhsTitle },
				rhs: { sha: rhsSha, uri: rhsUri, title: rhsTitle },
			} = args;
			const showOptions = { viewColumn: ViewColumn.Active, ...args.showOptions };

			let [lhsResolvedResult, rhsResolvedResult] = await Promise.allSettled([
				svc.revision.resolveRevision(lhsSha, lhsUri),
				svc.revision.resolveRevision(rhsSha, rhsUri),
			]);

			let lhsResolved = getSettledValue(lhsResolvedResult)!;
			let rhsResolved = getSettledValue(rhsResolvedResult)!;

			// If both are missing, check for renames by swapping the paths
			if (lhsResolved.sha === deletedOrMissing && rhsResolved.sha === deletedOrMissing) {
				[lhsResolvedResult, rhsResolvedResult] = await Promise.allSettled([
					svc.revision.resolveRevision(lhsSha, rhsUri),
					svc.revision.resolveRevision(rhsSha, lhsUri),
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
				rhsUri = svc.getAbsoluteUri(rhsResolved.path!, args.repoPath);
			} else if (rhsResolved.status === 'A' && isShaWithParentSuffix(lhsResolved.sha)) {
				lhsResolved.sha = deletedOrMissing;
			}

			const [lhsResult, rhsResult] = await Promise.allSettled([
				svc.getBestRevisionUri(lhsUri, lhsResolved.sha),
				svc.getBestRevisionUri(rhsUri, rhsResolved.sha),
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
			} else if (lhs == null && !rhsResolved.sha) {
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
					: (lhsTitle ?? rhsTitle);

			if (args.range != null) {
				showOptions.selection = diffRangeToSelection(args.range);
			}

			await openDiffEditor(
				lhs ?? svc.getRevisionUri(deletedOrMissing, args.lhs.uri.fsPath),
				rhs ?? svc.getRevisionUri(deletedOrMissing, args.rhs.uri.fsPath),
				title,
				showOptions,
			);
		} catch (ex) {
			Logger.error(ex, 'DiffWithCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
