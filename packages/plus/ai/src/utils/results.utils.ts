import type {
	AIReviewDetailResult,
	AIReviewFinding,
	AIReviewFocusArea,
	AIReviewResult,
	AIReviewSeverity,
} from '../models/results.js';

const summaryTagRegex = /<summary>([\s\S]*?)(?:<\/summary>|$)/;
const bodyTagRegex = /<body>([\s\S]*?)(?:<\/body>|$)/;
const codeBlockRegex = /```([\s\S]*?)```/;

export function parseSummarizeResult(result: string): { readonly summary: string; readonly body: string } {
	result = result.trim();
	const summary = result.match(summaryTagRegex)?.[1]?.trim() ?? undefined;
	if (summary != null) {
		result = result.replace(summaryTagRegex, '').trim();
	}

	let body = result.match(bodyTagRegex)?.[1]?.trim() ?? undefined;
	if (body != null) {
		result = result.replace(bodyTagRegex, '').trim();
	}

	// Check for self-closing body tag
	if (body == null && result.includes('<body/>')) {
		body = '';
	}

	// If both tags are present, return them
	if (summary != null && body != null) return { summary: summary, body: body };

	// If both tags are missing, split the result
	if (summary == null && body == null) return splitMessageIntoSummaryAndBody(result);

	// If only summary tag is present, use any remaining text as the body
	if (summary && body == null) {
		return result ? { summary: summary, body: result } : splitMessageIntoSummaryAndBody(summary);
	}

	// If only body tag is present, use the remaining text as the summary
	if (summary == null && body) {
		return result ? { summary: result, body: body } : splitMessageIntoSummaryAndBody(body);
	}

	return { summary: summary ?? '', body: body ?? '' };
}

export function splitMessageIntoSummaryAndBody(message: string): { readonly summary: string; readonly body: string } {
	message = message.replace(codeBlockRegex, '$1').trim();
	const index = message.indexOf('\n');
	if (index === -1) return { summary: message, body: '' };

	return {
		summary: message.substring(0, index).trim(),
		body: message.substring(index + 1).trim(),
	};
}

const overviewTagRegex = /<overview>([\s\S]*?)(?:<\/overview>|$)/;
const areaTagRegex = /<area\s+([^>]*)>([\s\S]*?)(?:<\/area>|$)/g;
const findingTagRegex = /<finding\s+([^>]*)>([\s\S]*?)(?:<\/finding>|$)/g;
const labelTagRegex = /<label>([\s\S]*?)(?:<\/label>|$)/;
const rationaleTagRegex = /<rationale>([\s\S]*?)(?:<\/rationale>|$)/;
const titleTagRegex = /<title>([\s\S]*?)(?:<\/title>|$)/;
const descriptionTagRegex = /<description>([\s\S]*?)(?:<\/description>|$)/;
const findingsBlockRegex = /<findings>([\s\S]*?)(?:<\/findings>|$)/;

function parseAttr(attrs: string, name: string): string | undefined {
	const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
	return match?.[1]?.trim() || undefined;
}

function parseSeverity(value: string | undefined): AIReviewSeverity {
	if (value === 'critical' || value === 'warning' || value === 'suggestion') return value;
	return 'suggestion';
}

function parseLineRange(value: string | undefined): { start: number; end: number } | undefined {
	if (!value) return undefined;
	const parts = value.split('-');
	const start = parseInt(parts[0], 10);
	if (isNaN(start)) return undefined;
	const end = parts.length > 1 ? parseInt(parts[1], 10) : start;
	return { start: start, end: isNaN(end) ? start : end };
}

function parseFindings(content: string, idPrefix: string): AIReviewFinding[] {
	const findings: AIReviewFinding[] = [];
	let findingIndex = 0;

	for (const match of content.matchAll(findingTagRegex)) {
		const attrs = match[1];
		const inner = match[2];
		findingIndex++;

		findings.push({
			id: `${idPrefix}-f${findingIndex}`,
			severity: parseSeverity(parseAttr(attrs, 'severity')),
			title: inner.match(titleTagRegex)?.[1]?.trim() ?? 'Untitled finding',
			description: inner.match(descriptionTagRegex)?.[1]?.trim() ?? '',
			filePath: parseAttr(attrs, 'file'),
			lineRange: parseLineRange(parseAttr(attrs, 'lines')),
		});
	}

	return findings;
}

export function parseReviewResult(result: string, mode: 'single-pass' | 'two-pass'): AIReviewResult {
	result = result.trim();

	const overview = result.match(overviewTagRegex)?.[1]?.trim() ?? '';

	const focusAreas: AIReviewFocusArea[] = [];
	let areaIndex = 0;

	for (const match of result.matchAll(areaTagRegex)) {
		const attrs = match[1];
		const inner = match[2];
		areaIndex++;

		const id = `area-${areaIndex}`;
		const filesAttr = parseAttr(attrs, 'files');

		const findingsBlock = inner.match(findingsBlockRegex)?.[1];
		const findings = findingsBlock ? parseFindings(findingsBlock, id) : undefined;

		focusAreas.push({
			id: id,
			label: inner.match(labelTagRegex)?.[1]?.trim() ?? 'Untitled area',
			rationale: inner.match(rationaleTagRegex)?.[1]?.trim() ?? '',
			severity: parseSeverity(parseAttr(attrs, 'severity')),
			files: filesAttr?.split(',').map(f => f.trim()) ?? [],
			findings: findings,
		});
	}

	return { overview: overview, focusAreas: focusAreas, mode: mode };
}

export function parseReviewDetailResult(result: string, focusAreaId: string): AIReviewDetailResult {
	result = result.trim();

	const findingsBlock = result.match(findingsBlockRegex)?.[1] ?? result;
	const findings = parseFindings(findingsBlock, focusAreaId);

	return { findings: findings };
}
