import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getAltKeySymbol, getCmdKeySymbol, getShiftKeySymbol, isMac } from '@env/platform.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { ChordSymbols } from '@gitlens/utils/keys/chord.js';
import { formatChordParts, parseChord } from '@gitlens/utils/keys/chord.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import type { KeymapDispatcher, KeymapSheetRow } from '../../../shared/keymap/keymapDispatcher.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/dialog.js';

// Platform-aware modifier symbols, matching how `parseChord`/`formatChordParts` resolve `mod` (`meta`
// on macOS, `ctrl` elsewhere) — `ctrl` stays the literal Ctrl label on both platforms since an
// explicit (non-`mod`) `ctrl+` binding means the physical key, not "Ctrl or Cmd".
const chordSymbols: ChordSymbols = {
	ctrl: 'Ctrl',
	alt: getAltKeySymbol(),
	shift: getShiftKeySymbol(),
	meta: getCmdKeySymbol(),
};

// macOS stacks modifier symbols with no separator (⇧↑); elsewhere we join words with `+` (Shift+↑).
const chordSeparator = isMac ? '' : '+';

type SheetGroup = 'navigation' | 'selection' | 'folding' | 'goto' | 'panels' | 'search';

// Render order, left column first — CSS multicol flows the groups in this order.
const groupOrder: readonly SheetGroup[] = ['navigation', 'selection', 'folding', 'goto', 'panels', 'search'];

const groupTitles: Record<SheetGroup, string> = {
	navigation: 'Navigation',
	selection: 'Selection',
	folding: 'Folding',
	goto: 'Go to',
	panels: 'Panels',
	search: 'Search',
};

// Bindings that live outside the keymap registry entirely — owned by chrome elements (the search box,
// the row's Tab-dive handler) or not expressible as a binding (a hold-only modifier, Shift riding
// along on every movement chord, Esc's overlay-stack meaning). New keyboard behavior belongs in a
// binding's `sheet` metadata, NOT here — only add a row here when there's truly no binding to attach
// it to.
const residualRows: readonly KeymapSheetRow[] = [
	{ group: 'navigation', label: "Focus the commit's refs & actions", order: 7, keys: ['Tab'] },
	{
		group: 'selection',
		label: 'Extend the selection',
		order: 1,
		// Not a chord: Shift is declared on each movement binding rather than bound on its own, so
		// the rail spells "Shift + nav" out of literals.
		keys: [`mod:${chordSymbols.shift}`, `sep:${chordSeparator}`, 'text:nav'],
	},
	{ group: 'search', label: 'Next match', order: 3, keys: isMac ? ['F3', 'mod+KeyG'] : ['F3'] },
	{ group: 'search', label: 'Previous match', order: 4, keys: ['shift+F3'] },
	{ group: 'footer', label: 'closes the topmost', order: 1, keys: ['Escape'] },
	{
		group: 'footer',
		label: 'to highlight the lane',
		order: 3,
		keys: ['text:Hold ', 'raw:Ctrl', 'text: or ', 'raw:Alt'],
	},
];

