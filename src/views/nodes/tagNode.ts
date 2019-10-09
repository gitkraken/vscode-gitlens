'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitService, GitTag, GitUri, TagDateFormatting } from '../../git/gitService';
import { Iterables, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode, ViewRefNode } from './viewNode';
import { emojify } from '../../emojis';
import { RepositoryNode } from './repositoryNode';
import { GlyphChars } from '../../constants';

export class TagNode extends ViewRefNode<RepositoriesView> implements PageableViewNode {
	static key = ':tag';
	static getId(repoPath: string, name: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})`;
	}

	readonly supportsPaging = true;
	readonly rememberLastMaxCount = true;
	maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

	constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly tag: GitTag) {
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

	get ref(): string {
		return this.tag.name;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await Container.git.getLog(this.uri.repoPath!, {
			maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit,
			ref: this.tag.name
		});
		if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath, this.tag.name);
		const children = [
			...insertDateMarkers(
				Iterables.map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, getBranchAndTagTips)
				),
				this
			)
		];

		if (log.truncated) {
			children.push(new ShowMoreNode(this.view, this, 'Commits', log.maxCount, children[children.length - 1]));
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ResourceType.Tag;
		item.description = `${GitService.shortenSha(this.tag.sha, { force: true })}${Strings.pad(
			GlyphChars.Dot,
			2,
			2
		)}${emojify(this.tag.message)}`;
		item.tooltip = `${this.tag.name}${Strings.pad(GlyphChars.Dash, 2, 2)}${GitService.shortenSha(this.tag.sha, {
			force: true
		})}\n${this.tag.formatDateFromNow()} (${this.tag.formatDate(TagDateFormatting.dateFormat)})\n\n${emojify(
			this.tag.message
		)}${
			this.tag.commitDate != null && this.tag.date !== this.tag.commitDate
				? `\n${this.tag.formatCommitDateFromNow()} (${this.tag.formatCommitDate(TagDateFormatting.dateFormat)})`
				: ''
		}`;

		return item;
	}
}
