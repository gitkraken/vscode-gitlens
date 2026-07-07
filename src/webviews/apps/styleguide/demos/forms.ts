import { html } from 'lit';
import type { CompletionItem } from '../../shared/components/autocomplete/autocomplete.js';
import type { SegmentedOption } from '../../shared/components/segmented/segmented.js';
import type { SelectOption } from '../../shared/components/select/select.js';
import '../../shared/components/ai-input.js';
import '../../shared/components/autocomplete/autocomplete.js';
import '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/radio/radio-group.js';
import '../../shared/components/radio/radio.js';
import '../../shared/components/search/search-box.js';
import '../../shared/components/search/search-input.js';
import '../../shared/components/segmented/segmented.js';
import '../../shared/components/select/select.js';
import '../../shared/components/slider/slider.js';
import '../../shared/components/switch/switch.js';
import type { ComponentGroup } from './types.js';

const BRANCH_OPTIONS: SelectOption[] = [
	{ value: 'main', label: 'main' },
	{ value: 'feature/graph-performance', label: 'feature/graph-performance' },
	{ value: 'bug/#3521-blame-gutter', label: 'bug/#3521-blame-gutter' },
	{ value: 'release/17.4', label: 'release/17.4' },
];

const DIFF_ALGORITHM_OPTIONS: SelectOption[] = [
	{ value: 'histogram', label: 'Histogram' },
	{ value: 'minimal', label: 'Minimal' },
	{ value: 'patience', label: 'Patience', disabled: true },
];

const MERGE_STRATEGY_SELECT_OPTIONS: SelectOption[] = [
	{ value: 'merge', label: 'Merge commit' },
	{ value: 'squash', label: 'Squash and merge' },
	{ value: 'rebase', label: 'Rebase and merge' },
];

const DIFF_VIEW_OPTIONS: SegmentedOption[] = [
	{ value: 'unified', label: 'Unified' },
	{ value: 'split', label: 'Split' },
];

const TIME_RANGE_OPTIONS: SegmentedOption[] = [
	{ value: 'day', label: '24h' },
	{ value: 'week', label: '7d' },
	{ value: 'month', label: '30d' },
	{ value: 'year', label: '1y' },
];

const OPERATOR_COMPLETION_ITEMS: CompletionItem[] = [
	{
		label: 'author:',
		description: '@:',
		detail: 'Filter by author to see contributions from specific team members',
		icon: 'person',
		item: { operator: 'author:' },
		score: 1,
	},
	{
		label: 'ref:',
		description: '^:',
		detail: 'Filter to a specific branch or tag, or compare ranges to see unique commits',
		icon: 'git-branch',
		item: { operator: 'ref:' },
		score: 1,
	},
	{
		label: 'file:',
		description: '?:',
		detail: 'Track file changes across history (supports glob patterns)',
		icon: 'file',
		item: { operator: 'file:' },
		score: 1,
	},
];

const AUTHOR_COMPLETION_ITEMS: CompletionItem[] = [
	{
		label: '@me',
		detail: 'Filter to only show your own commits',
		icon: 'person',
		item: '@me',
		score: 1,
	},
	{
		label: 'eamodio',
		detail: 'eric.amodio@gitkraken.com',
		icon: 'person',
		item: { operator: 'author:', value: 'eamodio' },
		score: 0.8,
		match: { matches: true, score: 0.8, matchedIndices: [0, 1, 2] },
	},
	{
		label: 'Choose authors…',
		detail: 'Select one or more contributors to filter by',
		icon: 'organization',
		item: { command: 'pick-author', multi: true },
		score: 0,
	},
];

