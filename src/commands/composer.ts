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
		const stagedDiff = await repo.git.diff.getDiff?.(uncommittedStaged);

		const unstagedDiff = await repo.git.diff.getDiff?.(uncommitted);

		if (!stagedDiff?.contents && !unstagedDiff?.contents) {
			void showGenericErrorMessage('No changes found to compose commits from.');
			return;
		}

		const { hunkMap, hunks } = this.createHunksFromDiffs(stagedDiff?.contents, unstagedDiff?.contents);

		const baseCommit = await repo.git.commits.getCommit('HEAD');
		const baseCommitSha = baseCommit?.sha ?? 'HEAD';

		await executeCommand<WebviewPanelShowCommandArgs>('gitlens.showComposerPage', undefined, {
			hunks: hunks,
			hunkMap: hunkMap,
			baseCommit: baseCommitSha,
			commits: [],
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

		if (stagedDiffContent) {
			this.processHunksFromDiff(stagedDiffContent, 'staged', counter, hunkMap, hunks);
			counter = hunkMap.length;
		}

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

		const renameHunks = this.extractRenameHunks(diffContent, source);
		for (const renameHunk of renameHunks) {
			const hunkIndex = ++counter;
			renameHunk.index = hunkIndex;

			hunkMap.push({ index: hunkIndex, hunkHeader: renameHunk.hunkHeader });
			hunks.push(renameHunk);
		}

		for (const hunkHeaderMatch of diffContent.matchAll(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/gm)) {
			const hunkHeader = hunkHeaderMatch[0];
			const hunkIndex = ++counter;

			hunkMap.push({ index: hunkIndex, hunkHeader: hunkHeader });

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
		const hunkHeaderIndex = diffContent.indexOf(hunkHeader);
		if (hunkHeaderIndex === -1) return null;

		const diffLines = diffContent.substring(0, hunkHeaderIndex).split('\n').reverse();
		const diffHeaderIndex = diffLines.findIndex(line => line.startsWith('diff --git'));
		if (diffHeaderIndex === -1) return null;

		const diffHeaderLine = diffLines[diffHeaderIndex];

		const fileNameMatch = diffHeaderLine.match(/diff --git a\/(.+?) b\/(.+)/);
		const fileName = fileNameMatch ? fileNameMatch[2] : 'unknown';

		const lastHunkHeaderIndex = diffLines.slice(0, diffHeaderIndex).findLastIndex(line => line.startsWith('@@ -'));

		let diffHeader = diffLines
			.slice(lastHunkHeaderIndex > -1 ? lastHunkHeaderIndex + 1 : 0, diffHeaderIndex + 1)
			.reverse()
			.join('\n');

		if (lastHunkHeaderIndex > -1) {
			diffHeader += '\n';
		}

		const hunkContent = this.extractHunkContent(diffContent, diffHeader, hunkHeader);
		if (!hunkContent) return null;

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
			assigned: false,
		};
	}

	private extractHunkContent(diffContent: string, diffHeader: string, hunkHeader: string): string | null {
		const diffIndex = diffContent.indexOf(diffHeader);
		if (diffIndex === -1) return null;

		const nextDiffIndex = diffContent.indexOf('diff --git', diffIndex + 1);

		const hunkIndex = diffContent.indexOf(hunkHeader, diffIndex);
		if (hunkIndex === -1) return null;

		if (nextDiffIndex !== -1 && hunkIndex > nextDiffIndex) return null;

		const nextHunkIndex = diffContent.indexOf('\n@@ -', hunkIndex + 1);
		const nextIndex =
			nextHunkIndex !== -1 && (nextHunkIndex < nextDiffIndex || nextDiffIndex === -1)
				? nextHunkIndex
				: nextDiffIndex > 0
					? nextDiffIndex - 1
					: undefined;

		const hunkHeaderEndIndex = diffContent.indexOf('\n', hunkIndex);
		if (hunkHeaderEndIndex === -1) return null;

		return diffContent.substring(hunkHeaderEndIndex + 1, nextIndex);
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

	private extractRenameHunks(diffContent: string, source: 'staged' | 'unstaged'): ComposerHunk[] {
		const renameHunks: ComposerHunk[] = [];

		const fileSections = diffContent.split(/^diff --git /m).filter(Boolean);

		for (const fileSection of fileSections) {
			if (fileSection.includes('\n@@ -')) {
				continue;
			}

			const lines = fileSection.split('\n');
			const firstLine = `diff --git ${lines[0]}`;
			const diffHeaderMatch = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
			if (!diffHeaderMatch) continue;

			const [, originalPath, newPath] = diffHeaderMatch;

			const hasRenameFrom = lines.some(line => line.startsWith('rename from '));
			const hasRenameTo = lines.some(line => line.startsWith('rename to '));

			if (hasRenameFrom && hasRenameTo) {
				const diffHeader = `${firstLine}\n${lines.slice(1).join('\n')}`;

				const similarityMatch = lines.find(line => line.startsWith('similarity index '))?.match(/(\d+)%/);
				const similarity = similarityMatch ? parseInt(similarityMatch[1], 10) : 100;

				const renameHunk: ComposerHunk = {
					index: 0, // Will be set by caller
					fileName: newPath,
					originalFileName: originalPath,
					diffHeader: diffHeader,
					hunkHeader: 'rename',
					content: `rename from ${originalPath}\nrename to ${newPath}\nsimilarity index ${similarity}%`,
					additions: 0,
					deletions: 0,
					source: source,
					assigned: false,
					isRename: true,
				};

				renameHunks.push(renameHunk);
			}
		}

		return renameHunks;
	}
}
