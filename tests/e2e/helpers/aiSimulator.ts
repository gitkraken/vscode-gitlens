import type { VSCodeInstance } from '../baseTest.js';
import { expect } from '../baseTest.js';

type SimulatorMessage = { content: string };

let uniqueCounter = 0;

export function unique(label: string): string {
	return `${label} ${Date.now().toString(36)}-${++uniqueCounter}`;
}

function simulateAI<T>(vscode: VSCodeInstance, args: Record<string, unknown>): Promise<T> {
	return vscode.gitlens.executeCommand<T>('gitlens.plus.simulate.ai', args);
}

export async function startAISimulation(vscode: VSCodeInstance): Promise<AsyncDisposable> {
	// KEEP: AI actions need an account on a Pro plan; without one they end silently or behind a modal
	const subscription = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });
	const simulation: AsyncDisposable = {
		[Symbol.asyncDispose]: async () => {
			await simulateAI(vscode, { op: 'disable' }).catch(() => {});
			await subscription[Symbol.asyncDispose]();
		},
	};

	try {
		const status = await vscode.gitlens.getAccountStatus();
		expect(status.state, 'Pro subscription simulated').toBe(6);
		expect(status.account, 'simulated subscription has an account').toBeDefined();

		expect(await vscode.gitlens.waitForCommand('gitlens.plus.simulate.ai'), 'AI simulator registered').toBe(true);
		await simulateAI(vscode, { op: 'enable', dismissOnboarding: true });
		await expect.poll(() => vscode.gitlens.getSetting('gitlens.ai.model')).toBe('simulator:default');
	} catch (ex) {
		await simulation[Symbol.asyncDispose]();
		throw ex;
	}

	return simulation;
}

export async function setAISimulatorMode(vscode: VSCodeInstance, mode: string): Promise<void> {
	await simulateAI(vscode, { op: 'enable', mode: mode });
}

export async function queueAIResponse(vscode: VSCodeInstance, action: string, content: string): Promise<void> {
	expect(await simulateAI<boolean>(vscode, { op: 'inject', action: action, content: content })).toBe(true);
}

export async function clearAIResponses(vscode: VSCodeInstance): Promise<void> {
	await simulateAI(vscode, { op: 'clear' });
}

// KEEP: call only after the test's own result shows up — the simulator keeps the last prompt across tests
export async function getLastAIPrompt(vscode: VSCodeInstance): Promise<string> {
	const messages = await simulateAI<SimulatorMessage[] | undefined>(vscode, { op: 'lastMessages' });
	return (messages ?? []).map(m => m.content).join('\n');
}
