'use strict';
import { Uri } from 'vscode';
import { GravatarDefaultStyle } from './config';
import { Strings } from './system';

const gravatarCache: Map<string, Uri> = new Map();
const missingGravatarHash = '00000000000000000000000000000000';

export function clearGravatarCache() {
    gravatarCache.clear();
}

export function getGravatarUri(email: string | undefined, fallback: GravatarDefaultStyle, size: number = 16): Uri {
    const hash =
        email != null && email.length !== 0 ? Strings.md5(email.trim().toLowerCase(), 'hex') : missingGravatarHash;

    const key = `${hash}:${size}`;
    let gravatar = gravatarCache.get(key);
    if (gravatar !== undefined) return gravatar;

    gravatar = Uri.parse(`https://www.gravatar.com/avatar/${hash}.jpg?s=${size}&d=${fallback}`);
    gravatarCache.set(key, gravatar);

    return gravatar;
}
