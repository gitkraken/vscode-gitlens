/*global document window*/
import './rebase.scss';
import Sortable from 'sortablejs';
import { onIpc } from '../../protocol';
import type { RebaseEntry, RebaseEntryAction, State } from '../../rebase/protocol';
import {
	AbortCommandType,
	ChangeEntryCommandType,
	DidChangeNotificationType,
	DisableCommandType,
	MoveEntryCommandType,
	ReorderCommandType,
	SearchCommandType,
	StartCommandType,
	SwitchCommandType,
} from '../../rebase/protocol';
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

class RebaseEditor extends App<State> {
	private readonly commitTokenRegex = new RegExp(encodeURIComponent(`\${commit}`));

	constructor() {
		super('RebaseEditor');
	}

	protected override onInitialize() {
		this.state = this.getState() ?? this.state;
		if (this.state != null) {
			this.refresh(this.state);
		}
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

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

				const $entries = [...document.querySelectorAll<HTMLLIElement>('li[data-ref]')];
				if (this.state.ascending) {
					$entries.reverse();
				}
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
					let indexTarget = e.newIndex;
					if (this.state.ascending && e.oldIndex) {
						indexTarget = this.getEntryIndex(ref) + (indexTarget - e.oldIndex) * -1;
					}
					this.moveEntry(ref, indexTarget, false);

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
			DOM.on(window, 'keydown', e => {
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
				} else if (e.key === '/') {
					e.preventDefault();
					e.stopPropagation();

					this.onSearch();
				}
			}),
			DOM.on('[data-action="start"]', 'click', () => this.onStartClicked()),
			DOM.on('[data-action="abort"]', 'click', () => this.onAbortClicked()),
			DOM.on('[data-action="disable"]', 'click', () => this.onDisableClicked()),
			DOM.on('[data-action="switch"]', 'click', () => this.onSwitchClicked()),
			DOM.on('li[data-ref]', 'keydown', (e, target: HTMLElement) => {
				if (target.matches('select[data-ref]')) {
					if (e.key === 'Escape') {
						target.focus();
					}

					return;
				}

				if (e.key === 'Enter' || e.key === ' ') {
					if (e.key === 'Enter' && target.matches('a.entry-ref')) {
						return;
					}

					const $select = target.querySelectorAll<HTMLSelectElement>('select[data-ref]')[0];
					if ($select != null) {
						$select.focus();
					}
				} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
					if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
						const advance =
							(e.key === 'ArrowDown' && !this.state.ascending) ||
							(e.key === 'ArrowUp' && this.state.ascending)
								? 1
								: -1;
						if (e.altKey) {
							const ref = target.dataset.ref;
							if (ref) {
								e.stopPropagation();

								this.moveEntry(ref, advance, true);
							}
						} else {
							if (this.state == null) return;

							let ref = target.dataset.ref;
							if (ref == null) return;

							e.preventDefault();

							let index = this.getEntryIndex(ref) + advance;
							if (index < 0) {
								index = this.state.entries.length - 1;
							} else if (index === this.state.entries.length) {
								index = 0;
							}

							ref = this.state.entries[index].ref;
							document.querySelectorAll<HTMLLIElement>(`li[data-ref="${ref}"]`)[0]?.focus();
						}
					}
				} else if (e.key === 'j' || e.key === 'k') {
					if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
						if (this.state == null) return;

						let ref = target.dataset.ref;
						if (ref == null) return;

						e.preventDefault();

						const shouldAdvance = this.state.ascending ? e.key === 'k' : e.key === 'j';
						let index = this.getEntryIndex(ref) + (shouldAdvance ? 1 : -1);
						if (index < 0) {
							index = this.state.entries.length - 1;
						} else if (index === this.state.entries.length) {
							index = 0;
						}

						ref = this.state.entries[index].ref;
						document.querySelectorAll<HTMLLIElement>(`li[data-ref="${ref}"]`)[0]?.focus();
					}
				} else if (e.key === 'J' || e.key === 'K') {
					if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey) {
						const ref = target.dataset.ref;
						if (ref) {
							e.stopPropagation();

							const shouldAdvance = this.state.ascending ? e.key === 'K' : e.key === 'J';
							this.moveEntry(ref, shouldAdvance ? 1 : -1, true);
						}
					}
				} else if (!e.metaKey && !e.altKey && !e.ctrlKey) {
					const action = rebaseActionsMap.get(e.key);
					if (action !== undefined) {
						e.stopPropagation();

						const $select = target.querySelectorAll<HTMLSelectElement>('select[data-ref]')[0];
						if ($select != null && !$select.disabled) {
							$select.value = action;
							this.onSelectChanged($select);
						}
					}
				}
			}),
			DOM.on('select[data-ref]', 'input', (e, target: HTMLSelectElement) => this.onSelectChanged(target)),
			DOM.on('input[data-action="reorder"]', 'input', (e, target: HTMLInputElement) =>
				this.onOrderChanged(target),
			),
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
		if (entry != null) {
			this.sendCommand(MoveEntryCommandType, {
				ref: entry.ref,
				to: index,
				relative: relative,
			});
		}
	}

	private setEntryAction(ref: string, action: RebaseEntryAction) {
		const entry = this.getEntry(ref);
		if (entry != null) {
			if (entry.action === action) return;

			this.sendCommand(ChangeEntryCommandType, {
				ref: entry.ref,
				action: action,
			});
		}
	}

	private onAbortClicked() {
		this.sendCommand(AbortCommandType, undefined);
	}

	private onDisableClicked() {
		this.sendCommand(DisableCommandType, undefined);
	}

	private onSearch() {
		this.sendCommand(SearchCommandType, undefined);
	}

	private onSelectChanged($el: HTMLSelectElement) {
		const ref = $el.dataset.ref;
		if (ref) {
			this.setEntryAction(ref, $el.options[$el.selectedIndex].value as RebaseEntryAction);
		}
	}

	private onStartClicked() {
		this.sendCommand(StartCommandType, undefined);
	}

	private onSwitchClicked() {
		this.sendCommand(SwitchCommandType, undefined);
	}

	private onOrderChanged($el: HTMLInputElement) {
		const isChecked = $el.checked;

		this.sendCommand(ReorderCommandType, {
			ascending: isChecked,
		});
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data;

		switch (msg.method) {
			case DidChangeNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeNotificationType, msg, params => {
					this.setState({ ...this.state, ...params.state });
					this.refresh(this.state);
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	private refresh(state: State) {
		const focusRef = document.activeElement?.closest<HTMLLIElement>('li[data-ref]')?.dataset.ref;
		let focusSelect = false;
		if (document.activeElement?.matches('select[data-ref]')) {
			focusSelect = true;
		}

		const $subhead = document.getElementById('subhead')! as HTMLHeadingElement;
		$subhead.innerHTML = '';

		let $el: HTMLElement | Text = document.createElement('span');
		$el.textContent = state.branch;
		$el.classList.add('icon--branch', 'mr-1');
		$subhead.appendChild($el);

		$el = document.createTextNode(
			`Rebasing ${state.entries.length} commit${state.entries.length !== 1 ? 's' : ''}${
				state.onto ? ' onto' : ''
			}`,
		);
		$subhead.appendChild($el);

		if (state.onto) {
			$el = document.createElement('span');
			$el.textContent = state.onto;
			$el.classList.add('icon--commit');
			$subhead.appendChild($el);
		}

		const $container = document.getElementById('entries')!;
		$container.innerHTML = '';

		if (state.entries.length === 0) {
			$container.classList.add('entries--empty');

			const $button = document.querySelector<HTMLButtonElement>('.button[name="start"]');
			if ($button != null) {
				$button.disabled = true;
			}

			const $entry = document.createElement('li');

			const $el = document.createElement('h3');
			$el.textContent = 'No commits to rebase';

			$entry.appendChild($el);
			$container.appendChild($entry);

			return;
		}

		let squashing = false;
		let squashToHere = false;
		let tabIndex = 0;

		const $entries = document.createDocumentFragment();
		const appendEntries = () => {
			const appendEntry = (entry: RebaseEntry) => {
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
				[$el, tabIndex] = this.createEntry(entry, state, ++tabIndex, squashToHere);

				return $el;
			};

			const entryList = state.entries.map(appendEntry);
			if (state.ascending) {
				entryList.reverse().forEach($el => $entries.appendChild($el));
			} else {
				entryList.forEach($el => $entries.appendChild($el));
			}
		};

		if (!state.ascending) {
			$container.classList.remove('entries--ascending');
			appendEntries();
		}

		if (state.onto) {
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
					false,
				);
				$entries.appendChild($el);
				$container.classList.add('entries--base');
			}
		}

		if (state.ascending) {
			$container.classList.add('entries--ascending');
			appendEntries();
		}

		const $checkbox = document.getElementById('ordering');
		if ($checkbox != null) {
			($checkbox as HTMLInputElement).checked = state.ascending;
		}

		$container.appendChild($entries);

		document
			.querySelectorAll<HTMLLIElement>(
				`${focusSelect ? 'select' : 'li'}[data-ref="${focusRef ?? state.entries[0].ref}"]`,
			)[0]
			?.focus();

		this.bind();
	}

	private createEntry(
		entry: RebaseEntry,
		state: State,
		tabIndex: number,
		squashToHere: boolean,
	): [HTMLLIElement, number] {
		const $entry = document.createElement('li');
		$entry.classList.add('entry', `entry--${entry.action ?? 'base'}`);
		$entry.classList.toggle('entry--squash-to', squashToHere);
		$entry.dataset.ref = entry.ref;

		if (entry.action != null) {
			$entry.tabIndex = 0;

			const $dragHandle = document.createElement('span');
			$dragHandle.classList.add('entry-handle');
			$entry.appendChild($dragHandle);

			const $selectContainer = document.createElement('div');
			$selectContainer.classList.add('entry-action', 'select-container');
			$entry.appendChild($selectContainer);

			const $select = document.createElement('select');
			$select.dataset.ref = entry.ref;
			$select.name = 'action';

			const $options = document.createDocumentFragment();
			for (const action of rebaseActions) {
				const $option = document.createElement('option');
				$option.value = action;
				$option.text = action;

				if (entry.action === action) {
					$option.selected = true;
				}

				$options.appendChild($option);
			}
			$select.appendChild($options);
			$selectContainer.appendChild($select);
		}

		const $message = document.createElement('span');
		$message.classList.add('entry-message');
		$message.textContent = entry.message ?? '';
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
				$author.textContent = commit.author;
				$entry.appendChild($author);
			}

			if (commit.dateFromNow) {
				const $date = document.createElement('span');
				$date.title = commit.date ?? '';
				$date.classList.add('entry-date');
				$date.textContent = commit.dateFromNow;
				$entry.appendChild($date);
			}
		}

		const $ref = document.createElement('a');
		$ref.classList.add('entry-ref', 'icon--commit');
		// $ref.dataset.prev = prev ? `${prev} \u2190 ` : '';
		$ref.href = commit?.ref ? state.commands.commit.replace(this.commitTokenRegex, commit.ref) : '#';
		$ref.textContent = entry.ref.substr(0, 7);
		$entry.appendChild($ref);

		return [$entry, tabIndex];
	}
}

new RebaseEditor();
