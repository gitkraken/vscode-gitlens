import type { Uri } from 'vscode';
import { l10n } from 'vscode';
import type { GitFileChange, GitFileChangeStats } from '@gitlens/git/models/fileChange.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { Container } from '../../../container.js';

export function getFileChangeWorkingUri(file: GitFileChange): Promise<Uri | undefined> {
	return Container.instance.git.getRepositoryService(file.repoPath).getWorkingUri(file.uri);
}

export function formatFileChangeStats(
	stats: GitFileChangeStats | undefined,
	style: 'short' | 'stats' | 'expanded',
	options?: {
		color?: boolean;
		empty?: string;
		prefix?: string;
		separator?: string;
	},
): string {
	if (stats == null) return options?.empty ?? '';

	const { /*changes,*/ additions, deletions } = stats;
	if (/*changes < 0 && */ additions < 0 && deletions < 0) return options?.empty ?? '';

	const separator = options?.separator ?? ' ';
	const numericFormat = getNumericFormat();

	const lineStats = [];

	if (additions) {
		const additionsText =
			style === 'expanded'
				? additions === 1
					? l10n.t('{0} line added', numericFormat(additions))
					: l10n.t('{0} lines added', numericFormat(additions))
				: `+${additions}`;
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

	if (deletions) {
		const deletionsText =
			style === 'expanded'
				? deletions === 1
					? l10n.t('{0} line deleted', numericFormat(deletions))
					: l10n.t('{0} lines deleted', numericFormat(deletions))
				: `-${deletions}`;
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
