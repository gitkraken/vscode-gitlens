'use strict'
import {Disposable, DocumentFilter, ExtensionContext, languages, Location, Position, Range, TextDocument, TextEditor, Uri, window, workspace} from 'vscode';
import {DocumentSchemes, WorkspaceState} from './constants';
import {CodeLensVisibility, IConfig} from './configuration';
import GitCodeLensProvider from './gitCodeLensProvider';
import Git, {GitBlameParserEnricher, GitBlameFormat, GitCommit, IGitAuthor, IGitBlame, IGitBlameCommitLines, IGitBlameLine, IGitBlameLines, IGitCommit} from './git/git';
import * as fs from 'fs'
import * as ignore from 'ignore';
import * as moment from 'moment';
import * as path from 'path';

const debounce = require('lodash.debounce');
const isEqual = require('lodash.isequal');

export { Git };
export * from './git/git';

interface IBlameCacheEntry {
    //date: Date;
    blame: Promise<IGitBlame>;
    errorMessage?: string
}

enum RemoveCacheReason {
    DocumentClosed,
    DocumentSaved,
    DocumentChanged
}

export default class GitProvider extends Disposable {
    private _blameCache: Map<string, IBlameCacheEntry>|null;
    private _blameCacheDisposable: Disposable|null;

    private _config: IConfig;
    private _disposable: Disposable;
    private _codeLensProviderDisposable: Disposable|null;
    private _codeLensProviderSelector: DocumentFilter;
    private _gitignore: Promise<ignore.Ignore>;

