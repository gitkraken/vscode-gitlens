'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitLog, GitRevision, GitTag, GitTagReference, TagDateFormatting } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { debug, gate, Iterables, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { ContextValues, PageableViewNode, ViewNode, ViewRefNode } from './viewNode';
import { emojify } from '../../emojis';
import { RepositoryNode } from './repositoryNode';
import { GlyphChars } from '../../constants';
import { TagsView } from '../tagsView';

export class TagNode extends ViewRefNode<TagsView | RepositoriesView, GitTagReference> implements PageableViewNode {
	static key = ':tag';
	static getId(repoPath: string, name: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})`;
	}

	constructor(uri: GitUri, view: TagsView | RepositoriesView, parent: ViewNode, public readonly tag: GitTag) {
		super(uri, view, parent);
	}

	toClipboard(): string {
		return this.tag.name;
	}

	get id(): string {
		return TagNode.getId(this.tag.repoPath, this.tag.name);
	}

	get label(): string {
		return this.view.config.branches.layout === ViewBranchesLayout.Tree ? this.tag.getBasename() : this.tag.name;
	}

	get ref(): GitTagReference {
		return this.tag;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath, this.tag.name);
		const children = [
			...insertDateMarkers(
				Iterables.map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, getBranchAndTagTips),
				),
				this,
			),
		];

		if (log.hasMore) {
			children.push(new ShowMoreNode(this.view, this, children[children.length - 1]));
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Tag;
		item.description = `${GitRevision.shorten(this.tag.sha, { force: true })}${Strings.pad(
			GlyphChars.Dot,
			2,
			2,
		)}${emojify(this.tag.message)}`;
		item.tooltip = `${this.tag.name}${Strings.pad(GlyphChars.Dash, 2, 2)}${GitRevision.shorten(this.tag.sha, {
			force: true,
		})}\n${this.tag.formatDateFromNow()} (${this.tag.formatDate(TagDateFormatting.dateFormat)})\n\n${emojify(
			this.tag.message,
		)}${
			this.tag.commitDate != null && this.tag.date !== this.tag.commitDate
				? `\n${this.tag.formatCommitDateFromNow()} (${this.tag.formatCommitDate(TagDateFormatting.dateFormat)})`
				: ''
		}`;

		return item;
	}

	@gate()
	@debug()
	refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log === undefined) {
			this._log = await Container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.tag.name,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async showMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log === undefined || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;
		void this.triggerChange(false);
	}
}
