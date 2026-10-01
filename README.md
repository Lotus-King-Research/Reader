# Reader

[Open the reader](https://reader.padma.io) · [Browser checks](https://github.com/Lotus-King-Research/Reader/actions/workflows/ci.yml)

An English–Tibetan reading room built from [Lukija](https://github.com/mikkokotila/Lukija), with its history preserved. Published manuscripts stay in their source repositories. The reader loads a configured English translation and Tibetan source together; each section has its own language switch. Use the section button, the toolbar, or **T**. Other sections retain their language.

## Publish a text

Edit `public/reader-config.json`, add a work, run `npm run build`, and deploy. The first published work is [Dra Thal Gyur](https://github.com/Lotus-King-Translation/Dra-Thal-Gyur), using its paired Tibetan source and English translation.

```json
{
  "works": [
    {
      "id": "example-text",
      "repository": "Lotus-King-Research/Example-Text",
      "title": "Example text",
      "originalTitle": "དཔེ་ཆ།",
      "englishUrl": "https://github.com/Lotus-King-Research/Example-Text/blob/main/translation/en.md",
      "sourceUrl": "https://github.com/Lotus-King-Research/Example-Text/blob/main/source/bo.md",
      "sourceLanguage": "bo"
    }
  ]
}
```

The repository name and two URLs are required. Other fields are optional. Use public Markdown or UTF-8 text URLs; GitHub blob and raw URLs work. A pair of GitHub tree URLs supports a collection of nested files, matched by their relative filenames. Any `.md`, `.markdown`, or `.txt` filename works. Use distinct IDs when multiple entries use the same repository.

The collection can be searched by title, source title, or repository. Text bodies load only when selected. Public GitHub sources use revision verification, with update checks for the active work every five minutes while visible. The reader discovers work metadata on demand to avoid exhausting GitHub’s anonymous API quota. A newer revision requires **Load latest**; it never replaces a passage mid-read. Public URLs on other hosts require browser CORS access and have no GitHub revision guarantee. Private repositories require downloading the files and opening them locally; credentials are never embedded.

## Align sections

Manuscripts using `schema: paired-text/1` frontmatter are aligned by their shared empty HTML anchors, one passage per ID. Chapter headings remain outside those passages as navigation. IDs are matched exactly; missing anchors never fall back to order. Paired text IDs and edition metadata must agree. Dra Thal Gyur uses this format with 2,660 aligned passages.

For ordinary Markdown, a leading H1 is the work title. Subsequent headings divide the manuscript into sections. The reader first matches identical heading IDs. If both outlines have the same number and heading levels, and stable IDs do not indicate reordered sections, it pairs them by order. The publisher must ensure the sections correspond. For differing outlines or ordering, provide explicit mappings:

```json
"sections": [
  {"english": "opening", "source": "tibetan-opening"},
  {"english": "conclusion", "source": "tibetan-conclusion"}
]
```

Give stable IDs to Markdown headings with HTML such as `<h2 id="opening">The opening</h2>`. Use the original ID in configuration (the reader also accepts its `md-` prefixed form). Explicit maps disable ordinal fallback. Unmatched sections stay English and identify the missing alignment. Introductory text before the first section uses `opening`; avoid using that ID on a heading. A text without headings is treated as one section.

A missing or invalid Tibetan source leaves the English translation readable and displays the failure. Source texts retain their own notes and links. Endnotes for each language remain available whenever a section uses that language. English headings remain the navigation outline in either language. Search includes both languages and reveals the language of the selected result.

## Typography and export

Noto Sans Tibetan Regular is bundled and embedded into the standalone HTML, including offline exports. It is the requested Noto **Sans** Tibetan font from the official Noto archive, not a substituted Serif font. The SIL Open Font License and provenance are in `public/fonts/`.

Local Markdown files and pasted texts stay on the device. **Manuscript & source** provides Markdown download, offline HTML, EPUB, and printing. An offline HTML copy includes both loaded manuscripts and the font; section switches work without network access. EPUB includes the currently visible language of each section, with language tags. Its font choice depends on the reading device; the Tibetan font is not embedded in EPUB. No translation is generated or corrected. The typography specimen is synthetic interface documentation.

Preferences, positions, and bookmarks use browser storage; manuscript bodies are never stored there. Markdown is sanitized before display. Files are limited to 4 MB each. No analytics or account flow is included.

## Development

Node.js 22 or later:

```sh
npm ci
npx playwright install chromium
npm run dev
npm test
```

`public/index.html` contains the application shell. `src/catalog.js`, `src/parallel.js`, and `src/epub.js` are embedded by `scripts/build.mjs`, together with configuration and the Tibetan font. Commit source modules and built HTML together. `npm run serve` provides the local test server.

Browser tests cover desktop and phone layouts, source verification, arbitrary filenames and nested collections, alignment, per-section toggling, failures, language tags, export, notes, and local imports. Test fixtures are synthetic. CI runs browser tests and validates the generated EPUBs using EPUBCheck 5.4.0. Locally, set `EPUBCHECK_JAR` and run `npm run test:epub` to perform the same EPUB validation.

## Cloudflare deployment

The site uses [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) with worker name `padma-reader` and custom domain `reader.padma.io`. Only `public/` is deployed.

```sh
npm ci
npx wrangler login
npm run deploy
```

The configuration declares the [Worker custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Wrangler creates the domain binding and certificate in the account that owns `padma.io`. Use existing authorized authentication or a deployment token; no credential is committed.

For continuous deployment, either connect this repository in Cloudflare Workers Builds (branch `main`, build `npm run build`, deploy `npx wrangler deploy`) or enable the included GitHub Actions deployment job. The latter requires repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and variable `CLOUDFLARE_DEPLOY_ENABLED=true`. Do not copy local OAuth credentials into GitHub. Tests must pass before deployment. The initial CLI deployment does not automatically establish a Git integration.

Lukija's embedded Marked 4.0.19 parser retains its MIT notice. Publishing the reader assigns no license to source manuscripts.
