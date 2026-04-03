import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

interface WorktreeCreateInput {
	session_id: string;
	transcript_path: string;
	hook_event_name: 'WorktreeCreate';
	cwd: string;
	name: string;
}

interface WorktreeRemoveInput {
	session_id: string;
	transcript_path: string;
	hook_event_name: 'WorktreeRemove';
	cwd: string;
	worktree_path: string;
}

type WorktreeHookInput = WorktreeCreateInput | WorktreeRemoveInput;

const action = process.argv[2] as 'create' | 'remove';

function git(args: string[], cwd: string): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function create(input: WorktreeCreateInput): void {
	const { name, session_id, cwd } = input;

	// Find the main repo root (git-common-dir points to the shared .git, strip it)
	const gitCommonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
	const repoRoot = resolve(gitCommonDir, '..');
	const repoName = basename(repoRoot);

	// Get the current branch name (e.g. "debt/library")
	const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

	// Build the worktree path following GitLens conventions:
	//   <repo>.worktrees/<type>/<branch-name>+<session-id>+<agent-name>/
	// e.g. vscode-gitlens.worktrees/debt/library+c7c26572-e693-434c-9beb-cfa60610ad6e+agent-abc123/
	// Uses "+" to associate the agent worktree with its parent branch and session
	// while keeping it as a sibling (not nested inside the parent worktree)
	const worktreesRoot = join(repoRoot, '..', `${repoName}.worktrees`);
	const branchSegments = branch.split('/');
	const lastSegment = branchSegments.pop()!;
	const worktreeName = `${lastSegment}+${session_id}+${name}`;
	const targetPath = join(worktreesRoot, ...branchSegments, worktreeName);

	mkdirSync(dirname(targetPath), { recursive: true });

	// Create the worktree with a dedicated branch
	git(['worktree', 'add', targetPath, '-b', `worktree-${session_id}-${name}`, 'HEAD'], cwd);

	// Install dependencies (fast with pnpm's warm global store)
	execFileSync('pnpm', ['install'], { cwd: targetPath, encoding: 'utf8' });

	// Output the path so Claude Code knows where the worktree lives
	process.stdout.write(targetPath);
}

function remove(input: WorktreeRemoveInput): void {
	const { worktree_path, cwd } = input;

	try {
		git(['worktree', 'remove', worktree_path], cwd);
	} catch (ex) {
		// Force removal if the worktree has uncommitted changes
		console.error(`Worktree remove failed, retrying with --force: ${ex instanceof Error ? ex.message : ex}`);
		git(['worktree', 'remove', '--force', worktree_path], cwd);
	}
}

function main(): void {
	const input: WorktreeHookInput = JSON.parse(readFileSync(0, 'utf8'));

	if (action === 'create') {
		create(input as WorktreeCreateInput);
	} else if (action === 'remove') {
		remove(input as WorktreeRemoveInput);
	} else {
		console.error(`Unknown action: ${action}. Use 'create' or 'remove'.`);
		process.exit(1);
	}
}

main();
