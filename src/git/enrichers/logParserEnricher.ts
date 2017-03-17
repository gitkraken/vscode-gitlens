'use strict';
import { Git, GitFileStatus, GitLogCommit, GitLogType, IGitAuthor, IGitEnricher, IGitLog } from './../git';
// import { Logger } from '../../logger';
import * as moment from 'moment';
import * as path from 'path';

interface ILogEntry {
    sha: string;

    author?: string;
    authorDate?: string;

    committer?: string;
    committerDate?: string;

    parentSha?: string;

    fileName?: string;
    originalFileName?: string;
    fileStatuses?: { status: GitFileStatus, fileName: string, originalFileName: string }[];

    status?: GitFileStatus;

    summary?: string;
}

export class GitLogParserEnricher implements IGitEnricher<IGitLog> {

    private _parseEntries(data: string, isRepoPath: boolean): ILogEntry[] {
        if (!data) return undefined;

        const lines = data.split('\n');
        if (!lines.length) return undefined;

        const entries: ILogEntry[] = [];

        let entry: ILogEntry;
        let position = -1;
        while (++position < lines.length) {
            let lineParts = lines[position].split(' ');
            if (lineParts.length < 2) {
                continue;
            }

            if (!entry) {
                if (!Git.ShaRegex.test(lineParts[0])) continue;

                entry = {
                    sha: lineParts[0]
                };

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

                case 'parent':
                    entry.parentSha = lineParts.slice(1).join(' ').trim();
                    break;

                case 'summary':
                    entry.summary = lineParts.slice(1).join(' ').trim();
                    while (++position < lines.length) {
                        if (!lines[position]) break;
                        entry.summary += `\n${lines[position]}`;
                    }
                    break;

                case 'filename':
                    if (isRepoPath) {
                        position++;

                        let diff = false;
                        while (++position < lines.length) {
                            lineParts = lines[position].split(' ');

                            if (Git.ShaRegex.test(lineParts[0])) {
                                position--;
                                break;
                            }

                            if (diff) continue;

                            if (lineParts[0] === 'diff') {
                                diff = true;
                                entry.fileName = lineParts[2].substring(2);
                                const originalFileName = lineParts[3].substring(2);
                                if (entry.fileName !== originalFileName) {
                                    entry.originalFileName = originalFileName;
                                }
                                continue;
                            }

                            if (entry.fileStatuses == null) {
                                entry.fileStatuses = [];
                            }

                            const status = {
                                status: lineParts[0][0] as GitFileStatus,
                                fileName: lineParts[0].substring(1),
                                originalFileName: undefined as string
                            };

                            const index = status.fileName.indexOf('\t') + 1;
                            if (index) {
                                const next = status.fileName.indexOf('\t', index) + 1;
                                if (next) {
                                    status.originalFileName = status.fileName.substring(index, next - 1);
                                    status.fileName = status.fileName.substring(next);
                                }
                                else {
                                    status.fileName = status.fileName.substring(index);
                                }
                            }

                            entry.fileStatuses.push(status);
                        }

                        if (entry.fileStatuses) {
                            entry.fileName = entry.fileStatuses.filter(_ => !!_.fileName).map(_ => _.fileName).join(', ');
                        }
                    }
                    else {
                        position += 2;
                        lineParts = lines[position].split(' ');
                        if (lineParts.length === 1) {
                            entry.status = lineParts[0][0] as GitFileStatus;
                            entry.fileName = lineParts[0].substring(1);
                        }
                        else {
                            entry.status = lineParts[3][0] as GitFileStatus;
                            entry.fileName = lineParts[0].substring(1);
                            position += 4;
                        }

                        const index = entry.fileName.indexOf('\t') + 1;
                        if (index) {
                            const next = entry.fileName.indexOf('\t', index) + 1;
                            if (next) {
                                entry.originalFileName = entry.fileName.substring(index, next - 1);
                                entry.fileName = entry.fileName.substring(next);
                            }
                            else {
                                entry.fileName = entry.fileName.substring(index);
                            }
                        }
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

    enrich(data: string, type: GitLogType, fileNameOrRepoPath: string, maxCount: number | undefined, isRepoPath: boolean, reverse: boolean): IGitLog {
        const entries = this._parseEntries(data, isRepoPath);
        if (!entries) return undefined;

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, GitLogCommit> = new Map();

        let repoPath: string;
        let relativeFileName: string;
        let recentCommit: GitLogCommit;

        if (isRepoPath) {
            repoPath = fileNameOrRepoPath;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            // Since log --reverse doesn't properly honor a max count -- enforce it here
            if (reverse && i >= maxCount) break;

            const entry = entries[i];

            if (i === 0 || isRepoPath) {
                if (isRepoPath) {
                    relativeFileName = entry.fileName;
                }
                else {
                    // Try to get the repoPath from the most recent commit
                    repoPath = fileNameOrRepoPath.replace(fileNameOrRepoPath.startsWith('/') ? `/${entry.fileName}` : entry.fileName, '');
                    relativeFileName = path.relative(repoPath, fileNameOrRepoPath).replace(/\\/g, '/');
                }
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

                commit = new GitLogCommit(type, repoPath, entry.sha, relativeFileName, entry.author, moment(entry.authorDate).toDate(), entry.summary, entry.status, entry.fileStatuses, undefined, entry.originalFileName);

                if (relativeFileName !== entry.fileName) {
                    commit.originalFileName = entry.fileName;
                }

                commits.set(entry.sha, commit);
            }
            // else {
            //     Logger.log(`merge commit? ${entry.sha}`);
            // }

            if (recentCommit) {
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
            maxCount: maxCount,
            truncated: maxCount && entries.length >= maxCount
        } as IGitLog;
    }
}