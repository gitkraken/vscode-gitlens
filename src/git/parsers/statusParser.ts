'use strict';
import { Git, GitStatus, GitStatusFile, GitStatusFileStatus } from './../git';

const aheadStatusV1Regex = /(?:ahead ([0-9]+))/;
const behindStatusV1Regex = /(?:behind ([0-9]+))/;

export class GitStatusParser {

    static parse(data: string, repoPath: string, porcelainVersion: number): GitStatus | undefined {
        if (!data) return undefined;

        const lines = data.split('\n').filter(_ => !!_);
        if (lines.length === 0) return undefined;

        const status = {
            branch: '',
            repoPath: Git.normalizePath(repoPath),
            sha: '',
            state: {
                ahead: 0,
                behind: 0
            },
            files: []
        };

        if (porcelainVersion >= 2) {
            this._parseV2(lines, repoPath, status);
        }
        else {
            this._parseV1(lines, repoPath, status);
        }

        return status;
    }

    private static _parseV1(lines: string[], repoPath: string, status: GitStatus) {
        let position = -1;
        while (++position < lines.length) {
            const line = lines[position];
            // Header
            if (line.startsWith('##')) {
                const lineParts = line.split(' ');
                [status.branch, status.upstream] = lineParts[1].split('...');
                if (lineParts.length > 2) {
                    const upstreamStatus = lineParts.slice(2).join(' ');

                    const aheadStatus = aheadStatusV1Regex.exec(upstreamStatus);
                    status.state.ahead = aheadStatus == null ? 0 : +aheadStatus[1] || 0;

                    const behindStatus = behindStatusV1Regex.exec(upstreamStatus);
                    status.state.behind = behindStatus == null ? 0 : +behindStatus[1] || 0;
                }
            }
            else {
                const rawStatus = line.substring(0, 2);
                const fileName = line.substring(3);
                if (rawStatus[0] === 'R') {
                    const [file1, file2] = fileName.replace(/\"/g, '').split('->');
                    status.files.push(this.parseStatusFile(repoPath, rawStatus, file2.trim(), file1.trim()));
                }
                else {
                    status.files.push(this.parseStatusFile(repoPath, rawStatus, fileName));
                }
            }
        }
    }

    private static _parseV2(lines: string[], repoPath: string, status: GitStatus) {
        let position = -1;
        while (++position < lines.length) {
            const line = lines[position];
            // Headers
            if (line.startsWith('#')) {
                const lineParts = line.split(' ');
                switch (lineParts[1]) {
                    case 'branch.oid':
                        status.sha = lineParts[2];
                        break;
                    case 'branch.head':
                        status.branch = lineParts[2];
                        break;
                    case 'branch.upstream':
                        status.upstream = lineParts[2];
                        break;
                    case 'branch.ab':
                        status.state.ahead = +lineParts[2].substring(1);
                        status.state.behind = +lineParts[3].substring(1);
                        break;
                }
            }
            else {
                const lineParts = line.split(' ');
                switch (lineParts[0][0]) {
                    case '1': // normal
                        status.files.push(this.parseStatusFile(repoPath, lineParts[1], lineParts.slice(8).join(' ')));
                        break;
                    case '2': // rename
                        const file = lineParts.slice(9).join(' ').split('\t');
                        status.files.push(this.parseStatusFile(repoPath, lineParts[1], file[0], file[1]));
                        break;
                    case 'u': // unmerged
                        status.files.push(this.parseStatusFile(repoPath, lineParts[1], lineParts.slice(10).join(' ')));
                        break;
                    case '?': // untracked
                        status.files.push(this.parseStatusFile(repoPath, ' ?', lineParts.slice(1).join(' ')));
                        break;
                }
            }
        }
    }

    static parseStatusFile(repoPath: string, rawStatus: string, fileName: string, originalFileName?: string): GitStatusFile {
        const indexStatus = rawStatus[0] !== '.' ? rawStatus[0].trim() : undefined;
        const workTreeStatus = rawStatus[1] !== '.' ? rawStatus[1].trim() : undefined;

        return new GitStatusFile(
            repoPath,
            (indexStatus || workTreeStatus || '?') as GitStatusFileStatus,
            workTreeStatus as GitStatusFileStatus,
            indexStatus as GitStatusFileStatus,
            fileName,
            !!indexStatus,
            originalFileName);
    }
}