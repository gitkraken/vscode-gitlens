import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { PullRequestViewConfig, ViewFilesLayout } from '../config';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import type { GitBranch } from '../git/models/branch';
import type { GitCommit } from '../git/models/commit';
import type { PullRequest } from '../git/models/pullRequest';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import { ViewNode } from './nodes/abstract/viewNode';
import { PullRequestNode } from './nodes/pullRequestNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class PullRequestViewNode extends ViewNode<'pullrequest', PullRequestView> {
	private child: PullRequestNode | undefined;

	constructor(view: PullRequestView) {
		super('pullrequest', unknownGitUri, view);
	}

	getChildren(): PullRequestNode[] {
		return this.child != null ? [this.child] : [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Pull Request', TreeItemCollapsibleState.Expanded);
		return item;
	}

	async setPullRequest(pr: PullRequest | undefined, branchOrCommitOrRepoPath: GitBranch | GitCommit | string) {
		if (pr != null) {
			this.child = new PullRequestNode(this.view, this, pr, branchOrCommitOrRepoPath, { expand: true });
			this.view.description = `${pr.repository.owner}/${pr.repository.repo}#${pr.id}`;
			void setContext('gitlens:views:pullRequest:visible', true);
		} else {
			this.child = undefined;
			this.view.description = undefined;
			void setContext('gitlens:views:pullRequest:visible', false);
		}
		await this.triggerChange();
	}
}

export class PullRequestView extends ViewBase<'pullRequest', PullRequestViewNode, PullRequestViewConfig> {
	protected readonly configKey = 'pullRequest';

	constructor(container: Container) {
		super(container, 'pullRequest', 'Pull Request', 'commitsView');
	}

	override get canReveal(): boolean {
		return false;
	}

	override get canSelectMany(): boolean {
		return false;
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	close() {
		this.setVisible(false);
	}

	async showPullRequest(pr: PullRequest | undefined, branchOrCommitOrRepoPath: GitBranch | GitCommit | string) {
		if (pr != null) {
			this.description = `${pr.repository.owner}/${pr.repository.repo}#${pr.id}`;
			this.setVisible(true);
		} else {
			this.description = undefined;
			this.setVisible(false);
		}

		await this.ensureRoot().setPullRequest(pr, branchOrCommitOrRepoPath);
		if (pr != null) {
			await this.show();
		}
	}

	private setVisible(visible: boolean) {
		void setContext('gitlens:views:pullRequest:visible', visible);
	}

	protected getRoot() {
		return new PullRequestViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(GlCommand.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(this.getQualifiedCommand('close'), () => this.close(), this),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToAuto'),
				() => this.setFilesLayout('auto'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout('list'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout('tree'),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateLocale') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat')
		) {
			return false;
		}

		return true;
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}
}
