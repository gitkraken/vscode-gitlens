import type { Uri } from 'vscode';
import type { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { pluralize } from '../../system/string';
import type { DiffRange } from '../gitProvider';
import type { GitFileStatus } from './fileStatus';
import { GitFileConflictStatus } from './fileStatus';

export function isGitFileChange(file: unknown): file is GitFileChange {
	return file instanceof GitFileChange;
}

export interface GitFileChangeShape {
	readonly repoPath: string;
	readonly path: string;
	readonly status: GitFileStatus;

	readonly originalPath?: string | undefined;
	readonly staged?: boolean;
}

export class GitFileChange implements GitFileChangeShape {
	constructor(
		private readonly container: Container,
		public readonly repoPath: string,
		public readonly path: string,
		public readonly status: GitFileStatus,
		public readonly originalPath?: string | undefined,
		public readonly previousSha?: string | undefined,
		public readonly stats?: GitFileChangeStats | undefined,
		public readonly staged?: boolean,
		public readonly range?: DiffRange | undefined,
	) {}

	get hasConflicts(): boolean {
		switch (this.status) {
			case GitFileConflictStatus.AddedByThem:
			case GitFileConflictStatus.AddedByUs:
			case GitFileConflictStatus.AddedByBoth:
			case GitFileConflictStatus.DeletedByThem:
			case GitFileConflictStatus.DeletedByUs:
			case GitFileConflictStatus.DeletedByBoth:
			case GitFileConflictStatus.ModifiedByBoth:
				return true;

			default:
				return false;
		}
	}

	@memoize()
	get uri(): Uri {
		return this.container.git.getAbsoluteUri(this.path, this.repoPath);
	}

	@memoize()
	get originalUri(): Uri | undefined {
		return this.originalPath ? this.container.git.getAbsoluteUri(this.originalPath, this.repoPath) : undefined;
	}

	@memoize()
	getWorkingUri(): Promise<Uri | undefined> {
		return this.container.git.getRepositoryService(this.repoPath).getWorkingUri(this.uri);
	}

	formatStats(
		style: 'short' | 'stats' | 'expanded',
		options?: {
			color?: boolean;
			empty?: string;
			prefix?: string;
			separator?: string;
		},
	): string {
		const { stats } = this;
		if (stats == null) return options?.empty ?? '';

		const { /*changes,*/ additions, deletions } = stats;
		if (/*changes < 0 && */ additions < 0 && deletions < 0) return options?.empty ?? '';

		const separator = options?.separator ?? ' ';

		const lineStats = [];

		if (additions) {
			const additionsText = style === 'expanded' ? `${pluralize('line', additions)} added` : `+${additions}`;
			if (options?.color && style !== 'short') {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-addedResourceForeground);">${additionsText}</span>`,
				);
			} else {
				lineStats.push(additionsText);
			}
		} else if (style === 'stats') {
			if (options?.color) {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-addedResourceForeground);">+0</span>`,
				);
			} else {
				lineStats.push('+0');
			}
		}

		// if (changes) {
		// 	const changesText = style === 'expanded' ? `${pluralize('line', changes)} changed` : `~${changes}`;
		// 	if (options?.color && style !== 'short') {
		// 		lineStats.push(
		// 			/*html*/ `<span style="color:var(--vscode-gitDecoration-modifiedResourceForeground)">${changesText}</span>`,
		// 		);
		// 	} else {
		// 		lineStats.push(changesText);
		// 	}
		// } else if (style === 'stats') {
		// 	if (options?.color) {
		// 		lineStats.push(
		// 			/*html*/ `<span style="color:var(--vscode-gitDecoration-modifiedResourceForeground)">~0</span>`,
		// 		);
		// 	} else {
		// 		lineStats.push('~0');
		// 	}
		// }
		if (deletions) {
			const deletionsText = style === 'expanded' ? `${pluralize('line', deletions)} deleted` : `-${deletions}`;
			if (options?.color && style !== 'short') {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">${deletionsText}</span>`,
				);
			} else {
				lineStats.push(deletionsText);
			}
		} else if (style === 'stats') {
			if (options?.color) {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">-0</span>`,
				);
			} else {
				lineStats.push('-0');
			}
		}

		let result = lineStats.join(separator);
		if (style === 'stats' && options?.color) {
			result = /*html*/ `<span style="background-color:var(--vscode-textCodeBlock-background);border-radius:3px;">&nbsp;${result}&nbsp;&nbsp;</span>`;
		}

		return `${options?.prefix ?? ''}${result}`;
	}
}

export interface GitFileChangeStats {
	additions: number;
	deletions: number;
	changes: number;
}
