import { Disposable, MarkdownString, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Features } from '../../features';
import type { GitUri } from '../../git/gitUri';
import { GitBranch } from '../../git/models/branch';
import { GitRemote } from '../../git/models/remote';
import type { RepositoryChangeEvent, RepositoryFileSystemChangeEvent } from '../../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import type { GitStatus } from '../../git/models/status';
import type {
	CloudWorkspace,
	CloudWorkspaceRepositoryDescriptor,
	LocalWorkspace,
	LocalWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models';
import { findLastIndex } from '../../system/array';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { disposableInterval } from '../../system/function';
import { pad } from '../../system/string';
import type { ViewsWithRepositories } from '../viewBase';
import { BranchesNode } from './branchesNode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { ContributorsNode } from './contributorsNode';
import { MergeStatusNode } from './mergeStatusNode';
import { RebaseStatusNode } from './rebaseStatusNode';
import { ReflogNode } from './reflogNode';
import { RemotesNode } from './remotesNode';
import { StashesNode } from './stashesNode';
import { StatusFilesNode } from './statusFilesNode';
import { TagsNode } from './tagsNode';
import type { AmbientContext, ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, SubscribeableViewNode } from './viewNode';
import { WorktreesNode } from './worktreesNode';

export class RepositoryNode extends SubscribeableViewNode<ViewsWithRepositories> {
	private _children: ViewNode[] | undefined;
	private _status: Promise<GitStatus | undefined>;

	constructor(
		uri: GitUri,
		view: ViewsWithRepositories,
		parent: ViewNode,
		public readonly repo: Repository,
		context?: AmbientContext,
	) {
		super(uri, view, parent);

		this.updateContext({ ...context, repository: this.repo });
		this._uniqueId = getViewNodeId('repository', this.context);

		this._status = this.repo.getStatus();
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.repo.path;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	get workspace(): CloudWorkspace | LocalWorkspace | undefined {
		return this.context.workspace;
	}

	get wsRepositoryDescriptor(): CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor | undefined {
		return this.context.wsRepositoryDescriptor;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const children = [];

			const status = await this._status;
			if (status != null) {
				const branch = new GitBranch(
					this.view.container,
					status.repoPath,
					status.branch,
					false,
					true,
					undefined,
					status.sha,
					status.upstream ? { name: status.upstream, missing: false } : undefined,
					status.state.ahead,
					status.state.behind,
					status.detached,
					status.rebasing,
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

				const [mergeStatus, rebaseStatus] = await Promise.all([
					this.view.container.git.getMergeStatus(status.repoPath),
					this.view.container.git.getRebaseStatus(status.repoPath),
				]);

				if (mergeStatus != null) {
					children.push(new MergeStatusNode(this.view, this, branch, mergeStatus, status, true));
				} else if (rebaseStatus != null) {
					children.push(new RebaseStatusNode(this.view, this, branch, rebaseStatus, status, true));
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
					const range = undefined; //status.upstream ? createRange(status.upstream, branch.ref) : undefined;
					children.push(new StatusFilesNode(this.view, this, status, range));
				}

				if (children.length !== 0 && !this.view.config.compact) {
					children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
				}

				if (this.view.config.showCommits) {
					children.push(
						new BranchNode(this.uri, this.view, this, this.repo, branch, true, {
							showAsCommits: true,
							showComparison: false,
							showCurrent: false,
							showStatus: false,
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

			if (this.view.config.showStashes && (await this.repo.supports(Features.Stashes))) {
				children.push(new StashesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showTags) {
				children.push(new TagsNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showWorktrees && (await this.repo.supports(Features.Worktrees))) {
				children.push(new WorktreesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showContributors) {
				children.push(new ContributorsNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showIncomingActivity && !this.repo.provider.virtual) {
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
				? `${pad(GlyphChars.Dash, 2, 2)}Last fetched ${Repository.formatLastFetched(lastFetched, false)}`
				: ''
		}${this.repo.formattedName ? `\\\n${this.uri.repoPath}` : ''}`;
		let workingStatus = '';

		const { workspace } = this.context;

		let contextValue: string = ContextValues.Repository;
		if (this.repo.starred) {
			contextValue += '+starred';
		}
		if (workspace != null) {
			contextValue += '+workspace';
			if (workspace.type === 'cloud') {
				contextValue += '+cloud';
			} else if (workspace.type === 'local') {
				contextValue += '+local';
			}
		}

		let iconSuffix;
		// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
		if (this.repo.closed) {
			contextValue += '+closed';
			iconSuffix = '';
		} else {
			iconSuffix = '-solid';
		}

		if (this.repo.virtual) {
			contextValue += '+virtual';
			iconSuffix = '-cloud';
		}

		const status = await this._status;
		if (status != null) {
			tooltip += `\n\nCurrent branch $(git-branch) ${status.branch}${status.rebasing ? ' (Rebasing)' : ''}`;

			if (this.view.config.includeWorkingTree && status.files.length !== 0) {
				workingStatus = status.getFormattedDiffStatus({
					compact: true,
					prefix: pad(GlyphChars.Dot, 1, 1),
				});
			}

			const upstreamStatus = status.getUpstreamStatus({
				suffix: pad(GlyphChars.Dot, 1, 1),
			});

			description = `${upstreamStatus}${status.branch}${status.rebasing ? ' (Rebasing)' : ''}${workingStatus}`;

			let providerName;
			if (status.upstream != null) {
				const providers = GitRemote.getHighlanderProviders(
					await this.view.container.git.getRemotesWithProviders(status.repoPath),
				);
				providerName = providers?.length ? providers[0].name : undefined;
			} else {
				const remote = await status.getRemote();
				providerName = remote?.provider?.name;
			}

			iconSuffix += workingStatus ? '-blue' : '';
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
					iconSuffix += '-red';
				}
				if (status.state.ahead) {
					iconSuffix += status.state.behind ? '-yellow' : '-green';
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

		if (workspace != null) {
			tooltip += `\n\nRepository is ${this.repo.closed ? 'not ' : ''}open in the current window`;
		}

		const item = new TreeItem(
			label,
			workspace != null || this.view.type === 'workspaces'
				? TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = contextValue;
		item.description = `${description ?? ''}${
			lastFetched ? `${pad(GlyphChars.Dot, 1, 1)}Last fetched ${Repository.formatLastFetched(lastFetched)}` : ''
		}`;
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
			light: this.view.container.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`),
		};

		if (workspace != null && !this.repo.closed) {
			item.resourceUri = Uri.parse(`gitlens-view://workspaces/repository/open`);
		}

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

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
	override async refresh(reset: boolean = false) {
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
				disposableInterval(() => {
					// Check if the interval should change, and if so, reset it
					if (interval !== Repository.getLastFetchedUpdateInterval(lastFetched)) {
						void this.resetSubscription();
					}

					if (this.splatted) {
						this.view.triggerNodeChange(this.parent ?? this);
					} else {
						this.view.triggerNodeChange(this);
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

	protected override etag(): number {
		return this.repo.etag;
	}

	@debug<RepositoryNode['onFileSystemChanged']>({
		args: {
			0: e =>
				`{ repository: ${e.repository?.name ?? ''}, uris(${e.uris.length}): [${e.uris
					.slice(0, 1)
					.map(u => u.fsPath)
					.join(', ')}${e.uris.length > 1 ? ', ...' : ''}] }`,
		},
	})
	private async onFileSystemChanged(_e: RepositoryFileSystemChangeEvent) {
		this._status = this.repo.getStatus();

		if (this._children !== undefined) {
			const status = await this._status;

			let index = this._children.findIndex(c => c instanceof StatusFilesNode);
			if (status !== undefined && (status.state.ahead || status.files.length !== 0)) {
				let deleteCount = 1;
				if (index === -1) {
					index = findLastIndex(
						this._children,
						c => c instanceof BranchTrackingStatusNode || c instanceof BranchNode,
					);
					deleteCount = 0;
					index++;
				}

				const range = undefined; //status.upstream ? createRange(status.upstream, status.sha) : undefined;
				this._children.splice(index, deleteCount, new StatusFilesNode(this.view, this, status, range));
			} else if (index !== -1) {
				this._children.splice(index, 1);
			}
		}

		void this.triggerChange(false);
	}

	@debug<RepositoryNode['onRepositoryChanged']>({ args: { 0: e => e.toString() } })
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Closed, RepositoryChangeComparisonMode.Any)) {
			this.dispose();

			return;
		}

		if (
			this._children == null ||
			e.changed(
				RepositoryChange.Config,
				RepositoryChange.Index,
				RepositoryChange.Heads,
				RepositoryChange.Opened,
				RepositoryChange.Status,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			void this.triggerChange(true);

			return;
		}

		if (e.changed(RepositoryChange.Remotes, RepositoryChange.RemoteProviders, RepositoryChangeComparisonMode.Any)) {
			const node = this._children.find(c => c instanceof RemotesNode);
			if (node != null) {
				this.view.triggerNodeChange(node);
			}
		}

		if (e.changed(RepositoryChange.Stash, RepositoryChangeComparisonMode.Any)) {
			const node = this._children.find(c => c instanceof StashesNode);
			if (node != null) {
				this.view.triggerNodeChange(node);
			}
		}

		if (e.changed(RepositoryChange.Tags, RepositoryChangeComparisonMode.Any)) {
			const node = this._children.find(c => c instanceof TagsNode);
			if (node != null) {
				this.view.triggerNodeChange(node);
			}
		}
	}
}
