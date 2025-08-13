import type { Repository } from '../../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../../git/models/revision';
import type { ComposerCommit, ComposerHunk, ComposerHunkMap, ComposerSafetyState } from './protocol';

export function getHunksForCommit(commit: ComposerCommit, hunks: ComposerHunk[]): ComposerHunk[] {
	return hunks.filter(hunk => commit.hunkIndices.includes(hunk.index));
}

export function updateHunkAssignments(hunks: ComposerHunk[], commits: ComposerCommit[]): ComposerHunk[] {
	const assignedIndices = new Set<number>();
	commits.forEach(commit => {
		commit.hunkIndices.forEach(index => assignedIndices.add(index));
	});

	return hunks.map(hunk => ({
		...hunk,
		assigned: assignedIndices.has(hunk.index),
	}));
}

export function getUnassignedHunks(hunks: ComposerHunk[]): {
	staged: ComposerHunk[];
	unstaged: ComposerHunk[];
	unassigned: ComposerHunk[];
} {
	const unassignedHunks = hunks.filter(hunk => !hunk.assigned);

	return {
		staged: unassignedHunks.filter(hunk => hunk.source === 'staged'),
		unstaged: unassignedHunks.filter(hunk => hunk.source === 'unstaged'),
		unassigned: unassignedHunks.filter(
			hunk => hunk.source === 'commits' || (hunk.source !== 'staged' && hunk.source !== 'unstaged'),
		),
	};
}

export function hasUnassignedHunks(hunks: ComposerHunk[]): boolean {
	return hunks.some(hunk => !hunk.assigned);
}

export function getUniqueFileNames(hunks: ComposerHunk[]): string[] {
	const fileNames = new Set<string>();
	hunks.forEach(hunk => fileNames.add(hunk.fileName));
	return Array.from(fileNames);
}

export function getFileCountForCommit(commit: ComposerCommit, hunks: ComposerHunk[]): number {
	const commitHunks = getHunksForCommit(commit, hunks);
	return getUniqueFileNames(commitHunks).length;
}

