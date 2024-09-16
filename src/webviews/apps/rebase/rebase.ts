/*global document window*/
import './rebase.scss';
import { Avatar, AvatarGroup, defineGkElement } from '@gitkraken/shared-web-components';
import Sortable from 'sortablejs';
import type { IpcMessage } from '../../protocol';
import type { RebaseEntry, RebaseEntryAction, State } from '../../rebase/protocol';
import {
	AbortCommand,
	ChangeEntryCommand,
	DidChangeNotification,
	DisableCommand,
	MoveEntryCommand,
	ReorderCommand,
	SearchCommand,
	StartCommand,
	SwitchCommand,
	UpdateSelectionCommand,
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
		defineGkElement(Avatar, AvatarGroup);
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

				const $entries = [...document.querySelectorAll<HTMLLIElement>('li[data-sha]')];
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

				const sha = e.item.dataset.sha;
				if (sha != null) {
					let indexTarget = e.newIndex;
					if (this.state.ascending && e.oldIndex) {
						indexTarget = this.getEntryIndex(sha) + (indexTarget - e.oldIndex) * -1;
					}
					this.moveEntry(sha, indexTarget, false);

					this.setSelectedEntry(sha);
				}
			},
			onMove: e => !e.related.classList.contains('entry--base'),
		});

		// eslint-disable-next-line @typescript-eslint/no-deprecated
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
			DOM.on('li[data-sha]', 'keydown', (e, target: HTMLLIElement) => {
				if (e.target?.matches('select[data-sha]')) {
					if (e.key === 'Escape') {
						target.focus();
					}

					return;
				}

				if (e.key === 'Enter' || e.key === ' ') {
					if (e.key === 'Enter' && e.target?.matches('a.entry-sha')) {
						return;
					}

					const $select = target.querySelectorAll<HTMLSelectElement>('select[data-sha]')[0];
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
							const sha = target.dataset.sha;
							if (sha) {
								e.stopPropagation();

								this.moveEntry(sha, advance, true);
							}
						} else {
							if (this.state == null) return;

							let sha = target.dataset.sha;
							if (sha == null) return;

							e.preventDefault();

							let index = this.getEntryIndex(sha) + advance;
							if (index < 0) {
								index = this.state.entries.length - 1;
							} else if (index === this.state.entries.length) {
								index = 0;
							}

							sha = this.state.entries[index].sha;
							this.setSelectedEntry(sha);
						}
					}
				} else if (e.key === 'j' || e.key === 'k') {
					if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
						if (this.state == null) return;

						let sha = target.dataset.sha;
						if (sha == null) return;

						e.preventDefault();

						const shouldAdvance = this.state.ascending ? e.key === 'k' : e.key === 'j';
						let index = this.getEntryIndex(sha) + (shouldAdvance ? 1 : -1);
						if (index < 0) {
							index = this.state.entries.length - 1;
						} else if (index === this.state.entries.length) {
							index = 0;
						}

						sha = this.state.entries[index].sha;
						this.setSelectedEntry(sha);
					}
				} else if (e.key === 'J' || e.key === 'K') {
					if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey) {
						const sha = target.dataset.sha;
						if (sha) {
							e.stopPropagation();

							const shouldAdvance = this.state.ascending ? e.key === 'K' : e.key === 'J';
							this.moveEntry(sha, shouldAdvance ? 1 : -1, true);
						}
					}
				} else if (!e.metaKey && !e.altKey && !e.ctrlKey) {
					const action = rebaseActionsMap.get(e.key);
					if (action !== undefined) {
						e.stopPropagation();

						const $select = target.querySelectorAll<HTMLSelectElement>('select[data-sha]')[0];
						if ($select != null && !$select.disabled) {
							$select.value = action;
							this.onSelectChanged($select);
						}
					}
				}
			}),
			DOM.on('li[data-sha]', 'focus', (_e, target: HTMLLIElement) => this.onSelectionChanged(target.dataset.sha)),
			DOM.on('select[data-sha]', 'input', (_e, target: HTMLSelectElement) => this.onSelectChanged(target)),
			DOM.on('input[data-action="reorder"]', 'input', (_e, target: HTMLInputElement) =>
				this.onOrderChanged(target),
			),
		);

		return disposables;
	}

	private getEntry(sha: string) {
		return this.state?.entries.find(e => e.sha === sha);
	}

	private getEntryIndex(sha: string) {
		return this.state?.entries.findIndex(e => e.sha === sha) ?? -1;
	}

	private moveEntry(sha: string, index: number, relative: boolean) {
		const entry = this.getEntry(sha);
		if (entry != null) {
			this.sendCommand(MoveEntryCommand, {
				sha: entry.sha,
				to: index,
				relative: relative,
			});
		}
	}

	private setEntryAction(sha: string, action: RebaseEntryAction) {
		const entry = this.getEntry(sha);
		if (entry != null) {
			if (entry.action === action) return;

			this.sendCommand(ChangeEntryCommand, {
				sha: entry.sha,
				action: action,
			});
		}
	}

	private onAbortClicked() {
		this.sendCommand(AbortCommand, undefined);
	}

	private onDisableClicked() {
		this.sendCommand(DisableCommand, undefined);
	}

	private onSearch() {
		this.sendCommand(SearchCommand, undefined);
	}

	private onSelectChanged($el: HTMLSelectElement) {
		const sha = $el.dataset.sha;
		if (sha) {
			this.setEntryAction(sha, $el.options[$el.selectedIndex].value as RebaseEntryAction);
		}
	}

	private onStartClicked() {
		this.sendCommand(StartCommand, undefined);
	}

	private onSwitchClicked() {
		this.sendCommand(SwitchCommand, undefined);
	}

	private onOrderChanged($el: HTMLInputElement) {
		const isChecked = $el.checked;

		this.sendCommand(ReorderCommand, { ascending: isChecked });
	}

	private onSelectionChanged(sha: string | undefined) {
		if (sha == null) return;

		this.sendCommand(UpdateSelectionCommand, { sha: sha });
	}

	private setSelectedEntry(sha: string, focusSelect: boolean = false) {
		window.requestAnimationFrame(() => {
			document.querySelectorAll<HTMLLIElement>(`${focusSelect ? 'select' : 'li'}[data-sha="${sha}"]`)[0]?.focus();
		});
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			case DidChangeNotification.is(msg):
				this.state = msg.params.state;
				this.setState(this.state);
				this.refresh(this.state);
				break;

			default:
				super.onMessageReceived?.(msg);
		}
	}

	private refresh(state: State) {
		const focusRef = document.activeElement?.closest<HTMLLIElement>('li[data-sha]')?.dataset.sha;
		let focusSelect = false;
		if (document.activeElement?.matches('select[data-sha]')) {
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

		if (state.onto != null) {
			$el = document.createElement('span');
			$el.textContent = state.onto.sha;
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

			[$el, tabIndex] = this.createEntry(entry, state, ++tabIndex, squashToHere);

			if (state.ascending) {
				$container.prepend($el);
			} else {
				$container.append($el);
			}
		}

		if (state.onto != null) {
			const commit = state.onto.commit;
			if (commit != null) {
				const [$el] = this.createEntry(
					{
						action: undefined!,
						index: 0,
						message: commit.message,
						sha: state.onto.sha,
					},
					state,
					++tabIndex,
					false,
				);
				if (state.ascending) {
					$container.prepend($el);
				} else {
					$container.appendChild($el);
				}
				$container.classList.add('entries--base');
			}
		}

		$container.classList.toggle('entries--ascending', state.ascending);
		const $checkbox = document.getElementById('ordering');
		if ($checkbox != null) {
			($checkbox as HTMLInputElement).checked = state.ascending;
		}

		this.setSelectedEntry(focusRef ?? state.entries[0].sha, focusSelect);
	}

	private createEntry(
		entry: RebaseEntry,
		state: State,
		tabIndex: number,
		squashToHere: boolean,
	): [HTMLLIElement, number] {
		const $entry = document.createElement('li');
		const action: string = entry.action ?? 'base';
		$entry.classList.add('entry', `entry--${action}`);
		$entry.classList.toggle('entry--squash-to', squashToHere);
		$entry.dataset.sha = entry.sha;

		let $content: HTMLElement = $entry;
		if (action === 'base') {
			$content = document.createElement('div');
			$content.classList.add('entry-blocked');
			$entry.appendChild($content);
		}

		if (entry.action != null) {
			$entry.tabIndex = 0;

			const $dragHandle = document.createElement('span');
			$dragHandle.classList.add('entry-handle');
			$entry.appendChild($dragHandle);

			const $selectContainer = document.createElement('div');
			$selectContainer.classList.add('entry-action', 'select-container');
			$entry.appendChild($selectContainer);

			const $select = document.createElement('select');
			$select.dataset.sha = entry.sha;
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

		const commit = entry.commit;

		const $message = document.createElement('span');
		$message.classList.add('entry-message');
		const message = commit?.message.trim() ?? entry.message.trim();
		$message.textContent = message.replace(/\n+(?:\s+\n+)?/g, ' | ');
		$message.title = message;
		$content.appendChild($message);

		if (commit != null) {
			if (commit.author) {
				const author = state.authors[commit.author];
				const committer = state.authors[commit.committer];
				if (author?.avatarUrl != null || committer?.avatarUrl != null) {
					const $avatarStack = document.createElement('gk-avatar-group');
					$avatarStack.classList.add('entry-avatar');

					const hasAuthor = author?.avatarUrl.length;
					const hasCommitter = author !== committer && author.author !== 'You' && committer?.avatarUrl.length;
					if (hasAuthor) {
						const $avatar = document.createElement('gk-avatar');
						$avatar.src = author.avatarUrl;
						$avatar.ariaLabel = $avatar.title = hasCommitter
							? `Authored by: ${author.author}`
							: author.author;
						$avatarStack.appendChild($avatar);
					}

					if (hasCommitter) {
						const $avatar = document.createElement('gk-avatar');
						$avatar.src = committer.avatarUrl;
						$avatar.ariaLabel = $avatar.title = hasAuthor
							? `Committed by: ${committer.author}`
							: committer.author;
						$avatarStack.appendChild($avatar);
					}

					$entry.appendChild($avatarStack);
				}
			}

			if (commit.dateFromNow) {
				const $date = document.createElement('span');
				$date.title = commit.date ?? '';
				$date.classList.add('entry-date');
				$date.textContent = commit.dateFromNow;
				$entry.appendChild($date);
			}
		}

		const $sha = document.createElement('a');
		$sha.classList.add('entry-sha', 'icon--commit');
		$sha.href = state.commands.commit.replace(this.commitTokenRegex, commit?.sha ?? entry.sha);
		$sha.textContent = entry.sha.substring(0, 7);
		$content.appendChild($sha);

		return [$entry, tabIndex];
	}
}

new RebaseEditor();
