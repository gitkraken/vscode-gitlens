import * as l10n from '@vscode/l10n';
import type { AIReviewFinding, AIReviewResult, AIReviewSeverity } from '@gitlens/ai/models/results.js';
import { getReviewFindingLocations } from '@gitlens/ai/models/results.js';
import { uuid } from '@gitlens/utils/crypto.js';
import type { KeyMap } from '../../../../../config.js';
import type {
	ReviewCommentPlace,
	ReviewFindingNote,
	ReviewResult,
	ReviewThreadItem,
	ScopeFile,
} from '../../../../plus/graph/graphService.js';
import type { RunningOperationExecState } from './detailsState.js';

/** A finding set aside — fixed, wrong, or not worth doing; the reader needn't say which. */
export type ReviewFindingState = 'dismissed';

/** What a review remembers about its changeset beyond the AI result: which files the reader has been
 *  through, which were set aside, and what became of each finding. Plain data on the anchor's registry
 *  entry, so it survives panel remounts and anchor switches like the run itself. */
export interface ReviewSession {
	/** Viewed marks by path. `contentId` is the content (see `ScopeFile.contentId`) the mark was made
	 *  against; a file that moved on since reads as re-queued rather than silently still viewed, and so
	 *  does one that findings came in on after the mark (`requeued`, see {@link withFindingsRequeued}). */
	readonly viewed: ReadonlyMap<string, ReviewViewedMark>;
	/** Files set aside — out of the checklist and out of the AI's diff. */
	readonly excluded: ReadonlySet<string>;
	/** Findings set aside; absent = open. */
	readonly findingStates: ReadonlyMap<string, ReviewFindingState>;
	/** What was said about a finding after the fact — the reader's replies and the agent's additions, in
	 *  the order they came. */
	readonly notes: ReadonlyMap<string, readonly ReviewFindingNote[]>;
	/** The reader's own comments on lines of the diff, in the order they were written — findings with
	 *  source `user`. They belong to the review, not to an AI run: a new run or a discard keeps them. */
	readonly comments?: readonly ReviewComment[];
	/** A reading order the reader took from an orient pass; files not in it follow in tree order. */
	readonly order?: readonly string[];
}

export interface ReviewViewedMark {
	readonly contentId?: string;
	/** Findings came in on the file after it was marked — it is back in the queue until marked again. */
	readonly requeued?: boolean;
}

export const emptyReviewSession: ReviewSession = Object.freeze({
	viewed: new Map<string, ReviewViewedMark>(),
	excluded: new Set<string>(),
	findingStates: new Map<string, ReviewFindingState>(),
	notes: new Map<string, readonly ReviewFindingNote[]>(),
});

export type ReviewFileProgress = 'viewed' | 'changed' | 'requeued' | 'unviewed';

export type ReviewFileIdentity = Pick<ScopeFile, 'path' | 'contentId'>;

/** `'changed'` = marked viewed against content that has since moved on. When either side has no
 *  content id the mark holds — un-checking everything on every tick would be worse than trusting it.
 *  `'requeued'` = marked viewed before findings came in on it; a change to the content says more, so it wins. */
export function getReviewFileProgress(
	session: ReviewSession | undefined,
	file: ReviewFileIdentity,
): ReviewFileProgress {
	const mark = session?.viewed.get(file.path);
	if (mark == null) return 'unviewed';
	if (file.contentId != null && mark.contentId != null && mark.contentId !== file.contentId) return 'changed';
	return mark.requeued ? 'requeued' : 'viewed';
}

export interface ReviewProgress {
	viewed: number;
	/** Viewed once, changed since — re-queued. */
	changed: number;
	/** Viewed once, with new findings since — re-queued. */
	requeued: number;
	/** Files in the walk — the scope minus the set-aside ones. */
	total: number;
}

export function getReviewProgress(
	session: ReviewSession | undefined,
	files: readonly ReviewFileIdentity[] | undefined,
): ReviewProgress {
	const progress: ReviewProgress = { viewed: 0, changed: 0, requeued: 0, total: 0 };
	for (const file of files ?? []) {
		if (session?.excluded.has(file.path)) continue;

		progress.total++;
		const state = getReviewFileProgress(session, file);
		if (state === 'viewed') {
			progress.viewed++;
		} else if (state === 'changed') {
			progress.changed++;
		} else if (state === 'requeued') {
			progress.requeued++;
		}
	}
	return progress;
}

