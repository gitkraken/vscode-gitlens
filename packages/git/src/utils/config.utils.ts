const falseValues = new Set(['', 'false', 'no', 'off', '0']);

/** Interprets a git config value with git's boolean semantics; `undefined` in → `undefined` out (unset). */
export function parseGitBoolean(value: string | null | undefined): boolean | undefined {
	if (value == null) return undefined;

	return !falseValues.has(value.trim().toLowerCase());
}
