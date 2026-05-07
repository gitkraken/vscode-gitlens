// Bundle the five internal @gitlens/* workspace packages into this core package.
//
// Steps:
//   1. Clean dist/ and src/ (regenerated from the sub-packages)
//   2. Copy each sub-package's dist/ and src/ into packages/core/{dist,src}/<dest>/
//   3. Rewrite cross-package @gitlens/<pkg>/<path> specifiers in .js/.d.ts to relative paths
//   4. Rewrite source map `sources` entries to point into packages/core/src/<dest>/
//   5. Merge runtime dependencies from the five package.json files (stripping workspace refs)
//   6. Generate the `exports` map from each sub-package's `exports` patterns
//   7. Copy root LICENSE and LICENSE.plus into the package for shipping
//   8. Write the updated package.json back in place
//
// Source packages keep `private: true` and their existing shape; only this core
// package is published to npm.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreRoot = dirname(scriptDir);
const repoRoot = dirname(dirname(coreRoot));

// @gitlens/<name> source location -> destination subpath inside core
const packages = [
	{ name: '@gitlens/utils', srcDir: 'packages/utils', dest: 'utils' },
	{ name: '@gitlens/ipc', srcDir: 'packages/ipc', dest: 'ipc' },
	{ name: '@gitlens/git', srcDir: 'packages/git', dest: 'git' },
	{ name: '@gitlens/git-cli', srcDir: 'packages/git-cli', dest: 'git-cli' },
	{ name: '@gitlens/ai', srcDir: 'packages/plus/ai', dest: 'plus/ai' },
	{ name: '@gitlens/git-github', srcDir: 'packages/plus/git-github', dest: 'plus/git-github' },
];

const nameToDest = Object.fromEntries(packages.map(p => [p.name, p.dest]));
const internalPackageNames = new Set(packages.map(p => p.name));

const distName = 'dist';
const srcName = 'src';

async function main() {
	log('Cleaning previous bundle output');
	await clean();

	log('Copying sub-package dist/ and src/ trees');
	for (const pkg of packages) {
		await copyPackageTree(pkg);
	}

	log('Rewriting @gitlens/* specifiers to relative paths');
	await rewriteSpecifiers();

	log('Rewriting @gitlens/* imports in src/ TypeScript sources');
	await rewriteSrcSpecifiers();

	log('Rewriting source map `sources` paths');
	await rewriteSourceMaps();

	log('Copying LICENSE files');
	await copyLicenses();

	log('Generating exports and merging dependencies in package.json');
	await writeUpdatedPackageJson();

	log('Bundle complete -> packages/core/dist + packages/core/src');
}

function log(msg) {
	console.log(`[core-gitlens bundle] ${msg}`);
}

async function clean() {
	await rm(join(coreRoot, distName), { recursive: true, force: true });
	await rm(join(coreRoot, srcName), { recursive: true, force: true });
	await rm(join(coreRoot, 'LICENSE'), { force: true });
	await rm(join(coreRoot, 'LICENSE.plus'), { force: true });
}

async function copyPackageTree(pkg) {
	const srcDist = join(repoRoot, pkg.srcDir, distName);
	const srcSrc = join(repoRoot, pkg.srcDir, srcName);
	const destDist = join(coreRoot, distName, pkg.dest);
	const destSrc = join(coreRoot, srcName, pkg.dest);

	if (!existsSync(srcDist)) {
		throw new Error(
			`Expected built output at ${srcDist}. Run \`pnpm run build:packages\` from the repo root first.`,
		);
	}

	await mkdir(destDist, { recursive: true });
	await cp(srcDist, destDist, { recursive: true, filter: distFilter });

	if (existsSync(srcSrc)) {
		await mkdir(destSrc, { recursive: true });
		await cp(srcSrc, destSrc, { recursive: true, filter: srcFilter });
	}
}

function distFilter(path) {
	const base = path.split(sep).pop();
	if (base === '__tests__') return false;
	if (base.endsWith('.tsbuildinfo')) return false;
	return true;
}

function srcFilter(path) {
	const parts = path.split(sep);
	if (parts.includes('__tests__')) return false;
	return true;
}

async function* walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(fullPath);
		} else if (entry.isFile()) {
			yield fullPath;
		}
	}
}

