import type { SimulatorMode } from '../../../src/plus/ai/__debug__simulatorState.js';
import type { VSCodeInstance } from '../baseTest.js';
import { createTmpDir, expect, GitFixture } from '../baseTest.js';

type SimulatorMessage = { content: string };

const paidSubscriptionState = 6;

export const stagedMarker = 'alpha staged marker';
export const unstagedMarker = 'beta unstaged marker';

export async function createRepoWithStagedAndUnstagedChanges(options?: {
	baseCommit?: boolean;
	remote?: string;
}): Promise<string> {
	const repoDir = await createTmpDir();
	const git = new GitFixture(repoDir);
	await git.init();
	if (options?.baseCommit) {
		await git.commit('Add base', 'base.ts', 'export const base = 1;\n', { date: '2024-01-10T12:00:00' });
	}
	await git.commit('Add alpha', 'alpha.ts', 'export const alpha = 1;\n', { date: '2024-01-11T12:00:00' });
	await git.commit('Add beta', 'beta.ts', 'export const beta = 1;\n', { date: '2024-01-12T12:00:00' });
	if (options?.remote != null) {
		await git.addRemote('origin', options.remote);
	}

	await git.createFile('alpha.ts', `export const alpha = 1;\n// ${stagedMarker}\n`);
	await git.stage('alpha.ts');
	await git.createFile('beta.ts', `export const beta = 1;\n// ${unstagedMarker}\n`);

	return repoDir;
}

let uniqueCounter = 0;

export function unique(label: string): string {
	return `${label} ${Date.now().toString(36)}-${++uniqueCounter}`;
}

function simulateAI<T>(vscode: VSCodeInstance, args: Record<string, unknown>): Promise<T> {
	return vscode.gitlens.executeCommand<T>('gitlens.plus.simulate.ai', args);
}

export async function startAISimulation(vscode: VSCodeInstance): Promise<AsyncDisposable> {
	// KEEP: simulate a Pro account before any AI action
	const subscription = await vscode.gitlens.startSubscriptionSimulation({
		state: paidSubscriptionState,
		planId: 'pro',
	});
	const simulation: AsyncDisposable = {
		[Symbol.asyncDispose]: async () => {
			await simulateAI(vscode, { op: 'disable' }).catch((ex: unknown) => {
				console.warn('Failed to disable the AI simulator', ex);
			});
			await subscription[Symbol.asyncDispose]();
		},
	};

	try {
		const status = await vscode.gitlens.getAccountStatus();
		expect(status.state, 'Pro subscription simulated').toBe(paidSubscriptionState);
		expect(status.account, 'simulated subscription has an account').toBeDefined();

		expect(await vscode.gitlens.waitForCommand('gitlens.plus.simulate.ai'), 'AI simulator registered').toBe(true);
		await simulateAI(vscode, { op: 'enable', dismissOnboarding: true });
		await expect.poll(() => vscode.gitlens.getSetting('gitlens.ai.model')).toBe('simulator:default');
	} catch (ex) {
		try {
			await simulation[Symbol.asyncDispose]();
		} catch {}
		throw ex;
	}

	return simulation;
}

export async function setAISimulatorModeAndClearResponses(vscode: VSCodeInstance, mode: SimulatorMode): Promise<void> {
	await simulateAI(vscode, { op: 'enable', mode: mode });
}

export async function queueAIResponse(vscode: VSCodeInstance, action: string, content: string): Promise<void> {
	expect(await simulateAI<boolean>(vscode, { op: 'inject', action: action, content: content })).toBe(true);
}

export async function clearAIResponses(vscode: VSCodeInstance): Promise<void> {
	await simulateAI(vscode, { op: 'clear' });
}

// KEEP: read only after the test's own result has shown up
export async function getLastAIPrompt(vscode: VSCodeInstance): Promise<string> {
	const messages = await simulateAI<SimulatorMessage[] | undefined>(vscode, { op: 'lastMessages' });
	return (messages ?? []).map(m => m.content).join('\n');
}
