'use strict'
import {Disposable, ExtensionContext, languages, Location, Position, Range, Uri, workspace} from 'vscode';
import {DocumentSchemes, WorkspaceState} from './constants';
import GitCodeLensProvider from './gitCodeLensProvider';
import Git from './git';
import {basename, dirname, extname, join} from 'path';
import * as moment from 'moment';
import * as _ from 'lodash';
import {exists, readFile} from 'fs'
import * as ignore from 'ignore';

const commitMessageMatcher = /^([\^0-9a-fA-F]{7})\s(.*)$/gm;
const blamePorcelainMatcher = /^([\^0-9a-fA-F]{40})\s([0-9]+)\s([0-9]+)(?:\s([0-9]+))?$\n(?:^author\s(.*)$\n^author-mail\s(.*)$\n^author-time\s(.*)$\n^author-tz\s(.*)$\n^committer\s(.*)$\n^committer-mail\s(.*)$\n^committer-time\s(.*)$\n^committer-tz\s(.*)$\n^summary\s(.*)$\n(?:^previous\s(.*)?\s(.*)$\n)?^filename\s(.*)$\n)?^(.*)$/gm;

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
    public repoPath: string;

    private _blames: Map<string, IBlameCacheEntry>;
    private _disposable: Disposable;
    private _codeLensProviderSubscription: Disposable;
    private _gitignore: Promise<ignore.Ignore>;

    // TODO: Needs to be a Map so it can debounce per file
    private _removeCachedBlameFn: ((string, boolean) => void) & _.Cancelable;

    static BlameEmptyPromise = Promise.resolve(<IGitBlame>null);

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());

        this.repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;

        this._gitignore = new Promise<ignore.Ignore>((resolve, reject) => {
            const gitignorePath = join(this.repoPath, '.gitignore');
            exists(gitignorePath, e => {
                if (e) {
                    readFile(gitignorePath, 'utf8', (err, data) => {
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

        // TODO: Cache needs to be cleared on file changes -- createFileSystemWatcher or timeout?
        this._blames = new Map();
        this._registerCodeLensProvider();
        this._removeCachedBlameFn = _.debounce(this._removeCachedBlame.bind(this), 2500);

        const subscriptions: Disposable[] = [];

        // TODO: Maybe stop clearing on close and instead limit to a certain number of recent blames
        subscriptions.push(workspace.onDidCloseTextDocument(d => this._removeCachedBlame(d.fileName, RemoveCacheReason.DocumentClosed)));
        subscriptions.push(workspace.onDidSaveTextDocument(d => this._removeCachedBlameFn(d.fileName, RemoveCacheReason.DocumentSaved)));
        subscriptions.push(workspace.onDidChangeTextDocument(e => this._removeCachedBlameFn(e.document.fileName, RemoveCacheReason.DocumentChanged)));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._blames.clear();
        this._disposable && this._disposable.dispose();
        this._codeLensProviderSubscription && this._codeLensProviderSubscription.dispose();
    }

    private _registerCodeLensProvider() {
        if (this._codeLensProviderSubscription) {
            this._codeLensProviderSubscription.dispose();
        }
        this._codeLensProviderSubscription = languages.registerCodeLensProvider(GitCodeLensProvider.selector, new GitCodeLensProvider(this.context, this));
    }

    private _getBlameCacheKey(fileName: string) {
        return fileName.toLowerCase();
    }

    private _removeCachedBlame(fileName: string, reason: RemoveCacheReason) {
        fileName = Git.normalizePath(fileName, this.repoPath);

        const cacheKey = this._getBlameCacheKey(fileName);
        if (reason === RemoveCacheReason.DocumentClosed) {
            // Don't remove broken blame on close (since otherwise we'll have to run the broken blame again)
            const entry = this._blames.get(cacheKey);
            if (entry && entry.errorMessage) return;
        }

        if (this._blames.delete(cacheKey)) {
            console.log('[GitLens]', `Clear blame cache: fileName=${fileName}, reason=${RemoveCacheReason[reason]})`);

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
        fileName = Git.normalizePath(fileName, this.repoPath);

        const cacheKey = this._getBlameCacheKey(fileName);
        let entry = this._blames.get(cacheKey);
        if (entry !== undefined) return entry.blame;

        return this._gitignore.then(ignore => {
            let blame: Promise<IGitBlame>;
            if (ignore && !ignore.filter([fileName]).length) {
                console.log('[GitLens]', `Skipping blame; ${fileName} is gitignored`);
                blame = GitProvider.BlameEmptyPromise;
            } else {
                blame = Git.blamePorcelain(fileName, this.repoPath)
                    .then(data => {
                        if (!data) return null;

                        const authors: Map<string, IGitAuthor> = new Map();
                        const commits: Map<string, IGitCommit> = new Map();
                        const lines: Array<IGitCommitLine> = [];

                        let m: Array<string>;
                        while ((m = blamePorcelainMatcher.exec(data)) != null) {
                            const sha = m[1].substring(0, 8);
                            let commit = commits.get(sha);
                            if (!commit) {
                                const authorName = m[5].trim();
                                let author = authors.get(authorName);
                                if (!author) {
                                    author = {
                                        name: authorName,
                                        lineCount: 0
                                    };
                                    authors.set(authorName, author);
                                }

                                commit = new GitCommit(this.repoPath, sha, fileName, authorName, moment(`${m[7]} ${m[8]}`, 'X Z').toDate(), m[13]);

                                const originalFileName = m[16];
                                if (!fileName.toLowerCase().endsWith(originalFileName.toLowerCase())) {
                                    commit.originalFileName = originalFileName;
                                }

                                const previousSha = m[14];
                                if (previousSha) {
                                    commit.previousSha = previousSha.substring(0, 8);
                                    commit.previousFileName = m[15];
                                }

                                commits.set(sha, commit);
                            }

                            const line: IGitCommitLine = {
                                sha,
                                line: parseInt(m[3], 10) - 1,
                                originalLine: parseInt(m[2], 10) - 1
                                //code: m[17]
                            }

                            commit.lines.push(line);
                            lines.push(line);
                        }

                        commits.forEach(c => authors.get(c.author).lineCount += c.lines.length);

                        const sortedAuthors: Map<string, IGitAuthor> = new Map();
                        const values = Array.from(authors.values())
                            .sort((a, b) => b.lineCount - a.lineCount)
                            .forEach(a => sortedAuthors.set(a.name, a));

                        const sortedCommits: Map<string, IGitCommit> = new Map();
                        Array.from(commits.values())
                            .sort((a, b) => b.date.getTime() - a.date.getTime())
                            .forEach(c => sortedCommits.set(c.sha, c));

                        return {
                            authors: sortedAuthors,
                            commits: sortedCommits,
                            lines: lines
                        };
                    });

                // Trap and cache expected blame errors
                blame.catch(ex => {
                    const msg = ex && ex.toString();
                    if (msg && (msg.includes('is outside repository') || msg.includes('no such path'))) {
                        this._blames.set(cacheKey, <IBlameCacheEntry>{
                            //date: new Date(),
                            blame: GitProvider.BlameEmptyPromise,
                            errorMessage: msg
                        });
                        return GitProvider.BlameEmptyPromise;
                    }

                    const brokenBlame = this._blames.get(cacheKey);
                    if (brokenBlame) {
                        brokenBlame.errorMessage = msg;
                        this._blames.set(cacheKey, brokenBlame);
                    }

                    throw ex;
                });
            }

            this._blames.set(cacheKey, <IBlameCacheEntry> {
                //date: new Date(),
                blame: blame
            });

            return blame;
        });
    }

    getBlameForLine(fileName: string, line: number): Promise<IGitBlameLine> {
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

    getBlameForRange(fileName: string, range: Range): Promise<IGitBlameLines> {
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

                const commit: IGitCommit = new GitCommit(this.repoPath, c.sha, c.fileName, c.author, c.date, c.message, c.lines.filter(l => l.line >= range.start.line && l.line <= range.end.line));
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

    getBlameForShaRange(fileName: string, sha: string, range: Range): Promise<IGitBlameCommitLines> {
        return this.getBlameForFile(fileName).then(blame => {
            if (!blame) return null;

            const lines = blame.lines.slice(range.start.line, range.end.line + 1).filter(l => l.sha === sha);
            let commit = blame.commits.get(sha);
            commit = new GitCommit(this.repoPath, commit.sha, commit.fileName, commit.author, commit.date, commit.message, lines);
            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                lines: lines
            };
        });
    }

    getBlameLocations(fileName: string, range: Range) {
        return this.getBlameForRange(fileName, range).then(blame => {
            if (!blame) return null;

            const commitCount = blame.commits.size;

            const locations: Array<Location> = [];
            Array.from(blame.commits.values())
                .forEach((c, i) => {
                    const uri = c.toBlameUri(i + 1, commitCount, range);
                    c.lines.forEach(l => locations.push(new Location(c.originalFileName
                            ? c.toBlameUri(i + 1, commitCount, range, c.originalFileName)
                            : uri,
                        new Position(l.originalLine, 0))));
                });

            return locations;
        });
    }

    // getHistoryLocations(fileName: string, range: Range) {
    //     return this.getBlameForRange(fileName, range).then(blame => {
    //         if (!blame) return null;

    //         const commitCount = blame.commits.size;

    //         const locations: Array<Location> = [];
    //         Array.from(blame.commits.values())
    //             .forEach((c, i) => {
    //                 const uri = this.toBlameUri(c, i + 1, commitCount, range);
    //                 c.lines.forEach(l => locations.push(new Location(c.originalFileName
    //                         ? this.toBlameUri(c, i + 1, commitCount, range, c.originalFileName)
    //                         : uri,
    //                     new Position(l.originalLine, 0))));
    //             });

    //         return locations;
    //     });
    // }

    // getCommitMessage(sha: string) {
    //     return Git.getCommitMessage(sha, this.repoPath);
    // }

    // getCommitMessages(fileName: string) {
    //     return Git.getCommitMessages(fileName, this.repoPath).then(data => {
    //         const commits: Map<string, string> = new Map();
    //         let m: Array<string>;
    //         while ((m = commitMessageMatcher.exec(data)) != null) {
    //             commits.set(m[1], m[2]);
    //         }

    //         return commits;
    //     });
    // }

    getVersionedFile(fileName: string, sha: string) {
        return Git.getVersionedFile(fileName, this.repoPath, sha);
    }

    getVersionedFileText(fileName: string, sha: string) {
        return Git.getVersionedFileText(fileName, this.repoPath, sha);
    }

    fromBlameUri(uri: Uri): IGitBlameUriData {
        if (uri.scheme !== DocumentSchemes.GitBlame) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        const data = this._fromGitUri<IGitBlameUriData>(uri);
        data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
        return data;
    }

    fromGitUri(uri: Uri) {
        if (uri.scheme !== DocumentSchemes.Git) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return this._fromGitUri<IGitUriData>(uri);
    }

    private _fromGitUri<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }
}

export interface IGitBlame {
    authors: Map<string, IGitAuthor>;
    commits: Map<string, IGitCommit>;
    lines: IGitCommitLine[];
}

export interface IGitBlameLine {
    author: IGitAuthor;
    commit: IGitCommit;
    line: IGitCommitLine;
}

export interface IGitBlameLines extends IGitBlame {
    allLines: IGitCommitLine[];
}

export interface IGitBlameCommitLines {
    author: IGitAuthor;
    commit: IGitCommit;
    lines: IGitCommitLine[];
}

export interface IGitAuthor {
    name: string;
    lineCount: number;
}

export interface IGitCommit {
    sha: string;
    fileName: string;
    author: string;
    date: Date;
    message: string;
    lines: IGitCommitLine[];
    originalFileName?: string;
    previousSha?: string;
    previousFileName?: string;

    toPreviousUri(): Uri;
    toUri(): Uri;

    toBlameUri(index: number, commitCount: number, range: Range, originalFileName?: string);
    toGitUri(index: number, commitCount: number, originalFileName?: string);
}

class GitCommit implements IGitCommit {
    lines: IGitCommitLine[];
    originalFileName?: string;
    previousSha?: string;
    previousFileName?: string;

    constructor(private repoPath: string, public sha: string, public fileName: string, public author: string, public date: Date, public message: string, lines?: IGitCommitLine[]) {
        this.lines = lines || [];
    }

    toPreviousUri(): Uri {
        return this.previousFileName ? Uri.file(join(this.repoPath, this.previousFileName)) : this.toUri();
    }

    toUri(): Uri {
        return Uri.file(join(this.repoPath, this.originalFileName || this.fileName));
    }

    toBlameUri(index: number, commitCount: number, range: Range, originalFileName?: string) {
        return this._toGitUri(DocumentSchemes.GitBlame, commitCount, this._toGitBlameUriData(index, range, originalFileName));
    }

    toGitUri(index: number, commitCount: number, originalFileName?: string) {
        return this._toGitUri(DocumentSchemes.Git, commitCount, this._toGitUriData(index, originalFileName));
    }

    private _toGitUri(scheme: DocumentSchemes, commitCount: number, data: IGitUriData | IGitBlameUriData) {
        const pad = n => ("0000000" + n).slice(-("" + commitCount).length);
        const ext = extname(data.fileName);
        // const path = `${dirname(data.fileName)}/${commit.sha}: ${basename(data.fileName, ext)}${ext}`;
        const path = `${dirname(data.fileName)}/${this.sha}${ext}`;

        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${scheme}:${pad(data.index)}. ${this.author}, ${moment(this.date).format('MMM D, YYYY hh:MM a')} - ${path}?${JSON.stringify(data)}`);
    }

    private _toGitUriData<T extends IGitUriData>(index: number, originalFileName?: string): T {
        const fileName = originalFileName || this.fileName;
        const data = { fileName: this.fileName, sha: this.sha, index: index } as T;
        if (originalFileName) {
            data.originalFileName = originalFileName;
        }
        return data;
    }

    private _toGitBlameUriData(index: number, range: Range, originalFileName?: string) {
        const data = this._toGitUriData<IGitBlameUriData>(index, originalFileName);
        data.range = range;
        return data;
    }
}

export interface IGitCommitLine {
    sha: string;
    line: number;
    originalLine: number;
    code?: string;
}

export interface IGitUriData {
    fileName: string,
    originalFileName?: string;
    sha: string,
    index: number
}

export interface IGitBlameUriData extends IGitUriData {
    range: Range
}