import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Strips stray backticks from CSS comments inside Lit css`` tagged templates, and reports the ones
 * it can't safely fix.
 *
 * A backtick anywhere in such a template ends the literal. The rest of the CSS is then parsed as
 * TypeScript, producing nonsense errors pointing at fragments of your own property names ("Cannot
 * find name 'vscode'"), plus a "Class static side ... incorrectly extends" tell. The habit that
 * causes it is quoting identifiers in comments the way we do everywhere else in .ts files.
 *
 * Inside a comment a backtick is decorative — CSS ignores comment bodies — so removing it is
 * behavior-preserving and yields the house style (identifiers written bare). Escaping instead of
 * stripping was rejected: it reads badly and is easy to double-escape.
 *
 * Outside a comment a backtick is a genuine anomaly, so those are reported rather than rewritten.
 *
 * Scoped to css`` only — html`` templates legitimately nest other templates.
 */
interface PostToolUseInput {
	session_id: string;
	transcript_path: string;
	hook_event_name: 'PostToolUse';
	cwd: string;
	tool_input: { file_path?: string };
}

interface Result {
	/** Source with in-comment backticks removed. */
	output: string;
	/** 1-based lines a backtick was stripped from. */
	stripped: number[];
	/** Lines holding a backtick outside a comment that closes the literal early. */
	unfixable: number[];
}

// Excludes `.` and a preceding backtick so prose like "theme.css`" or "a `css` template" in a
// comment isn't mistaken for a tagged template.
const tagRegex = /(?<![\w$.`])css`/g;
// What may legally follow the end of a css`` literal.
const validAfterRegex = /^\s*[;,)\]}]/;

function lineAt(src: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (src[i] === '\n') line++;
	}
	return line;
}

/**
 * Walks each css`` template comment-aware: inside a CSS comment a backtick is a strippable mistake;
 * outside one, the first unescaped backtick is the literal's real end.
 */
export function scan(src: string): Result {
	const remove: number[] = [];
	const unfixable: number[] = [];

	tagRegex.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = tagRegex.exec(src)) != null) {
		let inComment = false;
		let end = -1;

		for (let i = match.index + match[0].length; i < src.length; i++) {
			const ch = src[i];

			if (ch === '\\') {
				i++;
				continue;
			}

			if (inComment) {
				if (ch === '*' && src[i + 1] === '/') {
					inComment = false;
					i++;
				} else if (ch === '`') {
					remove.push(i);
				}
				continue;
			}

			if (ch === '/' && src[i + 1] === '*') {
				inComment = true;
				i++;
				continue;
			}

			if (ch === '`') {
				end = i;
				break;
			}

			if (ch === '$' && src[i + 1] === '{') {
				let depth = 1;
				i += 2;
				while (i < src.length && depth > 0) {
					if (src[i] === '{') {
						depth++;
					} else if (src[i] === '}') {
						depth--;
					}
					i++;
				}
				i--;
			}
		}

		// A correctly-terminated css`` is followed by ; , ) ] or }. Anything else means a backtick
		// outside a comment closed it early — not safe to rewrite, so report it.
		if (end !== -1 && !validAfterRegex.test(src.slice(end + 1, end + 8))) {
			unfixable.push(lineAt(src, end));
		}

		// Resume past this template so a later css`` in the same file is still checked.
		if (end !== -1) tagRegex.lastIndex = end + 1;
	}

	let output = src;
	for (const index of [...remove].sort((a, b) => b - a)) {
		output = output.slice(0, index) + output.slice(index + 1);
	}

	return { output: output, stripped: remove.map(i => lineAt(src, i)), unfixable: unfixable };
}

function main(): number {
	let input: PostToolUseInput;
	try {
		input = JSON.parse(readFileSync(0, 'utf8')) as PostToolUseInput;
	} catch {
		return 0;
	}

	const path = input.tool_input?.file_path;
	if (path == null || !path.endsWith('.ts')) return 0;

	let src;
	try {
		src = readFileSync(path, 'utf8');
	} catch {
		return 0;
	}

	if (!src.includes('css`')) return 0;

	const { output, stripped, unfixable } = scan(src);

	if (stripped.length) {
		writeFileSync(path, output, 'utf8');
		const lines = [...new Set(stripped)].join(', ');
		console.log(
			`css-template-guard: removed ${stripped.length} backtick(s) from CSS comments in ${path} (line ${lines}). Inside css\`\` write identifiers bare — a backtick there ends the template literal.`,
		);
	}

	if (unfixable.length) {
		console.error(
			`Backtick outside a comment inside a css\`\` template in ${path} (line ${[...new Set(unfixable)].join(', ')}) — it closes the literal early, so the CSS below it is being parsed as TypeScript. Not auto-fixable: a backtick here may be intentional. Fix it by hand before building.`,
		);
		return 2;
	}

	return 0;
}

// Skip when imported by the test harness.
if (process.argv[1]?.endsWith('css-template-guard.mts')) {
	process.exit(main());
}
