import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { html } from 'lit';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import type { SearchOperatorsLongForm } from '@gitlens/git/models/search.js';
import type { CompletionItem } from '../autocomplete/autocomplete.js';

export type SearchCompletionItem = CompletionItem<
	SearchCompletionOperator | SearchCompletionCommand | SearchCompletionValue
>;

export type SearchCompletionCommand =
	| { command: 'toggle-natural-language-mode' }
	| { command: 'pick-author' | 'pick-file'; multi?: boolean }
	| { command: 'pick-folder' | 'pick-ref' | 'pick-comparison'; multi?: never };

export interface SearchCompletionValue {
	/** The operator this value belongs to */
	operator: SearchOperatorsLongForm;
	/** The value to insert */
	value: string;
}

export const naturalLanguageSearchAutocompleteCommand: CompletionItem<SearchCompletionCommand> = {
	label: l10n.t('Search using natural language'),
	detail: l10n.t("Describe what you're looking for and let AI build the query"),
	icon: 'sparkle',
	item: { command: 'toggle-natural-language-mode' },
	score: 0,
	alwaysVisible: true,
};

export const structuredSearchAutocompleteCommand: CompletionItem<SearchCompletionCommand> = {
	label: l10n.t('Search using filters'),
	detail: l10n.t('Combine filters to build powerful searches, e.g. {example}.', {
		example: '@me after:1.week.ago file:*.ts',
	}),
	icon: 'search',
	item: { command: 'toggle-natural-language-mode' },
	score: 0,
	alwaysVisible: true,
};

export interface SearchCompletionOperatorValue {
	/** The value to suggest or command to execute when this value is selected */
	value: string | SearchCompletionCommand;
	/** Label to display in autocomplete */
	label: string;
	/** Description of what this value does (shown in autocomplete list) */
	description: string;
	/** Icon to display in autocomplete */
	icon?: string;
}

export interface SearchCompletionOperator {
	/** Primary operator (long form) */
	operator: SearchOperatorsLongForm;
	/** Aliases for this operator (short forms) */
	aliases: string[];
	/** Short description of what this operator does */
	description: string;
	/** Icon to display in autocomplete */
	icon?: string;
	/** Example usage */
	example?: TemplateResult;
	/** Predefined values to suggest for this operator (can include commands that help populate values) */
	values?: SearchCompletionOperatorValue[];
}

/**
 * Metadata for all search operators, used for autocomplete and help text
 */
