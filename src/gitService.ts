'use strict';
import { Functions, Iterables, Objects } from './system';
import { Disposable, Event, EventEmitter, FileSystemWatcher, Location, Position, Range, TextDocument, TextDocumentChangeEvent, TextEditor, Uri, workspace } from 'vscode';
import { IConfig } from './configuration';
import { DocumentSchemes, ExtensionKey, GlyphChars } from './constants';
import { RemoteProviderFactory } from './git/remotes/factory';
import { Git, GitAuthor, GitBlame, GitBlameCommit, GitBlameLine, GitBlameLines, GitBlameParser, GitBranch, GitBranchParser, GitCommit, GitDiff, GitDiffChunkLine, GitDiffParser, GitLog, GitLogCommit, GitLogParser, GitRemote, GitRemoteParser, GitStash, GitStashParser, GitStatus, GitStatusFile, GitStatusParser, IGit, setDefaultEncoding } from './git/git';
import { GitUri, IGitCommitInfo, IGitUriData } from './git/gitUri';
import { Logger } from './logger';
import * as fs from 'fs';
import * as ignore from 'ignore';
import * as path from 'path';

export { GitUri, IGitCommitInfo };
export * from './git/models/models';
export * from './git/formatters/commit';
export * from './git/formatters/status';
export { getNameFromRemoteResource, RemoteResource, RemoteProvider } from './git/remotes/provider';
export * from './git/gitContextTracker';

class UriCacheEntry {

    constructor(public uri: GitUri) { }
}

class GitCacheEntry {

    private cache: Map<string, CachedBlame | CachedDiff | CachedLog> = new Map();

    constructor(public key: string) { }

    get hasErrors(): boolean {
        return Iterables.every(this.cache.values(), _ => _.errorMessage !== undefined);
    }

    get<T extends CachedBlame | CachedDiff | CachedLog>(key: string): T | undefined {
        return this.cache.get(key) as T;
    }

    set<T extends CachedBlame | CachedDiff | CachedLog>(key: string, value: T) {
        this.cache.set(key, value);
    }
}

interface CachedItem<T> {
    item: Promise<T>;
    errorMessage?: string;
}

interface CachedBlame extends CachedItem<GitBlame> { }
interface CachedDiff extends CachedItem<GitDiff> { }
interface CachedLog extends CachedItem<GitLog> { }

enum RemoveCacheReason {
    DocumentClosed,
    DocumentSaved
}

export type GitRepoSearchBy = 'author' | 'files' | 'message' | 'sha';
export const GitRepoSearchBy = {
    Author: 'author' as GitRepoSearchBy,
    Files: 'files' as GitRepoSearchBy,
    Message: 'message' as GitRepoSearchBy,
    Sha: 'sha' as GitRepoSearchBy
};

export type RepoChangedReasons = 'remotes' | 'stash' | 'unknown';
export const RepoChangedReasons = {
    Remotes: 'remotes' as RepoChangedReasons,
    Stash: 'stash' as RepoChangedReasons,
    Unknown: 'unknown' as RepoChangedReasons
};

export class GitService extends Disposable {

    static fakeSha = 'ffffffffffffffffffffffffffffffffffffffff';
    static uncommittedSha = '0000000000000000000000000000000000000000';

    private _onDidBlameFail = new EventEmitter<string>();
    get onDidBlameFail(): Event<string> {
        return this._onDidBlameFail.event;
    }

    private _onDidChangeGitCache = new EventEmitter<void>();
    get onDidChangeGitCache(): Event<void> {
        return this._onDidChangeGitCache.event;
    }

    private _onDidChangeRepo = new EventEmitter<RepoChangedReasons[]>();
    get onDidChangeRepo(): Event<RepoChangedReasons[]> {
        return this._onDidChangeRepo.event;
    }

    private _gitCache: Map<string, GitCacheEntry>;
    private _remotesCache: Map<string, GitRemote[]>;
    private _cacheDisposable: Disposable | undefined;
    private _uriCache: Map<string, UriCacheEntry>;

    config: IConfig;
    private _disposable: Disposable | undefined;
    private _gitignore: Promise<ignore.Ignore | undefined>;
    private _repoWatcher: FileSystemWatcher | undefined;

