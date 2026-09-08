/* oxlint-disable no-template-curly-in-string -- descriptor data contains literal GitLens format tokens */
import * as l10n from '@vscode/l10n';
import type { SettingsCategory } from '../model.js';

export const editorCategories: SettingsCategory[] = [
	{
		id: 'blame',
		settingsSearch: 'gitlens.blame',
		name: l10n.t('File Blame'),
		group: 'Editor',
		icon: 'git-commit',
		hint: l10n.t('Adds on-demand blame annotations for the whole file'),
		command: { label: l10n.t('GitLens: Toggle File Blame Annotations'), command: 'gitlens.toggleFileBlame' },
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#file-blame',
		preview: 'fileblame',
		controls: [
			{
				kind: 'select',
				key: 'blame.toggleMode',
				label: l10n.t('Toggle annotations'),
				options: [
					{ value: 'file', label: l10n.t('individually for each file') },
					{ value: 'window', label: l10n.t('for all files') },
				],
			},
			{
				kind: 'text',
				key: 'blame.format',
				label: l10n.t('Annotation format'),
				placeholder: '${message|50?} ${agoOrDate|14-}',
				defaultValue: '${message|50?} ${agoOrDate|14-}',
				preview: { type: 'commit', default: '${message|50?} ${agoOrDate|14-}' },
				tokens: true,
			},
			{
				kind: 'number',
				key: 'advanced.blame.delayAfterEdit',
				label: l10n.t('After unsaved changes, pause recomputing annotations for (ms)'),
				placeholder: '5000',
				defaultValue: '5000',
				hint: l10n.t(
					'Smaller delays will provide a better experience but will have a greater performance impact. Also applies to inline blame annotations',
				),
			},
			{
				kind: 'number',
				key: 'advanced.blame.sizeThresholdAfterEdit',
				label: l10n.t("After unsaved changes, don't recompute annotations on files with more than (lines)"),
				placeholder: '5000',
				defaultValue: '5000',
				hint: l10n.t(
					'Files larger than the threshold will only be recomputed when saved. Also applies to inline blame annotations',
				),
			},
			{
				kind: 'check',
				key: 'blame.heatmap.enabled',
				label: l10n.t('Add a heatmap (age) indicator to show how recently lines were changed'),
				hint: l10n.t(
					'Indicator color reflects the age of the most recent change (hot or cold), while indicator brightness ranges from bright (newer) to dim (older) based on the relative age',
				),
			},
			{
				kind: 'segmented',
				key: 'blame.heatmap.location',
				label: l10n.t('Position the heatmap on the'),
				options: [
					{ value: 'left', label: l10n.t('left') },
					{ value: 'right', label: l10n.t('right') },
				],
				enabledWhen: 'blame.heatmap.enabled',
				indent: true,
			},
			{
				kind: 'check',
				key: 'blame.avatars',
				label: l10n.t('Add author avatars'),
			},
			{
				kind: 'check',
				key: 'blame.compact',
				label: l10n.t('Use compact view'),
				hint: l10n.t('Compacts (deduplicates) matching adjacent blame annotations'),
			},
			{
				kind: 'check',
				key: 'blame.highlight.enabled',
				label: l10n.t('Highlight other lines changed by the same commit as the current line'),
			},
			{
				kind: 'checkgroup',
				key: 'blame.highlight.locations',
				label: '',
				options: [
					{ value: 'gutter', label: l10n.t('Add gutter indicator') },
					{ value: 'line', label: l10n.t('Add line highlight') },
					{ value: 'overview', label: l10n.t('Add scroll bar indicator') },
				],
				enabledWhen: 'blame.highlight.enabled',
				indent: true,
			},
		],
	},
	{
		id: 'changes',
		settingsSearch: 'gitlens.changes',
		name: l10n.t('File Changes'),
		group: 'Editor',
		icon: 'git-compare',
		hint: l10n.t(
			'Adds on-demand file changes annotations to highlight any local (unpublished) changes or lines changed by the most recent commit',
		),
		command: { label: l10n.t('GitLens: Toggle File Changes Annotations'), command: 'gitlens.toggleFileChanges' },
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#gutter-changes',
		preview: 'filechanges',
		controls: [
			{
				kind: 'select',
				key: 'changes.toggleMode',
				label: l10n.t('Toggle annotations'),
				options: [
					{ value: 'file', label: l10n.t('individually for each file') },
					{ value: 'window', label: l10n.t('for all files') },
				],
			},
			{
				kind: 'checkgroup',
				key: 'changes.locations',
				label: '',
				options: [
					{ value: 'gutter', label: l10n.t('Add gutter indicator') },
					{ value: 'line', label: l10n.t('Add line highlight') },
					{ value: 'overview', label: l10n.t('Add scroll bar indicator') },
				],
			},
		],
	},
	{
		id: 'heatmap',
		settingsSearch: 'gitlens.heatmap',
		name: l10n.t('File Heatmap'),
		group: 'Editor',
		icon: 'history',
		hint: l10n.t('Adds on-demand heatmap (age) indicators to the file to show how recently lines were changed'),
		command: { label: l10n.t('GitLens: Toggle File Heatmap Annotations'), command: 'gitlens.toggleFileHeatmap' },
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#gutter-heatmap',
		preview: 'heatmap',
		controls: [
			{
				kind: 'info',
				text: l10n.t(
					'Indicator color reflects the age of the most recent change (hot or cold), while indicator brightness ranges from bright (newer) to dim (older) based on the relative age',
				),
			},
			{
				kind: 'select',
				key: 'heatmap.toggleMode',
				label: l10n.t('Toggle annotations'),
				options: [
					{ value: 'file', label: l10n.t('individually for each file') },
					{ value: 'window', label: l10n.t('for all files') },
				],
			},
			{
				kind: 'checkgroup',
				key: 'heatmap.locations',
				label: '',
				options: [
					{ value: 'gutter', label: l10n.t('Add gutter indicator') },
					{ value: 'line', label: l10n.t('Add line highlight') },
					{ value: 'overview', label: l10n.t('Add scroll bar indicator') },
				],
			},
			{
				kind: 'check',
				key: 'heatmap.fadeLines',
				label: l10n.t('Fade out older lines'),
			},
			{
				kind: 'number',
				key: 'heatmap.ageThreshold',
				label: l10n.t('Hot/cold threshold (days)'),
				placeholder: '90',
				defaultValue: '90',
			},
		],
	},
];
