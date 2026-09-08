import type { TextDocumentShowOptions, Uri } from 'vscode';
import { l10n, ViewColumn } from 'vscode';
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
	/** Use `null` to explicitly open without a selection, so the diff editor reveals the first change */
	range?: DiffRange | null;
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

			const rhsFileName = basename(args.rhs.uri.fsPath);
			const rhsRevision = shortenRevision(rhsResolved.revision);
			let generatedRhsTitle = rhsRevision ? l10n.t('{0} ({1})', rhsFileName, rhsRevision) : rhsFileName;
			if (rhs == null) {
				if (isUncommitted(rhsResolved.sha)) {
					generatedRhsTitle = l10n.t('{0} (Deleted)', rhsFileName);
				} else if (!rhsRevision && rhsResolved.sha === deletedOrMissing) {
					generatedRhsTitle = l10n.t('{0} (Not in Working Tree)', rhsFileName);
				} else if (args.fromComparison) {
					generatedRhsTitle = rhsRevision
						? l10n.t('{0} (Missing in {1})', rhsFileName, rhsRevision)
						: l10n.t('{0} (Missing)', rhsFileName);
				} else {
					generatedRhsTitle = rhsRevision
						? l10n.t('{0} (Deleted in {1})', rhsFileName, rhsRevision)
						: l10n.t('{0} (Deleted)', rhsFileName);
				}
			} else if (lhs == null) {
				if (!args.fromComparison) {
					generatedRhsTitle = rhsRevision
						? l10n.t('{0} (Added in {1})', rhsFileName, rhsRevision)
						: l10n.t('{0} (Added)', rhsFileName);
				}
			}

			const lhsFileName = basename(args.lhs.uri.fsPath);
			const lhsRevision = shortenRevision(lhsResolved.revision);
			let generatedLhsTitle: string | undefined;
			if (lhsResolved.sha === deletedOrMissing) {
				if (args.fromComparison) {
					generatedLhsTitle = lhsRevision
						? l10n.t('{0} (Missing in {1})', lhsFileName, lhsRevision)
						: l10n.t('{0} (Missing)', lhsFileName);
				}
			} else if (lhs == null && !rhsResolved.sha) {
				if (rhs != null) {
					generatedLhsTitle = lhsRevision ? l10n.t('{0} (Not in {1})', lhsFileName, lhsRevision) : undefined;
					generatedRhsTitle = rhsFileName;
				} else if (args.fromComparison) {
					generatedLhsTitle = lhsRevision
						? l10n.t('{0} (Missing in {1})', lhsFileName, lhsRevision)
						: l10n.t('{0} (Missing)', lhsFileName);
				} else {
					generatedLhsTitle = lhsRevision
						? l10n.t('{0} (Deleted in {1})', lhsFileName, lhsRevision)
						: l10n.t('{0} (Deleted)', lhsFileName);
				}
			} else if (lhs != null || lhsRevision) {
				generatedLhsTitle = lhsRevision ? l10n.t('{0} ({1})', lhsFileName, lhsRevision) : lhsFileName;
			}

			lhsTitle ??= generatedLhsTitle;
			rhsTitle ??= generatedRhsTitle;

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
			void showGenericErrorMessage(l10n.t('Unable to open comparison'));
		}
	}
}
