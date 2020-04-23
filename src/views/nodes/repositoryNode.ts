'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
	GitBranch,
	GitRevision,
	GitStatus,
	Repository,
	RepositoryChange,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Arrays, Dates, debug, gate, log, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { CompareBranchNode } from './compareBranchNode';
import { BranchesNode } from './branchesNode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { MessageNode } from './common';
import { ContributorsNode } from './contributorsNode';
import { ReflogNode } from './reflogNode';
import { RemotesNode } from './remotesNode';
import { StashesNode } from './stashesNode';
import { StatusFilesNode } from './statusFilesNode';
import { TagsNode } from './tagsNode';
import { ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';

const hasTimeRegex = /[hHm]/;

export class RepositoryNode extends SubscribeableViewNode<RepositoriesView> {
	static key = ':repository';
	static getId(repoPath: string): string {
		return `gitlens${this.key}(${repoPath})`;
	}

	private _children: ViewNode[] | undefined;
	private _lastFetched: number = 0;
	private _status: Promise<GitStatus | undefined>;

	constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);

		this._status = this.repo.getStatus();
	}

	toClipboard(): string {
		return this.repo.path;
	}

	get id(): string {
		return RepositoryNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const children = [];

			const status = await this._status;
			if (status !== undefined) {
				const branch = new GitBranch(
					status.repoPath,
					status.branch,
					false,
					true,
					undefined,
					status.sha,
					status.upstream,
					status.state.ahead,
					status.state.behind,
					status.detached,
				);
				children.push(new BranchNode(this.uri, this.view, this, branch, true));

				if (status.state.behind) {
					children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'behind', true));
				}

				if (status.state.ahead) {
					children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'ahead', true));
				}

				if (status.state.ahead || (status.files.length !== 0 && this.includeWorkingTree)) {
					const range = status.upstream ? GitRevision.createRange(status.upstream, branch.ref) : undefined;
					children.push(new StatusFilesNode(this.view, this, status, range));
				}

				if (this.view.config.showBranchComparison !== false) {
					children.push(new CompareBranchNode(this.uri, this.view, this, branch));
				}

				if (!this.view.config.repositories.compact) {
					children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
				}
			}

			children.push(
				new BranchesNode(this.uri, this.view, this, this.repo),
				new ContributorsNode(this.uri, this.view, this, this.repo),
			);

			children.push(new ReflogNode(this.uri, this.view, this, this.repo));

			children.push(
				new RemotesNode(this.uri, this.view, this, this.repo),
				new StashesNode(this.uri, this.view, this, this.repo),
				new TagsNode(this.uri, this.view, this, this.repo),
			);
			this._children = children;
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const label = this.repo.formattedName || this.uri.repoPath || '';

		this._lastFetched = await this.repo.getLastFetched();

		const lastFetchedTooltip = this.formatLastFetched({
			prefix: `${Strings.pad(GlyphChars.Dash, 2, 2)}Last fetched on `,
			format: Container.config.defaultDateFormat || 'dddd MMMM Do, YYYY',
			includeTime: true,
		});

		let description;
		let tooltip = this.repo.formattedName
			? `${this.repo.formattedName}${lastFetchedTooltip}\n${this.uri.repoPath}`
			: `${this.uri.repoPath}${lastFetchedTooltip}`;
		let iconSuffix = '';
		let workingStatus = '';

		let contextValue: string = ResourceType.Repository;
		if (this.repo.starred) {
			contextValue += '+starred';
		}

		const status = await this._status;
		if (status !== undefined) {
			tooltip += `\n\nCurrent branch is ${status.branch}`;

			if (status.files.length !== 0 && this.includeWorkingTree) {
				workingStatus = status.getFormattedDiffStatus({
					compact: true,
					prefix: Strings.pad(GlyphChars.Dot, 2, 2),
				});
			}

			const upstreamStatus = status.getUpstreamStatus({
				prefix: `${GlyphChars.Space} `,
			});

			description = `${status.branch}${upstreamStatus}${workingStatus}`;

			iconSuffix = workingStatus ? '-blue' : '';
			if (status.upstream !== undefined) {
				tooltip += ` and is tracking ${status.upstream}\n${status.getUpstreamStatus({
					empty: 'No commits ahead or behind',
					expand: true,
					separator: '\n',
					suffix: '\n',
				})}`;

				if (status.state.behind) {
					contextValue += '+behind';
					iconSuffix = '-red';
				}
				if (status.state.ahead) {
					iconSuffix = status.state.behind ? '-yellow' : '-green';
					contextValue += '+ahead';
				}
			}

			if (workingStatus) {
				tooltip += `\n\nWorking tree has uncommitted changes${status.getFormattedDiffStatus({
					expand: true,
					prefix: '\n',
					separator: '\n',
				})}`;
			}
		}

		if (!this.repo.supportsChangeEvents) {
			description = `<!>${description ? ` ${GlyphChars.Space}${description}` : ''}`;
			tooltip += '\n\n<!> Unable to automatically detect repository changes';
		}

		const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
		item.contextValue = contextValue;
		item.description = `${description || ''}${this.formatLastFetched({
			prefix: `${Strings.pad(GlyphChars.Dot, 2, 2)}Last fetched `,
		})}`;
		item.iconPath = {
			dark: Container.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
			light: Container.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`),
		};
		item.id = this.id;
		item.tooltip = tooltip;

		void this.ensureSubscription();

		return item;
	}

	@log()
	fetch(options: { all?: boolean; progress?: boolean; prune?: boolean; remote?: string } = {}) {
		return this.repo.fetch(options);
	}

	@log()
	pull(options: { progress?: boolean; rebase?: boolean } = {}) {
		return this.repo.pull(options);
	}

	@log()
	push(options: { force?: boolean; progress?: boolean } = {}) {
		return this.repo.push(options);
	}

	@gate()
	@debug()
	async refresh(reset: boolean = false) {
		if (reset) {
			this._status = this.repo.getStatus();

			this._children = undefined;
		}

		await this.ensureSubscription();
	}

	@log()
	async star() {
		await this.repo.star();
		void this.parent!.triggerChange();
	}

	@log()
	async unstar() {
		await this.repo.unstar();
		void this.parent!.triggerChange();
	}

	@debug()
	protected subscribe() {
		const disposables = [this.repo.onDidChange(this.onRepoChanged, this)];

		// if (Container.config.defaultDateStyle === DateStyle.Relative) {
		//     disposables.push(Functions.interval(() => void this.updateLastFetched(), 60000));
		// }

		if (this.includeWorkingTree) {
			disposables.push(this.repo.onDidChangeFileSystem(this.onFileSystemChanged, this), {
				dispose: () => this.repo.stopWatchingFileSystem(),
			});

			this.repo.startWatchingFileSystem();
		}

		return Disposable.from(...disposables);
	}

	private get includeWorkingTree(): boolean {
		return this.view.config.includeWorkingTree;
	}

	@debug({
		args: {
			0: (e: RepositoryFileSystemChangeEvent) =>
				`{ repository: ${e.repository ? e.repository.name : ''}, uris(${e.uris.length}): [${e.uris
					.slice(0, 1)
					.map(u => u.fsPath)
					.join(', ')}${e.uris.length > 1 ? ', ...' : ''}] }`,
		},
	})
	private async onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		this._status = this.repo.getStatus();

		if (this._children !== undefined) {
			const status = await this._status;

			let index = this._children.findIndex(c => c instanceof StatusFilesNode);
			if (status !== undefined && (status.state.ahead || status.files.length !== 0)) {
				let deleteCount = 1;
				if (index === -1) {
					index = Arrays.findLastIndex(
						this._children,
						c => c instanceof BranchTrackingStatusNode || c instanceof BranchNode,
					);
					deleteCount = 0;
					index++;
				}

				const range = status.upstream ? GitRevision.createRange(status.upstream, status.sha) : undefined;
				this._children.splice(index, deleteCount, new StatusFilesNode(this.view, this, status, range));
			} else if (index !== -1) {
				this._children.splice(index, 1);
			}
		}

		void this.triggerChange(false);
	}

	@debug({
		args: {
			0: (e: RepositoryChangeEvent) =>
				`{ repository: ${e.repository ? e.repository.name : ''}, changes: ${e.changes.join()} }`,
		},
	})
	private onRepoChanged(e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Closed)) {
			this.dispose();

			return;
		}

		if (
			this._children === undefined ||
			e.changed(RepositoryChange.Repository) ||
			e.changed(RepositoryChange.Config)
		) {
			void this.triggerChange(true);

			return;
		}

		if (e.changed(RepositoryChange.Stashes)) {
			const node = this._children.find(c => c instanceof StashesNode);
			if (node !== undefined) {
				void this.view.triggerNodeChange(node);
			}
		}

		if (e.changed(RepositoryChange.Remotes)) {
			const node = this._children.find(c => c instanceof RemotesNode);
			if (node !== undefined) {
				void this.view.triggerNodeChange(node);
			}
		}

		if (e.changed(RepositoryChange.Tags)) {
			const node = this._children.find(c => c instanceof TagsNode);
			if (node !== undefined) {
				void this.view.triggerNodeChange(node);
			}
		}
	}

	private formatLastFetched(options: { prefix?: string; format?: string; includeTime?: boolean } = {}) {
		if (this._lastFetched === 0) return '';

		// if (options.format === undefined && Container.config.defaultDateStyle === DateStyle.Relative) {
		//     // If less than a day has passed show a relative date
		//     if (Date.now() - this._lastFetched < Dates.MillisecondsPerDay) {
		//         return `${options.prefix || ''}${Dates.toFormatter(new Date(this._lastFetched)).fromNow()}`;
		//     }
		// }

		let format = options.format || Container.config.defaultDateShortFormat || 'MMM D, YYYY';
		if (
			(options.includeTime ||
				// If less than a day has passed show the time too
				(options.includeTime === undefined && Date.now() - this._lastFetched < Dates.MillisecondsPerDay)) &&
			// If the time is already included don't do anything
			!hasTimeRegex.test(format)
		) {
			format = `h:mma, ${format}`;
		}

		return `${options.prefix || ''}${Dates.getFormatter(new Date(this._lastFetched)).format(format)}`;
	}

	// @debug()
	// private async updateLastFetched() {
	//     const prevLastFetched = this._lastFetched;
	//     this._lastFetched = await this.repo.getLastFetched();

	//     // If the fetched date hasn't changed and it was over a day ago, kick out
	//     if (this._lastFetched === prevLastFetched && Date.now() - this._lastFetched >= Dates.MillisecondsPerDay) return;

	//     this.view.triggerNodeChange(this);
	// }
}
