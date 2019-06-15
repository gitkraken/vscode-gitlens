'use strict';
import { Uri } from 'vscode';
import { GravatarDefaultStyle } from '../../configuration';
import { getGravatarUri } from '../../avatars';

export class GitContributor {
    static is(contributor: any): contributor is GitContributor {
        return contributor instanceof GitContributor;
    }

    constructor(
        public readonly repoPath: string,
        public readonly name: string,
        public readonly email: string,
        public readonly count: number
    ) {}

    getGravatarUri(fallback: GravatarDefaultStyle, size: number = 16): Uri {
        return getGravatarUri(this.email, fallback, size);
    }
}
