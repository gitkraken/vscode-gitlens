export type ResourceDescriptor = { key: string } & Record<string, unknown>;

export type IssueResourceDescriptor = ResourceDescriptor & {
	id: string;
	name: string;
};

export type RepositoryDescriptor = ResourceDescriptor & {
	owner: string;
	name: string;
};
