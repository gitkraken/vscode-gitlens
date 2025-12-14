import { sha256 } from '@env/crypto';
import type { Container } from '../../../../container';
import type { GitCommit, GitCommitIdentityShape } from '../../../../git/models/commit';
import type { GitDiff, ParsedGitDiff } from '../../../../git/models/diff';
import type { Repository } from '../../../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../../../git/models/revision';
import { parseGitDiff } from '../../../../git/parsers/diffParser';
import { getSettledValue } from '../../../../system/promise';
import type { ComposerCommit, ComposerHunk, ComposerSafetyState } from '../protocol';

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

// Given a group of hunks assigned to a single commit, each with their own author and co-authors, determine a single author and co-authors list for the commit
// based on the amount of changes made by each author, measured in additions + deletions
function getAuthorAndCoAuthorsForCommit(commitHunks: ComposerHunk[]): {
	author: GitCommitIdentityShape | undefined;
	coAuthors: GitCommitIdentityShape[];
} {
	// Each hunk may or may not have an author. Determine the primary author based on the hunk with the largest diff, then assign the rest as co-authors.
	// If there is a tie for largest diff, use the first one.
	const authorContributionWeights = new Map<string, number>();
	const coAuthors = new Map<string, GitCommitIdentityShape>();
	for (const hunk of commitHunks) {
		if (hunk.author == null) continue;
		coAuthors.set(hunk.author.name, hunk.author);
		hunk.coAuthors?.forEach(coAuthor => coAuthors.set(coAuthor.name, coAuthor));
		authorContributionWeights.set(
			hunk.author.name,
			(authorContributionWeights.get(hunk.author.name) ?? 0) + hunk.additions + hunk.deletions,
		);
	}

	let primary: GitCommitIdentityShape | undefined;
	let primaryScore = 0;
	for (const [author, score] of authorContributionWeights.entries()) {
		if (primary == null || score > primaryScore) {
			primary = coAuthors.get(author);
			primaryScore = score;
		}
	}

	// Remove the primary author from the co-authors, if present
	if (primary != null) {
		coAuthors.delete(primary.name);
	}

	return { author: primary, coAuthors: [...coAuthors.values()] };
}

function overlap(range1: { start: number; count: number }, range2: { start: number; count: number }): number {
	const end1 = range1.start + range1.count;
	const end2 = range2.start + range2.count;
	const overlapStart = Math.max(range1.start, range2.start);
	const overlapEnd = Math.min(end1, end2);
	return Math.max(0, overlapEnd - overlapStart);
}

// Calculates a similarity score between two hunks that touch the same file, based on the overlap between the lines in their hunk headers
function getHunkSimilarityValue(hunk1: ComposerHunk, hunk2: ComposerHunk): number {
	const oldRange1 = hunk1.hunkHeader.match(/@@ -(\d+),(\d+)/);
	const newRange1 = hunk1.hunkHeader.match(/@@ -\d+,\d+ \+(\d+),(\d+)/);
	const oldRange2 = hunk2.hunkHeader.match(/@@ -(\d+),(\d+)/);
	const newRange2 = hunk2.hunkHeader.match(/@@ -\d+,\d+ \+(\d+),(\d+)/);
	if (oldRange1 == null || newRange1 == null || oldRange2 == null || newRange2 == null) {
		return 0;
	}
	return (
		overlap(
			{ start: parseInt(oldRange1[1], 10), count: parseInt(oldRange1[2], 10) },
			{ start: parseInt(oldRange2[1], 10), count: parseInt(oldRange2[2], 10) },
		) +
		overlap(
			{ start: parseInt(newRange1[1], 10), count: parseInt(newRange1[2], 10) },
			{ start: parseInt(newRange2[1], 10), count: parseInt(newRange2[2], 10) },
		)
	);
}

