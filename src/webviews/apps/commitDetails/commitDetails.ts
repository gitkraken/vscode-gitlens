/*global*/
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { CommitSummary, State } from '../../commitDetails/protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	DidChangeNotificationType,
	FileComparePreviousCommandType,
	FileCompareWorkingCommandType,
	FileMoreActionsCommandType,
	OpenFileCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	RichContentNotificationType,
	SearchCommitCommandType,
} from '../../commitDetails/protocol';
import { App } from '../shared/appBase';
import type { FileChangeItem, FileChangeItemEventDetail } from '../shared/components/commit/file-change-item';
import { DOM } from '../shared/dom';
import './commitDetails.scss';
import '../shared/components/codicon';
import '../shared/components/commit/commit-identity';
import '../shared/components/formatted-date';
import '../shared/components/rich/issue-pull-request';
import '../shared/components/skeleton-loader';
import '../shared/components/commit/commit-stats';

import '../shared/components/commit/file-change-item';
import '../shared/components/webview-pane';

export class CommitDetailsApp extends App<State> {
	constructor() {
		super('CommitDetailsApp');
		console.log('CommitDetailsApp', this.state);
	}

	override onInitialize() {
		console.log('CommitDetailsApp onInitialize', this.state);
		this.renderContent();
	}

