import type { Sources } from '../constants.telemetry';
import type { Container } from '../container';
import type { Repository } from '../git/models/repository';
import { uncommitted, uncommittedStaged } from '../git/models/revision';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import type { ComposerHunk, ComposerHunkMap } from '../webviews/plus/composer/protocol';
import type { WebviewPanelShowCommandArgs } from '../webviews/webviewsController';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils';

export interface ComposeCommandArgs {
	repoPath?: string;
	source?: Sources;
}

@command()
export class ComposeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.composeCommits');
	}

	protected override preExecute(context: CommandContext, args?: ComposeCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasWorktree(context)) {
			args = { ...args };
			args.repoPath = context.node.worktree.path;
			args.source = args.source ?? 'view';
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
			args.source = args.source ?? 'view';
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
			args.source = args.source ?? 'view';
		}

		return this.execute(args);
	}

	async execute(args?: ComposeCommandArgs): Promise<void> {
		try {
			let repo;
			if (args?.repoPath != null) {
				repo = this.container.git.getRepository(args.repoPath);
			}
			repo ??= await getRepositoryOrShowPicker('Compose Commits with AI');
			if (repo == null) return;

			await this.composeCommits(repo, args?.source ?? 'commandPalette');
		} catch (ex) {
			Logger.error(ex, 'ComposeCommand', 'execute');
			void showGenericErrorMessage('Unable to compose commits');
		}
	}

	private async composeCommits(repo: Repository, source: Sources): Promise<void> {
		// Step 1: Get diffs for staged and unstaged changes
		const stagedDiff = await repo.git.diff.getDiff?.(
			uncommittedStaged, // staged changes vs HEAD
		);

		const unstagedDiff = await repo.git.diff.getDiff?.(
			uncommitted, // unstaged changes vs HEAD
		);

		// Check if we have any changes
		if (!stagedDiff?.contents && !unstagedDiff?.contents) {
			void showGenericErrorMessage('No changes found to compose commits from.');
			return;
		}

		// Step 2: Create hunk map and hunks array
		const { hunkMap, hunks } = this.createHunksFromDiffs(stagedDiff?.contents, unstagedDiff?.contents);

		// Step 3: Get base commit SHA
		const baseCommit = await repo.git.commits.getCommit('HEAD');
		const baseCommitSha = baseCommit?.sha ?? 'HEAD';

		// Step 4: Load composer webview
		await executeCommand<WebviewPanelShowCommandArgs>('gitlens.showComposerPage', undefined, {
			hunks: hunks,
			hunkMap: hunkMap,
			baseCommit: baseCommitSha,
			commits: [], // Start with no commits - all hunks unassigned
			source: source,
		});
	}

	private createHunksFromDiffs(
		stagedDiffContent?: string,
		unstagedDiffContent?: string,
	): { hunkMap: ComposerHunkMap[]; hunks: ComposerHunk[] } {
		const hunkMap: ComposerHunkMap[] = [];
		const hunks: ComposerHunk[] = [];
		let counter = 0;

		// Process staged changes
		if (stagedDiffContent) {
			this.processHunksFromDiff(stagedDiffContent, 'staged', counter, hunkMap, hunks);
			counter = hunkMap.length;
		}

		// Process unstaged changes
		if (unstagedDiffContent) {
			this.processHunksFromDiff(unstagedDiffContent, 'unstaged', counter, hunkMap, hunks);
		}

		return { hunkMap: hunkMap, hunks: hunks };
	}

	private processHunksFromDiff(
		diffContent: string,
		source: 'staged' | 'unstaged',
		startCounter: number,
		hunkMap: ComposerHunkMap[],
		hunks: ComposerHunk[],
	): void {
		let counter = startCounter;

		// Extract hunk headers and create hunk map entries
		for (const hunkHeaderMatch of diffContent.matchAll(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/gm)) {
			const hunkHeader = hunkHeaderMatch[0];
			const hunkIndex = ++counter;

			hunkMap.push({ index: hunkIndex, hunkHeader: hunkHeader });

			// Extract hunk details
			const hunk = this.extractHunkFromDiff(diffContent, hunkHeader, hunkIndex, source);
			if (hunk) {
				hunks.push(hunk);
			}
		}
	}

	private extractHunkFromDiff(
		diffContent: string,
		hunkHeader: string,
		hunkIndex: number,
		source: 'staged' | 'unstaged',
	): ComposerHunk | null {
		// Find the hunk header position
		const hunkHeaderIndex = diffContent.indexOf(hunkHeader);
		if (hunkHeaderIndex === -1) return null;

		// Find the diff header for this file
		const diffLines = diffContent.substring(0, hunkHeaderIndex).split('\n').reverse();
		const diffHeaderIndex = diffLines.findIndex(line => line.startsWith('diff --git'));
		if (diffHeaderIndex === -1) return null;

		const diffHeaderLine = diffLines[diffHeaderIndex];

		// Extract file name from diff header
		const fileNameMatch = diffHeaderLine.match(/diff --git a\/(.+?) b\/(.+)/);
		const fileName = fileNameMatch ? fileNameMatch[2] : 'unknown';

		// Extract the full diff header (including index, mode changes, etc.)
		const lastHunkHeaderIndex = diffLines.slice(0, diffHeaderIndex).findLastIndex(line => line.startsWith('@@ -'));

		let diffHeader = diffLines
			.slice(lastHunkHeaderIndex > -1 ? lastHunkHeaderIndex + 1 : 0, diffHeaderIndex + 1)
			.reverse()
			.join('\n');

		if (lastHunkHeaderIndex > -1) {
			diffHeader += '\n';
		}

		// Extract hunk content
		const hunkContent = this.extractHunkContent(diffContent, diffHeader, hunkHeader);
		if (!hunkContent) return null;

		// Calculate additions and deletions
		const { additions, deletions } = this.calculateHunkStats(hunkContent);

		return {
			index: hunkIndex,
			fileName: fileName,
			diffHeader: diffHeader,
			hunkHeader: hunkHeader,
			content: hunkContent,
			additions: additions,
			deletions: deletions,
			source: source,
			assigned: false, // Initially unassigned
		};
	}

	private extractHunkContent(diffContent: string, diffHeader: string, hunkHeader: string): string | null {
		// Find the file section in the diff
		const diffIndex = diffContent.indexOf(diffHeader);
		if (diffIndex === -1) return null;

		// Find the file section end
		const nextDiffIndex = diffContent.indexOf('diff --git', diffIndex + 1);

		// Find the hunk within the file content
		const hunkIndex = diffContent.indexOf(hunkHeader, diffIndex);
		if (hunkIndex === -1) return null;

		if (nextDiffIndex !== -1 && hunkIndex > nextDiffIndex) return null;

		// Find the next hunk or end of file
		const nextHunkIndex = diffContent.indexOf('\n@@ -', hunkIndex + 1);
		const nextIndex =
			nextHunkIndex !== -1 && (nextHunkIndex < nextDiffIndex || nextDiffIndex === -1)
				? nextHunkIndex
				: nextDiffIndex > 0
					? nextDiffIndex - 1
					: undefined;

		// Extract the content (including the hunk header)
		return diffContent.substring(hunkIndex, nextIndex);
	}

	private calculateHunkStats(hunkContent: string): { additions: number; deletions: number } {
		const lines = hunkContent.split('\n');
		let additions = 0;
		let deletions = 0;

		for (const line of lines) {
			if (line.startsWith('+') && !line.startsWith('+++')) {
				additions++;
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				deletions++;
			}
		}

		return { additions: additions, deletions: deletions };
	}
}
