import * as assert from 'assert';
import { getRemoteNameSlashIndex } from '@gitlens/utils/gitRefs.js';
import { GitBranch } from '../../models/branch.js';
import {
	getBranchNameAndRemote,
	getBranchTrackingWithoutRemote,
	isDetachedHead,
	parseRefName,
	parseUpstream,
	splitRemoteBranchName,
} from '../branch.utils.js';

suite('Branch Utils Test Suite', () => {
	suite('parseUpstream', () => {
		// KEY ORDER IS A CONTRACT, not a style choice. These objects are handed straight to
		// `createReference` and serialized with a bare `JSON.stringify` into the graph's ref-pill
		// `data-vscode-context`, and the webview rebuilds the same payload from the wire
		// (`webviews/apps/plus/graph/utils/refContext.utils.ts`). A reordering here silently changes the
		// bytes on one side only, so a `when` clause could match on a ref pill and not in Inspect.
		// `providers/branches.ts` re-spreads this object, which preserves whatever order it is given —
		// meaning this function is the single place the order is actually decided.
		test('yields name, missing, state in that order — both arms', () => {
			assert.deepStrictEqual(Object.keys(parseUpstream('refs/remotes/origin/main', '[ahead 3]')!), [
				'name',
				'missing',
				'state',
			]);
			// The no-match arm is a separate literal and drifts independently.
			assert.deepStrictEqual(Object.keys(parseUpstream('refs/remotes/origin/main', '')!), [
				'name',
				'missing',
				'state',
			]);
		});

		test('state is ahead then behind', () => {
			assert.deepStrictEqual(
				Object.keys(parseUpstream('refs/remotes/origin/main', '[ahead 3, behind 1]')!.state),
				['ahead', 'behind'],
			);
		});

		test('parses ahead only', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[ahead 3]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 3, behind: 0 },
			});
		});

		test('parses behind only', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[behind 2]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 0, behind: 2 },
			});
		});

		test('parses both ahead and behind', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[ahead 3, behind 2]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 3, behind: 2 },
			});
		});

		test('parses gone upstream', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[gone]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: true,
				state: { ahead: 0, behind: 0 },
			});
		});

		test('returns ahead:0 behind:0 for empty tracking string', () => {
			const result = parseUpstream('refs/remotes/origin/main', '');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 0, behind: 0 },
			});
		});

		test('returns undefined for empty upstream string', () => {
			const result = parseUpstream('', '[ahead 1]');
			assert.strictEqual(result, undefined);
		});

		test('strips refs/remotes/ prefix from upstream name', () => {
			const result = parseUpstream('refs/remotes/origin/feature', '');
			assert.strictEqual(result?.name, 'origin/feature');
		});

		test('strips refs/heads/ prefix from upstream name', () => {
			const result = parseUpstream('refs/heads/main', '');
			assert.strictEqual(result?.name, 'main');
		});

		test('keeps the remote git reports', () => {
			assert.strictEqual(parseUpstream('refs/remotes/team/fork/x', '', 'team/fork')?.remote, 'team/fork');
			assert.strictEqual(parseUpstream('refs/remotes/team/fork/x', '[gone]', 'team/fork')?.remote, 'team/fork');
		});

		test('marks an upstream under refs/heads/ as local', () => {
			const local = parseUpstream('refs/heads/main', '');
			assert.strictEqual(local?.local, true);
			assert.strictEqual(local?.remote, undefined);
			assert.strictEqual(parseUpstream('refs/heads/main', '[gone]')?.local, true);
			assert.strictEqual('local' in parseUpstream('refs/remotes/origin/main', '', 'origin')!, false);
		});

		test('a reported remote wins over a custom refspec that fetches into refs/heads/', () => {
			const result = parseUpstream('refs/heads/fetched/x', '', 'origin', 'refs/heads/x');
			assert.strictEqual(result?.remote, 'origin');
			assert.strictEqual(result?.remoteBranch, 'x');
			assert.strictEqual('local' in result, false);
		});

		test('a local (.) remote is local; with none reported, only the refs/heads/ prefix decides', () => {
			assert.strictEqual(parseUpstream('refs/heads/main', '', '.')?.local, true);
			assert.strictEqual(parseUpstream('refs/heads/main', '', undefined)?.local, true);
			assert.strictEqual(parseUpstream('refs/heads/main', '', '')?.local, true);
			assert.strictEqual('local' in parseUpstream('refs/remotes/origin/x', '', undefined)!, false);
		});

		test('ignores an empty or local (.) remote', () => {
			assert.strictEqual(parseUpstream('refs/heads/main', '', '.')?.remote, undefined);
			assert.strictEqual(parseUpstream('refs/remotes/origin/main', '[ahead 1]', '')?.remote, undefined);
			assert.strictEqual(parseUpstream('refs/remotes/origin/main', '', undefined)?.remote, undefined);
		});

		test('reads the remote-side branch from remoteRef, stripping refs/heads/', () => {
			assert.strictEqual(parseUpstream('refs/remotes/mirror/x', '', 'origin', 'refs/heads/x')?.remoteBranch, 'x');
			assert.strictEqual(
				parseUpstream('refs/remotes/mirror/x', '[gone]', 'origin', 'refs/heads/feat/x')?.remoteBranch,
				'feat/x',
			);
			assert.strictEqual(
				parseUpstream('refs/remotes/origin/x', '', 'origin', 'refs/tags/x')?.remoteBranch,
				'refs/tags/x',
			);
		});

		test('leaves remoteBranch unset for an empty or local (.) remote, or an empty remoteRef', () => {
			assert.strictEqual(parseUpstream('refs/heads/main', '', '.', 'refs/heads/main')?.remoteBranch, undefined);
			assert.strictEqual(parseUpstream('refs/heads/main', '', '', 'refs/heads/main')?.remoteBranch, undefined);
			assert.strictEqual(parseUpstream('refs/remotes/origin/x', '', 'origin', '')?.remoteBranch, undefined);
			assert.strictEqual(parseUpstream('refs/remotes/origin/x', '', 'origin')?.remoteBranch, undefined);
			assert.strictEqual('remoteBranch' in parseUpstream('refs/remotes/origin/x', '', 'origin', '')!, false);
		});

		test('treats non-numeric ahead/behind as 0', () => {
			// The regex only captures digits, so non-numeric values won't match
			// and the capture group will be undefined, resulting in 0
			const result = parseUpstream('refs/remotes/origin/main', '[ahead abc]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 0, behind: 0 },
			});
		});
	});

	suite('parseRefName', () => {
		test('strips refs/heads/ and returns remote:false', () => {
			const result = parseRefName('refs/heads/main');
			assert.deepStrictEqual(result, { name: 'main', remote: false });
		});

		test('strips refs/remotes/ and returns remote:true', () => {
			const result = parseRefName('refs/remotes/origin/main');
			assert.deepStrictEqual(result, { name: 'origin/main', remote: true });
		});

		test('strips heads/ prefix without refs/', () => {
			const result = parseRefName('heads/feature');
			assert.deepStrictEqual(result, { name: 'feature', remote: false });
		});

		test('strips remotes/ prefix without refs/', () => {
			const result = parseRefName('remotes/origin/feature');
			assert.deepStrictEqual(result, { name: 'origin/feature', remote: true });
		});

		test('returns plain name unchanged with remote:false', () => {
			const result = parseRefName('plainname');
			assert.deepStrictEqual(result, { name: 'plainname', remote: false });
		});

		test('is case-insensitive for prefix matching', () => {
			const result = parseRefName('Refs/Heads/main');
			assert.deepStrictEqual(result, { name: 'main', remote: false });
		});
	});

	suite('getRemoteNameSlashIndex', () => {
		test('returns index of first slash for plain remote/branch', () => {
			const result = getRemoteNameSlashIndex('origin/main');
			assert.strictEqual(result, 6);
		});

		test('returns index of slash after remotes/ prefix', () => {
			// 'remotes/' is 8 chars, so indexOf('/', 8) finds the '/' at index 14
			const result = getRemoteNameSlashIndex('remotes/origin/main');
			assert.strictEqual(result, 14);
		});

		test('returns -1 when there is no slash', () => {
			const result = getRemoteNameSlashIndex('feature');
			assert.strictEqual(result, -1);
		});

		test('returns -1 when remotes/ has no second slash', () => {
			const result = getRemoteNameSlashIndex('remotes/origin');
			assert.strictEqual(result, -1);
		});
	});

	suite('splitRemoteBranchName', () => {
		test('splits at a plain remote name', () => {
			assert.deepStrictEqual(splitRemoteBranchName('origin/main', ['origin']), ['origin', 'main']);
		});

		test('keeps the slashes of the branch name', () => {
			assert.deepStrictEqual(splitRemoteBranchName('origin/feature/x', ['origin']), ['origin', 'feature/x']);
		});

		test('matches a remote whose own name contains a slash', () => {
			assert.deepStrictEqual(splitRemoteBranchName('team/fork/feature', ['team/fork']), ['team/fork', 'feature']);
		});

		test('prefers the longest matching remote', () => {
			assert.deepStrictEqual(splitRemoteBranchName('team/fork/feature', ['team', 'team/fork']), [
				'team/fork',
				'feature',
			]);
			assert.deepStrictEqual(splitRemoteBranchName('team/fork/feature', new Set(['team/fork', 'team'])), [
				'team/fork',
				'feature',
			]);
		});

		test('falls back to the shorter remote when the longer does not prefix the name', () => {
			assert.deepStrictEqual(splitRemoteBranchName('team/forked', ['team', 'team/fork']), ['team', 'forked']);
		});

		test('strips a leading remotes/', () => {
			assert.deepStrictEqual(splitRemoteBranchName('remotes/team/fork/feature', ['team/fork']), [
				'team/fork',
				'feature',
			]);
		});

		test('keeps a leading remotes/ that belongs to the remote name', () => {
			assert.deepStrictEqual(splitRemoteBranchName('remotes/origin/x', ['origin']), ['origin', 'x']);
			assert.deepStrictEqual(splitRemoteBranchName('remotes/x/y', ['remotes']), ['remotes', 'x/y']);
			assert.deepStrictEqual(splitRemoteBranchName('remotes/x/y', ['remotes/x']), ['remotes/x', 'y']);
		});

		test('prefers the name as given over stripping remotes/', () => {
			assert.deepStrictEqual(splitRemoteBranchName('remotes/origin/x', ['remotes', 'origin']), [
				'remotes',
				'origin/x',
			]);
		});

		test('requires a whole path segment and a non-empty branch', () => {
			assert.strictEqual(splitRemoteBranchName('origin2/main', ['origin']), undefined);
			assert.strictEqual(splitRemoteBranchName('origin/', ['origin']), undefined);
			assert.strictEqual(splitRemoteBranchName('origin', ['origin']), undefined);
		});

		test('returns undefined when no remote matches', () => {
			assert.strictEqual(splitRemoteBranchName('feature/x', ['origin']), undefined);
			assert.strictEqual(splitRemoteBranchName('origin/main', []), undefined);
		});
	});

	suite('isDetachedHead', () => {
		test('returns true for HEAD', () => {
			assert.strictEqual(isDetachedHead('HEAD'), true);
		});

		test('returns true for parenthesized hash', () => {
			assert.strictEqual(isDetachedHead('(abc1234...)'), true);
		});

		test('returns false for normal branch name', () => {
			assert.strictEqual(isDetachedHead('main'), false);
		});

		test('returns true for empty string (trimmed to zero length)', () => {
			assert.strictEqual(isDetachedHead(''), true);
		});

		test('returns true for whitespace-only string', () => {
			assert.strictEqual(isDetachedHead('  HEAD  '), true);
		});

		test('returns false for feature branch with slash', () => {
			assert.strictEqual(isDetachedHead('feature/branch'), false);
		});

		test('returns true for detached-at message in parentheses', () => {
			assert.strictEqual(isDetachedHead('(HEAD detached at abc1234)'), true);
		});

		test('returns true for the rest of git’s "no branch" states', () => {
			assert.strictEqual(isDetachedHead('(HEAD detached from abc1234)'), true);
			assert.strictEqual(isDetachedHead('(no branch)'), true);
			assert.strictEqual(isDetachedHead('(no branch, rebasing feature)'), true);
			assert.strictEqual(isDetachedHead('(no branch, bisect started on main)'), true);
		});

		test("returns true for porcelain v2's branch.head token", () => {
			// `git status --porcelain=v2 --branch` prints `# branch.head (detached)` for ANY
			// non-branch HEAD (plain detached, rebase, bisect) and the status parser passes the
			// token through verbatim — `GitStatus.detached` depends on this match.
			assert.strictEqual(isDetachedHead('(detached)'), true);
		});

		test('returns false for real branch names that happen to be parenthesized', () => {
			// Parentheses are legal in ref names — all three are branches `git check-ref-format
			// --branch` accepts and a user can be checked out on. Treating them as detached made
			// `GitBranch` rewrite the name to the synthesized `(sha…)` label and re-key the id by SHA,
			// corrupting the branch's identity everywhere downstream.
			assert.strictEqual(isDetachedHead('(release)'), false);
			assert.strictEqual(isDetachedHead('v1.0(rc)'), false);
			assert.strictEqual(isDetachedHead('feat/(wip)'), false);
		});
	});
	suite('upstream remote', () => {
		const upstream = { name: 'team/fork/feature', missing: false, remote: 'team/fork' };

		test('a local upstream has no remote and keeps its full name', () => {
			const upstream = { name: 'release/2.0', missing: false, local: true };
			const ref = {
				refType: 'branch',
				name: 'feature',
				ref: 'feature',
				remote: false,
				upstream: upstream,
				repoPath: '/r',
			} as const;
			assert.deepStrictEqual(getBranchNameAndRemote(ref), ['feature', undefined]);
			assert.strictEqual(getBranchTrackingWithoutRemote(ref), 'release/2.0');
			assert.strictEqual(
				new GitBranch('/r', 'refs/heads/feature', false, undefined, undefined, undefined, {
					...upstream,
					state: { ahead: 0, behind: 0 },
				}).remoteName,
				undefined,
			);
		});

		test('getBranchNameAndRemote prefers upstream.remote', () => {
			const ref = {
				refType: 'branch',
				name: 'feature',
				ref: 'feature',
				remote: false,
				upstream: upstream,
				repoPath: '/r',
			} as const;
			assert.deepStrictEqual(getBranchNameAndRemote(ref), ['feature', 'team/fork']);
			assert.deepStrictEqual(
				getBranchNameAndRemote({ ...ref, upstream: { name: 'team/fork/feature', missing: false } }),
				['feature', 'team'],
			);
		});

		test('getBranchTrackingWithoutRemote strips upstream.remote', () => {
			const ref = {
				refType: 'branch',
				name: 'feature',
				ref: 'feature',
				remote: false,
				upstream: upstream,
				repoPath: '/r',
			} as const;
			assert.strictEqual(getBranchTrackingWithoutRemote(ref), 'feature');
			assert.strictEqual(
				getBranchTrackingWithoutRemote({ ...ref, upstream: { name: 'team/fork/feature', missing: false } }),
				'fork/feature',
			);
			assert.strictEqual(
				getBranchTrackingWithoutRemote({
					...ref,
					upstream: { name: 'main', missing: false, remote: 'origin' },
				}),
				'main',
			);
		});

		test('getBranchTrackingWithoutRemote is undefined for a remote-tracking branch', () => {
			// #4950: the Graph's remote refs carry the remote's own name in `upstream`
			const ref = {
				refType: 'branch',
				name: 'upstream/main',
				ref: 'upstream/main',
				remote: true,
				upstream: { name: 'upstream', missing: false },
				repoPath: '/r',
			} as const;
			assert.strictEqual(getBranchTrackingWithoutRemote(ref), undefined);
		});

		test('getBranchTrackingWithoutRemote prefers upstream.remoteBranch over the local tracking name', () => {
			const ref = {
				refType: 'branch',
				name: 'x',
				ref: 'x',
				remote: false,
				upstream: { name: 'mirror/pfx/x', missing: false, remote: 'origin', remoteBranch: 'x' },
				repoPath: '/r',
			} as const;
			assert.strictEqual(getBranchTrackingWithoutRemote(ref), 'x');
			assert.strictEqual(
				new GitBranch('/r', 'refs/heads/x', false, undefined, undefined, undefined, {
					...ref.upstream,
					state: { ahead: 0, behind: 0 },
				}).trackingWithoutRemote,
				'x',
			);
		});

		test('GitBranch getters prefer upstream.remote', () => {
			const withRemote = new GitBranch('/r', 'refs/heads/feature', false, undefined, undefined, undefined, {
				...upstream,
				state: { ahead: 0, behind: 0 },
			});
			assert.strictEqual(withRemote.remoteName, 'team/fork');
			assert.strictEqual(withRemote.trackingWithoutRemote, 'feature');

			const without = new GitBranch('/r', 'refs/heads/feature', false, undefined, undefined, undefined, {
				name: 'origin/feature',
				missing: false,
				state: { ahead: 0, behind: 0 },
			});
			assert.strictEqual(without.remoteName, 'origin');
			assert.strictEqual(without.trackingWithoutRemote, 'feature');
		});
	});
});