	override onBind() {
		const disposables = [
			DOM.on<FileChangeItem, FileChangeItemEventDetail>('file-change-item', 'file-open-on-remote', e =>
				this.onOpenFileOnRemote(e.detail),
			),
			DOM.on<FileChangeItem, FileChangeItemEventDetail>('file-change-item', 'file-open', e =>
				this.onOpenFile(e.detail),
			),
			DOM.on<FileChangeItem, FileChangeItemEventDetail>('file-change-item', 'file-compare-working', e =>
				this.onCompareFileWithWorking(e.detail),
			),
			DOM.on<FileChangeItem, FileChangeItemEventDetail>('file-change-item', 'file-compare-previous', e =>
				this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<FileChangeItem, FileChangeItemEventDetail>('file-change-item', 'file-more-actions', e =>
				this.onFileMoreActions(e.detail),
			),
			DOM.on('[data-action="commit-actions-sha"]', 'click', e => this.onCommitShaActions(e)),
			DOM.on('[data-action="commit-actions-more"]', 'click', e => this.onCommitMoreActions(e)),
			DOM.on('[data-action="pick-commit"]', 'click', e => this.onPickCommit(e)),
			DOM.on('[data-action="search-commit"]', 'click', e => this.onSearchCommit(e)),
			DOM.on('[data-action="autolink-settings"]', 'click', e => this.onAutolinkSettings(e)),
			DOM.on('file-change-item', 'keydown', (e, target: HTMLElement) => {
				if (e.key === 'Enter' || e.key === ' ') {
					(target as FileChangeItem).open(e.key === 'Enter' ? { preserveFocus: false } : undefined);
				} else if (e.key === 'ArrowUp') {
					const $previous: HTMLElement | null = target.parentElement?.previousElementSibling
						?.firstElementChild as HTMLElement;
					$previous?.focus();
				} else if (e.key === 'ArrowDown') {
					const $next: HTMLElement | null = target.parentElement?.nextElementSibling
						?.firstElementChild as HTMLElement;
					$next?.focus();
				}
			}),
		];

		return disposables;
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

	private onOpenFileOnRemote(e: FileChangeItemEventDetail) {
		this.sendCommand(OpenFileOnRemoteCommandType, e);
	}

	private onOpenFile(e: FileChangeItemEventDetail) {
		this.sendCommand(OpenFileCommandType, e);
	}

	private onCompareFileWithWorking(e: FileChangeItemEventDetail) {
		this.sendCommand(FileCompareWorkingCommandType, e);
	}

	private onCompareFileWithPrevious(e: FileChangeItemEventDetail) {
		this.sendCommand(FileComparePreviousCommandType, e);
	}

	private onFileMoreActions(e: FileChangeItemEventDetail) {
		this.sendCommand(FileMoreActionsCommandType, e);
	}

	private onCommitMoreActions(e: MouseEvent) {
		e.preventDefault();
		if (this.state.selected === undefined) {
			e.stopPropagation();
			return;
		}

		this.sendCommand(CommitActionsCommandType, { action: 'more' });
	}

	private onCommitShaActions(e: MouseEvent) {
		e.preventDefault();
		if (this.state.selected === undefined) {
			e.stopPropagation();
			return;
		}

		this.sendCommand(CommitActionsCommandType, { action: 'sha', alt: e.altKey });
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		switch (msg.method) {
			case RichContentNotificationType.method:
				onIpc(RichContentNotificationType, msg, params => {
					const newState = { ...this.state };
					if (params.formattedMessage != null) {
						newState.selected.message = params.formattedMessage;
					}
					if (params.pullRequest != null) {
						newState.pullRequest = params.pullRequest;
					}
					if (params.formattedMessage != null) {
						newState.issues = params.issues;
					}

					this.state = newState;
					this.renderRichContent();
				});
				break;
			case DidChangeNotificationType.method:
				onIpc(DidChangeNotificationType, msg, params => {
					this.state = { ...this.state, ...params.state };
					this.renderContent();
				});
				break;
		}
	}

	renderCommit() {
		const hasSelection = this.state.selected !== undefined;
		const $empty = document.getElementById('empty');
		const $main = document.getElementById('main');
		$empty?.setAttribute('aria-hidden', hasSelection ? 'true' : 'false');
		$main?.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');

		return hasSelection;
	}

	renderRichContent() {
		if (!this.renderCommit()) {
			return;
		}

		this.renderMessage();
		this.renderAutolinks();
	}

	renderContent() {
		if (!this.renderCommit()) {
			return;
		}

		this.renderSha();
		this.renderMessage();
		this.renderAuthor();
		this.renderStats();
		this.renderFiles();

		if (this.state.includeRichContent) {
			this.renderAutolinks();
		}
	}

	renderSha() {
		const $els = [...document.querySelectorAll<HTMLElement>('[data-region="shortsha"]')];
		if ($els.length === 0) {
			return;
		}

		$els.forEach($el => {
			$el.textContent = this.state.selected.shortSha;
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

		if (this.state.commits?.length) {
			const $count = $el.querySelector<HTMLElement>('[data-region="choices-count"]');
			if ($count != null) {
				$count.innerHTML = `${this.state.commits.length}`;
			}

			const $list = $el.querySelector<HTMLElement>('[data-region="choices-list"]');
			if ($list != null) {
				$list.innerHTML = this.state.commits
					.map(
						(item: CommitSummary) => `
							<li class="commit-detail-panel__commit">
								<button class="commit-detail-panel__commit-button" type="button" ${
									item.sha === this.state.selected.sha ? 'aria-current="true"' : ''
								}>
									<img src="${item.avatar}" alt="${item.author.name}" />
									<span>${item.message}</span>
									<span>${item.shortSha}</span>
								</button>
							</li>
						`,
					)
					.join('');
			}
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.setAttribute('aria-hidden', 'true');
			$el.innerHTML = '';
		}
	}

	renderStats() {
		const $el = document.querySelector<HTMLElement>('[data-region="stats"]');
		if ($el == null) {
			return;
		}
		if (this.state.selected.stats?.changedFiles !== undefined) {
			const { added, deleted, changed } = this.state.selected.stats.changedFiles;
			$el.innerHTML = `
				<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>
			`;
		} else {
			$el.innerHTML = '';
		}
	}

	renderFiles() {
		const $el = document.querySelector<HTMLElement>('[data-region="files"]');
		if ($el == null) {
			return;
		}

		if (this.state.selected.files?.length > 0) {
			$el.innerHTML = this.state.selected.files
				.map(
					(file: Record<string, any>) => `
						<li class="change-list__item">
							<file-change-item class="commit-details__file" status="${file.status}" path="${file.path}" repo-path="${file.repoPath}" icon="${file.icon.dark}"></file-change-item>
						</li>
					`,
				)
				.join('');
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
		}
	}

	renderAuthor() {
		const $el = document.querySelector<HTMLElement>('[data-region="author"]');
		if ($el == null) {
			return;
		}

		if (this.state.selected.author != null) {
			$el.innerHTML = `
				<commit-identity
					name="${this.state.selected.author.name}"
					email="${this.state.selected.author.email}"
					date="${this.state.selected.author.date}"
					avatar="${this.state.selected.author.avatar}"
				></commit-identity>
			`;
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
			$el.setAttribute('aria-hidden', 'true');
		}
	}

	renderCommitter() {
		// <li class="commit-details__author" data-region="committer">
		// 	<skeleton-loader></skeleton-loader>
		// </li>
		const $el = document.querySelector<HTMLElement>('[data-region="committer"]');
		if ($el == null) {
			return;
		}

		if (this.state.selected.committer != null) {
			$el.innerHTML = `
				<commit-identity
					name="${this.state.selected.committer.name}"
					email="${this.state.selected.committer.email}"
					date="${this.state.selected.committer.date}"
					avatar="${this.state.selected.committer.avatar}"
					committer
				></commit-identity>
			`;
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
			$el.setAttribute('aria-hidden', 'true');
		}
	}

	renderTitle() {
		// <header class="commit-detail-panel__header" role="banner" aria-hidden="true">
		// 	<h1 class="commit-detail-panel__title">
		// 		<span class="codicon codicon-git-commit commit-detail-panel__title-icon"></span>
		// 		Commit: <span data-region="commit-title"></span>
		// 	</h1>
		// </header>
		const $el = document.querySelector<HTMLElement>('[data-region="commit-title"]');
		if ($el != null) {
			$el.innerHTML = this.state.selected.shortSha;
		}
	}

	renderMessage() {
		const $el = document.querySelector<HTMLElement>('[data-region="message"]');
		if ($el == null) {
			return;
		}

		const [headline, ...lines] = this.state.selected.message.split('\n');
		if (lines.length > 1) {
			$el.innerHTML = `<strong>${headline}</strong><br>${lines.join('<br>')}`;
		} else {
			$el.innerHTML = `<strong>${headline}</strong>`;
		}
	}

	renderAutolinks() {
		const $el = document.querySelector<HTMLElement>('[data-region="autolinks"]');
		if ($el == null) {
			return;
		}

		const $info = document.querySelector<HTMLElement>('[data-region="rich-info"]');
		if (this.state.pullRequest != null || this.state.issues?.length > 0) {
			$el.setAttribute('aria-hidden', 'false');
			$info?.setAttribute('aria-hidden', 'true');
			this.renderPullRequest();
			this.renderIssues();
		} else {
			$el.setAttribute('aria-hidden', 'true');
			$info?.setAttribute('aria-hidden', 'false');
		}
	}

	renderPullRequest() {
		const $el = document.querySelector<HTMLElement>('[data-region="pull-request"]');
		if ($el == null) {
			return;
		}

		if (this.state.pullRequest != null) {
			$el.innerHTML = `
				<issue-pull-request
					name="${this.state.pullRequest.title}"
					url="${this.state.pullRequest.url}"
					key="${this.state.pullRequest.id}"
					status="${this.state.pullRequest.state}"
					date="${this.state.pullRequest.date}"
				></issue-pull-request>
			`;
			$el.setAttribute('aria-hidden', 'false');
		} else {
			$el.innerHTML = '';
			$el.setAttribute('aria-hidden', 'true');
		}
	}

	renderIssues() {
		const $el = document.querySelector<HTMLElement>('[data-region="issue"]');
		if ($el == null) {
			return;
		}
		if (this.state.issues?.length > 0) {
			$el.innerHTML = this.state.issues
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

new CommitDetailsApp();
