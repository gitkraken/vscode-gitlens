/*global*/
import type { HierarchicalItem } from '../../../system/array';
import { makeHierarchical } from '../../../system/array';
import type { Serialized } from '../../../system/serialize';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { CommitActionsParams, State } from '../../commitDetails/protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	DidChangeStateNotificationType,
	FileActionsCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	PinCommitCommandType,
	PreferencesCommandType,
	SearchCommitCommandType,
} from '../../commitDetails/protocol';
import { App } from '../shared/appBase';
import type { FileChangeListItem, FileChangeListItemDetail } from '../shared/components/list/file-change-list-item';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../shared/components/webview-pane';
import { DOM } from '../shared/dom';
import './commitDetails.scss';
import '../shared/components/codicon';
import '../shared/components/commit/commit-identity';
import '../shared/components/formatted-date';
import '../shared/components/rich/issue-pull-request';
import '../shared/components/skeleton-loader';
import '../shared/components/commit/commit-stats';
import '../shared/components/webview-pane';
import '../shared/components/progress';
import '../shared/components/list/list-container';
import '../shared/components/list/list-item';
import '../shared/components/list/file-change-list-item';

const uncommittedSha = '0000000000000000000000000000000000000000';

type CommitState = SomeNonNullable<Serialized<State>, 'selected'>;

export class CommitDetailsApp extends App<Serialized<State>> {
	constructor() {
		super('CommitDetailsApp');
		this.log('CommitDetailsApp', this.state);
	}

	override onInitialize() {
		this.log('CommitDetailsApp.onInitialize', this.state);
		this.renderContent();
	}

	override onBind() {
		const disposables = [
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-open-on-remote', e =>
				this.onOpenFileOnRemote(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-open', e =>
				this.onOpenFile(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-compare-working', e =>
				this.onCompareFileWithWorking(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-compare-previous', e =>
				this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-more-actions', e =>
				this.onFileMoreActions(e.detail),
			),
			DOM.on('[data-action="commit-actions"]', 'click', e => this.onCommitActions(e)),
			DOM.on('[data-action="pick-commit"]', 'click', e => this.onPickCommit(e)),
			DOM.on('[data-action="search-commit"]', 'click', e => this.onSearchCommit(e)),
			DOM.on('[data-action="autolink-settings"]', 'click', e => this.onAutolinkSettings(e)),
			DOM.on('[data-switch-value]', 'click', e => this.onTreeSetting(e)),
			DOM.on('[data-action="pin"]', 'click', e => this.onTogglePin(e)),
			DOM.on<WebviewPane, WebviewPaneExpandedChangeEventDetail>(
				'[data-region="rich-pane"]',
				'expanded-change',
				e => this.onExpandedChange(e.detail),
			),
		];

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		switch (msg.method) {
			// case DidChangeRichStateNotificationType.method:
			// 	onIpc(DidChangeRichStateNotificationType, msg, params => {
			// 		if (this.state.selected == null) return;

			// 		assertsSerialized<typeof params>(params);

			// 		const newState = { ...this.state };
			// 		if (params.formattedMessage != null) {
			// 			newState.selected!.message = params.formattedMessage;
			// 		}
			// 		// if (params.pullRequest != null) {
			// 		newState.pullRequest = params.pullRequest;
			// 		// }
			// 		// if (params.formattedMessage != null) {
			// 		newState.autolinkedIssues = params.autolinkedIssues;
			// 		// }

			// 		this.state = newState;
			// 		this.renderRichContent();
			// 	});
			// 	break;
			case DidChangeStateNotificationType.method:
				onIpc(DidChangeStateNotificationType, msg, params => {
					assertsSerialized<typeof params.state>(params.state);

					// TODO: Undefined won't get serialized -- need to convert to null or something
					this.state = params.state; //{ ...this.state, ...params.state };
					this.renderContent();
				});
				break;
		}
	}

	private onTreeSetting(e: MouseEvent) {
		const isTree = (e.target as HTMLElement)?.getAttribute('data-switch-value') === 'list-tree';

		if (isTree === this.state.preferences?.filesAsTree) {
			return;
		}

		this.state.preferences = { ...this.state.preferences, filesAsTree: isTree };

		this.renderFiles(this.state as CommitState);

		this.sendCommand(PreferencesCommandType, {
			filesAsTree: isTree,
		});
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail) {
		this.sendCommand(PreferencesCommandType, {
			autolinksExpanded: e.expanded,
		});
	}

	private onTogglePin(e: MouseEvent) {
		e.preventDefault();
		this.sendCommand(PinCommitCommandType, { pin: !this.state.pinned });
	}

	private onAutolinkSettings(e: MouseEvent) {
		e.preventDefault();
		this.sendCommand(AutolinkSettingsCommandType, undefined);
	}

	private onSearchCommit(_e: MouseEvent) {
		this.sendCommand(SearchCommitCommandType, undefined);
	}

	private onPickCommit(_e: MouseEvent) {
		this.sendCommand(PickCommitCommandType, undefined);
	}

	private onOpenFileOnRemote(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileOnRemoteCommandType, e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileCommandType, e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileCompareWorkingCommandType, e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileComparePreviousCommandType, e);
	}

	private onFileMoreActions(e: FileChangeListItemDetail) {
		this.sendCommand(FileActionsCommandType, e);
	}

	private onCommitActions(e: MouseEvent) {
		e.preventDefault();
		if (this.state.selected === undefined) {
			e.stopPropagation();
			return;
		}

		const action = (e.target as HTMLElement)?.getAttribute('data-action-type');
		if (action == null) return;

		this.sendCommand(CommitActionsCommandType, { action: action as CommitActionsParams['action'], alt: e.altKey });
	}

	renderCommit(state: Serialized<State>): state is CommitState {
		const hasSelection = state.selected !== undefined;
		const $empty = document.getElementById('empty');
		const $main = document.getElementById('main');
		$empty?.setAttribute('aria-hidden', hasSelection ? 'true' : 'false');
		$main?.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');

		return hasSelection;
	}

	renderRichContent() {
		if (!this.renderCommit(this.state)) return;

		this.renderMessage(this.state);
		this.renderPullRequestAndAutolinks(this.state);
	}

	renderContent() {
		if (!this.renderCommit(this.state)) {
			return;
		}

		this.renderActions(this.state);
		this.renderPin(this.state);
		this.renderSha(this.state);
		this.renderMessage(this.state);
		this.renderAuthor(this.state);
		this.renderStats(this.state);
		this.renderFiles(this.state);

		// if (this.state.includeRichContent) {
		this.renderPullRequestAndAutolinks(this.state);
		// }
	}

	renderActions(state: CommitState) {
		const isHidden = state.selected?.sha === uncommittedSha ? 'true' : 'false';
		[...document.querySelectorAll('[data-action-type="graph"],[data-action-type="more"]')].forEach($el =>
			$el.setAttribute('aria-hidden', isHidden),
		);
	}

	renderPin(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-action="pin"]');
		if ($el == null) {
			return;
		}

		const label = state.pinned ? 'Unpin this Commit' : 'Pin this Commit';
		$el.setAttribute('aria-label', label);
		$el.setAttribute('title', label);
		$el.classList.toggle('is-active', state.pinned);

		const $icon = $el.querySelector('[data-region="commit-pin"]');
		$icon?.setAttribute('icon', state.pinned ? 'pinned-filled' : 'pin');
	}

