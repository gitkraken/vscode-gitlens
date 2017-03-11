'use strict';
import Git, { GitBlameFormat, GitCommit, IGitAuthor, IGitBlame, IGitCommitLine, IGitEnricher } from './../git';
import * as moment from 'moment';
import * as path from 'path';

interface IBlameEntry {
    sha: string;

    line: number;
    originalLine: number;
    lineCount: number;

    author?: string;
    authorEmail?: string;
    authorDate?: string;
    authorTimeZone?: string;

    committer?: string;
    committerEmail?: string;
    committerDate?: string;
    committerTimeZone?: string;

    previousSha?: string;
    previousFileName?: string;

    fileName?: string;

    summary?: string;
}

export class GitBlameParserEnricher implements IGitEnricher<IGitBlame> {

    constructor(public format: GitBlameFormat) {
        if (format !== GitBlameFormat.incremental) {
            throw new Error(`Invalid blame format=${format}`);
        }
    }

    private _parseEntries(data: string): IBlameEntry[] {
        if (!data) return undefined;

        const lines = data.split('\n');
        if (!lines.length) return undefined;

        const entries: IBlameEntry[] = [];

        let entry: IBlameEntry;
        let position = -1;
        while (++position < lines.length) {
            let lineParts = lines[position].split(' ');
            if (lineParts.length < 2) {
                continue;
            }

            if (!entry) {
                entry = {
                    sha: lineParts[0],
                    originalLine: parseInt(lineParts[1], 10) - 1,
                    line: parseInt(lineParts[2], 10) - 1,
                    lineCount: parseInt(lineParts[3], 10)
                };

                continue;
            }

            switch (lineParts[0]) {
                case 'author':
                    entry.author = Git.isUncommitted(entry.sha)
                        ? 'Uncommitted'
                        : lineParts.slice(1).join(' ').trim();
                    break;

                // case 'author-mail':
                //     entry.authorEmail = lineParts[1].trim();
                //     break;

                case 'author-time':
                    entry.authorDate = lineParts[1];
                    break;

                case 'author-tz':
                    entry.authorTimeZone = lineParts[1];
                    break;

                // case 'committer':
                //     entry.committer = lineParts.slice(1).join(' ').trim();
                //     break;

                // case 'committer-mail':
                //     entry.committerEmail = lineParts[1].trim();
                //     break;

                // case 'committer-time':
                //     entry.committerDate = lineParts[1];
                //     break;

                // case 'committer-tz':
                //     entry.committerTimeZone = lineParts[1];
                //     break;

                case 'summary':
                    entry.summary = lineParts.slice(1).join(' ').trim();
                    break;

                case 'previous':
                    entry.previousSha = lineParts[1];
                    entry.previousFileName = lineParts.slice(2).join(' ');
                    break;

                case 'filename':
                    entry.fileName = lineParts.slice(1).join(' ');

                    entries.push(entry);
                    entry = undefined;
                    break;

                default:
                    break;
            }
        }

        return entries;
    }

    enrich(data: string, fileName: string): IGitBlame {
        const entries = this._parseEntries(data);
        if (!entries) return undefined;

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, GitCommit> = new Map();
        const lines: Array<IGitCommitLine> = [];

        let repoPath: string;
        let relativeFileName: string;

        for (let i = 0, len = entries.length; i < len; i++) {
            const entry = entries[i];

            if (i === 0) {
                // Try to get the repoPath from the most recent commit
                repoPath = fileName.replace(`/${entry.fileName}`, '');
                relativeFileName = path.relative(repoPath, fileName).replace(/\\/g, '/');
            }

            let commit = commits.get(entry.sha);
            if (!commit) {
                let author = authors.get(entry.author);
                if (!author) {
                    author = {
                        name: entry.author,
                        lineCount: 0
                    };
                    authors.set(entry.author, author);
                }

                commit = new GitCommit(repoPath, entry.sha, relativeFileName, entry.author, moment(`${entry.authorDate} ${entry.authorTimeZone}`, 'X +-HHmm').toDate(), entry.summary);

                if (relativeFileName !== entry.fileName) {
                    commit.originalFileName = entry.fileName;
                }

                if (entry.previousSha) {
                    commit.previousSha = entry.previousSha;
                    commit.previousFileName = entry.previousFileName;
                }

                commits.set(entry.sha, commit);
            }

            for (let j = 0, len = entry.lineCount; j < len; j++) {
                const line: IGitCommitLine = {
                    sha: entry.sha,
                    line: entry.line + j,
                    originalLine: entry.originalLine + j
                };

                if (commit.previousSha) {
                    line.previousSha = commit.previousSha;
                }

                commit.lines.push(line);
                lines[line.line] = line;
            }
        }

        commits.forEach(c => authors.get(c.author).lineCount += c.lines.length);

        const sortedAuthors: Map<string, IGitAuthor> = new Map();
        // const values =
        Array.from(authors.values())
            .sort((a, b) => b.lineCount - a.lineCount)
            .forEach(a => sortedAuthors.set(a.name, a));

        // const sortedCommits: Map<string, IGitCommit> = new Map();
        // Array.from(commits.values())
        //     .sort((a, b) => b.date.getTime() - a.date.getTime())
        //     .forEach(c => sortedCommits.set(c.sha, c));

        return {
            repoPath: repoPath,
            authors: sortedAuthors,
            // commits: sortedCommits,
            commits: commits,
            lines: lines
        } as IGitBlame;
    }
}