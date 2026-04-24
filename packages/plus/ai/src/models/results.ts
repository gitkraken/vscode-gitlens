export type AISummarizedResult = { summary: string; body: string };

export type AIReviewSeverity = 'critical' | 'warning' | 'suggestion';

export interface AIReviewFinding {
	readonly id: string;
	readonly severity: AIReviewSeverity;
	readonly title: string;
	readonly description: string;
	readonly filePath?: string;
	readonly lineRange?: { readonly start: number; readonly end: number };
}

export interface AIReviewFocusArea {
	readonly id: string;
	readonly label: string;
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
