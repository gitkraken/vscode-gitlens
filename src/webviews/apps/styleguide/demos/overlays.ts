import { html } from 'lit';
import type { GlMenuPopoverItem } from '../../shared/components/menu/menu-popover.js';
import type { GlDialog } from '../../shared/components/overlays/dialog.js';
import type { GlDragShiftOverlay } from '../../shared/components/overlays/drag-shift-overlay.js';
import type { ComponentGroup } from './types.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/menu/menu-divider.js';
import '../../shared/components/menu/menu-item.js';
import '../../shared/components/menu/menu-label.js';
import '../../shared/components/menu/menu-list.js';
import '../../shared/components/menu/menu-popover.js';
import '../../shared/components/overlays/detail-sheet.js';
import '../../shared/components/overlays/dialog.js';
import '../../shared/components/overlays/drag-shift-overlay.js';
import '../../shared/components/overlays/popover-confirm.js';
import '../../shared/components/overlays/popover.js';
import '../../shared/components/overlays/tooltip.js';

const SORT_MENU_ITEMS: GlMenuPopoverItem[] = [
	{ label: 'Most recent commit date', value: 'date-desc', selected: true },
	{ label: 'Oldest commit date', value: 'date-asc' },
	{ label: 'Author name', value: 'author' },
	{ label: 'Branch name', value: 'branch', disabled: true },
];

const PERIOD_MENU_ITEMS: GlMenuPopoverItem[] = [
	{ label: 'Last 7 days', value: '7d' },
	{ label: 'Last 30 days', value: '30d', selected: true },
	{ label: 'Last 90 days', value: '90d' },
	{ label: 'All time', value: 'all' },
];

// gl-detail-sheet has no declarative open/close — the demo builds and appends one imperatively,
// wiring the built-in close event (and any footer buttons) to remove it again.
function openDetailSheetDemo(
	e: Event,
	options: { title: string; body: string; dismissible?: boolean; footer?: string[] },
): void {
	const stage = (e.currentTarget as HTMLElement).parentElement;
	if (stage == null || stage.querySelector('gl-detail-sheet') != null) return;

	const sheet = document.createElement('gl-detail-sheet');
	sheet.sheetTitle = options.title;
	sheet.dismissible = options.dismissible ?? true;
	sheet.addEventListener('gl-detail-sheet-close', () => sheet.remove());

	const body = document.createElement('p');
	body.textContent = options.body;
	sheet.append(body);

	for (const label of options.footer ?? []) {
		const button = document.createElement('gl-button');
		button.textContent = label;
		button.setAttribute('slot', 'footer');
		button.addEventListener('click', () => sheet.remove());
		sheet.append(button);
	}

	stage.append(sheet);
}

