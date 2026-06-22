/* eslint-disable no-template-curly-in-string -- descriptor data contains literal GitLens format tokens */
import type { SettingsCategory } from '../model.js';

export const editorCategories: SettingsCategory[] = [
	{
		id: 'file-annotations',
		settingsSearch: 'gitlens.fileAnnotations',
		name: 'File Annotations',
		group: 'In-editor',
		icon: 'eye',
		hint: 'Customize on-demand blame, changes, or heatmap annotations for the whole file',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#file-annotations',
		controls: [
			{
				kind: 'check',
				key: 'fileAnnotations.dismissOnEscape',
				label: 'Use Esc key to dismiss the active file annotations',
			},
			{
				kind: 'check',
				key: 'fileAnnotations.preserveWhileEditing',
				label: 'Preserve file annotations while editing',
				hint: 'Annotations will be shown from the last saved version',
			},
			{
				kind: 'number',
				key: 'advanced.blame.delayAfterEdit',
				label: 'After unsaved changes, pause recomputing annotations for (ms)',
				placeholder: '5000',
				defaultValue: '5000',
				hint: 'Smaller delays will provide a better experience but will have a greater performance impact. Also applies to inline blame annotations',
			},
			{
				kind: 'number',
				key: 'advanced.blame.sizeThresholdAfterEdit',
				label: "After unsaved changes, don't recompute annotations on files with more than (lines)",
				placeholder: '5000',
				defaultValue: '5000',
				hint: 'Files larger than the threshold will only be recomputed when saved. Also applies to inline blame annotations',
			},
		],
	},
	{
		id: 'blame',
		settingsSearch: 'gitlens.blame',
		name: 'File Blame',
		group: 'In-editor',
		icon: 'git-commit',
		hint: 'Adds on-demand blame annotations for the whole file',
		command: { label: 'GitLens: Toggle File Blame Annotations', command: 'gitlens.toggleFileBlame' },
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#file-blame',
		preview: 'fileblame',
		controls: [
			{
				kind: 'select',
				key: 'blame.toggleMode',
				label: 'Toggle annotations',
				options: [
					{ value: 'file', label: 'individually for each file' },
					{ value: 'window', label: 'for all files' },
				],
			},
			{
				kind: 'text',
				key: 'blame.format',
				label: 'Annotation format',
				placeholder: '${message|50?} ${agoOrDate|14-}',
				defaultValue: '${message|50?} ${agoOrDate|14-}',
				preview: { type: 'commit', default: '${message|50?} ${agoOrDate|14-}' },
				tokens: true,
			},
			{
				kind: 'check',
				key: 'blame.heatmap.enabled',
				label: 'Add a heatmap (age) indicator to show how recently lines were changed',
				hint: 'Indicator color reflects the age of the most recent change (hot or cold), while indicator brightness ranges from bright (newer) to dim (older) based on the relative age',
			},
			{
				kind: 'segmented',
				key: 'blame.heatmap.location',
				label: 'Position the heatmap on the',
				options: [
					{ value: 'left', label: 'left' },
					{ value: 'right', label: 'right' },
				],
				enabledWhen: 'blame.heatmap.enabled',
				indent: true,
			},
			{
				kind: 'check',
				key: 'blame.avatars',
				label: 'Add author avatars',
			},
			{
				kind: 'check',
				key: 'blame.compact',
				label: 'Use compact view',
				hint: 'Compacts (deduplicates) matching adjacent blame annotations',
			},
			{
				kind: 'check',
				key: 'blame.highlight.enabled',
				label: 'Highlight other lines changed by the same commit as the current line',
			},
			{
				kind: 'checkgroup',
				key: 'blame.highlight.locations',
				label: '',
				options: [
					{ value: 'gutter', label: 'Add gutter indicator' },
					{ value: 'line', label: 'Add line highlight' },
					{ value: 'overview', label: 'Add scroll bar indicator' },
				],
				enabledWhen: 'blame.highlight.enabled',
				indent: true,
			},
		],
	},
	{
		id: 'changes',
		settingsSearch: 'gitlens.changes',
		name: 'File Changes',
		group: 'In-editor',
		icon: 'git-compare',
		hint: 'Adds on-demand file changes annotations to highlight any local (unpublished) changes or lines changed by the most recent commit',
		command: { label: 'GitLens: Toggle File Changes Annotations', command: 'gitlens.toggleFileChanges' },
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#gutter-changes',
		preview: 'filechanges',
		controls: [
			{
				kind: 'select',
				key: 'changes.toggleMode',
				label: 'Toggle annotations',
				options: [
					{ value: 'file', label: 'individually for each file' },
					{ value: 'window', label: 'for all files' },
				],
			},
			{
				kind: 'checkgroup',
				key: 'changes.locations',
				label: '',
				options: [
					{ value: 'gutter', label: 'Add gutter indicator' },
					{ value: 'line', label: 'Add line highlight' },
					{ value: 'overview', label: 'Add scroll bar indicator' },
				],
			},
		],
	},
	{
		id: 'heatmap',
		settingsSearch: 'gitlens.heatmap',
		name: 'File Heatmap',
		group: 'In-editor',
		icon: 'history',
		hint: 'Adds on-demand heatmap (age) indicators to the file to show how recently lines were changed',
		command: { label: 'GitLens: Toggle File Heatmap Annotations', command: 'gitlens.toggleFileHeatmap' },
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#gutter-heatmap',
		preview: 'heatmap',
		controls: [
			{
				kind: 'info',
				text: 'Indicator color reflects the age of the most recent change (hot or cold), while indicator brightness ranges from bright (newer) to dim (older) based on the relative age',
			},
			{
				kind: 'select',
				key: 'heatmap.toggleMode',
				label: 'Toggle annotations',
				options: [
					{ value: 'file', label: 'individually for each file' },
					{ value: 'window', label: 'for all files' },
				],
			},
			{
				kind: 'checkgroup',
				key: 'heatmap.locations',
				label: '',
				options: [
					{ value: 'gutter', label: 'Add gutter indicator' },
					{ value: 'line', label: 'Add line highlight' },
					{ value: 'overview', label: 'Add scroll bar indicator' },
				],
			},
			{
				kind: 'check',
				key: 'heatmap.fadeLines',
				label: 'Fade out older lines',
			},
			{
				kind: 'number',
				key: 'heatmap.ageThreshold',
				label: 'Hot/cold threshold (days)',
				placeholder: '90',
				defaultValue: '90',
			},
		],
	},
];