    static BlameEmptyPromise: Promise<IGitBlame|null> = Promise.resolve(null);
    static BlameFormat = GitBlameFormat.incremental;

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());

        const repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;

        this._onConfigure();

        this._gitignore = new Promise<ignore.Ignore|null>((resolve, reject) => {
            const gitignorePath = path.join(repoPath, '.gitignore');
            fs.exists(gitignorePath, e => {
                if (e) {
                    fs.readFile(gitignorePath, 'utf8', (err, data) => {
                        if (!err) {
                            resolve(ignore().add(data));
                            return;
                        }
                        resolve(null);
                    });
                    return;
                }
                resolve(null);
            });
        });

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigure, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
        this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
        this._blameCacheDisposable && this._blameCacheDisposable.dispose();
        this._blameCache && this._blameCache.clear();
    }

    public get UseCaching() {
        return !!this._blameCache;
    }

    private _onConfigure() {
        const config = workspace.getConfiguration().get<IConfig>('gitlens');

        if (!isEqual(config.codeLens, this._config && this._config.codeLens)) {
            this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
            if (config.codeLens.visibility === CodeLensVisibility.Auto && (config.codeLens.recentChange.enabled || config.codeLens.authors.enabled)) {
                this._codeLensProviderSelector = GitCodeLensProvider.selector;
                this._codeLensProviderDisposable = languages.registerCodeLensProvider(this._codeLensProviderSelector, new GitCodeLensProvider(this.context, this));
            } else {
                this._codeLensProviderDisposable = null;
            }
        }

        if (!isEqual(config.advanced, this._config && this._config.advanced)) {
            if (config.advanced.caching.enabled) {
                // TODO: Cache needs to be cleared on file changes -- createFileSystemWatcher or timeout?
                this._blameCache = new Map();

                const disposables: Disposable[] = [];

                // TODO: Maybe stop clearing on close and instead limit to a certain number of recent blames
                disposables.push(workspace.onDidCloseTextDocument(d => this._removeCachedBlame(d, RemoveCacheReason.DocumentClosed)));

                const removeCachedBlameFn = debounce(this._removeCachedBlame.bind(this), 2500);
                disposables.push(workspace.onDidSaveTextDocument(d => removeCachedBlameFn(d, RemoveCacheReason.DocumentSaved)));
                disposables.push(workspace.onDidChangeTextDocument(e => removeCachedBlameFn(e.document, RemoveCacheReason.DocumentChanged)));

                this._blameCacheDisposable = Disposable.from(...disposables);
            } else {
                this._blameCacheDisposable && this._blameCacheDisposable.dispose();
                this._blameCacheDisposable = null;
                this._blameCache && this._blameCache.clear();
                this._blameCache = null;
            }
        }

        this._config = config;
    }

    private _getBlameCacheKey(fileName: string) {
        return fileName.toLowerCase();
    }

    private _removeCachedBlame(document: TextDocument, reason: RemoveCacheReason) {
        if (!this.UseCaching) return;
        if (document.uri.scheme != DocumentSchemes.File) return;

        const fileName = Git.normalizePath(document.fileName);

        const cacheKey = this._getBlameCacheKey(fileName);
        if (reason === RemoveCacheReason.DocumentClosed) {
            // Don't remove broken blame on close (since otherwise we'll have to run the broken blame again)
            const entry = this._blameCache.get(cacheKey);
            if (entry && entry.errorMessage) return;
        }

        if (this._blameCache.delete(cacheKey)) {
            console.log('[GitLens]', `Clear blame cache: cacheKey=${cacheKey}, reason=${RemoveCacheReason[reason]}`);

            // if (reason === RemoveCacheReason.DocumentSaved) {
            //     // TODO: Killing the code lens provider is too drastic -- makes the editor jump around, need to figure out how to trigger a refresh
            //     this._registerCodeLensProvider();
            // }
        }
    }

    getRepoPath(cwd: string) {
        return Git.repoPath(cwd);
    }

    getBlameForFile(fileName: string) {
        fileName = Git.normalizePath(fileName);

        const cacheKey = this._getBlameCacheKey(fileName);
        if (this.UseCaching) {
            let entry = this._blameCache.get(cacheKey);
            if (entry !== undefined) return entry.blame;
        }

        return this._gitignore.then(ignore => {
            let blame: Promise<IGitBlame>;
            if (ignore && !ignore.filter([fileName]).length) {
                console.log('[GitLens]', `Skipping blame; ${fileName} is gitignored`);
                blame = GitProvider.BlameEmptyPromise;
            } else {
                blame = Git.blame(GitProvider.BlameFormat, fileName)
                    .then(data => new GitBlameParserEnricher(GitProvider.BlameFormat).enrich(data, fileName))
                    .catch(ex => {
                        // Trap and cache expected blame errors
                        if (this.UseCaching) {
                            const msg = ex && ex.toString();
                            console.log('[GitLens]', `Replace blame cache: cacheKey=${cacheKey}`);
                            this._blameCache.set(cacheKey, <IBlameCacheEntry>{
                                //date: new Date(),
                                blame: GitProvider.BlameEmptyPromise,
                                errorMessage: msg
                            });
                            return GitProvider.BlameEmptyPromise;
                        }
                        return null;
                    });
            }

            if (this.UseCaching) {
                console.log('[GitLens]', `Add blame cache: cacheKey=${cacheKey}`);
                this._blameCache.set(cacheKey, <IBlameCacheEntry> {
                    //date: new Date(),
                    blame: blame
                });
            }

            return blame;
        });
    }

    getBlameForLine(fileName: string, line: number, sha?: string, repoPath?: string): Promise<IGitBlameLine|null> {
        if (this.UseCaching && !sha) {
            return this.getBlameForFile(fileName).then(blame => {
                const blameLine = blame && blame.lines[line];
                if (!blameLine) return null;

                const commit = blame.commits.get(blameLine.sha);
                return {
                    author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                    commit: commit,
                    line: blameLine
                };
            });
        }

        fileName = Git.normalizePath(fileName);

        return Git.blameLines(GitProvider.BlameFormat, fileName, line, line, sha, repoPath)
            .then(data => new GitBlameParserEnricher(GitProvider.BlameFormat).enrich(data, fileName))
            .then(blame => {
                if (!blame) return null;

                const commit = blame.commits.values().next().value;
                if (repoPath) {
                    commit.repoPath = repoPath;
                }
                return <IGitBlameLine>{
                    author: blame.authors.values().next().value,
                    commit: commit,
                    line: blame.lines[line - 1]
                };
            })
            .catch(ex => null);
    }

    getBlameForRange(fileName: string, range: Range): Promise<IGitBlameLines|null> {
        return this.getBlameForFile(fileName).then(blame => {
            if (!blame) return null;

            if (!blame.lines.length) return Object.assign({ allLines: blame.lines }, blame);

            if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
                return Object.assign({ allLines: blame.lines }, blame);
            }

            const lines = blame.lines.slice(range.start.line, range.end.line + 1);
            const shas: Set<string> = new Set();
            lines.forEach(l => shas.add(l.sha));

            const authors: Map<string, IGitAuthor> = new Map();
            const commits: Map<string, IGitCommit> = new Map();
            blame.commits.forEach(c => {
                if (!shas.has(c.sha)) return;

                const commit: IGitCommit = new GitCommit(c.repoPath, c.sha, c.fileName, c.author, c.date, c.message,
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
            };
        });
    }

    getBlameForShaRange(fileName: string, sha: string, range: Range): Promise<IGitBlameCommitLines|null> {
        return this.getBlameForFile(fileName).then(blame => {
            if (!blame) return null;

            const lines = blame.lines.slice(range.start.line, range.end.line + 1).filter(l => l.sha === sha);
            let commit = blame.commits.get(sha);
            commit = new GitCommit(commit.repoPath, commit.sha, commit.fileName, commit.author, commit.date, commit.message,
                lines, commit.originalFileName, commit.previousSha, commit.previousFileName);
            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                lines: lines
            };
        });
    }

    getBlameLocations(fileName: string, range: Range): Promise<Location[]|null> {
        return this.getBlameForRange(fileName, range).then(blame => {
            if (!blame) return null;

            const commitCount = blame.commits.size;

            const locations: Array<Location> = [];
            Array.from(blame.commits.values())
                .forEach((c, i) => {
                    if (c.isUncommitted) return;

                    const uri = GitProvider.toBlameUri(c, i + 1, commitCount, range);
                    c.lines.forEach(l => locations.push(new Location(c.originalFileName
                            ? GitProvider.toBlameUri(c, i + 1, commitCount, range, c.originalFileName)
                            : uri,
                        new Position(l.originalLine, 0))));
                });

            return locations;
        });
    }

    getVersionedFile(fileName: string, repoPath: string, sha: string) {
        return Git.getVersionedFile(fileName, repoPath, sha);
    }

    getVersionedFileText(fileName: string, repoPath: string, sha: string) {
        return Git.getVersionedFileText(fileName, repoPath, sha);
    }

    toggleCodeLens(editor: TextEditor) {
        if (this._config.codeLens.visibility !== CodeLensVisibility.OnDemand ||
            (!this._config.codeLens.recentChange.enabled && !this._config.codeLens.authors.enabled)) return;

        if (this._codeLensProviderDisposable) {
            this._codeLensProviderDisposable.dispose();

            if (editor.document.fileName === (this._codeLensProviderSelector && this._codeLensProviderSelector.pattern)) {
                this._codeLensProviderDisposable = null;
                return;
            }
        }

        const disposables: Disposable[] = [];

        this._codeLensProviderSelector = <DocumentFilter>{ scheme: DocumentSchemes.File, pattern: editor.document.fileName };

        disposables.push(languages.registerCodeLensProvider(this._codeLensProviderSelector, new GitCodeLensProvider(this.context, this)));

        disposables.push(window.onDidChangeActiveTextEditor(e => {
            if (e.viewColumn && e.document !== editor.document) {
                this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
                this._codeLensProviderDisposable = null;
            }
        }));

        this._codeLensProviderDisposable = Disposable.from(...disposables);
    }

    static isUncommitted(sha: string) {
        return Git.isUncommitted(sha);
    }

    static fromBlameUri(uri: Uri): IGitBlameUriData {
        if (uri.scheme !== DocumentSchemes.GitBlame) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        const data = GitProvider._fromGitUri<IGitBlameUriData>(uri);
        data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
        return data;
    }

    static fromGitUri(uri: Uri) {
        if (uri.scheme !== DocumentSchemes.Git) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return GitProvider._fromGitUri<IGitUriData>(uri);
    }

    private static _fromGitUri<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }

    static toBlameUri(commit: IGitCommit, index: number, commitCount: number, range: Range, originalFileName?: string) {
        return GitProvider._toGitUri(commit, DocumentSchemes.GitBlame, commitCount, GitProvider._toGitBlameUriData(commit, index, range, originalFileName));
    }

    static toGitUri(commit: IGitCommit, index: number, commitCount: number, originalFileName?: string) {
        return GitProvider._toGitUri(commit, DocumentSchemes.Git, commitCount, GitProvider._toGitUriData(commit, index, originalFileName));
    }

    private static _toGitUri(commit: IGitCommit, scheme: DocumentSchemes, commitCount: number, data: IGitUriData | IGitBlameUriData) {
        const pad = n => ("0000000" + n).slice(-("" + commitCount).length);
        const ext = path.extname(data.fileName);
        // const uriPath = `${dirname(data.fileName)}/${commit.sha}: ${basename(data.fileName, ext)}${ext}`;
        const uriPath = `${path.dirname(data.fileName)}/${commit.sha}${ext}`;

        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${scheme}:${pad(data.index)}. ${commit.author}, ${moment(commit.date).format('MMM D, YYYY hh:MM a')} - ${uriPath}?${JSON.stringify(data)}`);
    }

    private static _toGitUriData<T extends IGitUriData>(commit: IGitCommit, index: number, originalFileName?: string): T {
        const fileName = Git.normalizePath(path.join(commit.repoPath, commit.fileName));
        const data = { repoPath: commit.repoPath, fileName: fileName, sha: commit.sha, index: index } as T;
        if (originalFileName) {
            data.originalFileName = Git.normalizePath(path.join(commit.repoPath, originalFileName));
        }
        return data;
    }

    private static _toGitBlameUriData(commit: IGitCommit, index: number, range: Range, originalFileName?: string) {
        const data = this._toGitUriData<IGitBlameUriData>(commit, index, originalFileName);
        data.range = range;
        return data;
    }
}

export interface IGitUriData {
    repoPath: string;
    fileName: string;
    originalFileName?: string;
    sha: string;
    index: number;
}

export interface IGitBlameUriData extends IGitUriData {
    range: Range;
}