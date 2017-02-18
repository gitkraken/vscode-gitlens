'use strict';
import { Iterables, Objects } from './system';
import { Disposable, Event, EventEmitter, ExtensionContext, languages, Location, Position, Range, TextDocument, TextEditor, Uri, workspace } from 'vscode';
import { CodeLensVisibility, IConfig } from './configuration';
import { DocumentSchemes, WorkspaceState } from './constants';
import Git, { GitBlameParserEnricher, GitBlameFormat, GitCommit, GitLogParserEnricher, IGitAuthor, IGitBlame, IGitBlameLine, IGitBlameLines, IGitLog } from './git/git';
import { IGitUriData, GitUri } from './git/gitUri';
import GitCodeLensProvider from './gitCodeLensProvider';
import { Logger } from './logger';
import * as fs from 'fs';
import * as ignore from 'ignore';
import * as moment from 'moment';
import * as path from 'path';

export { Git, GitUri };
export * from './git/git';

class UriCacheEntry {

    constructor(public uri: GitUri) { }
}

class GitCacheEntry {

    blame?: ICachedBlame;
    log?: ICachedLog;

    get hasErrors() {
        return !!((this.blame && this.blame.errorMessage) || (this.log && this.log.errorMessage));
    }
}

interface ICachedItem<T> {
    //date: Date;
    item: Promise<T>;
    errorMessage?: string;
}

interface ICachedBlame extends ICachedItem<IGitBlame> { }
interface ICachedLog extends ICachedItem<IGitLog> { }

enum RemoveCacheReason {
    DocumentClosed,
    DocumentSaved
}

export default class GitProvider extends Disposable {

    private _onDidRemoveCacheEntryEmitter = new EventEmitter<void>();
    get onDidRemoveCacheEntry(): Event<void> {
        return this._onDidRemoveCacheEntryEmitter.event;
    }

    private _gitCache: Map<string, GitCacheEntry> | undefined;
    private _cacheDisposable: Disposable | undefined;
    private _repoPath: string;
    private _uriCache: Map<string, UriCacheEntry> | undefined;

    config: IConfig;
    private _codeLensProvider: GitCodeLensProvider | undefined;
    private _codeLensProviderDisposable: Disposable | undefined;
    private _disposable: Disposable;
    private _gitignore: Promise<ignore.Ignore>;

