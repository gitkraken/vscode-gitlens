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

/** Shared range policy for the XML and JSON parse routes: no usable start → no range; a missing
 *  or unusable end collapses to start */
function normalizeLineRange(
	start: number | undefined,
	end: number | undefined,
): { start: number; end: number } | undefined {
	if (start == null || !Number.isFinite(start)) return undefined;

	// Truncate and clamp — prompt-only providers can emit fractional or reversed bounds
	start = Math.trunc(start);
	const resolved = end != null && Number.isFinite(end) ? Math.trunc(end) : start;
	return { start: start, end: Math.max(start, resolved) };
}

function parseLineRange(value: string | undefined): { start: number; end: number } | undefined {
	if (!value) return undefined;

	const parts = value.split('-');
	return normalizeLineRange(parseInt(parts[0], 10), parts.length > 1 ? parseInt(parts[1], 10) : undefined);
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

function serializeFindingJson(finding: AIReviewFinding): ReviewFindingJson {
	return {
		severity: finding.severity,
		title: finding.title,
		description: finding.description,
		file: finding.filePath ?? null,
		lines: finding.lineRange != null ? { start: finding.lineRange.start, end: finding.lineRange.end } : null,
	};
}

/** Inverse of {@link parseReviewResultJson} — emits the same JSON shape the review prompt templates
 *  instruct (and the schemas enforce), so a prior result can be replayed as an assistant turn in a
 *  follow-up conversation without contradicting the format the model is being asked to produce. */
export function serializeReviewResult(result: AIReviewResult): string {
	const json: ReviewResultJson = {
		overview: result.overview,
		focusAreas: result.focusAreas.map(area => ({
			label: area.label,
			rationale: area.rationale,
			severity: area.severity,
			files: [...area.files],
			findings: area.findings?.map(serializeFindingJson) ?? null,
		})),
	};

	return JSON.stringify(json, undefined, 2);
}

export function parseReviewDetailResult(result: string, focusAreaId: string): AIReviewDetailResult {
	result = result.trim();

	const findingsBlock = result.match(findingsBlockRegex)?.[1] ?? result;
	const findings = parseFindings(findingsBlock, focusAreaId);

	return { findings: findings };
}

interface ReviewFindingJson {
	severity?: string;
	title?: string;
	description?: string;
	file?: string | null;
	lines?: { start?: number; end?: number } | null;
}

interface ReviewResultJson {
	overview?: string;
	focusAreas?:
		| {
				label?: string;
				rationale?: string;
				severity?: string;
				files?: (string | null)[] | null;
				findings?: ReviewFindingJson[] | null;
		  }[]
		| null;
}

const fencedJsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;

/** Returns the contents of the first fenced code block, or the trimmed input when unfenced */
export function stripJsonCodeFence(text: string): string {
	const fenced = fencedJsonBlockRegex.exec(text);
	return (fenced?.[1] ?? text).trim();
}

/**
 * Extracts the first JSON object from the text — tolerating code fences and surrounding prose,
 * since providers without native schema enforcement often wrap the object in explanatory text.
 * Pass `isExpectedShape` so prose braces and stray JSON fragments (including complete nested
 * objects inside truncated output) can't be mistaken for the payload.
 */
export function extractJsonObject(
	text: string,
	isExpectedShape?: (parsed: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
	text = text.trim();

	let parsed = tryParseObject(text, isExpectedShape);
	if (parsed != null) return parsed;

	parsed = tryParseObject(stripJsonCodeFence(text), isExpectedShape);
	if (parsed != null) return parsed;

	// Fall back to balanced objects embedded in surrounding prose, trying each candidate start —
	// prose braces may be unbalanced (`render() {`) or parse to a different shape than expected
	let index = text.indexOf('{');
	while (index !== -1) {
		const balanced = extractBalancedObject(text, index);
		if (balanced != null) {
			parsed = tryParseObject(balanced, isExpectedShape);
			if (parsed != null) return parsed;
		}

		index = text.indexOf('{', index + 1);
	}

	return undefined;
}

function tryParseObject(
	text: string,
	isExpectedShape?: (parsed: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
	if (!text.startsWith('{')) return undefined;

	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return undefined;

		const obj = parsed as Record<string, unknown>;
		return isExpectedShape == null || isExpectedShape(obj) ? obj : undefined;
	} catch {
		return undefined;
	}
}

function extractBalancedObject(text: string, start: number): string | undefined {
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}

		if (inString) {
			if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) return text.substring(start, i + 1);
		}
	}

	return undefined;
}

