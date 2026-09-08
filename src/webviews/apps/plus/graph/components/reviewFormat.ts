import * as l10n from '@vscode/l10n';
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
	critical: l10n.t('CRITICAL'),
	warning: l10n.t('WARNING'),
	suggestion: l10n.t('SUGGESTION'),
};

function severityPrefix(severity: AIReviewSeverity): string {
	return `**[${severityLabel[severity]}]**`;
}

export function getReviewFindingTitle(finding: AIReviewFinding): string {
	return finding.titleIsFallback ? l10n.t('Untitled finding') : finding.title;
}

export function getReviewFocusAreaLabel(area: Pick<AIReviewFocusArea, 'label' | 'labelIsFallback'>): string {
	return area.labelIsFallback ? l10n.t('Untitled area') : area.label;
}

function formatLineRange(range: AIReviewFinding['lineRange']): string {
	if (range == null) return '';
	return range.end !== range.start ? `${range.start}-${range.end}` : `${range.start}`;
}

function formatFindingLines(finding: AIReviewFinding): string[] {
	const lines: string[] = [];
	lines.push(`### ${severityPrefix(finding.severity)} ${getReviewFindingTitle(finding)}`);
	lines.push('');
	lines.push(finding.description);
	if (finding.filePath) {
		const range = formatLineRange(finding.lineRange);
		lines.push('');
		const location = `${finding.filePath}${range ? `:${range}` : ''}`;
		lines.push(l10n.t('File: `{location}`', { location: location }));
	}
	return lines;
}

export function formatFindingAsMarkdown(
	finding: AIReviewFinding,
	enclosingArea?: Pick<AIReviewFocusArea, 'label' | 'labelIsFallback' | 'rationale'>,
): string {
	const lines: string[] = [];
	if (enclosingArea) {
		lines.push(`## ${getReviewFocusAreaLabel(enclosingArea)}`);
		lines.push('');
		lines.push(enclosingArea.rationale);
		lines.push('');
	}
	lines.push(...formatFindingLines(finding));
	return lines.join('\n');
}

export function formatFocusAreaAsMarkdown(area: AIReviewFocusArea, dismissed?: ReadonlySet<string>): string {
	const lines: string[] = [];
	lines.push(`## ${severityPrefix(area.severity)} ${getReviewFocusAreaLabel(area)}`);
	lines.push('');
	lines.push(area.rationale);

	if (area.files.length > 0) {
		lines.push('');
		lines.push(l10n.t('Files:'));
		for (const file of area.files) {
			lines.push(`- \`${file}\``);
		}
	}

	if (area.findings == null) {
		lines.push('');
		lines.push(`_${l10n.t('Not yet analyzed — run "Review Files" to generate findings for this focus area.')}_`);
		return lines.join('\n');
	}

	const visible = dismissed ? area.findings.filter(f => !dismissed.has(f.id)) : [...area.findings];
	if (visible.length === 0) {
		lines.push('');
		lines.push(`_${l10n.t('No findings.')}_`);
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
	lines.push(`# ${l10n.t('Code Review — {scope}', { scope: options.scopeLabel })}`);

	if (result.overview) {
		lines.push('');
		lines.push(result.overview);
	}

	if (result.focusAreas.length === 0) {
		lines.push('');
		lines.push(`_${l10n.t('No issues found. The changes look good!')}_`);
		return lines.join('\n');
	}

	for (const area of result.focusAreas) {
		lines.push('');
		lines.push(formatFocusAreaAsMarkdown(area, options.dismissed));
	}

	return lines.join('\n');
}
