'use strict';
import { debug } from '../../system';
import { GitReflog } from '../models/reflog';

const incomingCommands = ['merge', 'pull'];
const reflogRegex = /^<r>(.+)<d>(?:.+?)@{(.+)}<s>(\w*).*$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;

export class GitReflogParser {
    static defaultFormat = [
        `${lb}r${rb}%H`, // ref
        `${lb}d${rb}%gD`, // reflog selector (with UNIX timestamp)
        `${lb}s${rb}%gs` // reflog subject
    ].join('');

    @debug({ args: false })
    static parseRecentIncomingChanges(data: string, repoPath: string): GitReflog | undefined {
        if (!data) return undefined;

        let reflog: GitReflog | undefined;

        let match: RegExpExecArray | null;
        let date;
        let ref;
        let command;

        do {
            match = reflogRegex.exec(data);
            if (match == null) break;

            [, ref, date, command] = match;

            // If we don't have a reflog, or are still at the same ref with a proper command, save it
            if (
                (reflog === undefined || (reflog !== undefined && ref === reflog.ref)) &&
                incomingCommands.includes(command)
            ) {
                reflog = new GitReflog(
                    repoPath,
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    ` ${ref}`.substr(1),
                    new Date((date! as any) * 1000),
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    ` ${command}`.substr(1)
                );
            }
            else if (reflog !== undefined && ref !== reflog.ref) {
                reflog.previousRef = ref;

                break;
            }
        } while (match != null);

        // Ensure the regex state is reset
        reflogRegex.lastIndex = 0;

        return reflog;
    }
}
