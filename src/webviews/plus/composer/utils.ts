import type { ComposerCommit, ComposerHunk } from './protocol';

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
	hunks: ComposerHunk[],
	title = 'Generated Commits',
): string {
	if (!commits.length) {
		return `# ${title}\n\nNo commits generated.`;
	}

	let markdown = `# ${title}\n\n`;
	markdown += "Here's the breakdown of the commits created from the provided changes:\n\n";

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

	markdown += '## Changes\n\n';
	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];
		const commitTitle = `### Commit ${i + 1}: ${commit.message}`;
		markdown += `${commitTitle}\n\n`;

		const commitHunks = commit.hunkIndices
			.map(index => hunks.find(hunk => hunk.index === index))
			.filter((hunk): hunk is ComposerHunk => hunk !== undefined);

		if (commitHunks.length === 0) {
			markdown += 'No changes in this commit.\n\n';
			continue;
		}

		const fileGroups = new Map<string, ComposerHunk[]>();
		commitHunks.forEach(hunk => {
			const fileName = hunk.fileName;
			if (!fileGroups.has(fileName)) {
				fileGroups.set(fileName, []);
			}
			fileGroups.get(fileName)!.push(hunk);
		});

		for (const [, fileHunks] of fileGroups.entries()) {
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
