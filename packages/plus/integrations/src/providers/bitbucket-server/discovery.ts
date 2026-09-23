import { sha256 } from '@gitlens/utils/crypto.js';
import type { TokenWithInfo } from '../../authentication/models.js';
import type { GitSelfManagedHostIntegrationId } from '../../constants.js';
import type {
	ProviderApiPagedResult,
	ProviderOrganization,
	ProviderRepository,
	ProviderRequestFunction,
} from '../models.js';
import { throwProviderError } from '../providerErrors.js';

type ProjectResponse = {
	key: string;
	links?: { self?: { href: string }[] };
};

type RepositoryResponse = {
	id: number;
	slug: string;
	project: ProjectResponse;
	links: {
		self: { href: string }[];
		clone: { name: string; href: string }[];
	};
};

type DiscoveryCursor = { scope: string; start: number; seen: string[] };

function parseCursor(cursor: string | undefined, scope: string): DiscoveryCursor {
	if (cursor == null) return { scope: scope, start: 0, seen: [] };

	const parsed = JSON.parse(cursor) as { type?: unknown; value?: Partial<DiscoveryCursor> | number } | null;
	const value = parsed?.value;
	if (
		parsed?.type !== 'cursor' ||
		value == null ||
		typeof value !== 'object' ||
		value.scope !== scope ||
		typeof value.start !== 'number' ||
		!Number.isSafeInteger(value.start) ||
		value.start <= 0 ||
		!Array.isArray(value.seen) ||
		!value.seen.every(id => typeof id === 'string')
	) {
		throw new Error('Invalid Bitbucket Data Center discovery cursor for this connection or scope');
	}

	return { scope: scope, start: value.start, seen: value.seen };
}

function toInstallationUrl(baseUrl: string): string {
	return baseUrl.replace(/\/rest\/api\/1\.0$/, '');
}

/** The paths the web UI serves a project at; a personal project (`~user`) is also served under its owner. */
function getProjectPaths(key: string): string[] {
	return key.startsWith('~') ? [`/projects/${key}`, `/users/${key.slice(1)}`] : [`/projects/${key}`];
}

/**
 * Keeps a link the server supplied only when it names one of `paths` on this connection's installation, then removes
 * credentials, query and fragment. A response therefore cannot hand a consumer a remote on another host, or for a
 * different repository than the entry it describes. Bitbucket serves SSH on its own port and without the context
 * path, so an SSH link is held to the installation's hostname alone.
 */
