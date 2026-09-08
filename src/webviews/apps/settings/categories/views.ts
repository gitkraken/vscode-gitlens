/* oxlint-disable no-template-curly-in-string -- descriptor data contains literal GitLens format tokens */
import * as l10n from '@vscode/l10n';
import type { CheckGroupOptionDescriptor, SettingsCategory } from '../model.js';

/** Shared by `graph.scrollMarkers.additionalTypes` and `graph.minimap.additionalTypes` — both mark the
 *  same 5 ref types, differing only in their trailing WIP/worktree-specific option. */
const sharedMarkerTypeOptions: CheckGroupOptionDescriptor[] = [
	{ value: 'localBranches', label: l10n.t('Local branches'), hint: l10n.t('Marks the location of local branches') },
	{
		value: 'remoteBranches',
		label: l10n.t('Remote branches'),
		hint: l10n.t('Marks the location of remote branches'),
	},
	{ value: 'pullRequests', label: l10n.t('Pull requests'), hint: l10n.t('Marks the location of pull requests') },
	{ value: 'stashes', label: l10n.t('Stashes'), hint: l10n.t('Marks the location of stashes') },
	{ value: 'tags', label: l10n.t('Tags'), hint: l10n.t('Marks the location of tags') },
];

export const viewsCategories: SettingsCategory[] = [
	{
		id: 'commit-graph',
		settingsSearch: 'gitlens.graph',
		name: l10n.t('Commit Graph'),
		group: 'Views',
		icon: 'gl-graph',
		hint: l10n.t('Adds a [Commit Graph]({command}) to visualize, explore, and manage a Git repository', {
			command: 'command:gitlens.showGraph',
		}),
		pro: true,
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-plus/#commit-graph',
		preview: 'graph',
		controls: [
			{
				kind: 'segmented',
				key: 'graph.layout',
				label: l10n.t('Prefer showing the Commit Graph'),
				options: [
					{ value: 'editor', label: l10n.t('in the editor area') },
					{ value: 'panel', label: l10n.t('as a view') },
				],
			},
			{
				kind: 'number',
				key: 'graph.defaultItemLimit',
				label: l10n.t('Show this many rows at first'),
				placeholder: '500',
				defaultValue: '500',
			},
			{
				kind: 'number',
				key: 'graph.pageItemLimit',
				label: l10n.t('Then page in this many more rows when scrolling'),
				placeholder: '200',
				defaultValue: '200',
			},
			{
				kind: 'number',
				key: 'graph.searchItemLimit',
				label: l10n.t('Show this many search results at first and when paging'),
				placeholder: '0',
				defaultValue: '0',
			},
			{
				kind: 'number',
				key: 'graph.scrollRowPadding',
				label: l10n.t('Start scrolling at this many rows from the edge'),
				placeholder: '0',
				defaultValue: '0',
			},
			{
				kind: 'check',
				key: 'graph.scrollMarkers.enabled',
				label: l10n.t('Show markers on the Commit Graph scrollbar'),
			},
			{
				kind: 'checkgroup',
				key: 'graph.scrollMarkers.additionalTypes',
				label: l10n.t('Also mark these on the scrollbar'),
				options: [
					...sharedMarkerTypeOptions,
					{
						value: 'wip',
						label: l10n.t('Working tree (WIP)'),
						hint: l10n.t('Marks the location of working tree (WIP) rows'),
					},
				],
				enabledWhen: 'graph.scrollMarkers.enabled',
				indent: true,
			},
			{
				kind: 'check',
				key: 'graph.minimap.enabled',
				label: l10n.t('Show a minimap of commit activity above the Commit Graph'),
			},
			{
				kind: 'checkgroup',
				key: 'graph.minimap.additionalTypes',
				label: l10n.t('Also mark these on the minimap'),
				options: [
					...sharedMarkerTypeOptions,
					{
						value: 'worktree',
						label: l10n.t('Other worktrees'),
						hint: l10n.t('Marks the location of other worktrees (where each is checked out)'),
					},
				],
				enabledWhen: 'graph.minimap.enabled',
				indent: true,
			},
			{
				kind: 'check',
				key: 'graph.showGhostRefsOnRowHover',
				label: l10n.t('Show ghost branch / tag when hovering over or selecting a commit'),
			},
			{
				kind: 'check',
				key: 'graph.dimMergeCommits',
				label: l10n.t('Dim merge commit rows'),
			},
			{
				kind: 'check',
				key: 'graph.showRemoteNames',
				label: l10n.t('Show remote names on remote branches'),
			},
			{
				kind: 'select',
				key: 'graph.refs.maxInline',
				label: l10n.t('Show this many branch and tag pills on each row before collapsing the rest'),
				options: [
					{ value: '1', label: l10n.t('{value} (default)', { value: '1' }) },
					{ value: '2', label: '2' },
					{ value: '3', label: '3' },
					{ value: '4', label: '4' },
					{ value: '5', label: '5' },
					{ value: '6', label: '6' },
					{ value: '7', label: '7' },
					{ value: '8', label: '8' },
					{ value: '9', label: '9' },
					{ value: '10', label: '10' },
					{ value: 'auto', label: l10n.t('auto — fit as many pills as the row allows') },
				],
			},
			{
				kind: 'select',
				key: 'graph.refs.maxStacked',
				label: l10n.t(
					'Show this many branch and tag pills on the stacked pill line before collapsing the rest',
				),
				options: [
					{ value: '1', label: '1' },
					{ value: '2', label: '2' },
					{ value: '3', label: '3' },
					{ value: '4', label: '4' },
					{ value: '5', label: '5' },
					{ value: '6', label: '6' },
					{ value: '7', label: '7' },
					{ value: '8', label: '8' },
					{ value: '9', label: '9' },
					{ value: '10', label: '10' },
					{ value: 'auto', label: l10n.t('auto — fit as many pills as the line allows (default)') },
				],
			},
			{
				kind: 'select',
				key: 'graph.refs.layout',
				label: l10n.t('Branch and tag pill layout'),
				options: [
					{ value: 'inline', label: l10n.t('inline with the commit (default)') },
					{ value: 'stacked', label: l10n.t('stacked on their own line above the commit') },
				],
			},
			{
				kind: 'check',
				key: 'graph.showUpstreamStatus',
				label: l10n.t('Show upstream status on local branches with remotes'),
			},
			{
				kind: 'check',
				key: 'graph.issues.enabled',
				label: l10n.t('Show associated issues on branches'),
				hint: l10n.t('Requires a connection to a supported issue service (e.g. GitHub)'),
			},
			{
				kind: 'check',
				key: 'graph.pullRequests.enabled',
				label: l10n.t('Show associated pull requests on remote branches'),
				hint: l10n.t('Requires a connection to a supported remote service (e.g. GitHub)'),
			},
			{
				kind: 'check',
				key: 'graph.avatars',
				label: l10n.t('Use author and remote avatars'),
			},
			{
				kind: 'select',
				key: 'graph.branchesVisibility',
				label: l10n.t('Show branches'),
				options: [
					{ value: 'all', label: l10n.t('all branches (default)') },
					{ value: 'smart', label: l10n.t('only relevant branches') },
					{ value: 'current', label: l10n.t('only the current branch') },
					{ value: 'favorited', label: l10n.t('only favorited branches') },
					{ value: 'agents', label: l10n.t('only branches associated with active agents') },
				],
			},
			{
				kind: 'select',
				key: 'graph.commitOrdering',
				label: l10n.t('Order commits'),
				options: [
					{ value: 'date', label: l10n.t('by commit date, descending (default)') },
					{ value: 'author-date', label: l10n.t('by author date, descending') },
					{
						value: 'topo',
						label: l10n.t('by commit date, descending, without intermixing lines of history'),
					},
				],
			},
			{
				kind: 'select',
				key: 'graph.multiselect',
				label: l10n.t('Allow selecting multiple commits'),
				hint: l10n.t('Topological restriction keeps a multi-selection along a single line of history'),
				options: [
					{ value: 'false', label: l10n.t('no') },
					{ value: 'true', label: l10n.t('yes, without restriction') },
					{ value: 'topological', label: l10n.t('yes, restricted topologically (default)') },
				],
			},
			{
				kind: 'check',
				key: 'graph.dateStyle',
				label: l10n.t('Allow relative date formatting'),
				valueOn: 'relative',
				valueOff: 'absolute',
			},
			// Mirrors the effective date style — explicit `graph.dateStyle`, or the
			// inherited `defaultDateStyle` when it's left unset (null)
			{
				kind: 'info',
				text: l10n.t('Shows some dates relatively, e.g. 1 day ago'),
				visibleWhen: 'graph.dateStyle =relative',
			},
			{
				kind: 'info',
				text: l10n.t('Shows some dates relatively, e.g. 1 day ago'),
				visibleWhen: 'graph.dateStyle =null & defaultDateStyle =relative',
			},
			{
				kind: 'info',
				text: l10n.t('Shows dates absolutely, using the date format below'),
				visibleWhen: 'graph.dateStyle =absolute',
			},
			{
				kind: 'info',
				text: l10n.t('Shows dates absolutely, using the date format below'),
				visibleWhen: 'graph.dateStyle =null & defaultDateStyle =absolute',
			},
			{
				kind: 'text',
				key: 'graph.dateFormat',
				label: l10n.t('Date format'),
				placeholder: l10n.t('defaults to `{setting}` value', { setting: 'defaultDateFormat' }),
				preview: { type: 'date', default: 'MMMM Do, YYYY h:mma', defaultLookup: 'defaultDateFormat' },
			},
		],
	},
	{
		id: 'scm-views',
		settingsSearch: 'gitlens.views.scm.grouped',
		name: l10n.t('GitLens SCM'),
		group: 'Views',
		icon: 'gl-gitlens',
		hint: l10n.t(
			'Folds multiple GitLens views into one unified GitLens SCM panel, alongside the built-in Source Control view',
		),
		controls: [
			{
				kind: 'scm-views',
				label: l10n.t('GitLens SCM views'),
				hint: l10n.t('Group, hide, or set the default view for GitLens SCM'),
			},
		],
	},
	{
		id: 'commits-view',
		settingsSearch: 'gitlens.views.commits or gitlens.views',
		name: l10n.t('Commits view'),
		group: 'Views',
		icon: 'gl-commits-view',
		hint: l10n.t('Adds a [Commits view]({command}) to visualize, explore, and manage Git commits', {
			command: 'command:gitlens.showCommitsView',
		}),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/side-bar/#commits-view',
		controls: [
			{
				kind: 'text',
				key: 'views.formats.commits.label',
				label: l10n.t('Commit label format'),
				placeholder: '${❰ tips ❱➤  }${message}',
				defaultValue: '${❰ tips ❱➤  }${message}',
				preview: { type: 'commit', default: '${❰ tips ❱➤  }${message}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.commits.description',
				label: l10n.t('Commit description format'),
				placeholder: '${author, }${agoOrDate}',
				defaultValue: '${author, }${agoOrDate}',
				preview: { type: 'commit', default: '${author, }${agoOrDate}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.commits.tooltip',
				label: l10n.t('Commit tooltip format'),
				placeholder: '${avatar} &nbsp;__${author}__${signature} &nbsp;$(history) ${agoAndDateBothSources}',
				defaultValue:
					"${avatar} &nbsp;__${author}__${signature} &nbsp;$(history) ${agoAndDateBothSources} \\\n${link}${' via  'pullRequest}${'&nbsp;&nbsp;'changesDetail} ${message}${\n\n---\n\nfootnotes}\n\n${tips}",
				preview: { type: 'commit', default: '${avatar} &nbsp;__${author}__ &nbsp;$(history) ${agoOrDate}' },
				tokens: 'hover',
			},
			{
				kind: 'text',
				key: 'views.formats.files.label',
				label: l10n.t('File format'),
				hint: l10n.t('Formats file rows shown throughout GitLens views, not just the Commits view'),
				placeholder: '${working  }${file}',
				defaultValue: '${working  }${file}',
				preview: { type: 'file', default: '${working  }${file}' },
				tokens: 'file',
			},
			{
				kind: 'text',
				key: 'views.formats.files.description',
				label: l10n.t('File description format'),
				hint: l10n.t('Formats the file description shown throughout GitLens views, not just the Commits view'),
				placeholder: '${directory}${  ←  originalPath}',
				defaultValue: '${directory}${  ←  originalPath}',
				preview: { type: 'file' },
				tokens: 'file',
			},
		],
	},
	{
		id: 'stashes-view',
		settingsSearch: 'gitlens.views.stashes or gitlens.views',
		name: l10n.t('Stashes view'),
		group: 'Views',
		icon: 'gl-stashes-view',
		hint: l10n.t('Adds a [Stashes view]({command}) to visualize, explore, and manage Git stashes', {
			command: 'command:gitlens.showStashesView',
		}),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/side-bar/#stashes-view',
		controls: [
			{
				kind: 'text',
				key: 'views.formats.stashes.label',
				label: l10n.t('Stash label format'),
				placeholder: '${message}',
				defaultValue: '${message}',
				preview: { type: 'commit', default: '${message}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.stashes.description',
				label: l10n.t('Stash description format'),
				placeholder: '${stashOnRef, }${agoOrDate}',
				defaultValue: '${stashOnRef, }${agoOrDate}',
				preview: { type: 'commit', default: '${stashOnRef, }${agoOrDate}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.stashes.tooltip',
				label: l10n.t('Stash tooltip format'),
				placeholder: "${link}${' on `'stashOnRef`}",
				defaultValue:
					"${link}${' on `'stashOnRef`}${'\\\n&nbsp;&nbsp;'changesDetail} \\\n &nbsp;$(history) ${agoAndDate} ${message}${\n\n---\n\nfootnotes}",
				preview: { type: 'commit', default: '${stashOnRef, }${agoOrDate} ${message}' },
				tokens: 'hover',
			},
		],
	},
];
