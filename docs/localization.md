# Localization

GitLens follows VS Code's display language. English is the source language and the fallback for missing translations. There is no separate interface-language preference. The existing date-locale setting still controls date formatting.

## Authoring messages

Extension-host code imports `{ l10n }` from `vscode`. Webviews and reusable browser UI import `* as l10n` from `@vscode/l10n`. Use literal, complete messages and pass changing data as arguments:

```ts
l10n.t('Compare {0} with {1}', leftBranch, rightBranch);
l10n.t({
	message: 'Open {name}',
	args: { name: repository.name },
	comment: ['Open a repository in a new window. The name is supplied by the user.'],
});
```

Do not use a template expression or concatenation as the message key. Do not translate a computed label at the consumer: mark each English message at its definition. Avoid concatenating translated sentence fragments, English plural suffixes, or translated labels into action identifiers. Keep action values independent of labels.

Keep Git syntax, command IDs, settings keys, file paths, branch/ref names, repository content, commit messages, product names, and log/telemetry/protocol values intact. User data belongs in placeholders. Preserve codicon syntax and command URLs. In Lit, interpolate translated text normally; never render translations using `unsafeHTML`. Rich content should retain its existing safe links and markup, with surrounding prose authored as complete meaningful messages.

The Microsoft formatter supports placeholder substitution, not ICU plural syntax. Do not add ICU patterns to these catalogs. Prefer natural count labels that do not require English suffix rules, or explicit complete singular/plural messages. Any additional plural categories need deliberate design when introducing languages that require them.

## Catalogs and checks

- `package.nls.json` contains English manifest text. Continue writing generated contribution labels in English in `contributions.json`; run `pnpm run generate:contributions` to update the manifest and catalog together. Other manifest references and their English catalog entries are maintained together.
- `l10n/bundle.l10n.json` is generated from runtime source, including workspace packages, excluding tests and fixtures. Run `pnpm run generate:l10n` after changing messages. Do not hand-edit this catalog.
- `pnpm run check:l10n` detects stale runtime catalogs, unresolved manifest references, obsolete translations and placeholder mismatches. Partial translations are allowed because VS Code falls back per message. `pnpm run check` includes it.
- `pnpm run test:localization` exercises extraction, validation, browser initialization and the literal-message lint rule.
- `pnpm run generate:l10n:pseudo` creates ignored `qps-ploc` catalogs at the manifest root and in `l10n`. Use Microsoft's Pseudo Language Pack and reload with the pseudo display language to exercise expanded text. These generated files are excluded from VSIX packages.

Production translation files are `package.nls.<locale>.json` at the extension root and `l10n/bundle.l10n.<locale>.json`. Preserve keys and placeholders exactly; translations may reorder or repeat placeholders. Translator comments belong in the English source, and commented runtime messages use the extractor's message/comment key. New language catalogs should receive human review before being advertised as supported languages.

Microsoft's `@vscode/l10n-dev` can export/import XLIFF. After importing, place manifest catalogs at the root and runtime catalogs under `l10n`; its output-directory option does not make this distinction for you. Run the catalog checks before committing.

## Runtime loading

VS Code loads the host's bundle from the manifest's `l10n` directory. The common webview controller embeds that selected bundle as base64 metadata and escapes the document language attribute. Each webpack app entry runs `shared/localization.ts` before loading the app, so module-level labels and custom-element initialization see the correct bundle. This requires no extra RPC handshake, URI fetch or filesystem access and works with remote and browser extension hosts.

Standalone consumers of the reusable graph packages configure `@vscode/l10n` before importing UI modules if they want translated strings. Without configuration the runtime uses the English messages. These packages do not depend on the VS Code extension API.

## Provenance and references

Manifest generator support adapts Keith Daulton's [PR #5125](https://github.com/gitkraken/vscode-gitlens/pull/5125) to the current manifest. The implementation uses [Microsoft's current localization tools](https://github.com/microsoft/vscode-l10n), including the [browser/subprocess runtime](https://github.com/microsoft/vscode-l10n/tree/main/l10n) and [extraction/XLIFF tooling](https://github.com/microsoft/vscode-l10n/tree/main/l10n-dev).
