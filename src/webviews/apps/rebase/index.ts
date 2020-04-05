'use strict';
/*global document*/
import {
	onIpcNotification,
	RebaseDidAbortCommandType,
	RebaseDidChangeEntryCommandType,
	RebaseDidChangeNotificationType,
	RebaseDidMoveEntryCommandType,
	RebaseDidStartCommandType,
	RebaseEntry,
	RebaseEntryAction,
	RebaseState,
} from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';

const rebaseActions = ['pick', 'reword', 'edit', 'squash', 'fixup', 'break', 'drop'];
const rebaseActionsMap = new Map<string, RebaseEntryAction>([
	['p', 'pick'],
	['P', 'pick'],
	['r', 'reword'],
	['R', 'reword'],
	['e', 'edit'],
	['E', 'edit'],
	['s', 'squash'],
	['S', 'squash'],
	['f', 'fixup'],
	['F', 'fixup'],
	['b', 'break'],
	['B', 'break'],
	['d', 'drop'],
	['D', 'drop'],
]);

class RebaseEditor extends App<RebaseState> {
	constructor() {
		super('RebaseEditor', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
	}

	protected onInitialize() {
		this.state = this.getState() ?? this.state;
		if (this.state != null) {
			this.refresh(this.state.entries);
		}
	}

	protected onBind() {
		const disposables = super.onBind?.() ?? [];

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const me = this;

		disposables.push(
			DOM.on('[data-action="start"]', 'click', () => this.onStartClicked()),
			DOM.on('[data-action="abort"]', 'click', () => this.onAbortClicked()),
			DOM.on('li[data-ref]', 'keydown', function (this: Element, e: KeyboardEvent) {
				if ((e.target as HTMLElement).matches('select[data-ref')) return;

				if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
					if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
						if (e.altKey) {
							const ref = (this as HTMLLIElement).dataset.ref;
							if (ref) {
								e.stopPropagation();

								me.moveEntry(ref, e.key === 'ArrowDown');
							}
						} else {
							if (me.state == null) return;

							let ref = (this as HTMLLIElement).dataset.ref;
							if (ref == null) return;

							e.preventDefault();

							let index = me.getEntryIndex(ref) + (e.key === 'ArrowDown' ? 1 : -1);
							if (index < 0) {
								index = me.state.entries.length - 1;
							} else if (index === me.state.entries.length) {
								index = 0;
							}

							ref = me.state.entries[index].ref;
							document.querySelectorAll<HTMLLIElement>(`li[data-ref="${ref}`)[0]?.focus();
						}
					}
				} else if (!e.metaKey && !e.altKey && !e.ctrlKey) {
					const action = rebaseActionsMap.get(e.key);
					if (action !== undefined) {
						e.stopPropagation();

						const $select = (this as HTMLLIElement).querySelectorAll<HTMLSelectElement>(
							'select[data-ref]',
						)[0];
						if ($select) {
							$select.value = action;
							me.onSelectChanged($select);
						}
					}
				}
			}),
			DOM.on('select[data-ref]', 'input', function (this: Element) {
				return me.onSelectChanged(this as HTMLSelectElement);
			}),
		);

		return disposables;
	}

	private getEntry(ref: string) {
		return this.state?.entries.find(e => e.ref === ref);
	}

	private getEntryIndex(ref: string) {
		return this.state?.entries.findIndex(e => e.ref === ref) ?? -1;
	}

	private moveEntry(ref: string, down: boolean) {
		const entry = this.getEntry(ref);
		if (entry !== undefined) {
			this.sendCommand(RebaseDidMoveEntryCommandType, {
				ref: entry.ref,
				down: down,
			});
		}
	}

	private setEntryAction(ref: string, action: RebaseEntryAction) {
		const entry = this.getEntry(ref);
		if (entry !== undefined) {
			if (entry.action === action) return;

			this.sendCommand(RebaseDidChangeEntryCommandType, {
				ref: entry.ref,
				action: action,
			});
		}
	}

	private onAbortClicked() {
		this.sendCommand(RebaseDidAbortCommandType, {});
	}

	private onSelectChanged($el: HTMLSelectElement) {
		const ref = $el.dataset.ref;
		if (ref) {
			this.setEntryAction(ref, $el.options[$el.selectedIndex].value as RebaseEntryAction);
		}
	}

	private onStartClicked() {
		this.sendCommand(RebaseDidStartCommandType, {});
	}

	protected onMessageReceived(e: MessageEvent) {
		const msg = e.data;

		switch (msg.method) {
			case RebaseDidChangeNotificationType.method:
				onIpcNotification(RebaseDidChangeNotificationType, msg, params => {
					this.setState(params);
					this.refresh(params.entries);
				});
				break;

			default:
				if (super.onMessageReceived !== undefined) {
					super.onMessageReceived(e);
				}
		}
	}

	private refresh(entries: RebaseEntry[]) {
		const $container = document.getElementById('entries')!;

		const focusRef = document.activeElement?.closest<HTMLLIElement>('li[data-ref]')?.dataset.ref;
		let focusSelect = false;
		if (document.activeElement?.matches('select[data-ref]')) {
			focusSelect = true;
		}

		$container.innerHTML = '';
		if (entries.length === 0) return;

		let tabIndex = 1;

		let prev;
		for (const entry of entries) {
			const $entry = document.createElement('li');
			$entry.classList.add('rebase-entry', `rebase-entry--${entry.action}`);
			$entry.dataset.ref = entry.ref;
			$entry.tabIndex = tabIndex++;

			const $selectContainer = document.createElement('div');
			$selectContainer.classList.add('rebase-entry-action', 'select-container');
			$entry.appendChild($selectContainer);

			const $select = document.createElement('select');
			$select.dataset.ref = entry.ref;
			$select.name = 'action';
			$select.tabIndex = tabIndex++;

			for (const action of rebaseActions) {
				const option = document.createElement('option');
				option.value = action;
				option.text = action;

				if (entry.action === action) {
					option.selected = true;
				}

				$select.appendChild(option);
			}
			$selectContainer.appendChild($select);

			const $message = document.createElement('span');
			$message.classList.add('rebase-entry-message');
			$message.innerText = entry.message;
			$entry.appendChild($message);

			const $ref = document.createElement('span');
			$ref.classList.add('rebase-entry-ref');
			$ref.dataset.prev = prev ? `${prev} \u2190 ` : '';
			$ref.innerText = entry.ref;
			$entry.appendChild($ref);

			$container.appendChild($entry);

			if (entry.action !== 'drop') {
				prev = entry.ref;
			}
		}

		document
			.querySelectorAll<HTMLLIElement>(
				`${focusSelect ? 'select' : 'li'}[data-ref="${focusRef ?? entries[0].ref}"]`,
			)[0]
			?.focus();

		this.bind();
	}
}

new RebaseEditor();
