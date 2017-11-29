'use strict';
import { Arrays, Strings } from '../../system';
import { Range } from 'vscode';
import { Git, GitAuthor, GitCommitType, GitLog, GitLogCommit, GitStatusFileStatus, IGitStatusFile } from './../git';
// import { Logger } from '../../logger';
import * as path from 'path';

interface LogEntry {
    sha: string;

    author: string;
    authorDate?: string;

    parentShas?: string[];

    fileName?: string;
    originalFileName?: string;
    fileStatuses?: IGitStatusFile[];

    status?: GitStatusFileStatus;

    summary?: string;
}

const diffRegex = /diff --git a\/(.*) b\/(.*)/;

export class GitLogParser {

    static parse(data: string, type: GitCommitType, repoPath: string | undefined, fileName: string | undefined, sha: string | undefined, maxCount: number | undefined, reverse: boolean, range: Range | undefined): GitLog | undefined {
        if (!data) return undefined;

        const authors: Map<string, GitAuthor> = new Map();
        const commits: Map<string, GitLogCommit> = new Map();

        let relativeFileName: string;
        let recentCommit: GitLogCommit | undefined = undefined;

        if (repoPath !== undefined) {
            repoPath = Git.normalizePath(repoPath);
        }

        let entry: LogEntry | undefined = undefined;
        let line: string | undefined = undefined;
        let lineParts: string[];
        let next: IteratorResult<string> | undefined = undefined;

        let i = 0;
        let first = true;
        let skip = false;

        const lines = Strings.lines(data);
        while (true) {
            if (!skip) {
                next = lines.next();
                if (next.done) break;

                line = next.value;
            }
            else {
                skip = false;
            }

            // Since log --reverse doesn't properly honor a max count -- enforce it here
            if (reverse && maxCount && (i >= maxCount)) break;

            lineParts = line!.split(' ');
            if (lineParts.length < 2) continue;

            if (entry === undefined) {
                if (!Git.shaRegex.test(lineParts[0])) continue;

                entry = {
                    sha: lineParts[0]
                } as LogEntry;

                continue;
            }

            switch (lineParts[0]) {
                case 'author':
                    entry.author = Git.isUncommitted(entry.sha)
                        ? 'You'
                        : lineParts.slice(1).join(' ').trim();
                    break;

                case 'author-date':
                    entry.authorDate = lineParts[1];
                    break;

                case 'parents':
                    entry.parentShas = lineParts.slice(1);
                    break;

                case 'summary':
                    entry.summary = lineParts.slice(1).join(' ').trim();
                    while (true) {
                        next = lines.next();
                        if (next.done) break;

                        line = next.value;
                        if (!line) break;

                        if (line === 'filename ?') {
                            skip = true;
                            break;
                        }

                        entry.summary += `\n${line}`;
                    }
                    break;

                case 'filename':
                    if (type === GitCommitType.Branch) {
                        next = lines.next();
                        if (next.done) break;

                        line = next.value;

                        // If the next line isn't blank, make sure it isn't starting a new commit
                        if (line && Git.shaRegex.test(line)) {
                            skip = true;
                            continue;
                        }

                        let diff = false;
                        while (true) {
                            next = lines.next();
                            if (next.done) break;

                            line = next.value;
                            lineParts = line.split(' ');

                            if (Git.shaRegex.test(lineParts[0])) {
                                skip = true;
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
                            this.parseFileName(status);

                            entry.fileStatuses.push(status);
                        }

                        if (entry.fileStatuses) {
                            entry.fileName = Arrays.filterMap(entry.fileStatuses,
                                f => !!f.fileName ? f.fileName : undefined).join(', ');
                        }
                    }
                    else {
                        lines.next();
                        next = lines.next();

                        line = next.value;

                        entry.status = line[0] as GitStatusFileStatus;
                        entry.fileName = line.substring(1);
                        this.parseFileName(entry);
                    }

                    if (first && repoPath === undefined && type === GitCommitType.File && fileName !== undefined) {
                        // Try to get the repoPath from the most recent commit
                        repoPath = Git.normalizePath(fileName.replace(fileName.startsWith('/') ? `/${entry.fileName}` : entry.fileName!, ''));
                        relativeFileName = Git.normalizePath(path.relative(repoPath, fileName));
                    }
                    else {
                        relativeFileName = entry.fileName!;
                    }
                    first = false;

                    const commit = commits.get(entry.sha);
                    if (commit === undefined) {
                        i++;
                    }
                    recentCommit = GitLogParser.parseEntry(entry, commit, type, repoPath, relativeFileName, commits, authors, recentCommit);

                    entry = undefined;
                    break;
            }

            if (next!.done) break;

        }

        return {
            repoPath: repoPath,
            authors: authors,
            commits: commits,
            sha: sha,
            count: i,
            maxCount: maxCount,
            range: range,
            truncated: !!(maxCount && i >= maxCount)
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

            commit = new GitLogCommit(type, repoPath!, entry.sha, relativeFileName, entry.author, new Date(entry.authorDate! as any * 1000), entry.summary!, entry.status, entry.fileStatuses, undefined, entry.originalFileName);
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
            if (type === GitCommitType.File) {
                recentCommit.previousFileName = commit.originalFileName || commit.fileName;
                commit.nextFileName = recentCommit.originalFileName || recentCommit.fileName;
            }
        }
        return commit;
    }

    private static parseFileName(entry: { fileName?: string, originalFileName?: string }) {
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