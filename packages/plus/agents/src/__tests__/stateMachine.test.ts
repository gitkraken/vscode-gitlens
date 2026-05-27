import * as assert from 'assert';
import { spawn } from 'child_process';
import { once } from 'events';
import {
	classifyPermissionKind,
	deriveStatusFromEvent,
	describeToolInput,
	extractPlanSummary,
	extractQuestionDetails,
	getToolFilePath,
	getToolReadPath,
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

		test('uses plan summary for ExitPlanMode', () => {
			assert.strictEqual(
				describeToolInput('ExitPlanMode', { plan: '# Refactor cache layer\n\nDetails follow…' }),
				'ExitPlanMode(Refactor cache layer)',
			);
			assert.strictEqual(describeToolInput('ExitPlanMode', {}), 'ExitPlanMode');
		});

		test('uses question text for AskUserQuestion', () => {
			assert.strictEqual(
				describeToolInput('AskUserQuestion', {
					questions: [{ question: 'Which library should we use?' }],
				}),
				'AskUserQuestion(Which library should we use?)',
			);
			assert.strictEqual(describeToolInput('AskUserQuestion', {}), 'AskUserQuestion');
		});
	});

	suite('classifyPermissionKind', () => {
		test('maps ExitPlanMode to plan', () => {
			assert.strictEqual(classifyPermissionKind('ExitPlanMode'), 'plan');
		});

		test('maps AskUserQuestion to question', () => {
			assert.strictEqual(classifyPermissionKind('AskUserQuestion'), 'question');
		});

		test('falls back to tool for any other tool name', () => {
			assert.strictEqual(classifyPermissionKind('Bash'), 'tool');
			assert.strictEqual(classifyPermissionKind('Edit'), 'tool');
			assert.strictEqual(classifyPermissionKind(''), 'tool');
		});
	});

	suite('extractPlanSummary', () => {
		test('returns the first heading stripped of #s', () => {
			assert.strictEqual(extractPlanSummary({ plan: '# Title here\n\n## Section' }), 'Title here');
			assert.strictEqual(extractPlanSummary({ plan: '### Deeply nested\n\nBody' }), 'Deeply nested');
		});

		test('prefers a heading even when prose appears first', () => {
			assert.strictEqual(extractPlanSummary({ plan: 'leading prose\n\n## Real heading\n' }), 'Real heading');
		});

		test('falls back to the first non-empty line when no heading exists', () => {
			assert.strictEqual(extractPlanSummary({ plan: '\n\nFirst real line\nsecond' }), 'First real line');
		});

		test('skips empty headings and continues scanning', () => {
			assert.strictEqual(extractPlanSummary({ plan: '# \n## Actual heading' }), 'Actual heading');
		});

		test('returns undefined for empty / whitespace-only / missing plans', () => {
			assert.strictEqual(extractPlanSummary({}), undefined);
			assert.strictEqual(extractPlanSummary({ plan: '' }), undefined);
			assert.strictEqual(extractPlanSummary({ plan: '\n   \n\t' }), undefined);
		});

		test('truncates very long summaries with an ellipsis', () => {
			const long = 'A'.repeat(200);
			const result = extractPlanSummary({ plan: `# ${long}` });
			// eslint-disable-next-line @typescript-eslint/prefer-optional-chain
			assert.ok(result != null && result.endsWith('…'));
			assert.ok(result.length <= 121);
		});
	});

	suite('extractQuestionDetails', () => {
		test('returns text + count for single question', () => {
			const result = extractQuestionDetails({ questions: [{ question: 'Pick one?' }] });
			assert.deepStrictEqual(result, { text: 'Pick one?', count: 1 });
		});

		test('counts all questions but returns only the first text', () => {
			const result = extractQuestionDetails({
				questions: [{ question: 'First?' }, { question: 'Second?' }, { question: 'Third?' }],
			});
			assert.deepStrictEqual(result, { text: 'First?', count: 3 });
		});

		test('trims leading and trailing whitespace from question text', () => {
			const result = extractQuestionDetails({ questions: [{ question: '   What is it?   ' }] });
			assert.deepStrictEqual(result, { text: 'What is it?', count: 1 });
		});

		test('returns undefined when questions is missing, empty, or non-array', () => {
			assert.strictEqual(extractQuestionDetails({}), undefined);
			assert.strictEqual(extractQuestionDetails({ questions: [] }), undefined);
			assert.strictEqual(extractQuestionDetails({ questions: 'not an array' }), undefined);
		});

		test('returns undefined when the first question has no string text', () => {
			assert.strictEqual(extractQuestionDetails({ questions: [{ question: '' }] }), undefined);
			assert.strictEqual(extractQuestionDetails({ questions: [{ question: '   ' }] }), undefined);
			assert.strictEqual(extractQuestionDetails({ questions: [{}] }), undefined);
			assert.strictEqual(extractQuestionDetails({ questions: [{ question: 42 }] }), undefined);
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

	suite('getToolReadPath', () => {
		test('returns file_path for Read', () => {
			assert.strictEqual(getToolReadPath('Read', { file_path: '/tmp/foo.ts' }), '/tmp/foo.ts');
		});

		test('returns notebook_path for NotebookRead', () => {
			assert.strictEqual(getToolReadPath('NotebookRead', { notebook_path: '/tmp/n.ipynb' }), '/tmp/n.ipynb');
		});

		test('returns undefined for write-class tools (tracked by getToolFilePath)', () => {
			assert.strictEqual(getToolReadPath('Edit', { file_path: '/tmp/foo.ts' }), undefined);
			assert.strictEqual(getToolReadPath('MultiEdit', { file_path: '/tmp/foo.ts' }), undefined);
			assert.strictEqual(getToolReadPath('Write', { file_path: '/tmp/foo.ts' }), undefined);
			assert.strictEqual(getToolReadPath('NotebookEdit', { notebook_path: '/tmp/n.ipynb' }), undefined);
		});

		test('returns undefined for non-file tools', () => {
			assert.strictEqual(getToolReadPath('Bash', { command: 'ls' }), undefined);
			assert.strictEqual(getToolReadPath('Grep', { pattern: 'foo' }), undefined);
			assert.strictEqual(getToolReadPath('Glob', { pattern: '*.ts' }), undefined);
			assert.strictEqual(getToolReadPath('WebFetch', { url: 'https://example.com' }), undefined);
			assert.strictEqual(getToolReadPath('UnknownTool', { file_path: '/tmp/foo.ts' }), undefined);
		});

		test('returns undefined when toolInput is missing or path absent', () => {
			assert.strictEqual(getToolReadPath('Read', undefined), undefined);
			assert.strictEqual(getToolReadPath('Read', {}), undefined);
			assert.strictEqual(getToolReadPath('NotebookRead', {}), undefined);
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
