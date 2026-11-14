# 字体

- `Corporate-Logo-Bold-ver3.woff2`・`Corporate-Logo-Medium-ver3.woff2`：「コーポレート・ロゴ ver3」（ロゴたいぷ工房、https://logotype.jp/corporate-logo-font-dl.html）。
  SIL Open Font License 1.1（`Corporate-Logo-OFL.txt`）。予約フォント名（Reserved Font Name）の宣言は無い。
- **元の OTF から変えたところ（OFL の Modified Version）：** 異体字の表（cmap format 14、variation selectors）を外して WOFF2 に変換した。
  元の表は並びが崩れていて（2F7B <= 9038）、Chrome の字体の検査（OTS）が字体ごと読み込みを断った。字の形・名前・ほかの表は変えていない。
  変換は fontTools（`cm.tables = [t for t in cm.tables if t.format != 14]; f.flavor = 'woff2'`）。
- Godot（`godot/assets/fonts`）は検査が無いので元の OTF のまま使っている。
