import { l10n } from 'vscode';
import type {
	AIReviewFinding,
	AIReviewFindingLocation,
	AIReviewOrientResult,
	AIReviewSeverity,
} from '@gitlens/ai/models/results.js';
import { parseReviewOrientJson } from '@gitlens/ai/utils/results.utils.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { uuid } from '@gitlens/utils/crypto.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { DeepReviewAnchor, DeepReviewState, ScopeSelection } from './graphService.js';

/** Where a delegated deep review reports findings: each channel takes a route of its own under this,
 *  so two graphs — or a channel left over from an earlier run — never take each other's reports */
export const deepReviewRoute = 'review/findings';

/** The slice of the IPC service the channel needs — a route it can own, unlocked by a token of its own, and
 *  the address the agent is told. */
export interface DeepReviewIpc {
	readonly address: string | undefined;
	registerHandler<Request, Response>(
		name: string,
		handler: (request: Request | undefined, searchParams: URLSearchParams) => Promise<Response>,
		routeToken?: string,
	): UnifiedDisposable;
}

/** One deep review's report channel: owns the IPC route while open, keeps what the agent reported
 *  (append-only, sequenced), and tells its owner on every change. `done` marks the review finished but
 *  keeps the route — the reader may go on with the agent in its session and have it report more; the route
 *  closes on {@link close} (a new review replaces it, the review is discarded, the graph goes). What was
 *  reported stays readable. */
export class DeepReviewChannel {
	private readonly _state: DeepReviewState;
	private _route: UnifiedDisposable | undefined;
	/** This channel's own route — the one the agent is told to POST to */
	readonly route: string;
	/** The bearer the agent is told to send: it opens this channel's route and no other. The prompt goes to
	 *  whichever agent the reader picks — a cloud one keeps it in its history — so it must never carry the
	 *  server's own token, which opens every route, the `gk` CLI's included */
	readonly token: string = uuid();
	/** The whole review's hand-over: `none` while the channel only takes questions, then `pending` while an
	 *  agent is picked and the prompt sent, `failed` while a failed hand-over's Retry is on offer, `delivered`
	 *  once an agent has it */
	private _review: 'none' | 'pending' | 'failed' | 'delivered';
	/** The questions' hand-overs: how many are on their way, and whether any got through */
	private readonly _questions = { pending: 0, delivered: false };
	/** A question went into the channel before the review got through — what comes in may be its answer
	 *  (an answer may carry a finding), so then only the review's own dispatch or its `done` proves the
	 *  review arrived */
	private _questionsAnswering = false;
	/** Who waits on a reading plan from the agent (an Orient the model couldn't take) */
	private readonly _planWaiters = new Set<{
		resolve: (plan: AIReviewOrientResult) => void;
		reject: (reason: Error) => void;
	}>();

	constructor(
		ipc: DeepReviewIpc,
		run: number,
		anchor: DeepReviewAnchor,
		anchorKey: string,
		private readonly onChange: (state: DeepReviewState) => void,
		id: string,
		purpose: DeepReviewState['purpose'] = 'review',
	) {
		this._review = purpose === 'review' ? 'pending' : 'none';
		this._state = {
			run: run,
			anchor: anchor,
			anchorKey: anchorKey,
			purpose: purpose,
			handOff: 'pending',
			active: true,
			done: false,
			findings: [],
			notes: [],
		};
		this.route = `${deepReviewRoute}/${id}`;
		this._route = ipc.registerHandler<DeepReviewReport, { accepted: number }>(
			this.route,
			rq => Promise.resolve({ accepted: this.report(rq) }),
			this.token,
		);
		Logger.debug(`DeepReview(run ${run}): open at /${this.route} for ${anchor.kind} ${anchor.repoPath}`);
	}

	get state(): DeepReviewState {
		return { ...this._state, findings: [...this._state.findings], notes: [...this._state.notes] };
	}

