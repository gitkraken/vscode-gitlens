import type { Container } from '../../container';
import { Logger } from '../../system/logger';
import type { ServerConnection } from '../subscription/serverConnection';
import type {
	AddRepositoriesToWorkspaceResponse,
	AddWorkspaceRepoDescriptor,
	CreateWorkspaceResponse,
	DeleteWorkspaceResponse,
	RemoveRepositoriesFromWorkspaceResponse,
	RemoveWorkspaceRepoDescriptor,
	WorkspaceRepositoriesResponse,
	WorkspacesResponse,
} from './models';
import { CloudWorkspaceProviderInputType, defaultWorkspaceCount, defaultWorkspaceRepoCount } from './models';

export class WorkspacesApi {
	constructor(private readonly container: Container, private readonly server: ServerConnection) {}

	private async getAccessToken() {
		// TODO: should probably get scopes from somewhere
		const sessions = await this.container.subscriptionAuthentication.getSessions(['gitlens']);
		if (!sessions.length) {
			return;
		}

		const session = sessions[0];
		return session.accessToken;
	}

	// TODO@ramint: We have a pagedresponse model available in case it helps here. Takes care of cursor internally
	// Make the data return a promise for the repos. Should be async so we're set up for dynamic processing.
	async getWorkspacesWithRepos(options?: {
		count?: number;
		cursor?: string;
		page?: number;
		repoCount?: number;
		repoPage?: number;
	}): Promise<WorkspacesResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		let queryParams = `(first: ${options?.count ?? defaultWorkspaceCount}`;
		if (options?.cursor) {
			queryParams += `, after: "${options.cursor}"`;
		} else if (options?.page) {
			queryParams += `, page: ${options.page}`;
		}
		queryParams += ')';

		let repoQueryParams = `(first: ${options?.repoCount ?? defaultWorkspaceRepoCount}`;
		if (options?.repoPage) {
			repoQueryParams += `, page: ${options.repoPage}`;
		}
		repoQueryParams += ')';

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    query getWorkspacesWithRepos {
                        projects ${queryParams} {
                            total_count
                            page_info {
                                end_cursor
                                has_next_page
                            }
                            nodes {
                                id
								description
                                name
								organization {
									id
								}
                                provider
                                provider_data {
                                    repositories ${repoQueryParams} {
                                        total_count
                                        page_info {
                                            end_cursor
                                            has_next_page
                                        }
                                        nodes {
                                            id
                                            name
                                            repository_id
                                            provider
											provider_organization_id
											provider_organization_name
                                            url
                                        }
                                    }
                                }
                            }
                        }
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Getting workspaces with repos failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: WorkspacesResponse | undefined = (await rsp.json()) as WorkspacesResponse | undefined;

		return json;
	}

