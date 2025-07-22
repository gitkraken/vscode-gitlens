import type { ComposerCommit, ComposerHunk } from '../../../../plus/composer/protocol';

/**
 * Gets all hunks that belong to a specific commit
 */
export function getHunksForCommit(commit: ComposerCommit, hunks: ComposerHunk[]): ComposerHunk[] {
	return hunks.filter(hunk => commit.hunkIndices.includes(hunk.index));
}

/**
 * Updates the assigned property on all hunks based on commit assignments
 */
export function updateHunkAssignments(hunks: ComposerHunk[], commits: ComposerCommit[]): ComposerHunk[] {
	// Get all assigned hunk indices
	const assignedIndices = new Set<number>();
	commits.forEach(commit => {
		commit.hunkIndices.forEach(index => assignedIndices.add(index));
	});

	// Update assigned property on hunks
	return hunks.map(hunk => ({
		...hunk,
		assigned: assignedIndices.has(hunk.index),
	}));
}

/**
 * Gets unassigned hunks grouped by source type
 */
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

/**
 * Checks if there are any unassigned hunks
 */
export function hasUnassignedHunks(hunks: ComposerHunk[]): boolean {
	return hunks.some(hunk => !hunk.assigned);
}

/**
 * Gets unique file names from a list of hunks
 */
export function getUniqueFileNames(hunks: ComposerHunk[]): string[] {
	const fileNames = new Set<string>();
	hunks.forEach(hunk => fileNames.add(hunk.fileName));
	return Array.from(fileNames);
}

/**
 * Gets file count for a commit
 */
export function getFileCountForCommit(commit: ComposerCommit, hunks: ComposerHunk[]): number {
	const commitHunks = getHunksForCommit(commit, hunks);
	return getUniqueFileNames(commitHunks).length;
}

/**
 * Gets total additions and deletions for a commit
 */
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

/**
 * Groups hunks by file name
 */
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

/**
 * Gets file changes (additions/deletions) for a specific file
 */
export function getFileChanges(hunks: ComposerHunk[]): { additions: number; deletions: number } {
	return hunks.reduce(
		(total, hunk) => ({
			additions: total.additions + hunk.additions,
			deletions: total.deletions + hunk.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
}

/**
 * Combines hunks assigned to a commit into a single diff string
 * @param commit The commit containing hunk indices
 * @param hunks Array of all available hunks
 * @returns A valid git diff string combining all hunks for the commit
 */
export function createCombinedDiffForCommit(commit: ComposerCommit, hunks: ComposerHunk[]): string {
	// Get hunks for this commit
	const commitHunks = commit.hunkIndices
		.map(index => hunks.find(hunk => hunk.index === index))
		.filter((hunk): hunk is ComposerHunk => hunk !== undefined);

	if (commitHunks.length === 0) {
		return '';
	}

	// Group hunks by file (diffHeader)
	const hunksByFile = new Map<string, ComposerHunk[]>();
	commitHunks.forEach(hunk => {
		const diffHeader = hunk.diffHeader || `diff --git a/${hunk.fileName} b/${hunk.fileName}`;
		if (!hunksByFile.has(diffHeader)) {
			hunksByFile.set(diffHeader, []);
		}
		hunksByFile.get(diffHeader)!.push(hunk);
	});

	// Build the combined diff string
	const diffParts: string[] = [];

	for (const [diffHeader, fileHunks] of hunksByFile) {
		// Add the diff header for this file
		diffParts.push(diffHeader);

		// Add each hunk for this file
		fileHunks.forEach(hunk => {
			diffParts.push(hunk.hunkHeader);
			diffParts.push(hunk.content);
		});
	}

	// Join with appropriate newlines to create a valid diff
	return diffParts.join('\n');
}