export const overlaysGroups: ComponentGroup[] = [
	{
		family: 'Overlays',
		description: 'Popovers, tooltips, dialogs, and other floating or layered UI anchored to a trigger.',
		demos: [
			{
				label: 'gl-popover (default hover/focus)',
				render: () => html`
					<gl-popover>
						<gl-button slot="anchor">Hover or focus me</gl-button>
						<div slot="content">Renamed 3 files and updated the blame gutter renderer.</div>
					</gl-popover>
				`,
				note: "Opens on hover or focus by default (trigger='hover focus') — no click needed.",
			},
			{
				label: 'gl-popover (click, top-start, no arrow)',
				render: () => html`
					<gl-popover trigger="click" placement="top-start" ?arrow=${false}>
						<gl-button slot="anchor" appearance="secondary">Click for details</gl-button>
						<div slot="content">bug/#3521-blame-gutter — 4 commits, last updated by Eamodio.</div>
					</gl-popover>
				`,
			},
			{
				label: 'gl-popover (appearance=menu, menu-list content)',
				render: () => html`
					<gl-popover appearance="menu" trigger="click" ?arrow=${false} distance="2">
						<gl-button slot="anchor" appearance="toolbar"
							><code-icon icon="kebab-vertical"></code-icon
						></gl-button>
						<menu-list slot="content">
							<menu-item>Cherry-pick commit</menu-item>
							<menu-item>Revert commit</menu-item>
							<menu-divider></menu-divider>
							<menu-item disabled>Squash into previous</menu-item>
						</menu-list>
					</gl-popover>
				`,
				note: 'Shows the [appearance=menu] CSS scoping on the raw primitive — gl-menu-popover (below) is the higher-level component for this pattern.',
			},
			{
				label: 'gl-popover (disabled)',
				render: () => html`
					<gl-popover disabled>
						<gl-button slot="anchor" appearance="secondary" disabled>Hover me (disabled)</gl-button>
						<div slot="content">This popover is disabled and will not open.</div>
					</gl-popover>
				`,
				note: 'disabled=true no-ops on hover/click/focus — nothing will visibly open; shown to pair with the disabled anchor state.',
			},
			{
				label: 'gl-popover (resize=both, auto-size-vertical)',
				render: () => html`
					<gl-popover trigger="click" resize="both" auto-size-vertical>
						<gl-button slot="anchor">Open resizable popover</gl-button>
						<div slot="content">
							Drag the bottom-right corner to resize. Content scrolls once it exceeds the available
							height.
						</div>
					</gl-popover>
				`,
				note: 'Drag grips only render once opened by click — a static view of this demo will not show the drag interaction itself.',
			},
			{
				label: 'gl-tooltip (basic)',
				render: () => html`
					<gl-tooltip content="Blame: 3521c4a authored by Eamodio, 2 days ago">
						<gl-button appearance="secondary">Hover for blame</gl-button>
					</gl-tooltip>
				`,
			},
			{
				label: 'gl-tooltip (placement=right)',
				render: () => html`
					<gl-tooltip
						content="feature/graph-performance — 12 commits ahead of main, last pushed 2026-07-05"
						placement="right"
					>
						<code-icon icon="git-branch"></code-icon>
					</gl-tooltip>
				`,
			},
			{
				label: 'gl-tooltip (disabled)',
				render: () => html`
					<gl-tooltip content="This tooltip is disabled" disabled>
						<gl-button appearance="secondary" disabled>No tooltip</gl-button>
					</gl-tooltip>
				`,
				note: 'disabled=true no-ops on hover/focus — hovering shows nothing; shown to pair with the disabled anchor state.',
			},
			{
				label: 'gl-tooltip (hide-on-click)',
				render: () => html`
					<gl-tooltip content="Copied path: src/git/gitProviderService.ts" hide-on-click>
						<gl-button appearance="toolbar"><code-icon icon="copy"></code-icon></gl-button>
					</gl-tooltip>
				`,
			},
			{
				label: 'gl-tooltip (multi-line content)',
				render: () => html`
					<gl-tooltip content=${'feature/graph-performance\n\nAhead 12 · Behind 3'}>
						<gl-button appearance="secondary">Tracking status</gl-button>
					</gl-tooltip>
				`,
				note: 'A double newline in `content` renders as <hr>, a single newline as <br>.',
			},
			{
				label: 'gl-tooltip (slotted content, overrides content attr)',
				render: () => html`
					<gl-tooltip>
						<gl-button appearance="secondary">Custom body</gl-button>
						<span slot="content"><code-icon icon="pass"></code-icon> All checks passed</span>
					</gl-tooltip>
				`,
			},
			{
				label: 'gl-dialog (modal, discard confirmation)',
				layout: 'block',
				render: () => html`
					<gl-button
						@click=${(e: Event) => ((e.currentTarget as HTMLElement).nextElementSibling as GlDialog).show()}
					>
						Open dialog
					</gl-button>
					<gl-dialog modal>
						<h3>Discard changes?</h3>
						<p>
							This discards 3 uncommitted changes to <code>feature/graph-performance</code>, including
							<code>src/git/gitProviderService.ts</code>.
						</p>
						<gl-button
							appearance="secondary"
							@click=${(e: Event) =>
								(e.currentTarget as HTMLElement).closest<GlDialog>('gl-dialog')?.close()}
						>
							Cancel
						</gl-button>
						<gl-button
							variant="danger"
							@click=${(e: Event) =>
								(e.currentTarget as HTMLElement).closest<GlDialog>('gl-dialog')?.close()}
						>
							Discard
						</gl-button>
					</gl-dialog>
				`,
				note: "Renders closed by default — the trigger calls the dialog's own .show(), which picks showModal() because modal is set.",
			},
			{
				label: 'gl-dialog (non-modal, closedby=none)',
				layout: 'tall',
				framed: true,
				render: () => html`
					<gl-button
						@click=${(e: Event) => ((e.currentTarget as HTMLElement).nextElementSibling as GlDialog).show()}
					>
						Open non-modal dialog
					</gl-button>
					<gl-dialog closedby="none">
						<h3>Rebase in progress</h3>
						<p>
							feature/graph-performance is being rebased onto main. This dialog only closes via the button
							below.
						</p>
						<gl-button
							appearance="secondary"
							@click=${(e: Event) =>
								(e.currentTarget as HTMLElement).closest<GlDialog>('gl-dialog')?.close()}
						>
							Got it
						</gl-button>
					</gl-dialog>
				`,
				note: 'closedby degrades harmlessly if unsupported — non-modal dialogs are not Esc-dismissible by default anyway.',
			},
			{
				label: 'gl-popover-confirm (destructive, danger variant)',
				render: () => html`
					<gl-popover-confirm
						heading="Discard changes?"
						message="This discards uncommitted changes to feature/graph-performance."
						confirm="Discard"
						confirm-variant="danger"
						cancel="Keep changes"
					>
						<gl-button slot="anchor" appearance="secondary">Discard changes</gl-button>
					</gl-popover-confirm>
				`,
			},
			{
				label: 'gl-popover-confirm (warning, initial-focus=cancel)',
				render: () => html`
					<gl-popover-confirm
						heading="Force push to origin?"
						message="bug/#3521-blame-gutter has diverged — this overwrites the remote branch."
						confirm="Force push"
						confirm-variant="warning"
						initial-focus="cancel"
					>
						<gl-button slot="anchor">Force push</gl-button>
					</gl-popover-confirm>
				`,
			},
			{
				label: 'gl-popover-confirm (show-icon=false)',
				render: () => html`
					<gl-popover-confirm
						heading="Delete local tag v1.4.0?"
						confirm="Delete"
						confirm-variant="danger"
						?show-icon=${false}
					>
						<gl-button slot="anchor" appearance="secondary">Delete tag</gl-button>
					</gl-popover-confirm>
				`,
			},
			{
				label: 'gl-popover-confirm (custom icon slot)',
				render: () => html`
					<gl-popover-confirm heading="Archive this repository?" confirm="Archive">
						<gl-button slot="anchor" appearance="secondary">Archive</gl-button>
						<code-icon slot="icon" icon="archive"></code-icon>
					</gl-popover-confirm>
				`,
			},
			{
				label: 'gl-detail-sheet (dismissible, default)',
				layout: 'tall',
				framed: true,
				render: () => html`
					<gl-button
						@click=${(e: Event) =>
							openDetailSheetDemo(e, {
								title: 'Compare branches',
								body: 'Comparing feature/graph-performance against main — 12 commits ahead, 3 behind.',
							})}
					>
						Open detail sheet
					</gl-button>
				`,
				note: 'Fills the bounded stage via position:absolute; inset:0 — close via the built-in chip, Esc, or a scrim click.',
			},
			{
				label: 'gl-detail-sheet (non-dismissible, footer actions)',
				layout: 'tall',
				framed: true,
				render: () => html`
					<gl-button
						@click=${(e: Event) =>
							openDetailSheetDemo(e, {
								title: 'Rebase onto main',
								body: 'Rebasing bug/#3521-blame-gutter onto main. This sheet only closes via the buttons below.',
								dismissible: false,
								footer: ['Continue rebase', 'Abort'],
							})}
					>
						Open non-dismissible detail sheet
					</gl-button>
				`,
				note: 'dismissible=false removes the close chip and disables Esc/scrim dismissal — only the footer buttons close it.',
			},
			{
				label: 'gl-drag-shift-overlay (default hint, auto-hides)',
				render: () => html`
					<gl-button
						@click=${(e: Event) => {
							const overlay = (e.currentTarget as HTMLElement).nextElementSibling as GlDragShiftOverlay;
							overlay.active = true;
							setTimeout(() => {
								overlay.active = false;
							}, 2000);
						}}
					>
						Show drag-shift hint (2s)
					</gl-button>
					<gl-drag-shift-overlay></gl-drag-shift-overlay>
				`,
				note: 'active=false renders nothing until clicked; the hint is a native top-layer popover with pointer-events:none, so it never blocks the page.',
			},
			{
				label: 'gl-drag-shift-overlay (custom label)',
				render: () => html`
					<gl-button
						@click=${(e: Event) => {
							const overlay = (e.currentTarget as HTMLElement).nextElementSibling as GlDragShiftOverlay;
							overlay.active = true;
							setTimeout(() => {
								overlay.active = false;
							}, 2000);
						}}
					>
						Show custom hint (2s)
					</gl-button>
					<gl-drag-shift-overlay label="to keep the file panel open"></gl-drag-shift-overlay>
				`,
			},
		],
	},
	{
		family: 'Menus',
		description: 'Menu list primitives, plus the popover-based menu component built on top of them.',
		demos: [
			{
				label: 'menu-item (selected / default / disabled) in menu-list',
				layout: 'block',
				span: 'third',
				render: () => html`
					<menu-list>
						<menu-item aria-selected="true">Most recent commit date</menu-item>
						<menu-item>Author name</menu-item>
						<menu-item disabled>Branch name</menu-item>
					</menu-list>
				`,
				note: 'menu-item has no useful standalone styling — its hover/selected states and role="option" semantics assume a menu-list ancestor.',
			},
			{
				label: 'menu-item (href link) in menu-list',
				layout: 'block',
				span: 'third',
				render: () => html`
					<menu-list>
						<menu-item href="https://github.com/gitkraken/vscode-gitlens/pull/3521"
							>View pull request #3521</menu-item
						>
						<menu-item href="https://github.com/gitkraken/vscode-gitlens/issues/3521"
							>View issue #3521</menu-item
						>
					</menu-list>
				`,
				note: 'Static only — the links are shown for reference, not meant to be clicked in the styleguide.',
			},
			{
				label: 'menu-item (role=none, non-interactive row) in menu-list',
				layout: 'block',
				span: 'third',
				render: () => html`
					<menu-list>
						<menu-item role="none">
							<code-icon icon="info"></code-icon>
							<span>3 files changed</span>
						</menu-item>
						<menu-divider></menu-divider>
						<menu-item aria-selected="true">Most recent commit date</menu-item>
					</menu-list>
				`,
			},
			{
				label: 'menu-list (flat)',
				layout: 'block',
				span: 'third',
				render: () => html`
					<menu-list>
						<menu-item aria-selected="true">Most recent commit date</menu-item>
						<menu-item>Oldest commit date</menu-item>
						<menu-item>Author name</menu-item>
					</menu-list>
				`,
			},
			{
				label: 'menu-list (grouped, menu-label + menu-divider)',
				layout: 'block',
				span: 'third',
				render: () => html`
					<menu-list>
						<menu-label>Sort by</menu-label>
						<menu-item aria-selected="true">Most recent commit date</menu-item>
						<menu-item>Author name</menu-item>
						<menu-divider></menu-divider>
						<menu-label>Filter</menu-label>
						<menu-item>Only my commits</menu-item>
					</menu-list>
				`,
				note: 'menu-label is a purely static, uppercase section heading — no props to vary.',
			},
			{
				label: 'menu-divider separating plain items in a menu-list',
				layout: 'block',
				span: 'third',
				render: () => html`
					<menu-list>
						<menu-item>Cherry-pick commit</menu-item>
						<menu-divider></menu-divider>
						<menu-item disabled>Revert commit</menu-item>
					</menu-list>
				`,
				note: 'menu-divider has no slot content — visible only via its :host border-top, so it is always shown between menu-items.',
			},
			{
				label: 'gl-menu-popover (sort menu, dismiss on select)',
				render: () => html`
					<gl-menu-popover
						.items=${SORT_MENU_ITEMS}
						@gl-menu-select=${(e: CustomEvent<{ value: string }>) =>
							console.log('sort changed:', e.detail.value)}
					>
						<gl-button slot="anchor" appearance="toolbar"
							><code-icon icon="list-ordered"></code-icon> Sort</gl-button
						>
					</gl-menu-popover>
				`,
				note: 'Selecting an item logs to console here — the component itself fully renders and interacts; only the consumer-side effect is stubbed.',
			},
			{
				label: 'gl-menu-popover (keep-open-on-select)',
				render: () => html`
					<gl-menu-popover .items=${PERIOD_MENU_ITEMS} keep-open-on-select placement="bottom-start">
						<gl-button slot="anchor" appearance="secondary">Timeline period</gl-button>
					</gl-menu-popover>
				`,
			},
			{
				label: 'gl-menu-popover (disabled)',
				render: () => html`
					<gl-menu-popover .items=${SORT_MENU_ITEMS} disabled>
						<gl-button slot="anchor" appearance="toolbar" disabled
							><code-icon icon="list-ordered"></code-icon
						></gl-button>
					</gl-menu-popover>
				`,
				note: 'disabled=true no-ops on click of the anchor — nothing opens; shown to pair with the disabled anchor state.',
			},
		],
	},
];
