import { Uri } from 'vscode';
import { Schemes } from '../../../constants';
import type { Container } from '../../../container';
import type { Issue, IssueShape } from '../../models/issue';
import type { Repository } from '../../models/repository';
import { getRepositoryIdentityForIssue } from '../issue.utils';

export async function getOrOpenIssueRepository(
	container: Container,
	issue: IssueShape | Issue,
	options?: { promptIfNeeded?: boolean; skipVirtual?: boolean },
): Promise<Repository | undefined> {
	const identity = getRepositoryIdentityForIssue(issue);
	let repo = await container.repositoryIdentity.getRepository(identity, {
		openIfNeeded: true,
		keepOpen: false,
		prompt: false,
	});

	if (repo == null && !options?.skipVirtual) {
		const virtualUri = getVirtualUriForIssue(issue);
		if (virtualUri != null) {
			repo = await container.git.getOrOpenRepository(virtualUri, { closeOnOpen: true, detectNested: false });
		}
	}

	if (repo == null && options?.promptIfNeeded) {
		repo = await container.repositoryIdentity.getRepository(identity, {
			openIfNeeded: true,
			keepOpen: false,
			prompt: true,
		});
	}

	return repo;
}

export function getVirtualUriForIssue(issue: IssueShape | Issue): Uri | undefined {
	if (issue.repository == null) throw new Error('Missing repository');
	if (issue.provider.id !== 'github') return undefined;

	const uri = Uri.parse(issue.repository.url ?? issue.url);
	return uri.with({ scheme: Schemes.Virtual, authority: 'github', path: uri.path });
}
