'use strict';

export namespace Versions {
    export interface Version {
        major: number;
        minor: number;
        patch: number;
    }

    export function compare(v1: Version, v2: Version): number {
        if (v1.major > v2.major) return 1;
        if (v1.major < v2.major) return -1;

        if (v1.minor > v2.minor) return 1;
        if (v1.minor < v2.minor) return -1;

        if (v1.patch > v2.patch) return 1;
        if (v1.patch < v2.patch) return -1;

        return 0;
    }

    export function from(major: string | number, minor: string | number, patch: string | number): Version {
        return {
            major: typeof major === 'string' ? parseInt(major, 10) : major,
            minor: typeof minor === 'string' ? parseInt(minor, 10) : minor,
            patch: typeof patch === 'string' ? parseInt(patch, 10) : patch
        };
    }

    export function fromString(version: string): Version {
        const [major, minor, patch] = version.split('.');
        return from(major, minor, patch);
    }
}