import * as assert from 'assert';
import { spawn } from 'child_process';
import { once } from 'events';
import {
	deriveStatusFromEvent,
	describeToolInput,
	getToolFilePath,
	isProcessAlive,
	rehydrateSubagents,
} from '../stateMachine.js';

suite('stateMachine', () => {
	suite('deriveStatusFromEvent', () => {
		test('maps lifecycle events to idle', () => {
			assert.strictEqual(deriveStatusFromEvent('SessionStart'), 'idle');
			assert.strictEqual(deriveStatusFromEvent('Stop'), 'idle');
			assert.strictEqual(deriveStatusFromEvent('StopFailure'), 'idle');
		});

		test('maps tool and compact events to their working states', () => {
			assert.strictEqual(deriveStatusFromEvent('PreToolUse'), 'tool_use');
			assert.strictEqual(deriveStatusFromEvent('PreCompact'), 'compacting');
		});

		test('maps permission events to permission_requested', () => {
			assert.strictEqual(deriveStatusFromEvent('PermissionRequest'), 'permission_requested');
			assert.strictEqual(deriveStatusFromEvent('Elicitation'), 'permission_requested');
		});

		test('maps post-activity events to thinking', () => {
			assert.strictEqual(deriveStatusFromEvent('UserPromptSubmit'), 'thinking');
			assert.strictEqual(deriveStatusFromEvent('PostToolUse'), 'thinking');
			assert.strictEqual(deriveStatusFromEvent('PermissionDenied'), 'thinking');
		});

		test('falls back to idle for unknown events', () => {
			assert.strictEqual(deriveStatusFromEvent('NotAnEvent'), 'idle');
		});
	});

	suite('describeToolInput', () => {
		test('includes command for Bash', () => {
			assert.strictEqual(describeToolInput('Bash', { command: 'ls -la' }), 'Bash(ls -la)');
		});

		test('includes file_path for file tools', () => {
			assert.strictEqual(describeToolInput('Read', { file_path: '/tmp/foo' }), 'Read(/tmp/foo)');
			assert.strictEqual(describeToolInput('Edit', { file_path: '/tmp/foo' }), 'Edit(/tmp/foo)');
			assert.strictEqual(describeToolInput('MultiEdit', { file_path: '/tmp/foo' }), 'MultiEdit(/tmp/foo)');
			assert.strictEqual(describeToolInput('Write', { file_path: '/tmp/foo' }), 'Write(/tmp/foo)');
		});

		test('returns bare tool name when detail is missing', () => {
			assert.strictEqual(describeToolInput('Bash', {}), 'Bash');
			assert.strictEqual(describeToolInput('UnknownTool', { foo: 'bar' }), 'UnknownTool');
		});
	});

	suite('getToolFilePath', () => {
		test('returns file_path for file-mutating tools', () => {
			assert.strictEqual(getToolFilePath('Edit', { file_path: '/tmp/foo.ts' }), '/tmp/foo.ts');
			assert.strictEqual(getToolFilePath('MultiEdit', { file_path: '/tmp/foo.ts' }), '/tmp/foo.ts');
			assert.strictEqual(getToolFilePath('Write', { file_path: '/tmp/foo.ts' }), '/tmp/foo.ts');
		});

		test('returns notebook_path for NotebookEdit', () => {
			assert.strictEqual(getToolFilePath('NotebookEdit', { notebook_path: '/tmp/n.ipynb' }), '/tmp/n.ipynb');
		});

		test('returns undefined for Read (inspect, not mutate)', () => {
			assert.strictEqual(getToolFilePath('Read', { file_path: '/tmp/foo.ts' }), undefined);
		});

		test('returns undefined for non-file tools', () => {
			assert.strictEqual(getToolFilePath('Bash', { command: 'ls' }), undefined);
			assert.strictEqual(getToolFilePath('Grep', { pattern: 'foo' }), undefined);
			assert.strictEqual(getToolFilePath('Glob', { pattern: '*.ts' }), undefined);
			assert.strictEqual(getToolFilePath('WebFetch', { url: 'https://example.com' }), undefined);
			assert.strictEqual(getToolFilePath('UnknownTool', { file_path: '/tmp/foo.ts' }), undefined);
		});

		test('returns undefined when toolInput is missing or path absent', () => {
			assert.strictEqual(getToolFilePath('Edit', undefined), undefined);
			assert.strictEqual(getToolFilePath('Edit', {}), undefined);
			assert.strictEqual(getToolFilePath('NotebookEdit', {}), undefined);
		});
	});

	suite('isProcessAlive', () => {
		test('returns true for the current process', () => {
			assert.strictEqual(isProcessAlive(process.pid), true);
		});

		test('returns false for a process that has exited', async () => {
			const child = spawn(process.execPath, ['-e', '']);
			const pid = child.pid!;
			await once(child, 'exit');
			// Give the OS a brief moment to fully reap the child.
			await new Promise(resolve => setTimeout(resolve, 50));
			assert.strictEqual(isProcessAlive(pid), false);
		});

		test('rejects non-positive and non-integer pids without calling kill', () => {
			assert.strictEqual(isProcessAlive(0), false);
			assert.strictEqual(isProcessAlive(-1), false);
			assert.strictEqual(isProcessAlive(Number.NaN), false);
			assert.strictEqual(isProcessAlive(Number.POSITIVE_INFINITY), false);
			assert.strictEqual(isProcessAlive(1.5), false);
		});
	});

	suite('rehydrateSubagents', () => {
		test('returns undefined for missing or empty input', () => {
			assert.strictEqual(rehydrateSubagents(undefined), undefined);
			assert.strictEqual(rehydrateSubagents([]), undefined);
		});

		test('rehydrates ISO strings into Date instances', () => {
			const lastActivity = '2026-01-01T00:00:00.000Z';
			const phaseSince = '2026-01-01T00:00:01.000Z';
			const [sub] = rehydrateSubagents([
				{
					id: 'sub-1',
					providerId: 'claudeCode',
					providerName: 'Claude Code',
					name: 'Subagent',
					status: 'thinking',
					phase: 'working',
					isSubagent: true,
					isInWorkspace: true,
					parentId: 'parent',
					lastActivity: lastActivity,
					phaseSince: phaseSince,
				},
			])!;
			assert.ok(sub.lastActivity instanceof Date);
			assert.ok(sub.phaseSince instanceof Date);
			assert.strictEqual(sub.lastActivity.toISOString(), lastActivity);
			assert.strictEqual(sub.phaseSince.toISOString(), phaseSince);
		});
	});
});
