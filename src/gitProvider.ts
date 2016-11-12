'use strict';
import { Functions, Iterables, Objects } from './system';
import { Disposable, DocumentFilter, ExtensionContext, languages, Location, Position, Range, TextDocument, TextEditor, Uri, window, workspace } from 'vscode';
import { CodeLensVisibility, IConfig } from './configuration';
import { DocumentSchemes, WorkspaceState } from './constants';
import Git, { GitBlameParserEnricher, GitBlameFormat, GitCommit, GitLogParserEnricher, IGitAuthor, IGitBlame, IGitBlameLine, IGitBlameLines, IGitLog } from './git/git';
import GitCodeLensProvider from './gitCodeLensProvider';
import { Logger } from './logger';
import * as fs from 'fs';
import * as ignore from 'ignore';
import * as moment from 'moment';
import * as path from 'path';

export { Git };
export * from './git/git';

class CacheEntry {
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
    DocumentSaved,
    DocumentChanged
}

export default class GitProvider extends Disposable {
    private _cache: Map<string, CacheEntry> | undefined;
    private _cacheDisposable: Disposable | undefined;

    private _config: IConfig;
    private _disposable: Disposable;
    private _codeLensProviderDisposable: Disposable | undefined;
    private _codeLensProviderSelector: DocumentFilter;
    private _gitignore: Promise<ignore.Ignore>;