	/** A whole review goes into a channel that was open only for questions: it reads as a review from now on,
	 *  one no agent has yet — the questions' agent got those, not this prompt. */
	beginReview(): void {
		if (!this._state.active || this._review !== 'none') return;

		this._review = 'pending';
		this._questionsAnswering = this._questions.pending > 0 || this._questions.delivered;
		this.changed();
	}

	/** A failed review hand-over's Retry went up (`true`), or was taken up and the prompt is on its way again. */
	reviewOffered(offered: boolean): void {
		if (!this._state.active || (this._review !== 'pending' && this._review !== 'failed')) return;

		this._review = offered ? 'failed' : 'pending';
		this.changed();
	}

	/** The review's prompt reached an agent. */
	reviewDelivered(): void {
		if (!this._state.active || this._review === 'none' || this._review === 'delivered') return;

		this._review = 'delivered';
		this.changed();
	}

	/** The review's hand-over ended with no agent — unless one is reporting anyway, from the prompt the failed
	 *  hand-over copied, pasted by hand. The channel goes back to its questions, or closes when it has none. */
	reviewFailed(): void {
		if (!this._state.active || this._review === 'none' || this._review === 'delivered') return;

		this._review = 'none';
		if (!this.closeIfIdle()) {
			this.changed();
		}
	}

	/** A question goes into the channel. */
	beginQuestion(): void {
		if (!this._state.active) return;

		this._questions.pending++;
		if (this._review === 'pending' || this._review === 'failed') {
			this._questionsAnswering = true;
		}
	}

	/** A question's prompt reached an agent. */
	questionDelivered(): void {
		if (!this._state.active) return;

		this._questions.pending = Math.max(0, this._questions.pending - 1);
		this._questions.delivered = true;
		this.changed();
	}

	/** A question's hand-over ended with no agent: the channel closes when nothing else holds it. */
	questionFailed(): void {
		if (!this._state.active) return;

		this._questions.pending = Math.max(0, this._questions.pending - 1);
		// No question got through and none is left on its way: nothing but the review can be reporting
		if (this._questions.pending === 0 && !this._questions.delivered) {
			this._questionsAnswering = false;
		}
		this.closeIfIdle();
	}

	/** The reading plan the agent posts next — settles when one that parses arrives, and fails when the
	 *  channel closes first or `signal` aborts. */
	waitForPlan(signal?: AbortSignal): Promise<AIReviewOrientResult> {
		return new Promise((resolve, reject) => {
			if (!this._state.active) {
				reject(new Error(l10n.t('The channel to the agent closed before it sent a reading plan.')));
				return;
			}
			if (signal?.aborted) {
				reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
				return;
			}

			// Settled once: a late abort after the plan came finds the promise settled and the waiter gone
			const waiter = { resolve: resolve, reject: reject };
			this._planWaiters.add(waiter);
			signal?.addEventListener(
				'abort',
				() => {
					this._planWaiters.delete(waiter);
					reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
				},
				{ once: true },
			);
		});
	}

