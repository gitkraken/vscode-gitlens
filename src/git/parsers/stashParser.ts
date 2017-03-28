'use strict';
import { Git, GitStashCommit, GitStatusFileStatus, IGitStash, IGitStatusFile } from './../git';
// import { Logger } from '../../logger';
import * as moment from 'moment';

interface IStashEntry {
    sha: string;
    date?: string;
    fileNames?: string;
    fileStatuses?: IGitStatusFile[];
    summary?: string;
    stashName?: string;
}

export class GitStashParser {

    private static _parseEntries(data: string): IStashEntry[] {
        if (!data) return undefined;

        const lines = data.split('\n');
        if (!lines.length) return undefined;

        const entries: IStashEntry[] = [];

        let entry: IStashEntry;
        let position = -1;
        while (++position < lines.length) {
            let lineParts = lines[position].split(' ');
            if (lineParts.length < 2) {
                continue;
            }

            if (!entry) {
                if (!Git.shaRegex.test(lineParts[0])) continue;

                entry = {
                    sha: lineParts[0]
                };

                continue;
            }

            switch (lineParts[0]) {
                case 'author-date':
                    entry.date = `${lineParts[1]}T${lineParts[2]}${lineParts[3]}`;
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

                case 'reflog-selector':
                    entry.stashName = lineParts.slice(1).join(' ').trim();
                    break;

                case 'filename':
                    const nextLine = lines[position + 1];
                    // If the next line isn't blank, make sure it isn't starting a new commit
                    if (nextLine && Git.shaRegex.test(nextLine)) continue;

                    position++;

                    while (++position < lines.length) {
                        const line = lines[position];
                        lineParts = line.split(' ');

                        if (Git.shaRegex.test(lineParts[0])) {
                            position--;
                            break;
                        }

                        if (entry.fileStatuses == null) {
                            entry.fileStatuses = [];
                        }

                        const status = {
                            status: line[0] as GitStatusFileStatus,
                            fileName: line.substring(1),
                            originalFileName: undefined as string
                        } as IGitStatusFile;
                        this._parseFileName(status);

                        entry.fileStatuses.push(status);
                    }

                    if (entry.fileStatuses) {
                        entry.fileNames = entry.fileStatuses.filter(_ => !!_.fileName).map(_ => _.fileName).join(', ');
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

    static parse(data: string, repoPath: string): IGitStash {
        const entries = this._parseEntries(data);
        if (!entries) return undefined;

        const commits: Map<string, GitStashCommit> = new Map();

        for (let i = 0, len = entries.length; i < len; i++) {
            const entry = entries[i];

            let commit = commits.get(entry.sha);
            if (!commit) {
                commit = new GitStashCommit(entry.stashName, repoPath, entry.sha, entry.fileNames, moment(entry.date).toDate(), entry.summary, undefined, entry.fileStatuses);
                commits.set(entry.sha, commit);
            }
        }

        return {
            repoPath: repoPath,
            commits: commits
        } as IGitStash;
    }

    private static _parseFileName(entry: { fileName?: string, originalFileName?: string }) {
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
}