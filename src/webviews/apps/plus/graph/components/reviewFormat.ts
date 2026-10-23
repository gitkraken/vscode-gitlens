import * as l10n from '@vscode/l10n';
import type {
	AIReviewFinding,
	AIReviewFocusArea,
	AIReviewResult,
	AIReviewSeverity,
} from '@gitlens/ai/models/results.js';
import { getReviewFindingLocations } from '@gitlens/ai/models/results.js';
import type { ReviewFindingNote } from '../../../../plus/graph/graphService.js';
import type { ReviewFindingState } from './reviewSession.js';

export interface ReviewFormatOptions {
	scopeLabel: string;
	dismissed?: ReadonlySet<string>;
	/** Notes by finding id — the reader's replies and the agent's additions go out with the finding */
	notes?: ReadonlyMap<string, readonly ReviewFindingNote[]>;
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

function noteAuthor(author: ReviewFindingNote['author']): string {
	return author === 'agent' ? l10n.t('Agent') : l10n.t('Reviewer');
}

function formatFindingLines(finding: AIReviewFinding, notes?: readonly ReviewFindingNote[]): string[] {
	const lines: string[] = [];
	lines.push(`### ${severityPrefix(finding.severity)} ${getReviewFindingTitle(finding)}`);
	lines.push('');
	lines.push(finding.description);
	const locations = getReviewFindingLocations(finding).map(l => {
		const range = formatLineRange(l.lineRange);
		return `${l.filePath}${range ? `:${range}` : ''}`;
	});
	if (locations.length === 1) {
		lines.push('');
		lines.push(l10n.t('File: `{location}`', { location: locations[0] }));
	} else if (locations.length > 1) {
		lines.push('');
		lines.push(l10n.t('Files: {locations}', { locations: locations.map(l => `\`${l}\``).join(', ') }));
	}
	if (notes?.length) {
		lines.push('');
		for (const note of notes) {
			lines.push(`> **${noteAuthor(note.author)}:** ${note.text.replace(/\n/g, '\n> ')}`);
		}
	}
	return lines;
}

export function formatFindingAsMarkdown(
	finding: AIReviewFinding,
	enclosingArea?: Pick<AIReviewFocusArea, 'label' | 'labelIsFallback' | 'rationale'>,
	notes?: readonly ReviewFindingNote[],
): string {
	const lines: string[] = [];
	if (enclosingArea) {
		lines.push(`## ${getReviewFocusAreaLabel(enclosingArea)}`);
		lines.push('');
		lines.push(enclosingArea.rationale);
		lines.push('');
	}
	lines.push(...formatFindingLines(finding, notes));
	return lines.join('\n');
}

export function formatFocusAreaAsMarkdown(
	area: AIReviewFocusArea,
	dismissed?: ReadonlySet<string>,
	notes?: ReadonlyMap<string, readonly ReviewFindingNote[]>,
): string {
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
		lines.push(...formatFindingLines(finding, notes?.get(finding.id)));
	}
	return lines.join('\n');
}

/** The findings as context for a review that comes after: every one, open or closed, with its id (so the
 *  agent can add to it), its state and the notes on it. Plain lines, not the reader's markdown. */
export function formatReviewForAgentContext(
	result: AIReviewResult,
	states: ReadonlyMap<string, ReviewFindingState> | undefined,
	notes: ReadonlyMap<string, readonly ReviewFindingNote[]> | undefined,
): string {
	const lines: string[] = [];
	for (const area of result.focusAreas) {
		for (const finding of area.findings ?? []) {
			const location = getReviewFindingLocations(finding)
				.map(l => {
					const range = formatLineRange(l.lineRange);
					return `${l.filePath}${range ? `:${range}` : ''}`;
				})
				.join(', ');
			const state = states?.get(finding.id) ?? 'open';
			const head = [`id: ${finding.id}`, `[${severityLabel[finding.severity]}]`, state, location]
				.filter(Boolean)
				.join(' · ');
			if (lines.length) {
				lines.push('');
			}
			lines.push(`- ${head}`);
			lines.push(`  ${getReviewFindingTitle(finding)} — ${finding.description.replace(/\n+/g, ' ')}`);
			for (const note of notes?.get(finding.id) ?? []) {
				lines.push(`  > ${noteAuthor(note.author)}: ${note.text.replace(/\n+/g, ' ')}`);
			}
		}
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
		lines.push(formatFocusAreaAsMarkdown(area, options.dismissed, options.notes));
	}

	return lines.join('\n');
}
