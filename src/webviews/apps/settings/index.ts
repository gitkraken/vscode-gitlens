'use strict';
/*global window document IntersectionObserver*/
import { IpcMessage, onIpcNotification, SettingsDidRequestJumpToNotificationType, SettingsState } from '../../protocol';
import { AppWithConfig } from '../shared/appWithConfigBase';
import { DOM } from '../shared/dom';

export class SettingsApp extends AppWithConfig<SettingsState> {
	private _scopes: HTMLSelectElement | null = null;
	private _observer: IntersectionObserver | undefined;

	private _activeSection: string | undefined = 'general';
	private _sections = new Map<string, boolean>();

	constructor() {
		super('SettingsApp', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
	}

	protected onInitialize() {
		// Add scopes if available
		const scopes = DOM.getElementById<HTMLSelectElement>('scopes');
		if (scopes && this.state.scopes.length > 1) {
			for (const [scope, text] of this.state.scopes) {
				const option = document.createElement('option');
				option.value = scope;
				option.innerHTML = text;
				if (this.state.scope === scope) {
					option.selected = true;
				}
				scopes.appendChild(option);
			}

			scopes.parentElement!.classList.remove('hidden');
			this._scopes = scopes;
		}

		let top = 83;
		const header = document.querySelector('.page-header--sticky');
		if (header != null) {
			top = header.clientHeight;
		}

		this._observer = new IntersectionObserver(this.onObserver.bind(this), {
			rootMargin: `-${top}px 0px 0px 0px`
		});

		for (const el of document.querySelectorAll('section[id]>.section__header')) {
			this._sections.set(el.parentElement!.id, false);

			this._observer.observe(el);
		}
	}

	protected onBind(me: this) {
		super.onBind(me);

		DOM.listenAll('.section__header', 'click', function(this: HTMLInputElement, e: Event) {
			return me.onSectionHeaderClicked(this, e as MouseEvent);
		});
		DOM.listenAll('a[data-action="jump"]', 'click', function(this: HTMLAnchorElement, e: Event) {
			return me.onJumpToLinkClicked(this, e as MouseEvent);
		});
		DOM.listenAll('[data-action]', 'click', function(this: HTMLAnchorElement, e: Event) {
			return me.onActionLinkClicked(this, e as MouseEvent);
		});
	}

	protected onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case SettingsDidRequestJumpToNotificationType.method:
				onIpcNotification(SettingsDidRequestJumpToNotificationType, msg, params => {
					this.scrollToAnchor(params.anchor);
				});
				break;

			default:
				if (super.onMessageReceived !== undefined) {
					super.onMessageReceived(e);
				}
		}
	}

	private onObserver(entries: IntersectionObserverEntry[], observer: IntersectionObserver) {
		for (const entry of entries) {
			this._sections.set(entry.target.parentElement!.id, entry.isIntersecting);

			let nextActive: string | undefined;
			for (const [id, visible] of this._sections.entries()) {
				if (nextActive === undefined) {
					nextActive = this._activeSection === 'modes' ? 'modes' : id;
				}

				if (!visible) continue;

				nextActive = id;
				break;
			}

			if (this._activeSection === nextActive) return;

			if (this._activeSection !== undefined) {
				this.toggleJumpLink(this._activeSection, false);
			}

			this._activeSection = nextActive;

			if (this._activeSection !== undefined) {
				this.toggleJumpLink(this._activeSection, true);
			}
		}
	}

	protected getSettingsScope(): 'user' | 'workspace' {
		return this._scopes != null
			? (this._scopes.options[this._scopes.selectedIndex].value as 'user' | 'workspace')
			: 'user';
	}

	private onActionLinkClicked(element: HTMLElement, e: MouseEvent) {
		switch (element.dataset.action) {
			case 'collapse':
				for (const el of document.querySelectorAll('.section__header')) {
					el.classList.add('collapsed');
				}

				document.querySelector('[data-action="collapse"]')!.classList.add('hidden');
				document.querySelector('[data-action="expand"]')!.classList.remove('hidden');
				break;

			case 'expand':
				for (const el of document.querySelectorAll('.section__header')) {
					el.classList.remove('collapsed');
				}

				document.querySelector('[data-action="collapse"]')!.classList.remove('hidden');
				document.querySelector('[data-action="expand"]')!.classList.add('hidden');
				break;
		}

		e.preventDefault();
		e.stopPropagation();
	}

	protected onInputSelected(element: HTMLSelectElement) {
		if (element === this._scopes) return;

		super.onInputSelected(element);
	}

	protected onJumpToLinkClicked(element: HTMLAnchorElement, e: MouseEvent) {
		const href = element.getAttribute('href');
		if (href == null) return;

		const anchor = href.substr(1);
		this.scrollToAnchor(anchor);

		e.stopPropagation();
		e.preventDefault();
	}

	private onSectionHeaderClicked(element: HTMLElement, e: MouseEvent) {
		if (
			(e.target as HTMLElement).matches('i.icon__info') ||
			(e.target as HTMLElement).matches('a.link__learn-more')
		) {
			return;
		}

		element.classList.toggle('collapsed');
	}

	private scrollToAnchor(anchor: string) {
		const el = document.getElementById(anchor);
		if (el == null) return;

		let height = 83;

		const header = document.querySelector('.page-header--sticky');
		if (header != null) {
			height = header.clientHeight;
		}

		const top = el.getBoundingClientRect().top - document.body.getBoundingClientRect().top - height;
		window.scrollTo({
			top: top,
			behavior: 'smooth'
		});
	}

	private toggleJumpLink(anchor: string, active: boolean) {
		const el = document.querySelector(`a.sidebar__jump-link[href="#${anchor}"]`);
		if (el) {
			el.classList.toggle('active', active);
		}
	}
}

new SettingsApp();
