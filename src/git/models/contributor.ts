import { Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import { configuration, ContributorSorting, GravatarDefaultStyle } from '../../configuration';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { sortCompare } from '../../system/string';

export interface ContributorSortOptions {
	current?: true;
	orderBy?: ContributorSorting;
}

export class GitContributor {
	static is(contributor: any): contributor is GitContributor {
		return contributor instanceof GitContributor;
	}

	static sort(contributors: GitContributor[], options?: ContributorSortOptions) {
		options = { current: true, orderBy: configuration.get('sortContributorsBy'), ...options };

		switch (options.orderBy) {
			case ContributorSorting.CountAsc:
				return contributors.sort(
					(a, b) =>
						(a.current ? -1 : 1) - (b.current ? -1 : 1) ||
						a.count - b.count ||
						a.date.getTime() - b.date.getTime(),
				);
			case ContributorSorting.DateDesc:
				return contributors.sort(
					(a, b) =>
						(options!.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
						b.date.getTime() - a.date.getTime() ||
						b.count - a.count,
				);
			case ContributorSorting.DateAsc:
				return contributors.sort(
					(a, b) =>
						(options!.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
						a.date.getTime() - b.date.getTime() ||
						b.count - a.count,
				);
			case ContributorSorting.NameAsc:
				return contributors.sort(
					(a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1) || sortCompare(a.name, b.name),
				);
			case ContributorSorting.NameDesc:
				return contributors.sort(
					(a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1) || sortCompare(b.name, a.name),
				);
			case ContributorSorting.CountDesc:
			default:
				return contributors.sort(
					(a, b) =>
						(a.current ? -1 : 1) - (b.current ? -1 : 1) ||
						b.count - a.count ||
						b.date.getTime() - a.date.getTime(),
				);
		}
	}

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly email: string,
		public readonly count: number,
		public readonly date: Date,
		public readonly stats?: {
			files: number;
			additions: number;
			deletions: number;
		},
		public readonly current: boolean = false,
	) {}

	@memoize<GitContributor['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatDate(format?: string | null) {
		return formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatDateFromNow(short?: boolean) {
		return fromNow(this.date, short);
	}

	getAvatarUri(options?: { defaultStyle?: GravatarDefaultStyle; size?: number }): Uri | Promise<Uri> {
		return getAvatarUri(this.email, undefined /*this.repoPath*/, options);
	}

	toCoauthor(): string {
		return `${this.name}${this.email ? ` <${this.email}>` : ''}`;
	}
}
