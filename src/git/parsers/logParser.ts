'use strict';
import { Range } from 'vscode';
import { Git, GitStatusFileStatus, GitLogCommit, GitCommitType, IGitAuthor, IGitLog, IGitStatusFile } from './../git';
// import { Logger } from '../../logger';
import * as moment from 'moment';
import * as path from 'path';

interface ILogEntry {
    sha: string;

    author: string;
    authorDate?: string;

    // committer?: string;
    // committerDate?: string;

    parentShas?: string[];

    fileName?: string;
    originalFileName?: string;
    fileStatuses?: IGitStatusFile[];

    status?: GitStatusFileStatus;

    summary?: string;
}

const diffRegex = /diff --git a\/(.*) b\/(.*)/;

export class GitLogParser {

    private static _parseEntries(data: string, type: GitCommitType, maxCount: number | undefined, reverse: boolean): ILogEntry[] | undefined {
        if (!data) return undefined;

        const lines = data.split('\n');
        if (!lines.length) return undefined;

        const entries: ILogEntry[] = [];

        let entry: ILogEntry | undefined = undefined;
        let position = -1;
        while (++position < lines.length) {
            // Since log --reverse doesn't properly honor a max count -- enforce it here
            if (reverse && maxCount && (entries.length >= maxCount)) break;

            let lineParts = lines[position].split(' ');
            if (lineParts.length < 2) {
                continue;
            }

            if (entry === undefined) {
                if (!Git.shaRegex.test(lineParts[0])) continue;

                entry = {
                    sha: lineParts[0]
                } as ILogEntry;

                continue;
            }

            switch (lineParts[0]) {
                case 'author':
                    entry.author = Git.isUncommitted(entry.sha)
                        ? 'Uncommitted'
                        : lineParts.slice(1).join(' ').trim();
                    break;

                case 'author-date':
                    entry.authorDate = `${lineParts[1]}T${lineParts[2]}${lineParts[3]}`;
                    break;

                // case 'committer':
                //     entry.committer = lineParts.slice(1).join(' ').trim();
                //     break;

                // case 'committer-date':
                //     entry.committerDate = lineParts.slice(1).join(' ').trim();
                //     break;

                case 'parents':
                    entry.parentShas = lineParts.slice(1);
                    break;

                case 'summary':
                    entry.summary = lineParts.slice(1).join(' ').trim();
                    while (++position < lines.length) {
                        const next = lines[position];
                        if (!next) break;
                        if (next === 'filename ?') {
                            position--;
                            break;
                        }

                        entry.summary += `\n${lines[position]}`;
                    }
                    break;

                case 'filename':
                    if (type === 'branch') {
                        const nextLine = lines[position + 1];
                        // If the next line isn't blank, make sure it isn't starting a new commit
                        if (nextLine && Git.shaRegex.test(nextLine)) continue;

                        position++;

                        let diff = false;
                        while (++position < lines.length) {
                            const line = lines[position];
                            lineParts = line.split(' ');

                            if (Git.shaRegex.test(lineParts[0])) {
                                position--;
                                break;
                            }

                            if (diff) continue;

                            if (lineParts[0] === 'diff') {
                                diff = true;
                                const matches = diffRegex.exec(line);
                                if (matches != null) {
                                    entry.fileName = matches[1];
                                    const originalFileName = matches[2];
                                    if (entry.fileName !== originalFileName) {
                                        entry.originalFileName = originalFileName;
                                    }
                                }
                                continue;
                            }

                            if (entry.fileStatuses == null) {
                                entry.fileStatuses = [];
                            }

                            const status = {
                                status: line[0] as GitStatusFileStatus,
                                fileName: line.substring(1),
                                originalFileName: undefined
                            } as IGitStatusFile;
                            this._parseFileName(status);

                            entry.fileStatuses.push(status);
                        }

                        if (entry.fileStatuses) {
                            entry.fileName = entry.fileStatuses.filter(_ => !!_.fileName).map(_ => _.fileName).join(', ');
                        }
                    }
                    else {
                        position += 2;
                        const line = lines[position];
                        entry.status = line[0] as GitStatusFileStatus;
                        entry.fileName = line.substring(1);
                        this._parseFileName(entry);
                    }

                    entries.push(entry);
                    entry = undefined;
                    break;

                default:
                    break;
            }
        }

        return entries;
    }

    static parse(data: string, type: GitCommitType, repoPath: string | undefined, fileName: string | undefined, sha: string | undefined, maxCount: number | undefined, reverse: boolean, range: Range | undefined): IGitLog | undefined {
        const entries = this._parseEntries(data, type, maxCount, reverse);
        if (!entries) return undefined;

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, GitLogCommit> = new Map();

        let relativeFileName: string;
        let recentCommit: GitLogCommit | undefined = undefined;

        if (repoPath !== undefined) {
            repoPath = Git.normalizePath(repoPath);
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            // Since log --reverse doesn't properly honor a max count -- enforce it here
            if (reverse && maxCount && (i >= maxCount)) break;

            const entry = entries[i];

            if (i === 0 && repoPath === undefined && type === 'file' && fileName !== undefined) {
                // Try to get the repoPath from the most recent commit
                repoPath = Git.normalizePath(fileName.replace(fileName.startsWith('/') ? `/${entry.fileName}` : entry.fileName!, ''));
                relativeFileName = Git.normalizePath(path.relative(repoPath, fileName));
            }
            else {
                relativeFileName = entry.fileName!;
            }

            let commit = commits.get(entry.sha);
            if (commit === undefined) {
                if (entry.author !== undefined) {
                    let author = authors.get(entry.author);
                    if (author === undefined) {
                        author = {
                            name: entry.author,
                            lineCount: 0
                        };
                        authors.set(entry.author, author);
                    }
                }

                commit = new GitLogCommit(type, repoPath!, entry.sha, relativeFileName, entry.author, moment(entry.authorDate).toDate(), entry.summary!, entry.status, entry.fileStatuses, undefined, entry.originalFileName);
                commit.parentShas = entry.parentShas!;

                if (relativeFileName !== entry.fileName) {
                    commit.originalFileName = entry.fileName;
                }

                commits.set(entry.sha, commit);
            }
            // else {
            //     Logger.log(`merge commit? ${entry.sha}`);
            // }

            if (recentCommit !== undefined) {
                recentCommit.previousSha = commit.sha;

                // If the commit sha's match (merge commit), just forward it along
                commit.nextSha = commit.sha !== recentCommit.sha ? recentCommit.sha : recentCommit.nextSha;

                // Only add a filename if this is a file log
                if (type === 'file') {
                    recentCommit.previousFileName = commit.originalFileName || commit.fileName;
                    commit.nextFileName = recentCommit.originalFileName || recentCommit.fileName;
                }
            }
            recentCommit = commit;
        }

        commits.forEach(c => {
            if (c.author === undefined) return;

            const author = authors.get(c.author);
            if (author === undefined) return;

            author.lineCount += c.lines.length;
        });

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
            sha: sha,
            maxCount: maxCount,
            range: range,
            truncated: !!(maxCount && entries.length >= maxCount)
        } as IGitLog;
    }

    private static _parseFileName(entry: { fileName?: string, originalFileName?: string }) {
        if (entry.fileName === undefined) return;

        const index = entry.fileName.indexOf('\t') + 1;
        if (index > 0) {
            const next = entry.fileName.indexOf('\t', index) + 1;
            if (next > 0) {
                entry.originalFileName = entry.fileName.substring(index, next - 1);
                entry.fileName = entry.fileName.substring(next);
            }
            else {
                entry.fileName = entry.fileName.substring(index);
            }
        }
    }
}