import type {
	AIReviewFinding,
	AIReviewFocusArea,
	AIReviewResult,
	AIReviewSeverity,
} from '@gitlens/ai/models/results.js';

export interface ReviewFormatOptions {
	scopeLabel: string;
	dismissed?: ReadonlySet<string>;
}

const severityLabel: Record<AIReviewSeverity, string> = {
	critical: 'CRITICAL',
	warning: 'WARNING',
	suggestion: 'SUGGESTION',
};

function severityPrefix(severity: AIReviewSeverity): string {
	return `**[${severityLabel[severity]}]**`;
}

function formatLineRange(range: AIReviewFinding['lineRange']): string {
	if (range == null) return '';
	return range.end !== range.start ? `${range.start}-${range.end}` : `${range.start}`;
}

function formatFindingLines(finding: AIReviewFinding): string[] {
	const lines: string[] = [];
	lines.push(`### ${severityPrefix(finding.severity)} ${finding.title}`);
	lines.push('');
	lines.push(finding.description);
	if (finding.filePath) {
		const range = formatLineRange(finding.lineRange);
		lines.push('');
		lines.push(`File: \`${finding.filePath}${range ? `:${range}` : ''}\``);
	}
	return lines;
}

export function formatFindingAsMarkdown(
	finding: AIReviewFinding,
	enclosingArea?: Pick<AIReviewFocusArea, 'label' | 'rationale'>,
): string {
	const lines: string[] = [];
	if (enclosingArea) {
		lines.push(`## ${enclosingArea.label}`);
		lines.push('');
		lines.push(enclosingArea.rationale);
		lines.push('');
	}
	lines.push(...formatFindingLines(finding));
	return lines.join('\n');
}

export function formatFocusAreaAsMarkdown(area: AIReviewFocusArea, dismissed?: ReadonlySet<string>): string {
	const lines: string[] = [];
	lines.push(`## ${severityPrefix(area.severity)} ${area.label}`);
	lines.push('');
	lines.push(area.rationale);

	if (area.files.length > 0) {
		lines.push('');
		lines.push('Files:');
		for (const file of area.files) {
			lines.push(`- \`${file}\``);
		}
	}

	if (area.findings == null) {
		lines.push('');
		lines.push('_Not yet analyzed — run "Review Files" to generate findings for this focus area._');
		return lines.join('\n');
	}

	const visible = dismissed ? area.findings.filter(f => !dismissed.has(f.id)) : [...area.findings];
	if (visible.length === 0) {
		lines.push('');
		lines.push('_No findings._');
		return lines.join('\n');
	}

	for (const finding of visible) {
		lines.push('');
		lines.push(...formatFindingLines(finding));
	}
	return lines.join('\n');
}

export function formatReviewAsMarkdown(result: AIReviewResult, options: ReviewFormatOptions): string {
	const lines: string[] = [];
	lines.push(`# Code Review — ${options.scopeLabel}`);

	if (result.overview) {
		lines.push('');
		lines.push(result.overview);
	}

	if (result.focusAreas.length === 0) {
		lines.push('');
		lines.push('_No issues found. The changes look good!_');
		return lines.join('\n');
	}

	for (const area of result.focusAreas) {
		lines.push('');
		lines.push(formatFocusAreaAsMarkdown(area, options.dismissed));
	}

	return lines.join('\n');
}
