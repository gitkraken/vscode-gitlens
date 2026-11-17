import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

type ToolInput = { file_path?: string; old_string?: string; new_string?: string; content?: string };
type HookInput = { tool_name?: string; tool_input?: ToolInput };
type CommentLine = { index: number; line: string; text: string; trailing: boolean };
type Block = { lines: CommentLine[] };

const sourceRegex = /\.(?:[cm]?[jt]s|tsx)$/;
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

function findTrailingComment(line: string): number {
	let quote: string | undefined;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote != null) {
			if (ch === '\\') {
				i++;
			} else if (ch === quote) {
				quote = undefined;
			}
			continue;
		}

		if (ch === '"' || ch === "'" || ch === '`') {
			quote = ch;
		} else if (ch === '/' && line[i + 1] === '/' && line[i - 1] !== ':') {
			return i;
		}
	}
	return -1;
}

function stripMarkers(text: string): string {
	return text
		.replace(/^\s*(?:\/\/+|\{?\/\*+|\*+(?!\/))?\s*/, '')
		.replace(/\s*\*+\/\}?\s*$/, '')
		.trim();
}

export function findCommentLines(src: string): CommentLine[] {
	const result: CommentLine[] = [];
	let inBlock = false;

	const lines = src.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const trimmed = line.trim();

		if (inBlock) {
			result.push({ index: index, line: trimmed, text: trimmed, trailing: false });
			if (trimmed.includes('*/')) {
				inBlock = false;
			}
			continue;
		}

		if (trimmed.startsWith('//')) {
			result.push({ index: index, line: trimmed, text: trimmed, trailing: false });
		} else if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
			result.push({ index: index, line: trimmed, text: trimmed, trailing: false });
			inBlock = !trimmed.includes('*/', 2);
		} else {
			const at = findTrailingComment(line);
			if (at !== -1) {
				result.push({ index: index, line: trimmed, text: line.slice(at).trim(), trailing: true });
			}
		}
	}
	return result;
}

function groupBlocks(lines: CommentLine[]): Block[] {
	const blocks: Block[] = [];
	let current: Block | undefined;
	let previous: CommentLine | undefined;

	for (const line of lines) {
		if (
			current == null ||
			previous == null ||
			line.trailing ||
			previous.trailing ||
			line.index !== previous.index + 1
		) {
			current = { lines: [] };
			blocks.push(current);
		}
		current.lines.push(line);
		previous = line;
	}
	return blocks;
}

function trimmedLines(src: string): Set<string> {
	return new Set(src.split(/\r?\n/).map(l => l.trim()));
}

export function checkAdded(newText: string, oldText: string | undefined, fileText: string | undefined) {
	const known = oldText != null ? trimmedLines(oldText) : new Set<string>();
	const fileLines = fileText?.split(/\r?\n/).map(l => l.trim());

	const untagged: string[] = [];
	const tooLong: string[] = [];

	for (const block of groupBlocks(findCommentLines(newText))) {
		if (!block.lines.some(l => !known.has(l.line))) continue;
		if (block.lines.some(l => exemptMarkers.some(m => l.text.includes(m)))) continue;

		const texts = block.lines.map(l => stripMarkers(l.text)).filter(t => t.length > 0);
		const tagged = texts.length > 0 && tagRegex.test(texts[0]);
		if (tagged && texts.length <= 2) continue;

		const first = (block.lines.find(l => stripMarkers(l.text).length > 0) ?? block.lines[0]).line;
		const found = fileLines?.indexOf(first) ?? -1;
		const entry = `${found !== -1 ? `${found + 1}: ` : ''}${first.slice(0, 100)}`;
		(tagged ? tooLong : untagged).push(entry);
	}

	return { untagged: untagged, tooLong: tooLong };
}

export function formatReport(untagged: string[], tooLong: string[]): string {
	const parts: string[] = [];
	if (untagged.length) {
		parts.push(`Added comments without a HACK:/KEEP:/SEE:/TODO: tag:\n${untagged.map(e => `  ${e}`).join('\n')}`);
	}
	if (tooLong.length) {
		parts.push(`Tagged comments longer than two lines:\n${tooLong.map(e => `  ${e}`).join('\n')}`);
	}
	parts.push(guidance);
	return parts.join('\n\n');
}

function main(): number {
	let input: HookInput;
	try {
		input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
	} catch {
		return 0;
	}

	const toolInput = input?.tool_input;
	const path = toolInput?.file_path;
	if (path == null || !sourceRegex.test(path)) return 0;

	let fileText: string | undefined;
	try {
		fileText = readFileSync(path, 'utf8');
	} catch {
		fileText = undefined;
	}

	let newText: string | undefined;
	let oldText: string | undefined;
	if (input.tool_name === 'Edit') {
		newText = toolInput?.new_string;
		oldText = toolInput?.old_string ?? '';
	} else if (input.tool_name === 'Write') {
		newText = toolInput?.content;
		try {
			oldText = execFileSync('git', ['show', `HEAD:./${basename(path)}`], {
				cwd: dirname(path),
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				maxBuffer: 64 * 1024 * 1024,
			});
		} catch {
			oldText = undefined;
		}
	}
	if (typeof newText !== 'string') return 0;

	const { untagged, tooLong } = checkAdded(newText, oldText, fileText);
	if (!untagged.length && !tooLong.length) return 0;

	console.error(formatReport(untagged, tooLong));
	return 2;
}

if (process.argv[1]?.endsWith('comment-guard.mts')) {
	process.exit(main());
}
