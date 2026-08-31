import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance as nodePerformance } from 'node:perf_hooks';
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture } from '../baseTest.js';
import { waitForGraphRowsRendered, widenSideBarForGraph } from '../graphHelpers.js';

type DebugRecord = {
	kind: 'mark' | 'measure' | 'longtask';
	name: string;
	startTime: number;
	duration: number;
	detail?: Record<string, unknown>;
};
type DebugWindow = Window & {
	__gitkrakenCommitGraphDebug?: { records(): readonly DebugRecord[]; snapshot(): unknown };
};

const fixtureRows = 120;
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				for (let i = 1; i < fixtureRows; i++) {
					await git.commit(`Performance fixture ${i}`, 'fixture.txt', `${i}\n`);
				}
				await git.addRemote('origin', 'https://example.com/test/performance-fixture.git');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) return 0;

	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

test(
	'captures the graph browser performance contract',
	{ tag: ['@no-fork', '@performance'] },
	async ({ vscode }, testInfo) => {
		test.setTimeout(180000);
		await using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const openStartedAt = nodePerformance.now();
		await vscode.gitlens.showCommitGraphView();
		await widenSideBarForGraph(vscode);
		const graphWebview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 60000);
		expect(graphWebview).not.toBeNull();
		const tree = graphWebview!.getByRole('tree', { name: 'Commit graph' });
		await expect(tree).toBeVisible({ timeout: 30000 });
		await waitForGraphRowsRendered(graphWebview!, 30000);
		const openToVisibleMs = nodePerformance.now() - openStartedAt;

		const root = graphWebview!.locator(':root');
		const before = await root.evaluate(() => {
			const api = (window as DebugWindow).__gitkrakenCommitGraphDebug;
			return { records: api?.records(), snapshot: api?.snapshot() };
		});
		expect(before.records, 'debug graph instrumentation must be present in the E2E bundle').toBeDefined();
		const snapshot = before.snapshot as { sourceRows?: number } | undefined;
		expect(snapshot?.sourceRows).toBeGreaterThanOrEqual(fixtureRows);

		const scroll = await root.evaluate(async () => {
			const scroller = document.querySelector<HTMLElement>('gl-lit-graph lit-virtualizer');
			if (scroller == null) throw new Error('Graph virtualizer was not found');

			const debug = (window as DebugWindow).__gitkrakenCommitGraphDebug;
			const recordsBefore = debug?.records().length ?? 0;
			const readMemory = () =>
				(
					globalThis.performance as unknown as Performance & {
						memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
					}
				).memory;
			const heapBefore = readMemory()?.usedJSHeapSize;
			const frameTimes: number[] = [];
			const frames = 90;
			for (let i = 0; i < frames; i++) {
				await new Promise<void>(resolveFrame => {
					requestAnimationFrame(timestamp => {
						frameTimes.push(timestamp);
						const fraction = i / (frames - 1);
						scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
						resolveFrame();
					});
				});
			}
			await new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame()));
			await new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame()));

			const frameGaps = frameTimes.slice(1).map((time, i) => time - frameTimes[i]);
			const records = debug?.records().slice(recordsBefore) ?? [];
			return {
				frameGaps: frameGaps,
				longTasks: records.filter(record => record.kind === 'longtask').map(record => record.duration),
				measures: records
					.filter(record => record.kind === 'measure')
					.map(record => ({ name: record.name, duration: record.duration, detail: record.detail })),
				heapBefore: heapBefore,
				heapAfter: readMemory()?.usedJSHeapSize,
				totalHeapAfter: readMemory()?.totalJSHeapSize,
			};
		});

		const records = before.records as DebugRecord[];
		const measures = records.filter(record => record.kind === 'measure');
		const measureNames = new Set(measures.map(record => record.name));
		for (const required of ['engine', 'projection', 'rows-to-render', 'first-rows-to-visible']) {
			expect(measureNames.has(required), `missing ${required} browser measure`).toBeTruthy();
		}

		const frameBudgetMs = 1000 / 60;
		const report = {
			schemaVersion: 1,
			benchmark: 'commit-graph-browser',
			createdAt: new Date().toISOString(),
			runtime: {
				node: process.version,
				platform: process.platform,
				arch: process.arch,
				cpu: cpus()[0]?.model,
				vscode: process.env.VSCODE_VERSION ?? 'stable',
			},
			fixture: { rows: snapshot?.sourceRows },
			openToVisibleMs: openToVisibleMs,
			rowsPayloadBytes: records
				.filter(record => record.name === 'rows-applied')
				.map(record => Number(record.detail?.receivedBytes ?? 0)),
			measures: Object.fromEntries(
				[...measureNames].sort().map(name => {
					const durations = measures.filter(record => record.name === name).map(record => record.duration);
					return [
						name,
						{ count: durations.length, p50Ms: percentile(durations, 0.5), maxMs: Math.max(...durations) },
					];
				}),
			),
			scroll: {
				frames: scroll.frameGaps.length + 1,
				p50FrameGapMs: percentile(scroll.frameGaps, 0.5),
				p75FrameGapMs: percentile(scroll.frameGaps, 0.75),
				p99FrameGapMs: percentile(scroll.frameGaps, 0.99),
				maxFrameGapMs: Math.max(...scroll.frameGaps),
				estimatedDroppedFrames: scroll.frameGaps.reduce(
					(total, gap) => total + Math.max(0, Math.round(gap / frameBudgetMs) - 1),
					0,
				),
				longTasks: scroll.longTasks,
				measures: scroll.measures,
			},
			memory: {
				usedHeapBeforeBytes: scroll.heapBefore,
				usedHeapAfterBytes: scroll.heapAfter,
				usedHeapDeltaBytes:
					scroll.heapBefore == null || scroll.heapAfter == null
						? undefined
						: scroll.heapAfter - scroll.heapBefore,
				totalHeapAfterBytes: scroll.totalHeapAfter,
			},
		};

		const outputPath = resolve(
			process.env.GRAPH_PERF_OUTPUT ?? `out/perf/commit-graph-browser-${testInfo.repeatEachIndex}.json`,
		);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
		await testInfo.attach('commit-graph-browser-performance', {
			body: Buffer.from(JSON.stringify(report, null, 2)),
			contentType: 'application/json',
		});
	},
);