/** The findings that can sit in a diff — those with a file and a line — as the editor's threads. */
export function getReviewThreadItems(
	result: AIReviewResult | undefined,
	session: ReviewSession | undefined,
): ReviewThreadItem[] {
	const items: ReviewThreadItem[] = [];
	if (result == null) return items;

	for (const area of result.focusAreas) {
		for (const finding of area.findings ?? []) {
			const notes = session?.notes.get(finding.id);
			// One thread per place the finding holds — all of them the one finding's: same state, same notes
			for (const [index, location] of getReviewFindingLocations(finding).entries()) {
				if (location.lineRange == null) continue;

				items.push({
					id: index === 0 ? finding.id : `${finding.id}#${index}`,
					findingId: finding.id,
					path: location.filePath,
					line: location.lineRange.start,
					lineEnd: location.lineRange.end,
					severity: finding.severity,
					title: finding.title,
					description: finding.description,
					state: session?.findingStates.get(finding.id) ?? 'open',
					...(finding.source != null ? { source: finding.source } : {}),
					...((finding as ReviewComment).author != null ? { author: (finding as ReviewComment).author } : {}),
					...(notes?.length ? { notes: [...notes] } : {}),
				});
			}
		}
	}
	return items;
}

/** The stops of a walk, in reading order — the session's order first, then tree order (path-sorted);
 *  set-aside files left out; the tree's own rendered order, when given, orders the files within the plan's
 *  places and what the plan doesn't have. */
export function getReviewReadingOrder(
	session: ReviewSession | undefined,
	files: readonly ReviewFileIdentity[] | undefined,
	treeOrder?: readonly string[],
): string[] {
	const present = new Set((files ?? []).map(f => f.path));
	const rank = new Map((treeOrder ?? []).map((p, i) => [p, i]));
	const ordered = (session?.order ?? []).filter(p => present.has(p) && !session?.excluded.has(p));
	// The plan orders its groups, but each group's pane shows its files its own way — folders first, by
	// name — so the steps go down them as shown: the files a pane has said the order of trade places among
	// themselves by it, and a pane that hasn't said yet keeps the plan's order
	const slots = ordered.flatMap((p, i) => (rank.has(p) ? [i] : []));
	const shown = slots.map(i => ordered[i]).sort((a, b) => rank.get(a)! - rank.get(b)!);
	for (const [n, i] of slots.entries()) {
		ordered[i] = shown[n];
	}
	const placed = new Set(ordered);
	// The rest reads top to bottom as the checklist shows it; by path until the tree has said its order
	const rest = (files ?? [])
		.filter(f => !placed.has(f.path) && !session?.excluded.has(f.path))
		.map(f => f.path)
		.sort((a, b) => {
			const ra = rank.get(a);
			const rb = rank.get(b);
			if (ra != null && rb != null) return ra - rb;
			if (ra != null) return -1;
			if (rb != null) return 1;
			return a.localeCompare(b);
		});
	return [...ordered, ...rest];
}

export function withReadingOrder(session: ReviewSession, order: readonly string[] | undefined): ReviewSession {
	const current = session.order;
	if (current === order) return session;
	if (
		current != null &&
		order != null &&
		current.length === order.length &&
		current.every((p, i) => p === order[i])
	) {
		return session;
	}

	return { ...session, order: order };
}

export function isReviewComplete(progress: ReviewProgress): boolean {
	return progress.total > 0 && progress.viewed === progress.total;
}

export interface ReviewFindingCounts {
	open: number;
	dismissed: number;
}

export function countReviewFindingStates(
	result: AIReviewResult | undefined,
	session: ReviewSession | undefined,
): ReviewFindingCounts {
	const counts: ReviewFindingCounts = { open: 0, dismissed: 0 };
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

/** What a checklist row says about its file's findings: how many are still open, how many are
 *  closed, and the worst open severity — the row's mark takes its color from that. */
export interface ReviewFileFindings {
	open: number;
	closed: number;
	/** The highest severity among the open findings; absent when none is open. */
	severity?: AIReviewSeverity;
	/** Where to land when the reader opens the file from its mark: the first open finding with a line,
	 *  or the first finding at all once every one is closed; absent when none names a line. */
	target?: { readonly start: number; readonly end: number };
}

const severityRank: Record<AIReviewSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };

