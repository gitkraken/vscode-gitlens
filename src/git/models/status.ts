'use strict';
import { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { memoize, Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitBranch, GitTrackingState } from './branch';
import { GitFile, GitFileStatus } from './file';

export class GitStatus {
	readonly detached: boolean;

	constructor(
		public readonly repoPath: string,
		public readonly branch: string,
		public readonly sha: string,
		public readonly files: GitStatusFile[],
		public readonly state: GitTrackingState,
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

	@memoize()
	getDiffStatus() {
		const diff = {
			added: 0,
			deleted: 0,
			changed: 0
		};

		if (this.files.length === 0) return diff;

		for (const f of this.files) {
			switch (f.status) {
				case 'A':
				case '?':
					diff.added++;
					break;
				case 'D':
					diff.deleted++;
					break;
				default:
					diff.changed++;
					break;
			}
		}

		return diff;
	}

	getFormattedDiffStatus({
		compact,
		empty,
		expand,
		prefix = '',
		separator = ' ',
		suffix = ''
	}: {
		compact?: boolean;
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	} = {}): string {
		const { added, changed, deleted } = this.getDiffStatus();
		if (added === 0 && changed === 0 && deleted === 0) return empty || '';

		if (expand) {
			let status = '';
			if (added) {
				status += `${Strings.pluralize('file', added)} added`;
			}
			if (changed) {
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('file', changed)} changed`;
			}
			if (deleted) {
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('file', deleted)} deleted`;
			}
			return `${prefix}${status}${suffix}`;
		}

		let status = '';
		if (compact) {
			if (added !== 0) {
				status += `+${added}`;
			}
			if (changed !== 0) {
				status += `${status.length === 0 ? '' : separator}~${changed}`;
			}
			if (deleted !== 0) {
				status += `${status.length === 0 ? '' : separator}-${deleted}`;
			}
		} else {
			status += `+${added}${separator}~${changed}${separator}-${deleted}`;
		}

		return `${prefix}${status}${suffix}`;
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
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('commit', state.ahead)} ahead`;
			}
			return `${prefix}${status}${suffix}`;
		}

		return `${prefix}${state.behind}${GlyphChars.ArrowDown}${separator}${state.ahead}${GlyphChars.ArrowUp}${suffix}`;
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
		return this.indexStatus ?? this.workingTreeStatus ?? '?';
	}

	get staged() {
		return this.indexStatus !== undefined;
	}

	@memoize()
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

	getStatusText(): string {
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
