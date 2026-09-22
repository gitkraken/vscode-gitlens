import * as assert from 'node:assert';
import {
	getKeplerInstallPaths,
	getKeplerPackageName,
	getKeplerProductName,
	getKeplerProviderId,
	isKeplerSupportedProvider,
} from '../keplerProviders.js';

suite('getKeplerProviderId', () => {
	test('maps every GitLens integration id Kepler supports to its Kepler ProviderId', () => {
		assert.strictEqual(getKeplerProviderId('github'), 'github');
		assert.strictEqual(getKeplerProviderId('cloud-github-enterprise'), 'githubEnterprise');
		assert.strictEqual(getKeplerProviderId('gitlab'), 'gitlab');
		assert.strictEqual(getKeplerProviderId('cloud-gitlab-self-hosted'), 'gitlabSelfHosted');
		assert.strictEqual(getKeplerProviderId('bitbucket'), 'bitbucket');
		assert.strictEqual(getKeplerProviderId('azureDevOps'), 'azure');
		assert.strictEqual(getKeplerProviderId('jira'), 'jira');
		assert.strictEqual(getKeplerProviderId('linear'), 'linear');
		assert.strictEqual(getKeplerProviderId('trello'), 'trello');
	});

	test('returns undefined for the two GitLens ids Kepler has no product support for at all', () => {
		assert.strictEqual(getKeplerProviderId('bitbucket-server'), undefined);
		assert.strictEqual(getKeplerProviderId('azure-devops-server'), undefined);
	});

	test('returns undefined for an arbitrary unrecognised string', () => {
		assert.strictEqual(getKeplerProviderId('not-a-real-provider'), undefined);
		assert.strictEqual(getKeplerProviderId(''), undefined);
	});
});

suite('isKeplerSupportedProvider', () => {
	test('bitbucket is PR-capable but not issue-capable — Kepler does not support Bitbucket issues', () => {
		assert.strictEqual(isKeplerSupportedProvider('pr', 'bitbucket'), true);
		assert.strictEqual(isKeplerSupportedProvider('issue', 'bitbucket'), false);
	});

	test('providers common to both kinds pass for both', () => {
		for (const provider of ['github', 'githubEnterprise', 'gitlab', 'gitlabSelfHosted', 'azure']) {
			assert.strictEqual(isKeplerSupportedProvider('pr', provider), true);
			assert.strictEqual(isKeplerSupportedProvider('issue', provider), true);
		}
	});

	test('issue-only providers fail for pr', () => {
		for (const provider of ['jira', 'linear', 'trello']) {
			assert.strictEqual(isKeplerSupportedProvider('pr', provider), false);
			assert.strictEqual(isKeplerSupportedProvider('issue', provider), true);
		}
	});

	test('an unmapped or undefined provider fails for both kinds', () => {
		assert.strictEqual(isKeplerSupportedProvider('pr', undefined), false);
		assert.strictEqual(isKeplerSupportedProvider('issue', undefined), false);
		assert.strictEqual(isKeplerSupportedProvider('pr', 'not-a-real-provider'), false);
		assert.strictEqual(isKeplerSupportedProvider('issue', 'not-a-real-provider'), false);
	});
});

suite('getKeplerProductName', () => {
	test("mirrors Kepler's getChannelProductName for every channel", () => {
		assert.strictEqual(getKeplerProductName('production'), 'Kepler');
		assert.strictEqual(getKeplerProductName('staging'), 'Kepler (staging)');
		assert.strictEqual(getKeplerProductName('dev'), 'Kepler (dev)');
		assert.strictEqual(getKeplerProductName('source'), 'Kepler (source)');
	});
});

suite('getKeplerPackageName', () => {
	test("mirrors Kepler's getChannelPackageName for every channel", () => {
		assert.strictEqual(getKeplerPackageName('production'), 'kepler');
		assert.strictEqual(getKeplerPackageName('staging'), 'kepler-staging');
		assert.strictEqual(getKeplerPackageName('dev'), 'kepler-dev');
		assert.strictEqual(getKeplerPackageName('source'), 'kepler-source');
	});
});

