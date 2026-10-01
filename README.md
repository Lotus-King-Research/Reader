# Reader

[Open the reader](https://reader.padma.io) · [Browser checks](https://github.com/Lotus-King-Research/Reader/actions/workflows/ci.yml)

An English–Tibetan reader built from [Lukija](https://github.com/mikkokotila/Lukija), with its history preserved. Published manuscripts stay in their source repositories. The reader loads a configured English translation and Tibetan source together; select a passage, right-click, and choose **Show Tibetan**. Select the Tibetan and choose **Show English** to return. A selection spanning passages switches those passages together. On touch screens, the same menu appears after text selection. Other passages retain their language.

## Publish a text

On a feature branch, edit `public/reader-config.json`, add a work, and run `npm run build`. Open a pull request; merging it after validation publishes the work automatically. The first published work is [Dra Thal Gyur](https://github.com/Lotus-King-Translation/Dra-Thal-Gyur), using its paired Tibetan source and English translation.

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

A work card opens its text directly. Directory collections show available editions in a dropdown on the card. The loading bar reports source transfer and page preparation progress; an already open text resumes without downloading again. The collection can be searched by title, source title, or repository. Text loading and edition discovery happen on demand. Every GitHub text is checked against its Git blob SHA-1 before it is shown, with update checks for the active work every five minutes while visible. A newer revision requires **Load latest**; it never replaces a passage mid-read.

On the hosted reader, published texts come through Reader’s own edge cache, so readers never call GitHub and never spend its request quota. The Worker in `worker/` fetches each configured file from GitHub at most once a minute per Cloudflare location, records its revision, and keeps the last verified copy in Workers KV. If GitHub cannot be reached, that saved copy is shown with a notice and a toolbar badge saying it may not be the latest version, and the time it was last confirmed current; **Check again** retries. Without the edge API (a fork or a local static server), the reader checks GitHub directly; if GitHub limits requests, it reads the raw files and marks them as not checked against their published revision. Public URLs on other hosts require browser CORS access and have no GitHub revision guarantee. Private repositories require downloading the files and opening them locally; credentials are never embedded.

## Align sections

The [paired-text/2 format standard](https://github.com/Lotus-King-Translation/tibetan-text-project-template/blob/f6431c25c7c9fa852c404b8cd3e0e3cdeae1178f/FORMAT.md) defines `paired/source.md` and `paired/translation.md` as canonical content. Each passage starts with a deterministic HTML comment such as `<!-- pair: TEXT-000001 -->`. Shared comments establish identity; empty HTML anchors are optional link targets. Both files must contain each ID exactly once, in the same order. IDs are matched exactly and never sorted numerically or paired by position when identity is missing. Projects may add `<!-- /pair -->` closing markers to distinguish passage boundaries from surrounding chapter headings.

Both files must declare `schema: paired-text/2` and the same `text-id`. The source declares `edition` and `language`; English declares `source-edition`, `translation-edition`, and `language`. English `source-edition` must equal the source `edition`. Optional source `source-edition` must agree with its `edition`, and `paired-edition` must match when supplied. A schema or identity mismatch disables source switching while keeping English readable.

Every source-pair comment declares exactly one `format: prose | verse | h1 | h2 | h3`. The source is authoritative; English inherits the format through the shared ID. Prose flows as body text. Verse preserves each manuscript's authored line breaks without requiring equal line counts. Heading pairs become headings at the declared level in both languages; English wording supplies navigation labels. Chapter headings outside pairs remain navigation wrappers. Dra Thal Gyur's published v2 edition contains 2,667 aligned passages: 48 prose, 2,448 verse, two H1 headings, and 169 H3 headings.

Existing `schema: paired-text/1` manuscripts remain supported through their shared empty HTML anchors. Their text IDs and edition metadata must agree; missing anchors never fall back to order. The reader applies v2 structure only when both manuscripts declare v2.

For ordinary Markdown, a leading H1 is the work title. Subsequent headings divide the manuscript into sections. The reader first matches identical heading IDs. If both outlines have the same number and heading levels, and stable IDs do not indicate reordered sections, it pairs them by order. The publisher must ensure the sections correspond. For differing outlines or ordering, provide explicit mappings:

```json
"sections": [
  {"english": "opening", "source": "tibetan-opening"},
  {"english": "conclusion", "source": "tibetan-conclusion"}
]
```

Give stable IDs to Markdown headings with HTML such as `<h2 id="opening">The opening</h2>`. Use the original ID in configuration (the reader also accepts its `md-` prefixed form). Explicit maps disable ordinal fallback. Unmatched sections stay English; Copy remains available in the selection menu. Introductory text before the first section uses `opening`; avoid using that ID on a heading. A text without headings is treated as one section.

A missing or invalid Tibetan source leaves the English translation readable and displays the failure. Source texts retain their own notes and links. The sticky toolbar’s notes icon shows or hides endnote references and endnotes; they are hidden by default. In paired-text manuscripts, standalone references attach to the preceding passage, legacy note links become optional superscripts, and repeated “Earlier notes” paragraphs are omitted from the reading page. The original Markdown remains unchanged. English heading labels remain the navigation outline in either language. Search includes both languages and reveals the language of the selected result.

## Typography and export

Noto Serif Tibetan Regular 2.103 is bundled and embedded into the standalone HTML, including offline exports. It is the current release of the design previously bundled as Noto Sans Tibetan 1.01, whose shaping drew a dotted circle inside Sanskrit stacks such as the title of Dra Thal Gyur. It is subset to the Tibetan block and compressed as WOFF2. The SIL Open Font License, provenance and the exact subsetting command are in `public/fonts/`.

Local Markdown files and pasted texts stay on the device. **Manuscript & source** provides Markdown download, offline HTML, EPUB, and printing. An offline HTML copy includes both loaded manuscripts and the font; section switches work without network access. EPUB includes the currently visible language of each section, with language tags and relevant endnotes regardless of the on-screen notes toggle. Its font choice depends on the reading device; the Tibetan font is not embedded in EPUB. No translation is generated or corrected. The typography specimen is synthetic interface documentation.

Preferences, positions, and bookmarks use browser storage; manuscript bodies are never stored there. Markdown is sanitized before display. Files are limited to 4 MB each. No analytics or account flow is included. The edge Worker keeps no request logs, and its saved copies contain only the published files listed in the configuration.

## Development

Node.js 22 or later:

```sh
npm ci
npx playwright install chromium
npm run dev
npm test
```

`public/index.html` contains the application shell and styles. The reader application (`src/app.js`) and its engines (`src/catalog.js`, `src/parallel.js`, `src/epub.js`) are embedded by `scripts/build.mjs`, together with configuration and the Tibetan font. Edit the source modules, not their copies inside `public/index.html`, and commit source modules and built HTML together. `npm run dev` runs the reader with the edge Worker and a local KV store (`wrangler dev`); `npm run serve` provides the static test server, without the edge API.

Unit tests (`npm run test:unit`) cover the Markdown compiler’s linear parsing and the edge Worker. Browser tests cover desktop and phone layouts, the edge cache and its saved-copy notice, source verification, arbitrary filenames and nested collections, alignment, selection context menus, inline editions, loading progress, cancellation, failures, language tags, export, notes, and local imports. Test fixtures are synthetic. CI runs browser tests and validates the generated EPUBs using EPUBCheck 5.4.0. Locally, set `EPUBCHECK_JAR` and run `npm run test:epub` to perform the same EPUB validation.

## Contributions and deployment

`main` is protected for everyone, including administrators. Changes must be made on a branch and opened as a pull request. The GitHub Actions `test` check must pass on an up-to-date branch, and review conversations must be resolved before merging. Force pushes and branch deletion are disabled. GitHub does not require a separate approving reviewer. Agents must obtain user approval before merging, as specified in `AGENTS.md`.

The required check runs the desktop and phone browser tests and validates generated EPUBs with EPUBCheck 5.4.0. Never bypass protection or push changes directly to `main`.

Production uses Cloudflare Workers Builds with `Lotus-King-Research/Reader` connected to the existing `padma-reader` Worker at `reader.padma.io`. The connection must use these settings so a merge to `main` automatically builds and deploys production:

- Production branch: `main`
- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production deployments enabled; builds on other branches disabled

Cloudflare installs dependencies from the committed lockfile and manages the deployment credential. GitHub Actions performs validation only; no Cloudflare secret or local OAuth credential is copied into GitHub. There is one production deployment path, through the repository's Cloudflare build connection. Use Cloudflare's build history to inspect deployment status and logs. Routine releases must not be deployed manually from a local checkout.

Cloudflare Workers Static Assets serves `public/`; `wrangler.jsonc` declares the Worker and existing custom domain. Only `/api/*` runs Worker code: the edge cache in `worker/`, which serves the configured manuscripts. The first deploy after this change creates the `READER_CACHE` KV namespace for the saved copies (the build's deployment credential must be allowed to create Workers KV namespaces), and a cron trigger refreshes those copies every 30 minutes so they stay current when nobody is reading. Single files need no GitHub credentials; to raise GitHub’s limit for directory listings, a `GITHUB_TOKEN` secret that can read public repositories can be added to the Worker in the Cloudflare dashboard. Worker observability is disabled, so no request logs are kept. Do not change deployment settings, disconnect the repository, or bypass the build workflow as part of routine feature work.

Lukija's embedded Marked 4.0.19 parser retains its MIT notice. Publishing the reader assigns no license to source manuscripts.