    static EmptyPromise: Promise<IGitBlame | IGitLog> = Promise.resolve(undefined);
    static BlameFormat = GitBlameFormat.incremental;

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());

        const repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;

        this._onConfigure();

        this._gitignore = new Promise<ignore.Ignore | undefined>((resolve, reject) => {
            const gitignorePath = path.join(repoPath, '.gitignore');
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

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigure, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
        this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
        this._cacheDisposable && this._cacheDisposable.dispose();
        this._cache && this._cache.clear();
    }

    public get UseCaching() {
        return !!this._cache;
    }

    private _onConfigure() {
        const config = workspace.getConfiguration().get<IConfig>('gitlens');

        const codeLensChanged = !Objects.areEquivalent(config.codeLens, this._config && this._config.codeLens);
        const advancedChanged = !Objects.areEquivalent(config.advanced, this._config && this._config.advanced);

        if (codeLensChanged || advancedChanged) {
            Logger.log('CodeLens config changed; resetting CodeLens provider');
            this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
            if (config.codeLens.visibility === CodeLensVisibility.Auto && (config.codeLens.recentChange.enabled || config.codeLens.authors.enabled)) {
                this._codeLensProviderSelector = GitCodeLensProvider.selector;
                this._codeLensProviderDisposable = languages.registerCodeLensProvider(this._codeLensProviderSelector, new GitCodeLensProvider(this.context, this));
            } else {
                this._codeLensProviderDisposable = undefined;
            }
        }

        if (advancedChanged) {
            if (config.advanced.caching.enabled) {
                // TODO: Cache needs to be cleared on file changes -- createFileSystemWatcher or timeout?
                this._cache = new Map();

                const disposables: Disposable[] = [];

                // TODO: Maybe stop clearing on close and instead limit to a certain number of recent blames
                disposables.push(workspace.onDidCloseTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentClosed)));

                const removeCachedEntryFn = Functions.debounce(this._removeCachedEntry.bind(this), 2500);
                disposables.push(workspace.onDidSaveTextDocument(d => removeCachedEntryFn(d, RemoveCacheReason.DocumentSaved)));
                disposables.push(workspace.onDidChangeTextDocument(e => removeCachedEntryFn(e.document, RemoveCacheReason.DocumentChanged)));

                this._cacheDisposable = Disposable.from(...disposables);
            } else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;
                this._cache && this._cache.clear();
                this._cache = undefined;
            }
        }

        this._config = config;
    }

    private _getCacheEntryKey(fileName: string) {
        return fileName.toLowerCase();
    }

    private _removeCachedEntry(document: TextDocument, reason: RemoveCacheReason) {
        if (!this.UseCaching) return;
        if (document.uri.scheme !== DocumentSchemes.File) return;

        const fileName = Git.normalizePath(document.fileName);

        const cacheKey = this._getCacheEntryKey(fileName);
        if (reason === RemoveCacheReason.DocumentClosed) {
            // Don't remove broken blame on close (since otherwise we'll have to run the broken blame again)
            const entry = this._cache.get(cacheKey);
            if (entry && entry.hasErrors) return;
        }

        if (this._cache.delete(cacheKey)) {
            Logger.log(`Clear cache entry for '${cacheKey}', reason=${RemoveCacheReason[reason]}`);

            // if (reason === RemoveCacheReason.DocumentSaved) {
            //     // TODO: Killing the code lens provider is too drastic -- makes the editor jump around, need to figure out how to trigger a refresh
            //     this._registerCodeLensProvider();
            // }
        }
    }

    getRepoPath(cwd: string): Promise<string> {
        return Git.repoPath(cwd);
    }

    getBlameForFile(fileName: string, sha?: string, repoPath?: string): Promise<IGitBlame | undefined> {
        Logger.log(`getBlameForFile('${fileName}', ${sha}, ${repoPath})`);
        fileName = Git.normalizePath(fileName);

        const useCaching = this.UseCaching && !sha;

        let cacheKey: string | undefined;
        let entry: CacheEntry | undefined;
        if (useCaching) {
            cacheKey = this._getCacheEntryKey(fileName);
            entry = this._cache.get(cacheKey);

            if (entry !== undefined && entry.blame !== undefined) return entry.blame.item;
            if (entry === undefined) {
                entry = new CacheEntry();
            }
        }

        const promise = this._gitignore.then(ignore => {
            if (ignore && !ignore.filter([fileName]).length) {
                Logger.log(`Skipping blame; '${fileName}' is gitignored`);
                return <Promise<IGitBlame>>GitProvider.EmptyPromise;
            }

            return Git.blame(GitProvider.BlameFormat, fileName, sha, repoPath)
                .then(data => new GitBlameParserEnricher(GitProvider.BlameFormat).enrich(data, fileName))
                .catch(ex => {
                    // Trap and cache expected blame errors
                    if (useCaching) {
                        const msg = ex && ex.toString();
                        Logger.log(`Replace blame cache with empty promise for '${cacheKey}'`);

                        entry.blame = <ICachedBlame>{
                            //date: new Date(),
                            item: GitProvider.EmptyPromise,
                            errorMessage: msg
                        };

                        this._cache.set(cacheKey, entry);
                        return <Promise<IGitBlame>>GitProvider.EmptyPromise;
                    }
                    return undefined;
                });
        });

        if (useCaching) {
            Logger.log(`Add blame cache for '${cacheKey}'`);

            entry.blame = <ICachedBlame>{
                //date: new Date(),
                item: promise
            };

            this._cache.set(cacheKey, entry);
        }

        return promise;
    }

    async getBlameForLine(fileName: string, line: number, sha?: string, repoPath?: string): Promise<IGitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${fileName}', ${line}, ${sha}, ${repoPath})`);

        if (this.UseCaching && !sha) {
            const blame = await this.getBlameForFile(fileName);
            const blameLine = blame && blame.lines[line];
            if (!blameLine) return undefined;

            const commit = blame.commits.get(blameLine.sha);
            return <IGitBlameLine>{
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                line: blameLine
            };
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
            return <IGitBlameLine>{
                author: Iterables.first(blame.authors.values()),
                commit: commit,
                line: blame.lines[line]
            };
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

        return <IGitBlameLines>{
            authors: sortedAuthors,
            commits: commits,
            lines: lines,
            allLines: blame.lines
        };
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
            const uri = c.originalFileName
                ? GitProvider.toGitUri(c, i + 1, commitCount, c.originalFileName, decoration)
                : GitProvider.toGitUri(c, i + 1, commitCount, undefined, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position(line + 1, 0)));
            }
        });

        return locations;
    }

    getLogForFile(fileName: string, sha?: string, repoPath?: string, range?: Range): Promise<IGitLog | undefined> {
        Logger.log(`getLogForFile('${fileName}', ${sha}, ${repoPath}, ${range && `[${range.start.line}, ${range.end.line}]`})`);
        fileName = Git.normalizePath(fileName);

        const useCaching = this.UseCaching && !range;

        let cacheKey: string;
        let entry: CacheEntry;
        if (useCaching) {
            cacheKey = this._getCacheEntryKey(fileName);
            entry = this._cache.get(cacheKey);

            if (entry !== undefined && entry.log !== undefined) return entry.log.item;
            if (entry === undefined) {
                entry = new CacheEntry();
            }
        }

        const promise = this._gitignore.then(ignore => {
            if (ignore && !ignore.filter([fileName]).length) {
                Logger.log(`Skipping log; '${fileName}' is gitignored`);
                return <Promise<IGitLog>>GitProvider.EmptyPromise;
            }

            return (range
                ? Git.logRange(fileName, range.start.line + 1, range.end.line + 1, sha, repoPath)
                : Git.log(fileName, sha, repoPath))
                .then(data => new GitLogParserEnricher().enrich(data, fileName))
                .catch(ex => {
                    // Trap and cache expected blame errors
                    if (useCaching) {
                        const msg = ex && ex.toString();
                        Logger.log(`Replace log cache with empty promise for '${cacheKey}'`);

                        entry.log = <ICachedLog>{
                            //date: new Date(),
                            item: GitProvider.EmptyPromise,
                            errorMessage: msg
                        };

                        this._cache.set(cacheKey, entry);
                        return <Promise<IGitLog>>GitProvider.EmptyPromise;
                    }
                    return undefined;
                });
        });

        if (useCaching) {
            Logger.log(`Add log cache for '${cacheKey}'`);

            entry.log = <ICachedLog>{
                //date: new Date(),
                item: promise
            };

            this._cache.set(cacheKey, entry);
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
            const uri = c.originalFileName
                ? GitProvider.toGitUri(c, i + 1, commitCount, c.originalFileName, decoration)
                : GitProvider.toGitUri(c, i + 1, commitCount, undefined, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position(line + 1, 0)));
            }
        });

        return locations;
    }

    getVersionedFile(fileName: string, repoPath: string, sha: string) {
        Logger.log(`getVersionedFile('${fileName}', ${repoPath}, ${sha})`);
        return Git.getVersionedFile(fileName, repoPath, sha);
    }

    getVersionedFileText(fileName: string, repoPath: string, sha: string) {
        Logger.log(`getVersionedFileText('${fileName}', ${repoPath}, ${sha})`);
        return Git.getVersionedFileText(fileName, repoPath, sha);
    }

    toggleCodeLens(editor: TextEditor) {
        Logger.log(`toggleCodeLens(${editor})`);

        if (this._config.codeLens.visibility !== CodeLensVisibility.OnDemand ||
            (!this._config.codeLens.recentChange.enabled && !this._config.codeLens.authors.enabled)) return;

        if (this._codeLensProviderDisposable) {
            this._codeLensProviderDisposable.dispose();

            if (editor.document.fileName === (this._codeLensProviderSelector && this._codeLensProviderSelector.pattern)) {
                this._codeLensProviderDisposable = undefined;
                return;
            }
        }

        const disposables: Disposable[] = [];

        this._codeLensProviderSelector = <DocumentFilter>{ scheme: DocumentSchemes.File, pattern: editor.document.fileName };

        disposables.push(languages.registerCodeLensProvider(this._codeLensProviderSelector, new GitCodeLensProvider(this.context, this)));

        disposables.push(window.onDidChangeActiveTextEditor(e => {
            if (e.viewColumn && e.document !== editor.document) {
                this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
                this._codeLensProviderDisposable = undefined;
            }
        }));

        this._codeLensProviderDisposable = Disposable.from(...disposables);
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
        // const uriPath = `${dirname(data.fileName)}/${commit.sha}: ${basename(data.fileName, ext)}${ext}`;
        const uriPath = `${path.relative(commit.repoPath, data.fileName.slice(0, -ext.length))}/${commit.sha}${ext}`;

        let message = commit.message;
        if (message.length > 50) {
            message = message.substring(0, 49) + '\u2026';
        }
        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        //return Uri.parse(`${scheme}:${pad(data.index)}. ${commit.author}, ${moment(commit.date).format('MMM D, YYYY hh:MMa')} - ${uriPath}?${JSON.stringify(data)}`);
        return Uri.parse(`${scheme}:${pad(data.index)} \u2022 ${message} \u2022 ${moment(commit.date).format('MMM D, YYYY hh:MMa')} \u2022 ${uriPath}?${JSON.stringify(data)}`);
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

export class GitUri extends Uri {
    offset: number;
    repoPath?: string | undefined;
    sha?: string | undefined;

    constructor(uri?: Uri) {
        super();
        if (!uri) return;

        const base = <any>this;
        base._scheme = uri.scheme;
        base._authority = uri.authority;
        base._path = uri.path;
        base._query = uri.query;
        base._fragment = uri.fragment;

        this.offset = 0;
        if (uri.scheme === DocumentSchemes.Git) {
            const data = GitProvider.fromGitUri(uri);
            base._fsPath = data.originalFileName || data.fileName;

            this.offset = (data.decoration && data.decoration.split('\n').length) || 0;
            this.repoPath = data.repoPath;
            this.sha = data.sha;
        }
    }

    fileUri() {
        return Uri.file(this.fsPath);
    }

    static fromUri(uri: Uri) {
        return new GitUri(uri);
    }
}

export interface IGitUriData {
    repoPath: string;
    fileName: string;
    originalFileName?: string;
    sha: string;
    index: number;
    decoration?: string;
}