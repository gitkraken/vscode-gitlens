'use strict';
import { Iterables, Objects } from './system';
import { Disposable, Event, EventEmitter, ExtensionContext, FileSystemWatcher, languages, Location, Position, Range, TextDocument, TextEditor, Uri, workspace } from 'vscode';
import { CommandContext, setCommandContext } from './commands';
import { CodeLensVisibility, IConfig } from './configuration';
import { DocumentSchemes, WorkspaceState } from './constants';
import { Git, GitBlameParser, GitBranch, GitCommit, GitLogParser, GitRemote, GitStatusFile, GitStatusParser, IGitAuthor, IGitBlame, IGitBlameLine, IGitBlameLines, IGitLog, IGitStatus } from './git/git';
import { IGitUriData, GitUri } from './git/gitUri';
import { GitCodeLensProvider } from './gitCodeLensProvider';
import { Logger } from './logger';
import * as fs from 'fs';
import * as ignore from 'ignore';
import * as moment from 'moment';
import * as path from 'path';

export { getGitStatusIcon } from './git/git';
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

    constructor(public key: string) { }
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

export class GitService extends Disposable {

    private _onDidChangeGitCacheEmitter = new EventEmitter<void>();
    get onDidChangeGitCache(): Event<void> {
        return this._onDidChangeGitCacheEmitter.event;
    }

    private _onDidBlameFailEmitter = new EventEmitter<string>();
    get onDidBlameFail(): Event<string> {
        return this._onDidBlameFailEmitter.event;
    }

    public repoPath: string;

    private _gitCache: Map<string, GitCacheEntry> | undefined;
    private _remotesCache: GitRemote[];
    private _cacheDisposable: Disposable | undefined;
    private _uriCache: Map<string, UriCacheEntry> | undefined;

    config: IConfig;
    private _codeLensProvider: GitCodeLensProvider | undefined;
    private _codeLensProviderDisposable: Disposable | undefined;
    private _disposable: Disposable;
    private _fsWatcher: FileSystemWatcher;
    private _gitignore: Promise<ignore.Ignore>;

