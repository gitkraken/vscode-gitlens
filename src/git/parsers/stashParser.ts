'use strict';
import { Arrays, Strings } from '../../system';
import { GitCommitType, GitLogParser, GitStash, GitStashCommit, GitStatusFileStatus, IGitStatusFile } from './../git';
// import { Logger } from '../../logger';

interface StashEntry {
    ref?: string;
    date?: string;
    fileNames?: string;
    fileStatuses?: IGitStatusFile[];
    summary?: string;
    stashName?: string;
}

const emptyEntry: StashEntry = {};

export class GitStashParser {
    static parse(data: string, repoPath: string): GitStash | undefined {
        if (!data) return undefined;

        const lines = Strings.lines(data + '</f>');
        // Skip the first line since it will always be </f>
        let next = lines.next();
        if (next.done) return undefined;

        if (repoPath !== undefined) {
            repoPath = Strings.normalizePath(repoPath);
        }

        const commits: Map<string, GitStashCommit> = new Map();

        let entry: StashEntry = emptyEntry;
        let line: string | undefined = undefined;
        let token: number;

        while (true) {
            next = lines.next();
            if (next.done) break;

            line = next.value;

            // <<1-char token>> <data>
            // e.g. <r> bd1452a2dc
            token = line.charCodeAt(1);

            switch (token) {
                case 114: // 'r': // ref
                    entry = {
                        ref: line.substring(4)
                    };
                    break;

                case 100: // 'd': // author-date
                    entry.date = line.substring(4);
                    break;

                case 108: // 'l': // reflog-selector
                    entry.stashName = line.substring(4);
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

                    if (entry.summary !== undefined) {
                        // Remove the trailing newline
                        entry.summary = entry.summary.slice(0, -1);
                    }
                    break;

                case 102: // 'f': // files
                    // Skip the blank line git adds before the files
                    next = lines.next();
                    if (!next.done && next.value !== '</f>') {
                        while (true) {
                            next = lines.next();
                            if (next.done) break;

                            line = next.value;
                            if (line === '</f>') break;

                            if (line.startsWith('warning:')) continue;

                            const status = {
                                status: line[0] as GitStatusFileStatus,
                                fileName: line.substring(1),
                                originalFileName: undefined
                            } as IGitStatusFile;
                            GitLogParser.parseFileName(status);

                            if (status.fileName) {
                                if (entry.fileStatuses === undefined) {
                                    entry.fileStatuses = [];
                                }
                                entry.fileStatuses.push(status);
                            }
                        }

                        if (entry.fileStatuses !== undefined) {
                            entry.fileNames = Arrays.filterMap(
                                entry.fileStatuses,
                                f => (!!f.fileName ? f.fileName : undefined)
                            ).join(', ');
                        }
                    }

                    let commit = commits.get(entry.ref!);
                    commit = GitStashParser.parseEntry(entry, commit, repoPath, commits);
            }
        }

        return {
            repoPath: repoPath,
            commits: commits
        } as GitStash;
    }

    private static parseEntry(
        entry: StashEntry,
        commit: GitStashCommit | undefined,
        repoPath: string,
        commits: Map<string, GitStashCommit>
    ): GitStashCommit | undefined {
        if (commit === undefined) {
            commit = new GitStashCommit(
                GitCommitType.Stash,
                entry.stashName!,
                repoPath,
                entry.ref!,
                new Date((entry.date! as any) * 1000),
                entry.summary === undefined ? '' : entry.summary,
                entry.fileNames!,
                entry.fileStatuses || []
            );
        }

        commits.set(entry.ref!, commit);
        return commit;
    }
}
