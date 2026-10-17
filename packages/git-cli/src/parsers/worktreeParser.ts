import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { WorkspaceFolderResolver } from '@gitlens/git/models/worktree.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import { fileUri } from '@gitlens/utils/uri.js';

interface WorktreeEntry {
	path: string;
	sha?: string;
	branch?: string;
	bare: boolean;
	detached: boolean;
	locked?: boolean | string;
	prunable?: boolean | string;
}

export function parseGitWorktrees(
	data: string | undefined,
	repoPath: string,
	branches: GitBranch[],
	getWorkspaceFolder?: WorkspaceFolderResolver,
): GitWorktree[] {
	using sw = maybeStopWatch(`Git.parseWorktrees(${repoPath})`, { log: { onlyExit: true, level: 'debug' } });

	const worktrees: GitWorktree[] = [];
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return worktrees;
	}

	if (repoPath != null) {
		repoPath = normalizePath(repoPath);
	}

	let entry: Partial<WorktreeEntry> | undefined = undefined;
	let line: string;
	let index: number;
	let key: string;
	let value: string;
	let main = true; // the first worktree is the main worktree

	for (line of iterateByDelimiter(data, '\n')) {
		index = line.indexOf(' ');
		if (index === -1) {
			key = line;
			value = '';
		} else {
			key = line.substring(0, index);
			value = line.substring(index + 1);
		}

		if (!key && entry != null) {
			// oxlint-disable-next-line no-loop-func
			const branch = entry.branch ? branches?.find(b => b.name === entry!.branch) : undefined;
			const uri = fileUri(entry.path!);

			worktrees.push(
				new GitWorktree(
					main,
					entry.bare ? 'bare' : entry.detached ? 'detached' : 'branch',
					repoPath,
					uri,
					entry.locked ?? false,
					entry.prunable ?? false,
					entry.sha,
					branch,
					getWorkspaceFolder?.(uri),
				),
			);

			entry = undefined;
			main = false;
			continue;
		}

		entry ??= {};

		switch (key) {
			case 'worktree':
				entry.path = value;
				break;
			case 'bare':
				entry.bare = true;
				break;
			case 'HEAD':
				entry.sha = value;
				break;
			case 'branch':
				// Strip off refs/heads/
				entry.branch = value.substring(11);
				break;
			case 'detached':
				entry.detached = true;
				break;
			// `value` is the whole reason, which is only present when the locker/Git provides one (Git < 2.31
			// prints a bare `locked` regardless). Without `-z`, a reason with unusual characters (e.g. newlines)
			// comes through C-quoted, with UTF-8 bytes as octal escapes unless `core.quotePath` is off (as core runs it)
			case 'locked':
				entry.locked = unquoteCString(value.trim()) || true;
				break;
			case 'prunable':
				entry.prunable = unquoteCString(value.trim()) || true;
				break;
		}
	}

	sw?.stop({ suffix: ` parsed ${worktrees.length} worktrees` });

	return worktrees;
}

const cEscapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 };

/** Reverses Git's C-style quoting (`"a\nb"`, `\303\251` octal UTF-8 bytes); returns unquoted values as-is */
function unquoteCString(value: string): string {
	if (!value.startsWith('"')) return value;

	const end = value.length > 1 && value.endsWith('"') ? value.length - 1 : value.length;
	const encoder = new TextEncoder();
	const bytes: number[] = [];

	let i = 1;
	while (i < end) {
		const ch = value[i];
		if (ch !== '\\' || i + 1 >= end) {
			// A whole code point, so surrogate pairs encode correctly
			const cp = String.fromCodePoint(value.codePointAt(i)!);
			bytes.push(...encoder.encode(cp));
			i += cp.length;
			continue;
		}

		const next = value[i + 1];
		if (next >= '0' && next <= '7') {
			let j = i + 1;
			while (j < i + 4 && j < end && value[j] >= '0' && value[j] <= '7') {
				j++;
			}
			bytes.push(Number.parseInt(value.substring(i + 1, j), 8) & 0xff);
			i = j;
			continue;
		}

		const code = cEscapes[next];
		if (code != null) {
			bytes.push(code);
		} else {
			bytes.push(...encoder.encode(next));
		}
		i += 2;
	}

	return new TextDecoder().decode(new Uint8Array(bytes));
}
