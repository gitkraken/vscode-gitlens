// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import type { GravatarDefaultStyle } from '../../config';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/-webview/memoize';
import type { GitCommitStats } from './commit';

export function isContributor(contributor: unknown): contributor is GitContributor {
	return contributor instanceof GitContributor;
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

export interface GitContributorStats {
	readonly count: number;
	readonly contributions: number[];
}

export type GitContributionTiers = '[1]' | '[2-5]' | '[6-10]' | '[11-50]' | '[51-100]' | '[101+]';