	renderSha(state: CommitState) {
		const $els = [...document.querySelectorAll<HTMLElement>('[data-region="shortsha"]')];
		if ($els.length === 0) {
			return;
		}

		$els.forEach($el => {
			$el.textContent = state.selected.shortSha;
		});
	}

	renderChoices() {
		// <nav class="commit-detail-panel__nav" aria-label="list of selected commits" data-region="choices">
		// 	<p class="commit-detail-panel__commit-count">
		// 		Selected commits: <span data-region="choices-count">2</span>
		// 	</p>
		// 	<ul class="commit-detail-panel__commits" data-region="choices-list">
		// 		<li class="commit-detail-panel__commit">
		// 			<skeleton-loader></skeleton-loader>
		// 		</li>
		// 		<li class="commit-detail-panel__commit">
		// 			<skeleton-loader></skeleton-loader>
		// 		</li>
		// 	</ul>
		// </nav>
		const $el = document.querySelector<HTMLElement>('[data-region="choices"]');
		if ($el == null) {
			return;
		}

		// if (this.state.commits?.length) {
		// 	const $count = $el.querySelector<HTMLElement>('[data-region="choices-count"]');
		// 	if ($count != null) {
		// 		$count.innerHTML = `${this.state.commits.length}`;
		// 	}

		// 	const $list = $el.querySelector<HTMLElement>('[data-region="choices-list"]');
		// 	if ($list != null) {
		// 		$list.innerHTML = this.state.commits
		// 			.map(
		// 				(item: CommitSummary) => `
		// 					<li class="commit-detail-panel__commit">
		// 						<button class="commit-detail-panel__commit-button" type="button" ${
		// 							item.sha === this.state.selected?.sha ? 'aria-current="true"' : ''
		// 						}>
		// 							<img src="${item.avatar}" alt="${item.author.name}" />
		// 							<span>${item.message}</span>
		// 							<span>${item.shortSha}</span>
		// 						</button>
		// 					</li>
		// 				`,
		// 			)
		// 			.join('');
		// 	}
		// 	$el.setAttribute('aria-hidden', 'false');
		// } else {
		$el.setAttribute('aria-hidden', 'true');
		$el.innerHTML = '';
		// }
	}

