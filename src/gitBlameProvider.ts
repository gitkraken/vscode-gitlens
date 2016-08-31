import {Disposable, ExtensionContext, Location, Position, Range, Uri, workspace} from 'vscode';
import {DocumentSchemes, WorkspaceState} from './constants';
import {gitBlame, gitNormalizePath} from './git';
import {basename, dirname, extname} from 'path';
import * as moment from 'moment';
import * as _ from 'lodash';

const blameMatcher = /^([\^0-9a-fA-F]{8})\s([\S]*)\s+([0-9\S]+)\s\((.*)\s([0-9]{4}-[0-9]{2}-[0-9]{2}\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s[-|+][0-9]{4})\s+([0-9]+)\)(.*)$/gm;

export default class GitBlameProvider extends Disposable {
    public repoPath: string;

    private _files: Map<string, Promise<IGitBlame>>;
    private _subscriptions: Disposable;

    constructor(context: ExtensionContext) {
        super(() => this.dispose());

        this.repoPath = context.workspaceState.get(WorkspaceState.RepoPath) as string;

        this._files = new Map();
        this._subscriptions = Disposable.from(workspace.onDidCloseTextDocument(d => this._removeFile(d.fileName)),
                                              workspace.onDidChangeTextDocument(e => this._removeFile(e.document.fileName)));
    }

    dispose() {
        this._files.clear();
        this._subscriptions && this._subscriptions.dispose();
        super.dispose();
    }

    blameFile(fileName: string, repoPath: string) {
        fileName = gitNormalizePath(fileName, repoPath);

        let blame = this._files.get(fileName);
        if (blame !== undefined) return blame;

        blame = gitBlame(fileName, repoPath)
            .then(data => {
                const commits: Map<string, IGitBlameCommit> = new Map();
                const lines: Array<IGitBlameLine> = [];
                let m: Array<string>;
                while ((m = blameMatcher.exec(data)) != null) {
                    let sha = m[1];

                    if (!commits.has(sha)) {
                        commits.set(sha, {
                            sha,
                            fileName: fileName,
                            author: m[4].trim(),
                            date: new Date(m[5])
                        });
                    }

                    const line: IGitBlameLine = {
                        sha,
                        line: parseInt(m[6], 10) - 1,
                        originalLine: parseInt(m[3], 10) - 1,
                        //code: m[7]
                    }

                    let file = m[2].trim();
                    if (!fileName.toLowerCase().endsWith(file.toLowerCase())) {
                        line.originalFileName = file;
                    }

                    lines.push(line);
                }

                return { commits, lines };
            });

        this._files.set(fileName, blame);
        return blame;
    }

    getBlameForRange(fileName: string, repoPath: string, range: Range): Promise<IGitBlame> {
        return this.blameFile(fileName, repoPath).then(blame => {
            if (!blame.lines.length) return blame;

            const lines = blame.lines.slice(range.start.line, range.end.line + 1);
            const commits = new Map();
            _.uniqBy(lines, 'sha').forEach(l => commits.set(l.sha, blame.commits.get(l.sha)));

            return { commits, lines };
        });
    }

    getBlameForShaRange(fileName: string, repoPath: string, sha: string, range: Range): Promise<{commit: IGitBlameCommit, lines: IGitBlameLine[]}> {
        return this.blameFile(fileName, repoPath).then(blame => {
            return {
                commit: blame.commits.get(sha),
                lines: blame.lines.slice(range.start.line, range.end.line + 1).filter(l => l.sha === sha)
            };
        });
    }

    getBlameLocations(fileName: string, repoPath: string, range: Range) {
        return this.getBlameForRange(fileName, repoPath, range).then(blame => {
            const commitCount = blame.commits.size;

            const locations: Array<Location> = [];
            Array.from(blame.commits.values())
                .sort((a, b) => b.date.getTime() - a.date.getTime())
                .forEach((c, i) => {
                    const uri = GitBlameProvider.toBlameUri(this.repoPath, c, range, i + 1, commitCount);
                    blame.lines
                        .filter(l => l.sha === c.sha)
                        .forEach(l => locations.push(new Location(l.originalFileName
                                    ? GitBlameProvider.toBlameUri(this.repoPath, c, range, i + 1, commitCount, l.originalFileName)
                                    : uri,
                                new Position(l.originalLine, 0))));
                });

            return locations;
        });
    }

    private _removeFile(fileName: string) {
        this._files.delete(fileName);
    }

    static toBlameUri(repoPath: string, commit: IGitBlameCommit, range: Range, index: number, commitCount: number, originalFileName?: string) {
        const pad = n => ("0000000" + n).slice(-("" + commitCount).length);

        const fileName = originalFileName || commit.fileName;
        const ext = extname(fileName);
        const path = `${dirname(fileName)}/${commit.sha}: ${basename(fileName, ext)}${ext}`;
        const data: IGitBlameUriData = { fileName: commit.fileName, sha: commit.sha, range: range, index: index };
        if (originalFileName) {
            data.originalFileName = originalFileName;
        }
        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${DocumentSchemes.GitBlame}:${pad(index)}. ${commit.author}, ${moment(commit.date).format('MMM D, YYYY hh:MMa')} - ${path}?${JSON.stringify(data)}`);
    }

    static fromBlameUri(uri: Uri): IGitBlameUriData {
        const data = JSON.parse(uri.query);
        data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
        return data;
    }
}

export interface IGitBlame {
    commits: Map<string, IGitBlameCommit>;
    lines: IGitBlameLine[];
}

export interface IGitBlameCommit {
    sha: string;
    fileName: string;
    author: string;
    date: Date;
}
export interface IGitBlameLine {
    sha: string;
    line: number;
    originalLine: number;
    originalFileName?: string;
    code?: string;
}
export interface IGitBlameUriData {
    fileName: string,
    originalFileName?: string;
    sha: string,
    range: Range,
    index: number
}