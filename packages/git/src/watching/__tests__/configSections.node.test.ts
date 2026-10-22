import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { GitConfigSections } from '../configSections.js';
import { diffGitConfigSections, parseGitConfigBytes, parseGitConfigSections } from '../configSections.js';

function parse(text: string): GitConfigSections {
	const sections = parseGitConfigSections(text);
	assert.ok(sections != null, `git would accept:\n${text}`);
	return sections;
}

function sectionsOf(text: string): Record<string, readonly string[]> {
	return Object.fromEntries(parse(text));
}

describe('parseGitConfigSections', () => {
	it('names a section by its lowercased name and its subsection as written, and lowercases keys', () => {
		assert.deepStrictEqual(
			sectionsOf('[Core]\n\tBare = false\n[Branch "Feature/X"]\n\tMerge = refs/heads/Feature/X\n'),
			{
				core: ['bare=false'],
				'branch.Feature/X': ['merge=refs/heads/Feature/X'],
			},
		);
	});

	it('lowercases the legacy [section.subsection] form whole, as git does', () => {
		assert.deepStrictEqual(sectionsOf('[branch.Feature]\n\tremote = origin\n'), {
			'branch.feature': ['remote=origin'],
		});
	});

	it('unescapes a quoted subsection', () => {
		assert.deepStrictEqual(Object.keys(sectionsOf('[branch "a\\"b\\\\c"]\n\tremote = origin\n')), [
			'branch.a"b\\c',
		]);
	});

	it('reads a variable on its header line, and lists a repeated section in file order', () => {
		assert.deepStrictEqual(sectionsOf('[core] bare = false\n[remote "o"]\n\turl = a\n[core]\n\tfilemode\n'), {
			core: ['bare=false', 'filemode'],
			'remote.o': ['url=a'],
		});
	});

	it('tells a variable with no value from one with an empty value', () => {
		assert.deepStrictEqual(sectionsOf('[core]\n\ta\n\tb =\n'), { core: ['a', 'b='] });
	});

	it('unquotes and unescapes a value, trims unquoted whitespace and drops comments outside quotes', () => {
		assert.deepStrictEqual(
			sectionsOf('[s]\n\ta =   one two   ; a comment\n\tb = " kept ; # "  # gone\n\tc = x\\ty\\n\\"\\\\\n'),
			{ s: ['a=one two', 'b= kept ; # ', 'c=x\ty\n"\\'] },
		);
	});

	it('joins a continued value, so a header-like line inside it is not a header', () => {
		// The quotes are the value's, so git drops them too
		assert.deepStrictEqual(sectionsOf('[s]\n\ta = one \\\n[branch "x"]\n\tb = two\n'), {
			s: ['a=one [branch x]', 'b=two'],
		});
	});

	it('ignores a backslash inside a comment, as git does', () => {
		assert.deepStrictEqual(sectionsOf('[s]\n\ta = one ; comment \\\n[branch "x"]\n\tb = two\n'), {
			s: ['a=one'],
			'branch.x': ['b=two'],
		});
	});

	it('reads CRLF line endings, comment lines and a missing final newline', () => {
		assert.deepStrictEqual(sectionsOf('# top\r\n[s]\r\n\t; note\r\n\ta = 1\r\n\tb = 2'), { s: ['a=1', 'b=2'] });
	});

	it("keeps \\v and \\f, which git's isspace doesn't trim", () => {
		assert.deepStrictEqual(sectionsOf('[s]\n\ta = x\v\n'), { s: ['a=x\v'] });
	});

	it('rejects what git rejects, and a variable before any section, which it has no section to place in', () => {
		for (const text of [
			'\ta = before any section\n',
			'[branch "x]\n\ta = 1\n',
			'[branch "x" ]\n\ta = 1\n',
			'[bran ch]\n',
			'[]\n',
			'[s]\n\ta = "unterminated\n',
			'[s]\n\ta = bad \\q escape\n',
			'[s]\n\t1a = starts with a digit\n',
			'[s]\n\ta b = no equals sign\n',
			'[s',
		]) {
			assert.strictEqual(parseGitConfigSections(text), undefined, JSON.stringify(text));
		}
	});

	it('rejects bytes that are not UTF-8', () => {
		assert.strictEqual(parseGitConfigBytes(new Uint8Array([0x5b, 0x73, 0x5d, 0x0a, 0xff, 0xfe])), undefined);
		assert.deepStrictEqual(Object.fromEntries(parseGitConfigBytes(new TextEncoder().encode('﻿[s]\n\ta = é\n'))!), {
			s: ['a=é'],
		});
	});
});

describe('diffGitConfigSections', () => {
	const base = '[core]\n\tbare = false\n[remote "origin"]\n\turl = /o.git\n[branch "main"]\n\tremote = origin\n';

	function diff(before: string, after: string) {
		return diffGitConfigSections(parse(before), parse(after));
	}

	it('finds nothing changed in an identical file, or one changed only in its comments or layout', () => {
		assert.strictEqual(diff(base, base), undefined);
		assert.strictEqual(
			diff(base, base.replace('remote = origin', 'remote=origin   # tracked').replace('[core]', '# c\n[core]')),
			undefined,
		);
	});

	it('confines a change to the branches whose sections it added, changed or removed', () => {
		assert.deepStrictEqual(diff(base, `${base}[branch "feature/x"]\n\tmerge = refs/heads/x\n`), {
			branches: new Set(['refs/heads/feature/x']),
			confined: true,
		});
		assert.deepStrictEqual(diff(base, base.replace('[branch "main"]\n\tremote = origin\n', '')), {
			branches: new Set(['refs/heads/main']),
			confined: true,
		});
		assert.deepStrictEqual(diff(base, base.replace('[branch "main"]', '[branch "trunk"]')), {
			branches: new Set(['refs/heads/main', 'refs/heads/trunk']),
			confined: true,
		});
	});

	it('is unconfined when anything outside a branch subsection changed', () => {
		for (const after of [
			base.replace('/o.git', '/p.git'),
			`${base}[branch]\n\tautoSetupMerge = always\n`,
			`${base}[include]\n\tpath = extra\n`,
			`${base}[extensions]\n\trelativeWorktrees = true\n[branch "x"]\n\tremote = origin\n`,
		]) {
			assert.strictEqual(diff(base, after)?.confined, false, after);
		}
	});

	it('sees a change in a value that differs only in a character git keeps', () => {
		assert.strictEqual(diff('[branch "x"]\n\ta = v\n', '[branch "x"]\n\ta = v\v\n')?.confined, true);
		assert.strictEqual(diff('[branch "x"]\n\ta\n', '[branch "x"]\n\ta =\n')?.confined, true);
		assert.strictEqual(
			diff('[branch "x"]\n\ta = 1\n\ta = 2\n', '[branch "x"]\n\ta = 2\n\ta = 1\n')?.confined,
			true,
		);
	});
});