// Given an array of hunks representing commit history between two commits, and a hunk from their combined diff, determine the author and co-authors of the
// combined diff hunk based on similarity to the commit hunks
export function getAuthorAndCoAuthorsForCombinedDiffHunk(
	commitHunks: ComposerHunk[],
	combinedDiffHunk: ComposerHunk,
): { author: GitCommitIdentityShape | undefined; coAuthors: GitCommitIdentityShape[] } {
	const matches = commitHunks.filter(commitHunk => {
		return (
			commitHunk.author != null &&
			commitHunk.fileName === combinedDiffHunk.fileName &&
			(!combinedDiffHunk.isRename || commitHunk.isRename === combinedDiffHunk.isRename)
		);
	});

	const similarityByHunkAuthor = new Map<string, number>();
	const coAuthors = new Map<string, GitCommitIdentityShape>();
	let maxSimilarity = 0;
	let primaryAuthor: GitCommitIdentityShape | undefined;
	for (const commitHunk of matches) {
		coAuthors.set(commitHunk.author!.name, commitHunk.author!);
		commitHunk.coAuthors?.forEach(coAuthor => coAuthors.set(coAuthor.name, coAuthor));
		let similarity = getHunkSimilarityValue(commitHunk, combinedDiffHunk);
		if (similarityByHunkAuthor.has(commitHunk.author!.name)) {
			similarity += similarityByHunkAuthor.get(commitHunk.author!.name)!;
		}

		similarityByHunkAuthor.set(commitHunk.author!.name, similarity);
		if (primaryAuthor == null || similarity > maxSimilarity) {
			maxSimilarity = similarity;
			primaryAuthor = commitHunk.author;
		}
	}

	// Remove the primary author from the co-authors, if present
	if (primaryAuthor != null) {
		coAuthors.delete(primaryAuthor.name);
	}

	return { author: primaryAuthor, coAuthors: [...coAuthors.values()] };
}

