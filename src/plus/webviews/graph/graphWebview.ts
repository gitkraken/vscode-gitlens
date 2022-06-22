import { ViewColumn, window } from 'vscode';
import { configuration, GraphConfig } from '../../../configuration';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import { RepositoryPicker } from '../../../quickpicks/repositoryPicker';
import { WebviewWithConfigBase } from '../../../webviews/webviewWithConfigBase';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type { GitCommit, Repository, State } from './protocol';

export class GraphWebview extends WebviewWithConfigBase<State> {
	private selectedRepository?: string;

	constructor(container: Container) {
		super(container, 'gitlens.graph', 'graph.html', 'images/gitlens-icon.png', 'Graph', Commands.ShowGraphPage);
	}

	override async show(column: ViewColumn = ViewColumn.Beside): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(column);
	}

	private getRepos(): Repository[] {
		return this.container.git.openRepositories;
	}

	private async getCommits(repo?: string | Repository): Promise<GitCommit[]> {
		if (repo === undefined) {
			return [];
		}

		const repository = typeof repo === 'string' ? this.container.git.getRepository(repo) : repo;
		if (repository === undefined) {
			return [];
		}

		const log = await this.container.git.getLog(repository.uri);
		if (log?.commits === undefined) {
			return [];
		}

		return Array.from(log.commits.values());
	}

	private async pickRepository(repositories: Repository[]): Promise<Repository | undefined> {
		if (repositories.length === 0) {
			return undefined;
		}

		if (repositories.length === 1) {
			return repositories[0];
		}

		const repoPath = (
			await RepositoryPicker.getBestRepositoryOrShow(
				undefined,
				window.activeTextEditor,
				'Choose a repository to visualize',
			)
		)?.path;

		return repositories.find(r => r.path === repoPath);
	}

	private getConfig(): GraphConfig {
		return configuration.get('graph');
	}

	private async getState(): Promise<State> {
		const repositories = this.getRepos();
		if (repositories.length === 0) {
			return {
				repositories: [],
			};
		}

		if (this.selectedRepository === undefined) {
			const idealRepo = await this.pickRepository(repositories);
			this.selectedRepository = idealRepo?.path;
		}

		const commits = await this.getCommits(this.selectedRepository);

		return {
			repositories: formatRepositories(repositories),
			selectedRepository: this.selectedRepository,
			commits: formatCommits(commits),
			config: this.getConfig(),
		};
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState();
	}
}

function formatCommits(commits: GitCommit[]): GitCommit[] {
	return commits.map(({ sha, author, message }) => ({
		sha: sha,
		author: author,
		message: message,
	}));
}

function formatRepositories(repositories: Repository[]): Repository[] {
	if (repositories.length === 0) {
		return repositories;
	}

	return repositories.map(({ formattedName, id, name, path }) => ({
		formattedName: formattedName,
		id: id,
		name: name,
		path: path,
	}));
}