/** Guards schema-typed string fields against non-string values from prompt-only providers */
function trimmedString(value: unknown): string | undefined {
	return typeof value === 'string' ? value.trim() : undefined;
}

/** Line numbers are integers per the schema, but prompt-only providers can emit numeric strings */
function coerceLineNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return parseInt(value, 10);
	return undefined;
}

// Normalizes schema null-unions (null → undefined) and synthesizes the same 1-based positional ids
// as the XML parsers, so ids stay stable regardless of which parse route handled the response
function normalizeFindingJson(finding: ReviewFindingJson, id: string): AIReviewFinding {
	return {
		id: id,
		severity: parseSeverity(trimmedString(finding.severity)),
		title: trimmedString(finding.title) || 'Untitled finding',
		description: trimmedString(finding.description) ?? '',
		filePath: trimmedString(finding.file) || undefined,
		lineRange: normalizeLineRange(coerceLineNumber(finding.lines?.start), coerceLineNumber(finding.lines?.end)),
	};
}

/** Parses a review result, preferring the JSON shape and falling back to the legacy XML format */
export function parseReviewResultJson(result: string, mode: 'single-pass' | 'two-pass'): AIReviewResult {
	// An empty response is never a valid review — don't render it as a clean "no issues" result
	if (!result.trim()) throw new Error('The AI model returned an empty response');

	const parsed = extractJsonObject(result, o => typeof o.overview === 'string' || Array.isArray(o.focusAreas)) as
		| ReviewResultJson
		| undefined;
	const overview = typeof parsed?.overview === 'string' ? parsed.overview.trim() : undefined;
	const areas = Array.isArray(parsed?.focusAreas) ? parsed.focusAreas : undefined;

	if (overview == null && areas == null) {
		const fallback = parseReviewResult(result, mode);
		// A non-empty response matching neither shape is malformed (e.g. truncated JSON) — surface
		// that rather than rendering it as a clean "no issues" review
		if (!fallback.overview && fallback.focusAreas.length === 0 && !result.includes('<overview')) {
			throw new Error('Unable to parse the review response from the AI model');
		}
		return fallback;
	}

	const focusAreas: AIReviewFocusArea[] = [];
	let areaIndex = 0;

	for (const area of areas ?? []) {
		if (area == null || typeof area !== 'object') continue;

		areaIndex++;
		// Finding ids MUST stay namespaced by area id — dismissed findings are tracked in one flat
		// set spanning all areas, so bare per-area indices would collide across areas
		const id = `area-${areaIndex}`;

		const findings = Array.isArray(area.findings)
			? area.findings.filter((f): f is ReviewFindingJson => f != null && typeof f === 'object')
			: undefined;

		focusAreas.push({
			id: id,
			label: trimmedString(area.label) || 'Untitled area',
			rationale: trimmedString(area.rationale) ?? '',
			severity: parseSeverity(trimmedString(area.severity)),
			files: Array.isArray(area.files)
				? area.files.map(f => trimmedString(f)).filter((f): f is string => Boolean(f))
				: [],
			findings: findings?.map((f, i) => normalizeFindingJson(f, `${id}-f${i + 1}`)),
		});
	}

	return { overview: overview ?? '', focusAreas: focusAreas, mode: mode };
}

/** Parses a review detail result, preferring the JSON shape and falling back to the legacy XML format */
export function parseReviewDetailResultJson(result: string, focusAreaId: string): AIReviewDetailResult {
	// An empty response is never a valid result — don't render it as "no findings"
	if (!result.trim()) throw new Error('The AI model returned an empty response');

	const parsed = extractJsonObject(result, o => o.findings === null || Array.isArray(o.findings)) as
		| { findings?: ReviewFindingJson[] | null }
		| undefined;
	// Tolerate the sibling result schema's null-union — a null `findings` means "no findings"
	if (parsed?.findings === null) return { findings: [] };

	if (parsed == null || !Array.isArray(parsed.findings)) {
		const fallback = parseReviewDetailResult(result, focusAreaId);
		// Same malformed-response guard as parseReviewResultJson above; an empty legacy
		// `<findings>` block is a legitimate "no findings" response, not a parse failure
		if (fallback.findings.length === 0 && !result.includes('<findings')) {
			throw new Error('Unable to parse the review response from the AI model');
		}
		return fallback;
	}

	return {
		findings: parsed.findings
			.filter((f): f is ReviewFindingJson => f != null && typeof f === 'object')
			.map((f, i) => normalizeFindingJson(f, `${focusAreaId}-f${i + 1}`)),
	};
}
