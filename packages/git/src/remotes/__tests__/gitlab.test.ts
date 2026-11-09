import * as assert from 'assert';
import { parseUri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../../context.js';
import type { Autolink } from '../../models/autolink.js';
import type { ParsedRemoteFileUri } from '../../models/remoteProvider.js';
import { RemoteResourceType } from '../../models/remoteResource.js';
import type { GitLabRepositoryDescriptor } from '../gitlab.js';
import { GitLabRemoteProvider } from '../gitlab.js';

function parseAutolinks(provider: GitLabRemoteProvider, text: string): Map<string, Autolink> {
	const autolinks = new Map<string, Autolink>();
	for (const ref of provider.autolinks) {
		if ('parse' in ref) {
			ref.parse(text, autolinks);
		}
	}
	return autolinks;
}

function getBranchPath(parsed: ParsedRemoteFileUri, branch: string): string | undefined {
	for (const candidate of parsed.candidates) {
		if (candidate.type === 'branches') return candidate.possibleBranches.get(branch);
	}
	return undefined;
}

suite('GitLabRemoteProvider nested groups', () => {
	suite('autolinks', () => {
		for (const [label, domain, path, text, repoPath] of [
			['flat path', 'gitlab.com', 'acme/kepler', 'see acme/kepler#12', 'acme/kepler'],
			[
				'nested group',
				'gitlab.com',
				'acme/platform/kepler',
				'see acme/platform/kepler#12',
				'acme/platform/kepler',
			],
			[
				'deeply nested group',
				'gitlab.example.com',
				'acme/platform/tools/kepler',
				'see acme/platform/tools/kepler#12',
				'acme/platform/tools/kepler',
			],
		]) {
			test(`${label}: an issue reference names the namespace and the repository`, () => {
				const provider = new GitLabRemoteProvider(domain, path);
				const link = parseAutolinks(provider, text).get('12');
				assert.ok(link);

				const lastSlash = repoPath.lastIndexOf('/');
				assert.strictEqual(link.prefix, `${repoPath}#`);
				assert.strictEqual(link.url, `https://${domain}/${repoPath}/-/issues/12`);
				const descriptor = link.descriptor as GitLabRepositoryDescriptor;
				assert.strictEqual(descriptor.owner, repoPath.substring(0, lastSlash));
				assert.strictEqual(descriptor.name, repoPath.substring(lastSlash + 1));
			});

			test(`${label}: a merge request reference names the namespace and the repository`, () => {
				const provider = new GitLabRemoteProvider(domain, path);
				const link = parseAutolinks(provider, text.replace('#', '!')).get('12');
				assert.ok(link);

				const lastSlash = repoPath.lastIndexOf('/');
				assert.strictEqual(link.prefix, `${repoPath}!`);
				assert.strictEqual(link.url, `https://${domain}/${repoPath}/-/merge_requests/12`);
				const descriptor = link.descriptor as GitLabRepositoryDescriptor;
				assert.strictEqual(descriptor.owner, repoPath.substring(0, lastSlash));
				assert.strictEqual(descriptor.name, repoPath.substring(lastSlash + 1));
			});
		}
	});

	suite('parseRemoteFileUri', () => {
		test('parses a file in a flat path', () => {
			const provider = new GitLabRemoteProvider('gitlab.com', 'acme/kepler');
			const parsed = provider.parseRemoteFileUri(
				parseUri('https://gitlab.com/acme/kepler/-/blob/main/src/index.ts#L3-5'),
			);
			assert.ok(parsed);
			assert.strictEqual(parsed.startLine, 3);
			assert.strictEqual(parsed.endLine, 5);
			assert.strictEqual(getBranchPath(parsed, 'main'), '/src/index.ts');
		});

		for (const path of ['acme/platform/kepler', 'acme/platform/tools/kepler']) {
			test(`parses a file in the nested group ${path}`, () => {
				const provider = new GitLabRemoteProvider('gitlab.example.com', path);
				const parsed = provider.parseRemoteFileUri(
					parseUri(`https://gitlab.example.com/${path}/-/blob/main/src/index.ts#L3`),
				);
				assert.ok(parsed);
				assert.strictEqual(parsed.startLine, 3);
				assert.strictEqual(getBranchPath(parsed, 'main'), '/src/index.ts');
			});
		}

		test('ignores a file in another repository', () => {
			const provider = new GitLabRemoteProvider('gitlab.com', 'acme/platform/kepler');
			assert.strictEqual(
				provider.parseRemoteFileUri(parseUri('https://gitlab.com/acme/platform/other/-/blob/main/a.ts')),
				undefined,
			);
		});
	});

	suite('create pull request across forks', () => {
		for (const [label, basePath, owner, name] of [
			['flat path', 'acme/kepler', 'acme', 'kepler'],
			['nested group', 'acme/platform/kepler', 'acme/platform', 'kepler'],
		]) {
			test(`${label}: looks up the target project by namespace and name`, async () => {
				let target: { owner: string; name: string } | undefined;
				const context: RemoteProviderContext = {
					getRepositoryInfo: (_id, t) => {
						target = t;
						return Promise.resolve({ id: '42' });
					},
				};
				const provider = new GitLabRemoteProvider(
					'gitlab.com',
					'fork/kepler',
					'https',
					undefined,
					false,
					context,
				);

				const url = await provider.url({
					type: RemoteResourceType.CreatePullRequest,
					repoPath: '/repo',
					base: {
						branch: 'main',
						remote: { path: basePath, url: `https://gitlab.com/${basePath}.git`, name: 'upstream' },
					},
					head: {
						branch: 'feature',
						remote: { path: 'fork/kepler', url: 'https://gitlab.com/fork/kepler.git', name: 'origin' },
					},
				});

				assert.deepStrictEqual(target, { owner: owner, name: name });
				assert.ok(url?.includes('merge_request%5Btarget_project_id%5D=42'));
			});
		}
	});
});