export const formsGroups: ComponentGroup[] = [
	{
		family: 'Form controls',
		description: 'Checkboxes, radios, switches, and the select/slider/segmented-control family.',
		demos: [
			{
				label: 'gl-checkbox unchecked',
				render: () => html`<gl-checkbox value="staged">Stage all changes</gl-checkbox>`,
			},
			{
				label: 'gl-checkbox checked',
				render: () => html`<gl-checkbox checked value="staged">Stage all changes</gl-checkbox>`,
			},
			{
				label: 'gl-checkbox indeterminate',
				render: () =>
					html`<gl-checkbox indeterminate value="staged"
						>Some files staged (Alt+click to unstage all)</gl-checkbox
					>`,
				note: 'Alt+click on an indeterminate checkbox flips the transition to unchecked instead of checked — not demoable statically.',
			},
			{
				label: 'gl-checkbox disabled',
				render: () => html`<gl-checkbox disabled value="staged">Stage all changes</gl-checkbox>`,
			},
			{
				label: 'gl-checkbox disabled + checked',
				render: () => html`<gl-checkbox checked disabled value="staged">Stage all changes</gl-checkbox>`,
			},
			{
				label: 'gl-radio checked (in radio-group)',
				render: () => html`
					<gl-radio-group value="working-tree" aria-label="Compare against">
						<gl-radio value="working-tree">Working tree</gl-radio>
						<gl-radio value="staged">Staged changes</gl-radio>
						<gl-radio value="head">HEAD</gl-radio>
					</gl-radio-group>
				`,
				note: 'A bare gl-radio outside a group never becomes checked — always compose inside gl-radio-group.',
			},
			{
				label: 'gl-radio disabled (group disabled)',
				render: () => html`
					<gl-radio-group value="staged" disabled aria-label="Compare against">
						<gl-radio value="working-tree">Working tree</gl-radio>
						<gl-radio value="staged">Staged changes</gl-radio>
					</gl-radio-group>
				`,
			},
			{
				label: 'gl-radio-group 2 options',
				render: () => html`
					<gl-radio-group value="unified" aria-label="Diff view">
						<gl-radio value="unified">Unified</gl-radio>
						<gl-radio value="split">Split</gl-radio>
					</gl-radio-group>
				`,
			},
			{
				label: 'gl-radio-group 4 options, unselected',
				render: () => html`
					<gl-radio-group aria-label="Merge strategy">
						<gl-radio value="merge">Merge commit</gl-radio>
						<gl-radio value="squash">Squash and merge</gl-radio>
						<gl-radio value="rebase">Rebase and merge</gl-radio>
						<gl-radio value="ff-only">Fast-forward only</gl-radio>
					</gl-radio-group>
				`,
			},
			{
				label: 'gl-radio-group disabled',
				render: () => html`
					<gl-radio-group value="rebase" disabled aria-label="Merge strategy">
						<gl-radio value="merge">Merge commit</gl-radio>
						<gl-radio value="rebase">Rebase and merge</gl-radio>
					</gl-radio-group>
				`,
			},
			{ label: 'gl-switch off', render: () => html`<gl-switch>Auto-fetch on open</gl-switch>` },
			{
				label: 'gl-switch on',
				render: () => html`<gl-switch checked>Show whitespace in diffs</gl-switch>`,
			},
			{
				label: 'gl-switch disabled',
				render: () => html`<gl-switch disabled>Sync branches (unavailable offline)</gl-switch>`,
			},
			{
				label: 'gl-switch disabled + on',
				render: () => html`<gl-switch checked disabled>Telemetry enabled</gl-switch>`,
			},
			{
				label: 'gl-switch size=large + hint',
				render: () => html`
					<gl-switch size="large" hint="Applies to every repository in this workspace" checked>
						Enable AI commit suggestions
					</gl-switch>
				`,
			},
			{
				label: 'gl-select placeholder',
				render: () =>
					html`<gl-select
						label="Branch"
						placeholder="Select a branch…"
						.options=${BRANCH_OPTIONS}
					></gl-select>`,
			},
			{
				label: 'gl-select value selected',
				render: () =>
					html`<gl-select
						label="Diff algorithm"
						.options=${DIFF_ALGORITHM_OPTIONS}
						value="histogram"
					></gl-select>`,
			},
			{
				label: 'gl-select size=small',
				render: () =>
					html`<gl-select
						label="Merge strategy"
						size="small"
						.options=${MERGE_STRATEGY_SELECT_OPTIONS}
						value="squash"
					></gl-select>`,
				note: 'known issue: gl-select forwards small/medium to wa-select, which deprecated them in favor of s/m (console warning).',
			},
			{
				label: 'gl-select disabled',
				render: () =>
					html`<gl-select label="Branch" disabled .options=${BRANCH_OPTIONS} value="main"></gl-select>`,
			},
			{
				label: 'gl-select size=large',
				render: () =>
					html`<gl-select label="Branch" size="large" .options=${BRANCH_OPTIONS} value="main"></gl-select>`,
				note: 'known issue: gl-select forwards small/medium/large to wa-select, which deprecated them in favor of s/m/l (console warning).',
			},
			{
				label: 'gl-slider default',
				render: () => html`<gl-slider label="Zoom" value="50"></gl-slider>`,
				note: 'known issue: wa-slider positions its fill/thumb via inline style attributes, which the webview CSP blocks (console violations) — affects every gl-slider consumer, not just this demo.',
			},
			{
				label: 'gl-slider custom range + unit',
				render: () =>
					html`<gl-slider
						label="Blame heatmap age"
						min="0"
						max="365"
						step="5"
						value="90"
						unit=" days"
					></gl-slider>`,
			},
			{
				label: 'gl-slider fine step + px unit',
				render: () =>
					html`<gl-slider label="Graph row height" min="20" max="48" value="28" unit="px"></gl-slider>`,
			},
			{
				label: 'gl-slider disabled',
				render: () => html`<gl-slider label="Zoom" value="50" disabled></gl-slider>`,
			},
			{
				label: 'gl-segmented-control 2 options',
				render: () =>
					html`<gl-segmented-control
						label="Diff view"
						.options=${DIFF_VIEW_OPTIONS}
						value="unified"
					></gl-segmented-control>`,
			},
			{
				label: 'gl-segmented-control 4 options',
				render: () =>
					html`<gl-segmented-control
						label="Time range"
						.options=${TIME_RANGE_OPTIONS}
						value="week"
					></gl-segmented-control>`,
			},
			{
				label: 'gl-segmented-control disabled',
				render: () =>
					html`<gl-segmented-control
						label="Diff view"
						disabled
						.options=${DIFF_VIEW_OPTIONS}
						value="split"
					></gl-segmented-control>`,
			},
		],
	},
	{
		family: 'Search & AI input',
		description: 'The search input/box pairing, the autocomplete dropdown they share, and the AI prompt input.',
		demos: [
			{
				label: 'gl-search-input empty',
				render: () => html`<gl-search-input></gl-search-input>`,
				wide: true,
			},
			{
				label: 'gl-search-input query + matchAll',
				render: () => html`<gl-search-input value="author:@me after:1.week.ago" matchAll></gl-search-input>`,
				wide: true,
			},
			{
				label: 'gl-search-input natural-language mode',
				render: () =>
					html`<gl-search-input naturalLanguage value="my commits from last week"></gl-search-input>`,
				wide: true,
			},
			{
				label: 'gl-search-input filter mode, AI disallowed',
				render: () => html`<gl-search-input filter ?aiAllowed=${false}></gl-search-input>`,
				wide: true,
			},
			{
				label: 'gl-search-box no search yet',
				render: () => html`<gl-search-box resultsLabel="commit"></gl-search-box>`,
				wide: true,
			},
			{
				label: 'gl-search-box results loaded',
				render: () =>
					html`<gl-search-box
						value="fix: gutter blame flicker"
						resultsLabel="commit"
						resultsLoaded
						total="12"
						step="3"
						valid
					></gl-search-box>`,
				wide: true,
			},
			{
				label: 'gl-search-box searching',
				render: () =>
					html`<gl-search-box
						value="author:@me after:1.week.ago"
						resultsLabel="commit"
						searching
					></gl-search-box>`,
				wide: true,
			},
			{
				label: 'gl-search-box result hidden',
				render: () =>
					html`<gl-search-box
						value="fix: gutter blame flicker"
						resultsLabel="commit"
						resultsLoaded
						resultHidden
						total="12"
						step="3"
						valid
					></gl-search-box>`,
				note: 'resultHidden switches the count to the error-colored "sr-hidden" style and swaps the tooltip to "This result is hidden or unable to be shown on the Commit Graph".',
				wide: true,
			},
			{
				label: 'gl-search-box navigating (next)',
				render: () =>
					html`<gl-search-box
						value="fix: gutter blame flicker"
						resultsLabel="commit"
						resultsLoaded
						total="12"
						step="3"
						valid
						navigating="next"
					></gl-search-box>`,
				note: 'navigating="next"/"previous" plays a one-shot bounce animation on the matching nav arrow — a static render only shows the mid-bounce frame.',
				wide: true,
			},
			{
				label: 'gl-search-box paused, more results',
				render: () =>
					html`<gl-search-box
						value="file:*.ts"
						resultsLabel="commit"
						resultsLoaded
						resultsHasMore
						total="50"
						step="50"
						valid
					></gl-search-box>`,
				wide: true,
			},
			{
				label: 'gl-search-box invalid query',
				render: () =>
					html`<gl-search-box
						.value=${'message:"unterminated'}
						resultsLabel="commit"
						resultsLoaded
						valid
						errorMessage="Unexpected token in search query"
					></gl-search-box>`,
				note: 'value contains a double quote, so it is bound as a property (.value) rather than a plain attribute to avoid quote-escaping in the markup.',
				wide: true,
			},
			{
				label: 'gl-autocomplete open — operator suggestions',
				render: () =>
					html`<gl-autocomplete open .items=${OPERATOR_COMPLETION_ITEMS}>
						<span slot="description"
							>Combine filters to build powerful searches, e.g.
							<code>@me after:1.week.ago file:*.ts</code></span
						>
					</gl-autocomplete>`,
				layout: 'block',
			},
			{
				label: 'gl-autocomplete open — fuzzy-matched authors',
				render: () => html`<gl-autocomplete open .items=${AUTHOR_COMPLETION_ITEMS}></gl-autocomplete>`,
				layout: 'block',
			},
			{
				label: 'gl-ai-input default',
				render: () =>
					html`<gl-ai-input
						placeholder="Ask AI to explain this diff..."
						button-label="Explain"
					></gl-ai-input>`,
			},
			{
				label: 'gl-ai-input multiline + active',
				render: () =>
					html`<gl-ai-input
						multiline
						active
						rows="3"
						placeholder="Describe the change you want to make..."
						button-label="Compose"
						value="Extract the blame gutter renderer into its own module"
					></gl-ai-input>`,
			},
			{
				label: 'gl-ai-input busy',
				render: () =>
					html`<gl-ai-input
						busy
						busy-label="Explaining changes…"
						placeholder="Ask AI to explain this diff..."
					></gl-ai-input>`,
			},
			{
				label: 'gl-ai-input disabled + reason',
				render: () =>
					html`<gl-ai-input
						disabled
						disabled-reason="Add files to compose a commit message"
						button-label="Compose"
					></gl-ai-input>`,
			},
			{
				label: 'gl-ai-input detached + footer',
				render: () =>
					html`<gl-ai-input
						appearance="detached"
						button-label="Generate commit message"
						placeholder="Optional guidance for the AI..."
					>
						<span slot="footer">Claude Sonnet 4.5 · 128 tokens</span>
						<button slot="actions" type="button">Discard</button>
					</gl-ai-input>`,
				note: 'The slotted button is intentionally unstyled — gl-ai-input only supplies layout for slot="actions", not a button skin.',
				layout: 'block',
			},
			{
				label: 'gl-ai-input floating footer',
				render: () =>
					html`<gl-ai-input floating-footer placeholder="Explain this line...">
						<span slot="footer">GPT-5 · attached to selection</span>
					</gl-ai-input>`,
				note: 'floating-footer only reveals the footer on :focus-within — this static demo shows the collapsed default state.',
			},
		],
	},
];
