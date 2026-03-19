import * as assert from 'assert';
import { parseGitRemoteUrl } from '../remote.utils.js';

suite('Remote URL Parser Test Suite', () => {
	suite('parseGitRemoteUrl', () => {
		test('parses https url', () => {
			const url = 'https://github.com/gitkraken/vscode-gitlens.git';
			const [scheme, domain, path] = parseGitRemoteUrl(url);
			assert.strictEqual(scheme, 'https://');
			assert.strictEqual(domain, 'github.com');
			assert.strictEqual(path, 'gitkraken/vscode-gitlens');
		});

		test('parses ssh url', () => {
			const url = 'git@github.com:gitkraken/vscode-gitlens.git';
			const [_scheme, domain, path] = parseGitRemoteUrl(url);
			// The regex structure might return empty scheme for some formats or specific capture groups
			// Based on regex: (git@)(.*):
			// match[8] = github.com, match[9] = gitkraken/vscode-gitlens.git
			// scheme comes from match[1]||match[3]||match[6] which are schemes.
			// For git@... the scheme part is undefined in the regex (no protocol prefix like ssh://)
			// effectively it returns empty string for scheme in the current implementation?
			// Let's check implementation:
			// match[1] = git://
			// match[3] = https?://
			// match[6] = ssh://
			// If none match, scheme is undefined -> || || || undefined -> undefined?
			// But the return type is [scheme, domain, path].
			// If match[1]... are undefined, it might be empty string/undefined.
			// The implementation: match[1] || match[3] || match[6]
			// for `git@...` these are likely undefined.
			// So scheme is undefined.

			// Actually, let's look at the regex:
			// ^(?:(git:\/\/)(.*?)\/|(https?:\/\/)(?:.*?@)?(.*?)\/|git@(.*):|(ssh:\/\/)(?:.*@)?(.*?)(?::.*?)?(?:\/|(?=~))|(?:.*?@)(.*?):)(.*)$
			// 1: git://
			// 3: https://
			// 5: domain for git@
			// 6: ssh://
			// 7: domain for ssh://
			// 8: domain for user@host:

			// If it matches git@..., match[5] is the domain.
			// match[1], match[3], match[6] are undefined.
			// So parsed scheme is undefined?
			// The return array is [scheme, domain, path].
			// Let's verify what `undefined` becomes.

			assert.strictEqual(domain, 'github.com');
			assert.strictEqual(path, 'gitkraken/vscode-gitlens');
		});

		test('parses ssh:// url', () => {
			const url = 'ssh://git@github.com/gitkraken/vscode-gitlens.git';
			const [scheme, domain, path] = parseGitRemoteUrl(url);
			assert.strictEqual(scheme, 'ssh://');
			assert.strictEqual(domain, 'github.com');
			assert.strictEqual(path, 'gitkraken/vscode-gitlens');
		});
	});
});