/** Findings by file path, from every focus area — the model's own and the agent's reported back
 *  alike. Findings with no file (general remarks) have no row to mark and are left out. */
export function getReviewFileFindings(
	result: AIReviewResult | undefined,
	session: ReviewSession | undefined,
): ReadonlyMap<string, ReviewFileFindings> {
	const byPath = new Map<string, ReviewFileFindings>();
	if (result == null) return byPath;

	// Files whose target is an open finding already — a closed one never replaces it
	const openTargets = new Set<string>();
	for (const area of result.focusAreas) {
		for (const finding of area.findings ?? []) {
			const open = session?.findingStates.get(finding.id) == null;
			// A finding counts once per file it holds in, however many places it has there
			const counted = new Set<string>();
			for (const location of getReviewFindingLocations(finding)) {
				let entry = byPath.get(location.filePath);
				if (entry == null) {
					entry = { open: 0, closed: 0 };
					byPath.set(location.filePath, entry);
				}

				if (
					location.lineRange != null &&
					!openTargets.has(location.filePath) &&
					(open || entry.target == null)
				) {
					entry.target = location.lineRange;
					if (open) {
						openTargets.add(location.filePath);
					}
				}

				if (counted.has(location.filePath)) continue;

				counted.add(location.filePath);

				if (!open) {
					entry.closed++;
					continue;
				}

				entry.open++;
				if (entry.severity == null || severityRank[finding.severity] < severityRank[entry.severity]) {
					entry.severity = finding.severity;
				}
			}
		}
	}
	return byPath;
}

/** Ids of findings that are dismissed — what markdown export and the findings list leave out. */
export function getClosedFindingIds(session: ReviewSession | undefined): ReadonlySet<string> {
	if (!session?.findingStates.size) return emptyReviewSession.excluded;

	return new Set(session.findingStates.keys());
}

/** What each AI finding was made against: by finding id, the content (see `ScopeFile.contentId`) of
 *  the files it points at when it came in. A finding whose file moved on since describes older code. */
export type ReviewFindingsContent = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** Records the files' current content for findings that just came in — a later report of a finding
 *  with the same id replaces what was recorded for it. The reader's own comments are not the AI's word
 *  on the code and are left out; so is a file with no content id. The same record when nothing is added. */
export function withFindingsContent(
	recorded: ReviewFindingsContent | undefined,
	findings: readonly AIReviewFinding[] | undefined,
	files: readonly ReviewFileIdentity[] | undefined,
): ReviewFindingsContent | undefined {
	if (!findings?.length || !files?.length) return recorded;

	const current = new Map<string, string>();
	for (const file of files) {
		if (file.contentId != null) {
			current.set(file.path, file.contentId);
		}
	}

	let next: Map<string, ReadonlyMap<string, string>> | undefined;
	for (const finding of findings) {
		if (finding.source === 'user') continue;

		const content = new Map<string, string>();
		for (const location of getReviewFindingLocations(finding)) {
			const contentId = current.get(location.filePath);
			if (contentId != null) {
				content.set(location.filePath, contentId);
			}
		}
		if (content.size === 0) continue;

		next ??= new Map(recorded);
		next.set(finding.id, content);
	}
	return next ?? recorded;
}

/** Ids of the AI findings with a file that changed since the finding was made. As with viewed marks,
 *  an unknown side — nothing recorded, or no current content id (a file gone from the scope included)
 *  — leaves the finding as it was. */
export function getStaleFindingIds(
	result: AIReviewResult | undefined,
	recorded: ReviewFindingsContent | undefined,
	files: readonly ReviewFileIdentity[] | undefined,
): ReadonlySet<string> {
	const stale = new Set<string>();
	if (result == null || !recorded?.size || !files?.length) return stale;

	const current = new Map(files.map(f => [f.path, f.contentId]));
	for (const area of result.focusAreas) {
		for (const finding of area.findings ?? []) {
			if (finding.source === 'user') continue;

			for (const [path, contentId] of recorded.get(finding.id) ?? []) {
				const now = current.get(path);
				if (now != null && now !== contentId) {
					stale.add(finding.id);
					break;
				}
			}
		}
	}
	return stale;
}