export const searchCompletionOperators: SearchCompletionOperator[] = [
	{
		operator: 'message:',
		description: l10n.t('Search commit messages to quickly find specific changes or features'),
		icon: 'comment',
		aliases: ['=:'],
		example: html`${localizedContent(l10n.t('Use quotes to search for phrases, e.g. {example1} or {example2}'), { example1: html`<code>message:"Updates dependencies"</code>`, example2: html`<code>=:"bug fix"</code>` })}`,
	},
	{
		operator: '-message:',
		description: l10n.t('Exclude commits whose message contains a term'),
		icon: 'comment',
		aliases: [],
		example: html`${localizedContent(l10n.t('Use to filter out noisy commits, e.g. {example1}. Cannot be combined with {example2} in the same search'), { example1: html`<code>-message:wip</code>`, example2: html`<code>message:</code>` })}`,
	},
	{
		operator: 'author:',
		description: l10n.t('Filter by author to see contributions from specific team members'),
		icon: 'person',
		aliases: ['@:'],
		example: html`${localizedContent(l10n.t('Use a name or email, e.g. {example1}, {example2}, or {example3} for your own commits'), { example1: html`<code>author:eamodio</code>`, example2: html`<code>@:john</code>`, example3: html`<code>@me</code>` })}`,
		values: [
			{
				value: '@me',
				label: '@me',
				description: l10n.t('Filter to only show your own commits'),
				icon: 'person',
			},
			{
				value: { command: 'pick-author', multi: true },
				label: l10n.t('Choose authors\u2026'),
				description: l10n.t('Select one or more contributors to filter by'),
				icon: 'organization',
			},
		],
	},
	{
		operator: 'committer:',
		description: l10n.t('Filter by committer to see who applied specific changes'),
		icon: 'person',
		aliases: [],
		example: html`${localizedContent(l10n.t('Use a name or email, e.g. {example1}, or {example2} for commits you committed'), { example1: html`<code>committer:eamodio</code>`, example2: html`<code>@me</code>` })}`,
		values: [
			{
				value: '@me',
				label: '@me',
				description: l10n.t('Filter to only show commits you committed'),
				icon: 'person',
			},
		],
	},
	{
		operator: 'commit:',
		description: l10n.t('Jump to a specific commit using its SHA'),
		icon: 'git-commit',
		aliases: ['#:'],
		example: html`${localizedContent(l10n.t('Use a full or short commit SHA, e.g. {example1} or {example2}'), { example1: html`<code>commit:4ce3a</code>`, example2: html`<code>#:4ce3a</code>` })}`,
	},
	{
		operator: 'ref:',
		description: l10n.t('Filter to a specific branch or tag (solo), or compare ranges to see unique commits'),
		icon: 'git-branch',
		aliases: ['^:'],
		example: html`${localizedContent(
			l10n.t(
				'Use a reference to filter, e.g. {example1} or {example2}, or a range to compare, e.g. {example3} (commits in {feature} but not in {main})',
			),
			{
				example1: html`<code>ref:main</code>`,
				example2: html`<code>^:v1.0.0</code>`,
				example3: html`<code>ref:main..feature</code>`,
				feature: 'feature',
				main: 'main',
			},
		)}`,
		values: [
			{
				value: { command: 'pick-ref' },
				label: l10n.t('Choose a branch or tag\u2026'),
				description: l10n.t('Select a branch or tag to filter by'),
				icon: 'git-branch',
			},
			{
				value: { command: 'pick-comparison' },
				label: l10n.t('Choose a comparison range\u2026'),
				description: l10n.t('Select two refs to compare (e.g. {range})', { range: 'main..feature' }),
				icon: 'git-compare',
			},
		],
	},
	{
		operator: 'type:',
		description: l10n.t('Filter by commit type — view stashes, branch & tag tips, or working tree changes'),
		icon: 'symbol-misc',
		aliases: ['is:'],
		// example: html`${localizedContent(l10n.t("Use {example1} for stashes, {example2} for branch & tag tips, or {example3} for working tree changes"), { example1: html`<code>is:stash</code>`, example2: html`<code>is:tip</code>`, example3: html`<code>is:wip</code>` })}`,
		values: [
			{
				value: 'stash',
				label: 'stash',
				description: l10n.t('Filter commits to only show stashes'),
				icon: 'archive',
			},
			{
				value: 'tip',
				label: 'tip',
				description: l10n.t('Filter commits to only show commits pointed to by branches or tags'),
				icon: 'git-branch',
			},
			{
				value: 'merge',
				label: 'merge',
				description: l10n.t('Filter commits to only show merge commits'),
				icon: 'git-merge',
			},
			{
				value: 'wip',
				label: 'wip',
				description: l10n.t('Filter to only show working tree changes (current and other worktrees)'),
				icon: 'gl-wip',
			},
		],
	},
	{
		operator: 'file:',
		description: l10n.t('Track file changes across history (supports glob patterns)'),
		icon: 'file',
		aliases: ['?:'],
		example: html`${localizedContent(l10n.t('Use a path or filename, e.g. {example1}, or a glob, e.g. {example2}'), { example1: html`<code>file:package.json</code>`, example2: html`<code>?:src/**/*.ts</code>` })}`,
		values: [
			{
				value: { command: 'pick-file', multi: true },
				label: l10n.t('Choose files\u2026'),
				description: l10n.t('Select one or more files to filter by'),
				icon: 'file',
			},
			{
				value: { command: 'pick-folder' },
				label: l10n.t('Choose a folder\u2026'),
				description: l10n.t('Select a folder to filter by'),
				icon: 'folder',
			},
		],
	},
	{
		operator: 'change:',
		description: l10n.t('Search code changes to find when specific functions or patterns were modified'),
		icon: 'diff',
		aliases: ['~:'],
		example: html`${localizedContent(l10n.t('Use a code snippet or regex, e.g. {example1} or {example2}'), { example1: html`<code>change:"function login"</code>`, example2: html`<code>~:"import.*React"</code>` })}`,
	},
	{
		operator: 'after:',
		description: l10n.t('Filter by date range using absolute dates or relative times'),
		icon: 'calendar',
		aliases: ['since:', '>:'],
		example: html`${localizedContent(l10n.t('Use a date string, e.g. {example1}, or a relative date, e.g. {example2} or {example3}'), { example1: html`<code>after:2022-01-01</code>`, example2: html`<code>since:3.weeks.ago</code>`, example3: html`<code>&gt;:1.month.ago</code>` })}`,
	},
	{
		operator: 'before:',
		description: l10n.t('Filter by date range using absolute dates or relative times'),
		icon: 'calendar',
		aliases: ['until:', '<:'],
		example: html`${localizedContent(l10n.t('Use a date string, e.g. {example1}, or a relative date, e.g. {example2} or {example3}'), { example1: html`<code>before:2022-01-01</code>`, example2: html`<code>until:3.weeks.ago</code>`, example3: html`<code>&lt;:1.month.ago</code>` })}`,
	},
];
