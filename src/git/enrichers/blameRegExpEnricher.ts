'use strict'
import {GitBlameFormat, GitCommit, IGitAuthor, IGitBlame, IGitCommit, IGitCommitLine, IGitEnricher} from './../git';
import * as moment from 'moment';

const blamePorcelainMatcher = /^([\^0-9a-fA-F]{40})\s([0-9]+)\s([0-9]+)(?:\s([0-9]+))?$\n(?:^author\s(.*)$\n^author-mail\s(.*)$\n^author-time\s(.*)$\n^author-tz\s(.*)$\n^committer\s(.*)$\n^committer-mail\s(.*)$\n^committer-time\s(.*)$\n^committer-tz\s(.*)$\n^summary\s(.*)$\n(?:^previous\s(.*)?\s(.*)$\n)?^filename\s(.*)$\n)?^(.*)$/gm;
const blameLinePorcelainMatcher = /^([\^0-9a-fA-F]{40})\s([0-9]+)\s([0-9]+)(?:\s([0-9]+))?$\n^author\s(.*)$\n^author-mail\s(.*)$\n^author-time\s(.*)$\n^author-tz\s(.*)$\n^committer\s(.*)$\n^committer-mail\s(.*)$\n^committer-time\s(.*)$\n^committer-tz\s(.*)$\n^summary\s(.*)$\n(?:^previous\s(.*)?\s(.*)$\n)?^filename\s(.*)$\n^(.*)$/gm;

export class GitBlameRegExpEnricher implements IGitEnricher<IGitBlame> {
    private _matcher: RegExp;

    constructor(public format: GitBlameFormat, private repoPath: string) {
        if (format === GitBlameFormat.porcelain) {
            this._matcher = blamePorcelainMatcher;
        } else if (format === GitBlameFormat.linePorcelain) {
            this._matcher = blamePorcelainMatcher;
        } else {
            throw new Error(`Invalid blame format=${format}`);
        }
    }

    enrich(data: string, fileName: string): IGitBlame {
        if (!data) return null;

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, IGitCommit> = new Map();
        const lines: Array<IGitCommitLine> = [];

        let m: Array<string>;
        while ((m = this._matcher.exec(data)) != null) {
            const sha = m[1].substring(0, 8);
            const previousSha = m[14];
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

            if (previousSha) {
                line.previousSha = previousSha.substring(0, 8);
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

        return <IGitBlame>{
            authors: sortedAuthors,
            commits: sortedCommits,
            lines: lines
        };
    }
}