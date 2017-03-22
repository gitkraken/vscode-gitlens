'use strict';
import { Git, GitStatusFileStatus, GitStatusFile, IGitStatus } from './../git';

interface IFileStatusEntry {
    staged: boolean;
    status: GitStatusFileStatus;
    fileName: string;
    originalFileName: string;
}

export class GitStatusParser {

    static parse(data: string, repoPath: string): IGitStatus {
        if (!data) return undefined;

        const lines = data.split('\n').filter(_ => !!_);
        if (!lines.length) return undefined;

        const status = {
            repoPath: Git.normalizePath(repoPath),
            state: {
                ahead: 0,
                behind: 0
            },
            files: []
        } as IGitStatus;

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
                        status.state.ahead = +lineParts[2][1];
                        status.state.behind = +lineParts[3][1];
                        break;
                }
            }
            else {
                let lineParts = line.split(' ');
                let entry: IFileStatusEntry;
                switch (lineParts[0][0]) {
                    case '1': // normal
                        entry = this._parseFileEntry(lineParts[1], lineParts[8]);
                        break;
                    case '2': // rename
                        const file = lineParts[9].split('\t');
                        entry = this._parseFileEntry(lineParts[1], file[0], file[1]);
                        break;
                    case 'u': // unmerged
                        entry = this._parseFileEntry(lineParts[1], lineParts[10]);
                        break;
                    case '?': // untracked
                        entry = this._parseFileEntry(' ?', lineParts[1]);
                        break;
                }

                if (entry) {
                    status.files.push(new GitStatusFile(repoPath, entry.status, entry.staged, entry.fileName, entry.originalFileName));
                }
            }
        }

        return status;
    }

    private static _parseFileEntry(rawStatus: string, fileName: string, originalFileName?: string): IFileStatusEntry {
        const indexStatus = rawStatus[0] !== '.' ? rawStatus[0].trim() : undefined;
        const workTreeStatus = rawStatus[1] !== '.' ? rawStatus[1].trim() : undefined;

        return {
            status: (indexStatus || workTreeStatus || '?') as GitStatusFileStatus,
            fileName: fileName,
            originalFileName: originalFileName,
            staged: !!indexStatus
        };
    }
}