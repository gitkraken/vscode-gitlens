'use strict';
import { Arrays, Strings } from '../../system';
import { Range } from 'vscode';
import { Git, GitAuthor, GitCommitType, GitLog, GitLogCommit, GitStatusFileStatus, IGitStatusFile } from './../git';
// import { Logger } from '../../logger';
import * as path from 'path';

interface LogEntry {
    ref?: string;

    author?: string;
    date?: string;
    email?: string;

    parentShas?: string[];

    fileName?: string;
    originalFileName?: string;
    fileStatuses?: IGitStatusFile[];

    status?: GitStatusFileStatus;

    summary?: string;
}

const diffRegex = /diff --git a\/(.*) b\/(.*)/;
const emptyEntry: LogEntry = {};

export class GitLogParser {

    static parse(data: string, type: GitCommitType, repoPath: string | undefined, fileName: string | undefined, sha: string | undefined, maxCount: number | undefined, reverse: boolean, range: Range | undefined): GitLog | undefined {
        if (!data) return undefined;

        let relativeFileName: string;
        let recentCommit: GitLogCommit | undefined = undefined;

        let entry: LogEntry = emptyEntry;
        let line: string | undefined = undefined;
        let token: number;

        let i = 0;
        let first = true;

        const lines = Strings.lines(data + '\n</f>');
        // Skip the first line since it will always be </f>
        let next = lines.next();
        if (next.done) return undefined;

        if (repoPath !== undefined) {
            repoPath = Strings.normalizePath(repoPath);
        }

        const authors: Map<string, GitAuthor> = new Map();
        const commits: Map<string, GitLogCommit> = new Map();

        while (true) {
            next = lines.next();
            if (next.done) break;

            line = next.value;

            // Since log --reverse doesn't properly honor a max count -- enforce it here
            if (reverse && maxCount && (i >= maxCount)) break;

            // <<1-char token>> <data>
            // e.g. <r> bd1452a2dc
            token = line.charCodeAt(1);

            switch (token) {
                case 114: // 'r': // ref
                    entry = {
                        ref: line.substring(4)
                    };
                    break;

                case 97: // 'a': // author
                    entry.author = Git.isUncommitted(entry.ref)
                        ? 'You'
                        : line.substring(4);
                    break;

                case 101: // 'e': // author-mail
                    entry.email = line.substring(4);
                    break;

                case 100: // 'd': // author-date
                    entry.date = line.substring(4);
                    break;

                case 112: // 'p': // parents
                    entry.parentShas = line.substring(4).split(' ');
                    break;

                case 115: // 's': // summary
                    while (true) {
                        next = lines.next();
                        if (next.done) break;

                        line = next.value;
                        if (line === '</s>') break;

                        if (entry.summary === undefined) {
                            entry.summary = line;
                        }
                        else {
                            entry.summary += `\n${line}`;
                        }
                    }
                    break;

                case 102: // 'f': // files
                    // Skip the blank line git adds before the files
                    next = lines.next();
                    if (next.done || next.value === '</f>') break;

                    while (true) {
                        next = lines.next();
                        if (next.done) break;

                        line = next.value;
                        if (line === '</f>') break;

                        if (line.startsWith('warning:')) continue;

                        if (type === GitCommitType.Branch) {
                            const status = {
                                status: line[0] as GitStatusFileStatus,
                                fileName: line.substring(1),
                                originalFileName: undefined
                            } as IGitStatusFile;
                            this.parseFileName(status);

                            if (status.fileName) {
                                if (entry.fileStatuses === undefined) {
                                    entry.fileStatuses = [];
                                }
                                entry.fileStatuses.push(status);
                            }
                        }
                        else if (line.startsWith('diff')) {
                            const matches = diffRegex.exec(line);
                            if (matches != null) {
                                entry.fileName = matches[1];
                                const originalFileName = matches[2];
                                if (entry.fileName !== originalFileName) {
                                    entry.originalFileName = originalFileName;
                                }
                                entry.status = entry.fileName !== entry.originalFileName ? 'R' : 'M';
                            }

                            while (true) {
                                next = lines.next();
                                if (next.done || next.value === '</f>') break;
                            }
                            break;
                        }
                        else {
                            entry.status = line[0] as GitStatusFileStatus;
                            entry.fileName = line.substring(1);
                            this.parseFileName(entry);
                        }
                    }

                    if (entry.fileStatuses !== undefined) {
                        entry.fileName = Arrays.filterMap(entry.fileStatuses,
                            f => !!f.fileName ? f.fileName : undefined).join(', ');
                    }

                    if (first && repoPath === undefined && type === GitCommitType.File && fileName !== undefined) {
                        // Try to get the repoPath from the most recent commit
                        repoPath = Strings.normalizePath(fileName.replace(fileName.startsWith('/') ? `/${entry.fileName}` : entry.fileName!, ''));
                        relativeFileName = Strings.normalizePath(path.relative(repoPath, fileName));
                    }
                    else {
                        relativeFileName = entry.fileName!;
                    }
                    first = false;

                    const commit = commits.get(entry.ref!);
                    if (commit === undefined) {
                        i++;
                    }
                    recentCommit = GitLogParser.parseEntry(entry, commit, type, repoPath, relativeFileName, commits, authors, recentCommit);

                    break;
            }
        }

        return {
            repoPath: repoPath,
            authors: authors,
            commits: commits,
            sha: sha,
            count: i,
            maxCount: maxCount,
            range: range,
            truncated: !!(maxCount && i >= maxCount && maxCount !== 1)
        } as GitLog;
    }

    private static parseEntry(entry: LogEntry, commit: GitLogCommit | undefined, type: GitCommitType, repoPath: string | undefined, relativeFileName: string, commits: Map<string, GitLogCommit>, authors: Map<string, GitAuthor>, recentCommit: GitLogCommit | undefined): GitLogCommit | undefined {
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

            const originalFileName = relativeFileName !== entry.fileName ? entry.fileName : undefined;
            if (type === GitCommitType.File) {
                entry.fileStatuses = [{ status: entry.status, fileName: relativeFileName, originalFileName: originalFileName } as IGitStatusFile];
            }

            commit = new GitLogCommit(
                type,
                repoPath!,
                entry.ref!,
                entry.author!,
                entry.email,
                new Date(entry.date! as any * 1000),
                entry.summary!,
                relativeFileName,
                entry.fileStatuses || [],
                entry.status,
                originalFileName,
                undefined,
                undefined,
                entry.parentShas!
            );

            commits.set(entry.ref!, commit);
        }
        // else {
        //     Logger.log(`merge commit? ${entry.sha}`);
        // }

        if (recentCommit !== undefined) {
            recentCommit.previousSha = commit.sha;

            // If the commit sha's match (merge commit), just forward it along
            commit.nextSha = commit.sha !== recentCommit.sha ? recentCommit.sha : recentCommit.nextSha;

            // Only add a filename if this is a file log
            if (type === GitCommitType.File) {
                recentCommit.previousFileName = commit.originalFileName || commit.fileName;
                commit.nextFileName = recentCommit.originalFileName || recentCommit.fileName;
            }
        }
        return commit;
    }

    static parseFileName(entry: { fileName?: string, originalFileName?: string }) {
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