	async getWorkspaces(options?: {
		count?: number;
		cursor?: string;
		page?: number;
	}): Promise<WorkspacesResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		let queryparams = `(first: ${options?.count ?? defaultWorkspaceCount}`;
		if (options?.cursor) {
			queryparams += `, after: "${options.cursor}"`;
		} else if (options?.page) {
			queryparams += `, page: ${options.page}`;
		}
		queryparams += ')';

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    query getWorkspaces {
                        projects ${queryparams} {
                            total_count
                            page_info {
                                end_cursor
                                has_next_page
                            }
                            nodes {
                                id
								description
                                name
								organization {
									id
								}
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

		const json: WorkspacesResponse | undefined = (await rsp.json()) as WorkspacesResponse | undefined;

		return json;
	}

	async getWorkspaceRepositories(
		workspaceId: string,
		options?: {
			count?: number;
			cursor?: string;
			page?: number;
		},
	): Promise<WorkspaceRepositoriesResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		let queryparams = `(first: ${options?.count ?? defaultWorkspaceRepoCount}`;
		if (options?.cursor) {
			queryparams += `, after: "${options.cursor}"`;
		} else if (options?.page) {
			queryparams += `, page: ${options.page}`;
		}
		queryparams += ')';

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    query getWorkspaceRepos {
                        project (id: "${workspaceId}") {
                            provider_data {
								repositories ${queryparams} {
									total_count
									page_info {
										end_cursor
										has_next_page
									}
									nodes {
										id
										name
										repository_id
										provider
										provider_organization_id
										provider_organization_name
										url
									}
								}
							}
                        }
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Getting workspace repos failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: WorkspaceRepositoriesResponse | undefined = (await rsp.json()) as
			| WorkspaceRepositoriesResponse
			| undefined;

		return json;
	}

	async createWorkspace(options: {
		name: string;
		description: string;
		provider: CloudWorkspaceProviderInputType;
		hostUrl?: string;
		azureOrganizationName?: string;
		azureProjectName?: string;
	}): Promise<CreateWorkspaceResponse | undefined> {
		if (!options.name || !options.description || !options.provider) {
			return;
		}

		if (
			options.provider === CloudWorkspaceProviderInputType.Azure &&
			(!options.azureOrganizationName || !options.azureProjectName)
		) {
			return;
		}

		if (
			(options.provider === CloudWorkspaceProviderInputType.GitHubEnterprise ||
				options.provider === CloudWorkspaceProviderInputType.GitLabSelfHosted) &&
			!options.hostUrl
		) {
			return;
		}

		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    mutation createWorkspace {
						create_project(
							input: {
						  		type: GK_PROJECT
						  		name: "${options.name}"
						  		description: "${options.description}"
						  		provider: ${options.provider}
								${options.hostUrl ? `host_url: "${options.hostUrl}"` : ''}
								${options.azureOrganizationName ? `azure_organization_id: "${options.azureOrganizationName}"` : ''}
								${options.azureProjectName ? `azure_project: "${options.azureProjectName}"` : ''}
						  		profile_id: "shared-services"
							}
						) {
							id,
							name,
							description,
							organization {
								id
							}
							provider
						}
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Creating workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: CreateWorkspaceResponse | undefined = (await rsp.json()) as CreateWorkspaceResponse | undefined;

		return json;
	}

	async deleteWorkspace(workspaceId: string): Promise<DeleteWorkspaceResponse | undefined> {
		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    mutation deleteWorkspace {
						delete_project(
							id: "${workspaceId}"
						) {
							id
						}
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Deleting workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: DeleteWorkspaceResponse | undefined = (await rsp.json()) as DeleteWorkspaceResponse | undefined;

		return json;
	}

	async addReposToWorkspace(
		workspaceId: string,
		repos: AddWorkspaceRepoDescriptor[],
	): Promise<AddRepositoriesToWorkspaceResponse | undefined> {
		if (repos.length === 0) {
			return;
		}

		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		let reposQuery = '[';
		reposQuery += repos.map(r => `{ provider_organization_id: "${r.owner}", name: "${r.repoName}" }`).join(',');
		reposQuery += ']';

		let count = 1;
		const reposReturnQuery = repos
			.map(
				r => `Repository${count++}: repository(provider_organization_id: "${r.owner}", name: "${r.repoName}") {
			id
			name
			repository_id
			provider
			provider_organization_id
			provider_organization_name
			url
		}`,
			)
			.join(',');

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    mutation addReposToWorkspace {
						add_repositories_to_project(
							input: {
								project_id: "${workspaceId}",
								repositories: ${reposQuery}
							}
						) {
							id
							provider_data {
								${reposReturnQuery}
							}
						}
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Adding repositories to workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: AddRepositoriesToWorkspaceResponse | undefined = (await rsp.json()) as
			| AddRepositoriesToWorkspaceResponse
			| undefined;

		return json;
	}

	async removeReposFromWorkspace(
		workspaceId: string,
		repos: RemoveWorkspaceRepoDescriptor[],
	): Promise<RemoveRepositoriesFromWorkspaceResponse | undefined> {
		if (repos.length === 0) {
			return;
		}

		const accessToken = await this.getAccessToken();
		if (accessToken == null) {
			return;
		}

		let reposQuery = '[';
		reposQuery += repos.map(r => `{ provider_organization_id: "${r.owner}", name: "${r.repoName}" }`).join(',');
		reposQuery += ']';

		const rsp = await this.server.fetchGraphql(
			{
				query: `
                    mutation removeReposFromWorkspace {
						remove_repositories_from_project(
							input: {
								project_id: "${workspaceId}",
								repositories: ${reposQuery}
							}
						) {
							id
						}
                    }
				`,
			},
			accessToken,
		);

		if (!rsp.ok) {
			Logger.error(undefined, `Removing repositories from workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: RemoveRepositoriesFromWorkspaceResponse | undefined = (await rsp.json()) as
			| RemoveRepositoriesFromWorkspaceResponse
			| undefined;

		return json;
	}
}
