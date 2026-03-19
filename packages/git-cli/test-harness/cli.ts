#!/usr/bin/env tsx
/**
 * CLI test harness for the @gitlens/git library.
 *
 * Validates the library works standalone — no VS Code, no extension, just Node.js.
 *
 * Usage:
 *   pnpm --filter @gitlens/git test:cli [repo-path] [command]
 *
 * Examples:
 *   pnpm --filter @gitlens/git test:cli . status
 *   pnpm --filter @gitlens/git test:cli . branches
 *   pnpm --filter @gitlens/git test:cli . log
 *   pnpm --filter @gitlens/git test:cli           # runs all commands
 */

import { resolve } from 'node:path';
import { Logger } from '@gitlens/utils/logger.js';
import { findGitPath } from '../src/exec/locator.js';
import { CliGitProvider } from '../src/cliGitProvider.js';

let gitLocationPromise: ReturnType<typeof findGitPath>;
function getGitLocation() {
	return (gitLocationPromise ??= findGitPath(null));
}

const provider = new CliGitProvider({
	context: {},
	locator: getGitLocation,
	gitOptions: { gitTimeout: 30000 },
});

type Command = (repoPath: string) => Promise<void>;

const commands: Record<string, Command> = {
	async branches(repoPath) {
		console.log('\n=== Branches ===');
		const result = await provider.branches.getBranches(repoPath);
		console.log(`  Found ${result.values.length} branches (paging: ${JSON.stringify(result.paging)})`);
		for (const b of result.values.slice(0, 10)) {
			const current = b.current ? ' (current)' : '';
			const tracking = b.upstream?.name ? ` → ${b.upstream.name}` : '';
			console.log(`  ${b.name}${current}${tracking}`);
		}
		if (result.values.length > 10) {
			console.log(`  ... and ${result.values.length - 10} more`);
		}
	},

	async log(repoPath) {
		console.log('\n=== Log (last 10 commits) ===');
		const result = await provider.commits.getLog(repoPath, undefined, { limit: 10 });
		if (!result) {
			console.log('  No commits found');
			return;
		}
		console.log(`  Found ${result.count} commits (hasMore: ${result.hasMore})`);
		for (const commit of result.commits.values()) {
			const date = commit.author.date.toISOString().slice(0, 10);
			const msg = commit.message?.split('\n')[0]?.slice(0, 60) ?? '';
			console.log(`  ${commit.sha.slice(0, 8)} ${date} ${msg}`);
		}
	},

	async status(repoPath) {
		console.log('\n=== Status ===');
		const status = await provider.status.getStatus(repoPath);
		if (!status) {
			console.log('  No status available');
			return;
		}
		console.log(`  Branch: ${status.branch}`);
		console.log(`  Upstream: ${status.upstream?.name ?? 'none'}`);
		console.log(`  Ahead/Behind: +${status.state?.ahead ?? 0} -${status.state?.behind ?? 0}`);
		console.log(`  Files: ${status.files.length}`);
		for (const f of status.files.slice(0, 10)) {
			console.log(`    ${f.status} ${f.path}`);
		}
		if (status.files.length > 10) {
			console.log(`    ... and ${status.files.length - 10} more`);
		}
	},

	async tags(repoPath) {
		console.log('\n=== Tags ===');
		const result = await provider.tags.getTags(repoPath);
		console.log(`  Found ${result.values.length} tags (paging: ${JSON.stringify(result.paging)})`);
		for (const t of result.values.slice(0, 10)) {
			console.log(`  ${t.name} → ${t.sha.slice(0, 8)}`);
		}
		if (result.values.length > 10) {
			console.log(`  ... and ${result.values.length - 10} more`);
		}
	},

	async remotes(repoPath) {
		console.log('\n=== Remotes ===');
		const remotes = await provider.remotes.getRemotes(repoPath);
		console.log(`  Found ${remotes.length} remotes`);
		for (const r of remotes) {
			console.log(`  ${r.name}: ${r.urls.map(u => u.url).join(', ')}`);
		}
	},

	async stashes(repoPath) {
		console.log('\n=== Stashes ===');
		const stash = await provider.stash?.getStash(repoPath);
		if (!stash?.commits?.size) {
			console.log('  No stashes');
			return;
		}
		console.log(`  Found ${stash.commits.size} stashes`);
		for (const [, commit] of [...stash.commits].slice(0, 5)) {
			const msg = commit.message?.split('\n')[0]?.slice(0, 60) ?? '';
			console.log(`  ${commit.sha.slice(0, 8)} ${msg}`);
		}
	},

	async contributors(repoPath) {
		console.log('\n=== Contributors ===');
		const result = await provider.contributors.getContributors(repoPath);
		const contributors = result.contributors;
		console.log(`  Found ${contributors.length} contributors`);
		for (const c of contributors.slice(0, 10)) {
			console.log(`  ${c.name ?? 'unknown'} <${c.email ?? 'unknown'}> (${c.count} commits)`);
		}
		if (contributors.length > 10) {
			console.log(`  ... and ${contributors.length - 10} more`);
		}
	},

	async config(repoPath) {
		console.log('\n=== Config ===');
		const user = await provider.config.getConfig(repoPath, 'user.name');
		const email = await provider.config.getConfig(repoPath, 'user.email');
		console.log(`  user.name: ${user ?? '(not set)'}`);
		console.log(`  user.email: ${email ?? '(not set)'}`);
	},

	async worktrees(repoPath) {
		console.log('\n=== Worktrees ===');
		const worktrees = await provider.worktrees?.getWorktrees(repoPath);
		if (!worktrees) {
			console.log('  No worktrees support');
			return;
		}
		console.log(`  Found ${worktrees.length} worktrees`);
		for (const w of worktrees) {
			const main = w.main ? ' (main)' : '';
			console.log(`  ${w.name}${main}: ${w.uri}`);
		}
	},

	async refs(repoPath) {
		console.log('\n=== Refs ===');
		const valid = await provider.refs.isValidReference(repoPath, 'HEAD');
		const mergeBase = await provider.refs.getMergeBase(repoPath, 'HEAD', 'HEAD~1').catch(() => undefined);
		console.log(`  HEAD valid: ${valid}`);
		console.log(`  Merge base HEAD..HEAD~1: ${mergeBase?.slice(0, 8) ?? 'none'}`);
	},

	async diff(repoPath) {
		console.log('\n=== Diff (HEAD vs working tree) ===');
		const diff = await provider.diff.getDiff(repoPath, 'HEAD');
		if (!diff) {
			console.log('  No diff (working tree clean)');
			return;
		}
		const lines = diff.contents.split('\n');
		console.log(`  ${lines.length} lines of diff`);
		// Show first 10 lines
		for (const line of lines.slice(0, 10)) {
			console.log(`  ${line}`);
		}
		if (lines.length > 10) {
			console.log(`  ... and ${lines.length - 10} more lines`);
		}
	},
};

