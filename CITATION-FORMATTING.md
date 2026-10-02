# Citation-aware reading

Reader distinguishes the main text from passages it quotes. The attribution remains outside the quotation, and only the quoted words occupy the inset reading layer. All wording, quotation marks, links, emphasis, and note references remain in source order. The original Markdown is not edited.

## Plain Markdown, automatically separated

In this structural example every sentence is a placeholder, not source text:

```markdown
Root text before. The teacher says: “The quoted words stand here.” Root text after.
```

The reader displays the first sentence at the normal reading measure, gives `The teacher says:` its own attribution line, places the quotation in an inset block marked **Cited passage**, and returns to the normal measure for the final sentence. The opening and closing quotation marks are retained.

Recognition uses reporting cues such as `says`, `writes`, `states`, `曰`, and `云`, together with balanced quotation marks. It supports curly and straight English quotation marks, single quotation marks, Chinese corner marks, and nested marks. A quotation can span consecutive paragraphs; a heading, list, table, image-only paragraph, or other structural boundary ends that search. Immediate footnote references stay with the quotation.

Substantial standalone quotations without an attribution receive **Quoted passage**, not an invented source name. Ordinary inline quoted terms are not promoted merely because they have quotation marks. The attribution is taken from the text; the reader does not verify it against external sources.

## An explicit boundary is always supported

A standard Markdown blockquote makes the quotation boundary explicit:

```markdown
The teacher says:

> “The quoted words stand here.”

Root text resumes here.
```

An attribution can also be placed on the first line inside the blockquote. Nested Markdown blockquotes remain nested. Markdown alerts such as `[!NOTE]` keep their existing callout presentation.

Explicit `>` formatting is the dependable option for ambiguous, unfinished, or unusually structured quotations. Automatic recognition deliberately does not infer the end of an unclosed quotation, classify unquoted paraphrases, or recognize every possible attribution formula. It does not infer new citation blocks inside tables, lists, existing blockquotes, footnotes, annotations, or elements marked `class="root-text"`. Extremely dense or deeply nested input is left without automatic separation rather than subjected to unbounded inference.

To opt a passage out of inference in an authored HTML block:

```html
<div class="root-text">

This text remains in its authored paragraph layout.

</div>
```

## Reader control and source fidelity

**Reading settings → Separate cited passages** is enabled by default. Turn it off to restore ordinary paragraph layout for automatically recognized quotations. Explicit Markdown blockquotes remain styled as quotations. This setting is saved on the device when browser storage is available. Changing it does not download the text again.

**Download & export** shows the unchanged source, and **Save Markdown** saves it. Offline reading copies include the new citation renderer. Search indexes the attribution and quoted text but excludes the added interface labels. Footnote popups and backlinks are retained. Long quotation blocks can flow across printed pages.

The typography specimen (**Appearance → See the typography specimen**) includes a clearly labelled example. Its text is interface copy, not a translation.

## Scope

This is conservative typographic recognition, not textual scholarship or a guarantee of semantic classification. The reporting cues recognised today are English and Chinese; Tibetan quotations are best marked explicitly with `>`.
