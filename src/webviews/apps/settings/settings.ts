/*global document IntersectionObserver*/
import './settings.scss';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../commands/cloudIntegrations';
import type { AutolinkConfig } from '../../../config';
import type { IssueIntegrationId, SupportedCloudIntegrationIds } from '../../../constants.integrations';
import type { IpcMessage, UpdateConfigurationParams } from '../../protocol';
import { DidChangeConfigurationNotification, UpdateConfigurationCommand } from '../../protocol';
import type { State } from '../../settings/protocol';
import {
	DidChangeAccountNotification,
	DidChangeConnectedJiraNotification,
	DidOpenAnchorNotification,
	GenerateConfigurationPreviewRequest,
} from '../../settings/protocol';
import { App } from '../shared/appBase';
import { formatDate, setDefaultDateLocales } from '../shared/date';
import { DOM } from '../shared/dom';
import '../shared/components/feature-badge';
import '../shared/components/gitlens-logo';

const topOffset = 83;
const offset = (new Date().getTimezoneOffset() / 60) * 100;
const date = new Date(
	`Wed Jul 25 2018 19:18:00 GMT${offset >= 0 ? '-' : '+'}${String(Math.abs(offset)).padStart(4, '0')}`,
);

export class SettingsApp extends App<State> {
	private _scopes: HTMLSelectElement | null = null;
	private _observer: IntersectionObserver | undefined;

