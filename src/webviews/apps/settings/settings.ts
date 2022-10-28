/*global document IntersectionObserver*/
import './settings.scss';
import type { AutolinkReference } from '../../../config';
import type { State } from '../../settings/protocol';
import { AppWithConfig } from '../shared/appWithConfigBase';
import { DOM } from '../shared/dom';
// import { Snow } from '../shared/snow';

const topOffset = 83;

export class SettingsApp extends AppWithConfig<State> {
	private _scopes: HTMLSelectElement | null = null;
	private _observer: IntersectionObserver | undefined;

	private _activeSection: string | undefined = 'general';
	private _sections = new Map<string, boolean>();

	constructor() {
		super('SettingsApp');
	}

	protected override onInitialize() {
		// Add scopes if available
		const scopes = document.getElementById('scopes') as HTMLSelectElement;
		if (scopes != null && this.state.scopes.length > 1) {
			for (const [scope, text] of this.state.scopes) {
				const option = document.createElement('option');
				option.value = scope;
				option.innerHTML = text;
				if (this.state.scope === scope) {
					option.selected = true;
				}
				scopes.appendChild(option);
			}

			scopes.parentElement!.parentElement!.classList.remove('hidden');
			this._scopes = scopes;
		}

		let top = topOffset;
		const header = document.querySelector('.hero__area--sticky');
		if (header != null) {
			top = header.clientHeight;
		}

		this._observer = new IntersectionObserver(this.onObserver.bind(this), {
			rootMargin: `-${top}px 0px 0px 0px`,
		});

		for (const el of document.querySelectorAll('section[id]>.section__header')) {
			this._sections.set(el.parentElement!.id, false);

			this._observer.observe(el);
		}

		for (const el of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
			if (!el.title && el.type === 'checkbox') {
				el.title = `Setting name: "gitlens.${el.name}"`;
			}

			for (const label of document.querySelectorAll<HTMLLabelElement>(`label[for="${el.id}"]`)) {
				if (!label.title) {
					label.title = `Setting name: "gitlens.${el.name}"`;
				}
			}
		}
	}

	protected override beforeUpdateState() {
		const focusId = document.activeElement?.id;
		this.renderAutolinks();
		if (focusId?.startsWith('autolinks.')) {
			console.log(focusId, document.getElementById(focusId));
			queueMicrotask(() => {
				document.getElementById(focusId)?.focus();
			});
		}
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('.section--collapsible>.section__header', 'click', (e, target: HTMLInputElement) =>
				this.onSectionHeaderClicked(target, e),
			),
			DOM.on('.setting--expandable .setting__expander', 'click', (e, target: HTMLInputElement) =>
				this.onSettingExpanderCicked(target, e),
			),
			DOM.on('a[data-action="jump"]', 'mousedown', e => {
				e.stopPropagation();
				e.preventDefault();
			}),
			DOM.on('a[data-action="jump"]', 'click', (e, target: HTMLAnchorElement) =>
				this.onJumpToLinkClicked(target, e),
			),
			DOM.on('[data-action]', 'mousedown', e => {
				e.stopPropagation();
				e.preventDefault();
			}),
			DOM.on('[data-action]', 'click', (e, target: HTMLAnchorElement) => this.onActionLinkClicked(target, e)),
		);

