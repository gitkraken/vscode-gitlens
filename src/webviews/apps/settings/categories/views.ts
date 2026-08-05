/* oxlint-disable no-template-curly-in-string -- descriptor data contains literal GitLens format tokens */
import type { CheckGroupOptionDescriptor, SettingsCategory } from '../model.js';

/** Shared by `graph.scrollMarkers.additionalTypes` and `graph.minimap.additionalTypes` — both mark the
 *  same 5 ref types, differing only in their trailing WIP/worktree-specific option. */
const sharedMarkerTypeOptions: CheckGroupOptionDescriptor[] = [
	{ value: 'localBranches', label: 'Local branches', hint: 'Marks the location of local branches' },
	{
		value: 'remoteBranches',
		label: 'Remote branches',
		hint: 'Marks the location of remote branches',
	},
	{ value: 'pullRequests', label: 'Pull requests', hint: 'Marks the location of pull requests' },
	{ value: 'stashes', label: 'Stashes', hint: 'Marks the location of stashes' },
	{ value: 'tags', label: 'Tags', hint: 'Marks the location of tags' },
];

export const viewsCategories: SettingsCategory[] = [
	{
		id: 'commit-graph',
		settingsSearch: 'gitlens.graph',
		name: 'Commit Graph',
		group: 'Views',
		icon: 'gl-graph',
		hint: 'Adds a [Commit Graph](command:gitlens.showGraph) to visualize, explore, and manage a Git repository',
		pro: true,
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-plus/#commit-graph',
		preview: 'graph',
		controls: [
			{
				kind: 'segmented',
				key: 'graph.layout',
				label: 'Prefer showing the Commit Graph',
				options: [
					{ value: 'editor', label: 'in the editor area' },
					{ value: 'panel', label: 'as a view' },
				],
			},
			{
				kind: 'number',
				key: 'graph.defaultItemLimit',
				label: 'Show this many rows at first',
				placeholder: '500',
				defaultValue: '500',
			},
			{
				kind: 'number',
				key: 'graph.pageItemLimit',
				label: 'Then page in this many more rows when scrolling',
				placeholder: '200',
				defaultValue: '200',
			},
			{
				kind: 'number',
				key: 'graph.searchItemLimit',
				label: 'Show this many search results at first and when paging',
				placeholder: '0',
				defaultValue: '0',
			},
			{
				kind: 'number',
				key: 'graph.scrollRowPadding',
				label: 'Start scrolling at this many rows from the edge',
				placeholder: '0',
				defaultValue: '0',
			},
			{
				kind: 'check',
				key: 'graph.scrollMarkers.enabled',
				label: 'Show markers on the Commit Graph scrollbar',
			},
			{
				kind: 'checkgroup',
				key: 'graph.scrollMarkers.additionalTypes',
				label: 'Also mark these on the scrollbar',
				options: [
					...sharedMarkerTypeOptions,
					{
						value: 'wip',
						label: 'Working tree (WIP)',
						hint: 'Marks the location of working tree (WIP) rows',
					},
				],
				enabledWhen: 'graph.scrollMarkers.enabled',
				indent: true,
			},
			{
				kind: 'check',
				key: 'graph.minimap.enabled',
				label: 'Show a minimap of commit activity above the Commit Graph',
			},
			{
				kind: 'checkgroup',
				key: 'graph.minimap.additionalTypes',
				label: 'Also mark these on the minimap',
				options: [
					...sharedMarkerTypeOptions,
					{
						value: 'worktree',
						label: 'Other worktrees',
						hint: 'Marks the location of other worktrees (where each is checked out)',
					},
				],
				enabledWhen: 'graph.minimap.enabled',
				indent: true,
			},
			{
				kind: 'check',
				key: 'graph.showGhostRefsOnRowHover',
				label: 'Show ghost branch / tag when hovering over or selecting a commit',
			},
			{
				kind: 'check',
				key: 'graph.dimMergeCommits',
				label: 'Dim merge commit rows',
			},
			{
				kind: 'check',
				key: 'graph.showRemoteNames',
				label: 'Show remote names on remote branches',
			},
			{
				kind: 'check',
				key: 'graph.showUpstreamStatus',
				label: 'Show upstream status on local branches with remotes',
			},
			{
				kind: 'check',
				key: 'graph.issues.enabled',
				label: 'Show associated issues on branches',
				hint: 'Requires a connection to a supported issue service (e.g. GitHub)',
			},
			{
				kind: 'check',
				key: 'graph.pullRequests.enabled',
				label: 'Show associated pull requests on remote branches',
				hint: 'Requires a connection to a supported remote service (e.g. GitHub)',
			},
			{
				kind: 'check',
				key: 'graph.avatars',
				label: 'Use author and remote avatars',
			},
			{
				kind: 'select',
				key: 'graph.branchesVisibility',
				label: 'Show branches',
				options: [
					{ value: 'all', label: 'all branches (default)' },
					{ value: 'smart', label: 'only relevant branches' },
					{ value: 'current', label: 'only the current branch' },
					{ value: 'favorited', label: 'only favorited branches' },
					{ value: 'agents', label: 'only branches associated with active agents' },
				],
			},
			{
				kind: 'select',
				key: 'graph.commitOrdering',
				label: 'Order commits',
				options: [
					{ value: 'date', label: 'by commit date, descending (default)' },
					{ value: 'author-date', label: 'by author date, descending' },
					{ value: 'topo', label: 'by commit date, descending, without intermixing lines of history' },
				],
			},
			{
				kind: 'select',
				key: 'graph.multiselect',
				label: 'Allow selecting multiple commits',
				hint: 'Topological restriction keeps a multi-selection along a single line of history',
				options: [
					{ value: 'false', label: 'no' },
					{ value: 'true', label: 'yes, without restriction' },
					{ value: 'topological', label: 'yes, restricted topologically (default)' },
				],
			},
			{
				kind: 'check',
				key: 'graph.dateStyle',
				label: 'Allow relative date formatting',
				valueOn: 'relative',
				valueOff: 'absolute',
			},
			// Mirrors the effective date style — explicit `graph.dateStyle`, or the
			// inherited `defaultDateStyle` when it's left unset (null)
			{
				kind: 'info',
				text: 'Shows some dates relatively, e.g. 1 day ago',
				visibleWhen: 'graph.dateStyle =relative',
			},
			{
				kind: 'info',
				text: 'Shows some dates relatively, e.g. 1 day ago',
				visibleWhen: 'graph.dateStyle =null & defaultDateStyle =relative',
			},
			{
				kind: 'info',
				text: 'Shows dates absolutely, using the date format below',
				visibleWhen: 'graph.dateStyle =absolute',
			},
			{
				kind: 'info',
				text: 'Shows dates absolutely, using the date format below',
				visibleWhen: 'graph.dateStyle =null & defaultDateStyle =absolute',
			},
			{
				kind: 'text',
				key: 'graph.dateFormat',
				label: 'Date format',
				placeholder: 'defaults to `defaultDateFormat` value',
				preview: { type: 'date', default: 'MMMM Do, YYYY h:mma', defaultLookup: 'defaultDateFormat' },
			},
		],
	},
	{
		id: 'scm-views',
		settingsSearch: 'gitlens.views.scm.grouped',
		name: 'GitLens SCM',
		group: 'Views',
		icon: 'gl-gitlens',
		hint: 'Folds multiple GitLens views into one unified GitLens SCM panel, alongside the built-in Source Control view',
		controls: [
			{
				kind: 'scm-views',
				label: 'GitLens SCM views',
				hint: 'Group, hide, or set the default view for GitLens SCM',
			},
		],
	},
	{
		id: 'commits-view',
		settingsSearch: 'gitlens.views.commits or gitlens.views',
		name: 'Commits view',
		group: 'Views',
		icon: 'gl-commits-view',
		hint: 'Adds a [Commits view](command:gitlens.showCommitsView) to visualize, explore, and manage Git commits',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/side-bar/#commits-view',
		controls: [
			{
				kind: 'text',
				key: 'views.formats.commits.label',
				label: 'Commit label format',
				placeholder: '${❰ tips ❱➤  }${message}',
				defaultValue: '${❰ tips ❱➤  }${message}',
				preview: { type: 'commit', default: '${❰ tips ❱➤  }${message}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.commits.description',
				label: 'Commit description format',
				placeholder: '${author, }${agoOrDate}',
				defaultValue: '${author, }${agoOrDate}',
				preview: { type: 'commit', default: '${author, }${agoOrDate}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.commits.tooltip',
				label: 'Commit tooltip format',
				placeholder: '${avatar} &nbsp;__${author}__${signature} &nbsp;$(history) ${agoAndDateBothSources}',
				defaultValue:
					"${avatar} &nbsp;__${author}__${signature} &nbsp;$(history) ${agoAndDateBothSources} \\\n${link}${' via  'pullRequest}${'&nbsp;&nbsp;'changesDetail} ${message}${\n\n---\n\nfootnotes}\n\n${tips}",
				preview: { type: 'commit', default: '${avatar} &nbsp;__${author}__ &nbsp;$(history) ${agoOrDate}' },
				tokens: 'hover',
			},
			{
				kind: 'text',
				key: 'views.formats.files.label',
				label: 'File format',
				hint: 'Formats file rows shown throughout GitLens views, not just the Commits view',
				placeholder: '${working  }${file}',
				defaultValue: '${working  }${file}',
				preview: { type: 'file', default: '${working  }${file}' },
				tokens: 'file',
			},
			{
				kind: 'text',
				key: 'views.formats.files.description',
				label: 'File description format',
				hint: 'Formats the file description shown throughout GitLens views, not just the Commits view',
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
		name: 'Stashes view',
		group: 'Views',
		icon: 'gl-stashes-view',
		hint: 'Adds a [Stashes view](command:gitlens.showStashesView) to visualize, explore, and manage Git stashes',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/side-bar/#stashes-view',
		controls: [
			{
				kind: 'text',
				key: 'views.formats.stashes.label',
				label: 'Stash label format',
				placeholder: '${message}',
				defaultValue: '${message}',
				preview: { type: 'commit', default: '${message}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.stashes.description',
				label: 'Stash description format',
				placeholder: '${stashOnRef, }${agoOrDate}',
				defaultValue: '${stashOnRef, }${agoOrDate}',
				preview: { type: 'commit', default: '${stashOnRef, }${agoOrDate}' },
				tokens: true,
			},
			{
				kind: 'text',
				key: 'views.formats.stashes.tooltip',
				label: 'Stash tooltip format',
				placeholder: "${link}${' on `'stashOnRef`}",
				defaultValue:
					"${link}${' on `'stashOnRef`}${'\\\n&nbsp;&nbsp;'changesDetail} \\\n &nbsp;$(history) ${agoAndDate} ${message}${\n\n---\n\nfootnotes}",
				preview: { type: 'commit', default: '${stashOnRef, }${agoOrDate} ${message}' },
				tokens: 'hover',
			},
		],
	},
];
