import * as assert from 'node:assert';
import { sanitizeAgentPrompt } from '../sanitizePrompt.js';

suite('sanitizeAgentPrompt', () => {
	test('returns undefined for undefined', () => {
		assert.strictEqual(sanitizeAgentPrompt(undefined), undefined);
	});

	test('returns undefined for empty string', () => {
		assert.strictEqual(sanitizeAgentPrompt(''), undefined);
	});

	test('returns undefined for whitespace-only input', () => {
		assert.strictEqual(sanitizeAgentPrompt('   \n\t  '), undefined);
	});

	test('returns plain prompt trimmed', () => {
		assert.strictEqual(sanitizeAgentPrompt('  fix the failing test  '), 'fix the failing test');
	});

	suite('ide_* wrappers', () => {
		test('strips <ide_opened_file> prefix and keeps user text', () => {
			const input =
				'<ide_opened_file>The user opened the file /repo/foo.ts in the IDE. ' +
				'This may or may not be related to the current task.</ide_opened_file>\n' +
				'/investigate sky color';
			assert.strictEqual(sanitizeAgentPrompt(input), '/investigate sky color');
		});

		test('strips <ide_selection> with multiline content', () => {
			const input =
				'<ide_selection>The user selected the lines 10 to 20 from /repo/foo.ts:\n' +
				'function foo() {\n  return 1;\n}\n\n' +
				'This may or may not be related to the current task.</ide_selection>\n' +
				'explain this code';
			assert.strictEqual(sanitizeAgentPrompt(input), 'explain this code');
		});

		test('strips a hypothetical future <ide_anything_new> via prefix match', () => {
			const input = '<ide_anything_new>future context</ide_anything_new>\nuser text';
			assert.strictEqual(sanitizeAgentPrompt(input), 'user text');
		});

		test('strips <ide_opened_file> with attributes', () => {
			const input = '<ide_opened_file path="/repo/foo.ts">context</ide_opened_file>\nuser text';
			assert.strictEqual(sanitizeAgentPrompt(input), 'user text');
		});

		test('returns undefined when input is only IDE context', () => {
			const input = '<ide_opened_file>just context, no prompt</ide_opened_file>';
			assert.strictEqual(sanitizeAgentPrompt(input), undefined);
		});

		test('does not strip a bare <ide_> with no name suffix', () => {
			const input = '<ide_>not a real tag</ide_>';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});
	});

	suite('@terminal mention expansion', () => {
		test('strips <terminal name="..."> and keeps user text', () => {
			const input = '<terminal name="bash-1">$ ls\nfoo.ts bar.ts</terminal>\nwhy did that fail?';
			assert.strictEqual(sanitizeAgentPrompt(input), 'why did that fail?');
		});

		test('does NOT strip plain <terminal> without a name attribute', () => {
			const input = '<terminal>like in markdown</terminal>';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});
	});

	suite('@browser mention expansion', () => {
		test('strips <browser tabGroupId="..." tabId="..."> and keeps user text', () => {
			const input = '<browser tabGroupId="g1" tabId="t1">https://example.com</browser>\nsummarize this';
			assert.strictEqual(sanitizeAgentPrompt(input), 'summarize this');
		});

		test('strips <browser_instruction>', () => {
			const input =
				'<browser_instruction>Use the browser tool to fetch URLs.</browser_instruction>\n' +
				'what does this say?';
			assert.strictEqual(sanitizeAgentPrompt(input), 'what does this say?');
		});

		test('does NOT strip plain <browser> without tab attributes', () => {
			const input = '<browser>like a code example</browser>';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});
	});

	suite('CLI harness wrappers', () => {
		test('strips <task-notification> with nested children', () => {
			const input =
				'<task-notification>\n' +
				'<task-id>b3b6icuho</task-id>\n' +
				'<tool-use-id>toolu_01FEnSf5</tool-use-id>\n' +
				'<output-file>/tmp/.../b3b6icuho.output</output-file>\n' +
				'<status>completed</status>\n' +
				'<summary>Background command "Print date" completed (exit code 0)</summary>\n' +
				'</task-notification>';
			assert.strictEqual(sanitizeAgentPrompt(input), undefined);
		});

		test('strips <local-command-stdout>', () => {
			const input = '<local-command-stdout>Set model to claude-opus-4-7</local-command-stdout>';
			assert.strictEqual(sanitizeAgentPrompt(input), undefined);
		});

		test('strips <local-command-stderr>', () => {
			const input = '<local-command-stderr>error</local-command-stderr>\nfollow up';
			assert.strictEqual(sanitizeAgentPrompt(input), 'follow up');
		});

		test('strips <local-command-caveat>', () => {
			const input = '<local-command-caveat>Caveat: ...</local-command-caveat>\nuser text';
			assert.strictEqual(sanitizeAgentPrompt(input), 'user text');
		});

		test('strips <bash-input>/<bash-stdout>/<bash-stderr>', () => {
			const input =
				'<bash-input>ls -la</bash-input>\n' +
				'<bash-stdout>foo.ts\nbar.ts</bash-stdout>\n' +
				'<bash-stderr></bash-stderr>\n' +
				'what is in foo.ts?';
			assert.strictEqual(sanitizeAgentPrompt(input), 'what is in foo.ts?');
		});

		test('strips <permissionresponse>', () => {
			const input = '<permissionresponse>allow</permissionresponse>\nproceed';
			assert.strictEqual(sanitizeAgentPrompt(input), 'proceed');
		});

		test('strips <shared-context> with attributes', () => {
			const input =
				'<shared-context id="abc" type="markdown" version="1" title="Notes">' +
				'some shared context body' +
				'</shared-context>\nthe actual question';
			assert.strictEqual(sanitizeAgentPrompt(input), 'the actual question');
		});
	});

	suite('combinations', () => {
		test('strips multiple concatenated wrappers', () => {
			const input =
				'<ide_opened_file>foo.ts context</ide_opened_file>\n' +
				'<browser_instruction>browser hint</browser_instruction>\n' +
				'do the thing';
			assert.strictEqual(sanitizeAgentPrompt(input), 'do the thing');
		});

		test('collapses extra blank lines after stripping', () => {
			const input =
				'<ide_opened_file>a</ide_opened_file>\n\n\n\n' +
				'<browser_instruction>b</browser_instruction>\n\n\n' +
				'after';
			assert.strictEqual(sanitizeAgentPrompt(input), 'after');
		});

		test('normalizes CRLF line endings around a stripped wrapper', () => {
			const input = '<ide_opened_file>The user opened /repo/foo.ts</ide_opened_file>\r\n/investigate sky color';
			assert.strictEqual(sanitizeAgentPrompt(input), '/investigate sky color');
		});

		test('preserves internal whitespace when no wrapper matched', () => {
			const input = 'line one   \n\n\n\nline two';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});
	});

	suite('dispatch preamble', () => {
		const startWorkPrompt = (issueJson: string) =>
			'You are an advanced AI programming assistant tasked with helping a developer start work on a new issue. ' +
			'Your goal is to analyze the issue details and provide a clear plan of action, estimate, and implement a solution.\n\n' +
			'First, examine the following JSON object containing the issue details:\n\n' +
			`<issue>\n${issueJson}\n</issue>\n\n` +
			'Now, proceed with your analysis.';

		const startReviewPrompt = (prJson: string) =>
			'You are an advanced AI programming assistant tasked with reviewing a pull request (PR). ' +
			'Your goal is to analyze the PR details and provide a comprehensive review.\n\n' +
			'First, examine the following JSON object containing the PR details:\n\n' +
			`<prData>\n${prJson}\n</prData>\n\n` +
			'Now, proceed with your analysis.';

		test('extracts issue title from a Start Work dispatch prompt', () => {
			const input = startWorkPrompt(
				JSON.stringify({ id: '123', title: 'Fix GitLab PR approval 405 Method Not Allowed error' }),
			);
			assert.strictEqual(sanitizeAgentPrompt(input), 'Fix GitLab PR approval 405 Method Not Allowed error');
		});

		test('extracts PR title from a Start Review dispatch prompt', () => {
			const input = startReviewPrompt(JSON.stringify({ id: 'pr-1', title: 'Improve graph view updates' }));
			assert.strictEqual(sanitizeAgentPrompt(input), 'Improve graph view updates');
		});

		test('trims whitespace around the extracted title', () => {
			const input = startWorkPrompt(JSON.stringify({ title: '   Padded title   ' }));
			assert.strictEqual(sanitizeAgentPrompt(input), 'Padded title');
		});

		test('falls through when block JSON is malformed', () => {
			const input = startWorkPrompt('this is not json');
			// Falls through to normal sanitization — neither preamble nor JSON gets stripped, so
			// the full prompt comes back trimmed.
			assert.strictEqual(sanitizeAgentPrompt(input), input.trim());
		});

		test('falls through when title field is missing', () => {
			const input = startWorkPrompt(JSON.stringify({ id: '123', body: 'no title here' }));
			assert.strictEqual(sanitizeAgentPrompt(input), input.trim());
		});

		test('falls through when title is an empty string', () => {
			const input = startWorkPrompt(JSON.stringify({ id: '123', title: '   ' }));
			assert.strictEqual(sanitizeAgentPrompt(input), input.trim());
		});

		test('falls through when title is not a string', () => {
			const input = startWorkPrompt(JSON.stringify({ id: '123', title: 42 }));
			assert.strictEqual(sanitizeAgentPrompt(input), input.trim());
		});

		test('rewrite wins over a trailing harness wrapper', () => {
			const dispatched = startWorkPrompt(JSON.stringify({ title: 'Wire up the new pill' }));
			const input = `${dispatched}\n<task-notification><status>completed</status></task-notification>`;
			assert.strictEqual(sanitizeAgentPrompt(input), 'Wire up the new pill');
		});

		test('handles CRLF line endings inside the dispatch block', () => {
			const issueJson = JSON.stringify({ title: 'CRLF-safe title' });
			const input = startWorkPrompt(issueJson).replace(/\n/g, '\r\n');
			assert.strictEqual(sanitizeAgentPrompt(input), 'CRLF-safe title');
		});

		test('ignores a dispatch block embedded inside a harness wrapper', () => {
			// Realistic scenario: a developer working on GitLens itself selects code that contains
			// our own dispatch template. The IDE wraps the selection in <ide_selection>…</ide_selection>
			// and appends the user's real question. The harness wrapper must be stripped first so
			// the embedded `<issue>` block doesn't hijack the session name.
			const trap = JSON.stringify({ title: 'should not surface' });
			const input =
				`<ide_selection>here is the dispatch template:\n<issue>${trap}</issue>\nend of selection</ide_selection>\n` +
				'why does this not work?';
			assert.strictEqual(sanitizeAgentPrompt(input), 'why does this not work?');
		});
	});

	suite('user content passes through', () => {
		test('preserves <details>/<summary>', () => {
			const input = '<details><summary>Click</summary>hidden body</details>';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});

		test('preserves <img>', () => {
			const input = 'See <img src="https://example.com/foo.png"> for context';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});

		test('preserves triple-backtick code blocks', () => {
			const input = '```ts\nconst x = 1;\n```\nwhat does this do';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});

		test('preserves TypeScript generic-shaped angle brackets', () => {
			const input = "Property does not exist on type 'IntrinsicAttributes & Readonly<Props>'.";
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});

		test('preserves GitLens component-name-shaped tags', () => {
			const input = 'rendering <gl-tooltip> inside <gl-popover> failed';
			assert.strictEqual(sanitizeAgentPrompt(input), input);
		});
	});
});
