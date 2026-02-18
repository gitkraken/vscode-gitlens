/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import { Uri } from 'vscode';
import { getAvatarUri } from '../../avatars.js';
import type { GravatarDefaultStyle } from '../../config.js';
import { formatDate, fromNow } from '../../system/date.js';
import { loggable } from '../../system/decorators/log.js';
import { memoize } from '../../system/decorators/memoize.js';
import type { GitCommitStats } from './commit.js';

export function isContributor(contributor: unknown): contributor is GitContributor {
	return contributor instanceof GitContributor;
}

@loggable(i => i.name)
export class GitContributor {
	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly email: string | undefined,
		public readonly current: boolean,
		public readonly contributionCount: number,
		public readonly contributions?: GitContributorContribution[],
		public readonly latestCommitDate?: Date,
		public readonly firstCommitDate?: Date,
		public readonly stats?: GitContributorStats,
		public readonly username?: string | undefined,
		private readonly avatarUrl?: string | undefined,
		public readonly id?: string | undefined,
	) {}

	get label(): string {
		return this.name ?? this.username!;
	}

	@memoize<GitContributor['formatDate']>({ resolver: format => format ?? 'MMMM Do, YYYY h:mma' })
	formatDate(format?: string | null): string {
		return this.latestCommitDate != null ? formatDate(this.latestCommitDate, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	formatDateFromNow(short?: boolean): string {
		return this.latestCommitDate != null ? fromNow(this.latestCommitDate, short) : '';
	}

	getAvatarUri(options?: { defaultStyle?: GravatarDefaultStyle; size?: number }): Uri | Promise<Uri> {
		if (this.avatarUrl != null) return Uri.parse(this.avatarUrl);

		return getAvatarUri(this.email, undefined /*this.repoPath*/, options);
	}

	getCoauthor(): string {
		return `${this.name}${this.email ? ` <${this.email}>` : ''}`;
	}

	/** Creates a copy of this contributor with a different repoPath — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string): GitContributor {
		return repoPath === this.repoPath
			? this
			: new GitContributor(
					repoPath,
					this.name,
					this.email,
					this.current,
					this.contributionCount,
					this.contributions,
					this.latestCommitDate,
					this.firstCommitDate,
					this.stats,
					this.username,
					this.avatarUrl,
					this.id,
				);
	}
}

interface GitContributorContribution extends Partial<GitCommitStats<number>> {
	readonly sha: string;
	readonly date: Date;
	readonly message: string;
}

export interface GitContributorStats extends GitCommitStats<number> {
	readonly contributionScore: number;
}

export interface GitContributorsStats {
	readonly count: number;
	readonly contributions: number[];
}

export type GitContributionTiers = '[1]' | '[2-5]' | '[6-10]' | '[11-50]' | '[51-100]' | '[101+]';
