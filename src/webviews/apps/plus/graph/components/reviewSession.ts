import type { AIReviewResult } from '@gitlens/ai/models/results.js';
import type { ScopeFile } from '../../../../plus/graph/graphService.js';

export type ReviewFindingState = 'resolved' | 'dismissed';

/** What a review remembers about its changeset beyond the AI result: which files the reader has been
 *  through, which were set aside, and what became of each finding. Plain data on the anchor's registry
 *  entry, so it survives panel remounts and anchor switches like the run itself. */
export interface ReviewSession {
	/** Viewed marks by path. `contentId` is the content (see `ScopeFile.contentId`) the mark was made
	 *  against; a file that moved on since reads as re-queued rather than silently still viewed. */
	readonly viewed: ReadonlyMap<string, { contentId?: string }>;
	/** Files set aside — out of the checklist and out of the AI's diff. */
	readonly excluded: ReadonlySet<string>;
	/** Findings no longer open; absent = open. */
	readonly findingStates: ReadonlyMap<string, ReviewFindingState>;
}

export const emptyReviewSession: ReviewSession = Object.freeze({
	viewed: new Map<string, { contentId?: string }>(),
	excluded: new Set<string>(),
	findingStates: new Map<string, ReviewFindingState>(),
});

export type ReviewFileProgress = 'viewed' | 'changed' | 'unviewed';

export type ReviewFileIdentity = Pick<ScopeFile, 'path' | 'contentId'>;

/** `'changed'` = marked viewed against content that has since moved on. When either side has no
 *  content id the mark holds — un-checking everything on every tick would be worse than trusting it. */
export function getReviewFileProgress(
	session: ReviewSession | undefined,
	file: ReviewFileIdentity,
): ReviewFileProgress {
	const mark = session?.viewed.get(file.path);
	if (mark == null) return 'unviewed';
	if (file.contentId == null || mark.contentId == null || mark.contentId === file.contentId) return 'viewed';
	return 'changed';
}

export interface ReviewProgress {
	viewed: number;
	/** Viewed once, changed since — re-queued. */
	changed: number;
	/** Files in the walk — the scope minus the set-aside ones. */
	total: number;
}

export function getReviewProgress(
	session: ReviewSession | undefined,
	files: readonly ReviewFileIdentity[] | undefined,
): ReviewProgress {
	const progress: ReviewProgress = { viewed: 0, changed: 0, total: 0 };
	for (const file of files ?? []) {
		if (session?.excluded.has(file.path)) continue;

		progress.total++;
		const state = getReviewFileProgress(session, file);
		if (state === 'viewed') {
			progress.viewed++;
		} else if (state === 'changed') {
			progress.changed++;
		}
	}
	return progress;
}

/** The stops of a walk, in reading order — tree order (path-sorted), set-aside files left out. */
export function getReviewWalkPaths(
	session: ReviewSession | undefined,
	files: readonly ReviewFileIdentity[] | undefined,
): string[] {
	return (files ?? [])
		.filter(f => !session?.excluded.has(f.path))
		.map(f => f.path)
		.sort((a, b) => a.localeCompare(b));
}

export function isReviewComplete(progress: ReviewProgress): boolean {
	return progress.total > 0 && progress.viewed === progress.total;
}

export interface ReviewFindingCounts {
	open: number;
	resolved: number;
	dismissed: number;
}

export function countReviewFindingStates(
	result: AIReviewResult | undefined,
	session: ReviewSession | undefined,
): ReviewFindingCounts {
	const counts: ReviewFindingCounts = { open: 0, resolved: 0, dismissed: 0 };
	if (result == null) return counts;

	for (const area of result.focusAreas) {
		for (const finding of area.findings ?? []) {
			const state = session?.findingStates.get(finding.id);
			if (state == null) {
				counts.open++;
			} else {
				counts[state]++;
			}
		}
	}
	return counts;
}

/** Ids of findings that are resolved or dismissed — what markdown export and the findings list leave out. */
export function getClosedFindingIds(session: ReviewSession | undefined): ReadonlySet<string> {
	if (!session?.findingStates.size) return emptyReviewSession.excluded;

	return new Set(session.findingStates.keys());
}

// Each update returns the same session when it would change nothing, so callers can skip a no-op write.

export function withFilesViewed(
	session: ReviewSession,
	files: readonly ReviewFileIdentity[],
	viewed: boolean,
): ReviewSession {
	let next: Map<string, { contentId?: string }> | undefined;
	for (const file of files) {
		if (viewed) {
			if (getReviewFileProgress(session, file) === 'viewed') continue;

			next ??= new Map(session.viewed);
			next.set(file.path, { contentId: file.contentId });
		} else {
			if (!session.viewed.has(file.path)) continue;

			next ??= new Map(session.viewed);
			next.delete(file.path);
		}
	}
	return next == null ? session : { ...session, viewed: next };
}

export function withFileExcluded(session: ReviewSession, path: string, excluded: boolean): ReviewSession {
	if (session.excluded.has(path) === excluded) return session;

	const next = new Set(session.excluded);
	if (excluded) {
		next.add(path);
	} else {
		next.delete(path);
	}
	return { ...session, excluded: next };
}

export function withFindingState(
	session: ReviewSession,
	findingId: string,
	state: ReviewFindingState | undefined,
): ReviewSession {
	if (session.findingStates.get(findingId) === state) return session;

	const next = new Map(session.findingStates);
	if (state == null) {
		next.delete(findingId);
	} else {
		next.set(findingId, state);
	}
	return { ...session, findingStates: next };
}
