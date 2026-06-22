import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AutolinkConfig } from '../../../../config.js';
import { focusOutlineButton } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { CheckDescriptor, SettingsCategory, SettingsGroup, SettingsSearchMatch } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';

export const tagName = 'gl-settings-nav';

/**
 * The grouped category rail. One tab stop; Up/Down/Home/End move between
 * visible categories (roving tabindex) and selection follows focus.
 *
 * Each item shows a non-color on/off cue (filled vs hollow pip + on/total
 * count) for categories with toggleable settings.
 */
@customElement(tagName)
export class GlSettingsNav extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: block;
				padding: var(--gl-space-10) 0;
				overflow-y: auto;
			}

			.group__label {
				padding: 0.6rem 1.4rem 0.5rem;
				margin: 0;
				font-size: 1.05rem;
				font-weight: 400;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}

			.group {
				margin-block-end: var(--gl-space-10);
			}

			.item {
				display: flex;
				gap: var(--gl-space-10);
				align-items: center;
				width: 100%;
				padding: var(--gl-space-8) var(--gl-space-12);
				font-family: var(--vscode-font-family);
				font-size: 1.25rem;
				color: var(--color-foreground);
				text-align: left;
				cursor: pointer;
				background: transparent;
				border: none;
				border-left: 2px solid transparent;
			}

			.item:hover {
				background-color: var(--vscode-list-hoverBackground);
			}

			.item[aria-selected='true'] {
				color: var(--vscode-list-activeSelectionForeground);
				background-color: var(--vscode-list-activeSelectionBackground);
				border-left-color: var(--vscode-focusBorder, var(--vscode-button-background));
			}

			.item:focus-visible {
				${focusOutlineButton}
			}

			.item__pip {
				flex: none;
				width: 0.6rem;
				height: 0.6rem;
				background: transparent;
				border: var(--gl-border-width) solid var(--color-foreground--50);
				border-radius: 50%;
			}

			.item__pip--on {
				background: var(--gl-stat-added, var(--vscode-charts-green));
				border-color: var(--gl-stat-added, var(--vscode-charts-green));
			}

			.item__pip--placeholder {
				visibility: hidden;
			}

			.item__name {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.item__count {
				flex: none;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.05rem;
				color: var(--color-foreground--50);
			}

			.item[aria-selected='true'] .item__count {
				color: inherit;
			}

			.results-count {
				padding: 0.4rem 1.4rem 0.8rem;
				margin: 0;
				font-size: 1.1rem;
				color: var(--color-foreground--50);
			}

			.empty {
				padding: 1.6rem 1.4rem;
				font-size: 1.2rem;
				color: var(--color-foreground--50);
			}

			.empty p {
				margin: 0 0 var(--gl-space-8);
			}

			.sr-only {
				position: absolute;
				width: 1px;
				height: 1px;
				padding: 0;
				margin: -1px;
				overflow: hidden;
				white-space: nowrap;
				border: 0;
				clip: rect(0, 0, 0, 0);
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	onSelect?: (id: string) => void;

	private get searchMatches(): SettingsSearchMatch[] {
		return this._state.searchResults.get();
	}

	/**
	 * Whether a check descriptor reads as "on" — must agree with how the
	 * rendered control derives `checked` (`setting-control`/`masterOn`):
	 * tri-state `valueOff` compares values, everything else is truthiness (so
	 * object-valued settings like `menus` count as on).
	 */
	private isCheckOn(c: CheckDescriptor): boolean {
		const value = this._state.getSettingValue<unknown>(c.key);
		if (c.valueOff !== undefined) {
			// A `null` value renders as indeterminate (neither on nor off) in the control, so it must not count as on
			const current = String(value);
			return value !== null && String(c.valueOff) !== current;
		}
		return Boolean(value);
	}

	/** Count of boolean controls that are on, for the `on/total` cue. */
	private enabledCount(category: SettingsCategory): { on: number; total: number } | undefined {
		let on = 0;
		let total = 0;
		// Complementary `visibleWhen` variants of the same setting must count once
		const seen = new Set<string>();
		const checks = category.master != null ? [category.master, ...category.controls] : category.controls;
		for (const c of checks) {
			if (c.kind !== 'check' || c.type === 'array' || c.type === 'object' || seen.has(c.key)) continue;

			seen.add(c.key);

			total++;
			if (this.isCheckOn(c)) {
				on++;
			}
		}

		return total === 0 ? undefined : { on: on, total: total };
	}

	private isOn(category: SettingsCategory, counts: { on: number; total: number } | undefined): boolean | undefined {
		if (category.master != null) return this.isCheckOn(category.master);
		if (counts == null) return undefined;

		return counts.on > 0;
	}

	/**
	 * On/off + count cues for a category. The dynamic panels get
	 * connection-aware cues (connected/total integrations, autolink rule
	 * count); everything else derives from its boolean controls.
	 */
	private categoryStatus(category: SettingsCategory): {
		on: boolean | undefined;
		count?: { label: string; aria: string };
	} {
		if (category.controls.some(c => c.kind === 'integrations')) {
			const integrations = this._state.cloudIntegrations.get();
			// Still loading — placeholder pip, no count
			if (integrations == null) return { on: undefined };

			const connected = integrations.filter(i => i.connected).length;
			return {
				on: connected > 0,
				count: {
					label: `${connected}/${integrations.length}`,
					aria: `${connected} of ${integrations.length} connected`,
				},
			};
		}

		// Org-disabled AI is forced off regardless of local config — the pip must
		// agree with the panel's "disabled by your admin" note
		if (category.controls.some(c => c.kind === 'ai') && this._state.aiState.get()?.orgEnabled === false) {
			return { on: false };
		}

		if (category.controls.some(c => c.kind === 'autolinks')) {
			const count = this._state.getSettingValue<AutolinkConfig[]>('autolinks')?.length ?? 0;
			return {
				on: count > 0,
				count:
					count > 0 ? { label: `${count}`, aria: `${count} autolink${count === 1 ? '' : 's'}` } : undefined,
			};
		}

		const counts = this.enabledCount(category);
		return {
			on: this.isOn(category, counts),
			count:
				counts != null
					? { label: `${counts.on}/${counts.total}`, aria: `${counts.on} of ${counts.total} on` }
					: undefined,
		};
	}

	private handleKeyDown(e: KeyboardEvent) {
		const items = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button.item')];
		if (!items.length) return;

		const current = items.findIndex(item => item.matches(':focus'));
		let next: number;
		switch (e.key) {
			case 'ArrowDown':
				next = current < 0 ? 0 : (current + 1) % items.length;
				break;
			case 'ArrowUp':
				next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = items.length - 1;
				break;
			default:
				return;
		}

		e.preventDefault();
		const item = items[next];
		item.focus();
		// Selection follows focus (radio-style nav)
		this.onSelect?.(item.dataset.id!);
	}

	// Scroll intent captured in willUpdate (reading signals in updated() would
	// re-subscribe outside the tracked render cycle); applied in updated() so the
	// active item is revealed on deep-link / search-auto-select / persisted restore.
	private _pendingSelectedId?: string;
	private _scrolledSelectedId?: string;

	override willUpdate(): void {
		this._pendingSelectedId = this._state.selectedCategoryId.get();
	}

	override updated(): void {
		if (this._pendingSelectedId !== this._scrolledSelectedId) {
			this._scrolledSelectedId = this._pendingSelectedId;
			this.renderRoot
				.querySelector<HTMLElement>(`button.item[data-id="${this._pendingSelectedId}"]`)
				?.scrollIntoView({ block: 'nearest' });
		}
	}

	override render(): unknown {
		const matches = this.searchMatches;
		const query = this._state.query.get().trim();

		// Polite status so the filter result is announced, not silent — count-only
		// so identical counts across keystrokes don't re-announce on every letter
		const status = query
			? matches.length
				? `${matches.length} matching ${matches.length === 1 ? 'category' : 'categories'}`
				: 'No matching settings'
			: '';
		const liveRegion = html`<div class="sr-only" role="status" aria-live="polite">${status}</div>`;

		if (!matches.length) {
			// Decision 2's escape hatch: a setting that exists but isn't surfaced
			// here (e.g. a key pasted from settings.json) must not dead-end
			// Case-insensitive prefix check to mirror searchSettings' own handling
			const target =
				query.includes(' ') || query.toLowerCase().startsWith('gitlens.') ? query : `gitlens.${query}`;
			return html`${liveRegion}
				<div class="empty">
					<p>No settings match “${query}”.</p>
					<p>
						<a href="command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify(target))}"
							>Open in Settings UI</a
						>
						to search every GitLens setting.
					</p>
				</div>`;
		}

		const selectedId = this._state.selectedCategoryId.get();
		// Roving tabindex: when search filters out the selected category, the
		// first rendered item becomes the tab stop so the rail stays reachable
		const tabStopId = matches.some(m => m.category.id === selectedId) ? selectedId : matches[0].category.id;

		const groups = new Map<SettingsGroup, SettingsSearchMatch[]>();
		for (const match of matches) {
			let group = groups.get(match.category.group);
			if (group == null) {
				group = [];
				groups.set(match.category.group, group);
			}
			group.push(match);
		}

		return html`${liveRegion}
			${query
				? html`<p class="results-count">
						${matches.length} ${matches.length === 1 ? 'category' : 'categories'}
					</p>`
				: nothing}
			<div role="listbox" aria-label="Settings categories" @keydown=${this.handleKeyDown}>
				${Array.from(
					groups.entries(),
					([group, items]) => html`
						<div class="group" role="group" aria-label=${group}>
							<h2 class="group__label" aria-hidden="true">${group}</h2>
							${items.map(m => this.renderItem(m.category, selectedId, tabStopId))}
						</div>
					`,
				)}
			</div>`;
	}

	private renderItem(category: SettingsCategory, selectedId: string, tabStopId: string) {
		const { on, count } = this.categoryStatus(category);
		const selected = category.id === selectedId;

		return html`<button
			type="button"
			class="item"
			role="option"
			data-id=${category.id}
			title=${category.name}
			aria-selected=${selected ? 'true' : 'false'}
			tabindex=${category.id === tabStopId ? 0 : -1}
			@click=${() => this.onSelect?.(category.id)}
		>
			${on === undefined
				? html`<span class="item__pip item__pip--placeholder" aria-hidden="true"></span>`
				: html`<span class="item__pip ${on ? 'item__pip--on' : ''}" aria-hidden="true"></span>`}
			<code-icon icon=${category.icon} aria-hidden="true"></code-icon>
			<span class="item__name">${category.name}</span>
			${category.pro
				? html`<gl-feature-badge
						.source=${{ source: 'settings', detail: 'nav' } as const}
						.subscription=${this._state.subscription.get()}
					></gl-feature-badge>`
				: nothing}
			${count
				? html`<span class="item__count" aria-label=${count.aria}>${count.label}</span>`
				: on !== undefined
					? html`<span class="sr-only">${on ? 'On' : 'Off'}</span>`
					: nothing}
		</button>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSettingsNav;
	}
}