		return disposables;
	}

	protected override scrollToAnchor(anchor: string, behavior: ScrollBehavior): void {
		let offset = topOffset;
		const header = document.querySelector('.hero__area--sticky');
		if (header != null) {
			offset = header.clientHeight;
		}

		super.scrollToAnchor(anchor, behavior, offset);
	}

	private onObserver(entries: IntersectionObserverEntry[], _observer: IntersectionObserver) {
		for (const entry of entries) {
			this._sections.set(entry.target.parentElement!.id, entry.isIntersecting);
		}

		let nextActive: string | undefined;
		for (const [id, visible] of this._sections.entries()) {
			if (visible) {
				nextActive = id;

				break;
			}
		}

		if (nextActive === undefined) {
			if (entries.length !== 1) return;

			const entry = entries[0];
			if (entry.boundingClientRect == null || entry.rootBounds == null) return;

			nextActive = entry.target.parentElement!.id;
			if (entry.boundingClientRect.top >= entry.rootBounds.bottom) {
				const keys = [...this._sections.keys()];
				const index = keys.indexOf(nextActive);
				if (index <= 0) return;

				nextActive = keys[index - 1];
			}
		}

		if (this._activeSection === nextActive) return;

		if (this._activeSection !== undefined) {
			this.toggleJumpLink(this._activeSection, false);
		}

		this._activeSection = nextActive;
		this.toggleJumpLink(this._activeSection, true);
	}

	protected override getSettingsScope(): 'user' | 'workspace' {
		return this._scopes != null
			? (this._scopes.options[this._scopes.selectedIndex].value as 'user' | 'workspace')
			: 'user';
	}

	private onActionLinkClicked(element: HTMLElement, e: MouseEvent) {
		switch (element.dataset.action) {
			case 'collapse':
				for (const el of document.querySelectorAll('.section--collapsible')) {
					el.classList.add('collapsed');
				}

				document.querySelector('[data-action="collapse"]')!.classList.add('hidden');
				document.querySelector('[data-action="expand"]')!.classList.remove('hidden');
				break;

			case 'expand':
				for (const el of document.querySelectorAll('.section--collapsible')) {
					el.classList.remove('collapsed');
				}

				document.querySelector('[data-action="collapse"]')!.classList.remove('hidden');
				document.querySelector('[data-action="expand"]')!.classList.add('hidden');
				break;

			case 'show':
				if (element.dataset.actionTarget) {
					for (const el of document.querySelectorAll(`[data-region="${element.dataset.actionTarget}"]`)) {
						el.classList.remove('hidden');
						el.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
					}
				}
				break;
			case 'hide':
				if (element.dataset.actionTarget) {
					for (const el of document.querySelectorAll(`[data-region="${element.dataset.actionTarget}"]`)) {
						el.classList.add('hidden');
					}
				}
				break;
		}

		e.preventDefault();
		e.stopPropagation();
	}

	protected override onInputSelected(element: HTMLSelectElement) {
		if (element === this._scopes) return;

		super.onInputSelected(element);
	}

	protected onJumpToLinkClicked(element: HTMLAnchorElement, e: MouseEvent) {
		const href = element.getAttribute('href');
		if (href == null) return;

		const anchor = href.substr(1);
		this.scrollToAnchor(anchor, 'smooth');

		e.stopPropagation();
		e.preventDefault();
	}

	private onSectionHeaderClicked(element: HTMLElement, e: MouseEvent) {
		if ((e.target as HTMLElement).matches('a, input, label, i.icon__info')) {
			return;
		}

		element.parentElement!.classList.toggle('collapsed');
	}

	private onSettingExpanderCicked(element: HTMLElement, _e: MouseEvent) {
		element.parentElement!.parentElement!.classList.toggle('expanded');
	}

	private toggleJumpLink(anchor: string, active: boolean) {
		const el = document.querySelector(`a.sidebar__jump-link[href="#${anchor}"]`);
		if (el != null) {
			el.classList.toggle('active', active);
		}
	}

	private renderAutolinks() {
		const $root = document.querySelector('[data-component="autolinks"]');
		if ($root == null) return;

		const helpTemplate = () => `
			<div class="setting__hint">
				<span style="line-height: 2rem">
					<i class="icon icon--sm icon__info"></i> Matches prefixes that are followed by a reference value within commit messages.<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;The URL must contain a <code>&lt;num&gt;</code> for the reference value to be included in the link.
				</span>
			</div>
		`;

		const autolinkTemplate = (index: number, autolink?: AutolinkReference, isNew = false, renderHelp = true) => `
			<div class="setting${isNew ? ' hidden" data-region="autolink' : ''}">
				<div class="setting__group">
					<div class="setting__input setting__input--short setting__input--with-actions">
						<label for="autolinks.${index}.prefix">Prefix</label>
						<input
							id="autolinks.${index}.prefix"
							name="autolinks.${index}.prefix"
							placeholder="TICKET-"
							data-setting
							data-setting-type="arrayObject"
							${autolink?.prefix ? `value="${encodeURIComponent(autolink.prefix)}"` : ''}
						>
						<div class="setting__input-actions">
							<div class="toggle-button">
								<input
									id="autolinks.${index}.ignoreCase"
									name="autolinks.${index}.ignoreCase"
									type="checkbox"
									class="toggle-button__control"
									data-setting
									data-setting-type="arrayObject"
									${autolink?.ignoreCase ? 'checked' : ''}
								>
								<label class="toggle-button__label" for="autolinks.${index}.ignoreCase" title="Case-sensitive" aria-label="Case-sensitive">Aa</label>
							</div>
							<div class="toggle-button">
								<input
									id="autolinks.${index}.alphanumeric"
									name="autolinks.${index}.alphanumeric"
									type="checkbox"
									class="toggle-button__control"
									data-setting
									data-setting-type="arrayObject"
									${autolink?.alphanumeric ? 'checked' : ''}
								>
								<label class="toggle-button__label" for="autolinks.${index}.alphanumeric" title="Alphanumeric" aria-label="Alphanumeric">a1</label>
							</div>
						</div>
					</div>
					<div class="setting__input setting__input--long setting__input--centered">
						<label for="autolinks.${index}.url">URL</label>
						<input
							id="autolinks.${index}.url"
							name="autolinks.${index}.url"
							type="text"
							placeholder="https://example.com/TICKET?q=&lt;num&gt;"
							data-setting
							data-setting-type="arrayObject"
							${autolink?.url ? `value="${encodeURIComponent(autolink.url)}"` : ''}
						>
						${
							isNew
								? `
							<button
								class="button button--compact button--flat-subtle"
								type="button"
								data-action="hide"
								data-action-target="autolink"
								title="Delete"
								aria-label="Delete"
							><i class="codicon codicon-close"></i></button>
						`
								: `
							<button
								id="autolinks.${index}.delete"
								name="autolinks.${index}.delete"
								class="button button--compact button--flat-subtle"
								type="button"
								data-setting-type="arrayObject"
								data-setting-clear
								title="Delete"
								aria-label="Delete"
							><i class="codicon codicon-close"></i></button>
						`
						}
					</div>
				</div>
				${renderHelp && isNew ? helpTemplate() : ''}
			</div>
		`;

		const fragment: string[] = [];
		const autolinks = (this.state.config.autolinks?.length || 0) > 0;
		if (autolinks) {
			this.state.config.autolinks?.forEach((autolink, i) => fragment.push(autolinkTemplate(i, autolink)));
		}

		fragment.push(autolinkTemplate(this.state.config.autolinks?.length ?? 0, undefined, true, !autolinks));

		if (autolinks) {
			fragment.push(helpTemplate());
		}

		$root.innerHTML = fragment.join('');
	}
}

new SettingsApp();
// requestAnimationFrame(() => new Snow());
