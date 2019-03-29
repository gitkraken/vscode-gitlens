'use strict';
import { Uri } from 'vscode';
import { GravatarDefaultStyle } from '../../configuration';
import { getGravatarUri } from '../../gravatar';

export class GitContributor {
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
