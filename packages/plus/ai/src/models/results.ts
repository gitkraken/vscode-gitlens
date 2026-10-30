export type AISummarizedResult = { summary: string; body: string };

export type AIReviewSeverity = 'critical' | 'warning' | 'suggestion';

/** One place a finding holds: a file, and the lines in it when the finding is tied to lines. */
export interface AIReviewFindingLocation {
	readonly filePath: string;
	readonly lineRange?: { readonly start: number; readonly end: number };
}

export interface AIReviewFinding {
	readonly id: string;
	readonly severity: AIReviewSeverity;
	readonly title: string;
	/** Whether `title` is a synthetic protocol fallback and should be localized at presentation boundaries. */
	readonly titleIsFallback?: boolean;
	readonly description: string;
	/** The finding's first place — see {@link locations} for all of them */
	readonly filePath?: string;
	readonly lineRange?: { readonly start: number; readonly end: number };
	/** Every place the finding holds, the first being `filePath`/`lineRange` — present only when there is
	 *  more than one (the same mistake repeated, a contract broken on both of its sides). One finding,
	 *  marked at each place. */
	readonly locations?: readonly AIReviewFindingLocation[];
	/** Who produced the finding; absent = the model's own review run. `agent` = reported back by a
	 *  delegated deep review, which could build, test and read beyond the diff. `user` = the reader's own
	 *  comment on a line of the diff — no severity of its own, the text is the description. */
	readonly source?: 'agent' | 'user';
}

/** Every place a finding holds — `locations` when it has several, else its one file (none for a general remark). */
export function getReviewFindingLocations(finding: AIReviewFinding): readonly AIReviewFindingLocation[] {
	if (finding.locations?.length) return finding.locations;
	if (finding.filePath == null) return [];

	return [{ filePath: finding.filePath, lineRange: finding.lineRange }];
}

export interface AIReviewFocusArea {
	readonly id: string;
	readonly label: string;
	/** Whether `label` is a synthetic protocol fallback and should be localized at presentation boundaries. */
	readonly labelIsFallback?: boolean;
	readonly rationale: string;
	readonly severity: AIReviewSeverity;
	readonly files: readonly string[];
	readonly findings?: readonly AIReviewFinding[];
}

export interface AIReviewResult {
	readonly overview: string;
	readonly focusAreas: readonly AIReviewFocusArea[];
	readonly mode: 'single-pass' | 'two-pass';
}

export interface AIReviewDetailResult {
	readonly findings: readonly AIReviewFinding[];
}

/** One stop of an orient pass: a file and the one line that says why it is in the change. */
export interface AIReviewOrientFile {
	readonly path: string;
	readonly note: string;
}

export type AIReviewOrientGroupKind = 'core' | 'supporting' | 'mechanical';

export interface AIReviewOrientGroup {
	readonly id: string;
	readonly label: string;
	readonly labelIsFallback?: boolean;
	/** `core` = read first, `supporting` = follows from the core, `mechanical` = skim (lockfiles, generated, renames) —
	 *  orders the groups; the reader sees the label and summary, not the kind */
	readonly kind: AIReviewOrientGroupKind;
	/** A sentence or two on what this group changes and why its files belong together */
	readonly summary: string;
	readonly files: readonly AIReviewOrientFile[];
}

/** The orient pass's output: not a verdict, a reading order — groups in the order to read them. */
export interface AIReviewOrientResult {
	readonly overview: string;
	readonly groups: readonly AIReviewOrientGroup[];
}
