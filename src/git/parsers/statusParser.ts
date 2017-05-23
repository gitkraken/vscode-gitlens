'use strict';
import { Git, GitStatusFile, GitStatusFileStatus, IGitStatus } from './../git';

interface IFileStatusEntry {
    staged: boolean;
    status: GitStatusFileStatus;
    fileName: string;
    originalFileName: string;
}

const aheadStatusV1Regex = /(?:ahead ([0-9]+))/;
const behindStatusV1Regex = /(?:behind ([0-9]+))/;

export class GitStatusParser {

    static parse(data: string, repoPath: string, porcelainVersion: number): IGitStatus | undefined {
        if (!data) return undefined;

        const lines = data.split('\n').filter(_ => !!_);
        if (!lines.length) return undefined;

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

    private static _parseV1(lines: string[], repoPath: string, status: IGitStatus) {
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
                let entry: IFileStatusEntry;
                const rawStatus = line.substring(0, 2);
                const fileName = line.substring(3);
                if (rawStatus[0] === 'R') {
                    const [file1, file2] = fileName.replace(/\"/g, '').split('->');
                    entry = this._parseFileEntry(rawStatus, file2.trim(), file1.trim());
                }
                else {
                    entry = this._parseFileEntry(rawStatus, fileName);
                }
                status.files.push(new GitStatusFile(repoPath, entry.status, entry.fileName, entry.staged, entry.originalFileName));
            }
        }
    }

    private static _parseV2(lines: string[], repoPath: string, status: IGitStatus) {
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
                let entry: IFileStatusEntry | undefined = undefined;
                switch (lineParts[0][0]) {
                    case '1': // normal
                        entry = this._parseFileEntry(lineParts[1], lineParts.slice(8).join(' '));
                        break;
                    case '2': // rename
                        const file = lineParts.slice(9).join(' ').split('\t');
                        entry = this._parseFileEntry(lineParts[1], file[0], file[1]);
                        break;
                    case 'u': // unmerged
                        entry = this._parseFileEntry(lineParts[1], lineParts.slice(10).join(' '));
                        break;
                    case '?': // untracked
                        entry = this._parseFileEntry(' ?', lineParts.slice(1).join(' '));
                        break;
                }

                if (entry !== undefined) {
                    status.files.push(new GitStatusFile(repoPath, entry.status, entry.fileName, entry.staged, entry.originalFileName));
                }
            }
        }
    }

    private static _parseFileEntry(rawStatus: string, fileName: string, originalFileName?: string): IFileStatusEntry {
        const indexStatus = rawStatus[0] !== '.' ? rawStatus[0].trim() : undefined;
        const workTreeStatus = rawStatus[1] !== '.' ? rawStatus[1].trim() : undefined;

        return {
            status: (indexStatus || workTreeStatus || '?') as GitStatusFileStatus,
            fileName: fileName,
            originalFileName: originalFileName,
            staged: !!indexStatus
        } as IFileStatusEntry;
    }
}