function sanitizeLink(href: string | undefined, installationUrl: string, paths: string[], ssh = false): string | null {
	if (href == null) return null;

	try {
		const url = new URL(href);
		const installation = new URL(installationUrl);
		if (ssh) {
			if (url.protocol !== 'ssh:' || url.hostname.toLowerCase() !== installation.hostname) return null;
		} else if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== installation.origin) {
			return null;
		}

		// Project keys and slugs resolve case-insensitively, and clone links spell the key in lower case.
		const base = ssh ? '' : installation.pathname.replace(/\/+$/, '');
		const path = url.pathname.toLowerCase();
		if (!paths.some(expected => path === `${base}${expected}`.toLowerCase())) return null;

		if (!ssh) {
			url.username = '';
		}
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

async function requestPage<T, R extends { id: string }>(
	request: ProviderRequestFunction,
	token: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
	connectionId: string,
	endpoint: string,
	cursor: string | undefined,
	map: (value: T) => R,
): Promise<ProviderApiPagedResult<R>> {
	try {
		const scope = await sha256(JSON.stringify([connectionId, endpoint]));
		const { start, seen } = parseCursor(cursor, scope);
		const url = new URL(endpoint);
		url.searchParams.set('start', String(start));
		url.searchParams.set('limit', '100');
		const { body } = await request<{
			values: T[];
			start: number;
			isLastPage: boolean;
			nextPageStart?: number;
		}>({ url: url.toString(), headers: { Authorization: `Bearer ${token.accessToken}` } });
		if (
			body == null ||
			!Array.isArray(body.values) ||
			typeof body.isLastPage !== 'boolean' ||
			body.start !== start
		) {
			throw new Error('Invalid Bitbucket Data Center discovery page');
		}

		const identities = new Set(seen);
		const values: R[] = [];
		for (const raw of body.values) {
			const value = map(raw);
			if (typeof value.id !== 'string' || value.id.length === 0) {
				throw new Error('Missing Bitbucket Data Center discovery identity');
			}
			if (identities.has(value.id)) continue;

			identities.add(value.id);
			values.push(value);
		}

		const next = body.nextPageStart;
		const more = !body.isLastPage && next != null && Number.isSafeInteger(next) && next > start;
		const truncated = !body.isLastPage && !more;
		return {
			values: values,
			paging: {
				more: more,
				cursor: more
					? JSON.stringify({ type: 'cursor', value: { scope: scope, start: next, seen: [...identities] } })
					: '{}',
				truncated: truncated || undefined,
			},
			metadata: { completeness: truncated ? 'partial' : 'complete' },
		};
	} catch (ex) {
		return throwProviderError(token, ex);
	}
}

export function requestBitbucketServerProjects(
	request: ProviderRequestFunction,
	token: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
	baseUrl: string,
	connectionId: string,
	cursor?: string,
): Promise<ProviderApiPagedResult<ProviderOrganization>> {
	const installationUrl = toInstallationUrl(baseUrl);
	return requestPage<ProjectResponse, ProviderOrganization>(
		request,
		token,
		connectionId,
		`${baseUrl}/projects`,
		cursor,
		project => ({
			id: project.key,
			providerId: token.providerId,
			name: project.key,
			url:
				sanitizeLink(project.links?.self?.[0]?.href, installationUrl, getProjectPaths(project.key)) ??
				`${installationUrl}/projects/${encodeURIComponent(project.key)}`,
		}),
	);
}

export function requestBitbucketServerRepositories(
	request: ProviderRequestFunction,
	token: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
	baseUrl: string,
	connectionId: string,
	options?: { project?: string; cursor?: string },
): Promise<ProviderApiPagedResult<ProviderRepository>> {
	if (options?.project === '' || options?.project === '.' || options?.project === '..') {
		throw new Error('Invalid Bitbucket Data Center project key');
	}

	const endpoint =
		options?.project != null
			? `${baseUrl}/projects/${encodeURIComponent(options.project)}/repos`
			: `${baseUrl}/repos`;
	const installationUrl = toInstallationUrl(baseUrl);
	return requestPage<RepositoryResponse, ProviderRepository>(
		request,
		token,
		connectionId,
		endpoint,
		options?.cursor,
		repo => {
			const key = encodeURIComponent(repo.project.key);
			const slug = encodeURIComponent(repo.slug);
			const webPaths = getProjectPaths(repo.project.key).map(path => `${path}/repos/${repo.slug}`);
			return {
				id: repo.id.toString(),
				namespace: repo.project.key,
				name: repo.slug,
				// A link that fails validation (e.g. a server whose advertised base URL differs from the address the
				// connection is configured with) falls back to the canonical path on that address, like a project's.
				webUrl:
					sanitizeLink(repo.links.self[0]?.href, installationUrl, [
						...webPaths,
						...webPaths.map(path => `${path}/browse`),
					]) ?? `${installationUrl}/projects/${key}/repos/${slug}/browse`,
				httpsUrl:
					sanitizeLink(
						repo.links.clone.find(link => link.name === 'https' || link.name === 'http')?.href,
						installationUrl,
						[`/scm/${repo.project.key}/${repo.slug}.git`],
					) ?? `${installationUrl}/scm/${key}/${slug}.git`,
				// SSH has its own port (and possibly host) that the connection cannot know, so nothing to fall back to.
				sshUrl: sanitizeLink(
					repo.links.clone.find(link => link.name === 'ssh')?.href,
					installationUrl,
					[`/${repo.project.key}/${repo.slug}.git`],
					true,
				),
				defaultBranch: null,
				permissions: null,
			};
		},
	);
}
