'use strict';
import { Strings } from '../../system';
import { GitFileStatus, GitStatus, GitStatusFile } from '../git';

const emptyStr = '';

const aheadStatusV1Regex = /(?:ahead ([0-9]+))/;
const behindStatusV1Regex = /(?:behind ([0-9]+))/;

export class GitStatusParser {
    static parse(data: string, repoPath: string, porcelainVersion: number): GitStatus | undefined {
        if (!data) return undefined;

        const lines = data.split('\n').filter(Boolean);
        if (lines.length === 0) return undefined;

        if (porcelainVersion < 2) return this.parseV1(lines, repoPath);

        return this.parseV2(lines, repoPath);
    }

    private static parseV1(lines: string[], repoPath: string): GitStatus {
        let branch: string | undefined;
        const files = [];
        const state = {
            ahead: 0,
            behind: 0
        };
        let upstream;

        let position = -1;
        while (++position < lines.length) {
            const line = lines[position];
            // Header
            if (line.startsWith('##')) {
                const lineParts = line.split(' ');
                [branch, upstream] = lineParts[1].split('...');
                if (lineParts.length > 2) {
                    const upstreamStatus = lineParts.slice(2).join(' ');

                    const aheadStatus = aheadStatusV1Regex.exec(upstreamStatus);
                    state.ahead = aheadStatus == null ? 0 : Number(aheadStatus[1]) || 0;

                    const behindStatus = behindStatusV1Regex.exec(upstreamStatus);
                    state.behind = behindStatus == null ? 0 : Number(behindStatus[1]) || 0;
                }
            }
            else {
                const rawStatus = line.substring(0, 2);
                const fileName = line.substring(3);
                if (rawStatus[0] === 'R') {
                    const [file1, file2] = fileName.replace(/"/g, emptyStr).split('->');
                    files.push(this.parseStatusFile(repoPath, rawStatus, file2.trim(), file1.trim()));
                }
                else {
                    files.push(this.parseStatusFile(repoPath, rawStatus, fileName));
                }
            }
        }

        return new GitStatus(Strings.normalizePath(repoPath), branch || emptyStr, emptyStr, files, state, upstream);
    }

    private static parseV2(lines: string[], repoPath: string): GitStatus {
        let branch: string | undefined;
        const files = [];
        let sha: string | undefined;
        const state = {
            ahead: 0,
            behind: 0
        };
        let upstream;

        let position = -1;
        while (++position < lines.length) {
            const line = lines[position];
            // Headers
            if (line.startsWith('#')) {
                const lineParts = line.split(' ');
                switch (lineParts[1]) {
                    case 'branch.oid':
                        sha = lineParts[2];
                        break;
                    case 'branch.head':
                        branch = lineParts[2];
                        break;
                    case 'branch.upstream':
                        upstream = lineParts[2];
                        break;
                    case 'branch.ab':
                        state.ahead = Number(lineParts[2].substring(1));
                        state.behind = Number(lineParts[3].substring(1));
                        break;
                }
            }
            else {
                const lineParts = line.split(' ');
                switch (lineParts[0][0]) {
                    case '1': // normal
                        files.push(this.parseStatusFile(repoPath, lineParts[1], lineParts.slice(8).join(' ')));
                        break;
                    case '2': {
                        // rename
                        const file = lineParts
                            .slice(9)
                            .join(' ')
                            .split('\t');
                        files.push(this.parseStatusFile(repoPath, lineParts[1], file[0], file[1]));
                        break;
                    }
                    case 'u': // unmerged
                        files.push(this.parseStatusFile(repoPath, lineParts[1], lineParts.slice(10).join(' ')));
                        break;
                    case '?': // untracked
                        files.push(this.parseStatusFile(repoPath, ' ?', lineParts.slice(1).join(' ')));
                        break;
                }
            }
        }

        return new GitStatus(
            Strings.normalizePath(repoPath),
            branch || emptyStr,
            sha || emptyStr,
            files,
            state,
            upstream
        );
    }

    static parseStatusFile(
        repoPath: string,
        rawStatus: string,
        fileName: string,
        originalFileName?: string
    ): GitStatusFile {
        let indexStatus = rawStatus[0] !== '.' ? rawStatus[0].trim() : undefined;
        if (indexStatus == null || indexStatus.length === 0) {
            indexStatus = undefined;
        }

        let workTreeStatus = undefined;
        if (rawStatus.length > 1) {
            workTreeStatus = rawStatus[1] !== '.' ? rawStatus[1].trim() : undefined;
            if (workTreeStatus == null || workTreeStatus.length === 0) {
                workTreeStatus = undefined;
            }
        }

        return new GitStatusFile(
            repoPath,
            indexStatus as GitFileStatus | undefined,
            workTreeStatus as GitFileStatus | undefined,
            fileName,
            originalFileName
        );
    }
}