suite('getKeplerInstallPaths', () => {
	const macEnv = { home: '/Users/me', localAppData: undefined };
	const winEnv = {
		home: 'C:\\Users\\me',
		localAppData: 'C:\\Users\\me\\AppData\\Local',
	};
	const linuxEnv = { home: '/home/me', localAppData: undefined };

	test('macOS probes the system and per-user Applications folders, spaces and parentheses literal', () => {
		assert.deepStrictEqual(getKeplerInstallPaths('production', 'darwin', macEnv), [
			'/Applications/Kepler.app',
			'/Users/me/Applications/Kepler.app',
		]);
		assert.deepStrictEqual(getKeplerInstallPaths('staging', 'darwin', macEnv), [
			'/Applications/Kepler (staging).app',
			'/Users/me/Applications/Kepler (staging).app',
		]);
		assert.deepStrictEqual(getKeplerInstallPaths('dev', 'darwin', macEnv), [
			'/Applications/Kepler (dev).app',
			'/Users/me/Applications/Kepler (dev).app',
		]);
		assert.deepStrictEqual(getKeplerInstallPaths('source', 'darwin', macEnv), [
			'/Applications/Kepler (source).app',
			'/Users/me/Applications/Kepler (source).app',
		]);
	});

	test('macOS skips the per-user folder when the home directory is unknown', () => {
		assert.deepStrictEqual(
			getKeplerInstallPaths('production', 'darwin', {
				home: '',
				localAppData: undefined,
			}),
			['/Applications/Kepler.app'],
		);
	});

	test('Windows probes the per-user Programs folder by package name, then product name', () => {
		assert.deepStrictEqual(getKeplerInstallPaths('production', 'win32', winEnv), [
			'C:\\Users\\me\\AppData\\Local\\Programs\\kepler',
		]);
		assert.deepStrictEqual(getKeplerInstallPaths('staging', 'win32', winEnv), [
			'C:\\Users\\me\\AppData\\Local\\Programs\\kepler-staging',
			'C:\\Users\\me\\AppData\\Local\\Programs\\Kepler (staging)',
		]);
		assert.deepStrictEqual(getKeplerInstallPaths('dev', 'win32', winEnv), [
			'C:\\Users\\me\\AppData\\Local\\Programs\\kepler-dev',
			'C:\\Users\\me\\AppData\\Local\\Programs\\Kepler (dev)',
		]);
		assert.deepStrictEqual(getKeplerInstallPaths('source', 'win32', winEnv), [
			'C:\\Users\\me\\AppData\\Local\\Programs\\kepler-source',
			'C:\\Users\\me\\AppData\\Local\\Programs\\Kepler (source)',
		]);
	});

	test('Windows probes nothing when LOCALAPPDATA is unset', () => {
		assert.deepStrictEqual(
			getKeplerInstallPaths('production', 'win32', {
				home: 'C:\\Users\\me',
				localAppData: undefined,
			}),
			[],
		);
	});

	test('Linux probes the deb/rpm install dir under /opt, spaces and parentheses literal', () => {
		assert.deepStrictEqual(getKeplerInstallPaths('production', 'linux', linuxEnv), ['/opt/Kepler']);
		assert.deepStrictEqual(getKeplerInstallPaths('staging', 'linux', linuxEnv), ['/opt/Kepler (staging)']);
		assert.deepStrictEqual(getKeplerInstallPaths('dev', 'linux', linuxEnv), ['/opt/Kepler (dev)']);
		assert.deepStrictEqual(getKeplerInstallPaths('source', 'linux', linuxEnv), ['/opt/Kepler (source)']);
	});

	test('probes nothing on an unsupported platform', () => {
		assert.deepStrictEqual(getKeplerInstallPaths('production', 'freebsd', linuxEnv), []);
	});
});