	/** Takes a report in: returns how many findings, notes and plans it kept. A report after the channel closed is dropped. */
	report(body: DeepReviewReport | undefined): number {
		if (!this._state.active) return 0;

		// A reading plan answers whoever waits on one; it is the questions' kind of report, not the review's
		if (body?.plan != null && typeof body.plan === 'object') {
			let plan: AIReviewOrientResult | undefined;
			try {
				plan = parseReviewOrientJson(JSON.stringify(body.plan));
			} catch (ex) {
				Logger.debug(`DeepReview(run ${this._state.run}): plan rejected: ${String(ex)}`);
			}
			if (plan == null || plan.groups.length === 0 || this._planWaiters.size === 0) return 0;

			// The agent read the files from the shell, where a path may come as `./path`
			plan = {
				...plan,
				groups: plan.groups.map(g => ({
					...g,
					files: g.files.map(f => ({ ...f, path: f.path.replace(/^\.\//, '') })),
				})),
			};

			Logger.debug(`DeepReview(run ${this._state.run}): plan accepted with ${plan.groups.length} groups`);
			for (const waiter of this._planWaiters) {
				waiter.resolve(plan);
			}
			this._planWaiters.clear();
			this._questions.delivered = true;
			this.changed();
			return 1;
		}

		const next = (this._state.findings.at(-1)?.seq ?? 0) + 1;
		const { findings, notes, done } = parseDeepReviewReport(body, next);
		for (const [i, finding] of findings.entries()) {
			this._state.findings.push({ seq: next + i, finding: finding });
		}
		let noteSeq = this._state.notes.at(-1)?.seq ?? 0;
		for (const note of notes) {
			this._state.notes.push({ seq: ++noteSeq, ...note });
		}
		const accepted = findings.length + notes.length;
		Logger.debug(
			`DeepReview(run ${this._state.run}): report accepted ${findings.length} findings, ${notes.length} notes${
				done ? ', done' : ''
			} (${this._state.findings.length} findings so far)`,
		);
		if (done) {
			this._state.done = true;
		}
		// A report is proof an agent has a prompt, however it got there — the clipboard copy a failed hand-over
		// leaves, pasted by hand, as much as a dispatch still settling. Whose prompt: the review's, unless a
		// question may be answering — then only the end of the review is the review's
		const reviewOnItsWay = this._review === 'pending' || this._review === 'failed';
		if (reviewOnItsWay && (done || (accepted > 0 && !this._questionsAnswering))) {
			this._review = 'delivered';
		} else if (accepted > 0 && (this._review === 'none' || this._questionsAnswering)) {
			this._questions.delivered = true;
		}

		this.changed();
		return accepted;
	}

	/** Closes the route; reports after this are dropped. Notifies once, on the first close. */
	close(): void {
		if (!this._state.active) return;

		Logger.debug(`DeepReview(run ${this._state.run}): closed with ${this._state.findings.length} findings`);
		this._state.active = false;
		this._route?.dispose();
		this._route = undefined;
		for (const waiter of this._planWaiters) {
			waiter.reject(new Error(l10n.t('The channel to the agent closed before it sent a reading plan.')));
		}
		this._planWaiters.clear();
		this.onChange(this.state);
	}

	/** No review and no question has an agent, and none is on its way: nothing would ever report. */
	private closeIfIdle(): boolean {
		if (this._review !== 'none' || this._questions.delivered || this._questions.pending > 0) return false;

		this.close();
		return true;
	}

	private changed(): void {
		this.syncHandOff();
		this.onChange(this.state);
	}

	/** What the panel reads: a review while there is one, its hand-over or else the questions'. */
	private syncHandOff(): void {
		this._state.purpose = this._review === 'none' ? 'ask' : 'review';
		this._state.handOff =
			this._review !== 'none' ? this._review : this._questions.delivered ? 'delivered' : 'pending';
	}
}

/** What an agent POSTs to the deep-review channel; anything else in the body is ignored. */
export interface DeepReviewReport {
	findings?: unknown;
	done?: unknown;
	/** A reading plan, in the shape Orient answers with */
	plan?: unknown;
}

function severityOf(value: unknown): AIReviewSeverity {
	return value === 'critical' || value === 'warning' || value === 'suggestion' ? value : 'warning';
}

function lineOf(value: unknown): number | undefined {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseLocation(value: unknown): AIReviewFindingLocation | undefined {
	if (value == null || typeof value !== 'object') return undefined;

	const l = value as Record<string, unknown>;
	const file = typeof l.file === 'string' ? l.file.trim().replace(/^\.\//, '') : '';
	if (!file) return undefined;

	const lines = l.lines != null && typeof l.lines === 'object' ? (l.lines as Record<string, unknown>) : undefined;
	const start = lineOf(lines?.start);
	const end = lineOf(lines?.end) ?? start;
	return start != null && end != null && end >= start
		? { filePath: file, lineRange: { start: start, end: end } }
		: { filePath: file };
}

/** The finding's places: `file`/`lines` first, then `locations`, each place once. Not `normalizeFindingLocations`
 *  from the model's parse: that one trusts a schema-shaped answer and mends a reversed or out-of-file range,
 *  where an agent's report is any JSON it chose to send — a range that makes no sense is dropped, the file kept,
 *  and a path the shell gave as `./path` read as the diff shows it. */
function parseLocations(f: Record<string, unknown>): AIReviewFindingLocation[] {
	const out: AIReviewFindingLocation[] = [];
	const seen = new Set<string>();
	for (const candidate of [f, ...(Array.isArray(f.locations) ? f.locations : [])]) {
		const location = parseLocation(candidate);
		if (location == null) continue;

		const key = `${location.filePath}:${location.lineRange?.start ?? ''}-${location.lineRange?.end ?? ''}`;
		if (seen.has(key)) continue;

		seen.add(key);
		out.push(location);
	}
	return out;
}

/** Reads the findings out of an agent's report — tolerant of what an agent will plausibly send, strict
 *  about what it keeps: a finding needs a title; a file is kept as-is (the agent read the real file),
 *  a line range only when both ends make sense. Ids continue from `nextSeq`. An item that names a
 *  `findingId` with a `comment` is not a finding but a note on one that already exists. */
export function parseDeepReviewReport(
	body: DeepReviewReport | undefined,
	nextSeq: number,
): { findings: AIReviewFinding[]; notes: { findingId: string; text: string }[]; done: boolean } {
	const findings: AIReviewFinding[] = [];
	const notes: { findingId: string; text: string }[] = [];
	let seq = nextSeq;
	const raw = Array.isArray(body?.findings) ? body.findings : [];
	for (const item of raw) {
		if (item == null || typeof item !== 'object') continue;

		const f = item as Record<string, unknown>;
		const findingId = typeof f.findingId === 'string' ? f.findingId.trim() : '';
		const comment = typeof f.comment === 'string' ? f.comment.trim() : '';
		if (findingId) {
			if (comment) {
				notes.push({ findingId: findingId, text: comment });
			}
			continue;
		}

		const title = typeof f.title === 'string' ? f.title.trim() : '';
		if (!title) continue;

		const locations = parseLocations(f);
		const [first] = locations;
		findings.push({
			id: `agent-${seq++}`,
			severity: severityOf(f.severity),
			title: title,
			description: typeof f.description === 'string' ? f.description.trim() : '',
			filePath: first?.filePath,
			lineRange: first?.lineRange,
			...(locations.length > 1 ? { locations: locations } : {}),
			source: 'agent',
		});
	}
	return { findings: findings, notes: notes, done: body?.done === true };
}

/** The prompt's section on an earlier review: what it found, what the reader said, and how the agent adds
 *  to one of those findings instead of reporting it again. `priorFindings` is the panel's rendering of
 *  the findings (see `formatReviewForAgentContext`), ids included. */
export function getDeepReviewPriorFindingsSection(priorFindings: string, endpoint: string, token: string): string {
	return `A review of the diff alone has already run. Its findings are below, each with its id, its state — open, or dismissed by the reader — and what the reader said about it. Do not report any of them again. Use them as leads: verify each in the repository — read the callers, run the tests — and report what the diff alone could not show. A dismissed finding is closed: already fixed, judged wrong, or not worth doing; take the reader's word on it unless you have evidence to the contrary.

To add to one of these findings — evidence for or against it, a scope that is wider or narrower than stated, a consequence elsewhere — POST a comment on it instead of a new finding:

curl -s -X POST '${endpoint}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '{"findings":[{"findingId":"<id>","comment":"What you found about it."}]}'

<prior-findings>
${priorFindings}
</prior-findings>`;
}

/** The shell command that shows the scope's changes — what the agent is told to run first. */
export function getDeepReviewDiffCommand(scope: ScopeSelection, lhs: string, rhs: string): string {
	if (scope.type === 'commit') return `git show ${scope.sha}`;
	if (scope.type === 'compare') return `git diff ${scope.fromSha}..${scope.toSha}`;

	if (rhs === uncommitted) return lhs === uncommittedStaged ? 'git diff' : `git diff ${lhs}`;
	if (rhs === uncommittedStaged) return `git diff --cached ${lhs === 'HEAD' ? '' : lhs}`.trim();
	return `git diff ${lhs}..${rhs}`;
}
