import { Uri } from 'vscode';
import { debug } from '../../system/decorators/log';
import { normalizePath } from '../../system/path';
import { getLines } from '../../system/string';
import { GitWorktree } from '../models/worktree';

interface WorktreeEntry {
	path: string;
	sha?: string;
	branch?: string;
	bare: boolean;
	detached: boolean;
	locked?: boolean | string;
	prunable?: boolean | string;
}

export class GitWorktreeParser {
	@debug({ args: false, singleLine: true })
	static parse(data: string, repoPath: string): GitWorktree[] {
		if (!data) return [];

		if (repoPath !== undefined) {
			repoPath = normalizePath(repoPath);
		}

		const worktrees: GitWorktree[] = [];

		let entry: Partial<WorktreeEntry> | undefined = undefined;
		let line: string;
		let key: string;
		let value: string;
		let locked: string;
		let prunable: string;

		for (line of getLines(data)) {
			[key, value] = line.split(' ', 2);

			if (key.length === 0 && entry !== undefined) {
				worktrees.push(
					new GitWorktree(
						entry.bare ? 'bare' : entry.detached ? 'detached' : 'branch',
						repoPath,
						Uri.file(entry.path!),
						entry.locked ?? false,
						entry.prunable ?? false,
						entry.sha,
						entry.branch,
					),
				);
				entry = undefined;
				continue;
			}

			if (entry === undefined) {
				entry = {};
			}

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
					entry.branch = value.substr(11);
					break;
				case 'detached':
					entry.detached = true;
					break;
				case 'locked':
					[, locked] = value.split(' ', 2);
					entry.locked = locked?.trim() || true;
					break;
				case 'prunable':
					[, prunable] = value.split(' ', 2);
					entry.prunable = prunable?.trim() || true;
					break;
			}
		}

		return worktrees;
	}
}
