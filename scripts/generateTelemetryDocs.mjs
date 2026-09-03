// @ts-check
/** @typedef {{ name: string; result: string; hidden: boolean; index?: number }} Prop */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// `typescript-nightly` is the 7.x native compiler; its `unstable/sync` API is the only compiler API it exposes
import { isInterfaceDeclaration, isTypeAliasDeclaration } from 'typescript-nightly/unstable/ast/is';
import { API, SymbolFlags, TypeFlags } from 'typescript-nightly/unstable/sync';
/** @import { SourceFile } from 'typescript-nightly/unstable/ast' */
/** @import { Symbol, Type } from 'typescript-nightly/unstable/sync' */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const filePaths = [
	path.join(__dirname, 'src/telemetry/telemetry.ts'),
	path.join(__dirname, 'src/constants.telemetry.ts'),
];

const interfaceCache = new Map();
const intersectionTypeCache = new Map();
const unionTypeCache = new Map();

/** @type Map<string, string> */
const remappedTypes = new Map([
	['GlCommands', 'string /* GlCommands */'],
	['TrackedUsageKeys', 'string /* TrackedUsageKeys */'],
]);

const api = new API();
const tsconfigPath = path.join(__dirname, 'tsconfig.node.json');
const parsedConfig = api.parseConfigFile(tsconfigPath);
const program = api.createProgram(parsedConfig.fileNames, { compilerOptions: parsedConfig.options });
const project = program.getProject();
const typeChecker = project.checker;

/** @type {{ file: SourceFile, type: Type } | undefined} */
let telemetryContext;
/** @type {{ file: SourceFile, type: Type } | undefined} */
let telemetryEvents;
/** @type {{ file: SourceFile, type: Type } | undefined} */
let telemetryGlobalContext;

