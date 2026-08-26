import type { Disposable, OutputChannel } from 'vscode';
import { window } from 'vscode';
import { createDisposable, disposableInterval } from '@gitlens/utils/disposable.js';
import type { ResourceUsage, ResourceUsageMetric } from '@gitlens/utils/resourceUsage.js';
import { getAvatarResourceUsage } from './avatars.js';
import type { ExtensionResourceUsageEvent } from './constants.telemetry.js';
import type { Container } from './container.js';
import { registerCommand } from './system/-webview/command.js';
import type { ResourceUsageRegistry } from './system/resourceUsage.js';

/** How often resource-usage telemetry is sampled, when the window is focused. */
const sampleInterval = 1000 * 60 * 60; // 1 hour

/** Collects resource usage from registered, already-instantiated extension services. */
export function collectResourceUsage(registry: ResourceUsageRegistry): ExtensionResourceUsageEvent {
	const usage = registry.collect();
	return { 'extensionHost.memory.heapUsed.bytes': usage['extensionHost.memory.heapUsed.bytes'], ...usage };
}

/** Formats the flat resource-usage record into aligned `key = value` lines for the output channel. */
export function formatResourceUsage(usage: Readonly<ResourceUsage>): string {
	const keys = (Object.keys(usage) as ResourceUsageMetric[]).sort();
	if (keys.length === 0) return '';

	const width = Math.max(...keys.map(key => key.length));
	return keys.map(key => `  ${key.padEnd(width)} = ${formatValue(key, usage[key])}`).join('\n');
}

/**
 * Registers the public resource-usage command and hourly telemetry sampler. Providers are pulled only
 * when a snapshot is collected, and collecting a snapshot never initializes otherwise-unused services.
 */
export function registerResourceUsage(container: Container): Disposable[] {
	const extensionHostRegistration = container.resourceUsage.register('extensionHost', getExtensionHostResourceUsage);
	const avatarsRegistration = container.resourceUsage.register('avatars', getAvatarResourceUsage);
	let output: OutputChannel | undefined;

	const show = (): void => {
		const usage = collectResourceUsage(container.resourceUsage);
		output ??= window.createOutputChannel('GitLens (Resource Usage)');
		output.replace(
			`GitLens resource usage\n\nCache and tracker metrics are GitLens-owned. Memory metrics cover the entire VS Code extension host and cannot be attributed to GitLens alone.\n\n${formatResourceUsage(usage)}`,
		);
		output.show();
	};

	const sampler = disposableInterval(() => {
		if (!window.state.focused || !container.telemetry.enabled) return;

		container.telemetry.sendEvent('extension/resourceUsage', collectResourceUsage(container.resourceUsage));
	}, sampleInterval);

	return [
		extensionHostRegistration,
		avatarsRegistration,
		registerCommand('gitlens.showResourceUsage', show),
		sampler,
		createDisposable(() => output?.dispose()),
	];
}

function getExtensionHostResourceUsage(): ResourceUsage {
	// Node.js (desktop) and Chromium's performance.memory (web) expose different shapes; neither may exist
	const proc = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number; rss: number } } }).process;
	if (proc?.memoryUsage != null) {
		const { heapUsed, rss } = proc.memoryUsage();
		return { 'memory.heapUsed.bytes': heapUsed, 'memory.residentSet.bytes': rss };
	}

	const perfMemory = (globalThis as { performance?: { memory?: { usedJSHeapSize: number } } }).performance?.memory;
	if (perfMemory != null) {
		return { 'memory.heapUsed.bytes': perfMemory.usedJSHeapSize };
	}

	return { 'memory.heapUsed.bytes': undefined };
}

function formatValue(key: string, value: number | undefined): string {
	if (value == null) return 'unavailable';

	if (key.endsWith('.bytes')) {
		return `${(value / 1024 / 1024).toFixed(1)}MB (${value})`;
	}

	return String(value);
}