const specifierRegex = /(['"])@gitlens\/(utils|ipc|git|git-cli|ai|git-github)\/([^'"]+)\1/g;
// Also rewrite backtick-wrapped package mentions (typical in JSDoc) so the published tarball never
// references the internal `@gitlens/*` names. Backticks are required to avoid false positives on
// URLs or other incidental occurrences of the substring.
const docMentionRegex = /`@gitlens\/(utils|ipc|git|git-cli|ai|git-github)`/g;
const publishedName = '@gitkraken/core-gitlens';

async function rewriteSpecifiers() {
	const distRoot = join(coreRoot, distName);
	for await (const file of walk(distRoot)) {
		if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;
		const original = await readFile(file, 'utf8');
		let rewritten = original.replace(specifierRegex, (_match, quote, pkgName, subpath) => {
			const dest = nameToDest[`@gitlens/${pkgName}`];
			const absTarget = join(distRoot, dest, subpath);
			let rel = relative(dirname(file), absTarget).split(sep).join('/');
			if (!rel.startsWith('.')) rel = './' + rel;
			return `${quote}${rel}${quote}`;
		});
		// Rewrite backtick-wrapped mentions in comments to the published package name (preserve backticks).
		rewritten = rewritten.replace(docMentionRegex, (_match, pkgName) => {
			const dest = nameToDest[`@gitlens/${pkgName}`];
			return `\`${publishedName}/${dest}\``;
		});
		if (original !== rewritten) {
			await writeFile(file, rewritten);
		}
	}
}

async function rewriteSrcSpecifiers() {
	const srcRoot = join(coreRoot, srcName);
	if (!existsSync(srcRoot)) return;

	for await (const file of walk(srcRoot)) {
		if (!file.endsWith('.ts')) continue;
		const original = await readFile(file, 'utf8');
		let rewritten = original.replace(specifierRegex, (_match, quote, pkgName, subpath) => {
			const dest = nameToDest[`@gitlens/${pkgName}`];
			const absTarget = join(srcRoot, dest, subpath);
			let rel = relative(dirname(file), absTarget).split(sep).join('/');
			if (!rel.startsWith('.')) rel = './' + rel;
			return `${quote}${rel}${quote}`;
		});
		rewritten = rewritten.replace(docMentionRegex, (_match, pkgName) => {
			const dest = nameToDest[`@gitlens/${pkgName}`];
			return `\`${publishedName}/${dest}\``;
		});
		if (original !== rewritten) {
			await writeFile(file, rewritten);
		}
	}
}

async function rewriteSourceMaps() {
	const distRoot = join(coreRoot, distName);
	const srcRoot = join(coreRoot, srcName);

	for await (const file of walk(distRoot)) {
		if (!file.endsWith('.js.map') && !file.endsWith('.d.ts.map')) continue;

		const destPkg = packageDestForFile(distRoot, file);
		if (!destPkg) continue;

		let map;
		try {
			map = JSON.parse(await readFile(file, 'utf8'));
		} catch {
			continue;
		}
		if (!Array.isArray(map.sources)) continue;

		const srcPkgRoot = join(srcRoot, destPkg);
		const fileDir = dirname(file);

		map.sources = map.sources.map(source => {
			// tsc emits paths relative to the emitted dist file, e.g. "../src/foo.ts"
			// We need them relative to the new file location pointing into packages/core/src/<destPkg>/
			const m = /^\.\.\/src\/(.+)$/.exec(source);
			if (!m) return source;
			const pathWithinSrc = m[1];
			const absTarget = join(srcPkgRoot, pathWithinSrc);
			let rel = relative(fileDir, absTarget).split(sep).join('/');
			if (!rel.startsWith('.')) rel = './' + rel;
			return rel;
		});

		await writeFile(file, JSON.stringify(map));
	}
}

function packageDestForFile(distRoot, file) {
	const rel = relative(distRoot, file).split(sep).join('/');
	// Plus packages live under `plus/<name>/...`
	if (rel.startsWith('plus/')) {
		const second = rel.split('/')[1];
		return `plus/${second}`;
	}
	const first = rel.split('/')[0];
	return first;
}

async function mergeDependencies() {
	const merged = {};
	for (const pkg of packages) {
		const manifest = await readSubPackageJson(pkg);
		for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
			if (internalPackageNames.has(name)) continue;
			if (name in merged && merged[name] !== version) {
				throw new Error(
					`Dependency version conflict on ${name}: ${merged[name]} vs ${version} (from ${pkg.name})`,
				);
			}
			merged[name] = version;
		}
	}
	return sortObjectKeys(merged);
}

async function readSubPackageJson(pkg) {
	return JSON.parse(await readFile(join(repoRoot, pkg.srcDir, 'package.json'), 'utf8'));
}

async function generateExports() {
	const result = { './package.json': './package.json' };

	for (const pkg of packages) {
		const manifest = await readSubPackageJson(pkg);
		for (const [pattern, value] of Object.entries(manifest.exports ?? {})) {
			if (pattern === './package.json') continue;
			const newPattern = rewriteExportPattern(pattern, pkg.dest);
			result[newPattern] = remapExportValue(value, pkg.dest);
		}
	}

	return sortExports(result);
}

function rewriteExportPattern(pattern, destSubpath) {
	if (pattern === '.') return `./${destSubpath}`;
	if (!pattern.startsWith('./')) {
		throw new Error(`Unexpected export pattern: ${pattern}`);
	}
	return `./${destSubpath}/${pattern.slice(2)}`;
}

function remapExportValue(value, destSubpath) {
	if (typeof value === 'string') {
		return remapExportTargetPath(value, destSubpath);
	}
	if (value == null || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, remapExportValue(inner, destSubpath)]));
}

function remapExportTargetPath(path, destSubpath) {
	if (!path.startsWith('./dist/')) return path;
	return `./dist/${destSubpath}/${path.slice('./dist/'.length)}`;
}

async function copyLicenses() {
	await cp(join(repoRoot, 'LICENSE'), join(coreRoot, 'LICENSE'));
	await cp(join(repoRoot, 'LICENSE.plus'), join(coreRoot, 'LICENSE.plus'));
}

async function writeUpdatedPackageJson() {
	const pkgJsonPath = join(coreRoot, 'package.json');
	const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));

	pkgJson.dependencies = await mergeDependencies();
	pkgJson.exports = await generateExports();

	await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, '\t') + '\n');
}

function sortObjectKeys(obj) {
	return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

// `exports` has an ordering convention: specific patterns come before globs, and
// `./package.json` goes first. We sort lexicographically with `./package.json` pinned first,
// which is good enough for Node's resolver.
function sortExports(exports) {
	const entries = Object.entries(exports);
	entries.sort(([a], [b]) => {
		if (a === './package.json') return -1;
		if (b === './package.json') return 1;
		return a.localeCompare(b);
	});
	return Object.fromEntries(entries);
}

await main();