	private _activeSection: string | undefined = 'general';
	private _changes = Object.create(null) as Record<string, any>;
	private _sections = new Map<string, boolean>();
	private _updating: boolean = false;

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

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('input[type=checkbox][data-setting]', 'change', (_e, target: HTMLInputElement) =>
				this.onInputChecked(target),
			),
			DOM.on(
				'input[type=text][data-setting], input[type=number][data-setting], input:not([type])[data-setting]',
				'blur',
				(_e, target: HTMLInputElement) => this.onInputBlurred(target),
			),
			DOM.on(
				'input[type=text][data-setting], input[type=number][data-setting], input:not([type])[data-setting]',
				'focus',
				(_e, target: HTMLInputElement) => this.onInputFocused(target),
			),
			DOM.on(
				'input[type=text][data-setting][data-setting-preview], input[type=number][data-setting][data-setting-preview]',
				'input',
				(_e, target: HTMLInputElement) => this.onInputChanged(target),
			),
			DOM.on('button[data-setting-clear]', 'click', (_e, target: HTMLButtonElement) =>
				this.onButtonClicked(target),
			),
			DOM.on('select[data-setting]', 'change', (_e, target: HTMLSelectElement) => this.onInputSelected(target)),
			DOM.on('.token[data-token]', 'mousedown', (e, target: HTMLElement) => this.onTokenMouseDown(target, e)),
			DOM.on('.section--collapsible>.section__header', 'click', (e, target: HTMLInputElement) =>
				this.onSectionHeaderClicked(target, e),
			),
			DOM.on('.setting--expandable .setting__expander', 'click', (e, target: HTMLInputElement) =>
				this.onSettingExpanderCicked(target, e),
			),
			DOM.on('a[data-action="jump"]', 'mousedown', e => {
				e.target?.focus();
				e.stopPropagation();
				e.preventDefault();
			}),
			DOM.on('a[data-action="jump"]', 'click', (e, target: HTMLAnchorElement) =>
				this.onJumpToLinkClicked(target, e),
			),
			DOM.on('[data-action]', 'mousedown', e => {
				e.target?.focus();
				e.stopPropagation();
				e.preventDefault();
			}),
			DOM.on('[data-action]', 'click', (e, target: HTMLAnchorElement) => this.onActionLinkClicked(target, e)),
		);

		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			case DidOpenAnchorNotification.is(msg):
				this.scrollToAnchor(msg.params.anchor, msg.params.scrollBehavior);
				break;

			case DidChangeConfigurationNotification.is(msg):
				this.state.config = msg.params.config;
				this.state.customSettings = msg.params.customSettings;
				this.state.timestamp = Date.now();
				this.setState(this.state);

				this.updateState();
				break;

			case DidChangeAccountNotification.is(msg):
				this.state.hasAccount = msg.params.hasAccount;
				this.setState(this.state);
				this.renderAutolinkIntegration();
				break;

			case DidChangeConnectedJiraNotification.is(msg):
				this.state.hasConnectedJira = msg.params.hasConnectedJira;
				this.setState(this.state);
				this.renderAutolinkIntegration();
				break;

			default:
				super.onMessageReceived?.(msg);
		}
	}

	private applyChanges() {
		this.sendCommand(UpdateConfigurationCommand, {
			changes: { ...this._changes },
			removes: Object.keys(this._changes).filter(
				(k): k is UpdateConfigurationParams['removes'][0] => this._changes[k] === undefined,
			),
			scope: this.getSettingsScope(),
		});

		this._changes = Object.create(null) as Record<string, any>;
	}

	private getSettingsScope(): 'user' | 'workspace' {
		return this._scopes != null
			? (this._scopes.options[this._scopes.selectedIndex].value as 'user' | 'workspace')
			: 'user';
	}

	private onInputBlurred(element: HTMLInputElement) {
		this.log(`onInputBlurred(${element.name}): value=${element.value})`);

		const $popup = document.getElementById(`${element.name}.popup`);
		if ($popup != null) {
			$popup.classList.add('hidden');
		}

		let value: string | null | undefined = element.value;
		if (value == null || value.length === 0) {
			value = element.dataset.defaultValue;
			if (value === undefined) {
				value = null;
			}
		}

		if (element.dataset.settingType === 'arrayObject') {
			const props = element.name.split('.');
			const settingName = props[0];
			const index = parseInt(props[1], 10);
			const objectProps = props.slice(2);

			let setting: Record<string, any>[] | undefined = this.getSettingValue(settingName);
			if (value == null && (setting === undefined || setting?.length === 0)) {
				if (setting !== undefined) {
					this._changes[settingName] = undefined;
				}
			} else {
				setting = setting ?? [];

				let settingItem = setting[index];
				if (value != null || (value == null && settingItem !== undefined)) {
					if (settingItem === undefined) {
						settingItem = Object.create(null);
						setting[index] = settingItem;
					}

					set(
						settingItem,
						objectProps.join('.'),
						element.type === 'number' && value != null ? Number(value) : value,
					);

					this._changes[settingName] = setting;
				}
			}
		} else {
			this._changes[element.name] = element.type === 'number' && value != null ? Number(value) : value;
		}

		// this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
		this.applyChanges();
	}

	private onButtonClicked(element: HTMLButtonElement) {
		if (element.dataset.settingType === 'arrayObject') {
			const props = element.name.split('.');
			const settingName = props[0];

			const setting = this.getSettingValue<Record<string, any>[]>(settingName);
			if (setting === undefined) return;

			const index = parseInt(props[1], 10);
			if (setting[index] == null) return;

			setting.splice(index, 1);

			this._changes[settingName] = setting.length ? setting : undefined;

			this.applyChanges();
		}
	}

	private onInputChanged(element: HTMLInputElement) {
		if (this._updating) return;

		for (const el of document.querySelectorAll<HTMLSpanElement>(`span[data-setting-preview="${element.name}"]`)) {
			this.updatePreview(el, element.value);
		}
	}

	private onInputChecked(element: HTMLInputElement) {
		if (this._updating) return;

		this.log(`onInputChecked(${element.name}): checked=${element.checked}, value=${element.value})`);

		switch (element.dataset.settingType) {
			case 'object': {
				const props = element.name.split('.');
				const settingName = props.splice(0, 1)[0];
				const setting = this.getSettingValue(settingName) ?? Object.create(null);

				if (element.checked) {
					set(setting, props.join('.'), fromCheckboxValue(element.value));
				} else {
					set(setting, props.join('.'), false);
				}

				this._changes[settingName] = setting;

				break;
			}
			case 'array': {
				const setting = this.getSettingValue(element.name) ?? [];
				if (Array.isArray(setting)) {
					if (element.checked) {
						if (!setting.includes(element.value)) {
							setting.push(element.value);
						}
					} else {
						const i = setting.indexOf(element.value);
						if (i !== -1) {
							setting.splice(i, 1);
						}
					}
					this._changes[element.name] = setting;
				}

				break;
			}
			case 'arrayObject': {
				const props = element.name.split('.');
				const settingName = props[0];
				const index = parseInt(props[1], 10);
				const objectProps = props.slice(2);

				const setting: Record<string, any>[] = this.getSettingValue(settingName) ?? [];

				const settingItem = setting[index] ?? Object.create(null);
				if (setting[index] === undefined) {
					setting[index] = settingItem;
				}

				if (element.checked) {
					set(setting[index], objectProps.join('.'), fromCheckboxValue(element.value));
				} else {
					set(setting[index], objectProps.join('.'), false);
				}

				this._changes[settingName] = setting;

				break;
			}
			case 'custom': {
				this._changes[element.name] = element.checked;

				break;
			}
			default: {
				if (element.checked) {
					this._changes[element.name] = fromCheckboxValue(element.value);
				} else {
					this._changes[element.name] = element.dataset.valueOff == null ? false : element.dataset.valueOff;
				}

				break;
			}
		}

		this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
		this.applyChanges();
	}

	private onInputFocused(element: HTMLInputElement) {
		this.log(`onInputFocused(${element.name}): value=${element.value}`);

		const $popup = document.getElementById(`${element.name}.popup`);
		if ($popup != null) {
			if ($popup.childElementCount === 0) {
				const $template = document.querySelector<HTMLTemplateElement>('#token-popup')?.content.cloneNode(true);
				if ($template != null) {
					$popup.appendChild($template);
				}
			}
			$popup.classList.remove('hidden');
		}
	}

	private onInputSelected(element: HTMLSelectElement) {
		if (element === this._scopes || this._updating) return;

		const value = element.options[element.selectedIndex].value;

		this.log(`onInputSelected(${element.name}): value=${value}`);

		this._changes[element.name] = ensureIfBooleanOrNull(value);

		this.applyChanges();
	}

	private onTokenMouseDown(element: HTMLElement, e: MouseEvent) {
		if (this._updating) return;

		this.log(`onTokenMouseDown(${element.id})`);

		const setting = element.closest('.setting');
		if (setting == null) return;

		const input = setting.querySelector<HTMLInputElement>('input[type=text], input:not([type])');
		if (input == null) return;

		const token = `\${${element.dataset.token}}`;
		let selectionStart = input.selectionStart;
		if (selectionStart != null) {
			input.value = `${input.value.substring(0, selectionStart)}${token}${input.value.substring(
				input.selectionEnd ?? selectionStart,
			)}`;

			selectionStart += token.length;
		} else {
			selectionStart = input.value.length;
		}

		input.focus();
		input.setSelectionRange(selectionStart, selectionStart);
		if (selectionStart === input.value.length) {
			input.scrollLeft = input.scrollWidth;
		}

		setTimeout(() => this.onInputChanged(input), 0);
		setTimeout(() => input.focus(), 250);

		e.stopPropagation();
		e.stopImmediatePropagation();
		e.preventDefault();
	}

	private scrollToAnchor(anchor: string, behavior: ScrollBehavior, offset?: number) {
		offset = topOffset;
		const header = document.querySelector('.hero__area--sticky');
		if (header != null) {
			offset = header.clientHeight;
		}

		const el = document.getElementById(anchor);
		if (el == null) return;

		this.scrollTo(el, behavior, offset);
	}

	private _scrollTimer: ReturnType<typeof setTimeout> | undefined;
	private scrollTo(el: HTMLElement, behavior: ScrollBehavior, offset?: number) {
		const top = el.getBoundingClientRect().top - document.body.getBoundingClientRect().top - (offset ?? 0);

		window.scrollTo({
			top: top,
			behavior: behavior ?? 'smooth',
		});

		const fn = () => {
			if (this._scrollTimer != null) {
				clearTimeout(this._scrollTimer);
			}

			this._scrollTimer = setTimeout(() => {
				window.removeEventListener('scroll', fn);

				const newTop =
					el.getBoundingClientRect().top - document.body.getBoundingClientRect().top - (offset ?? 0);
				if (Math.abs(top - newTop) < 2) {
					el.focus({ preventScroll: true });
					return;
				}

				this.scrollTo(el, behavior, offset);
			}, 50);
		};

		window.addEventListener('scroll', fn, false);
	}

	private evaluateStateExpression(expression: string, changes: Record<string, string | boolean>): boolean {
		let state = false;
		for (const expr of expression.trim().split('&')) {
			const [lhs, op, rhs] = parseStateExpression(expr);

			switch (op) {
				case '=': {
					// Equals
					let value: string | boolean | null | undefined = changes[lhs];
					if (value === undefined) {
						value = this.getSettingValue<string | boolean>(lhs);
						if (value === undefined || (value === null && typeof rhs !== 'string')) {
							value = false;
						}
					}
					state = rhs !== undefined ? rhs === String(value) : Boolean(value);
					break;
				}
				case '!': {
					// Not equals
					let value: string | boolean | null | undefined = changes[lhs];
					if (value === undefined) {
						value = this.getSettingValue<string | boolean>(lhs);
						if (value === undefined || (value === null && typeof rhs !== 'string')) {
							value = false;
						}
					}
					state = rhs !== undefined ? rhs !== String(value) : !value;
					break;
				}
				case '+': {
					// Contains
					if (rhs !== undefined) {
						const setting = this.getSettingValue<string[]>(lhs);
						state = setting !== undefined ? setting.includes(rhs.toString()) : false;
					}
					break;
				}
			}

			if (!state) break;
		}
		return state;
	}

	private getCustomSettingValue(path: string): boolean | undefined {
		return this.state.customSettings?.[path];
	}

	private getSettingValue<T>(path: string): T | undefined {
		const customSetting = this.getCustomSettingValue(path);
		if (customSetting != null) return customSetting as unknown as T;

		return get<T>(this.state.config, path);
	}

	private updateState() {
		const { version } = this.state;
		document.getElementById('version')!.textContent = version;

		const focusId = document.activeElement?.id;
		this.renderAutolinkIntegration();
		this.renderAutolinks();
		if (focusId?.startsWith('autolinks.')) {
			console.log(focusId, document.getElementById(focusId));
			queueMicrotask(() => {
				document.getElementById(focusId)?.focus();
			});
		}

		this._updating = true;

		setDefaultDateLocales(this.state.config.defaultDateLocale);

		try {
			for (const el of document.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-setting]')) {
				if (el.dataset.settingType === 'custom') {
					el.checked = this.getCustomSettingValue(el.name) ?? false;
				} else if (el.dataset.settingType === 'array') {
					el.checked = (this.getSettingValue<string[]>(el.name) ?? []).includes(el.value);
				} else if (el.dataset.valueOff != null) {
					const value = this.getSettingValue<string>(el.name);
					el.checked = el.dataset.valueOff !== value;
					el.indeterminate = value === null;
				} else {
					el.checked = this.getSettingValue<boolean>(el.name) ?? false;
				}
			}

			for (const el of document.querySelectorAll<HTMLInputElement>(
				'input[type=text][data-setting], input[type=number][data-setting], input:not([type])[data-setting]',
			)) {
				el.value = this.getSettingValue<string>(el.name) ?? '';
			}

			for (const el of document.querySelectorAll<HTMLSelectElement>('select[data-setting]')) {
				const value = this.getSettingValue<string>(el.name);
				const option = el.querySelector<HTMLOptionElement>(`option[value='${value}']`);
				if (option != null) {
					option.selected = true;
				}
			}

			for (const el of document.querySelectorAll<HTMLSpanElement>('span[data-setting-preview]')) {
				this.updatePreview(el);
			}
		} finally {
			this._updating = false;
		}

		const state = flatten(this.state.config);
		if (this.state.customSettings != null) {
			for (const [key, value] of Object.entries(this.state.customSettings)) {
				state[key] = value;
			}
		}
		this.setVisibility(state);
		this.setEnablement(state);
	}

	private setAdditionalSettings(expression: string | undefined) {
		if (!expression) return;

		const addSettings = parseAdditionalSettingsExpression(expression);
		for (const [s, v] of addSettings) {
			this._changes[s] = v;
		}
	}

	private setEnablement(state: Record<string, string | boolean>) {
		for (const el of document.querySelectorAll<HTMLElement>('[data-enablement]')) {
			const disabled = !this.evaluateStateExpression(el.dataset.enablement!, state);
			if (disabled) {
				el.setAttribute('disabled', '');
			} else {
				el.removeAttribute('disabled');
			}

			if (el.matches('input,select')) {
				(el as HTMLInputElement | HTMLSelectElement).disabled = disabled;
			} else {
				const input = el.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
				if (input == null) continue;

				input.disabled = disabled;
			}
		}
	}

	private setVisibility(state: Record<string, string | boolean>) {
		for (const el of document.querySelectorAll<HTMLElement>('[data-visibility]')) {
			el.classList.toggle('hidden', !this.evaluateStateExpression(el.dataset.visibility!, state));
		}
	}

	private updatePreview(el: HTMLSpanElement, value?: string) {
		const previewType = el.dataset.settingPreviewType;
		switch (previewType) {
			case 'date': {
				if (value === undefined) {
					value = this.getSettingValue<string>(el.dataset.settingPreview!);
				}

				if (!value) {
					const lookup = el.dataset.settingPreviewDefaultLookup;
					if (lookup != null) {
						value = this.getSettingValue<string>(lookup);
					}
					if (value == null) {
						value = el.dataset.settingPreviewDefault;
					}
				}

				el.innerText = value == null ? '' : formatDate(date, value, undefined, false);
				break;
			}
			case 'date-locale': {
				if (value === undefined) {
					value = this.getSettingValue<string>(el.dataset.settingPreview!);
				}

				if (!value) {
					value = undefined;
				}

				const format = this.getSettingValue<string>(el.dataset.settingPreviewDefault!) ?? 'MMMM Do, YYYY h:mma';
				try {
					el.innerText = formatDate(date, format, value, false);
				} catch (ex) {
					el.innerText = ex.message;
				}
				break;
			}
			case 'commit':
			case 'commit-uncommitted': {
				if (value === undefined) {
					value = this.getSettingValue<string>(el.dataset.settingPreview!);
				}

				if (!value) {
					value = el.dataset.settingPreviewDefault;
					if (value == null) {
						const lookup = el.dataset.settingPreviewDefaultLookup;
						if (lookup != null) {
							value = this.getSettingValue<string>(lookup);
						}
					}
				}

				if (value == null) {
					el.innerText = '';

					return;
				}

				void this.sendRequest(GenerateConfigurationPreviewRequest, {
					key: el.dataset.settingPreview!,
					type: previewType,
					format: value,
				}).then(params => {
					el.innerText = params.preview ?? '';
				});

				break;
			}
			default:
				break;
		}
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

	private onJumpToLinkClicked(element: HTMLAnchorElement, e: MouseEvent) {
		const href = element.getAttribute('href');
		if (href == null) return;

		const anchor = href.substring(1);
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

	private renderAutolinkIntegration() {
		const $root = document.querySelector('[data-component="autolink-integration"]');
		if ($root == null) return;

		const { hasAccount, hasConnectedJira } = this.state;
		let message = `<a href="command:gitlens.plus.cloudIntegrations.connect?${encodeURIComponent(
			JSON.stringify({
				integrationIds: ['jira' as IssueIntegrationId.Jira] as SupportedCloudIntegrationIds[],
				source: 'settings',
				detail: {
					action: 'connect',
					integration: 'jira',
				},
			} satisfies ConnectCloudIntegrationsCommandArgs),
		)}">Connect to Jira Cloud</a> &mdash; ${
			hasAccount ? '' : 'sign up and '
		}get access to automatic rich Jira autolinks.`;
		if (hasAccount && hasConnectedJira) {
			message =
				'<i class="codicon codicon-check" style="vertical-align: text-bottom"></i> Jira connected &mdash; automatic rich Jira autolinks are enabled.';
		}

		$root.innerHTML = message;
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

		const autolinkTemplate = (index: number, autolink?: AutolinkConfig, isNew = false, renderHelp = true) => `
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

function ensureIfBooleanOrNull(value: string | boolean): string | boolean | null {
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (value === 'null') return null;
	return value;
}

function get<T>(o: Record<string, any>, path: string): T | undefined {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return path.split('.').reduce((o = {}, key) => (o == null ? undefined : o[key]), o) as T;
}

function set(o: Record<string, any>, path: string, value: any): Record<string, any> {
	const props = path.split('.');
	const length = props.length;
	const lastIndex = length - 1;

	let index = -1;
	let nested = o;

	while (nested != null && ++index < length) {
		const key = props[index];
		let newValue = value;

		if (index !== lastIndex) {
			const objValue = nested[key];
			newValue = typeof objValue === 'object' ? objValue : {};
		}

		nested[key] = newValue;
		nested = nested[key];
	}

	return o;
}

function parseAdditionalSettingsExpression(expression: string): [string, string | boolean | null][] {
	const settingsExpression = expression.trim().split(',');
	return settingsExpression.map<[string, string | boolean | null]>(s => {
		const [setting, value] = s.split('=');
		return [setting, ensureIfBooleanOrNull(value)];
	});
}

function parseStateExpression(expression: string): [string, string, string | boolean | undefined] {
	const [lhs, op, rhs] = expression.trim().split(/([=+!])/);
	return [lhs.trim(), op !== undefined ? op.trim() : '=', rhs !== undefined ? rhs.trim() : rhs];
}

function flatten(o: Record<string, any>, path?: string): Record<string, any> {
	const results: Record<string, any> = {};

	for (const key in o) {
		const value = o[key];
		if (Array.isArray(value)) continue;

		if (typeof value === 'object') {
			Object.assign(results, flatten(value, path === undefined ? key : `${path}.${key}`));
		} else {
			results[path === undefined ? key : `${path}.${key}`] = value;
		}
	}

	return results;
}

function fromCheckboxValue(elementValue: unknown) {
	switch (elementValue) {
		case 'on':
			return true;
		case 'null':
			return null;
		case 'undefined':
			return undefined;
		default:
			return elementValue;
	}
}

new SettingsApp();
