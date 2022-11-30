import type { AuthenticationSession, Disposable } from 'vscode';
import type { RequestInit } from '@env/fetch';
import type { Container } from '../../container';
import type { GitRemote } from '../../git/models/remote';
import type { RichRemoteProvider } from '../../git/remotes/richRemoteProvider';
import { Logger } from '../../logger';
import type { ServerConnection } from '../subscription/serverConnection';
import type {
	IssuesResponse,
	PullRequestsResponse,
	Workspace,
	WorkspaceProvider,
	WorkspacesResponse,
	WorkspacesWithPullRequestsResponse,
} from './models';

export class WorkspacesApi implements Disposable {
	// private _disposable: Disposable;

	constructor(private readonly container: Container, private readonly server: ServerConnection) {}

	dispose(): void {
		// this._disposable?.dispose();
	}

	private async getAccessToken() {
		// TODO: should probably get scopes from somewhere
		const sessions = await this.container.subscriptionAuthentication.getSessions(['gitlens']);
		if (!sessions.length) {
			return;
		}

		const session = sessions[0];
		return session.accessToken;
	}

	private async getRichProvider(): Promise<GitRemote<RichRemoteProvider> | undefined> {
		const remotes: GitRemote<RichRemoteProvider>[] = [];
		for (const repo of this.container.git.openRepositories) {
			const richRemote = await repo.getRichRemote(true);
			if (richRemote == null || remotes.includes(richRemote)) {
				continue;
			}
			remotes.push(richRemote);
		}

		if (remotes.length === 0) {
			return undefined;
		}

		return remotes[0];
	}

	private async getRichProviderSession(): Promise<AuthenticationSession | undefined> {
		const remote = await this.getRichProvider();
		let session = remote?.provider.session();
		if (session == null) {
			return undefined;
		}

		if ((session as Promise<AuthenticationSession | undefined>).then != null) {
			session = await session;
		}
		return session;
	}

	private async getProviderCredentials(_type: WorkspaceProvider) {
		const session = await this.getRichProviderSession();
		if (session == null) return undefined;

		// TODO: get tokens from Providers
		// let token;
		// switch (type) {
		// 	case 'GITHUB':
		// 		token = { access_token: session.accessToken, is_pat: false };
		// 		break;
		// }
		const token = { github: { access_token: session.accessToken, is_pat: false } };

		return Promise.resolve(token);
	}

	async getWorkspaces(): Promise<WorkspacesResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    query getWorkspaces {
                        projects(first: 100) {
							total_count
							page_info {
								start_cursor
								has_next_page
								end_cursor
							}
                            nodes {
                                id
                                name
                                provider
                            }
                        }
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Getting workspaces failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: WorkspacesResponse | undefined = await rsp.json();

		return json;
	}

	async getPullRequests(workspace: Workspace): Promise<PullRequestsResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		const query = `
			query getPullRequestsForWorkspace(
				$workspaceId: String
			) {
				project(id: $workspaceId) {
					provider
					provider_data {
						pull_requests(first: 100) {
							nodes {
								id
								title
								number
								author_username
								comment_count
								created_date
								repository {
									id
									name
									provider_organization_id
								}
								head_commit {
									build_status {
										context
										state
										description
									}
								}
								head {
									name
								}
								url
							}
							is_fetching
							page_info {
							  end_cursor
							  has_next_page
							}
						}
					}
				}
			}
		`;

		const init: RequestInit = {};
		const externalTokens = await this.getProviderCredentials(workspace.provider.toUpperCase() as WorkspaceProvider);
		if (externalTokens != null) {
			init.headers = {
				'External-Tokens': JSON.stringify(externalTokens),
			};
		}

		const rsp = await this.server.fetchGraphql(
			{
				query: query,
				variables: {
					workspaceId: workspace.id,
				},
			},
			accessToken,
			init,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Getting pull requests failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		let json: PullRequestsResponse | undefined = await rsp.json();

		if (json?.data.project.provider_data.pull_requests.is_fetching === true) {
			await new Promise(resolve => setTimeout(resolve, 200));
			json = await this.getPullRequests(workspace);
		}

		return json;
	}

	async getIssues(workspace: Workspace): Promise<IssuesResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		const query = `
			query getIssuesForWorkspace($projectId: String) {
				project(id: $projectId) {
					provider
					provider_data {
						issues(first: 100) {
							nodes {
								id
								title
								assignee_ids
								author_id
								comment_count
								created_date
								issue_type
								label_ids
								node_id
								repository {
									id
									name
									provider_organization_id
								}
								updated_date
								milestone_id
								url
							}
							is_fetching
							page_info {
								end_cursor
								has_next_page
							}
						}
					}
				}
			}
		`;

		const init: RequestInit = {};
		const externalTokens = await this.getProviderCredentials(workspace.provider.toUpperCase() as WorkspaceProvider);
		if (externalTokens != null) {
			init.headers = {
				'External-Tokens': JSON.stringify(externalTokens),
			};
		}

		const rsp = await this.server.fetchGraphql(
			{
				query: query,
				variables: {
					workspaceId: workspace.id,
				},
			},
			accessToken,
			init,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Getting pull requests failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		let json: IssuesResponse | undefined = await rsp.json();

		if (json?.data.project.provider_data.issues.is_fetching === true) {
			await new Promise(resolve => setTimeout(resolve, 200));
			json = await this.getIssues(workspace);
		}

		return json;
	}

	async getWorkspacesWithPullRequests(): Promise<WorkspacesWithPullRequestsResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		const query = `
			query getPullRequestsForAllWorkspaces {
				projects(first: 100) {
					total_count
					page_info {
						start_cursor
						has_next_page
						end_cursor
					}
					nodes {
						id
						name
						provider
						provider_data {
							pull_requests(first: 100) {
								nodes {
									id
									title
									number
									author_username
									comment_count
									created_date
									repository {
										id
										name
										provider_organization_id
									}
									head_commit {
										build_status {
											context
											state
											description
										}
									}
									head {
										name
									}
									url
								}
								is_fetching
								page_info {
									end_cursor
									has_next_page
								}
								total_count
							}
						}
					}
				}
			}
		`;

		const init: RequestInit = {};
		const externalTokens = await this.getProviderCredentials('github' as WorkspaceProvider);
		if (externalTokens != null) {
			init.headers = {
				'External-Tokens': JSON.stringify(externalTokens),
			};
		}

		const rsp = await this.server.fetchGraphql(
			{
				query: query,
			},
			accessToken,
			init,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Getting pull requests failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		let json: WorkspacesWithPullRequestsResponse | undefined = await rsp.json();

		if (json?.errors != null && json.errors.length > 0) {
			const error = json.errors[0];
			Logger.error(undefined, `Getting pull requests failed: (${error.statusCode}) ${error.message}`);
			throw new Error(error.message);
		}

		if (json?.data.projects.nodes[0].provider_data.pull_requests.is_fetching === true) {
			await new Promise(resolve => setTimeout(resolve, 200));
			json = await this.getWorkspacesWithPullRequests();
		}

		return json;
	}

	async createWorkspace(): Promise<void> {}

	async ensureWorkspace(): Promise<void> {}
}
