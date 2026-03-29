/* eslint-disable no-template-curly-in-string */
/**
 * File Blame Annotation E2E Tests
 *
 * Tests the toggle-on/toggle-off lifecycle of gutter blame annotations,
 * Escape dismissal, and blame rendering on a large real-world file.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

// ---------------------------------------------------------------------------
// Small-file blame tests
// ---------------------------------------------------------------------------

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				execFileSync('git', ['config', 'user.name', 'Blame Test Author'], { cwd: repoDir });
				execFileSync('git', ['config', 'user.email', 'blame-test@example.com'], { cwd: repoDir });

				await git.commit(
					'Initial commit',
					'blame-test.ts',
					[
						'export function greet(name: string): string {',
						'  return `Hello, ${name}!`;',
						'}',
						'',
						'export function add(a: number, b: number): number {',
						'  return a + b;',
						'}',
					].join('\n'),
				);

				await git.commit(
					'Add multiply function',
					'blame-test.ts',
					[
						'export function greet(name: string): string {',
						'  return `Hello, ${name}!`;',
						'}',
						'',
						'export function add(a: number, b: number): number {',
						'  return a + b;',
						'}',
						'',
						'export function multiply(a: number, b: number): number {',
						'  return a * b;',
						'}',
					].join('\n'),
				);

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Blame Annotations', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.openFile('blame-test.ts');
		await expect(vscode.page.locator('.monaco-editor .view-lines')).toBeVisible({ timeout: MaxTimeout });
		// Click on editor to ensure it has focus (ActiveEditorCommand requires a focused editor)
		await vscode.page.locator('.monaco-editor .view-lines').first().click();
		await vscode.page.waitForTimeout(1000);
	});

	test.afterEach(async ({ vscode }) => {
		// Clear any active blame annotations before resetting
		await vscode.gitlens.executeCommand('gitlens.clearFileAnnotations');
		await vscode.gitlens.resetUI();
	});

	test('should toggle blame annotations on', async ({ vscode }) => {
		await vscode.gitlens.toggleFileBlame();

		// The default blame format shows commit messages — check for our known commit message
		await expect(async () => {
			const hasBlame = await vscode.gitlens.hasBlameAnnotations('Initial commit');
			expect(hasBlame).toBe(true);
		}).toPass({ timeout: MaxTimeout });
	});

	test('should toggle blame annotations off', async ({ vscode }) => {
		// Toggle on
		await vscode.gitlens.toggleFileBlame();
		await expect(async () => {
			const hasBlame = await vscode.gitlens.hasBlameAnnotations('Initial commit');
			expect(hasBlame).toBe(true);
		}).toPass({ timeout: MaxTimeout });

		// Toggle off
		await vscode.gitlens.toggleFileBlame();
		await expect(async () => {
			const hasBlame = await vscode.gitlens.hasBlameAnnotations('Initial commit');
			expect(hasBlame).toBe(false);
		}).toPass({ timeout: MaxTimeout });
	});

	test('should dismiss blame annotations with Escape', async ({ vscode }) => {
		// Toggle on
		await vscode.gitlens.toggleFileBlame();
		await expect(async () => {
			const hasBlame = await vscode.gitlens.hasBlameAnnotations('Initial commit');
			expect(hasBlame).toBe(true);
		}).toPass({ timeout: MaxTimeout });

		// Dismiss with Escape
		await vscode.page.keyboard.press('Escape');
		await expect(async () => {
			const hasBlame = await vscode.gitlens.hasBlameAnnotations('Initial commit');
			expect(hasBlame).toBe(false);
		}).toPass({ timeout: MaxTimeout });
	});
});

// ---------------------------------------------------------------------------
// Large-file blame test — tc39/ecma262 spec.html
// ---------------------------------------------------------------------------

/** Pinned tag for reproducibility */
const ecma262Tag = 'es2024';

const largeFileTest = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				try {
					// Shallow clone with limited history — full blame of spec.html with
					// complete history is too slow for CI. --depth 100 gives diverse
					// blame entries for recent changes while keeping the clone fast.
					execFileSync(
						'git',
						[
							'clone',
							'--single-branch',
							'--branch',
							ecma262Tag,
							'--depth',
							'100',
							'https://github.com/tc39/ecma262.git',
							repoDir,
						],
						{ stdio: 'pipe', timeout: 120_000 },
					);
				} catch {
					// Network failure — need a valid git repo for VS Code to open
					const git = new GitFixture(repoDir);
					await git.init();
					await git.commit('placeholder', 'README.md', '# clone failed');
				}
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

largeFileTest.describe('Blame Annotations — Large File', () => {
	largeFileTest.describe.configure({ mode: 'serial' });

	largeFileTest('should show blame annotations on a large file (spec.html)', async ({ vscode }) => {
		largeFileTest.setTimeout(180_000);

		// Skip if clone failed (spec.html won't exist)
		const specPath = path.join(vscode.electron.workspacePath, 'spec.html');
		if (!existsSync(specPath)) {
			largeFileTest.skip(true, 'tc39/ecma262 clone failed (network issue) — skipping large-file test');
			return;
		}

		// Open spec.html — a ~50K-70K line file
		await vscode.gitlens.openFile('spec.html');
		await expect(vscode.page.locator('.monaco-editor .view-lines')).toBeVisible({ timeout: MaxTimeout });

		// Click on editor to ensure focus, then wait for file to load
		await vscode.page.locator('.monaco-editor .view-lines').first().click();
		await vscode.page.waitForTimeout(2000);

		// Toggle blame on
		await vscode.gitlens.toggleFileBlame();

		// Blame on a large file with full history takes longer — use generous timeout.
		// Check for ced-* spans with ::before content (blame decoration elements).
		await expect(async () => {
			const count = await vscode.page.evaluate(() => {
				const spans = document.querySelectorAll('.monaco-editor .view-lines span[class*="ced-"]');
				let n = 0;
				for (const el of spans) {
					const content = window.getComputedStyle(el, '::before').getPropertyValue('content');
					if (content && content !== 'none' && content !== '""') {
						const text = content.replace(/^"|"$/g, '');
						if (text.trim().length > 10) {
							n++;
						}
					}
				}
				return n;
			});
			// At least one visible line should have a full blame decoration
			// (compact/follower lines only show a space character, not full blame text)
			expect(count).toBeGreaterThanOrEqual(1);
		}).toPass({ timeout: 120_000 });

		// Toggle blame off
		await vscode.gitlens.toggleFileBlame();

		await expect(async () => {
			const count = await vscode.page.evaluate(() => {
				const spans = document.querySelectorAll('.monaco-editor .view-lines span[class*="ced-"]');
				let n = 0;
				for (const el of spans) {
					const content = window.getComputedStyle(el, '::before').getPropertyValue('content');
					if (content && content !== 'none' && content !== '""') {
						const text = content.replace(/^"|"$/g, '');
						if (text.trim().length > 10) {
							n++;
						}
					}
				}
				return n;
			});
			expect(count).toBe(0);
		}).toPass({ timeout: MaxTimeout });
	});
});
