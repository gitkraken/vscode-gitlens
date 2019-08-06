'use strict';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { GravatarDefaultStyle } from './config';
import { Strings } from './system';
import { ContactPresenceStatus } from './vsls/vsls';
import { Container } from './container';

const gravatarCache = new Map<string, Uri>();
const missingGravatarHash = '00000000000000000000000000000000';

const presenceCache = new Map<ContactPresenceStatus, string>();

export function clearGravatarCache() {
    gravatarCache.clear();
}

function getAvatarFromGithubNoreplyAddress(email: string | undefined, size: number = 16): Uri | undefined {
    if (!email) return undefined;
    const match = email.match(/^(?:(?<userId>\d+)\+)?(?<userName>[a-zA-Z\d-]{1,39})@users.noreply.github.com$/);
    if (!match || !match.groups) return undefined;
    const { userName, userId } = match.groups;
    return Uri.parse(`https://avatars.githubusercontent.com/${userId ? `u/${userId}` : userName}?size=${size}`);
}

export function getGravatarUri(email: string | undefined, fallback: GravatarDefaultStyle, size: number = 16): Uri {
    const hash =
        email != null && email.length !== 0 ? Strings.md5(email.trim().toLowerCase(), 'hex') : missingGravatarHash;

    const key = `${hash}:${size}`;
    let gravatar = gravatarCache.get(key);
    if (gravatar !== undefined) return gravatar;

    gravatar =
        getAvatarFromGithubNoreplyAddress(email, size) ||
        Uri.parse(`https://www.gravatar.com/avatar/${hash}.jpg?s=${size}&d=${fallback}`);
    gravatarCache.set(key, gravatar);

    return gravatar;
}

export function getPresenceDataUri(status: ContactPresenceStatus) {
    let dataUri = presenceCache.get(status);
    if (dataUri === undefined) {
        const contents = fs
            .readFileSync(Container.context.asAbsolutePath(`images/dark/icon-presence-${status}.svg`))
            .toString('base64');

        dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
        presenceCache.set(status, dataUri);
    }

    return dataUri;
}
