import type { TemplateResult } from 'lit';
import { html } from 'lit';
import type { SearchOperatorsLongForm } from '../../../../../constants.search';
import type { CompletionItem } from '../autocomplete/autocomplete';

export type SearchCompletionItem = CompletionItem<
	SearchCompletionOperator | SearchCompletionCommand | SearchCompletionValue
>;

export interface SearchCompletionCommand {
	command: 'toggle-natural-language-mode';
}

export interface SearchCompletionValue {
	/** The operator this value belongs to */
	operator: SearchOperatorsLongForm;
	/** The value to insert */
	value: string;
}

export const naturalLanguageSearchAutocompleteCommand: CompletionItem<SearchCompletionCommand> = {
	label: 'Search using natural language',
	detail: "Describe what you're looking for and let AI build the query",
	icon: 'sparkle',
	item: { command: 'toggle-natural-language-mode' },
	score: 0,
	alwaysVisible: true,
};

export interface SearchCompletionOperatorValue {
	/** The value to suggest */
	value: string;
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
	/** Predefined values to suggest for this operator */
	values?: SearchCompletionOperatorValue[];
}

/**
 * Metadata for all search operators, used for autocomplete and help text
 */
export const searchCompletionOperators: SearchCompletionOperator[] = [
	{
		operator: 'message:',
		description: 'Search commit messages to quickly find specific changes or features',
		icon: 'comment',
		aliases: ['=:'],
		example: html`Use quotes to search for phrases, e.g. <code>message:"Updates dependencies"</code> or
			<code>=:"bug fix"</code>`,
	},
	{
		operator: 'author:',
		description: 'Filter by author to see contributions from specific team members',
		icon: 'person',
		aliases: ['@:'],
		example: html`Use a name or email, e.g. <code>author:eamodio</code>, <code>@:john</code>, or
			<code>@me</code> for your own commits`,
	},
	{
		operator: 'commit:',
		description: 'Jump to a specific commit using its SHA',
		icon: 'git-commit',
		aliases: ['#:'],
		example: html`Use a full or short commit SHA, e.g. <code>commit:4ce3a</code> or <code>#:4ce3a</code>`,
	},
	{
		operator: 'ref:',
		description: 'Filter to a specific branch or tag (solo), or compare ranges to see unique commits',
		icon: 'git-branch',
		aliases: ['^:'],
		example: html`Use a reference to filter, e.g. <code>ref:main</code> or <code>^:v1.0.0</code>, or a range to
			compare, e.g. <code>ref:main..feature</code> (commits in feature but not in main)`,
	},
	{
		operator: 'type:',
		description: 'Filter by commit type — view only stashes or branch & tag tips',
		icon: 'symbol-misc',
		aliases: ['is:'],
		// example: html`Use <code>is:stash</code> for stashes or <code>is:tip</code> for branch & tag tips`,
		values: [
			{
				value: 'stash',
				description: 'Filter commits to only show stashes',
				icon: 'archive',
			},
			{
				value: 'tip',
				description: 'Filter commits to only show commits pointed to by branches or tags',
				icon: 'git-branch',
			},
		],
	},
	{
		operator: 'file:',
		description: 'Track file changes across history (supports glob patterns)',
		icon: 'file',
		aliases: ['?:'],
		example: html`Use a path or filename, e.g. <code>file:package.json</code>, or a glob, e.g.
			<code>?:src/**/*.ts</code>`,
	},
	{
		operator: 'change:',
		description: 'Search code changes to find when specific functions or patterns were modified',
		icon: 'diff',
		aliases: ['~:'],
		example: html`Use a code snippet or regex, e.g. <code>change:"function login"</code> or
			<code>~:"import.*React"</code>`,
	},
	{
		operator: 'after:',
		description: 'Filter by date range using absolute dates or relative times',
		icon: 'calendar',
		aliases: ['since:', '>:'],
		example: html`Use a date string, e.g. <code>after:2022-01-01</code>, or a relative date, e.g.
			<code>since:3.weeks.ago</code> or <code>&gt;:1.month.ago</code>`,
	},
	{
		operator: 'before:',
		description: 'Filter by date range using absolute dates or relative times',
		icon: 'calendar',
		aliases: ['until:', '<:'],
		example: html`Use a date string, e.g. <code>before:2022-01-01</code>, or a relative date, e.g.
			<code>until:3.weeks.ago</code> or <code>&lt;:1.month.ago</code>`,
	},
];
