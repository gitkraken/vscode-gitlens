'use strict';
/*global document*/
import {
	AppStateWithConfig,
	DidChangeConfigurationNotificationType,
	IpcMessage,
	onIpcNotification,
	UpdateConfigurationCommandType,
} from '../../protocol';
import { DOM } from './dom';
import { App } from './appBase';
import { Dates } from '../../../system/date';

const dateFormatter = Dates.getFormatter(new Date('Wed Jul 25 2018 19:18:00 GMT-0400'));

export abstract class AppWithConfig<TState extends AppStateWithConfig> extends App<TState> {
	private _changes = Object.create(null) as Record<string, any>;
	private _updating: boolean = false;

	constructor(appName: string, state: TState) {
		super(appName, state);
	}

	protected onInitialized() {
		this.setState();
	}

	protected onBind(me: this) {
		DOM.listenAll('input[type=checkbox][data-setting]', 'change', function (this: HTMLInputElement) {
			return me.onInputChecked(this);
		});
		DOM.listenAll(
			'input[type=text][data-setting], input[type=number][data-setting], input:not([type])[data-setting]',
			'blur',
			function (this: HTMLInputElement) {
				return me.onInputBlurred(this);
			},
		);
		DOM.listenAll(
			'input[type=text][data-setting], input[type=number][data-setting], input:not([type])[data-setting]',
			'focus',
			function (this: HTMLInputElement) {
				return me.onInputFocused(this);
			},
		);
		DOM.listenAll(
			'input[type=text][data-setting][data-setting-preview], input[type=number][data-setting][data-setting-preview]',
			'input',
			function (this: HTMLInputElement) {
				return me.onInputChanged(this);
			},
		);
		DOM.listenAll('select[data-setting]', 'change', function (this: HTMLSelectElement) {
			return me.onInputSelected(this);
		});
		DOM.listenAll('.popup', 'mousedown', function (this: HTMLElement, e: Event) {
			return me.onPopupMouseDown(this, e as MouseEvent);
		});
	}

	protected onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeConfigurationNotificationType.method:
				onIpcNotification(DidChangeConfigurationNotificationType, msg, params => {
					this.state.config = params.config;

					this.setState();
				});
				break;

			default:
				if (super.onMessageReceived !== undefined) {
					super.onMessageReceived(e);
				}
		}
	}

	protected applyChanges() {
		this.sendCommand(UpdateConfigurationCommandType, {
			changes: { ...this._changes },
			removes: Object.keys(this._changes).filter(k => this._changes[k] === undefined),
			scope: this.getSettingsScope(),
		});

		this._changes = Object.create(null) as Record<string, any>;
	}

	protected getSettingsScope(): 'user' | 'workspace' {
		return 'user';
	}

	protected onInputBlurred(element: HTMLInputElement) {
		this.log(`${this.appName}.onInputBlurred: name=${element.name}, value=${element.value}`);

		const popup = document.getElementById(`${element.name}.popup`);
		if (popup != null) {
			popup.classList.add('hidden');
		}

		let value: string | null | undefined = element.value;
		if (value == null || value.length === 0) {
			value = element.dataset.defaultValue;
			if (value === undefined) {
				value = null;
			}
		}

		this._changes[element.name] = element.type === 'number' && value != null ? Number(value) : value;

		// this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
		this.applyChanges();
	}

	protected onInputChanged(element: HTMLInputElement) {
		if (this._updating) return;

		for (const el of document.querySelectorAll<HTMLSpanElement>(`span[data-setting-preview="${element.name}"]`)) {
			this.updatePreview(el, element.value);
		}
	}

	protected onInputChecked(element: HTMLInputElement) {
		if (this._updating) return;

		this.log(
			`${this.appName}.onInputChecked: name=${element.name}, checked=${element.checked}, value=${element.value}`,
		);

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

	protected onInputFocused(element: HTMLInputElement) {
		this.log(`${this.appName}.onInputFocused: name=${element.name}, value=${element.value}`);

		const popup = document.getElementById(`${element.name}.popup`);
		if (popup != null) {
			if (popup.childElementCount === 0) {
				const template = document.querySelector('#token-popup') as HTMLTemplateElement;
				const instance = document.importNode(template.content, true);
				popup.appendChild(instance);
			}
			popup.classList.remove('hidden');
		}
	}

	protected onInputSelected(element: HTMLSelectElement) {
		if (this._updating) return;

		const value = element.options[element.selectedIndex].value;

		this.log(`${this.appName}.onInputSelected: name=${element.name}, value=${value}`);

		this._changes[element.name] = ensureIfBoolean(value);

		this.applyChanges();
	}

	protected onPopupMouseDown(element: HTMLElement, e: MouseEvent) {
		// e.stopPropagation();
		// e.stopImmediatePropagation();
		e.preventDefault();

		const el = e.target as HTMLElement;
		if (el?.matches('[data-token]')) {
			this.onTokenMouseDown(el, e);
		}
	}

	protected onTokenMouseDown(element: HTMLElement, e: MouseEvent) {
		if (this._updating) return;

		this.log(`${this.appName}.onTokenClicked: id=${element.id}`);

		const setting = element.closest('.setting');
		if (setting == null) return;

		const input = setting.querySelector<HTMLInputElement>('input[type=text], input:not([type])');
		if (input == null) return;

		input.value += `\${${element.dataset.token}}`;

		e.stopPropagation();
		e.stopImmediatePropagation();
		e.preventDefault();
	}

	private evaluateStateExpression(expression: string, changes: Record<string, string | boolean>): boolean {
		let state = false;
		for (const expr of expression.trim().split('&')) {
			const [lhs, op, rhs] = parseStateExpression(expr);

			switch (op) {
				case '=': {
					// Equals
					let value = changes[lhs];
					if (value === undefined) {
						value = this.getSettingValue<string | boolean>(lhs) ?? false;
					}
					state = rhs !== undefined ? rhs === String(value) : Boolean(value);
					break;
				}
				case '!': {
					// Not equals
					let value = changes[lhs];
					if (value === undefined) {
						value = this.getSettingValue<string | boolean>(lhs) ?? false;
					}
					// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
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

	private getSettingValue<T>(path: string): T | undefined {
		return get<T>(this.state.config, path);
	}

	private setState() {
		this._updating = true;

		try {
			for (const el of document.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-setting]')) {
				if (el.dataset.settingType === 'array') {
					el.checked = (this.getSettingValue<string[]>(el.name) ?? []).includes(el.value);
				} else if (el.dataset.valueOff != null) {
					const value = this.getSettingValue<string>(el.name);
					el.checked = el.dataset.valueOff !== value;
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
		switch (el.dataset.settingPreviewType) {
			case 'date':
				if (value === undefined) {
					value = this.getSettingValue<string>(el.dataset.settingPreview!);
				}

				if (value == null || value.length === 0) {
					value = el.dataset.settingPreviewDefault;
				}

				el.innerText = value == null ? '' : dateFormatter.format(value);
				break;

			default:
				break;
		}
	}
}

function ensureIfBoolean(value: string | boolean): string | boolean {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return value;
}

function get<T>(o: Record<string, any>, path: string): T | undefined {
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

function parseAdditionalSettingsExpression(expression: string): [string, string | boolean][] {
	const settingsExpression = expression.trim().split(',');
	return settingsExpression.map<[string, string | boolean]>(s => {
		const [setting, value] = s.split('=');
		return [setting, ensureIfBoolean(value)];
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

function fromCheckboxValue(elementValue: any) {
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
