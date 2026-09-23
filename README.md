# Web Metronome

ブラウザで動く軽量メトロノームです。
HTML / CSS / JavaScript のみで構築されており、外部 API・サーバー不要。
GitHub Pages でそのまま公開できます。

---

## 機能一覧

| 機能 | 説明 |
|------|------|
| BPM 設定 | 1〜500 BPM。スライダー・数値入力・増減ボタンで調整可能 |
| 長押し調整 | ＋／－ボタン長押しで連続変更 |
| 再生 / 停止 | Web Audio API の lookahead スケジューラー。Web Worker タイマーでバックグラウンドタブでも途切れにくい |
| 拍子 | 1〜16 拍 × 分母 2/4/8/16。4/4・3/4・6/8 から 5/8・7/8・11/8 などの変則拍子までプリセット収録 |
| グルーピング | `2+2+3` のように入力すると、各グループの頭に中アクセントが付く（変則拍子のまとまりを表現） |
| アクセント | 拍インジケーターをタップして拍ごとに 強 → 中 → 弱 → 休符 を切替 |
| 細分化 | なし / 8分 / 3連 / 16分 / シャッフル / 裏拍のみ |
| 音色・音量 | 電子音・ウッドブロック・ハイハット。全体音量と細分化の音量を個別調整 |
| 練習モード | テンポアップ（N 小節ごとに ±X BPM、目標まで）、無音小節（X 小節鳴らして Y 小節無音） |
| タップテンポ | TAP ボタン連打で BPM を自動計測（直近 8 回の平均。テンポを変えて叩き直すと追従） |
| キーボード操作 | Space: 再生/停止、↑↓: BPM ±1（Shift で ±10）、T: タップ |
| 設定の記憶 | BPM・拍子・アクセント等を localStorage に保存し、次回起動時に復元 |
| ビジュアル | 拍インジケーターと BPM 数字が音に合わせて点灯（強拍は色が変わる） |
| テンポ表示 | BPM に応じて Andante / Allegro などを表示 |
| ダークテーマ | 目に優しいダーク UI |
| レスポンシブ | スマホ・タブレット・PC 対応 |
| 広告枠 | Google AdSense 用プレースホルダー済み |

---

## ローカルでの動作確認

### 方法 1: ブラウザで直接開く

```
index.html をダブルクリックしてブラウザで開くだけ
```

> Web Audio API は `file://` でも動作しますが、一部ブラウザで制限がある場合があります。

### 方法 2: ローカルサーバーを起動（推奨）

**Python を使う場合（Python 3）**
```bash
cd web-metronome
python -m http.server 8080
# → http://localhost:8080 でアクセス
```

**Node.js を使う場合**
```bash
npx serve .
```

**VS Code の場合**
Live Server 拡張機能を使うと `index.html` を右クリック → 「Open with Live Server」で起動できます。

---

## GitHub Pages での公開手順

### パターン A: `main` ブランチのルートを公開

1. GitHub に新規リポジトリを作成
2. このフォルダの内容をプッシュ
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USER/web-metronome.git
   git push -u origin main
   ```
3. GitHub リポジトリ → **Settings** → **Pages**
4. Source を `main` ブランチ・`/ (root)` に設定して **Save**
5. 数分後に `https://YOUR_USER.github.io/web-metronome/` で公開

### パターン B: `docs` フォルダを公開

1. プロジェクトのファイルをすべて `docs/` フォルダに移動
2. プッシュ後、Pages 設定で Source を `main` ブランチ・`/docs` に設定

---

## 広告枠（Google AdSense）の設定方法

`index.html` の末尾付近に以下のプレースホルダーがあります：

```html
<!-- AD_PLACEHOLDER: Google AdSense code will be inserted here -->
```

ここに AdSense の自動広告タグ、またはカスタム広告ユニットのコードを貼り付けるだけで広告が表示されます。

**例（自動広告の場合）:**
```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX"
     crossorigin="anonymous"></script>
```

広告枠 `.ad-area` は CSS で適切な余白を持たせており、UI を崩しません。

---

## 今後追加予定の機能

- [ ] PWA 対応（オフラインで動作、ホーム画面追加）
- [ ] 複合拍子の BPM 基準切替（6/8 を付点4分 = 60 のように数える）
- [ ] 小節ごとに拍子が変わるシーケンス（例: 7/8 → 4/4 の繰り返し）
- [ ] 設定プリセットの保存（曲ごとに BPM・拍子を登録）
- [ ] スイング率の調整（シャッフルの跳ね具合）
- [ ] カウントイン

---

## ライセンス

MIT
