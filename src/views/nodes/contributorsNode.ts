import { l10n, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { CoreColors } from '../../constants.colors.js';
import type { GitUri } from '../../git/gitUri.js';
import type { GlRepository } from '../../git/models/repository.js';
import type { FilesQueryResults } from '../../git/queryResults.js';
import { sortContributors } from '../../git/utils/-webview/sorting.js';
import { toAbortSignal } from '../../system/-webview/cancellation.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { ViewsWithContributorsNode } from '../viewBase.js';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { ActionMessageNode, MessageNode } from './common.js';
import type { ContributorFilesComparison } from './contributorNode.js';
import { ContributorNode } from './contributorNode.js';
import { filterContributorFiles } from './utils/-webview/contributor.utils.js';

export class ContributorsNode extends CacheableChildrenViewNode<
	'contributors',
	ViewsWithContributorsNode,
	ContributorNode | MessageNode | ActionMessageNode
> {
	constructor(
		uri: GitUri,
		view: ViewsWithContributorsNode,
		protected override readonly parent: ViewNode,
		public readonly repo: GlRepository,
		private readonly options?: {
			all?: boolean;
			files?: ContributorFilesComparison;
			icon?: boolean;
			ref?: string;
			showMergeCommits?: boolean;
			stats?: boolean;
		},
	) {
		super('contributors', uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const stats = this.options?.stats ?? configuration.get('views.contributors.showStatistics');
			const children = await this.getContributors(stats, true);

			if (stats) {
				queueMicrotask(async () => {
					this.children = await this.getContributors(true, false);
					void this.triggerChange();
				});
			}

			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(l10n.t('Contributors'), TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Contributors;
		if (this.options?.icon !== false) {
			item.iconPath = new ThemeIcon('organization');
		}
		return item;
	}

	updateAvatar(email: string): void {
		if (this.children == null) return;

		for (const child of this.children) {
			if (!child.is('contributor')) continue;

			if (child.contributor.email === email) {
				void child.triggerChange();
			}
		}
	}

	@trace()
	override refresh(reset: boolean = false): void {
		if (reset) {
			this.children = undefined;
			this.invalidateFiles();
		}
	}

	private _filesLog: Promise<GitCommit[] | undefined> | undefined;
	private _filesQueryResults: Promise<FilesQueryResults> | undefined;
	private _workingFiles: Promise<GitFile[] | undefined> | undefined;

	private invalidateFiles(): void {
		this._filesLog = undefined;
		this._filesQueryResults = undefined;
		this._workingFiles = undefined;
	}

	private async getFilesLog(): Promise<GitCommit[] | undefined> {
		this._filesLog ??= this.loadFilesLog();
		return this._filesLog;
	}

	private async loadFilesLog(): Promise<GitCommit[] | undefined> {
		const svc = this.view.container.git.getRepositoryService(this.repoPath);
		let log = await svc.commits.getLog(this.options?.ref, {
			includeFiles: true,
			limit: 0,
			merges: true,
			ordering: 'topo',
		});
		if (log == null) return undefined;

		const commits = new Map(log.commits);
		while (log.hasMore) {
			log = await log.more?.(0);
			if (log == null) return undefined;

			for (const [sha, commit] of log.commits) {
				commits.set(sha, commit);
			}
		}

		for (const commit of commits.values()) {
			if (!commit.isMergeCommit && commit.fileset?.files == null) {
				await GitCommit.ensureFullDetails(commit);
				if (commit.fileset?.files == null) return undefined;
			}
		}

		return [...commits.values()];
	}

	private async getContributorFiles(contributor: GitContributor): Promise<FilesQueryResults> {
		this._filesQueryResults ??= this.options!.files!.query();
		this._workingFiles ??=
			this.options!.files!.ref2 === ''
				? this.view.container.git
						.getRepositoryService(this.repoPath)
						.diff.getDiffStatus('HEAD', undefined, { includeUntracked: true })
				: Promise.resolve([]);
		const data = await Promise.all([this._filesQueryResults, this.getFilesLog(), this._workingFiles]).catch(
			(ex: unknown) => {
				Logger.error(ex, 'Unable to load contributor files');
				return undefined;
			},
		);
		if (data == null) {
			return { label: l10n.t('Unable to load files touched'), files: undefined };
		}

		const [results, commits, workingFiles] = data;
		if (results.files == null || commits == null || workingFiles == null) {
			return { label: l10n.t('Unable to load files touched'), files: undefined };
		}

		const authoredShas = contributor.contributions && new Set(contributor.contributions.map(c => c.sha));
		const authoredCommits = commits.filter(
			c =>
				authoredShas?.has(c.sha) ??
				(c.author.email === contributor.email &&
					(c.author.name === contributor.name || (contributor.current && c.author.current))),
		);
		const files = filterContributorFiles(authoredCommits, results.files, commits, workingFiles);
		return {
			label: files.length
				? formatPlural(l10n.t('{0, plural, one{{0} file touched} other{{0} files touched}}'), [files.length])
				: l10n.t('No files touched'),
			files: files,
		};
	}

	@trace({ args: false })
	private async getPresenceMap(contributors: GitContributor[]) {
		// Only get presence for the current user, because it is far too slow otherwise
		const email = contributors.find(c => c.current)?.email;
		if (email == null) return undefined;

		return this.view.container.vsls.getContactsPresence([email]);
	}

	private async getContributors(
		stats?: boolean,
		deferStats?: boolean,
	): Promise<(ContributorNode | MessageNode | ActionMessageNode)[]> {
		let rev = this.options?.ref;
		const all = rev == null && (this.options?.all ?? configuration.get('views.contributors.showAllBranches'));

		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath!);

		if (rev == null && !all) {
			try {
				const branch = await svc.branches.getBranch();
				if (branch?.upstream?.name != null && !branch.upstream.missing) {
					rev = '@{u}';
				}
			} catch {}
		}

		let timeout: number;
		const overrideMaxWait = this.getState('overrideMaxWait');
		if (overrideMaxWait) {
			timeout = overrideMaxWait;
			this.deleteState('overrideMaxWait');
		} else {
			timeout = configuration.get('views.contributors.maxWait') * 1000;
		}

		const result = await svc.contributors.getContributors(
			rev,
			{
				all: all,
				merges: this.options?.showMergeCommits,
				stats: this.options?.files != null || (!deferStats && stats),
			},
			toAbortSignal(this.view.cancellation),
			timeout || undefined,
		);
		if (!result.contributors.length) {
			return [new MessageNode(this.view, this, l10n.t('No contributors could be found.'))];
		}

		const children: (ContributorNode | MessageNode | ActionMessageNode)[] = [];
		if (result.cancelled) {
			children.push(
				new ActionMessageNode(
					this.view,
					this,
					n => {
						n.update({
							iconPath: new ThemeIcon('loading~spin'),
							message: l10n.t('Loading contributors...'),
							description: l10n.t('waiting for {0}s', (timeout * 2) / 1000),
							tooltip: null,
						});
						this.storeState('overrideMaxWait', timeout * 2);
						void this.triggerChange(true);
					},
					stats
						? l10n.t('Showing incomplete contributors and statistics')
						: l10n.t('Showing incomplete contributors'),
					result.cancelled.reason === 'timedout'
						? l10n.t('timed out after {0}s', timeout / 1000)
						: l10n.t('cancelled'),
					l10n.t('Click to retry and wait longer for contributors'),
					new ThemeIcon('warning', new ThemeColor('list.warningForeground' satisfies CoreColors)),
				),
			);
		}

		if (deferStats && stats) {
			children.push(
				new MessageNode(
					this.view,
					this,
					l10n.t('Loading statistics...'),
					undefined,
					undefined,
					new ThemeIcon('loading~spin'),
				),
			);
		}

		sortContributors(result.contributors);
		const presenceMap = this.view.container.vsls.active
			? await this.getPresenceMap(result.contributors)
			: undefined;

		for (const c of result.contributors) {
			children.push(
				new ContributorNode(this.uri, this.view, this, c, {
					all: all,
					files: this.options?.files && {
						...this.options.files,
						query: () => this.getContributorFiles(c),
						invalidate: () => this.invalidateFiles(),
					},
					ref: rev,
					presence: presenceMap,
					showMergeCommits: this.options?.showMergeCommits,
					showStatistics: this.options?.files != null ? !deferStats && stats : undefined,
				}),
			);
		}

		return children;
	}
}
