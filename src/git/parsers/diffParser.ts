'use strict';
import { GitDiff, GitDiffHunk, GitDiffHunkLine, GitDiffLine, GitDiffShortStat, GitFile, GitFileStatus } from '../git';
import { debug, Strings } from '../../system';

const nameStatusDiffRegex = /^(.*?)\t(.*?)(?:\t(.*?))?$/gm;
const shortStatDiffRegex = /^\s*(\d+)\sfiles? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;
const unifiedDiffRegex = /^@@ -([\d]+)(?:,([\d]+))? \+([\d]+)(?:,([\d]+))? @@(?:.*?)\n([\s\S]*?)(?=^@@)/gm;

export class GitDiffParser {
    @debug({ args: false, singleLine: true })
    static parse(data: string, debug: boolean = false): GitDiff | undefined {
        if (!data) return undefined;

        const hunks: GitDiffHunk[] = [];

        let match: RegExpExecArray | null;
        let hunk;
        let currentStartStr;
        let currentStart;
        let currentCountStr;
        let currentCount;
        let previousStartStr;
        let previousStart;
        let previousCountStr;
        let previousCount;
        do {
            match = unifiedDiffRegex.exec(`${data}\n@@`);
            if (match == null) break;

            // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
            hunk = ` ${match[5]}`.substr(1);

            [, previousStartStr, previousCountStr, currentStartStr, currentCountStr] = match;
            previousStart = parseInt(previousStartStr, 10);
            previousCount = previousCountStr ? parseInt(previousCountStr, 10) : 0;
            currentStart = parseInt(currentStartStr, 10);
            currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;

            hunks.push(
                new GitDiffHunk(
                    hunk,
                    {
                        start: currentStart,
                        end: currentStart + currentCount
                    },
                    {
                        start: previousStart,
                        end: previousStart + previousCount
                    }
                )
            );
        } while (match != null);

        if (!hunks.length) return undefined;

        const diff: GitDiff = {
            diff: debug ? data : undefined,
            hunks: hunks
        };
        return diff;
    }

    @debug({ args: false, singleLine: true })
    static parseHunk(hunk: GitDiffHunk): GitDiffHunkLine[] {
        const currentLines: (GitDiffLine | undefined)[] = [];
        const previousLines: (GitDiffLine | undefined)[] = [];

        let removed = 0;
        for (const l of Strings.lines(hunk.diff)) {
            switch (l[0]) {
                case '+':
                    currentLines.push({
                        line: ` ${l.substring(1)}`,
                        state: 'added'
                    });

                    if (removed > 0) {
                        removed--;
                    }
                    else {
                        previousLines.push(undefined);
                    }

                    break;

                case '-':
                    removed++;

                    previousLines.push({
                        line: ` ${l.substring(1)}`,
                        state: 'removed'
                    });

                    break;

                default:
                    while (removed > 0) {
                        removed--;
                        currentLines.push(undefined);
                    }

                    currentLines.push({ line: l, state: 'unchanged' });
                    previousLines.push({ line: l, state: 'unchanged' });

                    break;
            }
        }

        while (removed > 0) {
            removed--;
            currentLines.push(undefined);
        }

        const hunkLines: GitDiffHunkLine[] = [];

        for (let i = 0; i < currentLines.length; i++) {
            hunkLines.push({
                hunk: hunk,
                current: currentLines[i],
                previous: previousLines[i]
            });
        }

        return hunkLines;
    }

    @debug({ args: false, singleLine: true })
    static parseNameStatus(data: string, repoPath: string): GitFile[] | undefined {
        if (!data) return undefined;

        const files: GitFile[] = [];

        let rawStatus: string;
        let fileName: string;
        let originalFileName: string;
        let match: RegExpExecArray | null = null;
        do {
            match = nameStatusDiffRegex.exec(data);
            if (match == null) break;

            [, rawStatus, fileName, originalFileName] = match;

            // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
            const status = ` ${rawStatus}`.substr(1);
            files.push({
                repoPath: repoPath,
                status: (status[0] !== '.' ? status[0].trim() : '?') as GitFileStatus,
                indexStatus: undefined,
                workingTreeStatus: undefined,
                // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                fileName: ` ${fileName}`.substr(1),
                // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                originalFileName: originalFileName === undefined ? undefined : ` ${originalFileName}`.substr(1)
            });
        } while (match != null);

        if (!files.length) return undefined;

        return files;
    }

    @debug({ args: false, singleLine: true })
    static parseShortStat(data: string): GitDiffShortStat | undefined {
        if (!data) return undefined;

        const match = shortStatDiffRegex.exec(data);
        if (match == null) return undefined;

        const [, files, insertions, deletions] = match;

        const diffShortStat: GitDiffShortStat = {
            files: files == null ? 0 : parseInt(files, 10),
            insertions: insertions == null ? 0 : parseInt(insertions, 10),
            deletions: deletions == null ? 0 : parseInt(deletions, 10)
        };
        return diffShortStat;
    }
}