export function getCommitChanges(
	commit: ComposerCommit,
	hunks: ComposerHunk[],
): { additions: number; deletions: number } {
	const commitHunks = getHunksForCommit(commit, hunks);
	return commitHunks.reduce(
		(total, hunk) => ({
			additions: total.additions + hunk.additions,
			deletions: total.deletions + hunk.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
}

export function groupHunksByFile(hunks: ComposerHunk[]): Map<string, ComposerHunk[]> {
	const fileMap = new Map<string, ComposerHunk[]>();
	hunks.forEach(hunk => {
		if (!fileMap.has(hunk.fileName)) {
			fileMap.set(hunk.fileName, []);
		}
		fileMap.get(hunk.fileName)!.push(hunk);
	});
	return fileMap;
}

export function getFileChanges(hunks: ComposerHunk[]): { additions: number; deletions: number } {
	return hunks.reduce(
		(total, hunk) => ({
			additions: total.additions + hunk.additions,
			deletions: total.deletions + hunk.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
}

export function createCombinedDiffForCommit(
	commit: ComposerCommit,
	hunks: ComposerHunk[],
): { patch: string; filePatches: Map<string, string[]> } {
	// Get hunks for this commit
	const commitHunks = commit.hunkIndices
		.map(index => hunks.find(hunk => hunk.index === index))
		.filter((hunk): hunk is ComposerHunk => hunk !== undefined);

	if (commitHunks.length === 0) {
		return { patch: '', filePatches: new Map() };
	}

	// Group hunks by file (diffHeader)
	const filePatches = new Map<string, string[]>();
	commitHunks.forEach(hunk => {
		const diffHeader = hunk.diffHeader || `diff --git a/${hunk.fileName} b/${hunk.fileName}`;
		if (!filePatches.has(diffHeader)) {
			filePatches.set(diffHeader, []);
		}

		// For rename hunks, the content is already properly formatted
		// For regular hunks, we need to add the hunk header before the content
		if (hunk.isRename) {
			// For renames, the diffHeader already contains the rename info, just add empty content
			filePatches.get(diffHeader)!.push('');
		} else {
			// Combine hunk header and content for regular hunks
			const hunkContent = `${hunk.hunkHeader}\n${hunk.content}`;
			filePatches.get(diffHeader)!.push(hunkContent);
		}
	});

	// Build the complete patch string
	let commitPatch = '';
	for (const [header, hunkContents] of filePatches.entries()) {
		commitPatch += `${header.trim()}\n`;
		// Only add hunk contents if they exist (renames might have empty content)
		const nonEmptyContents = hunkContents.filter(content => content.trim() !== '');
		if (nonEmptyContents.length > 0) {
			commitPatch += `${nonEmptyContents.join('\n')}\n`;
		}
	}

	return { patch: commitPatch, filePatches: filePatches };
}

export function convertToComposerDiffInfo(
	commits: ComposerCommit[],
	hunks: ComposerHunk[],
): Array<{ message: string; explanation?: string; filePatches: Map<string, string[]>; patch: string }> {
	return commits.map(commit => {
		const { patch, filePatches } = createCombinedDiffForCommit(commit, hunks);

		return {
			message: commit.message,
			explanation: commit.aiExplanation,
			filePatches: filePatches,
			patch: patch,
		};
	});
}

export function generateComposerMarkdown(
	commits: ComposerCommit[],
	_hunks: ComposerHunk[],
	title = 'Generated Commits',
): string {
	if (!commits.length) {
		return `# ${title}\n\nNo commits generated.`;
	}

	let markdown = `# ${title}\n\n`;
	markdown +=
		"Here's the breakdown of the commits created from the provided changes, along with explanations for each:\n\n";
	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];
		const commitTitle = `### Commit ${i + 1}: ${commit.message}`;

		if (commit.aiExplanation) {
			markdown += `${commitTitle}\n\n${commit.aiExplanation}\n\n`;
		} else {
			markdown += `${commitTitle}\n\nNo explanation provided.\n\n`;
		}
	}

	return markdown;
}

export function createHunksFromDiffs(
	stagedDiffContent?: string,
	unstagedDiffContent?: string,
): { hunkMap: ComposerHunkMap[]; hunks: ComposerHunk[] } {
	const hunkMap: ComposerHunkMap[] = [];
	const hunks: ComposerHunk[] = [];
	let counter = 0;

	if (stagedDiffContent) {
		processHunksFromDiff(stagedDiffContent, 'staged', counter, hunkMap, hunks);
		counter = hunkMap.length;
	}

	if (unstagedDiffContent) {
		processHunksFromDiff(unstagedDiffContent, 'unstaged', counter, hunkMap, hunks);
	}

	return { hunkMap: hunkMap, hunks: hunks };
}

function processHunksFromDiff(
	diffContent: string,
	source: 'staged' | 'unstaged',
	startCounter: number,
	hunkMap: ComposerHunkMap[],
	hunks: ComposerHunk[],
): void {
	let counter = startCounter;

	const renameHunks = extractRenameHunks(diffContent, source);
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

		const hunk = extractHunkFromDiff(diffContent, hunkHeader, hunkIndex, source);
		if (hunk) {
			hunks.push(hunk);
		}
	}
}

function extractHunkFromDiff(
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

	const hunkContent = extractHunkContent(diffContent, diffHeader, hunkHeader);
	if (!hunkContent) return null;

	const { additions, deletions } = calculateHunkStats(hunkContent);

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

function extractHunkContent(diffContent: string, diffHeader: string, hunkHeader: string): string | null {
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

function calculateHunkStats(hunkContent: string): { additions: number; deletions: number } {
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

function extractRenameHunks(diffContent: string, source: 'staged' | 'unstaged'): ComposerHunk[] {
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

/* Validation Utils */

/**
 * Gets the current staged and unstaged diffs for safety validation
 */
export async function getCurrentDiffsForValidation(
	repo: Repository,
): Promise<{ stagedDiff: string | null; unstagedDiff: string | null; unifiedDiff: string | null }> {
	try {
		// Get staged diff (index vs HEAD)
		const stagedDiff = await repo.git.diff.getDiff?.(uncommittedStaged);

		// Get unstaged diff (working tree vs index)
		const unstagedDiff = await repo.git.diff.getDiff?.(uncommitted);

		const unifiedDiff = await repo.git.diff.getDiff?.(uncommitted, 'HEAD', { notation: '...' });

		return {
			stagedDiff: stagedDiff?.contents || null,
			unstagedDiff: unstagedDiff?.contents || null,
			unifiedDiff: unifiedDiff?.contents || null,
		};
	} catch {
		// If we can't get diffs, return nulls
		return {
			stagedDiff: null,
			unstagedDiff: null,
			unifiedDiff: null,
		};
	}
}

/**
 * Creates a safety state snapshot for the composer to validate against later
 */
export async function createSafetyState(repo: Repository): Promise<ComposerSafetyState> {
	const currentBranch = await repo.git.branches.getBranch();
	const headCommit = await repo.git.commits.getCommit('HEAD');

	// Get current worktree information
	const worktrees = await repo.git.worktrees?.getWorktrees();
	const currentWorktree = worktrees?.find(wt => wt.branch?.id === currentBranch?.id);

	// Get current diffs for validation
	const { stagedDiff, unstagedDiff, unifiedDiff } = await getCurrentDiffsForValidation(repo);

	if (!currentBranch?.name) {
		throw new Error('Cannot create safety state: no current branch found');
	}
	if (!currentBranch?.sha) {
		throw new Error('Cannot create safety state: no current branch SHA found');
	}
	if (!headCommit?.sha) {
		throw new Error('Cannot create safety state: no HEAD commit found');
	}
	if (!currentWorktree?.name) {
		throw new Error('Cannot create safety state: no current worktree found');
	}

	return {
		repoPath: repo.path,
		headSha: headCommit.sha,
		branchName: currentBranch.name,
		branchRefSha: currentBranch.sha,
		worktreeName: currentWorktree.name,
		stagedDiff: stagedDiff,
		unstagedDiff: unstagedDiff,
		unifiedDiff: unifiedDiff,
		timestamp: Date.now(),
	};
}

/**
 * Validates current repository state against the captured safety state.
 * Only validates diffs for sources that have hunks being committed.
 */
export async function validateSafetyState(
	repo: Repository,
	safetyState: ComposerSafetyState,
	hunksBeingCommitted?: ComposerHunk[],
): Promise<{ isValid: boolean; errors: string[] }> {
	const errors: string[] = [];

	try {
		// 1. Check repository path
		if (repo.path !== safetyState.repoPath) {
			errors.push(`Repository path changed from "${safetyState.repoPath}" to "${repo.path}"`);
		}

		// 2. Check HEAD SHA
		const currentHeadCommit = await repo.git.commits.getCommit('HEAD');
		const currentHeadSha = currentHeadCommit?.sha ?? 'unknown';
		if (currentHeadSha !== safetyState.headSha) {
			errors.push(`HEAD commit changed from "${safetyState.headSha}" to "${currentHeadSha}"`);
		}

		// 3. Check current branch
		const currentBranch = await repo.git.branches.getBranch();
		const currentBranchName = currentBranch?.name;
		if (!currentBranchName) {
			errors.push('Current branch could not be determined');
		} else if (currentBranchName !== safetyState.branchName) {
			errors.push(`Branch changed from "${safetyState.branchName}" to "${currentBranchName}"`);
		}

		// 4. Check branch ref SHA
		const currentBranchSha = currentBranch?.sha;
		if (!currentBranchSha) {
			errors.push('Current branch SHA could not be determined');
		} else if (currentBranchSha !== safetyState.branchRefSha) {
			errors.push(`Branch ref changed from "${safetyState.branchRefSha}" to "${currentBranchSha}"`);
		}

		// 5. Check worktree state
		const worktrees = await repo.git.worktrees?.getWorktrees();
		const currentWorktree = worktrees?.find(wt => wt.branch?.id === currentBranch?.id);
		const currentWorktreeName = currentWorktree?.name ?? 'main';
		if (currentWorktreeName !== safetyState.worktreeName) {
			errors.push(`Worktree changed from "${safetyState.worktreeName}" to "${currentWorktreeName}"`);
		}

		// 6. Smart diff validation - only check diffs for sources being committed
		if (hunksBeingCommitted && hunksBeingCommitted.length > 0) {
			const { stagedDiff, unstagedDiff } = await getCurrentDiffsForValidation(repo);

			// Check if any hunks from staged source are being committed
			const hasStagedHunks = hunksBeingCommitted.some(h => h.source === 'staged');
			if (hasStagedHunks && stagedDiff !== safetyState.stagedDiff) {
				errors.push('Staged changes have been modified since composer opened');
			}

			// Check if any hunks from unstaged source are being committed
			const hasUnstagedHunks = hunksBeingCommitted.some(h => h.source === 'unstaged');
			if (hasUnstagedHunks && unstagedDiff !== safetyState.unstagedDiff) {
				errors.push('Unstaged changes have been modified since composer opened');
			}
		}

		return {
			isValid: errors.length === 0,
			errors: errors,
		};
	} catch (error) {
		errors.push(`Failed to validate repository state: ${error instanceof Error ? error.message : 'Unknown error'}`);
		return {
			isValid: false,
			errors: errors,
		};
	}
}

/** Validates combined output diff against input diff, based on whether unstaged changes are included or not */
export function validateCombinedDiff(
	safetyState: ComposerSafetyState,
	combinedDiff: string,
	includeUnstagedChanges: boolean,
): boolean {
	try {
		const { stagedDiff, unifiedDiff } = safetyState;

		if (includeUnstagedChanges) {
			return combinedDiff === unifiedDiff;
		}

		return combinedDiff === stagedDiff;
	} catch {
		return false;
	}
}
