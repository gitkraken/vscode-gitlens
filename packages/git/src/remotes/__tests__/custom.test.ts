/* eslint-disable no-template-curly-in-string */
import * as assert from 'assert';
import type { RemotesUrlsConfig } from '../../models/remoteProvider.js';
import { CustomRemoteProvider } from '../custom.js';

const stubUrls: RemotesUrlsConfig = {
	repository: '',
	branches: '',
	branch: '',
	commit: '',
	file: '',
	fileInBranch: '',
	fileInCommit: '',
	fileLine: '',
	fileRange: '',
};

function createProvider(avatarTemplate: string): CustomRemoteProvider {
	return new CustomRemoteProvider('git.corp.com', 'org/repo', { ...stubUrls, avatar: avatarTemplate });
}

suite('CustomRemoteProvider.getUrlForAvatar', () => {
	suite('basic interpolation', () => {
		test('interpolates all tokens', () => {
			const provider = createProvider('https://avatars.corp.com/${email}/${emailName}/${domain}?s=${size}');
			const url = provider.getUrlForAvatar('alice@corp.com', 32);
			assert.strictEqual(url, 'https://avatars.corp.com/alice%40corp.com/alice/corp.com?s=32');
		});

		test('returns undefined when no avatar template is configured', () => {
			const provider = new CustomRemoteProvider('git.corp.com', 'org/repo', stubUrls);
			assert.strictEqual(provider.getUrlForAvatar('alice@corp.com', 32), undefined);
			assert.strictEqual(provider.avatarUrlTemplate, undefined);
		});

		test('handles email-only template', () => {
			const provider = createProvider('https://avatars.corp.com/${email}');
			assert.strictEqual(
				provider.getUrlForAvatar('alice@corp.com', 16),
				'https://avatars.corp.com/alice%40corp.com',
			);
		});

		test('handles size-only template', () => {
			const provider = createProvider('https://avatars.corp.com/default?s=${size}');
			assert.strictEqual(provider.getUrlForAvatar('alice@corp.com', 64), 'https://avatars.corp.com/default?s=64');
		});
	});

	suite('email parsing', () => {
		test('splits on last @ for standard email', () => {
			const provider = createProvider('${emailName}---${domain}');
			assert.strictEqual(provider.getUrlForAvatar('alice@corp.com', 16), 'alice---corp.com');
		});

		test('preserves local-part containing @ (RFC 5322)', () => {
			const provider = createProvider('${emailName}---${domain}');
			assert.strictEqual(
				provider.getUrlForAvatar('"user@internal"@corp.com', 16),
				'%22user%40internal%22---corp.com',
			);
		});

		test('handles email with no @', () => {
			const provider = createProvider('${emailName}---${domain}');
			assert.strictEqual(provider.getUrlForAvatar('localonly', 16), 'localonly---');
		});

		test('handles email with multiple @ signs', () => {
			const provider = createProvider('${emailName}---${domain}');
			assert.strictEqual(provider.getUrlForAvatar('a@b@c.com', 16), 'a%40b---c.com');
		});
	});

	suite('URI encoding of special characters', () => {
		test('encodes slash in email', () => {
			const provider = createProvider('https://avatars.corp.com/${email}');
			const url = provider.getUrlForAvatar('user/admin@corp.com', 16);
			assert.ok(url!.includes('user%2Fadmin%40corp.com'));
		});

		test('encodes question mark in email', () => {
			const provider = createProvider('https://avatars.corp.com/${email}');
			const url = provider.getUrlForAvatar('user?q=1@corp.com', 16);
			assert.ok(url!.includes('user%3Fq%3D1%40corp.com'));
		});

		test('encodes hash in email', () => {
			const provider = createProvider('https://avatars.corp.com/${email}');
			const url = provider.getUrlForAvatar('user#tag@corp.com', 16);
			assert.ok(url!.includes('user%23tag%40corp.com'));
		});

		test('encodes spaces', () => {
			const provider = createProvider('https://avatars.corp.com/${emailName}');
			const url = provider.getUrlForAvatar('first last@corp.com', 16);
			assert.ok(url!.includes('first%20last'));
		});

		test('encodes unicode characters', () => {
			const provider = createProvider('https://avatars.corp.com/${emailName}');
			const url = provider.getUrlForAvatar('ünïcödé@corp.com', 16);
			assert.strictEqual(url, 'https://avatars.corp.com/%C3%BCn%C3%AFc%C3%B6d%C3%A9');
		});

		test('encodes colon and at-sign to prevent authority injection', () => {
			const provider = createProvider('https://avatars.corp.com/${email}');
			const url = provider.getUrlForAvatar('evil:pass@attacker.com', 16);
			assert.ok(url!.includes('evil%3Apass%40attacker.com'));
		});
	});
});
