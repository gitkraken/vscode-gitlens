// block-header
export const blockHeaderTemplate = `<tr>
    <td class="{{lineClass}} {{CSSLineClass.INFO}}"></td>
    <td class="{{CSSLineClass.INFO}}">
        <div class="{{contentClass}}">{{#blockHeader}}{{{blockHeader}}}{{/blockHeader}}{{^blockHeader}}&nbsp;{{/blockHeader}}</div>
    </td>
</tr>`;

// line-by-line
export const lineByLineFileTemplate = `<details open id="{{fileHtmlId}}" class="d2h-file-wrapper" data-lang="{{file.language}}">
    <summary class="d2h-file-header">
      <code-icon class="file-icon--open" icon="chevron-down"></code-icon>
      <code-icon class="file-icon--closed" icon="chevron-right"></code-icon>
      {{{filePath}}}
    </summary>
    <div class="d2h-file-diff scrollable">
        <div class="d2h-code-wrapper">
            <table class="d2h-diff-table">
                <tbody class="d2h-diff-tbody">
                {{{diffs}}}
                </tbody>
            </table>
        </div>
    </div>
</details>`;

// side-by-side
export const sideBySideFileTemplate = `<details id="{{fileHtmlId}}" class="d2h-file-wrapper" data-lang="{{file.language}}">
    <summary class="d2h-file-header">
      <code-icon class="file-icon--open" icon="chevron-down"></code-icon>
      <code-icon class="file-icon--closed" icon="chevron-right"></code-icon>
      {{{filePath}}}
    </summary>
    <div class="d2h-files-diff">
        <div class="d2h-file-side-diff">
            <div class="d2h-code-wrapper">
                <table class="d2h-diff-table">
                    <tbody class="d2h-diff-tbody">
                    {{{diffs.left}}}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="d2h-file-side-diff">
            <div class="d2h-code-wrapper">
                <table class="d2h-diff-table">
                    <tbody class="d2h-diff-tbody">
                    {{{diffs.right}}}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</details>`;

// generic-file-path
export const genericFilePathTemplate = `<span class="d2h-file-name-wrapper">
    <span class="d2h-file-name">{{fileDiffName}}</span>
    {{>fileTag}}
</span>
<label class="d2h-file-collapse" hidden>
    <input class="d2h-file-collapse-input" type="checkbox" name="viewed" value="viewed">
    Viewed
</label>`;
