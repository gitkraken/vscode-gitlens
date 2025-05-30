import type { IssueResourceDescriptor, RepositoryDescriptor, ResourceDescriptor } from '../models/resourceDescriptor';

export function isRepositoryDescriptor(resource: ResourceDescriptor): resource is RepositoryDescriptor {
	return (
		'key' in resource &&
		resource.key != null &&
		'owner' in resource &&
		resource.owner != null &&
		'name' in resource &&
		resource.name != null
	);
}
export function isIssueResourceDescriptor(resource: ResourceDescriptor): resource is IssueResourceDescriptor {
	return (
		'key' in resource &&
		resource.key != null &&
		'id' in resource &&
		resource.id != null &&
		'name' in resource &&
		resource.name != null
	);
}
