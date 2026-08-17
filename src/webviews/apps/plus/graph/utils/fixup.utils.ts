import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';

/** The resolved fixup target: the commit a `fixup!` message would land on via `rebase --autosquash`. */
export type FixupTarget = { sha: string; subject: string };

/**
 * Extracts the subject a `fixup! <subject>` commit message targets. Only the FIRST LINE of the
 * message is considered (a fixup subject can't span lines). Chained fixups (`fixup! fixup! x`)
 * strip only the outermost `fixup! ` prefix, leaving the inner one intact — chaining onto an
 * existing fixup is legal git behavior, and the remainder is what identifies the eventual target.
 * Returns undefined when the message isn't a fixup, or nothing follows the prefix.
 */
export function parseFixupSubject(message: string): string | undefined {
	const firstLine = message.split('\n', 1)[0] ?? '';

	const prefix = 'fixup! ';
	if (!firstLine.startsWith(prefix)) return undefined;

	const remainder = firstLine.slice(prefix.length).trimEnd();
	return remainder.length > 0 ? remainder : undefined;
}

/**
 * Finds the row a `fixup!` message targets: the newest (first, since rows are newest-first) commit
 * that's rewriteable from HEAD (safely reachable by a plain interactive rebase) whose message's
 * first line matches `subject` exactly. Only scan when a caller has already confirmed the message
 * parses as a fixup — this walks the full row list on a miss.
 */
export function findFixupTargetRow(rows: readonly GitGraphRow[] | undefined, subject: string): FixupTarget | undefined {
	if (rows == null) return undefined;

	for (const row of rows) {
		if (((row.contexts?.flags ?? 0) & GitGraphRowContextFlags.RewriteableFromHead) === 0) continue;

		const firstLine = row.message.split('\n', 1)[0] ?? '';
		if (firstLine === subject) return { sha: row.sha, subject: subject };
	}

	return undefined;
}
