import { DateStyle, TagSorting } from '../../config';
import { Container } from '../../container';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import { sortCompare } from '../../system/string';
import type { GitReference, GitTagReference } from './reference';

export interface TagSortOptions {
	current?: boolean;
	orderBy?: TagSorting;
}

export function getTagId(repoPath: string, name: string): string {
	return `${repoPath}|tag/${name}`;
}

export class GitTag implements GitTagReference {
	readonly refType = 'tag';
	readonly id: string;

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly sha: string,
		public readonly message: string,
		public readonly date: Date | undefined,
		public readonly commitDate: Date | undefined,
	) {
		this.id = getTagId(repoPath, name);
	}

	toString(): string {
		return `${getLoggableName(this)}(${this.id})`;
	}

	get formattedDate(): string {
		return Container.instance.TagDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(Container.instance.TagDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get ref() {
		return this.name;
	}

	@memoize<GitTag['formatCommitDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatCommitDate(format?: string | null) {
		return this.commitDate != null ? formatDate(this.commitDate, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	formatCommitDateFromNow() {
		return this.commitDate != null ? fromNow(this.commitDate) : '';
	}

	@memoize<GitTag['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatDate(format?: string | null) {
		return this.date != null ? formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	formatDateFromNow() {
		return this.date != null ? fromNow(this.date) : '';
	}

	@memoize()
	getBasename(): string {
		const index = this.name.lastIndexOf('/');
		return index !== -1 ? this.name.substring(index + 1) : this.name;
	}
}

export function isTag(tag: any): tag is GitTag {
	return tag instanceof GitTag;
}

export function isOfTagRefType(tag: GitReference | undefined) {
	return tag?.refType === 'tag';
}

export function sortTags(tags: GitTag[], options?: TagSortOptions) {
	options = { orderBy: configuration.get('sortTagsBy'), ...options };

	switch (options.orderBy) {
		case TagSorting.DateAsc:
			return tags.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
		case TagSorting.NameAsc:
			return tags.sort((a, b) => sortCompare(a.name, b.name));
		case TagSorting.NameDesc:
			return tags.sort((a, b) => sortCompare(b.name, a.name));
		case TagSorting.DateDesc:
		default:
			return tags.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
	}
}
