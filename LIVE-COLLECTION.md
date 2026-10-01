# Configured collection

The authoritative work list is `public/reader-config.json`; see [README](README.md) for the schema and alignment rules. Build embeds that configuration for hosted and standalone use. Changes to the work list require a build and deployment; source manuscript changes do not.

On the hosted reader, configured GitHub files come through the same-origin edge API (`/api/v1/file`, `/api/v1/meta`, `/api/v1/tree`) implemented in `worker/`. It serves only files listed in `public/reader-config.json` (or text files inside configured directories), reads GitHub at most once a minute per Cloudflare location, records each file's Git blob SHA-1, and keeps the last verified copy in Workers KV. The reader verifies every body against that revision. When GitHub cannot be reached, the saved copy is served and the reader shows that it may not be the latest version.

Without the edge API, GitHub file pairs use the Contents API for metadata and Git blob SHA-1 verification for downloaded UTF-8 content, and a stale CDN response falls back to the Git blob API. If GitHub limits requests, the raw files are read and marked as not checked against their revision. Directory pairs use a complete recursive Git tree and match relative text paths. Truncated trees fail explicitly. No fixed Chinese works, volume numbers, or `juan` filename convention is required.

An open text remains unchanged until **Load latest** is chosen. English and Tibetan revisions are checked together; locally imported files remain available. Public URLs on other hosts must support CORS and do not provide GitHub revision guarantees.

Stable links use `?work=WORK_ID&file=ENCODED_ENGLISH_PATH#md-SECTION_ID`. IDs should stay unchanged after publication. The collection supports searching its metadata without loading every manuscript.

Never publish credentials in configuration. Nothing requires copying manuscripts into this repository. Offline exports deliberately contain the selected text pair and should be shared only as appropriate for those texts.
