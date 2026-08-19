# Twemoji Sticker Editor

Twitter/Twemoji風のスタンプを画像に重ねる、GitHub Pages向けの静的Webアプリです。

## 使い方

1. `index.html` をブラウザで開きます。
2. 画像を読み込みます。
3. 左側のカテゴリからTwemojiスタンプを選んで追加します。Unicode 13.0に含まれる3,295種類のTwemojiを利用でき、直近で使ったスタンプは「最近」に保存され、再読み込み後も利用できます。
4. キャンバス上でスタンプ本体をドラッグして移動します。
5. 選択枠の丸ハンドルで回転、角ハンドルでサイズを調整します。
6. `PNGを書き出す` で保存します。

## GitHub Pages

公開版: https://aoi2004.github.io/twemoji-sticker-editor/

リポジトリ: https://github.com/Aoi2004/twemoji-sticker-editor

ビルドは不要です。

## プライバシーと通信

選択した画像の読み込み、スタンプ合成、PNG書き出し、クリップボードへの画像コピーと画像貼り付けはすべてブラウザ内で行われ、画像ファイルはアプリのサーバーへ送信されません。アプリ本体はGitHub Pagesから配信され、Twemoji SVGは初回表示時にjsDelivrから取得されます。取得済みのアプリ本体とスタンプはService Workerでキャッシュされます。

## Twemoji

スタンプ画像は jsDelivr 経由で `twitter/twemoji@14.0.3` のSVGアセットを利用します。絵文字一覧はアプリに同梱し、実際のSVGは画面に表示する分だけ遅延読み込みします。最近使ったスタンプの一覧はブラウザのローカルストレージに保存されます。ライセンスとクレジットは [LICENSES.md](./LICENSES.md) を参照してください。
