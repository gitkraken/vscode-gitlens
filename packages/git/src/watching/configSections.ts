/**
 * A git config file's variables by section, as git reads them: each key is a section's full name (`core`,
 * `branch.feature/x`: the section name lowercased, then its subsection), and each value lists that section's variables
 * in file order as `<key>=<value>` (the key lowercased, the value unquoted and unescaped), or a bare `<key>` for one
 * with no value. A section whose header repeats lists the variables of every occurrence.
 */
export type GitConfigSections = ReadonlyMap<string, readonly string[]>;

/**
 * What changed between two reads of the same config file: every local branch (full `refs/heads/` name) whose
 * `branch.<name>` section changed, and whether that is all that changed. `undefined` when nothing changed.
 */
export interface GitConfigSectionsChange {
	readonly branches: ReadonlySet<string>;
	readonly confined: boolean;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Parses a config file's bytes; `undefined` when they aren't UTF-8 or git would reject them */
export function parseGitConfigBytes(data: Uint8Array): GitConfigSections | undefined {
	let text: string;
	try {
		text = utf8.decode(data);
	} catch {
		return undefined;
	}
	return parseGitConfigSections(text);
}

/**
 * Parses a config file's text the way git does (`config.c`): a header is `[section]`, `[section "subsection"]` (the
 * subsection kept as written, `\` escaping the next character) or the legacy `[section.subsection]` (lowercased); a
 * variable may follow a header on its line; `#` and `;` start a comment outside quotes; a value may be quoted, and `\`
 * escapes `"`, `\`, `n`, `t` and `b`, or continues the value on the next line. `undefined` for anything git rejects
 * (a malformed header or name, an unknown escape, a line ending inside quotes), and for a variable before any header,
 * which has no section to compare.
 */
export function parseGitConfigSections(text: string): GitConfigSections | undefined {
	const sections = new Map<string, string[]>();
	let index = 0;
	let eof = false;

	/** Git's `get_next_char`: CRLF reads as LF, and the end of the text reads as a final LF */
	const next = (): string => {
		if (index >= text.length) {
			eof = true;
			return '\n';
		}

		const c = text[index++];
		if (c === '\r' && text[index] === '\n') {
			index++;
			return '\n';
		}
		return c;
	};

	/** The rest of a `[section "subsection"]` header, from the whitespace after the section name */
	const readSubsection = (first: string): string | undefined => {
		let c = first;
		do {
			if (c === '\n') return undefined;

			c = next();
		} while (isSpace(c));
		if (c !== '"') return undefined;

		let subsection = '';
		for (;;) {
			c = next();
			if (c === '\n') return undefined;
			if (c === '"') break;

			if (c === '\\') {
				c = next();
				if (c === '\n') return undefined;
			}

			subsection += c;
		}
		return next() === ']' ? subsection : undefined;
	};

	/** A header's full section name, from just after its `[` */
	const readHeader = (): string | undefined => {
		let name = '';
		for (;;) {
			const c = next();
			if (eof) return undefined;
			if (c === ']') return name;

			if (isSpace(c)) {
				const subsection = readSubsection(c);
				return subsection != null ? `${name}.${subsection}` : undefined;
			}
			if (!isKeyChar(c) && c !== '.') return undefined;

			name += c.toLowerCase();
		}
	};

	/** Git's `parse_value`: a value, from just after its `=` to the end of its (last continued) line */
	const readValue = (): string | undefined => {
		let value = '';
		let quoted = false;
		let comment = false;
		let trimTo: number | undefined;
		for (;;) {
			let c = next();
			if (c === '\n') {
				if (quoted) return undefined;

				return trimTo != null ? value.substring(0, trimTo) : value;
			}
			if (comment) continue;

			if (isSpace(c) && !quoted) {
				trimTo ??= value.length;
				if (value.length) {
					value += c;
				}
				continue;
			}
			if (!quoted && (c === ';' || c === '#')) {
				comment = true;
				continue;
			}

			trimTo = undefined;
			if (c === '\\') {
				c = next();
				switch (c) {
					case '\n':
						continue;
					case 't':
						c = '\t';
						break;
					case 'b':
						c = '\b';
						break;
					case 'n':
						c = '\n';
						break;
					case '\\':
					case '"':
						break;
					default:
						return undefined;
				}
				value += c;
				continue;
			}

			if (c === '"') {
				quoted = !quoted;
				continue;
			}

			value += c;
		}
	};

	let section: string[] | undefined;
	let comment = false;
	for (;;) {
		const c = next();
		if (c === '\n') {
			if (eof) return sections;

			comment = false;
			continue;
		}
		if (comment || isSpace(c)) continue;

		if (c === '#' || c === ';') {
			comment = true;
			continue;
		}

		if (c === '[') {
			const name = readHeader();
			if (!name) return undefined;

			section = sections.get(name);
			if (section == null) {
				section = [];
				sections.set(name, section);
			}
			continue;
		}

		if (section == null || !isAlpha(c)) return undefined;

		// Git's `get_value`: the name runs to the first character a name can't hold
		let key = c.toLowerCase();
		let k: string;
		for (;;) {
			k = next();
			if (eof || !isKeyChar(k)) break;

			key += k.toLowerCase();
		}
		while (k === ' ' || k === '\t') {
			k = next();
		}

		if (k === '\n') {
			section.push(key);
			if (eof) return sections;

			continue;
		}
		if (k !== '=') return undefined;

		const value = readValue();
		if (value == null) return undefined;

		section.push(`${key}=${value}`);
		if (eof) return sections;
	}
}

/**
 * Compares two reads of a config file section by section. A changed `branch.<name>` section (a subsection of
 * `branch`) names that local branch; any other changed section, the bare `[branch]` included, makes the change
 * unconfined.
 */
export function diffGitConfigSections(
	before: GitConfigSections,
	after: GitConfigSections,
): GitConfigSectionsChange | undefined {
	const branches = new Set<string>();
	let changed = false;
	let confined = true;

	const compare = (name: string): void => {
		if (sameVariables(before.get(name), after.get(name))) return;

		changed = true;
		if (name.startsWith('branch.') && name.length > 7) {
			branches.add(`refs/heads/${name.substring(7)}`);
		} else {
			confined = false;
		}
	};

	for (const name of before.keys()) {
		compare(name);
	}
	for (const name of after.keys()) {
		if (!before.has(name)) {
			compare(name);
		}
	}
	return changed ? { branches: branches, confined: confined } : undefined;
}

function sameVariables(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
	if (a == null || b == null) return a === b;
	if (a.length !== b.length) return false;

	return a.every((v, i) => v === b[i]);
}

/** Git's own `isspace`, which leaves out `\v` and `\f`: a value keeps them, so they must not compare as trimmed */
function isSpace(c: string): boolean {
	return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function isAlpha(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/** Git's `iskeychar`: an ASCII letter or digit, or `-` */
function isKeyChar(c: string): boolean {
	return isAlpha(c) || (c >= '0' && c <= '9') || c === '-';
}
