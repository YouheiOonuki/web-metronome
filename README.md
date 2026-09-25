# 無料オンラインメトロノーム

ブラウザだけで動くメトロノームです。
API を一切使用せず、HTML / CSS / JavaScript の静的サイトとして構築されています。
ホーム画面に追加すれば、オフラインでもアプリのように使えます（PWA）。

公開 URL: **https://yorozu-craft.com/web-metronome/**

## 機能一覧

### テンポ
- **BPM 設定**: 1〜500 BPM。スライダー・数値入力・＋／－ボタン（長押しで連続変更）
- **タップテンポ**: TAP ボタン連打で BPM を計測（直近 8 回の平均。テンポを変えて叩き直すと追従）
- **テンポ表示**: BPM に応じて Andante / Allegro などを表示
- **正確な発音**: Web Audio API の lookahead スケジューラー。Web Worker タイマーでバックグラウンドタブでも途切れにくい

### 拍子・リズム
- **拍子**: 1〜16 拍 × 分母 2/4/8/16。4/4・3/4・6/8 から 5/8・7/8・11/8 などの変則拍子までプリセット収録
- **グルーピング**: `2+2+3` のように入力すると、各グループの頭に中アクセントが付く
- **アクセント**: 拍インジケーターをタップして拍ごとに 強 → 中 → 弱 → 休符 を切替
- **細分化**: なし / 8分 / 3連 / 16分 / シャッフル / 裏拍のみ

### 練習モード
- **テンポアップ**: N 小節ごとに ±X BPM、目標 BPM まで
- **無音小節**: X 小節鳴らして Y 小節無音（体内テンポの確認）

### その他の機能
- **音色・音量**: 電子音 / ウッドブロック / ハイハット。全体音量と細分化の音量を個別調整
- **6種類のテーマ**: 和紙風 / 森 / 藍染 / ダーク / メタル / ネオンサイバー（web-roulette と共通）
- **再生中は画面を消さない**: Screen Wake Lock API（対応ブラウザのみ）
- **キーボード操作**: Space で再生/停止、↑↓ で BPM ±1（Shift で ±10）、T でタップ
- **設定の記憶**: BPM・拍子・アクセントなどを localStorage に保存し、次回起動時に復元

