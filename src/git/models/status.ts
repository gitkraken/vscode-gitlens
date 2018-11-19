'use strict';
import { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitBranch } from './branch';
import { GitFile, GitFileStatus } from './file';

export interface GitStatusUpstreamState {
    ahead: number;
    behind: number;
}

export class GitStatus {
    readonly detached: boolean;

    constructor(
        public readonly repoPath: string,
        public readonly branch: string,
        public readonly sha: string,
        public readonly files: GitStatusFile[],
        public readonly state: GitStatusUpstreamState,
        public readonly upstream?: string
    ) {
        this.detached = GitBranch.isDetached(branch);
        if (this.detached) {
            this.branch = GitBranch.formatDetached(this.sha);
        }
    }

    get ref() {
        return this.detached ? this.sha : this.branch;
    }

    private _diff?: {
        added: number;
        deleted: number;
        changed: number;
    };

    getDiffStatus() {
        if (this._diff === undefined) {
            this._diff = {
                added: 0,
                deleted: 0,
                changed: 0
            };

            if (this.files.length !== 0) {
                for (const f of this.files) {
                    switch (f.status) {
                        case 'A':
                        case '?':
                            this._diff.added++;
                            break;
                        case 'D':
                            this._diff.deleted++;
                            break;
                        default:
                            this._diff.changed++;
                            break;
                    }
                }
            }
        }

        return this._diff;
    }

    getFormattedDiffStatus(
        options: {
            compact?: boolean;
            empty?: string;
            expand?: boolean;
            prefix?: string;
            separator?: string;
            suffix?: string;
        } = {}
    ): string {
        const { added, changed, deleted } = this.getDiffStatus();
        if (added === 0 && changed === 0 && deleted === 0) return options.empty || '';

        const { compact, expand, prefix = '', separator = ' ', suffix = '' } = options;
        if (expand) {
            let status = '';
            if (added) {
                status += `${Strings.pluralize('file', added)} added`;
            }
            if (changed) {
                status += `${status === '' ? '' : separator}${Strings.pluralize('file', changed)} changed`;
            }
            if (deleted) {
                status += `${status === '' ? '' : separator}${Strings.pluralize('file', deleted)} deleted`;
            }
            return `${prefix}${status}${suffix}`;
        }

        return `${prefix}${compact && added === 0 ? '' : `+${added}${separator}`}${
            compact && changed === 0 ? '' : `~${changed}${separator}`
        }${compact && deleted === 0 ? '' : `-${deleted}`}${suffix}`;
    }

    getUpstreamStatus(options: {
        empty?: string;
        expand?: boolean;
        prefix?: string;
        separator?: string;
        suffix?: string;
    }): string {
        return GitStatus.getUpstreamStatus(this.upstream, this.state, options);
    }

    static getUpstreamStatus(
        upstream: string | undefined,
        state: { ahead: number; behind: number },
        options: { empty?: string; expand?: boolean; prefix?: string; separator?: string; suffix?: string } = {}
    ): string {
        if (upstream === undefined || (state.behind === 0 && state.ahead === 0)) return options.empty || '';

        const { expand, prefix = '', separator = ' ', suffix = '' } = options;
        if (expand) {
            let status = '';
            if (state.behind) {
                status += `${Strings.pluralize('commit', state.behind)} behind`;
            }
            if (state.ahead) {
                status += `${status === '' ? '' : separator}${Strings.pluralize('commit', state.ahead)} ahead`;
            }
            return `${prefix}${status}${suffix}`;
        }

        return `${prefix}${state.behind}${GlyphChars.ArrowDown}${separator}${state.ahead}${
            GlyphChars.ArrowUp
        }${suffix}`;
    }
}

export class GitStatusFile implements GitFile {
    constructor(
        public readonly repoPath: string,
        public readonly indexStatus: GitFileStatus | undefined,
        public readonly workingTreeStatus: GitFileStatus | undefined,
        public readonly fileName: string,
        public readonly originalFileName?: string
    ) {}

    get status(): GitFileStatus {
        return (this.indexStatus || this.workingTreeStatus || '?') as GitFileStatus;
    }

    get staged() {
        return this.indexStatus !== undefined;
    }

    get uri(): Uri {
        return GitUri.resolveToUri(this.fileName, this.repoPath);
    }

    getFormattedDirectory(includeOriginal: boolean = false): string {
        return GitFile.getFormattedDirectory(this, includeOriginal);
    }

    getFormattedPath(options: { relativeTo?: string; separator?: string; suffix?: string } = {}): string {
        return GitFile.getFormattedPath(this, options);
    }

    getOcticon() {
        return GitFile.getStatusOcticon(this.status);
    }

    getStatusText(file: GitFile): string {
        return GitFile.getStatusText(this.status);
    }

    with(changes: {
        indexStatus?: GitFileStatus | null;
        workTreeStatus?: GitFileStatus | null;
        fileName?: string;
        originalFileName?: string | null;
    }): GitStatusFile {
        return new GitStatusFile(
            this.repoPath,
            this.getChangedValue(changes.indexStatus, this.indexStatus) as GitFileStatus,
            this.getChangedValue(changes.workTreeStatus, this.workingTreeStatus) as GitFileStatus,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.originalFileName, this.originalFileName)
        );
    }

    protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
        if (change === undefined) return original;
        return change !== null ? change : undefined;
    }
}
