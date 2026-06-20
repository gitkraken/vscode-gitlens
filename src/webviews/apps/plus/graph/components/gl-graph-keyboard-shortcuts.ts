import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getAltKeySymbol, getCmdKeySymbol, getShiftKeySymbol, isMac } from '@env/platform.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/dialog.js';

// Platform-aware modifier labels — symbols on macOS, words elsewhere.
const ctrlOrCmd = getCmdKeySymbol();
const alt = getAltKeySymbol();
const shift = getShiftKeySymbol();

// macOS stacks modifier symbols with no separator (⇧↑); elsewhere we join words with `+` (Shift+↑).
const chordSeparator = isMac ? '' : '+';

/** A single key chord, e.g. `['⌘', 'F']` — rendered as one chip joining its keys. */
type Chord = string[];
type Shortcut = { chords: Chord[]; description: string };
type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

// Mirrors the verified handlers: gitkraken-components GraphContainer keydown (navigation),
// gl-graph.react (open), search-box/search-input (search), gl-commit-box (commit), hover/minimap (Esc).
const groups: ShortcutGroup[] = [
	{
		title: 'Navigation',
		shortcuts: [
			{ chords: [['↑'], ['↓']], description: 'Select previous / next commit' },
			{ chords: [['←'], ['→']], description: 'Select next / previous commit (non-topological)' },
			{
				chords: [
					[shift, '↑'],
					[shift, '↓'],
				],
				description: 'Extend selection up / down',
			},
			{
				chords: [
					[ctrlOrCmd, '↑'],
					[ctrlOrCmd, '↓'],
				],
				description: 'Select topologically (follow branch lineage)',
			},
			{
				chords: [
					[alt, '↑'],
					[alt, '↓'],
				],
				description: 'Select previous / next branching point',
			},
			{ chords: [['Home'], ['End']], description: 'Select first / last commit' },
			{ chords: [['PgUp'], ['PgDn']], description: 'Move selection up / down a page' },
			{
				chords: [
					[alt, 'PgUp'],
					[alt, 'PgDn'],
				],
				description: 'Select previous / next ref',
			},
			{ chords: [['H']], description: 'Select HEAD commit' },
		],
	},
	{
		title: 'Open',
		shortcuts: [
			{ chords: [['Enter']], description: 'Open the selected commit' },
			{ chords: [['Space']], description: 'Open commit, keep focus in graph' },
		],
	},
	{
		title: 'Search',
		shortcuts: [
			{ chords: [[ctrlOrCmd, 'F']], description: 'Focus the search box' },
			{
				chords: isMac ? [['F3'], [ctrlOrCmd, 'G']] : [['F3']],
				description: 'Go to next match (hold Shift for previous)',
			},
			{ chords: [['Enter'], [shift, 'Enter']], description: 'Next / previous match (in search box)' },
			{ chords: [['↑'], ['↓']], description: 'Search history & autocomplete (in search box)' },
			{ chords: [['Esc']], description: 'Cancel the search' },
		],
	},
	{
		title: 'Commit',
		shortcuts: [{ chords: [[ctrlOrCmd, 'Enter']], description: 'Commit staged changes (in commit box)' }],
	},
	{
		title: 'Other',
		shortcuts: [{ chords: [['Esc']], description: 'Close hover, dismiss error, or exit minimap zoom' }],
	},
];

@customElement('gl-graph-keyboard-shortcuts')
export class GlGraphKeyboardShortcuts extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		.shortcuts-dialog::part(base) {
			width: 56rem;
			max-width: 90vw;
		}

		.container {
			display: flex;
			flex-direction: column;
			gap: 1.4rem;
		}

		.header {
			display: flex;
			gap: var(--gl-space-16);
			align-items: center;
			justify-content: space-between;
		}

		.header h2 {
			display: flex;
			gap: var(--gl-space-8);
			align-items: center;
			margin: 0;
			font-size: 1.5rem;
			font-weight: 600;
		}

		.close {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: var(--gl-space-4);
			color: inherit;
			cursor: pointer;
			background: none;
			border: none;
			border-radius: var(--gl-radius-sm);
		}

		.close:hover {
			background: var(--vscode-toolbar-hoverBackground);
		}

		.groups {
			column-count: 2;
			column-gap: var(--gl-space-24);
		}

		.group {
			margin-bottom: var(--gl-space-12);
			break-inside: avoid;
		}

		.group:last-child {
			margin-bottom: 0;
		}

		.group h3 {
			margin: 0 0 var(--gl-space-4);
			font-size: var(--gl-font-sm);
			font-weight: 600;
			color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			text-transform: uppercase;
			letter-spacing: 0.05rem;
		}

		.rows {
			display: grid;
			grid-template-columns: max-content 1fr;
			gap: var(--gl-space-4) var(--gl-space-10);
			align-items: baseline;
		}

		.keys {
			display: inline-flex;
			flex-wrap: wrap;
			gap: var(--gl-space-6);
		}

		kbd {
			display: inline-block;
			min-width: 1.6rem;
			padding: 0.1rem 0.4rem;
			font-family: inherit;
			font-size: var(--gl-font-sm);
			line-height: 1.5;
			color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
			text-align: center;
			background-color: var(--vscode-keybindingLabel-background, var(--vscode-toolbar-hoverBackground));
			border: var(--gl-border-width) solid var(--vscode-keybindingLabel-border, transparent);
			border-bottom-color: var(
				--vscode-keybindingLabel-bottomBorder,
				var(--vscode-keybindingLabel-border, transparent)
			);
			border-radius: var(--gl-radius-sm);
		}

		.desc {
			font-size: var(--gl-font-md);
			color: var(--color-foreground--75, var(--vscode-foreground));
		}

		.footnote {
			margin: 0;
			font-size: var(--gl-font-sm);
			color: var(--color-foreground--65, var(--vscode-descriptionForeground));
		}
	`;

	@state()
	private open = false;

	show(): void {
		this.open = true;
	}

	private close(): void {
		this.open = false;
	}

	override render(): unknown {
		return html`<gl-dialog
			class="shortcuts-dialog"
			modal
			closedby="any"
			?open=${this.open}
			@gl-dialog-close=${this.close}
		>
			<div class="container">
				<header class="header">
					<h2><code-icon icon="keyboard"></code-icon> Keyboard Shortcuts</h2>
					<button class="close" type="button" aria-label="Close" @click=${this.close}>
						<code-icon icon="close"></code-icon>
					</button>
				</header>
				<div class="groups">${groups.map(g => this.renderGroup(g))}</div>
				<p class="footnote">Shortcuts apply while the Commit Graph has focus.</p>
			</div>
		</gl-dialog>`;
	}

	private renderGroup(group: ShortcutGroup): unknown {
		return html`<section class="group">
			<h3>${group.title}</h3>
			<div class="rows">
				${group.shortcuts.map(
					s =>
						html`<span class="keys">${s.chords.map(c => this.renderChord(c))}</span>
							<span class="desc">${s.description}</span>`,
				)}
			</div>
		</section>`;
	}

	private renderChord(chord: Chord): unknown {
		return html`<kbd>${chord.join(chordSeparator)}</kbd>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-keyboard-shortcuts': GlGraphKeyboardShortcuts;
	}
}
