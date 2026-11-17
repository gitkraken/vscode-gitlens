import { readFileSync } from 'node:fs';

const sourceRegex = /\.(?:[cm]?[jt]s|tsx)$/;
const commentMarkerRegex = /\/\/|\/\*|\*\/|^\s*\*/m;
const tagRegex = /^(?:HACK|KEEP|SEE|TODO)(?:(?:@[\w-]+|\([^)]*\)):?|:)/;
const exemptMarkers = [
	'oxlint-disable',
	'oxlint-enable',
	'eslint-disable',
	'eslint-enable',
	'stylelint-disable',
	'stylelint-enable',
	'@ts-expect-error',
	'@ts-ignore',
	'@ts-nocheck',
	'/// <reference',
	'webpackChunkName',
	'webpackIgnore',
	'webpackMode',
	'@vite-ignore',
	'@__PURE__',
	'#__PURE__',
	'@__NO_SIDE_EFFECTS__',
	'Copyright',
	'@license',
	'#region',
	'#endregion',
	'@tag',
	'@fires',
	'@slot',
	'@cssprop',
	'@cssproperty',
	'@csspart',
	'@deprecated',
	'@internal',
	'@type',
	'@param {',
	'@returns {',
	'@typedef',
	'@template',
];
const guidance =
	"Comments are off by default here (docs/coding-standards.md § Comments). Delete a comment that describes this repo's code and let names carry it. Keep one only as HACK: (don't copy this), KEEP: (don't simplify this — state the constraint), SEE: (outside fact + source) or TODO: (gap outside the task), in one line, two at most. Ignore this for doc comments on the exported API of a published @gitkraken/* package.";

function stripMarkers(text) {
	return text
		.replace(/^\s*(?:\/\/+|\{?\/\*+|\*+(?!\/))?\s*/, '')
		.replace(/\s*\*+\/\}?\s*$/, '')
		.trim();
}

function langFor(filePath) {
	if (filePath.endsWith('.tsx')) return 'tsx';
	return /\.[cm]?ts$/.test(filePath) ? 'ts' : 'jsx';
}

function buildBlocks(text, filePath, parseSync) {
	const { comments } = parseSync(filePath, text, { lang: langFor(filePath) });
	const blocks = [];
	let line = 1;
	let position = 0;
	let previous;

	for (const comment of comments) {
		for (let i = text.indexOf('\n', position); i !== -1 && i < comment.start; i = text.indexOf('\n', i + 1)) {
			line++;
		}
		position = comment.start;

		if (comment.type === 'Line') {
			const lineStart = text.lastIndexOf('\n', comment.start - 1) + 1;
			const alone = text.slice(lineStart, comment.start).trim() === '';
			if (alone && previous?.mergeable && previous.endLine === line - 1) {
				previous.comments.push(comment);
				previous.endLine = line;
				previous.end = comment.end;
				continue;
			}

			previous = {
				line: line,
				endLine: line,
				mergeable: alone,
				start: comment.start,
				end: comment.end,
				comments: [comment],
			};
			blocks.push(previous);
			continue;
		}

		previous = {
			line: line,
			endLine: line,
			mergeable: false,
			start: comment.start,
			end: comment.end,
			comments: [comment],
		};
		blocks.push(previous);
	}
	return blocks;
}

function describe(block, text) {
	const rows = [];
	let line = block.line;
	for (const comment of block.comments) {
		if (comment.type === 'Line') {
			rows.push({ line: line++, text: stripMarkers(`//${comment.value}`) });
			continue;
		}

		for (const part of comment.value.split(/\r?\n/)) {
			rows.push({ line: line++, text: part.replace(/^\s*\*+/, '').trim() });
		}
	}

	block.raw = unindent(text.slice(block.start, block.end));
	block.rows = rows.filter(r => r.text.length > 0);
}

function unindent(text) {
	return text.replace(/\r/g, '').replace(/^[ \t]+/gm, '');
}

function changedRange(oldText, newText) {
	const limit = Math.min(oldText.length, newText.length);
	let start = 0;
	while (start < limit && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
		start++;
	}

	let tail = 0;
	while (
		tail < limit - start &&
		oldText.charCodeAt(oldText.length - 1 - tail) === newText.charCodeAt(newText.length - 1 - tail)
	) {
		tail++;
	}
	return { start: start, end: newText.length - tail };
}

function countOccurrences(text, part) {
	let count = 0;
	for (let i = text.indexOf(part); i !== -1; i = text.indexOf(part, i + part.length)) {
		count++;
	}
	return count;
}

