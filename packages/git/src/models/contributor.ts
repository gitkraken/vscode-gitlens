import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import type { Shape } from '@gitlens/utils/types.js';
import type { GitCommitStats } from './commit.js';

export type GitContributorShape = Shape<GitContributor>;

@loggable(i => i.name)
@serializable
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
		public readonly avatarUrl?: string | undefined,
		public readonly id?: string | undefined,
	) {}

	get coauthor(): string {
		return `${this.name}${this.email ? ` <${this.email}>` : ''}`;
	}

	get label(): string {
		return this.name ?? this.username!;
	}

	/** Creates a copy of this contributor with a different repoPath — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string): GitContributor {
		if (repoPath === this.repoPath) return this;
		return new GitContributor(
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

	static is(contributor: unknown): contributor is GitContributor {
		return contributor instanceof GitContributor;
	}

	static formatDate(contributor: GitContributorShape, format?: string | null): string {
		return contributor.latestCommitDate != null
			? formatDate(contributor.latestCommitDate, format ?? 'MMMM Do, YYYY h:mma')
			: '';
	}

	static formatDateFromNow(contributor: GitContributorShape, short?: boolean): string {
		return contributor.latestCommitDate != null ? fromNow(contributor.latestCommitDate, short) : '';
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
