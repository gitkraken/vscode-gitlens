import type { AIReviewFinding, AIReviewFindingLocation, AIReviewSeverity } from '@gitlens/ai/models/results.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { DeepReviewAnchor, DeepReviewState, ScopeSelection } from './graphService.js';

/** Where a delegated deep review reports findings: each channel takes a route of its own under this,
 *  so two graphs — or a channel left over from an earlier run — never take each other's reports */
export const deepReviewRoute = 'review/findings';

/** The slice of the IPC service the channel needs — a route it can own and the address the agent is told. */
export interface DeepReviewIpc {
	readonly address: string | undefined;
	readonly token: string | undefined;
	registerHandler<Request, Response>(
		name: string,
		handler: (request: Request | undefined, searchParams: URLSearchParams) => Promise<Response>,
	): UnifiedDisposable;
}

/** One deep review's report channel: owns the IPC route while open, keeps what the agent reported
 *  (append-only, sequenced), and tells its owner on every change. The route closes on `done` or
 *  {@link close}; what was reported stays readable. */
export class DeepReviewChannel {
	private readonly _state: DeepReviewState;
	private _route: UnifiedDisposable | undefined;
	/** This channel's own route — the one the agent is told to POST to */
	readonly route: string;

	constructor(
		ipc: DeepReviewIpc,
		run: number,
		anchor: DeepReviewAnchor,
		private readonly onChange: (state: DeepReviewState) => void,
		id: string,
	) {
		this._state = { run: run, anchor: anchor, active: true, done: false, findings: [], notes: [] };
		this.route = `${deepReviewRoute}/${id}`;
		this._route = ipc.registerHandler<DeepReviewReport, { accepted: number }>(this.route, rq =>
			Promise.resolve({ accepted: this.report(rq) }),
		);
		Logger.debug(`DeepReview(run ${run}): open at /${this.route} for ${anchor.kind} ${anchor.repoPath}`);
	}

	get state(): DeepReviewState {
		return { ...this._state, findings: [...this._state.findings], notes: [...this._state.notes] };
	}

	/** Takes a report in: returns how many findings and notes it kept. A report after the channel closed is dropped. */
	report(body: DeepReviewReport | undefined): number {
		if (!this._state.active) return 0;

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
			this.close();
			return accepted;
		}

		this.onChange(this.state);
		return accepted;
	}

	/** Closes the route; reports after this are dropped. Notifies once, on the first close. */
	close(): void {
		if (!this._state.active) return;

		Logger.debug(`DeepReview(run ${this._state.run}): closed with ${this._state.findings.length} findings`);
		this._state.active = false;
		this._route?.dispose();
		this._route = undefined;
		this.onChange(this.state);
	}
}

/** What an agent POSTs to the deep-review channel; anything else in the body is ignored. */
export interface DeepReviewReport {
	findings?: unknown;
	done?: unknown;
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

/** The finding's places: `file`/`lines` first, then `locations`, each place once. */
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
	return `A review of the diff alone has already run. Its findings are below, each with its id, its state — open, or resolved or dismissed by the reader — and what the reader said about it. Do not report any of them again. Use them as leads: verify each in the repository — read the callers, run the tests — and report what the diff alone could not show. A dismissed finding was judged wrong or not worth doing; take the reader's word on it unless you have evidence to the contrary.

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
