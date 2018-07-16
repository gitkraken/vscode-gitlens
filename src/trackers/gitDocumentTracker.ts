'use strict';
import { GitBlame, GitDiff, GitLog } from '../git/git';
import { DocumentTracker } from './documentTracker';

export * from './documentTracker';

interface CachedItem<T> {
    item: Promise<T>;
    errorMessage?: string;
}

export type CachedBlame = CachedItem<GitBlame>;
export type CachedDiff = CachedItem<GitDiff>;
export type CachedLog = CachedItem<GitLog>;

export class GitDocumentState {
    private cache: Map<string, CachedBlame | CachedDiff | CachedLog> = new Map();

    constructor(
        public readonly key: string
    ) {}

    get<T extends CachedBlame | CachedDiff | CachedLog>(key: string): T | undefined {
        return this.cache.get(key) as T;
    }

    set<T extends CachedBlame | CachedDiff | CachedLog>(key: string, value: T) {
        this.cache.set(key, value);
    }
}

export class GitDocumentTracker extends DocumentTracker<GitDocumentState> {}