    static EmptyPromise: Promise<IGitBlame | IGitLog> = Promise.resolve(undefined);

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());

        this.repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;
        this._uriCache = new Map();

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
        this._cacheDisposable = undefined;

        this._fsWatcher && this._fsWatcher.dispose();
        this._fsWatcher = undefined;

        this._gitCache && this._gitCache.clear();
        this._gitCache = undefined;
        this._uriCache && this._uriCache.clear();
        this._uriCache = undefined;
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

            setCommandContext(CommandContext.CanToggleCodeLens, config.codeLens.visibility === CodeLensVisibility.OnDemand && (config.codeLens.recentChange.enabled || config.codeLens.authors.enabled));
        }

        if (advancedChanged) {
            if (config.advanced.caching.enabled) {
                this._gitCache = new Map();

                this._cacheDisposable && this._cacheDisposable.dispose();

                this._fsWatcher = this._fsWatcher || workspace.createFileSystemWatcher('**/.git/index', true, false, true);

                const disposables: Disposable[] = [];

                disposables.push(workspace.onDidCloseTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentClosed)));
                disposables.push(workspace.onDidSaveTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentSaved)));
                disposables.push(this._fsWatcher.onDidChange(this._onGitChanged, this));

                this._cacheDisposable = Disposable.from(...disposables);
            }
            else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;

                this._fsWatcher && this._fsWatcher.dispose();
                this._fsWatcher = undefined;

                this._gitCache && this._gitCache.clear();
                this._gitCache = undefined;
            }

            this._gitignore = new Promise<ignore.Ignore | undefined>((resolve, reject) => {
                if (!config.advanced.gitignore.enabled) {
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

        this.config = config;
    }

    private _onGitChanged() {
        this._gitCache && this._gitCache.clear();

        this._onDidChangeGitCacheEmitter.fire();
        this._codeLensProvider && this._codeLensProvider.reset();
    }

    private _removeCachedEntry(document: TextDocument, reason: RemoveCacheReason) {
        if (!this.UseGitCaching) return;
        if (document.uri.scheme !== DocumentSchemes.File) return;

        const cacheKey = this.getCacheEntryKey(document.fileName);

        if (reason === RemoveCacheReason.DocumentSaved) {
            // Don't remove broken blame on save (since otherwise we'll have to run the broken blame again)
            const entry = this._gitCache.get(cacheKey);
            if (entry && entry.hasErrors) return;
        }

        if (this._gitCache.delete(cacheKey)) {
            Logger.log(`Clear cache entry for '${cacheKey}', reason=${RemoveCacheReason[reason]}`);

            if (reason === RemoveCacheReason.DocumentSaved) {
                this._onDidChangeGitCacheEmitter.fire();

                // Refresh the codelenses with the updated blame
                this._codeLensProvider && this._codeLensProvider.reset();
            }
        }
    }

    async findWorkingFileName(commit: GitCommit): Promise<string>;
    async findWorkingFileName(repoPath: string, fileName: string): Promise<string>
    async findWorkingFileName(commitOrRepoPath: GitCommit | string, fileName?: string): Promise<string> {
        let repoPath: string;
        if (typeof commitOrRepoPath === 'string') {
            repoPath = commitOrRepoPath;
            [fileName] = Git.splitPath(fileName, repoPath);
        }
        else {
            const c = commitOrRepoPath;
            repoPath = c.repoPath;
            if (c.workingFileName && await this._fileExists(repoPath, c.workingFileName)) return c.workingFileName;
            fileName = c.fileName;
        }

        while (true) {
            if (await this._fileExists(repoPath, fileName)) return fileName;

            // Get the most recent commit for this file name
            let log = await this.getLogForFile(repoPath, fileName, undefined, undefined, 1);
            if (!log) return undefined;

            let c = Iterables.first(log.commits.values());

            // Get the full commit (so we can see if there are any matching renames in the file statuses)
            log = await this.getLogForRepo(repoPath, c.sha, 1);
            if (!log) return undefined;

            c = Iterables.first(log.commits.values());
            const status = c.fileStatuses.find(_ => _.originalFileName === fileName);
            if (!status) return undefined;

            fileName = status.fileName;
        }
    }

    private async _fileExists(repoPath: string, fileName: string): Promise<boolean> {
        return await new Promise<boolean>((resolve, reject) => fs.exists(path.resolve(repoPath, fileName), e => resolve(e)));
    }

    public getBlameability(fileName: string): boolean {
        if (!this.UseGitCaching) return true;

        const cacheKey = this.getCacheEntryKey(fileName);
        const entry = this._gitCache.get(cacheKey);
        return !(entry && entry.hasErrors);
    }

    async getBlameForFile(uri: GitUri): Promise<IGitBlame | undefined> {
        Logger.log(`getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);

        const fileName = uri.fsPath;

        let entry: GitCacheEntry | undefined;
        if (this.UseGitCaching && !uri.sha) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined && entry.blame !== undefined) return entry.blame.item;
            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
            }
        }

        const promise = this._getBlameForFile(uri, fileName, entry);

        if (entry) {
            Logger.log(`Add blame cache for '${entry.key}'`);

            entry.blame = {
                //date: new Date(),
                item: promise
            } as ICachedBlame;

            this._gitCache.set(entry.key, entry);
        }

        return promise;
    }

    private async _getBlameForFile(uri: GitUri, fileName: string, entry: GitCacheEntry | undefined): Promise<IGitBlame> {
        const [file, root] = Git.splitPath(fileName, uri.repoPath, false);

        const ignore = await this._gitignore;
        if (ignore && !ignore.filter([file]).length) {
            Logger.log(`Skipping blame; '${fileName}' is gitignored`);
            if (entry && entry.key) {
                this._onDidBlameFailEmitter.fire(entry.key);
            }
            return await GitService.EmptyPromise as IGitBlame;
        }

        try {
            const data = await Git.blame(root, file, uri.sha);
            return GitBlameParser.parse(data, root, file);
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace blame cache with empty promise for '${entry.key}'`);

                entry.blame = {
                    //date: new Date(),
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as ICachedBlame;

                this._onDidBlameFailEmitter.fire(entry.key);
                this._gitCache.set(entry.key, entry);
                return await GitService.EmptyPromise as IGitBlame;
            }

            return undefined;
        }
    };

    async getBlameForLine(uri: GitUri, line: number): Promise<IGitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${uri.repoPath}', '${uri.fsPath}', ${line}, ${uri.sha})`);

        if (this.UseGitCaching && !uri.sha) {
            const blame = await this.getBlameForFile(uri);
            const blameLine = blame && blame.lines[line];
            if (!blameLine) return undefined;

            const commit = blame.commits.get(blameLine.sha);
            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                line: blameLine
            } as IGitBlameLine;
        }

        const fileName = uri.fsPath;

        try {
            const data = await Git.blame(uri.repoPath, fileName, uri.sha, line + 1, line + 1);
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName);
            if (!blame) return undefined;

            const commit = Iterables.first(blame.commits.values());
            if (uri.repoPath) {
                commit.repoPath = uri.repoPath;
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

    async getBlameForRange(uri: GitUri, range: Range): Promise<IGitBlameLines | undefined> {
        Logger.log(`getBlameForRange('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForFile(uri);
        if (!blame) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    getBlameForRangeSync(blame: IGitBlame, uri: GitUri, range: Range): IGitBlameLines | undefined {
        Logger.log(`getBlameForRangeSync('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

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

    async getBlameLocations(uri: GitUri, range: Range, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getBlameLocations('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForRange(uri, range);
        if (!blame) return undefined;

        const commitCount = blame.commits.size;

        const locations: Array<Location> = [];
        Iterables.forEach(blame.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `\u2937 ${c.author}, ${moment(c.date).format('MMMM Do, YYYY h:MMa')}`;
            const uri = GitService.toReferenceGitContentUri(c, i + 1, commitCount, c.originalFileName, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position(line + 1, 0)));
            }
        });

        return locations;
    }

    async getBranch(repoPath: string): Promise<GitBranch> {
        Logger.log(`getBranch('${repoPath}')`);

        const data = await Git.branch(repoPath, false);
        const branches = data.split('\n').filter(_ => !!_).map(_ => new GitBranch(_));
        return branches.find(_ => _.current);
    }

    async getBranches(repoPath: string): Promise<GitBranch[]> {
        Logger.log(`getBranches('${repoPath}')`);

        const data = await Git.branch(repoPath, true);
        const branches = data.split('\n').filter(_ => !!_).map(_ => new GitBranch(_));
        return branches;
    }

    getCacheEntryKey(fileName: string) {
        return Git.normalizePath(fileName).toLowerCase();
    }

    getGitUriForFile(fileName: string) {
        const cacheKey = this.getCacheEntryKey(fileName);
        const entry = this._uriCache.get(cacheKey);
        return entry && entry.uri;
    }

    async getLogForRepo(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false): Promise<IGitLog | undefined> {
        Logger.log(`getLogForRepo('${repoPath}', ${sha}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        try {
            const data = await Git.log(repoPath, sha, maxCount, reverse);
            return GitLogParser.parse(data, 'repo', repoPath, maxCount, true, reverse, undefined);
        }
        catch (ex) {
            return undefined;
        }
    }

    getLogForFile(repoPath: string, fileName: string, sha?: string, range?: Range, maxCount?: number, reverse: boolean = false): Promise<IGitLog | undefined> {
        Logger.log(`getLogForFile('${repoPath}', '${fileName}', ${sha}, ${range && `[${range.start.line}, ${range.end.line}]`}, ${maxCount}, ${reverse})`);

        let entry: GitCacheEntry | undefined;
        if (this.UseGitCaching && !sha && !range && !maxCount && !reverse) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined && entry.log !== undefined) return entry.log.item;
            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
            }
        }

        const promise = this._getLogForFile(repoPath, fileName, sha, range, maxCount, reverse, entry);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}'`);

            entry.log = {
                //date: new Date(),
                item: promise
            } as ICachedLog;

            this._gitCache.set(entry.key, entry);
        }

        return promise;
    }

    private async _getLogForFile(repoPath: string, fileName: string, sha: string, range: Range, maxCount: number, reverse: boolean, entry: GitCacheEntry | undefined): Promise<IGitLog> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        const ignore = await this._gitignore;
        if (ignore && !ignore.filter([file]).length) {
            Logger.log(`Skipping log; '${fileName}' is gitignored`);
            return await GitService.EmptyPromise as IGitLog;
        }

        try {
            const data = await Git.log_file(root, file, sha, maxCount, reverse, range && range.start.line + 1, range && range.end.line + 1);
            return GitLogParser.parse(data, 'file', root || file, maxCount, !!root, reverse, range);
        }
        catch (ex) {
            // Trap and cache expected log errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace log cache with empty promise for '${entry.key}'`);

                entry.log = {
                    //date: new Date(),
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as ICachedLog;

                this._gitCache.set(entry.key, entry);
                return await GitService.EmptyPromise as IGitLog;
            }

            return undefined;
        }
    };

    async getLogLocations(uri: GitUri, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getLogLocations('${uri.repoPath}', '${uri.fsPath}', ${uri.sha}, ${selectedSha}, ${line})`);

        const log = await this.getLogForFile(uri.repoPath, uri.fsPath, uri.sha);
        if (!log) return undefined;

        const commitCount = log.commits.size;

        const locations: Array<Location> = [];
        Iterables.forEach(log.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `\u2937 ${c.author}, ${moment(c.date).format('MMMM Do, YYYY h:MMa')}`;
            const uri = GitService.toReferenceGitContentUri(c, i + 1, commitCount, c.originalFileName, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position(line + 1, 0)));
            }
        });

        return locations;
    }

    async getRemotes(repoPath: string): Promise<GitRemote[]> {
        if (!this.config.insiders) return Promise.resolve([]);

        Logger.log(`getRemotes('${repoPath}')`);

        if (this.UseGitCaching && this._remotesCache) return this._remotesCache;

        const data = await Git.remote(repoPath);
        const remotes = data.split('\n').filter(_ => !!_).map(_ => new GitRemote(_));
        if (this.UseGitCaching) {
            this._remotesCache = remotes;
        }
        return remotes;
    }

    getRepoPath(cwd: string): Promise<string> {
        return Git.getRepoPath(cwd);
    }

    async getRepoPathFromFile(fileName: string): Promise<string | undefined> {
        const log = await this.getLogForFile(undefined, fileName, undefined, undefined, 1);
        return log && log.repoPath;
    }

    async getRepoPathFromUri(uri?: Uri, fallbackRepoPath?: string): Promise<string | undefined> {
        if (!(uri instanceof Uri)) return fallbackRepoPath;

        const gitUri = await GitUri.fromUri(uri, this);
        if (gitUri.repoPath) return gitUri.repoPath;

        return (await this.getRepoPathFromFile(gitUri.fsPath)) || fallbackRepoPath;
    }

    async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile> {
        Logger.log(`getStatusForFile('${repoPath}', '${fileName}')`);

        const data = await Git.status_file(repoPath, fileName);
        const status = GitStatusParser.parse(data, repoPath);
        return status && status.files.length && status.files[0];
    }

    async getStatusForRepo(repoPath: string): Promise<IGitStatus> {
        Logger.log(`getStatusForRepo('${repoPath}')`);

        const data = await Git.status(repoPath);
        return GitStatusParser.parse(data, repoPath);
    }

    async getVersionedFile(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFile('${repoPath}', '${fileName}', ${sha})`);

        const file = await Git.getVersionedFile(repoPath, fileName, sha);
        const cacheKey = this.getCacheEntryKey(file);
        const entry = new UriCacheEntry(new GitUri(Uri.file(fileName), { sha, repoPath, fileName }));
        this._uriCache.set(cacheKey, entry);
        return file;
    }

    getVersionedFileText(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFileText('${repoPath}', '${fileName}', ${sha})`);

        return Git.show(repoPath, fileName, sha);
    }

    hasGitUriForFile(editor: TextEditor): boolean;
    hasGitUriForFile(fileName: string): boolean;
    hasGitUriForFile(fileNameOrEditor: string | TextEditor): boolean {
        let fileName: string;
        if (typeof fileNameOrEditor === 'string') {
            fileName = fileNameOrEditor;
        }
        else {
            if (!fileNameOrEditor || !fileNameOrEditor.document || !fileNameOrEditor.document.uri) return false;
            fileName = fileNameOrEditor.document.uri.fsPath;
        }

        const cacheKey = this.getCacheEntryKey(fileName);
        return this._uriCache.has(cacheKey);
    }

    isEditorBlameable(editor: TextEditor): boolean {
        return (editor.viewColumn !== undefined ||
            editor.document.uri.scheme === DocumentSchemes.File ||
            editor.document.uri.scheme === DocumentSchemes.Git ||
            this.hasGitUriForFile(editor));
    }

    async isFileUncommitted(uri: GitUri): Promise<boolean> {
        Logger.log(`isFileUncommitted('${uri.repoPath}', '${uri.fsPath}')`);

        const status = await this.getStatusForFile(uri.repoPath, uri.fsPath);
        return !!status;
    }

    openDirectoryDiff(repoPath: string, sha1: string, sha2?: string) {
        Logger.log(`openDirectoryDiff('${repoPath}', ${sha1}, ${sha2})`);

        return Git.difftool_dirDiff(repoPath, sha1, sha2);
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

    static fromGitContentUri(uri: Uri): IGitUriData {
        if (uri.scheme !== DocumentSchemes.GitLensGit) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return GitService._fromGitContentUri<IGitUriData>(uri);
    }

    private static _fromGitContentUri<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }

    static isUncommitted(sha: string) {
        return Git.isUncommitted(sha);
    }

    static toGitContentUri(sha: string, fileName: string, repoPath: string, originalFileName: string): Uri;
    static toGitContentUri(commit: GitCommit): Uri;
    static toGitContentUri(shaOrcommit: string | GitCommit, fileName?: string, repoPath?: string, originalFileName?: string): Uri {
        let data: IGitUriData;
        if (typeof shaOrcommit === 'string') {
            data = GitService._toGitUriData({
                sha: shaOrcommit,
                fileName: fileName,
                repoPath: repoPath,
                originalFileName: originalFileName
            });
        }
        else {
            data = GitService._toGitUriData(shaOrcommit, undefined, shaOrcommit.originalFileName);
            fileName = shaOrcommit.fileName;
        }

        const extension = path.extname(fileName);
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${path.basename(fileName, extension)}:${data.sha}${extension}?${JSON.stringify(data)}`);
    }

    static toReferenceGitContentUri(commit: GitCommit, index: number, commitCount: number, originalFileName?: string, decoration?: string): Uri {
        return GitService._toReferenceGitContentUri(commit, DocumentSchemes.GitLensGit, commitCount, GitService._toGitUriData(commit, index, originalFileName, decoration));
    }

    private static _toReferenceGitContentUri(commit: GitCommit, scheme: DocumentSchemes, commitCount: number, data: IGitUriData) {
        const pad = (n: number) => ('0000000' + n).slice(-('' + commitCount).length);
        const ext = path.extname(data.fileName);
        const uriPath = `${path.relative(commit.repoPath, data.fileName.slice(0, -ext.length))}/${commit.shortSha}${ext}`;

        let message = commit.message;
        if (message.length > 50) {
            message = message.substring(0, 49) + '\u2026';
        }

        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${scheme}:${pad(data.index)} \u2022 ${encodeURIComponent(message)} \u2022 ${moment(commit.date).format('MMM D, YYYY hh:MMa')} \u2022 ${encodeURIComponent(uriPath)}?${JSON.stringify(data)}`);
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
}