export function findReportable(oldText, newText, filePath, parseSync) {
	const changed = changedRange(oldText, newText);
	const candidates = [];
	for (const block of buildBlocks(newText, filePath, parseSync)) {
		if (block.end < changed.start || block.start > changed.end) continue;

		describe(block, newText);
		if (exemptMarkers.some(m => block.raw.includes(m))) continue;

		const tagged = block.rows.length > 0 && tagRegex.test(block.rows[0].text);
		if (tagged && block.rows.length <= 2) continue;

		candidates.push({ block: block, tagged: tagged });
	}

	const untagged = [];
	const tooLong = [];
	if (!candidates.length) return { untagged: untagged, tooLong: tooLong };

	const oldUnindented = unindent(oldText);
	const newUnindented = unindent(newText);
	const sourceLines = newText.split(/\r?\n/);
	const oldLines = changed.end === changed.start ? new Set(oldUnindented.split('\n')) : undefined;
	const surplus = new Map();
	for (const { block, tagged } of candidates) {
		if (oldLines != null && block.raw.split('\n').every(l => oldLines.has(l))) continue;

		const remaining =
			surplus.get(block.raw) ??
			countOccurrences(newUnindented, block.raw) - countOccurrences(oldUnindented, block.raw);
		surplus.set(block.raw, remaining - 1);
		if (remaining <= 0) continue;

		const line = block.rows[0]?.line ?? block.line;
		const entry = `${line}: ${(sourceLines[line - 1] ?? '').trim().slice(0, 100)}`;
		(tagged ? tooLong : untagged).push(entry);
	}
	return { untagged: untagged, tooLong: tooLong };
}

export function formatReport(untagged, tooLong) {
	const parts = [];
	if (untagged.length) {
		parts.push(`Added comments without a HACK:/KEEP:/SEE:/TODO: tag:\n${untagged.map(e => `  ${e}`).join('\n')}`);
	}
	if (tooLong.length) {
		parts.push(`Tagged comments longer than two lines:\n${tooLong.map(e => `  ${e}`).join('\n')}`);
	}
	parts.push(guidance);
	return parts.join('\n\n');
}

export function editMayTouchComment(original, oldString, newString, replaceAll) {
	if (replaceAll || typeof oldString !== 'string' || typeof newString !== 'string' || oldString === '') return true;
	if (commentMarkerRegex.test(oldString) || commentMarkerRegex.test(newString)) return true;

	const index = original.indexOf(oldString);
	if (index === -1) return true;

	const lineStart = original.lastIndexOf('\n', index - 1) + 1;
	if (original.slice(lineStart, index).includes('//')) return true;

	return original.lastIndexOf('/*', index) > original.lastIndexOf('*/', index);
}

function applyEdit(original, oldString, newString, replaceAll) {
	if (typeof oldString !== 'string' || typeof newString !== 'string') return undefined;
	if (oldString === '') return original === '' ? newString : undefined;

	if (replaceAll) return original.split(oldString).join(newString);

	const index = original.indexOf(oldString);
	if (index === -1) return original;
	return original.slice(0, index) + newString + original.slice(index + oldString.length);
}

async function main() {
	let input;
	try {
		input = JSON.parse(readFileSync(0, 'utf8'));
	} catch {
		return 0;
	}

	const toolInput = input?.tool_input;
	const path = toolInput?.file_path;
	if (typeof path !== 'string' || !sourceRegex.test(path)) return 0;

	let oldText;
	let newText;
	const response = input.tool_response;
	if (input.tool_name === 'Edit') {
		oldText = response?.originalFile;
		if (typeof oldText !== 'string') return 0;

		const oldString = response.oldString ?? toolInput.old_string;
		const newString = response.newString ?? toolInput.new_string;
		const replaceAll = toolInput.replace_all === true;
		if (!editMayTouchComment(oldText, oldString, newString, replaceAll)) return 0;

		newText = applyEdit(oldText, oldString, newString, replaceAll);
	} else if (input.tool_name === 'Write') {
		oldText = response?.originalFile ?? (response?.type === 'update' ? undefined : '');
		newText = toolInput.content;
	}
	if (typeof oldText !== 'string' || typeof newText !== 'string') return 0;
	if (newText === oldText || (!newText.includes('//') && !newText.includes('/*'))) return 0;

	let result;
	try {
		const { parseSync } = await import('oxc-parser');
		result = findReportable(oldText, newText, path, parseSync);
	} catch {
		return 0;
	}

	if (!result.untagged.length && !result.tooLong.length) return 0;

	console.error(formatReport(result.untagged, result.tooLong));
	return 2;
}

if (process.argv[1]?.endsWith('comment-guard.mjs')) {
	process.exit(await main());
}