### ブラウザピアノ（`/web-metronome/piano/`、2026-09-25 追加）
- **鍵盤**: 画面の幅に合わせて白鍵 8・15・22・29 本（スマホ横向きで 2 オクターブ＋1、パソコンで 3 オクターブ＋1）。◀ ▶・← → で 1 オクターブずつ動かす（C1〜C8）
- **タップ**: Pointer Events で指ごとに押している鍵を持つので、複数の指で和音。指をすべらせると隣の鍵へ
- **パソコンのキー**: `KeyboardEvent.code`（キーの物理的な位置）で割り当てる。Z 段＝白鍵・A 段＝黒鍵（左はしのドから）、Q 段・数字の段＝1 オクターブ上。JIS と US で印字が違うのは `BracketLeft`（@／[）・`Equal`（^／=）・`BracketRight`（[／]）の 3 つだけで、画面の文字は `navigator.keyboard.getLayoutMap()` か、押された `key` から合わせる
- **音**: 録音した音は使わず Web Audio で合成（ピアノは倍音の PeriodicWave ×2 のうなり、ローパスの動き、2 段の減衰、打鍵のノイズ）。A4 = 440 Hz の 12 平均律。最初の操作の中で AudioContext を作って resume
- **音色**: ピアノ・エレピ・オルガン・オルゴール・シンセ・ストリングス風の 6 つ（すべて合成）。`piano-core.js` の `voiceDesign(midi, timbre)` が倍音・発振器の数（1〜2）・ローパス・音量の形（立ち上がり → 1 段目 → 消える／押している間鳴る）・離したときの消え方を返す。出力の最後にソフトクリップ（0.8 までは素通し）を入れ、10 音の和音を音量最大で鳴らしても 1.0 を超えない（オフラインで書き出して確認）
- **MIDI キーボード**: Web MIDI API。「音色」の中の「MIDI キーボードをつなぐ」を押したときだけ `navigator.requestMIDIAccess({ sysex: false })` を呼ぶ。ノートオン・オフ（ベロシティ 0 のノートオンはオフ）、ベロシティ → 音量（127 で画面の鍵盤と同じ大きさ）、CC64（ダンパーペダル）、CC120・123（全部止める）。16 チャンネルすべてを受け、入力とチャンネルごとに押している鍵を持つ。機器の抜き差しは `statechange` で追う。受けるだけで何も送らない。Safari（Mac・iOS）は非対応（MDN の対応表）で、そのときは案内を出す
- **そのほか**: 音名（ドレミ／CDE／なし）、サステイン（ボタンか Space を押している間）、音量、4 拍のクリック（BPM 30〜240）。設定（音色を含む）は `web-metronome_piano` に保存
- **広告**: 弾く画面（`piano/index.html`）は全画面の楽器なので AdSense の meta だけ。使い方（`piano/guide.html`）は通常の自動広告
- **テスト**: `npm test`（`tests/piano.test.js`。周波数・キーの割り当て・鍵盤の範囲・音色の設計・MIDI メッセージの読み方・設定の正規化・ページの決まり）

### PWA（ホーム画面に追加・オフライン）
- **manifest.webmanifest**: アプリ名・アイコン・表示モード（standalone）
- **sw.js（Service Worker）**: ネットワーク優先でファイルをキャッシュ。オンラインなら常に最新、オフラインならキャッシュで動く
  - yorozu-craft.com の各ツールは同じオリジンでキャッシュ領域を共有するため、キャッシュ名は `web-metronome-` で始め、ほかのツールのキャッシュには触れない
  - スコープは `/web-metronome/` だけなので、トップページやほかのツールには影響しない
  - 新しいファイルを追加したら `sw.js` の `PRECACHE_URLS` にも追加する（オフラインで開けるようにするため）
- **インストールボタン**: インストールできるブラウザでは「設定」に「ホーム画面に追加」を表示

### SEO・AdSense対応
- **SEO最適化**: meta description、Open Graph（共有用画像つき）、Twitter Card、JSON-LD構造化データ（WebApplication + FAQPage）
- **AdSense審査対応**: 使い方ガイド・FAQ、運営者情報・免責事項、プライバシーポリシー、全ページ共通のナビゲーション、sitemap.xml
- **広告**: 全ページの `<head>` の AdSense タグによる自動広告。空の広告枠は置かない
- **アクセス解析**: Cloudflare Web Analytics（Cookie 不使用）を全ページに設置

## ファイル構成

```
web-metronome/
├── index.html              # メインHTML（SEOメタタグ・構造化データ含む）
├── style.css               # テーマ対応スタイルシート
├── main.js                 # アプリケーションロジック
├── sw.js                   # Service Worker（オフライン対応）
├── manifest.webmanifest    # PWA の設定（アプリ名・アイコンなど）
├── guide.html              # 使い方ガイド・よくある質問
├── about.html              # yorozu-craft 共通の運営者情報（../about.html）へ移動する案内ページ
├── privacy-policy.html     # yorozu-craft 共通のプライバシーポリシー（../privacy-policy.html）へ移動する案内ページ
├── favicon.svg             # ファビコン
├── icon-192.png            # アプリアイコン（192x192）
├── icon-512.png            # アプリアイコン（512x512）
├── icon-maskable-512.png   # アプリアイコン（Android の丸・角丸マスク用）
├── apple-touch-icon.png    # iPhone / iPad のホーム画面用アイコン（180x180）
├── og-image.png            # SNS共有用画像（1200x630）
├── piano/                  # ブラウザピアノ（index.html・guide.html・piano-core.js・synth.js・piano.js・piano.css）
├── tests/                  # node --test のテスト（piano.test.js）
├── package.json            # npm test
├── .github/workflows/test.yml
├── sitemap.xml             # サイトマップ
├── .gitignore              # 秘密情報・退避コピーの除外設定
└── README.md               # このファイル
```

## ローカルでの動作確認

```bash
# クローン
git clone https://github.com/YouheiOonuki/web-metronome.git
cd web-metronome

# ローカルサーバー（Service Worker は http://localhost でも動く）
python -m http.server 8000
# → http://localhost:8000 でアクセス
```

> `index.html` をブラウザで直接開いてもメトロノームは動きますが、`file://` では Service Worker（オフライン対応）が動きません。

## 公開 URL と構成

公開 URL: **https://yorozu-craft.com/web-metronome/**

独自ドメイン `yorozu-craft.com` は、ユーザーサイト用リポジトリ `youheioonuki.github.io` に設定しています。
GitHub Pages の仕組みにより、Pages を有効にしたリポジトリは自動で `yorozu-craft.com/<リポジトリ名>/` で配信されます。
このリポジトリ自体には独自ドメインの設定（CNAME）は不要です。

- `robots.txt` は検索エンジンがドメイン直下のものしか読まないため、`youheioonuki.github.io` リポジトリ側で管理し、このツールの `sitemap.xml` をそこに登録しています。
- フッターの「yorozu-craft トップ」は相対パス `../` なので、ドメインが変わっても動きます。
- Search Console に送信するサイトマップ: `https://yorozu-craft.com/web-metronome/sitemap.xml`

### このリポジトリの Pages 設定
1. **Settings** → **Pages** を開く
2. **Source** を `Deploy from a branch`、**Branch** を `main` / `/ (root)` にして **Save**

## 広告について

広告は、全ページの `<head>` に入れた AdSense タグ（`google-adsense-account` のメタタグと `adsbygoogle.js`）による**自動広告**で表示されます。Google が自動で位置を決めるので、空の広告枠は置いていません。

広告の位置を自分で指定したくなった場合は、`index.html` と `guide.html` のフッター内にある次のコメントの位置に、AdSense で作った広告ユニットのコードを入れてください。

```html
<!-- AD_PLACEHOLDER: 広告の位置を指定する場合はここに AdSense の広告ユニットを入れる（今は全ページの <head> のタグによる自動広告） -->
```

## AdSense 審査対策チェックリスト

- [x] プライバシーポリシー・運営者情報・免責事項（yorozu-craft 共通ページ `../privacy-policy.html` / `../about.html`）
- [ ] お問い合わせ窓口（現在は未設置。審査で求められたら追加）
- [x] 全ページ共通のナビゲーション
- [x] 十分なテキストコンテンツ（使い方ガイド + FAQ）
- [x] sitemap.xml（robots.txt はドメイン直下で管理）
- [x] 独自ドメイン（yorozu-craft.com）

## SEO対策チェックリスト

- [x] title / meta description（キーワード最適化済み）
- [x] Open Graph / Twitter Card メタタグ（共有用画像 og-image.png）
- [x] JSON-LD構造化データ（WebApplication + FAQPage）
- [x] canonical URL
- [x] セマンティックHTML（nav, main, section, article, header, footer）
- [x] ARIA属性（aria-label, aria-live, role）
- [x] sitemap.xml（robots.txt はドメイン直下で管理）
- [x] レスポンシブデザイン

## 今後追加予定の機能

- [ ] 複合拍子の BPM 基準切替（6/8 を付点4分 = 60 のように数える）
- [ ] 小節ごとに拍子が変わるシーケンス（例: 7/8 → 4/4 の繰り返し）
- [ ] 設定プリセットの保存（曲ごとに BPM・拍子を登録）
- [ ] スイング率の調整（シャッフルの跳ね具合）
- [ ] カウントイン

## ライセンス

MIT