// Each update returns the same session when it would change nothing, so callers can skip a no-op write.

export function withFilesViewed(
	session: ReviewSession,
	files: readonly ReviewFileIdentity[],
	viewed: boolean,
): ReviewSession {
	let next: Map<string, ReviewViewedMark> | undefined;
	for (const file of files) {
		if (viewed) {
			if (getReviewFileProgress(session, file) === 'viewed') continue;

			// A fresh mark — whatever re-queued the file, the reader has been through it again
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

let noteSeq = 0;

/** Appends a note to a finding, giving it an id to be removed by; an empty one is ignored. */
export function withFindingNote(session: ReviewSession, findingId: string, note: ReviewFindingNote): ReviewSession {
	const text = note.text.trim();
	if (!text) return session;

	const id = note.id ?? `${note.at.toString(36)}-${(++noteSeq).toString(36)}`;
	const next = new Map(session.notes);
	next.set(findingId, [...(session.notes.get(findingId) ?? []), { ...note, id: id, text: text }]);
	return { ...session, notes: next };
}

/** Rewrites one note's text; an empty one leaves it as it was — removing is its own step. */
export function withFindingNoteText(
	session: ReviewSession,
	findingId: string,
	noteId: string,
	text: string,
): ReviewSession {
	const trimmed = text.trim();
	const notes = session.notes.get(findingId);
	const note = notes?.find(n => n.id === noteId);
	if (note == null || !trimmed || note.text === trimmed) return session;

	const next = new Map(session.notes);
	next.set(
		findingId,
		notes!.map(n => (n.id === noteId ? { ...n, text: trimmed } : n)),
	);
	return { ...session, notes: next };
}

/** Removes one note from a finding's thread. */
export function withoutFindingNote(session: ReviewSession, findingId: string, noteId: string): ReviewSession {
	const notes = session.notes.get(findingId);
	if (!notes?.some(n => n.id === noteId)) return session;

	const remaining = notes.filter(n => n.id !== noteId);
	const next = new Map(session.notes);
	if (remaining.length > 0) {
		next.set(findingId, remaining);
	} else {
		next.delete(findingId);
	}
	return { ...session, notes: next };
}

/** The result without one finding — a focus area it leaves empty goes with it. The same result when the
 *  finding isn't in it. */
export function withoutResultFinding(result: AIReviewResult, findingId: string): AIReviewResult {
	if (!result.focusAreas.some(a => a.findings?.some(f => f.id === findingId))) return result;

	const focusAreas: AIReviewResult['focusAreas'][number][] = [];
	for (const area of result.focusAreas) {
		if (!area.findings?.some(f => f.id === findingId)) {
			focusAreas.push(area);
			continue;
		}

		const findings = area.findings.filter(f => f.id !== findingId);
		if (findings.length === 0) continue;

		focusAreas.push({ ...area, findings: findings });
	}
	return { ...result, focusAreas: focusAreas };
}

/** A finding's state and notes go when the finding does. */
export function withoutFindingRecord(session: ReviewSession, findingId: string): ReviewSession {
	if (!session.findingStates.has(findingId) && !session.notes.has(findingId)) return session;

	const findingStates = new Map(session.findingStates);
	findingStates.delete(findingId);
	const notes = new Map(session.notes);
	notes.delete(findingId);
	return { ...session, findingStates: findingStates, notes: notes };
}

/** Drops the AI findings' states and notes — for a result that is being discarded; viewed marks,
 *  exclusions and the reader's own comments (with their states and notes) belong to the review and stay. */
export function withoutFindings(session: ReviewSession): ReviewSession {
	const kept = new Set(session.comments?.map(c => c.id));
	const keep = <T>(map: ReadonlyMap<string, T>) => new Map([...map].filter(([id]) => kept.has(id)));
	const findingStates = keep(session.findingStates);
	const notes = keep(session.notes);
	if (findingStates.size === session.findingStates.size && notes.size === session.notes.size) return session;

	return { ...session, findingStates: findingStates, notes: notes };
}

/** A comment of the review's own (`source: 'user'`). `author` is who wrote its opening words when it isn't
 *  the reader — a thread whose first comment was deleted is opened by the reply that followed, which may
 *  be the agent's. */
export type ReviewComment = AIReviewFinding & { readonly author?: 'agent' };

/** The focus area the reader's comments show under — ahead of the AI's, since they are the reader's own word. */
export const userFocusAreaId = 'user';

/** The focus area Review in Repo's findings show under, appended to the result as the agent reports them. */
export const agentFocusAreaId = 'agent';

/** A comment the reader wrote on lines of the diff, as a finding: no severity to speak of (`suggestion`
 *  only so the shared shape holds — it is never shown), no title, the text as the description. */
export function createReviewComment(id: string, place: ReviewCommentPlace, text: string): AIReviewFinding {
	return {
		id: id,
		severity: 'suggestion',
		title: '',
		description: text,
		filePath: place.path,
		lineRange: { start: place.line, end: place.lineEnd },
		source: 'user',
	};
}

export function withReviewComment(session: ReviewSession, comment: ReviewComment): ReviewSession {
	const text = comment.description.trim();
	if (!text || session.comments?.some(c => c.id === comment.id)) return session;

	return { ...session, comments: [...(session.comments ?? []), { ...comment, description: text }] };
}

/** Rewrites a comment's text; an empty one leaves it as it was — removing is its own step. */
export function withReviewCommentText(session: ReviewSession, id: string, text: string): ReviewSession {
	const trimmed = text.trim();
	const comment = session.comments?.find(c => c.id === id);
	if (comment == null || !trimmed || comment.description === trimmed) return session;

	return {
		...session,
		comments: session.comments!.map(c => (c.id === id ? { ...c, description: trimmed } : c)),
	};
}

/** Removes a comment, its state and the notes on it. */
export function withoutReviewComment(session: ReviewSession, id: string): ReviewSession {
	if (!session.comments?.some(c => c.id === id)) return session;

	const comments = session.comments.filter(c => c.id !== id);
	return withoutFindingRecord({ ...session, comments: comments.length > 0 ? comments : undefined }, id);
}

/** A reply of the reader's on a thread someone else started — an AI or agent finding. */
export interface ReviewReply {
	readonly finding: AIReviewFinding;
	readonly note: ReviewFindingNote;
}

/** The reader's replies on the findings they didn't write, in the findings' order and then the replies'. */
export function getReviewReplies(
	result: AIReviewResult | undefined,
	session: ReviewSession | undefined,
): ReviewReply[] {
	const replies: ReviewReply[] = [];
	if (result == null || !session?.notes.size) return replies;

	for (const area of result.focusAreas) {
		if (area.id === userFocusAreaId) continue;

		for (const finding of area.findings ?? []) {
			for (const note of session.notes.get(finding.id) ?? []) {
				if (note.author !== 'user') continue;

				replies.push({ finding: finding, note: note });
			}
		}
	}
	return replies;
}

let lastWithComments:
	| {
			result: AIReviewResult | undefined;
			comments: readonly ReviewComment[] | undefined;
			notes: ReviewSession['notes'] | undefined;
			merged: AIReviewResult | undefined;
	  }
	| undefined;

/** The review as the reader sees it: the AI's result with a focus area of the reader's own, first — their
 *  comments as its findings, and (shown with them, see {@link getReviewReplies}) their replies on the
 *  other findings. Without either it is the result itself; with comments and no result, a result of just
 *  them. The same inputs give the same object, so what keys on identity (the panel, the thread sync) holds
 *  still. */
export function withReviewComments(
	result: AIReviewResult | undefined,
	session: ReviewSession | undefined,
): AIReviewResult | undefined {
	const comments = session?.comments;
	const notes = session?.notes;
	const last = lastWithComments;
	if (last != null && last.result === result && last.comments === comments && last.notes === notes) {
		return last.merged;
	}

	const hasReplies = getReviewReplies(result, session).length > 0;
	let merged = result;
	if (comments?.length || hasReplies) {
		merged = {
			overview: result?.overview ?? '',
			mode: result?.mode ?? 'single-pass',
			focusAreas: [
				{
					id: userFocusAreaId,
					label: l10n.t('Your comments'),
					rationale: l10n.t(
						'What you noted on the lines of the diff and in the findings’ threads — for the fix and the later reviews.',
					),
					severity: 'suggestion',
					files: [...new Set((comments ?? []).map(c => c.filePath!))],
					findings: comments ?? [],
				},
				...(result?.focusAreas.filter(a => a.id !== userFocusAreaId) ?? []),
			],
		};
	}
	lastWithComments = { result: result, comments: comments, notes: notes, merged: merged };
	return merged;
}

/** What the review panel shows for a review: `value` is the run's own outcome, `result` the review as the
 *  reader sees it (see {@link withReviewComments}). A failed run shows its error, with Retry and Go Back,
 *  even when the reader's comments alone make a result — the panel keeps them below the error. A fetch
 *  error stays behind a result: it is only ever older than one. */
export function getReviewPanelStatus(
	execState: RunningOperationExecState | undefined,
	value: ReviewResult | undefined,
	result: AIReviewResult | undefined,
	fetchError: string | undefined,
): 'idle' | 'loading' | 'ready' | 'error' {
	if (execState === 'generating') return 'loading';
	if (execState === 'backed') return 'idle';
	if (value != null && 'error' in value) return 'error';
	if (result != null) return 'ready';
	if (fetchError != null) return 'error';
	return 'idle';
}

/** What makes two findings the same one across runs: who reported it (the model or the agent), the files it
 *  holds in, and its title — the description when the title is only a stand-in. Lines are left out: an
 *  edit above a finding moves them without making it another finding. */
function getFindingMatchKey(finding: AIReviewFinding): string {
	const paths = [...new Set(getReviewFindingLocations(finding).map(l => l.filePath))].sort();
	const label = finding.titleIsFallback ? finding.description : finding.title;
	return [finding.source === 'agent' ? 'agent' : 'model', ...paths, label.trim().toLowerCase()].join('\0');
}

/** Gives findings that just came in the ids they keep for as long as they are in the review — everything
 *  the session knows about a finding (its state, its notes, its threads) is keyed by it. A finding that is
 *  one of `previous` (see {@link getFindingMatchKey}) takes that one's id, so what the reader did with it
 *  stays with it; each previous finding is claimed once, so two alike in a file stay two. Any other gets a
 *  fresh id. What the findings came with — numbered by position, or per agent run — names nothing beyond
 *  the one report and never survives. `taken` is what the review holds already: those ids are neither
 *  claimed nor handed out, nor are the previous findings' own. The reader's own comments are left as they are.
 *  Returns a function to map the findings through, in order. */
export function createReviewFindingIds(
	previous: readonly AIReviewFinding[],
	taken: Iterable<string>,
): (finding: AIReviewFinding) => AIReviewFinding {
	const used = new Set(taken);
	const claimable = new Map<string, string[]>();
	for (const finding of previous) {
		if (finding.source === 'user' || used.has(finding.id)) continue;

		used.add(finding.id);
		const key = getFindingMatchKey(finding);
		const ids = claimable.get(key);
		if (ids == null) {
			claimable.set(key, [finding.id]);
		} else {
			ids.push(finding.id);
		}
	}

	return finding => {
		if (finding.source === 'user') return finding;

		let id = claimable.get(getFindingMatchKey(finding))?.shift();
		if (id == null) {
			do {
				id = `f-${uuid().slice(0, 8)}`;
			} while (used.has(id));
			used.add(id);
		}
		return id === finding.id ? finding : { ...finding, id: id };
	};
}

/** {@link createReviewFindingIds} over the model's findings in a result — the agent's area and the reader's
 *  carry theirs already. The same result when there are none. */
export function withReviewFindingIds(
	result: AIReviewResult,
	previous: readonly AIReviewFinding[],
	taken: Iterable<string>,
): AIReviewResult {
	const isModels = (area: AIReviewResult['focusAreas'][number]) =>
		area.id !== agentFocusAreaId && area.id !== userFocusAreaId && Boolean(area.findings?.length);
	if (!result.focusAreas.some(isModels)) return result;

	const withId = createReviewFindingIds(previous, taken);
	return {
		...result,
		focusAreas: result.focusAreas.map(area =>
			isModels(area) ? { ...area, findings: area.findings!.map(withId) } : area,
		),
	};
}

/** The model's findings in review results, then `earlier` — each id once, the first one seen kept. What a
 *  finding that comes in later takes its id from when it is the same one (see {@link createReviewFindingIds}). */
export function getModelFindings(
	results: readonly (AIReviewResult | undefined)[],
	earlier?: readonly AIReviewFinding[],
): AIReviewFinding[] {
	const findings = new Map<string, AIReviewFinding>();
	const all = [
		...results.flatMap(
			r =>
				r?.focusAreas
					.filter(a => a.id !== agentFocusAreaId && a.id !== userFocusAreaId)
					.flatMap(a => a.findings ?? []) ?? [],
		),
		...(earlier ?? []),
	];
	for (const finding of all) {
		if (finding.source == null && !findings.has(finding.id)) {
			findings.set(finding.id, finding);
		}
	}
	return [...findings.values()];
}

/** Puts the viewed files back in the queue that `next` brings an open finding `prev` didn't have there —
 *  the reader went through them before the finding existed, so they read as re-queued rather than done,
 *  and the rest of the review stands. The reader's own comments never count (they are theirs to know
 *  about), nor what was said on findings already there — notes don't make a finding new. */
export function withFindingsRequeued(
	session: ReviewSession,
	prev: AIReviewResult | undefined,
	next: AIReviewResult | undefined,
): ReviewSession {
	if (next == null || session.viewed.size === 0) return session;

	// A finding counts as known at a place by its id, or by its title there — one alike to a finding already
	// known (another area's, a second one in the file) takes an id of its own but brings nothing new
	const had = new Map<string, Set<string>>();
	const seen = new Set<string>();
	const titled = (path: string, finding: AIReviewFinding) => `${path}\0${finding.title.trim().toLowerCase()}`;
	for (const area of prev?.focusAreas ?? []) {
		for (const finding of area.findings ?? []) {
			const paths = had.get(finding.id) ?? new Set<string>();
			for (const location of getReviewFindingLocations(finding)) {
				paths.add(location.filePath);
				seen.add(titled(location.filePath, finding));
			}
			had.set(finding.id, paths);
		}
	}

	let viewed: Map<string, ReviewViewedMark> | undefined;
	for (const area of next.focusAreas) {
		if (area.id === userFocusAreaId) continue;

		for (const finding of area.findings ?? []) {
			if (finding.source === 'user' || session.findingStates.has(finding.id)) continue;

			for (const { filePath } of getReviewFindingLocations(finding)) {
				if (had.get(finding.id)?.has(filePath) || seen.has(titled(filePath, finding))) continue;

				// Never viewed, there is nothing to put back; re-queued already, nothing to add
				const mark = (viewed ?? session.viewed).get(filePath);
				if (mark == null) continue;
				if (mark.requeued) continue;

				viewed ??= new Map(session.viewed);
				viewed.set(filePath, { ...mark, requeued: true });
			}
		}
	}
	return viewed == null ? session : { ...session, viewed: viewed };
}

export type ReviewReadingKey = 'next' | 'previous' | 'markViewed';

const reviewReadingKeys: Record<ReviewReadingKey, string> = { next: ']', previous: '[', markViewed: 'V' };

/** The keyboard shortcut for a reading step under `keymap`, the way the panel names it — `⌥]` / `Alt+]` on the
 *  alternate keymap, `⌘⌥G ]` / `Ctrl+Shift+G ]` chorded, nothing when shortcuts are off. Mirrors the
 *  `gitlens.review.*:key` keybindings, which live on separate command ids and so never show in the
 *  editor's own hovers. */
export function getReviewReadingShortcut(
	keymap: KeyMap | undefined,
	key: ReviewReadingKey,
	isMac: boolean,
): string | undefined {
	const k = reviewReadingKeys[key];
	switch (keymap) {
		case 'alternate':
			return isMac ? `⌥${k}` : `Alt+${k}`;
		case 'chorded':
			return isMac ? `⌘⌥G ${k}` : `Ctrl+Shift+G ${k}`;
		default:
			return undefined;
	}
}
