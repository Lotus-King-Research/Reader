# Noto Serif Tibetan

`NotoSerifTibetan-Regular.woff2` is built from the official Noto Serif Tibetan 2.103 release:
https://github.com/notofonts/tibetan/releases/download/NotoSerifTibetan-v2.103/NotoSerifTibetan-v2.103.zip
(SHA-256 `4fba4a43cd61e68bc5b3a496f708ebce2c1937df02f2c8e81c4272b2b060a896`).

The source file is `NotoSerifTibetan/unhinted/ttf/NotoSerifTibetan-Regular.ttf`
(SHA-256 `7292b2c76cf5c9b81e5362d88e0cb0a16b9d92827f86f945203014b049fd2fc5`), subset with
fontTools 4.66.1 to the Tibetan block and the characters Tibetan shaping needs, keeping every
OpenType layout feature:

```sh
pyftsubset NotoSerifTibetan-Regular.ttf --unicodes="U+0020,U+00A0,U+0F00-0FFF,U+200B-200D,U+25CC" \
  --layout-features='*' --name-IDs='*' --name-languages='*' --notdef-outline \
  --flavor=woff2 --output-file=NotoSerifTibetan-Regular.woff2
```

Copyright and license are preserved in `OFL.txt` (SIL Open Font License 1.1). `scripts/build.mjs`
embeds the font in the generated reader HTML, so offline copies carry it too.

Noto Serif Tibetan is the current name of the design earlier published as Noto Sans Tibetan; the
1.01 release previously bundled here drew a dotted circle inside Sanskrit stacks such as ཏྞཱ.