for (const filePath of filePaths) {
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Could not find source file: ${filePath}`);
	}

	for (const node of sourceFile.statements) {
		if (!isTypeAliasDeclaration(node) && !isInterfaceDeclaration(node)) continue;

		switch (node.name.text) {
			case 'TelemetryContext':
				telemetryContext = { file: sourceFile, type: typeChecker.getTypeAtLocation(node) };
				break;
			case 'TelemetryEvents':
				telemetryEvents = { file: sourceFile, type: typeChecker.getTypeAtLocation(node) };
				break;
			case 'TelemetryGlobalContext':
				telemetryGlobalContext = { file: sourceFile, type: typeChecker.getTypeAtLocation(node) };
				break;
		}
	}
}

if (!telemetryContext || !telemetryEvents || !telemetryGlobalContext) {
	throw new Error('Could not find the telemetry types');
}

// Generate markdown
let markdown = '# GitLens Telemetry\n\n';
markdown += '> This is a generated file. Do not edit.\n\n';

markdown += '## Global Attributes\n\n';
markdown += '> Global attributes are sent (if available) with every telemetry event\n\n';

markdown += '```typescript\n';

let result = expandType(telemetryContext.file, telemetryContext.type, '', false);
result = result.substring(0, result.lastIndexOf('}')); // Strip trailing `}`
markdown += `${result}`;

result = expandType(telemetryGlobalContext.file, telemetryGlobalContext.type, '', false, 'global.');
result = result.substring(1); // Strip leading `{`
markdown += `${result}\n\`\`\`\n\n`;

markdown += '## Events\n\n';

const properties = typeChecker
	.getPropertiesOfType(telemetryEvents.type)
	.toSorted((a, b) => a.name.localeCompare(b.name));
for (const prop of properties) {
	const propType = typeChecker.getTypeOfSymbolAtLocation(prop, telemetryEvents.file);

	markdown += `### ${prop.name}\n\n`;

	// Add property documentation if available
	const propDocs = getDocComment(prop);
	if (propDocs) {
		markdown += `> ${propDocs.split('\n').join('\n> ')}\n\n`;
	}

	// Check for deprecated tag
	const jsDocTags = getJSDocTags(prop);
	if (jsDocTags.deprecated) {
		markdown += `> **Deprecated:** ${
			jsDocTags.deprecated === true ? 'This property is deprecated.' : jsDocTags.deprecated
		}\n\n`;
	}

	markdown += `${expandType(telemetryEvents.file, propType, '')}\n\n`;
}

const outputPath = path.join(__dirname, 'docs/telemetry-events.md');
fs.writeFileSync(outputPath, markdown);

/** @param {Symbol} symbol */
function getDocComment(symbol) {
	return typeChecker.getDocumentationCommentOfSymbol(symbol).trim();
}

/** @param {Symbol} symbol */
function getJSDocTags(symbol) {
	/** @type {Record<string, string | true>} */
	const tags = {};
	for (const tag of typeChecker.getJsDocTagsOfSymbol(symbol)) {
		tags[tag.name] = tag.text || true;
	}
	return tags;
}

/**
 * @param {SourceFile} file
 * @param {Type} type
 * @param {string} indent
 * @param {boolean} isRoot
 * @param {string} prefix
 * @returns {string}
 */
function expandType(file, type, indent = '', isRoot = true, prefix = '') {
	let result = '';

	const remapped = remappedTypes.get(typeChecker.typeToString(type));
	const symbol = type.getSymbol();
	if (remapped) {
		result = remapped;
	} else if (type.isClassOrInterface() || (symbol && symbol.flags & SymbolFlags.TypeLiteral)) {
		result = interfaceCache.get(type);
		if (result == null) {
			const properties = typeChecker.getPropertiesOfType(type);
			if (!properties?.length) {
				result = '{}';
			} else {
				/** @type {Prop[]} */
				let expandedProps = properties.map(prop => {
					const propType = typeChecker.getTypeOfSymbolAtLocation(prop, file);
					let propString = '';

					const propDocs = getDocComment(prop);
					if (propDocs) {
						// Collapse newlines from multi-line doc comments — the text follows a single
						// `//`, so embedded newlines would leave continuation lines unprefixed
						const text = propDocs.replace(/\s*\n\s*/g, ' ');
						propString += `${indent}  // ${text}\n`;
					}

					const jsDocTags = getJSDocTags(prop);
					if (jsDocTags.deprecated) {
						propString += `${indent}  // @deprecated: ${jsDocTags.deprecated}\n`;
					}

					const name = `${prefix}${prop.name}`;
					const valueType = expandType(file, propType, indent + '  ', false, prefix);
					propString += `${indent}  '${name}': ${valueType}`;

					/** @type {number | undefined} */
					let order = Number(jsDocTags.order);
					if (isNaN(order)) {
						order = undefined;
					}

					return {
						name: name,
						result: propString,
						hidden: !valueType,
						index: order,
					};
				});

				const indexInfos = type.getIndexInfos();
				if (indexInfos.length) {
					expandedProps.push(
						...indexInfos.map(indexInfo => {
							const keyType = typeChecker.typeToString(indexInfo.keyType);
							const name = `${prefix}${keyType.substring(1, keyType.length - 1)}`;
							const valueType = expandType(file, indexInfo.valueType, indent + '  ', false, prefix);

							return {
								name: name,
								result: `${indent}  [\`${name}\`]: ${valueType}`,
								hidden: !valueType,
							};
						}),
					);
				}

				result = `{\n${expandedProps
					.filter(t => !Boolean(t.hidden))
					.sort(sortProps)
					.map(t => t.result)
					.join(',\n')}\n${indent}}`;
			}
			interfaceCache.set(type, result);
		}
	} else if (type.isUnionType()) {
		if (isRoot) {
			return type
				.getTypes()
				.map(t => `\`\`\`typescript\n${expandType(file, t, '', false, prefix)}\n\`\`\``)
				.join('\n\nor\n\n');
		} else {
			result = unionTypeCache.get(type);
			if (result == null) {
				const types = type
					.getTypes()
					.filter(t => !(t.flags & (TypeFlags.Undefined | TypeFlags.Null)))
					.map(t => expandType(file, t, indent, false, prefix))
					.filter(t => Boolean(t))
					.join(' | ')
					.replaceAll(/false \| true/g, 'boolean');
				result = types.includes('\n') ? `(${types})` : types;

				unionTypeCache.set(type, result);
			}
		}
	} else if (type.isIntersectionType()) {
		result = intersectionTypeCache.get(type);
		if (result == null) {
			const mergedProperties = new Map();
			/** @type {Map<string, Prop>} */
			const indexInfos = new Map();
			for (const t of [type, ...type.getTypes()]) {
				for (const prop of typeChecker.getPropertiesOfType(t)) {
					mergedProperties.set(prop.name, prop);
				}

				for (const indexInfo of t.getIndexInfos()) {
					const keyType = typeChecker.typeToString(indexInfo.keyType);
					const name = `${prefix}${keyType.substring(1, keyType.length - 1)}`;
					const valueType = expandType(file, indexInfo.valueType, indent + '  ', false, prefix);
					indexInfos.set(name, {
						name: name,
						result: `${indent}  [\`${name}\`]: ${valueType}`,
						hidden: !valueType,
					});
				}
			}

			if (mergedProperties.size) {
				/** @type {Prop[]} */
				const expandedProps = [...mergedProperties].map(([, prop]) => {
					const propType = typeChecker.getTypeOfSymbolAtLocation(prop, file);
					let propString = '';

					const propDocs = getDocComment(prop);
					if (propDocs) {
						// Collapse newlines from multi-line doc comments — the text follows a single
						// `//`, so embedded newlines would leave continuation lines unprefixed
						const text = propDocs.replace(/\s*\n\s*/g, ' ');
						propString += `${indent}  // ${text}\n`;
					}

					const jsDocTags = getJSDocTags(prop);
					if (jsDocTags.deprecated) {
						propString += `${indent}  // @deprecated: ${jsDocTags.deprecated}\n`;
					}

					const name = `${prefix}${prop.name}`;
					const valueType = expandType(file, propType, indent + '  ', false, prefix);
					propString += `${indent}  '${name}': ${valueType}`;

					/** @type {number | undefined} */
					let order = Number(jsDocTags.order);
					if (isNaN(order)) {
						order = undefined;
					}

					return {
						name: name,
						result: propString,
						hidden: !valueType,
						index: order,
					};
				});

				if (indexInfos.size) {
					expandedProps.push(...indexInfos.values());
				}

				result = `{\n${expandedProps
					.filter(t => !Boolean(t.hidden))
					.sort(sortProps)
					.map(t => t.result)
					.join(',\n')}\n${indent}}`;
			} else {
				const types = type
					.getTypes()
					.map(t => expandType(file, t, indent, false, prefix))
					.join(' & ');
				result = types.includes('\n') ? `(${types})` : types;
			}
			intersectionTypeCache.set(type, result);
		}
	} else if (type.isStringLiteralType()) {
		result = `'${type.value}'`;
	} else if (type.isNumberLiteralType()) {
		result = type.value.toString();
	} else if (symbol && symbol.flags & SymbolFlags.Method) {
		const signatures = type.getCallSignatures();
		if (signatures.length) {
			const params = signatures[0]
				.getParameters()
				.map(
					p =>
						`'${prefix}${p.name}': ${expandType(
							file,
							typeChecker.getTypeOfSymbolAtLocation(p, file),
							indent,
							false,
							prefix,
						)}`,
				)
				.join(', ');
			const returnType = expandType(file, signatures[0].getReturnType(), indent, false, prefix);
			result = `(${params}) => ${returnType}`;
		}
	} else if (type.flags & TypeFlags.Boolean) {
		result = 'boolean';
	} else if (type.flags & (TypeFlags.Never | TypeFlags.Undefined)) {
		return '';
	} else {
		result = typeChecker.typeToString(type);
	}

	if (isRoot && !type.isUnionType()) {
		return `\`\`\`typescript\n${result}\n\`\`\``;
	}
	return result;
}

/**
 * @param {Prop} a
 * @param {Prop} b
 */
function sortProps(a, b) {
	if (a.index !== b.index) {
		if (a.index && b.index) return a.index - b.index;
		if (a.index) return -1;
		if (b.index) return 1;
	}

	return a.name.localeCompare(b.name);
}
