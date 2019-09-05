'use strict';
import { memoize } from '../../system';
import { GitReference } from './models';
import { configuration, TagSorting } from '../../configuration';

export class GitTag implements GitReference {
	static is(tag: any): tag is GitTag {
		return tag instanceof GitTag;
	}

	static isOfRefType(tag: GitReference | undefined) {
		return tag !== undefined && tag.refType === 'tag';
	}

	static sort(tags: GitTag[]) {
		const order = configuration.get('sortTagsBy');

		switch (order) {
			case TagSorting.NameAsc:
				return tags.sort((a, b) =>
					b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' })
				);
			default:
				return tags.sort((a, b) =>
					a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
				);
		}
	}

	readonly refType = 'tag';

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly sha?: string,
		public readonly annotation?: string
	) {}

	get ref() {
		return this.name;
	}

	@memoize()
	getBasename(): string {
		const index = this.name.lastIndexOf('/');
		return index !== -1 ? this.name.substring(index + 1) : this.name;
	}
}
