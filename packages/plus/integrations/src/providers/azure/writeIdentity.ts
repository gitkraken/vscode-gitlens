import type { ProviderRequestFunction, ProviderRequestResponse } from '../models.js';
import { decodeAzurePathSegment } from './azure.utils.js';

const azureProfileApi = 'https://app.vssps.visualstudio.com/_apis';

export function getAzureWriteProfile(
	request: ProviderRequestFunction,
	accessToken: string,
): Promise<ProviderRequestResponse<{ id?: string }>> {
	return request<{ id?: string }>({
		url: `${azureProfileApi}/profile/profiles/me`,
		headers: { Authorization: `Bearer ${accessToken}` },
		redirect: 'error',
	});
}

export function getAzureWriteOrganizations(
	request: ProviderRequestFunction,
	authorization: string,
	accountId: string,
): Promise<ProviderRequestResponse<{ value?: { accountId: string; accountName: string }[] }>> {
	return request<{ value?: { accountId: string; accountName: string }[] }>({
		url: `${azureProfileApi}/accounts?memberId=${encodeURIComponent(accountId)}&api-version=7.1`,
		headers: { Authorization: authorization },
		redirect: 'error',
	});
}

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function isAzureGuid(value: unknown): value is string {
	return typeof value === 'string' && guidPattern.test(value);
}

export function isAzureIdentifier(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.trim() === value &&
		![...value].some(character => character < ' ' || character === '\x7f')
	);
}

export function isAzurePositiveInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

export function sameAzureIdentifier(actual: unknown, expected: string): boolean {
	return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

export async function verifyAzureServerCollection(
	request: ProviderRequestFunction,
	headers: Record<string, string>,
	collectionUrl: string,
	expected: { organizationId: string; organizationName: string; expectedAccountId?: string },
): Promise<{ id: string; name: string; accountId: string } | 'not-found' | 'no-connection'> {
	const { body: data } = await request<{
		instanceId?: unknown;
		webApplicationRelativeDirectory?: unknown;
		authenticatedUser?: { id?: unknown };
	}>({ url: `${collectionUrl}/_apis/connectionData`, headers: headers, redirect: 'error' });
	const segment =
		typeof data?.webApplicationRelativeDirectory === 'string'
			? data.webApplicationRelativeDirectory.split('/').findLast(Boolean)
			: undefined;
	const name = segment != null ? decodeAzurePathSegment(segment) : undefined;
	if (
		!isAzureGuid(data?.instanceId) ||
		!sameAzureIdentifier(data.instanceId, expected.organizationId) ||
		name == null ||
		!sameAzureIdentifier(name, expected.organizationName)
	) {
		return 'not-found';
	}

	const accountId = data.authenticatedUser?.id;
	if (
		!isAzureIdentifier(accountId) ||
		(expected.expectedAccountId !== undefined && !sameAzureIdentifier(accountId, expected.expectedAccountId))
	) {
		return 'no-connection';
	}

	return { id: data.instanceId, name: name, accountId: accountId };
}
