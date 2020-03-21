'use strict';
import { Uri } from 'vscode';
import { GravatarDefaultStyle } from '../../configuration';
import { getAvatarUri } from '../../avatars';

export class GitContributor {
	static is(contributor: any): contributor is GitContributor {
		return contributor instanceof GitContributor;
	}

	static sort(contributors: GitContributor[]) {
		return contributors.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1) || b.count - a.count);
	}

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly email: string,
		public readonly count: number,
		public readonly current: boolean = false,
	) {}

	getGravatarUri(fallback: GravatarDefaultStyle, size: number = 16): Uri {
		return getAvatarUri(this.email, fallback, size);
	}
}
