'use strict';
/*global document window*/
import '../scss/rebase.scss';
import Sortable from 'sortablejs';
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

const rebaseActions = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
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
	['d', 'drop'],
	['D', 'drop'],
]);

class RebaseEditor extends App<RebaseState> {
	// eslint-disable-next-line no-template-curly-in-string
	private readonly commitTokenRegex = new RegExp(encodeURIComponent('${commit}'));

	constructor() {
		super('RebaseEditor', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
	}

	protected onInitialize() {
		this.state = this.getState() ?? this.state;
		if (this.state != null) {
			this.refresh(this.state);
		}
	}

	protected onBind() {
		const disposables = super.onBind?.() ?? [];

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const me = this;

		const $container = document.getElementById('entries')!;
		Sortable.create($container, {
			animation: 150,
			handle: '.entry-handle',
			filter: '.entry--base',
			dragClass: 'entry--drag',
			ghostClass: 'entry--dragging',
			onChange: () => {
				let squashing = false;
				let squashToHere = false;

				const $entries = document.querySelectorAll<HTMLLIElement>('li[data-ref]');
				for (const $entry of $entries) {
					squashToHere = false;
					if ($entry.classList.contains('entry--squash') || $entry.classList.contains('entry--fixup')) {
						squashing = true;
					} else if (squashing) {
						if (!$entry.classList.contains('entry--drop')) {
							squashToHere = true;
							squashing = false;
						}
					}

					$entry.classList.toggle(
						'entry--squash-to',
						squashToHere && !$entry.classList.contains('entry--base'),
					);
				}
			},
			onEnd: e => {
				if (e.newIndex == null || e.newIndex === e.oldIndex) {
					return;
				}

				const ref = e.item.dataset.ref;
				if (ref != null) {
					this.moveEntry(ref, e.newIndex, false);

					document.querySelectorAll<HTMLLIElement>(`li[data-ref="${ref}"]`)[0]?.focus();
				}
			},
			onMove: e => !e.related.classList.contains('entry--base'),
		});

		if (window.navigator.platform.startsWith('Mac')) {
			let $shortcut = document.querySelector<HTMLSpanElement>('[data-action="start"] .shortcut')!;
			$shortcut.textContent = 'Cmd+Enter';

			$shortcut = document.querySelector<HTMLSpanElement>('[data-action="abort"] .shortcut')!;
			$shortcut.textContent = 'Cmd+A';
		}

		disposables.push(
			DOM.on(window, 'keydown', (e: KeyboardEvent) => {
				if (e.ctrlKey || e.metaKey) {
					if (e.key === 'Enter' || e.key === 'r') {
						e.preventDefault();
						e.stopPropagation();

						this.onStartClicked();
					} else if (e.key === 'a') {
						e.preventDefault();
						e.stopPropagation();

						this.onAbortClicked();
					}
				}
			}),
			DOM.on('[data-action="start"]', 'click', () => this.onStartClicked()),
			DOM.on('[data-action="abort"]', 'click', () => this.onAbortClicked()),
			DOM.on('li[data-ref]', 'keydown', function (this: Element, e: KeyboardEvent) {
				if ((e.target as HTMLElement).matches('select[data-ref]')) {
					if (e.key === 'Escape') {
						(this as HTMLLIElement).focus();
					}

					return;
				}

				if (e.key === 'Enter' || e.key === ' ') {
					const $select = (this as HTMLLIElement).querySelectorAll<HTMLSelectElement>('select[data-ref]')[0];
					if ($select != null) {
						$select.focus();
					}
				} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
					if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
						if (e.altKey) {
							const ref = (this as HTMLLIElement).dataset.ref;
							if (ref) {
								e.stopPropagation();

								me.moveEntry(ref, e.key === 'ArrowDown' ? 1 : -1, true);
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
							document.querySelectorAll<HTMLLIElement>(`li[data-ref="${ref}"]`)[0]?.focus();
						}
					}
				} else if (!e.metaKey && !e.altKey && !e.ctrlKey) {
					const action = rebaseActionsMap.get(e.key);
					if (action !== undefined) {
						e.stopPropagation();

						const $select = (this as HTMLLIElement).querySelectorAll<HTMLSelectElement>(
							'select[data-ref]',
						)[0];
						if ($select != null) {
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

	private moveEntry(ref: string, index: number, relative: boolean) {
		const entry = this.getEntry(ref);
		if (entry !== undefined) {
			this.sendCommand(RebaseDidMoveEntryCommandType, {
				ref: entry.ref,
				to: index,
				relative: relative,
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
					this.setState({ ...this.state, ...params });
					this.refresh(this.state);
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	private refresh(state: RebaseState) {
		const $subhead = document.getElementById('subhead')! as HTMLHeadingElement;
		$subhead.innerHTML = `<span class="branch ml-1 mr-1">${state.branch}</span><span>Rebasing ${
			state.entries.length
		} commit${state.entries.length !== 1 ? 's' : ''} onto <span class="commit">${state.onto}</span>`;

		const $container = document.getElementById('entries')!;

		const focusRef = document.activeElement?.closest<HTMLLIElement>('li[data-ref]')?.dataset.ref;
		let focusSelect = false;
		if (document.activeElement?.matches('select[data-ref]')) {
			focusSelect = true;
		}

		$container.innerHTML = '';
		if (state.entries.length === 0) {
			$container.classList.add('entries--empty');

			const $button = document.querySelector<HTMLButtonElement>('.button[name="start"]');
			if ($button != null) {
				$button.disabled = true;
			}

			const $entry = document.createElement('li');

			const $el = document.createElement('h3');
			$el.innerText = 'No commits to rebase';

			$entry.appendChild($el);
			$container.appendChild($entry);

			return;
		}

		let squashing = false;
		let squashToHere = false;
		let tabIndex = 0;

		for (const entry of state.entries) {
			squashToHere = false;
			if (entry.action === 'squash' || entry.action === 'fixup') {
				squashing = true;
			} else if (squashing) {
				if (entry.action !== 'drop') {
					squashToHere = true;
					squashing = false;
				}
			}

			let $el: HTMLLIElement;
			[$el, tabIndex] = this.createEntry(entry, state, ++tabIndex);

			if (squashToHere) {
				$el.classList.add('entry--squash-to');
			}

			$container.appendChild($el);
		}

		const commit = state.commits.find(c => c.ref.startsWith(state.onto));
		if (commit != null) {
			const [$el] = this.createEntry(
				{
					action: undefined!,
					index: 0,
					message: commit.message.split('\n')[0],
					ref: state.onto,
				},
				state,
				++tabIndex,
			);
			$container.appendChild($el);
		}

		document
			.querySelectorAll<HTMLLIElement>(
				`${focusSelect ? 'select' : 'li'}[data-ref="${focusRef ?? state.entries[0].ref}"]`,
			)[0]
			?.focus();

		this.bind();
	}

	private createEntry(entry: RebaseEntry, state: RebaseState, tabIndex: number): [HTMLLIElement, number] {
		const $entry = document.createElement('li');
		$entry.classList.add('entry', `entry--${entry.action ?? 'base'}`);
		$entry.dataset.ref = entry.ref;

		if (entry.action != null) {
			$entry.tabIndex = tabIndex++;

			const $dragHandle = document.createElement('span');
			$dragHandle.classList.add('entry-handle');
			$entry.appendChild($dragHandle);

			const $selectContainer = document.createElement('div');
			$selectContainer.classList.add('entry-action', 'select-container');
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
		}

		const $message = document.createElement('span');
		$message.classList.add('entry-message');
		$message.innerText = entry.message ?? '';
		$entry.appendChild($message);

		const commit = state.commits.find(c => c.ref.startsWith(entry.ref));
		if (commit != null) {
			$message.title = commit.message ?? '';

			if (commit.author) {
				const author = state.authors.find(a => a.author === commit.author);
				if (author?.avatarUrl.length) {
					const $avatar = document.createElement('img');
					$avatar.classList.add('entry-avatar');
					$avatar.src = author.avatarUrl;
					$entry.appendChild($avatar);
				}

				const $author = document.createElement('span');
				$author.classList.add('entry-author');
				$author.innerText = commit.author;
				$entry.appendChild($author);
			}

			if (commit.dateFromNow) {
				const $date = document.createElement('span');
				$date.title = commit.date ?? '';
				$date.classList.add('entry-date');
				$date.innerText = commit.dateFromNow;
				$entry.appendChild($date);
			}
		}

		const $ref = document.createElement('a');
		$ref.classList.add('entry-ref');
		// $ref.dataset.prev = prev ? `${prev} \u2190 ` : '';
		$ref.href = commit?.ref ? state.commands.commit.replace(this.commitTokenRegex, commit.ref) : '#';
		$ref.innerText = entry.ref;
		$ref.tabIndex = tabIndex++;
		$entry.appendChild($ref);

		return [$entry, tabIndex];
	}
}

new RebaseEditor();
