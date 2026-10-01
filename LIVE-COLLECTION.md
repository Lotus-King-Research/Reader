# Configured collection

The authoritative work list is `public/reader-config.json`; see [README](README.md) for the schema and alignment rules. Build embeds that configuration for hosted and standalone use. Changes to the work list require a build and deployment; source manuscript changes do not.

GitHub file pairs use the Contents API for metadata and Git blob SHA-1 verification for downloaded UTF-8 content. A stale CDN response falls back to the Git blob API. Directory pairs use a complete recursive Git tree and match relative text paths. Truncated trees fail explicitly. No fixed Chinese works, volume numbers, or `juan` filename convention is required.

An open text remains unchanged until **Load latest** is chosen. English and Tibetan revisions are checked together. API rate limits delay subsequent checks; locally imported files remain available. Public URLs on other hosts must support CORS and do not provide GitHub revision guarantees.

Stable links use `?work=WORK_ID&file=ENCODED_ENGLISH_PATH#md-SECTION_ID`. IDs should stay unchanged after publication. The collection supports searching its metadata without loading every manuscript.

Never publish credentials in configuration. Nothing requires copying manuscripts into this repository. Offline exports deliberately contain the selected text pair and should be shared only as appropriate for those texts.
