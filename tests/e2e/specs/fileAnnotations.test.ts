import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { withoutSignInSecrets } from '../fixtures/gkSignIn.js';

const changesFile = 'changes.txt';
const editedFile = 'edited.txt';
const heatFile = 'heat.txt';

const ageThreshold = 'gitlens.heatmap.ageThreshold';

const changesExpected = [`${changesFile} line 9 v3`];

const heatmapPalette = [
	'#f66a0a',
	'#ef6939',
	'#e96950',
	'#e26862',
	'#db6871',
	'#d3677e',
	'#cc678a',
	'#c46696',
	'#bb66a0',
	'#b365a9',
	'#a965b3',
	'#a064bb',
	'#9664c4',
	'#8a63cc',
	'#7e63d3',
	'#7162db',
	'#6262e2',
	'#5061e9',
	'#3961ef',
	'#0a60f6',
].map(hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')})`);
const hotColors = heatmapPalette.slice(0, 10);
const coldColors = heatmapPalette.slice(10);

const viewTimeout = MaxTimeout * 3;

let repoPath: string;

function lines(file: string, changed: Record<number, string> = {}): string {
	return `${Array.from({ length: 12 }, (_, i) => `${file} line ${i + 1}${changed[i + 1] ? ` ${changed[i + 1]}` : ''}`).join('\n')}\n`;
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: { 'scm.diffDecorations': 'none' },
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.config('user.name', 'Annotations Author');
				await git.config('user.email', 'annotations@example.com');

				await git.commit('Add changes file', changesFile, lines(changesFile), { date: '2024-01-10T12:00:00' });
				await git.commit('Change changes lines 4-5', changesFile, lines(changesFile, { 4: 'v2', 5: 'v2' }), {
					date: '2024-06-10T12:00:00',
				});
				await git.commit(
					'Change changes line 9',
					changesFile,
					lines(changesFile, { 4: 'v2', 5: 'v2', 9: 'v3' }),
					{ date: '2024-09-01T12:00:00' },
				);

				await git.commit('Add edited file', editedFile, lines(editedFile), { date: '2024-01-10T12:00:00' });
				await git.commit('Change edited line 6', editedFile, lines(editedFile, { 6: 'v2' }), {
					date: '2024-06-10T12:00:00',
				});
				await git.createFile(editedFile, lines(editedFile, { 3: 'local', 6: 'v2', 8: 'local' }));

				await git.commit('Add heat file', heatFile, lines(heatFile), { date: '2024-01-10T12:00:00' });
				await git.commit('Change heat lines 4-5', heatFile, lines(heatFile, { 4: 'v2', 5: 'v2' }), {
					date: '2024-06-10T12:00:00',
				});
				// KEEP: undated — the newest commit must fall inside the default 90-day heatmap threshold
				await git.commit('Change heat line 9', heatFile, lines(heatFile, { 4: 'v2', 5: 'v2', 9: 'v3' }));

				repoPath = repoDir;
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

function runGit(...args: string[]): string {
	return execFileSync('git', args, {
		cwd: repoPath,
		encoding: 'utf8',
		env: { ...withoutSignInSecrets(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
	});
}

function fileLines(file: string): string[] {
	return readFileSync(path.join(repoPath, file), 'utf8').split('\n').slice(0, -1);
}

function changedLineNumbers(file: string, ...range: string[]): number[] {
	const numbers: number[] = [];
	for (const [, start, count] of runGit('diff', '-U0', ...range, '--', file).matchAll(
		/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm,
	)) {
		for (let i = 0; i < Number(count ?? 1); i++) {
			numbers.push(Number(start) + i);
		}
	}
	return numbers;
}

function lastCommitChangedLines(file: string): string[] {
	const sha = runGit('log', '-1', '--format=%H', '--', file).trim();
	const all = fileLines(file);
	return changedLineNumbers(file, `${sha}^`, sha).map(n => all[n - 1]);
}

function blameGroups(file: string): { lines: string[]; time: number }[] {
	const all = fileLines(file);
	const bySha = new Map<string, string[]>();
	for (const [, sha, line] of runGit('blame', '--line-porcelain', '--', file).matchAll(
		/^([0-9a-f]{40}) \d+ (\d+)/gm,
	)) {
		bySha.set(sha, [...(bySha.get(sha) ?? []), all[Number(line) - 1]]);
	}
	return Array.from(bySha, ([sha, group]) => ({
		lines: group,
		time: Number(runGit('show', '-s', '--format=%ct', sha).trim()),
	}));
}

function glyphGroups(glyphs: { line: string; decoration: string }[]): string[][] {
	const groups = new Map<string, string[]>();
	for (const glyph of glyphs) {
		groups.set(glyph.decoration, [...(groups.get(glyph.decoration) ?? []), glyph.line]);
	}
	return [...groups.values()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

function sortedGroups(groups: string[][]): string[][] {
	return groups
		.map(g => [...g].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
		.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

async function glyphs(vscode: VSCodeInstance): Promise<{ line: string; decoration: string; fill?: string }[]> {
	const found = await vscode.gitlens.getFileAnnotationGlyphs();
	if (found == null) throw new Error('No active text editor');

	return found;
}

async function groupFills(vscode: VSCodeInstance, groups: { lines: string[] }[]): Promise<(string | undefined)[]> {
	const all = await glyphs(vscode);
	return groups.map(g => all.find(glyph => glyph.line === g.lines[0])?.fill);
}

function expectNewerIsHotter(palette: string[], fillsNewestFirst: (string | undefined)[]): void {
	const indexes = fillsNewestFirst.map(f => (f == null ? -1 : palette.indexOf(f)));
	expect(
		indexes.every(i => i >= 0),
		`every fill is in the palette: ${fillsNewestFirst.join(' ')}`,
	).toBe(true);
	expect(
		indexes.every((index, i) => i === 0 || index > indexes[i - 1]),
		`palette index rises with age: ${indexes.join(' < ')}`,
	).toBe(true);
}

async function glyphLines(vscode: VSCodeInstance): Promise<string[]> {
	return (await glyphs(vscode)).map(g => g.line);
}

async function open(vscode: VSCodeInstance, file: string): Promise<void> {
	await vscode.gitlens.openFile(file);
	const editor = vscode.page.locator('.editor-group-container.active .monaco-editor .view-lines').first();
	await expect(editor).toBeVisible({ timeout: MaxTimeout });
	await expect(editor).toContainText(`${file} line 1`, { timeout: MaxTimeout });
	// KEEP: focus, then start the cursor on line 0 — away from every change the tests expect it to jump to
	await editor.click();
	await vscode.page.keyboard.press('Control+Home');
	await expect.poll(() => cursorLine(vscode), { timeout: MaxTimeout }).toBe(0);
}

async function cursorLine(vscode: VSCodeInstance): Promise<number | undefined> {
	return (await vscode.gitlens.getActiveEditorState()).line;
}

test.describe('File Annotations — changes and heatmap', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.executeCommand('gitlens.clearFileAnnotations');
		await vscode.gitlens.updateSetting(ageThreshold, undefined);
		await vscode.gitlens.resetUI();
	});

	test('changes marks exactly the lines the last commit changed and moves the cursor to the first', async ({
		vscode,
	}) => {
		const expected = lastCommitChangedLines(changesFile);
		expect(expected).toEqual(changesExpected);

		await open(vscode, changesFile);
		await vscode.gitlens.executeCommand('gitlens.toggleFileChanges');

		await expect.poll(() => glyphLines(vscode), { timeout: viewTimeout }).toEqual(expected);
		await expect.poll(() => cursorLine(vscode), { timeout: viewTimeout }).toBe(8);
		await expect(vscode.gitlens.editorTitleAction('Next Change')).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.editorTitleAction('Previous Change')).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.editorTitleAction('Clear File Annotations')).toBeVisible({ timeout: MaxTimeout });
	});

	test('changes on a file with uncommitted edits marks the lines that differ from HEAD, and Next/Previous Change step through them', async ({
		vscode,
	}) => {
		const numbers = changedLineNumbers(editedFile, 'HEAD');
		expect(numbers).toEqual([3, 8]);
		const all = fileLines(editedFile);

		await open(vscode, editedFile);
		await vscode.gitlens.executeCommand('gitlens.toggleFileChanges');

		await expect.poll(() => glyphLines(vscode), { timeout: viewTimeout }).toEqual(numbers.map(n => all[n - 1]));
		await expect.poll(() => cursorLine(vscode), { timeout: viewTimeout }).toBe(2);

		await vscode.gitlens.executeCommand('gitlens.annotations.nextChange');
		await expect.poll(() => cursorLine(vscode), { timeout: MaxTimeout }).toBe(7);
		await vscode.gitlens.executeCommand('gitlens.annotations.nextChange');
		await expect.poll(() => cursorLine(vscode), { timeout: MaxTimeout }).toBe(2);
		await vscode.gitlens.executeCommand('gitlens.annotations.previousChange');
		await expect.poll(() => cursorLine(vscode), { timeout: MaxTimeout }).toBe(7);
	});

	test('heatmap gives every line the colour of the age of the commit that last changed it', async ({ vscode }) => {
		const groups = blameGroups(heatFile);
		expect(sortedGroups(groups.map(g => g.lines))).toEqual([
			[...[1, 2, 3, 6, 7, 8, 10, 11, 12].map(n => `${heatFile} line ${n}`)],
			[`${heatFile} line 4 v2`, `${heatFile} line 5 v2`],
			[`${heatFile} line 9 v3`],
		]);
		const [newest, ...older] = [...groups].sort((a, b) => b.time - a.time);

		await open(vscode, heatFile);
		await vscode.gitlens.executeCommand('gitlens.toggleFileHeatmap');

		await expect
			.poll(async () => glyphGroups(await glyphs(vscode)), { timeout: viewTimeout })
			.toEqual(sortedGroups(groups.map(g => g.lines)));

		const fills = await groupFills(vscode, [newest, ...older]);
		// TODO: assert the newest is hot[0] once the heatmap stops counting a phantom "now" commit (#6348)
		expect(hotColors).toContain(fills[0]);
		expect(fills[1]).toBe(coldColors[0]);
		expectNewerIsHotter(coldColors, fills.slice(1));

		await expect(vscode.gitlens.editorTitleAction('Clear File Annotations')).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.editorTitleAction('Next Change')).toHaveCount(0);
	});

	test('heatmap colours every line hot when the age threshold covers all commits', async ({ vscode }) => {
		const byAge = [...blameGroups(heatFile)].sort((a, b) => b.time - a.time);

		await vscode.gitlens.updateSetting(ageThreshold, 100000);
		await open(vscode, heatFile);
		await vscode.gitlens.executeCommand('gitlens.toggleFileHeatmap');

		await expect
			.poll(async () => glyphGroups(await glyphs(vscode)), { timeout: viewTimeout })
			.toEqual(sortedGroups(byAge.map(g => g.lines)));

		// TODO: assert the newest is hot[0] once the heatmap stops counting a phantom "now" commit (#6348)
		expectNewerIsHotter(hotColors, await groupFills(vscode, byAge));
	});

	test('switching blame → changes → heatmap swaps the annotation in place, and toggling the heatmap again clears it', async ({
		vscode,
	}) => {
		await open(vscode, changesFile);

		await vscode.gitlens.toggleFileBlame();
		await expect
			.poll(() => vscode.gitlens.hasBlameAnnotations('Change changes line 9'), { timeout: viewTimeout })
			.toBe(true);

		await vscode.gitlens.executeCommand('gitlens.toggleFileChanges');
		await expect.poll(() => glyphLines(vscode), { timeout: viewTimeout }).toEqual(changesExpected);
		expect(await vscode.gitlens.hasBlameAnnotations('Change changes line 9')).toBe(false);
		await expect(vscode.gitlens.editorTitleAction('Next Change')).toBeVisible({ timeout: MaxTimeout });

		await vscode.gitlens.executeCommand('gitlens.toggleFileHeatmap');
		await expect
			.poll(async () => glyphGroups(await glyphs(vscode)), { timeout: viewTimeout })
			.toEqual(sortedGroups(blameGroups(changesFile).map(g => g.lines)));
		expect((await glyphs(vscode)).every(g => g.fill != null && heatmapPalette.includes(g.fill))).toBe(true);
		await expect(vscode.gitlens.editorTitleAction('Next Change')).toHaveCount(0);

		await vscode.gitlens.executeCommand('gitlens.toggleFileHeatmap');
		await expect.poll(() => glyphLines(vscode), { timeout: viewTimeout }).toEqual([]);
		await expect(vscode.gitlens.editorTitleAction('Clear File Annotations')).toHaveCount(0);
	});

	test('Escape dismisses the changes annotation', async ({ vscode }) => {
		await open(vscode, changesFile);
		await vscode.gitlens.executeCommand('gitlens.toggleFileChanges');
		await expect.poll(() => glyphLines(vscode), { timeout: viewTimeout }).toEqual(changesExpected);

		await vscode.page.keyboard.press('Escape');
		await expect.poll(() => glyphLines(vscode), { timeout: viewTimeout }).toEqual([]);
	});
});
