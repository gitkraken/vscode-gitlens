'use strict';
import { Disposable, MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
	GitBranch,
	GitRemote,
	GitStatus,
	Repository,
	RepositoryChange,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Arrays, debug, Functions, gate, log, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { CompareBranchNode } from './compareBranchNode';
import { BranchesNode } from './branchesNode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { MessageNode } from './common';
import { ContributorsNode } from './contributorsNode';
import { MergeStatusNode } from './mergeStatusNode';
import { ReflogNode } from './reflogNode';
import { RemotesNode } from './remotesNode';
import { StashesNode } from './stashesNode';
import { StatusFilesNode } from './statusFilesNode';
import { TagsNode } from './tagsNode';
import { ContextValues, SubscribeableViewNode, ViewNode } from './viewNode';

export class RepositoryNode extends SubscribeableViewNode<RepositoriesView> {
	static key = ':repository';
	static getId(repoPath: string): string {
		return `gitlens${this.key}(${repoPath})`;
	}

	private _children: ViewNode[] | undefined;
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
			if (status != null) {
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

				if (this.view.config.showBranchComparison !== false) {
					children.push(
						new CompareBranchNode(
							this.uri,
							this.view,
							this,
							branch,
							this.view.config.showBranchComparison,
							true,
						),
					);
				}

				if (status.hasConflicts) {
					const mergeStatus = await Container.git.getMergeStatus(status);
					if (mergeStatus != null) {
						children.push(new MergeStatusNode(this.view, this, branch, mergeStatus));
					}
				} else if (this.view.config.showUpstreamStatus) {
					if (status.upstream) {
						if (!status.state.behind && !status.state.ahead) {
							children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'same', true));
						} else {
							if (status.state.behind) {
								children.push(
									new BranchTrackingStatusNode(this.view, this, branch, status, 'behind', true),
								);
							}

							if (status.state.ahead) {
								children.push(
									new BranchTrackingStatusNode(this.view, this, branch, status, 'ahead', true, {
										showAheadCommits: true,
									}),
								);
							}
						}
					} else {
						children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'none', true));
					}
				}

				if (this.view.config.includeWorkingTree && status.files.length !== 0) {
					const range = undefined; //status.upstream ? GitRevision.createRange(status.upstream, branch.ref) : undefined;
					children.push(new StatusFilesNode(this.view, this, status, range));
				}

				if (children.length !== 0 && !this.view.config.compact) {
					children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
				}

				if (this.view.config.showCommits) {
					children.push(
						new BranchNode(this.uri, this.view, this, branch, true, {
							showAsCommits: true,
							showComparison: false,
							showCurrent: false,
							showTracking: false,
						}),
					);
				}
			}

			if (this.view.config.showBranches) {
				children.push(new BranchesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showRemotes) {
				children.push(new RemotesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showStashes) {
				children.push(new StashesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showTags) {
				children.push(new TagsNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showContributors) {
				children.push(new ContributorsNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showIncomingActivity) {
				children.push(new ReflogNode(this.uri, this.view, this, this.repo));
			}

			this._children = children;
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const label = this.repo.formattedName ?? this.uri.repoPath ?? '';

		const lastFetched = (await this.repo?.getLastFetched()) ?? 0;

		let description;
		let tooltip = `${this.repo.formattedName ?? this.uri.repoPath ?? ''}${
			lastFetched
				? `${Strings.pad(GlyphChars.Dash, 2, 2)}Last fetched ${Repository.formatLastFetched(
						lastFetched,
						false,
				  )}`
				: ''
		}${this.repo.formattedName ? `\n${this.uri.repoPath}` : ''}`;
		let iconSuffix = '';
		let workingStatus = '';

		let contextValue: string = ContextValues.Repository;
		if (this.repo.starred) {
			contextValue += '+starred';
		}

		const status = await this._status;
		if (status != null) {
			tooltip += `\n\nCurrent branch $(git-branch) ${status.branch}`;

			if (this.view.config.includeWorkingTree && status.files.length !== 0) {
				workingStatus = status.getFormattedDiffStatus({
					compact: true,
					prefix: Strings.pad(GlyphChars.Dot, 1, 1),
				});
			}

			const upstreamStatus = status.getUpstreamStatus({
				suffix: Strings.pad(GlyphChars.Dot, 1, 1),
			});

			description = `${upstreamStatus}${status.branch}${workingStatus}`;

			let providerName;
			if (status.upstream != null) {
				const providers = GitRemote.getHighlanderProviders(await Container.git.getRemotes(status.repoPath));
				providerName = providers?.length ? providers[0].name : undefined;
			} else {
				const remote = await status.getRemote();
				providerName = remote?.provider?.name;
			}

			iconSuffix = workingStatus ? '-blue' : '';
			if (status.upstream != null) {
				tooltip += ` is ${status.getUpstreamStatus({
					empty: `up to date with $(git-branch) ${status.upstream}${
						providerName ? ` on ${providerName}` : ''
					}`,
					expand: true,
					icons: true,
					separator: ', ',
					suffix: ` $(git-branch) ${status.upstream}${providerName ? ` on ${providerName}` : ''}`,
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
		item.description = `${description ?? ''}${
			lastFetched
				? `${Strings.pad(GlyphChars.Dot, 1, 1)}Last fetched ${Repository.formatLastFetched(lastFetched)}`
				: ''
		}`;
		item.iconPath = {
			dark: Container.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
			light: Container.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`),
		};
		item.id = this.id;
		item.tooltip = new MarkdownString(tooltip, true);

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
	protected async subscribe() {
		const lastFetched = (await this.repo?.getLastFetched()) ?? 0;

		const disposables = [this.repo.onDidChange(this.onRepositoryChanged, this)];

		const interval = Repository.getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			disposables.push(
				Functions.interval(() => {
					// Check if the interval should change, and if so, reset it
					if (interval !== Repository.getLastFetchedUpdateInterval(lastFetched)) {
						void this.resetSubscription();
					}

					if (this.splatted) {
						void this.view.triggerNodeChange(this.parent ?? this);
					} else {
						void this.view.triggerNodeChange(this);
					}
				}, interval),
			);
		}

		if (this.view.config.includeWorkingTree) {
			disposables.push(
				this.repo.onDidChangeFileSystem(this.onFileSystemChanged, this),
				this.repo.startWatchingFileSystem(),
			);
		}

		return Disposable.from(...disposables);
	}

	protected get requiresResetOnVisible(): boolean {
		return this._repoUpdatedAt !== this.repo.updatedAt;
	}

	private _repoUpdatedAt: number = this.repo.updatedAt;

	@debug({
		args: {
			0: (e: RepositoryFileSystemChangeEvent) =>
				`{ repository: ${e.repository?.name ?? ''}, uris(${e.uris.length}): [${e.uris
					.slice(0, 1)
					.map(u => u.fsPath)
					.join(', ')}${e.uris.length > 1 ? ', ...' : ''}] }`,
		},
	})
	private async onFileSystemChanged(_e: RepositoryFileSystemChangeEvent) {
		this._repoUpdatedAt = this.repo.updatedAt;

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

				const range = undefined; //status.upstream ? GitRevision.createRange(status.upstream, status.sha) : undefined;
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
				`{ repository: ${e.repository?.name ?? ''}, changes: ${e.changes.join()} }`,
		},
	})
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		this._repoUpdatedAt = this.repo.updatedAt;

		if (e.changed(RepositoryChange.Closed)) {
			this.dispose();

			return;
		}

		if (
			this._children === undefined ||
			e.changed(RepositoryChange.Config) ||
			e.changed(RepositoryChange.Index) ||
			e.changed(RepositoryChange.Heads) ||
			e.changed(RepositoryChange.Unknown)
		) {
			void this.triggerChange(true);

			return;
		}

		if (e.changed(RepositoryChange.Remotes)) {
			const node = this._children.find(c => c instanceof RemotesNode);
			if (node !== undefined) {
				void this.view.triggerNodeChange(node);
			}
		}

		if (e.changed(RepositoryChange.Stash)) {
			const node = this._children.find(c => c instanceof StashesNode);
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
}
