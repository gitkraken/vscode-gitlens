'use strict';
import { GitCommit, IGitAuthor, IGitCommit, IGitEnricher, IGitLog } from './../git';
import * as moment from 'moment';
import * as path from 'path';

interface ILogEntry {
    sha: string;

    author?: string;
    authorDate?: string;

    committer?: string;
    committerDate?: string;

    fileName?: string;

    summary?: string;
}

export class GitLogParserEnricher implements IGitEnricher<IGitLog> {
    private _parseEntries(data: string): ILogEntry[] {
        if (!data) return null;

        const lines = data.split('\n');
        if (!lines.length) return null;

        const entries: ILogEntry[] = [];

        let entry: ILogEntry;
        let position = -1;
        while (++position < lines.length) {
            let lineParts = lines[position].split(' ');
            if (lineParts.length < 2) {
                continue;
            }

            if (!entry) {
                entry = {
                    sha: lineParts[0].substring(0, 8)
                };

                continue;
            }

            switch (lineParts[0]) {
                case 'author':
                    entry.author = lineParts.slice(1).join(' ').trim();
                    break;

                case 'author-date':
                    entry.authorDate = lineParts.slice(1).join(' ').trim();
                    break;

                // case 'committer':
                //     entry.committer = lineParts.slice(1).join(' ').trim();
                //     break;

                // case 'committer-date':
                //     entry.committerDate = lineParts.slice(1).join(' ').trim();
                //     break;

                case 'summary':
                    entry.summary = lineParts.slice(1).join(' ').trim();
                    break;

                case 'filename':
                    position += 2;
                    lineParts = lines[position].split(' ');
                    entry.fileName = lineParts.join(' ');

                    entries.push(entry);
                    entry = null;
                    break;

                default:
                    break;
            }
        }

        return entries;
    }

    enrich(data: string, fileName: string): IGitLog {
        const entries = this._parseEntries(data);
        if (!entries) return null;

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, IGitCommit> = new Map();

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

                commit = new GitCommit(repoPath, entry.sha, relativeFileName, entry.author, moment(entry.authorDate).toDate(), entry.summary);

                if (relativeFileName !== entry.fileName) {
                    commit.originalFileName = entry.fileName;
                }

                commits.set(entry.sha, commit);
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

        return <IGitLog>{
            repoPath: repoPath,
            authors: sortedAuthors,
            // commits: sortedCommits,
            commits: commits
        };
    }
}