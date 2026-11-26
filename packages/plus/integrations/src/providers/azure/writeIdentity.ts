import type { ProviderRequestFunction, ProviderRequestResponse } from '../models.js';

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
