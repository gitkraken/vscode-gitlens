// @ts-check
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const filePaths = [
	path.join(__dirname, 'src/telemetry/telemetry.ts'),
	path.join(__dirname, 'src/constants.telemetry.ts'),
];

const program = ts.createProgram(filePaths, {});
const typeChecker = program.getTypeChecker();

/** @type {{ file: ts.SourceFile, type: ts.Type } | undefined} */
let telemetryContext;
/** @type {{ file: ts.SourceFile, type: ts.Type } | undefined} */
let telemetryEvents;
/** @type {{ file: ts.SourceFile, type: ts.Type } | undefined} */
let telemetryGlobalContext;

for (const filePath of filePaths) {
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Could not find source file: ${filePath}`);
	}

	// Find the types
	ts.forEachChild(sourceFile, node => {
		if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
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
	});
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

const properties = typeChecker.getPropertiesOfType(telemetryEvents.type).sort((a, b) => a.name.localeCompare(b.name));
for (const prop of properties) {
	const propType = typeChecker.getTypeOfSymbolAtLocation(prop, telemetryEvents.file);

	markdown += `### ${prop.name}\n\n`;

	// Add property documentation if available
	const propDocs = prop.getDocumentationComment(typeChecker);
	if (propDocs.length > 0) {
		markdown += `> ${propDocs.map(doc => doc.text).join('\n> ')}\n\n`;
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

/**
 * @param {ts.SourceFile} file
 * @param {ts.Type} type
 * @param {string} indent
 * @param {boolean} isRoot
 * @param {string} prefix
 */
function expandType(file, type, indent = '', isRoot = true, prefix = '') {
	let result = '';

	if (type.isClassOrInterface() || (type.symbol && type.symbol.flags & ts.SymbolFlags.TypeLiteral)) {
		const properties = typeChecker.getPropertiesOfType(type);
		if (!properties?.length) {
			result = '{}';
		} else {
			let expandedProps = properties.map(prop => {
				const propType = typeChecker.getTypeOfSymbolAtLocation(prop, file);
				const jsDocTags = getJSDocTags(prop);
				let propString = '';
				if (jsDocTags.deprecated) {
					propString += `${indent}  // @deprecated: ${jsDocTags.deprecated}\n`;
				}

				const valueType = expandType(file, propType, indent + '  ', false, prefix);
				if (!valueType) return '';

				propString += `${indent}  '${prefix}${prop.name}': ${valueType}`;
				return propString;
			});

			const indexInfos = typeChecker.getIndexInfosOfType(type);
			if (indexInfos.length) {
				expandedProps.push(
					...indexInfos.map(indexInfo => {
						let keyType = typeChecker.typeToString(indexInfo.keyType);
						if (prefix) {
							keyType = `\`${prefix}${keyType.substring(1)}`;
						}
						const valueType = expandType(file, indexInfo.type, indent + '  ', false, prefix);
						if (!valueType) return '';

						return `${indent}  [${keyType}]: ${valueType}`;
					}),
				);
			}

			result = `{\n${expandedProps
				.filter(t => Boolean(t))
				.sort(sortProps)
				.join(',\n')}\n${indent}}`;
		}
	} else if (type.isUnion()) {
		if (isRoot) {
			return type.types
				.map(t => `\`\`\`typescript\n${expandType(file, t, '', false, prefix)}\n\`\`\``)
				.join('\n\nor\n\n');
		} else {
			const types = type.types
				.map(t => expandType(file, t, indent, false, prefix))
				.filter(t => Boolean(t))
				.join(' | ')
				.replaceAll(/false \| true/g, 'boolean');
			result = types.includes('\n') ? `(${types})` : types;
		}
	} else if (type.isIntersection()) {
		const mergedProperties = new Map();
		const indexInfos = new Set();
		for (const t of type.types) {
			if (t.symbol && t.symbol.flags & ts.SymbolFlags.TypeLiteral) {
				for (const prop of typeChecker.getPropertiesOfType(t)) {
					mergedProperties.set(prop.name, prop);
				}

				for (const indexInfo of typeChecker.getIndexInfosOfType(t)) {
					let keyType = typeChecker.typeToString(indexInfo.keyType);
					if (prefix) {
						keyType = `\`${prefix}${keyType.substring(1)}`;
					}
					const valueType = expandType(file, indexInfo.type, indent + '  ', false, prefix);
					if (!valueType) continue;

					indexInfos.add(`${indent}  [${keyType}]: ${valueType}`);
				}
			}
		}

		if (mergedProperties.size) {
			const expandedProps = [...mergedProperties].map(([name, prop]) => {
				const propType = typeChecker.getTypeOfSymbolAtLocation(prop, file);
				const jsDocTags = getJSDocTags(prop);
				let propString = '';
				if (jsDocTags.deprecated) {
					propString += `${indent}  // @deprecated: ${jsDocTags.deprecated}\n`;
				}

				const valueType = expandType(file, propType, indent + '  ', false, prefix);
				if (!valueType) return '';

				propString += `${indent}  '${prefix}${name}': ${valueType}`;
				return propString;
			});

			if (indexInfos.size) {
				expandedProps.push(...indexInfos.keys());
			}

			result = `{\n${expandedProps
				.filter(t => Boolean(t))
				.sort(sortProps)
				.join(',\n')}\n${indent}}`;
		} else {
			const types = type.types.map(t => expandType(file, t, indent, false, prefix)).join(' & ');
			result = types.includes('\n') ? `(${types})` : types;
		}
	} else if (type.isStringLiteral()) {
		result = `'${type.value}'`;
	} else if (type.isNumberLiteral()) {
		result = type.value.toString();
	} else if (type.symbol && type.symbol.flags & ts.SymbolFlags.Method) {
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
	} else if (type.flags & ts.TypeFlags.Boolean) {
		result = 'boolean';
	} else if (type.flags & ts.TypeFlags.Never) {
		return '';
	} else {
		result = typeChecker.typeToString(type);
	}

	if (isRoot && !type.isUnion()) {
		return `\`\`\`typescript\n${result}\n\`\`\``;
	}
	return result;
}

function getJSDocTags(symbol) {
	const tags = {};
	const jsDocTags = symbol.getJsDocTags();
	for (const tag of jsDocTags) {
		tags[tag.name] = tag.text ? tag.text.map(t => t.text).join(' ') : true;
	}
	return tags;
}

function sortProps(a, b) {
	const propRegex = /\[?[`'](.*?)[`']\]?:/;

	const matchA = propRegex.exec(a);
	const matchB = propRegex.exec(b);
	if (matchA && matchB) {
		return matchA[1].localeCompare(matchB[1]);
	}

	debugger;
	console.warn('Unable to sort properties', a, b);
	return a.localeCompare(b);
}