    static EmptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);

    constructor(public repoPath: string) {
        super(() => this.dispose());

        this._gitCache = new Map();
        this._remotesCache = new Map();
        this._uriCache = new Map();

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(RemoteProviderFactory.onDidChange(this._onRemoteProviderChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();

        this._cacheDisposable && this._cacheDisposable.dispose();
        this._cacheDisposable = undefined;

        this._repoWatcher && this._repoWatcher.dispose();
        this._repoWatcher = undefined;

        this._gitCache.clear();
        this._remotesCache.clear();
        this._uriCache.clear();
    }

    public get UseCaching() {
        return this.config.advanced.caching.enabled;
    }

    private _onConfigurationChanged() {
        const encoding = workspace.getConfiguration('files').get<string>('encoding', 'utf8');
        setDefaultEncoding(encoding);

        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        if (!Objects.areEquivalent(cfg.advanced, this.config && this.config.advanced)) {
            if (cfg.advanced.caching.enabled) {
                this._cacheDisposable && this._cacheDisposable.dispose();

                this._repoWatcher = this._repoWatcher || workspace.createFileSystemWatcher('**/.git/{index,HEAD,refs/stash,refs/heads/**,refs/remotes/**}');

                const disposables: Disposable[] = [];

                disposables.push(workspace.onDidCloseTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentClosed)));
                disposables.push(workspace.onDidChangeTextDocument(this._onTextDocumentChanged, this));
                disposables.push(workspace.onDidSaveTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentSaved)));
                disposables.push(this._repoWatcher.onDidChange(this._onRepoChanged, this));

                this._cacheDisposable = Disposable.from(...disposables);
            }
            else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;

                this._repoWatcher && this._repoWatcher.dispose();
                this._repoWatcher = undefined;

                this._gitCache.clear();
            }

            this._gitignore = new Promise<ignore.Ignore | undefined>((resolve, reject) => {
                if (!cfg.advanced.gitignore.enabled) {
                    resolve(undefined);
                    return;
                }

                const gitignorePath = path.join(this.repoPath, '.gitignore');
                fs.exists(gitignorePath, e => {
                    if (e) {
                        fs.readFile(gitignorePath, 'utf8', (err, data) => {
                            if (!err) {
                                resolve(ignore().add(data));
                                return;
                            }
                            resolve(undefined);
                        });
                        return;
                    }
                    resolve(undefined);
                });
            });
        }

        const ignoreWhitespace = this.config && this.config.blame.ignoreWhitespace;

        this.config = cfg;

        if (this.config.blame.ignoreWhitespace !== ignoreWhitespace) {
            this._gitCache.clear();
            this._fireGitCacheChange();
        }
    }

    private _onRemoteProviderChanged() {
        this._remotesCache.clear();
        this._fireRepoChange(RepoChangedReasons.Remotes);
    }

    private _onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (!this.UseCaching) return;
        if (e.document.uri.scheme !== DocumentSchemes.File) return;

        // TODO: Rework this once https://github.com/Microsoft/vscode/issues/27231 is released in v1.13
        // We have to defer because isDirty is not reliable inside this event
        setTimeout(() => {
            // If the document is dirty all is fine, we'll just wait for the save before clearing our cache
            if (e.document.isDirty) return;

            // If the document isn't dirty, it is very likely this event was triggered by an outside edit of this document
            // Which means the document has been reloaded and we should clear our cache for it
            this._removeCachedEntry(e.document, RemoveCacheReason.DocumentSaved);
        }, 1);
    }

    private _onRepoChanged(uri: Uri) {
        if (uri !== undefined && uri.path.endsWith('ref/stash')) {
            this._fireRepoChange('stash');

            return;
        }

        this._gitCache.clear();

        this._fireRepoChange();
        this._fireGitCacheChange();
    }

    private _fireGitCacheChangeDebounced: (() => void) | undefined = undefined;

    private _fireGitCacheChange() {
        if (this._fireGitCacheChangeDebounced === undefined) {
            this._fireGitCacheChangeDebounced = Functions.debounce(this._fireGitCacheChangeCore, 50);
        }

        return this._fireGitCacheChangeDebounced();
    }

    private _fireGitCacheChangeCore() {
        this._onDidChangeGitCache.fire();
    }

    private _fireRepoChangeDebounced: (() => void) | undefined = undefined;
    private _repoChangedReasons: RepoChangedReasons[] = [];

    private _fireRepoChange(reason: RepoChangedReasons = 'unknown') {
        if (this._fireRepoChangeDebounced === undefined) {
            this._fireRepoChangeDebounced = Functions.debounce(this._fireRepoChangeCore, 50);
        }

        this._repoChangedReasons.push(reason);
        return this._fireRepoChangeDebounced();
    }

    private _fireRepoChangeCore() {
        const reasons = this._repoChangedReasons;
        this._repoChangedReasons = [];

        this._onDidChangeRepo.fire(reasons);
    }

    private _removeCachedEntry(document: TextDocument, reason: RemoveCacheReason) {
        if (!this.UseCaching) return;
        if (document.uri.scheme !== DocumentSchemes.File) return;

        const cacheKey = this.getCacheEntryKey(document.uri);

        if (reason === RemoveCacheReason.DocumentSaved) {
            // Don't remove broken blame on save (since otherwise we'll have to run the broken blame again)
            const entry = this._gitCache.get(cacheKey);
            if (entry && entry.hasErrors) return;
        }

        if (this._gitCache.delete(cacheKey)) {
            Logger.log(`Clear cache entry for '${cacheKey}', reason=${RemoveCacheReason[reason]}`);

            if (reason === RemoveCacheReason.DocumentSaved) {
                this._fireGitCacheChange();
            }
        }
    }

    checkoutFile(uri: GitUri, sha?: string) {
        sha = sha || uri.sha;
        Logger.log(`checkoutFile('${uri.repoPath}', '${uri.fsPath}', ${sha})`);

        return Git.checkout(uri.repoPath!, uri.fsPath, sha!);
    }

    private async _fileExists(repoPath: string, fileName: string): Promise<boolean> {
        return await new Promise<boolean>((resolve, reject) => fs.exists(path.resolve(repoPath, fileName), resolve));
    }

    async findNextCommit(repoPath: string, fileName: string, sha?: string): Promise<GitLogCommit | undefined> {
        let log = await this.getLogForFile(repoPath, fileName, sha, { maxCount: 1, reverse: true });
        let commit = log && Iterables.first(log.commits.values());
        if (commit) return commit;

        const nextFileName = await this.findNextFileName(repoPath, fileName, sha);
        if (nextFileName) {
            log = await this.getLogForFile(repoPath, nextFileName, sha, { maxCount: 1, reverse: true });
            commit = log && Iterables.first(log.commits.values());
        }

        return commit;
    }

    async findNextFileName(repoPath: string | undefined, fileName: string, sha?: string): Promise<string | undefined> {
        [fileName, repoPath] = Git.splitPath(fileName, repoPath);

        return (await this._fileExists(repoPath, fileName))
            ? fileName
            : await this._findNextFileName(repoPath, fileName, sha);
    }

    async _findNextFileName(repoPath: string, fileName: string, sha?: string): Promise<string | undefined> {
        if (sha === undefined) {
            // Get the most recent commit for this file name
            const c = await this.getLogCommit(repoPath, fileName);
            if (c === undefined) return undefined;

            sha = c.sha;
        }

        // Get the full commit (so we can see if there are any matching renames in the file statuses)
        const log = await this.getLogForRepo(repoPath, sha, 1);
        if (log === undefined) return undefined;

        const c = Iterables.first(log.commits.values());
        const status = c.fileStatuses.find(_ => _.originalFileName === fileName);
        if (status === undefined) return undefined;

        return status.fileName;
    }

    async findWorkingFileName(commit: GitCommit): Promise<string | undefined>;
    async findWorkingFileName(repoPath: string | undefined, fileName: string): Promise<string | undefined>;
    async findWorkingFileName(commitOrRepoPath: GitCommit | string | undefined, fileName?: string): Promise<string | undefined> {
        let repoPath: string | undefined;
        if (commitOrRepoPath === undefined || typeof commitOrRepoPath === 'string') {
            repoPath = commitOrRepoPath;
            if (fileName === undefined) throw new Error('Invalid fileName');

            [fileName] = Git.splitPath(fileName, repoPath);
        }
        else {
            const c = commitOrRepoPath;
            repoPath = c.repoPath;
            if (c.workingFileName && await this._fileExists(repoPath, c.workingFileName)) return c.workingFileName;
            fileName = c.fileName;
        }

        while (true) {
            if (await this._fileExists(repoPath!, fileName)) return fileName;

            fileName = await this._findNextFileName(repoPath!, fileName);
            if (fileName === undefined) return undefined;
        }
    }

    public async getBlameability(uri: GitUri): Promise<boolean> {
        if (!this.UseCaching) return await this.isTracked(uri);

        const cacheKey = this.getCacheEntryKey(uri);
        const entry = this._gitCache.get(cacheKey);
        if (entry === undefined) return await this.isTracked(uri);

        return !entry.hasErrors;
    }

    async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
        let key = 'blame';
        if (uri.sha !== undefined) {
            key += `:${uri.sha}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching) {
            const cacheKey = this.getCacheEntryKey(uri);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedBlame = entry.get<CachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.log(`Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
                    return cachedBlame.item;
                }
            }

            Logger.log(`Not Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
        }

        const promise = this._getBlameForFile(uri, entry, key);

        if (entry) {
            Logger.log(`Add blame cache for '${entry.key}:${key}'`);

            entry.set<CachedBlame>(key, {
                item: promise
            } as CachedBlame);
        }

        return promise;
    }

    private async _getBlameForFile(uri: GitUri, entry: GitCacheEntry | undefined, key: string): Promise<GitBlame | undefined> {
        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        const ignore = await this._gitignore;
        if (ignore && !ignore.filter([file]).length) {
            Logger.log(`Skipping blame; '${uri.fsPath}' is gitignored`);
            if (entry && entry.key) {
                this._onDidBlameFail.fire(entry.key);
            }
            return await GitService.EmptyPromise as GitBlame;
        }

        try {
            const data = await Git.blame(root, file, uri.sha, { ignoreWhitespace: this.config.blame.ignoreWhitespace });
            const blame = GitBlameParser.parse(data, root, file);
            return blame;
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace blame cache with empty promise for '${entry.key}:${key}'`);

                entry.set<CachedBlame>(key, {
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as CachedBlame);

                this._onDidBlameFail.fire(entry.key);
                return await GitService.EmptyPromise as GitBlame;
            }

            return undefined;
        }
    }

    async getBlameForLine(uri: GitUri, line: number): Promise<GitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${uri.repoPath}', '${uri.fsPath}', ${line}, ${uri.sha})`);

        if (this.UseCaching) {
            const blame = await this.getBlameForFile(uri);
            if (blame === undefined) return undefined;

            let blameLine = blame.lines[line];
            if (blameLine === undefined) {
                if (blame.lines.length !== line) return undefined;
                blameLine = blame.lines[line - 1];
            }

            const commit = blame.commits.get(blameLine.sha);
            if (commit === undefined) return undefined;

            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                line: blameLine
            } as GitBlameLine;
        }

        const fileName = uri.fsPath;

        try {
            const data = await Git.blame(uri.repoPath, fileName, uri.sha, { ignoreWhitespace: this.config.blame.ignoreWhitespace, startLine: line + 1, endLine: line + 1 });
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName);
            if (blame === undefined) return undefined;

            const commit = Iterables.first(blame.commits.values());
            if (uri.repoPath) {
                commit.repoPath = uri.repoPath;
            }
            return {
                author: Iterables.first(blame.authors.values()),
                commit: commit,
                line: blame.lines[line]
            } as GitBlameLine;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
        Logger.log(`getBlameForRange('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForFile(uri);
        if (blame === undefined) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
        Logger.log(`getBlameForRangeSync('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        if (blame.lines.length === 0) return Object.assign({ allLines: blame.lines }, blame);

        if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
            return Object.assign({ allLines: blame.lines }, blame);
        }

        const lines = blame.lines.slice(range.start.line, range.end.line + 1);
        const shas = new Set(lines.map(l => l.sha));

        const authors: Map<string, GitAuthor> = new Map();
        const commits: Map<string, GitBlameCommit> = new Map();
        for (const c of blame.commits.values()) {
            if (!shas.has(c.sha)) continue;

            const commit = new GitBlameCommit(c.repoPath, c.sha, c.fileName, c.author, c.date, c.message,
                c.lines.filter(l => l.line >= range.start.line && l.line <= range.end.line), c.originalFileName, c.previousSha, c.previousFileName);
            commits.set(c.sha, commit);

            let author = authors.get(commit.author);
            if (author === undefined) {
                author = {
                    name: commit.author,
                    lineCount: 0
                };
                authors.set(author.name, author);
            }

            author.lineCount += commit.lines.length;
        }

        const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

        return {
            authors: sortedAuthors,
            commits: commits,
            lines: lines,
            allLines: blame.lines
        } as GitBlameLines;
    }

    async getBlameLocations(uri: GitUri, range: Range, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getBlameLocations('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForRange(uri, range);
        if (blame === undefined) return undefined;

        const commitCount = blame.commits.size;
        const dateFormat = this.config.defaultDateFormat === null ? 'MMMM Do, YYYY h:MMa' : this.config.defaultDateFormat;

        const locations: Location[] = [];
        Iterables.forEach(blame.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `${GlyphChars.ArrowDropRight} ${c.author}, ${c.formatDate(dateFormat)}`;
            const uri = GitService.toReferenceGitContentUri(c, i + 1, commitCount, c.originalFileName, decoration, dateFormat);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position((line || 0) + 1, 0)));
            }
        });

        return locations;
    }

    async getBranch(repoPath: string): Promise<GitBranch | undefined> {
        Logger.log(`getBranch('${repoPath}')`);

        const data = await Git.branch_current(repoPath);
        const branch = data.split('\n');
        return new GitBranch(repoPath, branch[0], true, branch[1]);
    }

    async getBranches(repoPath: string): Promise<GitBranch[]> {
        Logger.log(`getBranches('${repoPath}')`);

        const data = await Git.branch(repoPath, { all: true });
        return GitBranchParser.parse(data, repoPath) || [];
    }

    getCacheEntryKey(fileName: string): string;
    getCacheEntryKey(uri: Uri): string;
    getCacheEntryKey(fileNameOrUri: string | Uri): string {
        return Git.normalizePath(typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath).toLowerCase();
    }

    async getConfig(key: string, repoPath?: string): Promise<string> {
        Logger.log(`getConfig('${key}', '${repoPath}')`);

        return await Git.config_get(key, repoPath);
    }

    getGitUriForFile(uri: Uri) {
        const cacheKey = this.getCacheEntryKey(uri);
        const entry = this._uriCache.get(cacheKey);
        return entry && entry.uri;
    }

    async getDiffForFile(uri: GitUri, sha1?: string, sha2?: string): Promise<GitDiff | undefined> {
        if (sha1 !== undefined && sha2 === undefined && uri.sha !== undefined) {
            sha2 = uri.sha;
        }

        let key = 'diff';
        if (sha1 !== undefined) {
            key += `:${sha1}`;
        }
        if (sha2 !== undefined) {
            key += `:${sha2}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching) {
            const cacheKey = this.getCacheEntryKey(uri);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedDiff = entry.get<CachedDiff>(key);
                if (cachedDiff !== undefined) {
                    Logger.log(`Cached(${key}): getDiffForFile('${uri.repoPath}', '${uri.fsPath}', ${sha1}, ${sha2})`);
                    return cachedDiff.item;
                }
            }

            Logger.log(`Not Cached(${key}): getDiffForFile('${uri.repoPath}', '${uri.fsPath}', ${sha1}, ${sha2})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getDiffForFile('${uri.repoPath}', '${uri.fsPath}', ${sha1}, ${sha2})`);
        }

        const promise = this._getDiffForFile(uri.repoPath, uri.fsPath, sha1, sha2, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<CachedDiff>(key, {
                item: promise
            } as CachedDiff);
        }

        return promise;
    }

    private async _getDiffForFile(repoPath: string | undefined, fileName: string, sha1: string | undefined, sha2: string | undefined, entry: GitCacheEntry | undefined, key: string): Promise<GitDiff | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const data = await Git.diff(root, file, sha1, sha2);
            const diff = GitDiffParser.parse(data);
            return diff;
        }
        catch (ex) {
            // Trap and cache expected diff errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace diff cache with empty promise for '${entry.key}:${key}'`);

                entry.set<CachedDiff>(key, {
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as CachedDiff);

                return await GitService.EmptyPromise as GitDiff;
            }

            return undefined;
        }
    }

    async getDiffForLine(uri: GitUri, line: number, sha1?: string, sha2?: string): Promise<GitDiffChunkLine | undefined> {
        try {
            const diff = await this.getDiffForFile(uri, sha1, sha2);
            if (diff === undefined) return undefined;

            const chunk = diff.chunks.find(_ => _.currentPosition.start <= line && _.currentPosition.end >= line);
            if (chunk === undefined) return undefined;

            return chunk.lines[line - chunk.currentPosition.start + 1];
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogCommit(repoPath: string | undefined, fileName: string, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined>;
    async getLogCommit(repoPath: string | undefined, fileName: string, sha: string | undefined, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined>;
    async getLogCommit(repoPath: string | undefined, fileName: string, shaOrOptions?: string | undefined | { firstIfMissing?: boolean, previous?: boolean }, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined> {
        let sha: string | undefined = undefined;
        if (typeof shaOrOptions === 'string') {
            sha = shaOrOptions;
        }
        else if (options === undefined) {
            options = shaOrOptions;
        }

        options = options || {};

        const log = await this.getLogForFile(repoPath, fileName, sha, { maxCount: options.previous ? 2 : 1 });
        if (log === undefined) return undefined;

        const commit = sha && log.commits.get(sha);
        if (commit === undefined && sha && !options.firstIfMissing) return undefined;

        return commit || Iterables.first(log.commits.values());
    }

    async getLogForRepo(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false): Promise<GitLog | undefined> {
        Logger.log(`getLogForRepo('${repoPath}', ${sha}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        try {
            const data = await Git.log(repoPath, sha, maxCount, reverse);
            const log = GitLogParser.parse(data, 'branch', repoPath, undefined, sha, maxCount, reverse, undefined);
            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForRepoSearch(repoPath: string, search: string, searchBy: GitRepoSearchBy, maxCount?: number): Promise<GitLog | undefined> {
        Logger.log(`getLogForRepoSearch('${repoPath}', ${search}, ${searchBy}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        let searchArgs: string[] | undefined = undefined;
        switch (searchBy) {
            case GitRepoSearchBy.Author:
                searchArgs = [`--author=${search}`];
                break;
            case GitRepoSearchBy.Files:
                searchArgs = [`--`, `${search}`];
                break;
            case GitRepoSearchBy.Message:
                searchArgs = [`--grep=${search}`];
                break;
            case GitRepoSearchBy.Sha:
                searchArgs = [search];
                maxCount = 1;
                break;
        }

        try {
            const data = await Git.log_search(repoPath, searchArgs, maxCount);
            const log = GitLogParser.parse(data, 'branch', repoPath, undefined, undefined, maxCount, false, undefined);
            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForFile(repoPath: string | undefined, fileName: string, sha?: string, options: { maxCount?: number, range?: Range, reverse?: boolean, skipMerges?: boolean } = {}): Promise<GitLog | undefined> {
        options = { ...{ reverse: false, skipMerges: false }, ...options };

        let key = 'log';
        if (sha !== undefined) {
            key += `:${sha}`;
        }
        if (options.maxCount !== undefined) {
            key += `:n${options.maxCount}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching && options.range === undefined && !options.reverse) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedLog = entry.get<CachedLog>(key);
                if (cachedLog !== undefined) {
                    Logger.log(`Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                    return cachedLog.item;
                }

                if (key !== 'log') {
                    // Since we are looking for partial log, see if we have the log of the whole file
                    const cachedLog = entry.get<CachedLog>('log');
                    if (cachedLog !== undefined) {
                        if (sha === undefined) {
                            Logger.log(`Cached(~${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                            return cachedLog.item;
                        }

                        Logger.log(`? Cache(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                        const log = await cachedLog.item;
                        if (log !== undefined && log.commits.has(sha)) {
                            Logger.log(`Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                            return cachedLog.item;
                        }
                    }
                }
            }

            Logger.log(`Not Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, ${options.range && `[${options.range.start.line}, ${options.range.end.line}]`}, ${options.reverse})`);
        }

        const promise = this._getLogForFile(repoPath, fileName, sha, options, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<CachedLog>(key, {
                item: promise
            } as CachedLog);
        }

        return promise;
    }

    private async _getLogForFile(repoPath: string | undefined, fileName: string, sha: string | undefined, options: { maxCount?: number, range?: Range, reverse?: boolean, skipMerges?: boolean }, entry: GitCacheEntry | undefined, key: string): Promise<GitLog | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        const ignore = await this._gitignore;
        if (ignore && !ignore.filter([file]).length) {
            Logger.log(`Skipping log; '${fileName}' is gitignored`);
            return await GitService.EmptyPromise as GitLog;
        }

        try {
            const { range, ...opts } = options;
            const data = await Git.log_file(root, file, sha, { ...opts, ...{ startLine: range && range.start.line + 1, endLine: range && range.end.line + 1 } });
            const log = GitLogParser.parse(data, 'file', root, file, sha, options.maxCount, options.reverse!, range);
            return log;
        }
        catch (ex) {
            // Trap and cache expected log errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace log cache with empty promise for '${entry.key}:${key}'`);

                entry.set<CachedLog>(key, {
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as CachedLog);

                return await GitService.EmptyPromise as GitLog;
            }

            return undefined;
        }
    }

    async getLogLocations(uri: GitUri, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getLogLocations('${uri.repoPath}', '${uri.fsPath}', ${uri.sha}, ${selectedSha}, ${line})`);

        const log = await this.getLogForFile(uri.repoPath, uri.fsPath, uri.sha);
        if (log === undefined) return undefined;

        const commitCount = log.commits.size;
        const dateFormat = this.config.defaultDateFormat === null ? 'MMMM Do, YYYY h:MMa' : this.config.defaultDateFormat;

        const locations: Location[] = [];
        Iterables.forEach(log.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `${GlyphChars.ArrowDropRight} ${c.author}, ${c.formatDate(dateFormat)}`;
            const uri = GitService.toReferenceGitContentUri(c, i + 1, commitCount, c.originalFileName, decoration, dateFormat);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position((line || 0) + 1, 0)));
            }
        });

        return locations;
    }

    hasRemotes(repoPath: string): boolean {
        const remotes = this._remotesCache.get(repoPath);
        return remotes !== undefined && remotes.length > 0;
    }

    async getRemotes(repoPath: string): Promise<GitRemote[]> {
        if (!repoPath) return [];

        Logger.log(`getRemotes('${repoPath}')`);

        let remotes = this._remotesCache.get(repoPath);
        if (remotes !== undefined) return remotes;

        const data = await Git.remote(repoPath);
        remotes = GitRemoteParser.parse(data, repoPath);

        if (remotes !== undefined) {
            this._remotesCache.set(repoPath, remotes);
        }

        return remotes;
    }

    getRepoPath(cwd: string): Promise<string> {
        return GitService.getRepoPath(cwd);
    }

    async getRepoPathFromFile(fileName: string): Promise<string | undefined> {
        const log = await this.getLogForFile(undefined, fileName, undefined, { maxCount: 1 });
        if (log === undefined) return undefined;

        return log.repoPath;
    }

    async getRepoPathFromUri(uri: Uri | undefined): Promise<string | undefined> {
        if (!(uri instanceof Uri)) return this.repoPath;

        const repoPath = (await GitUri.fromUri(uri, this)).repoPath;
        if (!repoPath) return this.repoPath;

        return repoPath;
    }

    async getStashList(repoPath: string): Promise<GitStash | undefined> {
        Logger.log(`getStash('${repoPath}')`);

        const data = await Git.stash_list(repoPath);
        const stash = GitStashParser.parse(data, repoPath);
        return stash;
    }

    async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
        Logger.log(`getStatusForFile('${repoPath}', '${fileName}')`);

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status_file(repoPath, fileName, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        if (status === undefined || !status.files.length) return undefined;

        return status.files[0];
    }

    async getStatusForRepo(repoPath: string): Promise<GitStatus | undefined> {
        Logger.log(`getStatusForRepo('${repoPath}')`);

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status(repoPath, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        return status;
    }

    async getVersionedFile(repoPath: string | undefined, fileName: string, sha: string) {
        Logger.log(`getVersionedFile('${repoPath}', '${fileName}', ${sha})`);

        const file = await Git.getVersionedFile(repoPath, fileName, sha);
        if (file === undefined) return undefined;

        const cacheKey = this.getCacheEntryKey(file);
        const entry = new UriCacheEntry(new GitUri(Uri.file(fileName), { sha, repoPath: repoPath!, fileName }));
        this._uriCache.set(cacheKey, entry);
        return file;
    }

    getVersionedFileText(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFileText('${repoPath}', '${fileName}', ${sha})`);

        return Git.show(repoPath, fileName, sha);
    }

    hasGitUriForFile(editor: TextEditor): boolean {
        if (editor === undefined || editor.document === undefined || editor.document.uri === undefined) return false;

        const cacheKey = this.getCacheEntryKey(editor.document.uri);
        return this._uriCache.has(cacheKey);
    }

    isEditorBlameable(editor: TextEditor): boolean {
        return (editor.viewColumn !== undefined || this.isTrackable(editor.document.uri) || this.hasGitUriForFile(editor));
    }

    async isFileUncommitted(uri: GitUri): Promise<boolean> {
        Logger.log(`isFileUncommitted('${uri.repoPath}', '${uri.fsPath}')`);

        const status = await this.getStatusForFile(uri.repoPath!, uri.fsPath);
        return !!status;
    }

    isTrackable(uri: Uri): boolean {
        // Logger.log(`isTrackable('${uri.scheme}', '${uri.fsPath}')`);

        return uri.scheme === DocumentSchemes.File || uri.scheme === DocumentSchemes.Git || uri.scheme === DocumentSchemes.GitLensGit;
    }

    async isTracked(uri: GitUri): Promise<boolean> {
        if (!this.isTrackable(uri)) return false;

        Logger.log(`isTracked('${uri.fsPath}', '${uri.repoPath}')`);

        const result = await Git.ls_files(uri.repoPath === undefined ? '' : uri.repoPath, uri.fsPath);
        return !!result;
    }

    openDirectoryDiff(repoPath: string, sha1: string, sha2?: string) {
        Logger.log(`openDirectoryDiff('${repoPath}', ${sha1}, ${sha2})`);

        return Git.difftool_dirDiff(repoPath, sha1, sha2);
    }

    stashApply(repoPath: string, stashName: string, deleteAfter: boolean = false) {
        Logger.log(`stashApply('${repoPath}', ${stashName}, ${deleteAfter})`);

        return Git.stash_apply(repoPath, stashName, deleteAfter);
    }

    stashDelete(repoPath: string, stashName: string) {
        Logger.log(`stashDelete('${repoPath}', ${stashName}})`);

        return Git.stash_delete(repoPath, stashName);
    }

    stashSave(repoPath: string, message?: string, uris?: Uri[]) {
        Logger.log(`stashSave('${repoPath}', ${message}, ${uris})`);

        if (uris === undefined) return Git.stash_save(repoPath, message);
        const pathspecs = uris.map(u => Git.splitPath(u.fsPath, repoPath)[0]);
        return Git.stash_push(repoPath, pathspecs, message);
    }

    static getGitPath(gitPath?: string): Promise<IGit> {
        return Git.getGitPath(gitPath);
    }

    static getGitVersion(): string {
        return Git.gitInfo().version;
    }

    static async getRepoPath(cwd: string | undefined): Promise<string> {
        const repoPath = await Git.getRepoPath(cwd);
        if (!repoPath) return '';

        return repoPath;
    }

    static fromGitContentUri(uri: Uri): IGitUriData {
        if (uri.scheme !== DocumentSchemes.GitLensGit) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return GitService._fromGitContentUri<IGitUriData>(uri);
    }

    private static _fromGitContentUri<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }

    static isSha(sha: string): boolean {
        return Git.isSha(sha);
    }

    static isUncommitted(sha: string): boolean {
        return Git.isUncommitted(sha);
    }

    static normalizePath(fileName: string, repoPath?: string): string {
        return Git.normalizePath(fileName, repoPath);
    }

    static shortenSha(sha: string | undefined) {
        if (sha === undefined) return undefined;
        return Git.shortenSha(sha);
    }

    static toGitContentUri(sha: string, fileName: string, repoPath: string, originalFileName?: string): Uri;
    static toGitContentUri(commit: GitCommit): Uri;
    static toGitContentUri(uri: GitUri): Uri;
    static toGitContentUri(shaOrcommitOrUri: string | GitCommit | GitUri, fileName?: string, repoPath?: string, originalFileName?: string): Uri {
        let data: IGitUriData;
        let shortSha: string | undefined;
        if (typeof shaOrcommitOrUri === 'string') {
            data = GitService._toGitUriData({
                sha: shaOrcommitOrUri,
                fileName: fileName!,
                repoPath: repoPath!,
                originalFileName: originalFileName
            });
            shortSha = GitService.shortenSha(shaOrcommitOrUri);
        }
        else if (shaOrcommitOrUri instanceof GitCommit) {
            data = GitService._toGitUriData(shaOrcommitOrUri, undefined, shaOrcommitOrUri.originalFileName);
            fileName = shaOrcommitOrUri.fileName;
            shortSha = shaOrcommitOrUri.shortSha;
        }
        else {
            data = GitService._toGitUriData({
                sha: shaOrcommitOrUri.sha!,
                fileName: shaOrcommitOrUri.fsPath!,
                repoPath: shaOrcommitOrUri.repoPath!
            });
            fileName = shaOrcommitOrUri.fsPath;
            shortSha = shaOrcommitOrUri.shortSha;
        }

        const extension = path.extname(fileName!);
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${path.basename(fileName!, extension)}:${shortSha}${extension}?${JSON.stringify(data)}`);
    }

    static toReferenceGitContentUri(commit: GitCommit, index: number, commitCount: number, originalFileName: string | undefined, decoration: string, dateFormat: string | null): Uri {
        return GitService._toReferenceGitContentUri(commit, DocumentSchemes.GitLensGit, commitCount, GitService._toGitUriData(commit, index, originalFileName, decoration), dateFormat);
    }

    private static _toReferenceGitContentUri(commit: GitCommit, scheme: DocumentSchemes, commitCount: number, data: IGitUriData, dateFormat: string | null) {
        const pad = (n: number) => ('0000000' + n).slice(-('' + commitCount).length);
        const ext = path.extname(data.fileName);
        const uriPath = `${path.relative(commit.repoPath, data.fileName.slice(0, -ext.length))}/${commit.shortSha}${ext}`;

        let message = commit.message;
        if (message.length > 50) {
            message = message.substring(0, 49) + GlyphChars.Ellipsis;
        }

        if (dateFormat === null) {
            dateFormat = 'MMMM Do, YYYY h:MMa';
        }

        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${scheme}:${pad(data.index || 0)} ${GlyphChars.Dot} ${encodeURIComponent(message)} ${GlyphChars.Dot} ${commit.formatDate(dateFormat)} ${GlyphChars.Dot} ${encodeURIComponent(uriPath)}?${JSON.stringify(data)}`);
    }

    private static _toGitUriData<T extends IGitUriData>(commit: IGitUriData, index?: number, originalFileName?: string, decoration?: string): T {
        const fileName = Git.normalizePath(path.resolve(commit.repoPath, commit.fileName));
        const data = { repoPath: commit.repoPath, fileName: fileName, sha: commit.sha, index: index } as T;
        if (originalFileName) {
            data.originalFileName = Git.normalizePath(path.resolve(commit.repoPath, originalFileName));
        }
        if (decoration) {
            data.decoration = decoration;
        }
        return data;
    }

    static validateGitVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = this.getGitVersion().split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }
}