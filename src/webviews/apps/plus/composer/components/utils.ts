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
 * Combines hunks assigned to a commit into a single diff string and file patches map
 * @param commit The commit containing hunk indices
 * @param hunks Array of all available hunks
 * @returns Object containing the combined diff string and file patches map
 */
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

/**
 * Converts composer commits and hunks to ComposerDiffInfo format for the rebase infrastructure
 * @param commits Array of composer commits
 * @param hunks Array of all available hunks
 * @returns Array of ComposerDiffInfo objects ready for createUnreachableCommitsFromPatches
 */
export function convertToComposerDiffInfo(
	commits: ComposerCommit[],
	hunks: ComposerHunk[],
): Array<{ message: string; explanation?: string; filePatches: Map<string, string[]>; patch: string }> {
	return commits.map(commit => {
		// Use the consolidated createCombinedDiffForCommit function
		const { patch, filePatches } = createCombinedDiffForCommit(commit, hunks);

		return {
			message: commit.message,
			explanation: commit.aiExplanation,
			filePatches: filePatches,
			patch: patch,
		};
	});
}

/**
 * Generates markdown content for composer commits
 * @param commits Array of composer commits
 * @param hunks Array of all hunks
 * @param title Title for the markdown document
 * @returns Markdown content string
 */
export function generateComposerMarkdown(
	commits: ComposerCommit[],
	hunks: ComposerHunk[],
	title = 'Generated Commits',
): string {
	if (!commits.length) {
		return `# ${title}\n\nNo commits generated.`;
	}

	let markdown = `# ${title}\n\n`;
	markdown += "Here's the breakdown of the commits created from the provided changes:\n\n";

	// Add explanations section
	markdown += '## Commit Explanations\n\n';
	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];
		const commitTitle = `### Commit ${i + 1}: ${commit.message}`;

		if (commit.aiExplanation) {
			markdown += `${commitTitle}\n\n${commit.aiExplanation}\n\n`;
		} else {
			markdown += `${commitTitle}\n\nNo explanation provided.\n\n`;
		}
	}

	// Add changes section
	markdown += '## Changes\n\n';
	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];
		const commitTitle = `### Commit ${i + 1}: ${commit.message}`;
		markdown += `${commitTitle}\n\n`;

		// Get hunks for this commit
		const commitHunks = commit.hunkIndices
			.map(index => hunks.find(hunk => hunk.index === index))
			.filter((hunk): hunk is ComposerHunk => hunk !== undefined);

		if (commitHunks.length === 0) {
			markdown += 'No changes in this commit.\n\n';
			continue;
		}

		// Group hunks by file
		const fileGroups = new Map<string, ComposerHunk[]>();
		commitHunks.forEach(hunk => {
			const fileName = hunk.fileName;
			if (!fileGroups.has(fileName)) {
				fileGroups.set(fileName, []);
			}
			fileGroups.get(fileName)!.push(hunk);
		});

		// Output each file with its changes
		for (const [_fileName, fileHunks] of fileGroups.entries()) {
			markdown += '```diff\n';

			// Use the first hunk's diff header for the file
			const firstHunk = fileHunks[0];
			if (firstHunk.isRename) {
				// For renames, show the rename information
				markdown += `${firstHunk.diffHeader}\n`;
			} else {
				// For regular files, show the diff header
				markdown += `${firstHunk.diffHeader}\n`;

				// Add each hunk's content
				for (const hunk of fileHunks) {
					markdown += `${hunk.hunkHeader}\n`;
					markdown += `${hunk.content}\n`;
				}
			}

			markdown += '```\n\n';
		}
	}

	return markdown;
}