    static EmptyPromise: Promise<IGitBlame | IGitLog> = Promise.resolve(undefined);
    static BlameFormat = GitBlameFormat.incremental;

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());

        this._repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();

        this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
        this._codeLensProviderDisposable = undefined;
        this._codeLensProvider = undefined;

        this._cacheDisposable && this._cacheDisposable.dispose();
        this._uriCache && this._uriCache.clear();
        this._gitCache && this._gitCache.clear();
    }

    public get UseUriCaching() {
        return !!this._uriCache;
    }

    public get UseGitCaching() {
        return !!this._gitCache;
    }

    private _onConfigurationChanged() {
        const config = workspace.getConfiguration().get<IConfig>('gitlens');

        const codeLensChanged = !Objects.areEquivalent(config.codeLens, this.config && this.config.codeLens);
        const advancedChanged = !Objects.areEquivalent(config.advanced, this.config && this.config.advanced);

        if (codeLensChanged || advancedChanged) {
            Logger.log('CodeLens config changed; resetting CodeLens provider');
            // this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
            if (config.codeLens.visibility === CodeLensVisibility.Auto && (config.codeLens.recentChange.enabled || config.codeLens.authors.enabled)) {
                if (this._codeLensProvider) {
                    this._codeLensProvider.reset();
                }
                else {
                    this._codeLensProvider = new GitCodeLensProvider(this.context, this);
                    this._codeLensProviderDisposable = languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._codeLensProvider);
                }
            }
            else {
                this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
                this._codeLensProviderDisposable = undefined;
                this._codeLensProvider = undefined;
            }
        }

        if (advancedChanged) {
            if (config.advanced.caching.enabled) {
                // TODO: Cache needs to be cleared on file changes -- createFileSystemWatcher or timeout?
                this._gitCache = new Map();
                this._uriCache = new Map();

                const disposables: Disposable[] = [];

                // TODO: Maybe stop clearing on close and instead limit to a certain number of recent blames
                disposables.push(workspace.onDidCloseTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentClosed)));
                disposables.push(workspace.onDidSaveTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentSaved)));

                this._cacheDisposable = Disposable.from(...disposables);
            }
            else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;

                this._uriCache && this._uriCache.clear();
                this._uriCache = undefined;

                this._gitCache && this._gitCache.clear();
                this._gitCache = undefined;
            }

            this._gitignore = new Promise<ignore.Ignore | undefined>((resolve, reject) => {
                if (!config.advanced.gitignore.enabled) {
                    resolve(undefined);
                    return;
                }

                const gitignorePath = path.join(this._repoPath, '.gitignore');
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

        this.config = config;
    }

    private _getCacheEntryKey(fileName: string) {
        return fileName.toLowerCase();
    }

    private _removeCachedEntry(document: TextDocument, reason: RemoveCacheReason) {
        if (!this.UseGitCaching) return;
        if (document.uri.scheme !== DocumentSchemes.File) return;

        const fileName = Git.normalizePath(document.fileName);

        const cacheKey = this._getCacheEntryKey(fileName);

        if (reason === RemoveCacheReason.DocumentSaved) {
            // Don't remove broken blame on save (since otherwise we'll have to run the broken blame again)
            const entry = this._gitCache.get(cacheKey);
            if (entry && entry.hasErrors) return;
        }

        if (this._gitCache.delete(cacheKey)) {
            Logger.log(`Clear cache entry for '${cacheKey}', reason=${RemoveCacheReason[reason]}`);

            if (reason === RemoveCacheReason.DocumentSaved) {
                this._onDidRemoveCacheEntryEmitter.fire();

                // Refresh the codelenses with the update blame
                this._codeLensProvider && this._codeLensProvider.reset();
            }
        }
    }

    hasGitUriForFile(editor: TextEditor): boolean;
    hasGitUriForFile(fileName: string): boolean;
    hasGitUriForFile(fileNameOrEditor: string | TextEditor): boolean {
        if (!this.UseUriCaching) return false;

        let fileName: string;
        if (typeof fileNameOrEditor === 'string') {
            fileName = fileNameOrEditor;
        }
        else {
            if (!fileNameOrEditor || !fileNameOrEditor.document || !fileNameOrEditor.document.uri) return false;
            fileName = fileNameOrEditor.document.uri.fsPath;
        }

        const cacheKey = this._getCacheEntryKey(fileName);
        return this._uriCache.has(cacheKey);
    }

    async findMostRecentCommitForFile(fileName: string, sha?: string): Promise<GitCommit> {
        const exists = await new Promise<boolean>((resolve, reject) => fs.exists(fileName, e => resolve(e)));
        if (exists) return null;

        return undefined;

        // TODO: Get this to work -- for some reason a reverse log won't return the renamed file
        // Not sure how else to figure this out

        // let log: IGitLog;
        // let commit: GitCommit;
        // while (true) {
        //     // Go backward from the current commit to head to find the latest filename
        //     log = await this.getLogForFile(fileName, sha, undefined, undefined, undefined, true);
        //     if (!log) break;

        //     commit = Iterables.first(log.commits.values());
        //     sha = commit.sha;
        //     fileName = commit.fileName;
        // }

        // return commit;
    }

    getGitUriForFile(fileName: string) {
        if (!this.UseUriCaching) return undefined;

        const cacheKey = this._getCacheEntryKey(fileName);
        const entry = this._uriCache.get(cacheKey);
        return entry && entry.uri;
    }

    getRepoPath(cwd: string): Promise<string> {
        return Git.repoPath(cwd);
    }

    async getRepoPathFromFile(fileName: string): Promise<string | undefined> {
        const log = await this.getLogForFile(fileName, undefined, undefined, undefined, 1);
        return log && log.repoPath;
    }

    getBlameForFile(fileName: string, sha?: string, repoPath?: string): Promise<IGitBlame | undefined> {
        Logger.log(`getBlameForFile('${fileName}', ${sha}, ${repoPath})`);
        fileName = Git.normalizePath(fileName);

        const useCaching = this.UseGitCaching && !sha;

        let cacheKey: string | undefined;
        let entry: GitCacheEntry | undefined;
        if (useCaching) {
            cacheKey = this._getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined && entry.blame !== undefined) return entry.blame.item;
            if (entry === undefined) {
                entry = new GitCacheEntry();
            }
        }

        const promise = this._gitignore.then(ignore => {
            if (ignore && !ignore.filter([fileName]).length) {
                Logger.log(`Skipping blame; '${fileName}' is gitignored`);
                return GitProvider.EmptyPromise as Promise<IGitBlame>;
            }

            return Git.blame(GitProvider.BlameFormat, fileName, sha, repoPath)
                .then(data => new GitBlameParserEnricher(GitProvider.BlameFormat).enrich(data, fileName))
                .catch(ex => {
                    // Trap and cache expected blame errors
                    if (useCaching) {
                        const msg = ex && ex.toString();
                        Logger.log(`Replace blame cache with empty promise for '${cacheKey}'`);

                        entry.blame = {
                            //date: new Date(),
                            item: GitProvider.EmptyPromise,
                            errorMessage: msg
                        } as ICachedBlame;

                        this._gitCache.set(cacheKey, entry);
                        return GitProvider.EmptyPromise as Promise<IGitBlame>;
                    }
                    return undefined;
                });
        });

        if (useCaching) {
            Logger.log(`Add blame cache for '${cacheKey}'`);

            entry.blame = {
                //date: new Date(),
                item: promise
            } as ICachedBlame;

            this._gitCache.set(cacheKey, entry);
        }

        return promise;
    }

    async getBlameForLine(fileName: string, line: number, sha?: string, repoPath?: string): Promise<IGitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${fileName}', ${line}, ${sha}, ${repoPath})`);

        if (this.UseGitCaching && !sha) {
            const blame = await this.getBlameForFile(fileName);
            const blameLine = blame && blame.lines[line];
            if (!blameLine) return undefined;

            const commit = blame.commits.get(blameLine.sha);
            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                line: blameLine
            } as IGitBlameLine;
        }

        fileName = Git.normalizePath(fileName);

        try {
            const data = await Git.blameLines(GitProvider.BlameFormat, fileName, line + 1, line + 1, sha, repoPath);
            const blame = new GitBlameParserEnricher(GitProvider.BlameFormat).enrich(data, fileName);
            if (!blame) return undefined;

            const commit = Iterables.first(blame.commits.values());
            if (repoPath) {
                commit.repoPath = repoPath;
            }
            return {
                author: Iterables.first(blame.authors.values()),
                commit: commit,
                line: blame.lines[line]
            } as IGitBlameLine;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getBlameForRange(fileName: string, range: Range, sha?: string, repoPath?: string): Promise<IGitBlameLines | undefined> {
        Logger.log(`getBlameForRange('${fileName}', [${range.start.line}, ${range.end.line}], ${sha}, ${repoPath})`);
        const blame = await this.getBlameForFile(fileName, sha, repoPath);
        if (!blame) return undefined;

        return this.getBlameForRangeSync(blame, fileName, range, sha, repoPath);
    }

    getBlameForRangeSync(blame: IGitBlame, fileName: string, range: Range, sha?: string, repoPath?: string): IGitBlameLines | undefined {
        Logger.log(`getBlameForRangeSync('${fileName}', [${range.start.line}, ${range.end.line}], ${sha}, ${repoPath})`);

        if (!blame.lines.length) return Object.assign({ allLines: blame.lines }, blame);

        if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
            return Object.assign({ allLines: blame.lines }, blame);
        }

        const lines = blame.lines.slice(range.start.line, range.end.line + 1);
        const shas: Set<string> = new Set();
        lines.forEach(l => shas.add(l.sha));

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, GitCommit> = new Map();
        blame.commits.forEach(c => {
            if (!shas.has(c.sha)) return;

            const commit: GitCommit = new GitCommit(c.repoPath, c.sha, c.fileName, c.author, c.date, c.message,
                c.lines.filter(l => l.line >= range.start.line && l.line <= range.end.line), c.originalFileName, c.previousSha, c.previousFileName);
            commits.set(c.sha, commit);

            let author = authors.get(commit.author);
            if (!author) {
                author = {
                    name: commit.author,
                    lineCount: 0
                };
                authors.set(author.name, author);
            }

            author.lineCount += commit.lines.length;
        });

        const sortedAuthors: Map<string, IGitAuthor> = new Map();
        Array.from(authors.values())
            .sort((a, b) => b.lineCount - a.lineCount)
            .forEach(a => sortedAuthors.set(a.name, a));

        return {
            authors: sortedAuthors,
            commits: commits,
            lines: lines,
            allLines: blame.lines
        } as IGitBlameLines;
    }

    async getBlameLocations(fileName: string, range: Range, sha?: string, repoPath?: string, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getBlameLocations('${fileName}', [${range.start.line}, ${range.end.line}], ${sha}, ${repoPath})`);

        const blame = await this.getBlameForRange(fileName, range, sha, repoPath);
        if (!blame) return undefined;

        const commitCount = blame.commits.size;

        const locations: Array<Location> = [];
        Iterables.forEach(blame.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `\u2937 ${c.author}, ${moment(c.date).format('MMMM Do, YYYY h:MMa')}`;
            const uri = GitProvider.toGitUri(c, i + 1, commitCount, c.originalFileName, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position(line + 1, 0)));
            }
        });

        return locations;
    }

    async getLogForRepo(repoPath: string, sha?: string, maxCount?: number): Promise<IGitLog | undefined> {
        Logger.log(`getLogForRepo('${repoPath}', ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        try {
            const data = await Git.logRepo(repoPath, sha, maxCount);
            return new GitLogParserEnricher().enrich(data, 'repo', repoPath, true);
        }
        catch (ex) {
            return undefined;
        }
    }

    getLogForFile(fileName: string, sha?: string, repoPath?: string, range?: Range, maxCount?: number, reverse: boolean = false): Promise<IGitLog | undefined> {
        Logger.log(`getLogForFile('${fileName}', ${sha}, ${repoPath}, ${range && `[${range.start.line}, ${range.end.line}]`}, ${maxCount})`);
        fileName = Git.normalizePath(fileName);

        const useCaching = this.UseGitCaching && !sha && !range && !maxCount;

        let cacheKey: string;
        let entry: GitCacheEntry;
        if (useCaching) {
            cacheKey = this._getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined && entry.log !== undefined) return entry.log.item;
            if (entry === undefined) {
                entry = new GitCacheEntry();
            }
        }

        const promise = this._gitignore.then(ignore => {
            if (ignore && !ignore.filter([fileName]).length) {
                Logger.log(`Skipping log; '${fileName}' is gitignored`);
                return GitProvider.EmptyPromise as Promise<IGitLog>;
            }

            return (range
                ? Git.logRange(fileName, range.start.line + 1, range.end.line + 1, sha, repoPath, maxCount)
                : Git.log(fileName, sha, repoPath, maxCount, reverse))
                .then(data => new GitLogParserEnricher().enrich(data, 'file', repoPath || fileName, !!repoPath))
                .catch(ex => {
                    // Trap and cache expected log errors
                    if (useCaching) {
                        const msg = ex && ex.toString();
                        Logger.log(`Replace log cache with empty promise for '${cacheKey}'`);

                        entry.log = {
                            //date: new Date(),
                            item: GitProvider.EmptyPromise,
                            errorMessage: msg
                        } as ICachedLog;

                        this._gitCache.set(cacheKey, entry);
                        return GitProvider.EmptyPromise as Promise<IGitLog>;
                    }
                    return undefined;
                });
        });

        if (useCaching) {
            Logger.log(`Add log cache for '${cacheKey}'`);

            entry.log = {
                //date: new Date(),
                item: promise
            } as ICachedLog;

            this._gitCache.set(cacheKey, entry);
        }

        return promise;
    }

    async getLogLocations(fileName: string, sha?: string, repoPath?: string, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getLogLocations('${fileName}', ${sha}, ${repoPath}, ${selectedSha}, ${line})`);

        const log = await this.getLogForFile(fileName, sha, repoPath);
        if (!log) return undefined;

        const commitCount = log.commits.size;

        const locations: Array<Location> = [];
        Iterables.forEach(log.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `\u2937 ${c.author}, ${moment(c.date).format('MMMM Do, YYYY h:MMa')}`;
            const uri = GitProvider.toGitUri(c, i + 1, commitCount, c.originalFileName, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position(line + 1, 0)));
            }
        });

        return locations;
    }

    async getStatusForFile(fileName: string, repoPath: string) {
        Logger.log(`getStatusForFile('${fileName}', ${repoPath})`);
        return (await Git.statusForFile(fileName, repoPath)).trim();
    }

    async isFileUncommitted(fileName: string, repoPath: string) {
        Logger.log(`isFileUncommitted('${fileName}', ${repoPath})`);
        const status = await this.getStatusForFile(fileName, repoPath);
        return status && status.length;
    }

    async getVersionedFile(fileName: string, repoPath: string, sha: string) {
        Logger.log(`getVersionedFile('${fileName}', ${repoPath}, ${sha})`);

        const file = await Git.getVersionedFile(fileName, repoPath, sha);
        if (this.UseUriCaching) {
            const cacheKey = this._getCacheEntryKey(file);
            const entry = new UriCacheEntry(new GitUri(Uri.file(fileName), { sha, repoPath, fileName }));
            this._uriCache.set(cacheKey, entry);
        }
        return file;
    }

    getVersionedFileText(fileName: string, repoPath: string, sha: string) {
        Logger.log(`getVersionedFileText('${fileName}', ${repoPath}, ${sha})`);
        return Git.getVersionedFileText(fileName, repoPath, sha);
    }

    toggleCodeLens(editor: TextEditor) {
        if (this.config.codeLens.visibility !== CodeLensVisibility.OnDemand ||
            (!this.config.codeLens.recentChange.enabled && !this.config.codeLens.authors.enabled)) return;

        Logger.log(`toggleCodeLens(${editor})`);

        if (this._codeLensProviderDisposable) {
            this._codeLensProviderDisposable.dispose();
            this._codeLensProviderDisposable = undefined;
            return;
        }

        this._codeLensProviderDisposable = languages.registerCodeLensProvider(GitCodeLensProvider.selector, new GitCodeLensProvider(this.context, this));
    }

    static isUncommitted(sha: string) {
        return Git.isUncommitted(sha);
    }

    static fromGitUri(uri: Uri): IGitUriData {
        if (uri.scheme !== DocumentSchemes.Git) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return GitProvider._fromGitUri<IGitUriData>(uri);
    }

    private static _fromGitUri<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }

    static toGitUri(commit: GitCommit, index: number, commitCount: number, originalFileName?: string, decoration?: string) {
        return GitProvider._toGitUri(commit, DocumentSchemes.Git, commitCount, GitProvider._toGitUriData(commit, index, originalFileName, decoration));
    }

    private static _toGitUri(commit: GitCommit, scheme: DocumentSchemes, commitCount: number, data: IGitUriData) {
        const pad = (n: number) => ('0000000' + n).slice(-('' + commitCount).length);
        const ext = path.extname(data.fileName);
        const uriPath = `${path.relative(commit.repoPath, data.fileName.slice(0, -ext.length))}/${commit.sha}${ext}`;

        let message = commit.message;
        if (message.length > 50) {
            message = message.substring(0, 49) + '\u2026';
        }

        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${scheme}:${pad(data.index)} \u2022 ${encodeURIComponent(message)} \u2022 ${moment(commit.date).format('MMM D, YYYY hh:MMa')} \u2022 ${encodeURIComponent(uriPath)}?${JSON.stringify(data)}`);
    }

    private static _toGitUriData<T extends IGitUriData>(commit: GitCommit, index: number, originalFileName?: string, decoration?: string): T {
        const fileName = Git.normalizePath(path.join(commit.repoPath, commit.fileName));
        const data = { repoPath: commit.repoPath, fileName: fileName, sha: commit.sha, index: index } as T;
        if (originalFileName) {
            data.originalFileName = Git.normalizePath(path.join(commit.repoPath, originalFileName));
        }
        if (decoration) {
            data.decoration = decoration;
        }
        return data;
    }
}