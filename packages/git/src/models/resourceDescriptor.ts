export type ResourceDescriptor = { key: string } & Record<string, unknown>;

export type IssueResourceDescriptor = ResourceDescriptor & {
	id: string;
	name: string;
};

export type RepositoryDescriptor = ResourceDescriptor & {
	owner: string;
	name: string;
};

/**
 * A normalized read scope that unifies the three provider scoping representations (repo-level
 * `ProviderReposInput`, per-provider `PagingMode`, and org/project `ResourceDescriptor`s). Consumers pass
 * this single shape; the integration resolves it to the provider-appropriate inputs. At least one field
 * should be set:
 * - `org`: GitHub login / Bitbucket workspace / Azure organization / GitLab namespace
 * - `project`: Azure project / Jira project key
 * - `resourceId`: Jira/Azure resource id
 * - `repos`: explicit repositories to scope to
 */
export type ProviderScope = {
	org?: string;
	project?: string;
	resourceId?: string;
	repos?: RepositoryDescriptor[];
};