	renderStats(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-region="stats"]');
		if ($el == null) {
			return;
		}
		if (state.selected.stats?.changedFiles !== undefined) {
			if (typeof state.selected.stats.changedFiles === 'number') {
				$el.innerHTML = `
				<commit-stats added="?" modified="${state.selected.stats.changedFiles}" removed="?"></commit-stats>
			`;
			} else {
				const { added, deleted, changed } = state.selected.stats.changedFiles;
				$el.innerHTML = `
				<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>
			`;
			}
		} else {
			$el.innerHTML = '';
		}
	}

	renderFiles(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-region="files"]');
		if ($el == null) {
			return;
		}

		if (state.selected.files?.length) {
			const isTree = state.preferences?.filesAsTree === true;
			document.querySelector('[data-switch-value="list"]')?.classList.toggle('is-selected', !isTree);
			document.querySelector('[data-switch-value="list-tree"]')?.classList.toggle('is-selected', isTree);

			const stashAttr = state.selected.isStash
				? 'stash '
				: state.selected.sha === uncommittedSha
				? 'uncommitted '
				: '';

			if (isTree) {
				const tree = makeHierarchical(
					state.selected.files,
					n => n.path.split('/'),
					(...parts: string[]) => parts.join('/'),
					true,
				);
				const flatTree = flattenHeirarchy(tree);

				$el.innerHTML = `
					<li class="change-list__item">
						<list-container>
							${flatTree
								.map(({ level, item }) => {
									if (item.name === '') {
										return '';
									}

									if (item.value == null) {
										return `
											<list-item level="${level}" tree branch>
												<code-icon slot="icon" icon="folder" title="Directory" aria-label="Directory"></code-icon>
												${item.name}
											</list-item>
										`;
									}

									return `
										<file-change-list-item
											tree
											level="${level}"
											${stashAttr}
											path="${item.value.path}"
											icon="${item.value.icon.dark}"
											status="${item.value.status}"
										></file-change-list-item>
									`;
								})
								.join('')}
						</list-container>
					</li>`;
			} else {
				$el.innerHTML = `
					<li class="change-list__item">
						<list-container>
							${state.selected.files
								.map(
									(file: Record<string, any>) => `
											<file-change-list-item
												${stashAttr}
												path="${file.path}"
												icon="${file.icon.dark}"
												status="${file.status}"
											></file-change-list-item>
										`,
								)
								.join('')}
						</list-container>
					</li>`;
			}
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
		}
	}

	renderAuthor(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-region="author"]');
		if ($el == null) {
			return;
		}

		if (state.selected?.isStash === true) {
			$el.innerHTML = `
				<div class="commit-stashed">
					<span class="commit-stashed__media"><code-icon class="commit-stashed__icon" icon="inbox"></code-icon></span>
					<span class="commit-stashed__date">stashed <formatted-date date=${state.selected.author.date} dateFormat="${state.dateFormat}"></formatted-date></span>
				</div>
			`;
			$el.setAttribute('aria-hidden', 'false');
		} else if (state.selected?.author != null) {
			$el.innerHTML = `
				<commit-identity
					name="${state.selected.author.name}"
					email="${state.selected.author.email}"
					date=${state.selected.author.date}
					dateFormat="${state.dateFormat}"
					avatar="${state.selected.author.avatar}"
					actionLabel="${state.selected.sha === uncommittedSha ? 'modified' : 'committed'}"
				></commit-identity>
			`;
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
			$el.setAttribute('aria-hidden', 'true');
		}
	}

	// renderCommitter(state: CommitState) {
	// 	// <li class="commit-details__author" data-region="committer">
	// 	// 	<skeleton-loader></skeleton-loader>
	// 	// </li>
	// 	const $el = document.querySelector<HTMLElement>('[data-region="committer"]');
	// 	if ($el == null) {
	// 		return;
	// 	}

	// 	if (state.selected.committer != null) {
	// 		$el.innerHTML = `
	// 			<commit-identity
	// 				name="${state.selected.committer.name}"
	// 				email="${state.selected.committer.email}"
	// 				date="${state.selected.committer.date}"
	// 				avatar="${state.selected.committer.avatar}"
	// 				committer
	// 			></commit-identity>
	// 		`;
	// 		$el.setAttribute('aria-hidden', 'false');
	// 	} else {
	// 		$el.innerHTML = '';
	// 		$el.setAttribute('aria-hidden', 'true');
	// 	}
	// }

	renderTitle(state: CommitState) {
		// <header class="commit-detail-panel__header" role="banner" aria-hidden="true">
		// 	<h1 class="commit-detail-panel__title">
		// 		<span class="codicon codicon-git-commit commit-detail-panel__title-icon"></span>
		// 		Commit: <span data-region="commit-title"></span>
		// 	</h1>
		// </header>
		const $el = document.querySelector<HTMLElement>('[data-region="commit-title"]');
		if ($el != null) {
			$el.innerHTML = state.selected.shortSha;
		}
	}

	renderMessage(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-region="message"]');
		if ($el == null) {
			return;
		}

		const [headline, ...lines] = state.selected.message.split('\n');
		if (lines.length > 1) {
			$el.innerHTML = `<strong>${headline}</strong><br>${lines.join('<br>')}`;
		} else {
			$el.innerHTML = `<strong>${headline}</strong>`;
		}
	}

	renderPullRequestAndAutolinks(state: CommitState) {
		const $el = document.querySelector<WebviewPane>('[data-region="rich-pane"]');
		if ($el == null) {
			return;
		}

		$el.expanded = this.state.preferences?.autolinksExpanded ?? true;
		$el.loading = !state.includeRichContent;

		const $info = $el.querySelector('[data-region="rich-info"]');
		const $autolinks = $el.querySelector('[data-region="autolinks"]');
		if (state.pullRequest != null || state.autolinkedIssues?.length) {
			$autolinks?.setAttribute('aria-hidden', 'false');
			$info?.setAttribute('aria-hidden', 'true');
			this.renderPullRequest(state);
			this.renderIssues(state);
		} else {
			$autolinks?.setAttribute('aria-hidden', 'true');
			$info?.setAttribute('aria-hidden', 'false');
		}

		const $count = $el.querySelector('[data-region="autolink-count"]');
		if ($count == null) return;

		const count = (state.pullRequest != null ? 1 : 0) + (state.autolinkedIssues?.length ?? 0);
		$count.innerHTML = state.includeRichContent ? `${count} found` : '…';
	}

	renderPullRequest(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-region="pull-request"]');
		if ($el == null) {
			return;
		}

		if (state.pullRequest != null) {
			$el.innerHTML = `
				<issue-pull-request
					name="${state.pullRequest.title}"
					url="${state.pullRequest.url}"
					key="${state.pullRequest.id}"
					status="${state.pullRequest.state}"
					date=${state.pullRequest.date}
					dateFormat="${state.dateFormat}"
				></issue-pull-request>
			`;
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
			$el.setAttribute('aria-hidden', 'true');
		}
	}

	renderIssues(state: CommitState) {
		const $el = document.querySelector<HTMLElement>('[data-region="issue"]');
		if ($el == null) {
			return;
		}
		if (state.autolinkedIssues?.length) {
			$el.innerHTML = state.autolinkedIssues
				.map(
					(issue: Record<string, any>) => `
						<issue-pull-request
							name="${issue.title}"
							url="${issue.url}"
							key="${issue.id}"
							status="${(issue.closed as boolean) ? 'closed' : 'opened'}"
							date="${(issue.closed as boolean) ? issue.closedDate : issue.date}"
						></issue-pull-request>
					`,
				)
				.join('');
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
			$el.setAttribute('aria-hidden', 'true');
		}
	}
}

function assertsSerialized<T>(obj: unknown): asserts obj is Serialized<T> {}

function flattenHeirarchy<T>(item: HierarchicalItem<T>, level = 0): { level: number; item: HierarchicalItem<T> }[] {
	const flattened: { level: number; item: HierarchicalItem<T> }[] = [];

	if (item == null) {
		return flattened;
	}

	flattened.push({ level: level, item: item });

	if (item.children != null) {
		const children = Array.from(item.children.values());
		children.sort((a, b) => {
			if (!a.value || !b.value) {
				return (a.value ? 1 : -1) - (b.value ? 1 : -1);
			}

			if (a.relativePath < b.relativePath) {
				return -1;
			}

			if (a.relativePath > b.relativePath) {
				return 1;
			}

			return 0;
		});

		children.forEach(child => {
			flattened.push(...flattenHeirarchy(child, level + 1));
		});
	}

	return flattened;
}

new CommitDetailsApp();
