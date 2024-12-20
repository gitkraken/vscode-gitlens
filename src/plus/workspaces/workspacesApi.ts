import type { RequestInit } from '@env/fetch';
import type { Container } from '../../container';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import type { GraphQLRequest, ServerConnection } from '../gk/serverConnection';
import type {
	AddRepositoriesToWorkspaceResponse,
	AddWorkspaceRepoDescriptor,
	CloudWorkspaceConnection,
	CloudWorkspaceData,
	CreateWorkspaceResponse,
	DeleteWorkspaceResponse,
	RemoveRepositoriesFromWorkspaceResponse,
	RemoveWorkspaceRepoDescriptor,
	WorkspaceRepositoriesResponse,
	WorkspaceResponse,
	WorkspacesResponse,
} from './models';
import { CloudWorkspaceProviderInputType, defaultWorkspaceCount, defaultWorkspaceRepoCount } from './models';

export class WorkspacesApi {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	@log()
	async getWorkspace(
		id: string,
		options?: {
			includeRepositories?: boolean;
			repoCount?: number;
			repoPage?: number;
		},
	): Promise<WorkspaceResponse | undefined> {
		let repoQuery: string | undefined;
		if (options?.includeRepositories) {
			let repoQueryParams = `(first: ${options?.repoCount ?? defaultWorkspaceRepoCount}`;
			if (options?.repoPage) {
				repoQueryParams += `, page: ${options.repoPage}`;
			}
			repoQueryParams += ')';
			repoQuery = `
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
							provider_project_name
							provider_organization_id
							provider_organization_name
							url
						}
					}
				}
			`;
		}

		const queryData = `
			id
			description
			name
			organization {
				id
			}
			provider
			azure_organization_id
			azure_project
			repo_relation
			${repoQuery ?? ''}
		`;

		const query = `
			query getWorkspace {
				project(id: "${id}") { ${queryData} }
			}
		`;

		const rsp = await this.fetch({ query: query });

		if (!rsp.ok) {
			Logger.error(undefined, `Getting workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: WorkspaceResponse | undefined = (await rsp.json()) as WorkspaceResponse | undefined;

		return json;
	}

	@log()
	async getWorkspaces(options?: {
		count?: number;
		cursor?: string;
		includeOrganizations?: boolean;
		includeRepositories?: boolean;
		page?: number;
		repoCount?: number;
		repoPage?: number;
	}): Promise<WorkspacesResponse | undefined> {
		let repoQuery: string | undefined;
		if (options?.includeRepositories) {
			let repoQueryParams = `(first: ${options?.repoCount ?? defaultWorkspaceRepoCount}`;
			if (options?.repoPage) {
				repoQueryParams += `, page: ${options.repoPage}`;
			}
			repoQueryParams += ')';
			repoQuery = `
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
							provider_project_name
							provider_organization_id
							provider_organization_name
							url
						}
					}
				}
			`;
		}

		const queryData = `
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
				azure_organization_id
				azure_project
				repo_relation
				${repoQuery ?? ''}
			}
		`;

		let queryParams = `(first: ${options?.count ?? defaultWorkspaceCount}`;
		if (options?.cursor) {
			queryParams += `, after: "${options.cursor}"`;
		} else if (options?.page) {
			queryParams += `, page: ${options.page}`;
		}
		queryParams += ')';

		const query = `
			query getWorkpaces {
				memberProjects: projects ${queryParams} { ${queryData} }
			}
		`;

		const rsp = await this.fetch({ query: query });

		if (!rsp.ok) {
			Logger.error(undefined, `Getting workspaces failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const addedWorkspaceIds = new Set<string>();
		const json: { data: Record<string, CloudWorkspaceConnection<CloudWorkspaceData> | null> } | undefined =
			await rsp.json();
		if (json?.data == null) return undefined;
		let outputData: WorkspacesResponse | undefined;
		for (const workspaceData of Object.values(json.data)) {
			if (workspaceData == null) continue;
			if (outputData == null) {
				outputData = { data: { projects: workspaceData } };
				for (const node of workspaceData.nodes) {
					addedWorkspaceIds.add(node.id);
				}
			} else {
				for (const node of workspaceData.nodes) {
					if (addedWorkspaceIds.has(node.id)) continue;
					addedWorkspaceIds.add(node.id);
					outputData.data.projects.nodes.push(node);
				}
			}
		}

		if (outputData != null) {
			outputData.data.projects.total_count = addedWorkspaceIds.size;
		}

		return outputData;
	}