@customElement('gl-graph-keyboard-shortcuts')
export class GlGraphKeyboardShortcuts extends LitElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: contents;
			}

			/* Scoped to [open]: an unconditional display on the part would override the UA's
	   dialog:not([open]) { display: none } and paint the closed sheet inline under the graph. */
			.shortcuts-dialog[open]::part(base) {
				display: flex;
				flex-direction: column;
			}

			.shortcuts-dialog::part(base) {
				/* gl-dialog's own styles don't set box-sizing, so without it here width/max-width
		   size the CONTENT box only — the dialog's padding then pushes the actual box past
		   the max-width at narrow widths. */
				box-sizing: border-box;
				width: 104rem;
				max-width: 96vw;
				max-height: 92vh;
				/* Sections own their own padding (the title bar and footer rules need to sit flush
		   against the dialog edge), so the dialog contributes none. */
				padding: 0;
				overflow: hidden;
			}

			.container {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
				/* The column count responds to the DIALOG's width, not the viewport's — the graph can
		   be docked into a narrow panel while the window stays wide. Sized by the dialog above,
		   so inline-size containment has nothing to circularly resolve. */
				container-type: inline-size;
			}

			.titlebar {
				display: flex;
				gap: var(--gl-space-16);
				align-items: center;
				justify-content: space-between;
				padding: 1.3rem 2rem;
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border);
			}

			.titlebar h2 {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				margin: 0;
				font-size: var(--gl-font-lg);
				font-weight: 600;
			}

			.close {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 2.4rem;
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
				cursor: pointer;
				background: none;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.close:hover {
				color: var(--vscode-foreground);
				background: var(--vscode-toolbar-hoverBackground);
			}

			/* Caps how tall the sheet gets before it scrolls internally; flex + min-height let it give
	   back below that cap when the dialog itself is height-capped by a short viewport. */
			.scrollwrap {
				flex: 1;
				min-height: 0;
				max-height: 76vh;
				overflow: hidden auto;
			}

			.body {
				column-gap: 3.2rem;
				padding: 1.8rem 2rem 1.4rem;
				columns: 3;
			}

			@container (max-width: 88rem) {
				.body {
					columns: 2;
				}
			}

			@container (max-width: 60rem) {
				.body {
					columns: 1;
				}
			}

			.group {
				margin-bottom: 1.7rem;
				break-inside: avoid;
			}

			.group h3 {
				margin: 0 0 0.7rem;
				font-size: 1rem;
				font-weight: 600;
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
				text-transform: uppercase;
				letter-spacing: 0.08em;
			}

			.row {
				display: flex;
				align-items: baseline;
				margin-bottom: 0.45rem;
				font-size: var(--gl-font-md);
			}

			.keys {
				flex: 0 0 12.5rem;
				width: 12.5rem;
				padding-right: 1.1rem;
				text-align: right;
				white-space: nowrap;
			}

			.label {
				flex: 1;
				color: var(--vscode-foreground);
			}

			/* Secondary key sequences get their own line under the label — inline text is for short
	   qualifiers only. */
			.subline {
				display: block;
				margin-top: 0.15rem;
				font-size: 1.02rem;
				color: var(--color-foreground--50, var(--vscode-descriptionForeground));
			}

			.subline kbd {
				padding: 0.1rem 0.4rem;
				font-size: 0.92rem;
			}

			.subline .text {
				font-size: inherit;
				color: inherit;
			}

			kbd {
				display: inline-block;
				padding: 0.15rem 0.5rem;
				font-family: inherit;
				font-size: 1rem;
				color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
				background-color: var(--vscode-keybindingLabel-background, var(--vscode-toolbar-hoverBackground));
				border: var(--gl-border-width) solid var(--vscode-keybindingLabel-border, transparent);
				border-bottom-color: var(
					--vscode-keybindingLabel-bottomBorder,
					var(--vscode-keybindingLabel-border, transparent)
				);
				border-radius: var(--gl-radius-sm);
			}

			/* Modifiers read as hollow so the eye lands on the key that actually names the shortcut. */
			kbd.mod {
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
				background-color: transparent;
			}

			.sep {
				margin: 0 0.12rem;
				font-size: 1rem;
				color: var(--color-foreground--50, var(--vscode-descriptionForeground));
			}

			.text {
				font-size: 1.05rem;
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			}

			.footrow {
				display: flex;
				flex-wrap: wrap;
				gap: 0.8rem 3.2rem;
				justify-content: center;
				padding: 1.2rem 0 1.4rem;
				margin: 0 2rem;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65, var(--vscode-descriptionForeground));
				white-space: nowrap;
				border-top: var(--gl-border-width) solid var(--vscode-widget-border);
			}

			.footrow kbd {
				font-size: 0.95rem;
			}
		`,
	];

	// The dispatcher the sheet renders from — bound by graph-app (`.keymap=${this.keymap}`), so the
	// rows always reflect the live registered bindings.
	@property({ attribute: false })
	keymap: KeymapDispatcher<string> | undefined;

	@state()
	private open = false;

	private _overlay: Disposable | undefined;

	show(): void {
		this.open = true;
		// Join the Esc overlay stack: opened over another overlay (ref-find, minimap zoom), LIFO makes
		// the sheet close FIRST. Without this the dispatcher pops the hidden overlay behind the modal
		// and its preventDefault suppresses the native dialog's own Esc dismissal — a dead-looking press.
		this._overlay ??= this.keymap?.pushOverlay({
			id: 'graph-keyboard-shortcuts',
			onClose: () => {
				this.close();
				return true;
			},
		});
	}

	private close(): void {
		// Dispose covers every close path the dispatcher didn't drive (✕ button, backdrop click).
		this._overlay?.dispose();
		this._overlay = undefined;
		this.open = false;
		// Native dialog close leaves DOM focus on whatever it focused INSIDE the (now closed) dialog —
		// stranding the keyboard on a hidden control. Tell the host so it can land focus somewhere useful.
		this.dispatchEvent(new CustomEvent('gl-graph-keyboard-shortcuts-closed'));
	}

	override render(): unknown {
		const grouped = new Map<string, KeymapSheetRow[]>();
		for (const row of [...(this.keymap?.sheetEntries() ?? []), ...residualRows]) {
			let list = grouped.get(row.group);
			if (list == null) {
				list = [];
				grouped.set(row.group, list);
			}

			list.push(row);
		}

		for (const list of grouped.values()) {
			list.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
		}

		return html`<gl-dialog
			class="shortcuts-dialog"
			modal
			closedby="any"
			label="Keyboard Shortcuts"
			?open=${this.open}
			@gl-dialog-close=${this.close}
		>
			<div class="container">
				<header class="titlebar">
					<h2><code-icon icon="keyboard"></code-icon> Keyboard Shortcuts</h2>
					<button class="close" type="button" aria-label="Close" @click=${this.close}>
						<code-icon icon="close"></code-icon>
					</button>
				</header>
				<div class="scrollwrap scrollable">
					<div class="body">
						${groupOrder
							.filter(group => grouped.has(group))
							.map(group => this.renderGroup(group, grouped.get(group)!))}
					</div>
				</div>
				<div class="footrow">
					${(grouped.get('footer') ?? []).map(
						row => html`<span>${this.renderEntries(row.keys, false)} ${row.label}</span>`,
					)}
				</div>
			</div>
		</gl-dialog>`;
	}

	private renderGroup(group: SheetGroup, rows: readonly KeymapSheetRow[]): unknown {
		return html`<section class="group">
			<h3>${groupTitles[group]}</h3>
			${rows.map(
				row => html`<div class="row">
					<span class="keys">${this.renderEntries(row.keys, true)}</span>
					<span class="label"
						>${row.label}${
							row.subline != null
								? html`<span class="subline">${this.renderEntries(row.subline, false)}</span>`
								: nothing
						}</span
					>
				</div>`,
			)}
		</section>`;
	}

	/** Renders a display-entry list. `spaced` puts a space between adjacent chips — what the keys rail
	 *  wants (`↑ ↓`, `[ ]`) — while sublines and the footer run tight. `sep:`/`text:` entries carry
	 *  their own spacing in their payloads, so nothing is inserted on either side of them. */
	private renderEntries(entries: readonly string[], spaced: boolean): unknown {
		const spacing = (entry: string) => !entry.startsWith('sep:') && !entry.startsWith('text:');

		return entries.map((entry, i) => {
			const gap = spaced && i > 0 && spacing(entry) && spacing(entries[i - 1]);
			return html`${gap ? ' ' : nothing}${this.renderEntry(entry)}`;
		});
	}

	/** Resolves one `SheetDisplayEntry` — see its type for the grammar. */
	private renderEntry(entry: string): unknown {
		if (entry.startsWith('raw:')) return html`<kbd>${entry.slice('raw:'.length)}</kbd>`;

		if (entry.startsWith('mod:')) return html`<kbd class="mod">${entry.slice('mod:'.length)}</kbd>`;

		if (entry.startsWith('text:')) return html`<span class="text">${entry.slice('text:'.length)}</span>`;

		if (entry.startsWith('sep:')) {
			const text = entry.slice('sep:'.length);
			// An empty payload is how the platform-resolved chord separator collapses on macOS.
			return text ? html`<span class="sep">${text}</span>` : nothing;
		}

		const parts = formatChordParts(parseChord(entry, isMac), chordSymbols);
		return parts.map(
			(part, i) =>
				html`${i > 0 && chordSeparator ? html`<span class="sep">${chordSeparator}</span>` : nothing}<kbd
						class=${part.kind === 'mod' ? 'mod' : nothing}
						>${part.text}</kbd
					>`,
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-keyboard-shortcuts': GlGraphKeyboardShortcuts;
	}
}
