import { Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import type { GravatarDefaultStyle } from '../../config';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import type { GitCommitStats } from './commit';
import type { GitUser } from './user';

export interface GitContributorStats {
	readonly count: number;
	readonly contributions: number[];
}

export type GitContributionTiers = '[1]' | '[2-5]' | '[6-10]' | '[11-50]' | '[51-100]' | '[101+]';

export function calculateDistribution<T extends string>(
	stats: GitContributorStats | undefined,
	prefix: T,
): Record<`${typeof prefix}${GitContributionTiers}`, number> {
	if (stats == null) return {} as unknown as Record<`${typeof prefix}${GitContributionTiers}`, number>;

	const distribution: Record<`${string}${GitContributionTiers}`, number> = {
		[`${prefix}[1]`]: 0,
		[`${prefix}[2-5]`]: 0,
		[`${prefix}[6-10]`]: 0,
		[`${prefix}[11-50]`]: 0,
		[`${prefix}[51-100]`]: 0,
		[`${prefix}[101+]`]: 0,
	};

	for (const c of stats.contributions) {
		if (c === 1) {
			distribution[`${prefix}[1]`]++;
		} else if (c <= 5) {
			distribution[`${prefix}[2-5]`]++;
		} else if (c <= 10) {
			distribution[`${prefix}[6-10]`]++;
		} else if (c <= 50) {
			distribution[`${prefix}[11-50]`]++;
		} else if (c <= 100) {
			distribution[`${prefix}[51-100]`]++;
		} else {
			distribution[`${prefix}[101+]`]++;
		}
	}

	return distribution;
}

export class GitContributor {
	constructor(
		public readonly repoPath: string,
		public readonly name: string | undefined,
		public readonly email: string | undefined,
		public readonly commits: number,
		public readonly latestCommitDate?: Date,
		public readonly firstCommitDate?: Date,
		public readonly current: boolean = false,
		public readonly stats?: GitCommitStats<number> & { contributionScore: number },
		public readonly username?: string | undefined,
		private readonly avatarUrl?: string | undefined,
		public readonly id?: string | undefined,
	) {}

	get label(): string {
		return this.name ?? this.username!;
	}

	@memoize<GitContributor['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
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
}

export function matchContributor(c: GitContributor, user: GitUser): boolean {
	return c.name === user.name && c.email === user.email && c.username === user.username;
}

export function isContributor(contributor: any): contributor is GitContributor {
	return contributor instanceof GitContributor;
}
