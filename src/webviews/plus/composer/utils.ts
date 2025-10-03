import { sha256 } from '@env/crypto';
import type { GitDiff, ParsedGitDiff } from '../../../git/models/diff';
import type { Repository } from '../../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../../git/models/revision';
import { parseGitDiff } from '../../../git/parsers/diffParser';
import { getSettledValue } from '../../../system/promise';
import type { ComposerCommit, ComposerHunk, ComposerSafetyState } from './protocol';

export function getHunksForCommit(commit: ComposerCommit, hunks: ComposerHunk[]): ComposerHunk[] {
	return hunks.filter(hunk => commit.hunkIndices.includes(hunk.index));
}

export function updateHunkAssignments(hunks: ComposerHunk[], commits: ComposerCommit[]): ComposerHunk[] {
	const assignedIndices = new Set<number>();
	for (const commit of commits) {
		for (const index of commit.hunkIndices) {
			assignedIndices.add(index);
		}
	}

	return hunks.map(hunk => ({ ...hunk, assigned: assignedIndices.has(hunk.index) }));
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
	const fileNames = new Set<string>(hunks.map(hunk => hunk.fileName));
	return [...fileNames];
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
	return getFileChanges(commitHunks);
}

export function groupHunksByFile(hunks: ComposerHunk[]): Map<string, ComposerHunk[]> {
	const fileMap = new Map<string, ComposerHunk[]>();
	for (const hunk of hunks) {
		let array = fileMap.get(hunk.fileName);
		if (array == null) {
			array = [];
			fileMap.set(hunk.fileName, array);
		}
		array.push(hunk);
	}
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

export function createCombinedDiffForCommit(hunks: ComposerHunk[]): {
	patch: string;
	filePatches: Map<string, string[]>;
} {
	if (hunks.length === 0) {
		return { patch: '', filePatches: new Map() };
	}

	// Group hunks by file (diffHeader)
	const filePatches = new Map<string, string[]>();
	for (const hunk of hunks) {
		const diffHeader = hunk.diffHeader || `diff --git a/${hunk.fileName} b/${hunk.fileName}`;

		let array = filePatches.get(diffHeader);
		if (array == null) {
			array = [];
			filePatches.set(diffHeader, array);
		}

		// For rename hunks, the content is already properly formatted
		// For regular hunks, we need to add the hunk header before the content
		if (hunk.isRename) {
			// For renames, the diffHeader already contains the rename info, just add empty content
			array.push('');
		} else {
			// Combine hunk header and content for regular hunks
			const hunkContent = `${hunk.hunkHeader}\n${hunk.content}`;
			array.push(hunkContent);
		}
	}

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
		const { patch, filePatches } = createCombinedDiffForCommit(getHunksForCommit(commit, hunks));

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

export function createHunksFromDiffs(stagedDiffContent?: string, unstagedDiffContent?: string): ComposerHunk[] {
	const allHunks: ComposerHunk[] = [];

	let count = 0;
	let hunks: ComposerHunk[] = [];

	if (stagedDiffContent) {
		const stagedDiff = parseGitDiff(stagedDiffContent);
		({ hunks, count } = convertDiffToComposerHunks(stagedDiff, 'staged', count));

		allHunks.push(...hunks);
	}

	if (unstagedDiffContent) {
		const unstagedDiff = parseGitDiff(unstagedDiffContent);
		({ hunks, count } = convertDiffToComposerHunks(unstagedDiff, 'unstaged', count));

		allHunks.push(...hunks);
	}

	return allHunks;
}

/** Converts @type {ParsedGitDiff} output to @type {ComposerHunk}'s */
function convertDiffToComposerHunks(
	diff: ParsedGitDiff,
	source: 'staged' | 'unstaged',
	startingCount: number,
): { hunks: ComposerHunk[]; count: number } {
	const hunks: ComposerHunk[] = [];
	let counter = startingCount;

	for (const file of diff.files) {
		// Handle files without hunks (renames, mode changes, binary files, etc.)
		if (!file.hunks.length) {
			const hunkIndex = ++counter;

			// Determine hunk header and content based on file metadata
			let hunkHeader: string;
			let content: string;

			if (file.metadata.binary) {
				hunkHeader = 'binary';
				content = 'Binary file';
			} else if (file.metadata.modeChanged) {
				hunkHeader = 'mode change';
				content = `Mode change from ${file.metadata.modeChanged.oldMode || '?'} to ${file.metadata.modeChanged.newMode || '?'}`;
			} else if (file.metadata.renamedOrCopied) {
				hunkHeader = 'rename';
				const similarity = file.metadata.renamedOrCopied?.similarity || 100;
				content = `Rename from ${file.originalPath}\nRename to ${file.path}\nSimilarity index ${similarity}%`;
			} else {
				hunkHeader = 'no-content-change';
				content = file.header.split('\n').slice(1).join('\n'); // Skip the diff --git line
			}

			const composerHunk: ComposerHunk = {
				index: hunkIndex,
				fileName: file.path,
				originalFileName: file.originalPath,
				diffHeader: file.header,
				hunkHeader: hunkHeader,
				content: content,
				additions: 0,
				deletions: 0,
				source: source,
				assigned: false,
				isRename: file.metadata.renamedOrCopied !== false,
			};

			hunks.push(composerHunk);
		} else {
			// Handle files with actual content hunks
			for (const hunk of file.hunks) {
				const hunkIndex = ++counter;

				// Calculate additions and deletions from the hunk content
				const { additions, deletions } = calculateHunkStats(hunk.content);

				const composerHunk: ComposerHunk = {
					index: hunkIndex,
					fileName: file.path,
					originalFileName: file.originalPath,
					diffHeader: file.header,
					hunkHeader: hunk.header,
					content: hunk.content,
					additions: additions,
					deletions: deletions,
					source: source,
					assigned: false,
					isRename: false,
				};

				hunks.push(composerHunk);
			}
		}
	}

	return { hunks: hunks, count: counter };
}

function calculateHunkStats(content: string): { additions: number; deletions: number } {
	const lines = content.split('\n');
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

/* Validation Utils */

/** Gets the current staged and unstaged diffs for safety validation */
export interface WorkingTreeDiffs {
	staged: GitDiff | undefined;
	unstaged: GitDiff | undefined;
	unified: GitDiff | undefined;
}

export async function getWorkingTreeDiffs(repo: Repository): Promise<WorkingTreeDiffs> {
	const [stagedDiffResult, unstagedDiffResult, unifiedDiffResult] = await Promise.allSettled([
		// Get staged diff (index vs HEAD)
		repo.git.diff.getDiff?.(uncommittedStaged),
		// Get unstaged diff (working tree vs index)
		repo.git.diff.getDiff?.(uncommitted),
		// Get unified diff (working tree vs HEAD)
		repo.git.diff.getDiff?.(uncommitted, 'HEAD', { notation: '...' }),
	]);

	return {
		staged: getSettledValue(stagedDiffResult),
		unstaged: getSettledValue(unstagedDiffResult),
		unified: getSettledValue(unifiedDiffResult),
	};
}

/**
 * Creates a safety state snapshot for the composer to validate against later
 */
export async function createSafetyState(
	repo: Repository,
	diffs: WorkingTreeDiffs,
	headSha: string,
): Promise<ComposerSafetyState> {
	if (!headSha) {
		throw new Error('Cannot create safety state: no HEAD commit found');
	}

	return {
		repoPath: repo.path,
		headSha: headSha,
		hashes: {
			staged: diffs.staged?.contents ? await sha256(diffs.staged.contents) : null,
			unstaged: diffs.unstaged?.contents ? await sha256(diffs.unstaged.contents) : null,
			unified: diffs.unified?.contents ? await sha256(diffs.unified.contents) : null,
		},
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

		// 2. Smart diff validation - only check diffs for sources being committed
		if (hunksBeingCommitted?.length) {
			const { staged, unstaged /*, unified*/ } = await getWorkingTreeDiffs(repo);

			const hashes = {
				staged: staged?.contents ? await sha256(staged.contents) : null,
				unstaged: unstaged?.contents ? await sha256(unstaged.contents) : null,
				// unified: unified?.contents ? await sha256(unified.contents) : null,
			};

			// Check if any hunks from staged source are being committed
			const hasStagedHunks = hunksBeingCommitted.some(h => h.source === 'staged');
			if (hasStagedHunks && hashes.staged !== safetyState.hashes.staged) {
				errors.push('Staged changes have been modified since composer opened');
			}

			// Check if any hunks from unstaged source are being committed
			const hasUnstagedHunks = hunksBeingCommitted.some(h => h.source === 'unstaged');
			if (hasUnstagedHunks && hashes.unstaged !== safetyState.hashes.unstaged) {
				errors.push('Unstaged changes have been modified since composer opened');
			}
		}

		return { isValid: !errors.length, errors: errors };
	} catch (ex) {
		errors.push(`Failed to validate repository state: ${ex instanceof Error ? ex.message : 'Unknown error'}`);
		return { isValid: false, errors: errors };
	}
}

/** Validates resulting output diff against input diff, based on whether unstaged changes are included or not */
export function validateResultingDiff(
	safetyState: ComposerSafetyState,
	diffHash: string,
	includeUnstagedChanges: boolean,
): boolean {
	const { hashes } = safetyState;
	return diffHash === (includeUnstagedChanges ? hashes.unified : hashes.staged);
}
