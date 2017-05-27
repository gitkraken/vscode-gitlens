'use strict';
import { IGitDiff, IGitDiffChunk } from './../git';

const unifiedDiffRegex = /^@@ -([\d]+),([\d]+) [+]([\d]+),([\d]+) @@([\s\S]*?)(?=^@@)/gm;

export class GitDiffParser {

    static parse(data: string, debug: boolean = false): IGitDiff | undefined {
        if (!data) return undefined;

        const chunks: IGitDiffChunk[] = [];

        let match: RegExpExecArray | null = null;
        do {
            match = unifiedDiffRegex.exec(`${data}\n@@`);
            if (match == null) break;

            const previousStart = +match[1];
            const currentStart = +match[3];

            const chunk = match[5];
            const lines = chunk.split('\n').slice(1);

            const current = [];
            const previous = [];
            for (const l of lines) {
                switch (l[0]) {
                    case '+':
                        current.push(` ${l.substring(1)}`);
                        previous.push(undefined);
                        break;

                    case '-':
                        current.push(undefined);
                        previous.push(` ${l.substring(1)}`);
                        break;

                    default:
                        current.push(l);
                        previous.push(l);
                        break;
                }
            }

            chunks.push({
                chunk: debug ? chunk : undefined,
                current: current,
                currentStart: currentStart,
                currentEnd: currentStart + +match[4],
                previous: previous,
                previousStart: previousStart,
                previousEnd: previousStart + +match[2]
            });
        } while (match != null);

        if (!chunks.length) return undefined;

        const diff = {
            diff: debug ? data : undefined,
            chunks: chunks
        } as IGitDiff;
        return diff;
    }
}