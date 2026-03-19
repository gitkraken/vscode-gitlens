import { Uri } from 'vscode';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import { getRepositoryIdentityForIssue } from '@gitlens/git/utils/issue.utils.js';
import { Schemes } from '../../../constants.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../models/repository.js';

export async function getOrOpenIssueRepository(
	container: Container,
	issue: IssueShape | Issue,
	options?: { promptIfNeeded?: boolean; skipVirtual?: boolean },
): Promise<GlRepository | undefined> {
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
