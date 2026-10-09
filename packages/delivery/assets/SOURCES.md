# Embedded report fonts

Noto Sans Regular is distributed unmodified under SIL Open Font License 1.1 in `Noto-OFL.txt`. Noto Sans Bengali is a static regular instance of the current Google Fonts variable font, licensed under the included `NotoSansBengali-OFL.txt`. PDFKit shapes complete text runs, preserves complex-script glyph positions and embeds font subsets. No external font request is made when reading a report.

| File                | Source                                                                                                     | SHA-256                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| NotoSans.ttf        | https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf       | b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5 |
| Bengali source      | https://raw.githubusercontent.com/google/fonts/main/ofl/notosansbengali/NotoSansBengali%5Bwdth,wght%5D.ttf | dcd42978094e584a849c84a51450eeac40c8826057d566ea6d4b9627a403a05a |
| NotoSansBengali.ttf | Static regular instance described below                                                                    | 1e9e00dd135c770ec3428e6791893a2a14f9c923615e708c2bb8f5e40a965e9e |

The Bengali source is instantiated using FontTools 4.61.1, `instantiateVariableFont(font, {'wght': 400, 'wdth': 100}, inplace=False)`. Before saving, set `static.recalcTimestamp=False` and preserve `static['head'].modified=font['head'].modified`. This makes the static artifact reproducible from the pinned source bytes without a runtime Python dependency. The font license declares no reserved font name.

The renderer checks each code point. Unsupported glyphs return an explicit PDF error; the complete UTF-8 CSV remains available. PDFKit wraps and paginates shaped text. The release check renders English, Spanish and Bengali paragraphs and inspects the resulting PDF, rather than treating a PDF header as sufficient visual evidence.