	@log()
	async getWorkspaceRepositories(
		workspaceId: string,
		options?: {
			count?: number;
			cursor?: string;
			page?: number;
		},
	): Promise<WorkspaceRepositoriesResponse | undefined> {
		let queryparams = `(first: ${options?.count ?? defaultWorkspaceRepoCount}`;
		if (options?.cursor) {
			queryparams += `, after: "${options.cursor}"`;
		} else if (options?.page) {
			queryparams += `, page: ${options.page}`;
		}
		queryparams += ')';

		const rsp = await this.fetch({
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
										provider_project_name
										provider_organization_id
										provider_organization_name
										url
									}
								}
							}
						}
					}
				`,
		});

		if (!rsp.ok) {
			Logger.error(undefined, `Getting workspace repos failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: WorkspaceRepositoriesResponse | undefined = (await rsp.json()) as
			| WorkspaceRepositoriesResponse
			| undefined;

		return json;
	}

	@log()
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

		const rsp = await this.fetch({
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
							azure_organization_id
							azure_project
							repo_relation
						}
					}
				`,
		});

		if (!rsp.ok) {
			Logger.error(undefined, `Creating workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: CreateWorkspaceResponse | undefined = (await rsp.json()) as CreateWorkspaceResponse | undefined;

		return json;
	}

	@log()
	async deleteWorkspace(workspaceId: string): Promise<DeleteWorkspaceResponse | undefined> {
		const rsp = await this.fetch({
			query: `
					mutation deleteWorkspace {
						delete_project(
							id: "${workspaceId}"
						) {
							id
						}
					}
				`,
		});

		if (!rsp.ok) {
			Logger.error(undefined, `Deleting workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: DeleteWorkspaceResponse | undefined = (await rsp.json()) as DeleteWorkspaceResponse | undefined;

		if (json?.errors?.some(error => error.message.includes('permission'))) {
			const errorMessage =
				'Adding repositories to workspace failed: you do not have permission to delete this workspace';
			Logger.error(undefined, errorMessage);
			throw new Error(errorMessage);
		}

		return json;
	}

	@log()
	async addReposToWorkspace(
		workspaceId: string,
		repos: AddWorkspaceRepoDescriptor[],
	): Promise<AddRepositoriesToWorkspaceResponse | undefined> {
		if (repos.length === 0) return;

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
			provider_project_name
			provider_organization_id
			provider_organization_name
			url
		}`,
			)
			.join(',');

		const rsp = await this.fetch({
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
		});

		if (!rsp.ok) {
			Logger.error(undefined, `Adding repositories to workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: AddRepositoriesToWorkspaceResponse | undefined = (await rsp.json()) as
			| AddRepositoriesToWorkspaceResponse
			| undefined;

		if (json?.errors?.some(error => error.message.includes('permission'))) {
			const errorMessage =
				'Adding repositories to workspace failed: you do not have permission to add repositories to this workspace';
			Logger.error(undefined, errorMessage);
			throw new Error(errorMessage);
		}

		return json;
	}

	@log()
	async removeReposFromWorkspace(
		workspaceId: string,
		repos: RemoveWorkspaceRepoDescriptor[],
	): Promise<RemoveRepositoriesFromWorkspaceResponse | undefined> {
		if (repos.length === 0) return;

		let reposQuery = '[';
		reposQuery += repos.map(r => `{ provider_organization_id: "${r.owner}", name: "${r.repoName}" }`).join(',');
		reposQuery += ']';

		const rsp = await this.fetch({
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
		});

		if (!rsp.ok) {
			Logger.error(undefined, `Removing repositories from workspace failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: RemoveRepositoriesFromWorkspaceResponse | undefined = (await rsp.json()) as
			| RemoveRepositoriesFromWorkspaceResponse
			| undefined;

		if (json?.errors?.some(error => error.message.includes('permission'))) {
			const errorMessage =
				'Adding repositories to workspace failed: you do not have permission to remove repositories from this workspace';
			Logger.error(undefined, errorMessage);
			throw new Error(errorMessage);
		}

		return json;
	}

	private async fetch(request: GraphQLRequest, init?: RequestInit) {
		return this.connection.fetchGkApiGraphQL('api/projects/graphql', request, init);
	}
}