async function main() {
	const args = process.argv.slice(2);
	const repoPath = resolve(args[0] ?? '.');
	const commandName = args[1];

	// Configure logger to console
	const log = (name: string) => (msg: string) => console.error(`[${name}] ${msg}`);
	Logger.configure({
		name: 'cli',
		createChannel(name) {
			const l = log(name);
			return {
				name: name,
				logLevel: 0,
				dispose() {},
				trace: l,
				debug: l,
				info: l,
				warn: l,
				error: l,
			};
		},
	});

	console.log(`@gitlens/git CLI Test Harness`);
	console.log(`Repository: ${repoPath}`);

	// Verify git is available
	const location = await getGitLocation();
	console.log(`Git: ${location.path} (${location.version})`);

	// Verify this is a git repo via provider.config.getGitDir()
	const gitDir = await provider.config.getGitDir?.(repoPath);
	if (!gitDir) {
		console.error(`Error: '${repoPath}' is not a git repository (or could not determine .git dir)`);
		process.exit(1);
	}
	console.log(`Git dir: ${gitDir.path}`);
	if (gitDir.commonPath) {
		console.log(`Common git dir: ${gitDir.commonPath}`);
	}

	if (commandName) {
		// Run a single command
		const cmd = commands[commandName];
		if (!cmd) {
			console.error(`Unknown command: ${commandName}`);
			console.error(`Available: ${Object.keys(commands).join(', ')}`);
			process.exit(1);
		}

		try {
			await cmd(repoPath);
			console.log('\nDone.');
		} catch (ex) {
			console.error(`\nFailed: ${ex instanceof Error ? ex.message : String(ex)}`);
			if (ex instanceof Error && ex.stack) {
				console.error(ex.stack);
			}
			process.exit(1);
		}
	} else {
		// Run all commands
		console.log('\nRunning all commands...');
		let passed = 0;
		let failed = 0;

		for (const [name, cmd] of Object.entries(commands)) {
			try {
				await cmd(repoPath);
				passed++;
			} catch (ex) {
				failed++;
				console.error(`\n  [FAIL] ${name}: ${ex instanceof Error ? ex.message : String(ex)}`);
			}
		}

		console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
		if (failed > 0) {
			process.exit(1);
		}
	}
}

main().catch(ex => {
	console.error('Fatal error:', ex);
	process.exit(1);
});
