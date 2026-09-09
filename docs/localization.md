# Localization

GitLens follows VS Code's display language. English is the source language and the fallback for missing translations. There is no separate interface-language preference. The existing date-locale setting still controls date formatting.

## Authoring messages

Host-only code imports `{ l10n }` from `vscode`. Webviews and reusable packages import `* as l10n` from `@vscode/l10n`. Use literal, complete messages and pass changing data as arguments:

```ts
l10n.t('Compare {0} with {1}', leftBranch, rightBranch);
l10n.t({
	message: 'Open {name}',
	args: { name: repository.name },
	comment: ['Open a repository in a new window. The name is supplied by the user.'],
});
```

Do not use a template expression or concatenation as the message key. Do not translate a computed label at the consumer: mark each English message at its definition. Avoid concatenating translated sentence fragments, English plural suffixes, or translated labels into action identifiers. Keep action values independent of labels.

Keep Git syntax, command IDs, settings keys, file paths, branch/ref names, repository content, commit messages, product names, and log/telemetry/protocol values intact. User data belongs in placeholders. Preserve codicon syntax and command URLs. In Lit, interpolate translated text normally; never render translations using `unsafeHTML`. Use `localizedContent` from `@gitlens/components/localizedContent.js` with named placeholders holding existing Lit templates for rich links/code. This permits reordering without parsing translations as HTML. Tooltip strings and confirmation messages are plain text; banners and action-chip popovers accept explicit Lit templates for rich content. When a consumer writes a Markdown link title or an HTML attribute, escape the completed translated value for that context. Keep translated suffixes outside formatter token syntax, and use variable-length code fences for raw refs or paths that contain backticks. Preserve canonical diagnostic/model values when the same data also reaches a machine consumer; select localized display messages from semantic metadata at the UI boundary.

### Error messages

`Error.message` is not display text. Git command errors (`GitCommandError` and its subclasses in `@gitlens/git/errors.js`) always carry the English sentence in `message`, so logs, stack traces, telemetry and `String(error)` stay searchable in one language, and expose the translation on `localizedMessage`. Show an error to a user through `getPresentableErrorMessage()` from `src/errors.ts`, which picks the translation for git errors and redacts token details from authentication errors; the `no-raw-error-message` lint rule flags any raw `.message` read in `src/` that is not a log, telemetry, classification or rewrap use (add an `oxlint-disable-next-line` with a reason for the rare legitimate case). Errors thrown by webview RPC service methods are mapped in `proxyServices` so the webview receives the translation. Inside `errors.ts` the message builders take an `l10n` parameter that shadows the import on purpose: the extractor is syntactic and keys off `l10n.t(...)`, so the same builder renders `message` through a plain English formatter and `localizedMessage` through the real bundle without duplicating a single string.

A count message goes through `formatPlural()` from `@gitlens/utils/plural.js`, not a manual `count === 1` fork. The English source itself is a single ICU-style plural block — one `l10n.t()` key, not two:

```ts
formatPlural(l10n.t('{count, plural, one{{count} file changed} other{{count} files changed}}'), { count });
```

`selector` (`count` above) names an argument; `formatPlural` resolves the branch for it with `Intl.PluralRules` for the current UI language — an exact `=N` branch wins, then the CLDR category, then `other` — and substitutes placeholders in the result the same way `l10n.t()` does. A message with a plural block must always be rendered through `formatPlural()`; the `require-format-plural` lint rule flags one passed straight to `l10n.t()`'s arguments instead. A translator working from the English `one`/`other` branches needs nothing further for a two-form language; one who needs more of the CLDR categories — Russian's "few"/"many", Arabic's "zero"/"two", and so on — adds the branches their language needs to the same block. A count message may also need more than one count in one sentence ("`{0} commit behind, {1} commits ahead`"): write it as two blocks, sibling or one nested inside the other's branch — `formatPlural` resolves blocks anywhere in the template, including nested ones. `pnpm run check:l10n` validates every block, in the English source and in translations alike (a required `other` branch, valid branch names, and the same placeholder set on both sides). See `l10n/README.md` for the branch syntax translators write.

## Catalogs and checks

- `package.nls.json` contains English manifest text. Continue writing generated contribution labels in English in `contributions.json`; run `pnpm run generate:contributions` to update the manifest and catalog together. Other manifest references and their English catalog entries are maintained together.
- `l10n/bundle.l10n.json` is generated from runtime source, including workspace packages, excluding tests and fixtures. Run `pnpm run generate:l10n` after changing messages. Do not hand-edit this catalog.
- `pnpm run check:l10n` detects stale runtime catalogs, unresolved manifest references, obsolete translations and placeholder mismatches. Partial translations are allowed because VS Code falls back per message. `pnpm run check` includes it.
- `pnpm run test:localization` exercises extraction, validation, host/browser initialization and the literal-message lint rule.
- `pnpm run test:localization:browser` uses Playwright Chromium to verify translated markup remains text, multiline tooltips/confirmations retain line breaks, and rich links still work. Install its browser with `pnpm exec playwright install chromium` if needed.
- `pnpm run generate:l10n:pseudo` creates ignored `qps-ploc` catalogs at the manifest root and in `l10n`. Use Microsoft's Pseudo Language Pack and reload with the pseudo display language to exercise expanded text. These generated files are excluded from VSIX packages.

Production translation files are `package.nls.<locale>.json` at the extension root and `l10n/bundle.l10n.<locale>.json`. Preserve keys and placeholders exactly; translations may reorder or repeat placeholders. Translator comments belong in the English source, and commented runtime messages use the extractor's message/comment key. New language catalogs should receive human review before being advertised as supported languages.

Microsoft's `@vscode/l10n-dev` can export/import XLIFF. After importing, place manifest catalogs at the root and runtime catalogs under `l10n`; its output-directory option does not make this distinction for you. Run the catalog checks before committing.

## Runtime loading

VS Code loads the host's bundle from the manifest's `l10n` directory. Both host webpack entries initialize `@vscode/l10n` from that native bundle before importing the extension, so shared package labels follow the same language without importing `vscode` into those packages. The common webview controller embeds that selected bundle as base64 metadata and escapes the document language attribute. Each webpack app entry runs `shared/localization.ts` before loading the app, so module-level labels and custom-element initialization see the correct bundle. This requires no extra RPC handshake, URI fetch or filesystem access and works with remote and browser extension hosts.

Standalone consumers of the reusable graph packages configure `@vscode/l10n` before importing UI modules if they want translated strings. Without configuration the runtime uses the English messages. These packages do not depend on the VS Code extension API.

## Provenance and references

Manifest generator support adapts Keith Daulton's [PR #5125](https://github.com/gitkraken/vscode-gitlens/pull/5125) to the current manifest. The implementation uses [Microsoft's current localization tools](https://github.com/microsoft/vscode-l10n), including the [browser/subprocess runtime](https://github.com/microsoft/vscode-l10n/tree/main/l10n) and [extraction/XLIFF tooling](https://github.com/microsoft/vscode-l10n/tree/main/l10n-dev).

The pinned `@vscode/l10n-dev` has a pnpm patch for Unicode escape decoding in both its API and CLI. Upstream 0.0.35 drops the final digit of four-digit escapes (for example, `\u2022`) and finds the wrong closing brace for code-point escapes after placeholders. Extraction regression tests compare the resulting keys with JavaScript runtime strings. Keep the patch until a tested upstream release fixes both cases.
