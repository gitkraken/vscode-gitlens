import * as l10n from '@vscode/l10n';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { escapeMarkdown } from '@gitlens/utils/markdown.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { TreeItemDecoration, TreeItemDecorationKind } from './base.js';

// Decodes Git's two-character unmerged status codes. The `U` placeholder is context-dependent:
// in `UA`/`AU` it means the side is absent; in `UD`/`DU`/`UU` it means the side has a modified version.
export function getConflictStatusInfo(
	status: GitFileConflictStatus,
	branchName?: string,
): { label: string; kind: TreeItemDecorationKind; description: string } | undefined {
	switch (status) {
		case 'UU':
			return {
				label: l10n.t('Modified (Both)'),
				kind: 'modified',
				description: branchName
					? l10n.t('Modified on both {branchIcon} {branch} and the target', {
							branchIcon: '$(git-branch)',
							branch: branchName,
						})
					: l10n.t('Modified on both incoming and the target'),
			};
		case 'AA':
			return {
				label: l10n.t('Added (Both)'),
				kind: 'added',
				description: branchName
					? l10n.t('Added on both {branchIcon} {branch} and the target', {
							branchIcon: '$(git-branch)',
							branch: branchName,
						})
					: l10n.t('Added on both incoming and the target'),
			};
		case 'DD':
			return {
				label: l10n.t('Deleted (Both)'),
				kind: 'deleted',
				description: branchName
					? l10n.t('Deleted on both {branchIcon} {branch} and the target', {
							branchIcon: '$(git-branch)',
							branch: branchName,
						})
					: l10n.t('Deleted on both incoming and the target'),
			};
		case 'AU':
			return {
				label: l10n.t('Added by Current'),
				kind: 'added',
				description: branchName
					? l10n.t(
							'Added on the target (conflict with {branchIcon} {branch} — possible rename or directory/file clash)',
							{ branchIcon: '$(git-branch)', branch: branchName },
						)
					: l10n.t('Added on the target (conflict with incoming — possible rename or directory/file clash)'),
			};
		case 'UA':
			return {
				label: l10n.t('Added by Incoming'),
				kind: 'added',
				description: branchName
					? l10n.t(
							'Added on {branchIcon} {branch} (conflict with the target — possible rename or directory/file clash)',
							{ branchIcon: '$(git-branch)', branch: branchName },
						)
					: l10n.t('Added on incoming (conflict with the target — possible rename or directory/file clash)'),
			};
		case 'UD':
			return {
				label: l10n.t('Modified (Current), Deleted (Incoming)'),
				kind: 'deleted',
				description: branchName
					? l10n.t('Deleted on {branchIcon} {branch}\nModified on the target', {
							branchIcon: '$(git-branch)',
							branch: branchName,
						})
					: l10n.t('Deleted on incoming\nModified on the target'),
			};
		case 'DU':
			return {
				label: l10n.t('Deleted (Current), Modified (Incoming)'),
				kind: 'deleted',
				description: branchName
					? l10n.t('Modified on {branchIcon} {branch}\nDeleted on the target', {
							branchIcon: '$(git-branch)',
							branch: branchName,
						})
					: l10n.t('Modified on incoming\nDeleted on the target'),
			};
		default:
			return undefined;
	}
}

function formatConflictCount(conflictCount: number): string {
	return formatPlural(l10n.t('{0, plural, one{{0} conflict} other{{0} conflicts}}'), [conflictCount]);
}

export function getConflictDecorations(
	conflictStatus: GitFileConflictStatus,
	conflictCount: number | undefined,
	branchName?: string,
): TreeItemDecoration[] | undefined {
	const info = getConflictStatusInfo(conflictStatus, branchName);
	const decorations: TreeItemDecoration[] = [];

	if (info != null) {
		decorations.push({
			type: 'text',
			label: conflictStatus,
			tooltip: info.description,
			kind: info.kind,
			position: 'after',
		});
		decorations.push({
			type: 'text',
			label: info.label,
			tooltip: info.label,
			kind: 'muted',
			position: 'before',
		});
	}

	if (conflictCount != null && conflictCount > 0) {
		const count = formatConflictCount(conflictCount);
		decorations.push({
			type: 'conflict',
			label: count,
			count: conflictCount,
			tooltip: count,
			kind: info?.kind ?? 'modified',
			position: 'before',
		});
	}

	return decorations.length ? decorations : undefined;
}

export function getConflictTooltip(
	conflictStatus: GitFileConflictStatus,
	conflictCount: number | undefined,
	branchName?: string,
): string {
	const info = getConflictStatusInfo(conflictStatus, branchName ? escapeMarkdown(branchName) : branchName);
	const parts: string[] = [];

	if (info != null) {
		parts.push(`**${info.label}** (${conflictStatus})`);
		parts.push(info.description);
	}

	if (conflictCount != null && conflictCount > 0) {
		parts.push(formatConflictCount(conflictCount));
	}

	return parts.join('\n\n');
}
