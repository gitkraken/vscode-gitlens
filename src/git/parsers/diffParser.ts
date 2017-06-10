'use strict';
import { Iterables, Strings } from '../../system';
import { GitDiff, GitDiffChunk, GitDiffLine } from './../git';

const unifiedDiffRegex = /^@@ -([\d]+),([\d]+) [+]([\d]+),([\d]+) @@([\s\S]*?)(?=^@@)/gm;

export class GitDiffParser {

    static parse(data: string, debug: boolean = false): GitDiff | undefined {
        if (!data) return undefined;

        const chunks: GitDiffChunk[] = [];

        let match: RegExpExecArray | null = null;

        let chunk: string;
        let currentStart: number;
        let previousStart: number;

        do {
            match = unifiedDiffRegex.exec(`${data}\n@@`);
            if (match == null) break;

            // Stops excessive memory usage
            // https://bugs.chromium.org/p/v8/issues/detail?id=2869
            chunk = (' ' + match[5]).substr(1);
            currentStart = parseInt(match[3], 10);
            previousStart = parseInt(match[1], 10);

            chunks.push(new GitDiffChunk(chunk, { start: currentStart, end: currentStart + parseInt(match[4], 10) }, { start: previousStart, end: previousStart + parseInt(match[2], 10) }));
        } while (match != null);

        if (!chunks.length) return undefined;

        const diff = {
            diff: debug ? data : undefined,
            chunks: chunks
        } as GitDiff;
        return diff;
    }

    static parseChunk(chunk: string): [(GitDiffLine | undefined)[], (GitDiffLine | undefined)[]] {
        const lines = Iterables.skip(Strings.lines(chunk), 1);

        const current: (GitDiffLine | undefined)[] = [];
        const previous: (GitDiffLine | undefined)[] = [];
        for (const l of lines) {
            switch (l[0]) {
                case '+':
                    current.push({
                        line: ` ${l.substring(1)}`,
                        state: 'added'
                    });
                    previous.push(undefined);
                    break;

                case '-':
                    current.push(undefined);
                    previous.push({
                        line: ` ${l.substring(1)}`,
                        state: 'removed'
                    });
                    break;

                default:
                    current.push({ line: l, state: 'unchanged' });
                    previous.push({ line: l, state: 'unchanged' });
                    break;
            }
        }

        return [current, previous];
    }
}