export function convertToComposerDiffInfo(
	commits: ComposerCommit[],
	hunks: ComposerHunk[],
): Array<{
	message: string;
	explanation?: string;
	filePatches: Map<string, string[]>;
	patch: string;
	author?: GitCommitIdentityShape;
}> {
	return commits.map(commit => {
		const { patch, filePatches } = createCombinedDiffForCommit(getHunksForCommit(commit, hunks));
		const commitHunks = getHunksForCommit(commit, hunks);
		const { author, coAuthors } = getAuthorAndCoAuthorsForCommit(commitHunks);
		let message = commit.message.content;
		if (coAuthors.length > 0) {
			message += `\n${coAuthors.map(a => `\nCo-authored-by: ${a.name} <${a.email}>`).join()}`;
		}

		return {
			message: message,
			explanation: commit.aiExplanation,
			filePatches: filePatches,
			patch: patch,
			author: author,
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
		const commitTitle = `### Commit ${i + 1}: ${commit.message.content}`;

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
	source: 'staged' | 'unstaged' | 'commits',
	startingCount: number,
	author?: GitCommitIdentityShape,
	coAuthors?: GitCommitIdentityShape[],
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
				author: author,
				coAuthors: coAuthors,
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
					author: author,
					coAuthors: coAuthors,
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
export interface ComposerDiffs {
	staged: GitDiff | undefined;
	unstaged: GitDiff | undefined;
	commits: GitDiff | undefined;
	unified: GitDiff | undefined;
}

export async function getComposerDiffs(
	repo: Repository,
	commits?: { baseSha: string; headSha: string },
): Promise<ComposerDiffs | undefined> {
	if (commits) {
		const commitDiffs = await calculateCombinedDiffBetweenCommits(repo, commits.baseSha, commits.headSha);

		return {
			staged: undefined,
			unstaged: undefined,
			commits: commitDiffs,
			unified: commitDiffs,
		};
	}
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
		commits: undefined,
	};
}

/**
 * Creates a safety state snapshot for the composer to validate against later
 */
export async function createSafetyState(
	repo: Repository,
	diffs: ComposerDiffs,
	baseSha?: string,
	headSha?: string,
	branchName?: string,
): Promise<ComposerSafetyState> {
	return {
		repoPath: repo.path,
		headSha: headSha ?? null,
		baseSha: baseSha ?? null,
		branchName: branchName,
		hashes: {
			staged: diffs.staged?.contents ? await sha256(diffs.staged.contents) : null,
			unstaged: diffs.unstaged?.contents ? await sha256(diffs.unstaged.contents) : null,
			unified: diffs.unified?.contents ? await sha256(diffs.unified.contents) : null,
			commits: diffs.commits?.contents ? await sha256(diffs.commits.contents) : null,
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
	diffs?: ComposerDiffs,
): Promise<{ isValid: boolean; errors: string[] }> {
	const errors: string[] = [];

	try {
		// 1. Check repository path
		if (repo.path !== safetyState.repoPath) {
			errors.push(`Repository path changed from "${safetyState.repoPath}" to "${repo.path}"`);
		}

		// 2. Check HEAD SHA
		if (safetyState.branchName) {
			const branch = await repo.git.branches.getBranch(safetyState.branchName);
			if (branch?.sha !== safetyState.headSha) {
				errors.push(`HEAD commit changed from "${safetyState.headSha}" to "${branch?.sha}"`);
			}
		} else {
			const currentHeadCommit = await repo.git.commits.getCommit('HEAD');
			const currentHeadCommitSha = currentHeadCommit?.sha ?? null;
			if (currentHeadCommitSha !== safetyState.baseSha) {
				errors.push(`HEAD commit changed from "${safetyState.baseSha}" to "${currentHeadCommitSha}"`);
			}
		}

		// 2. Smart diff validation - only check diffs for sources being committed
		if (hunksBeingCommitted?.length) {
			// Check if this is branch mode (has commits hash)
			if (safetyState.hashes.commits) {
				if (safetyState.baseSha === null) {
					return { isValid: false, errors: ['Base commit is null'] };
				}

				if (safetyState.headSha === null) {
					return { isValid: false, errors: ['Head commit is null'] };
				}

				const combinedDiff = await calculateCombinedDiffBetweenCommits(
					repo,
					safetyState.baseSha,
					safetyState.headSha,
				);
				if (!combinedDiff?.contents) {
					return { isValid: false, errors: ['Failed to calculate combined diff'] };
				}

				if ((await sha256(combinedDiff.contents)) !== safetyState.hashes.commits) {
					errors.push('Branch changes have been modified since composer opened');
				}
			} else {
				// Working directory mode: validate staged/unstaged changes
				const { staged, unstaged /*, unified*/ } = diffs ??
					(await getComposerDiffs(repo)) ?? { staged: undefined, unstaged: undefined, unified: undefined };

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

	if (hashes.commits) {
		return diffHash === hashes.commits;
	}

	// Working directory mode: validate against staged/unified hash
	return diffHash === (includeUnstagedChanges ? hashes.unified : hashes.staged);
}

/**
 * Gets commits that are unique to a branch by finding the merge base and getting commits between branch head and merge base
 */
export async function getBranchCommits(
	_container: Container,
	repo: Repository,
	branchName: string,
	mergeTargetName?: string,
): Promise<{ commits: GitCommit[]; baseCommit: { sha: string; message: string }; headCommitSha: string } | undefined> {
	try {
		// Get the branch
		const branch = await repo.git.branches.getBranch(branchName);
		if (!branch) {
			return undefined;
		}

		// Get the merge target branch
		let baseBranch;
		if (mergeTargetName) {
			baseBranch = await repo.git.branches.getBranch(mergeTargetName);
		}

		if (!baseBranch) {
			return undefined;
		}

		// Get the merge base between the branch and its target
		const mergeBase = await repo.git.refs.getMergeBase(branch.ref, baseBranch.ref);
		if (!mergeBase) {
			return undefined;
		}
		// Get the base commit from the merge base
		const baseCommit = await repo.git.commits.getCommit(mergeBase);
		if (!baseCommit) {
			return undefined;
		}

		// Get commits between merge base and branch head (excluding merge base)
		const log = await repo.git.commits.getLog(`${baseBranch.ref}..${branch.ref}`, { limit: 0 });
		if (!log?.commits?.size) {
			return undefined;
		}

		// Convert Map to Array and keep in reverse chronological order (newest first, then reverse to oldest first for processing)
		const commits = Array.from(log.commits.values()).reverse();
		const headCommit = commits[commits.length - 1];

		return {
			commits: commits,
			baseCommit: {
				sha: baseCommit.sha,
				message: baseCommit.message ?? '',
			},
			headCommitSha: headCommit?.sha ?? branch.sha,
		};
	} catch {
		return undefined;
	}
}

export function parseCoAuthorsFromGitCommit(commit: GitCommit): GitCommitIdentityShape[] {
	const coAuthors: GitCommitIdentityShape[] = [];
	if (!commit.message) return coAuthors;

	const coAuthorRegex = /^Co-authored-by:\s*(.+?)(?:\s*<(.+?)>)?\s*$/gm;
	let match;
	while ((match = coAuthorRegex.exec(commit.message)) !== null) {
		const [, name, email] = match;
		if (name) {
			coAuthors.push({ name: name.trim(), email: email?.trim(), date: commit.date });
		}
	}

	return coAuthors;
}

/**
 * Creates ComposerCommit array from existing branch commits, preserving order and mapping hunks correctly
 */
export async function createComposerCommitsFromGitCommits(
	repo: Repository,
	commits: GitCommit[],
): Promise<{ commits: ComposerCommit[]; hunks: ComposerHunk[] } | undefined> {
	try {
		const currentUser = await repo.git.config.getCurrentUser();
		const composerCommits: ComposerCommit[] = [];
		const allHunks: ComposerHunk[] = [];
		let count = 0;

		// Process commits in order (oldest first)
		for (const commit of commits) {
			// Get the diff for this commit
			const diffService = repo.git.diff;
			if (!diffService?.getDiff) {
				continue;
			}

			const diff = await diffService.getDiff(commit.sha, `${commit.sha}~1`);
			if (!diff?.contents) {
				continue;
			}

			// Parse the diff to get hunks
			const parsedDiff = parseGitDiff(diff.contents);
			const commitHunkIndices: number[] = [];
			const author = {
				...commit.author,
				name: commit.author.name === 'You' ? (currentUser?.name ?? commit.author.name) : commit.author.name,
			};

			const { hunks, count: newCount } = convertDiffToComposerHunks(
				parsedDiff,
				'commits',
				count,
				author,
				parseCoAuthorsFromGitCommit(commit),
			);
			allHunks.push(...hunks);
			count = newCount;
			commitHunkIndices.push(...hunks.map(h => h.index));

			// Create ComposerCommit
			const composerCommit: ComposerCommit = {
				id: commit.sha,
				message: { content: commit.message || '', isGenerated: false },
				sha: commit.sha,
				hunkIndices: commitHunkIndices,
			};

			composerCommits.push(composerCommit);
		}

		return {
			commits: composerCommits,
			hunks: allHunks,
		};
	} catch {
		return undefined;
	}
}

/**
 * Calculates the combined diff from all branch commits for safety state validation
 */
export async function calculateCombinedDiffBetweenCommits(
	repo: Repository,
	baseCommitSha: string,
	headCommitSha: string,
): Promise<GitDiff | undefined> {
	try {
		const diffService = repo.git.diff;
		if (!diffService?.getDiff) {
			return undefined;
		}

		// Get the combined diff from base to head
		const diff = await diffService.getDiff(headCommitSha, baseCommitSha);
		if (!diff?.contents) {
			return undefined;
		}

		return diff;
	} catch {
		return undefined;
	}
}
