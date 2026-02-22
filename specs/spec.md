# minico 詳細設計 v0.3.1
**codex app-server 統合（同梱なし） / ChatGPT managed OAuth only / minico 設定ミニマム**

- Status: Approved ✅ (2026-02-22)
- 対象: V0 実装に入れる粒度
- 重要方針（再掲）:
  - minico は `codex app-server` を利用（OpenAI/ChatGPT への直接 HTTP 無し）
  - 認証は app-server の **ChatGPT managed OAuth** のみ
  - **APIキー利用は今後も不採用**（app-server が対応していても minico は使わない）
  - 承認ルール/権限判断は Codex 側設定に寄せ、minico は **承認UI + decision 応答のみ**
  - `config.toml` は minico が生成・編集しない

---

## 1. 用語

- **app-server**: `codex app-server`。Codex が rich UI 連携のために提供する JSON-RPC サーバ。
- **Thread**: 会話（スレッド）。
- **Turn**: 1回のユーザー入力から終端までの処理単位。
- **Item**: Turn 内のイベント要素（ユーザー入力、エージェント出力、コマンド、ファイル変更など）。

---

## 2. 依存関係 / 前提

### 2.1 必須依存
- ローカルに Codex がインストールされ、`codex app-server` を起動できること

### 2.2 参照仕様（実装時の“真実”）
- app-server は JSON-RPC 2.0（wire では `jsonrpc:"2.0"` を省略する運用）
- stdio(JSONL) がデフォルト transport
- initialize → initialized のハンドシェイクが必須
- server-initiated request（承認など）が来るので、クライアントは **request を受けて response を返す**実装が必要
- 過負荷時は JSON-RPC error `-32001` が返り得る（リトライ）

> 注意: app-server はバージョンで仕様が動く可能性があるため、型生成（JSON schema/TS schema）をビルドに組み込むのが安全。

---

## 3. アーキテクチャ（モジュール）

```
UI
 ├─ ChatView（スレッド/ターン表示）
 ├─ ApprovalDialog（コマンド/ファイル差分）
 ├─ LoginView（authUrl を開く）
 └─ SettingsView（homeIsolation / window）
Core
 ├─ AppServerProcess（spawn + lifecycle）
 ├─ RpcClient（stdio JSONL / request-response / notify / server request）
 ├─ SessionStore（選択中 threadId、UI状態）
 ├─ CodexFacade（account/thread/turn API を型付きでラップ）
 └─ WindowState（位置サイズの保存・復元）
Storage
 └─ MinicoConfig（JSON/TOML、ミニマム）
```

---

## 4. app-server 起動・接続方式（V0）

### 4.1 V0は spawn を既定（同梱なし）

- minico は app-server を同梱しない
- 既定では **PATH 上の `codex`** を解決して `codex app-server` を child process として起動する
- 例外として `codex.path` が設定されている場合は、そのパスを優先して起動する
- stdin に request を書き込み、stdout から JSONL を読み取る
- stderr はログとして別ストリームで取り扱う（任意でファイル保存）

> “connect（既存 app-server へ接続）” は V0では実装しない（シンプル優先）。


### 4.1.1 `codex` 実行ファイルの解決（`codex.path`）

起動時の解決順序:

1. `codex.path` が **設定されている**場合:
   - そのパスを実行対象とする
   - 事前にファイル存在・実行可能性をチェックする（失敗時は UI でパス指定の誤りを案内）
2. `codex.path` が **未設定/null** の場合:
   - PATH から `codex` を探索する（OS 標準の探索ロジックに準拠）
   - 見つからなければ「Codex のインストール」または「`codex.path` の設定」を案内する

> ユーザーは引数を指定できない。minico が固定で `app-server` を付与して起動する。

### 4.2 環境変数
- `CODEX_HOME`（任意）
  - `homeIsolation=false`（デフォルト）: **未設定**
  - `homeIsolation=true` : `CODEX_HOME=$HOME/.minico/codex/`
- `RUST_LOG` / `LOG_FORMAT` はデバッグ用（ユーザー設定に露出しない）

### 4.3 `CODEX_HOME` ディレクトリの扱い
- `homeIsolation=true` のとき:
  - `~/.minico/codex/` ディレクトリが無ければ作成してよい（mkdir）
  - **ただし `config.toml` は作らない**
- `homeIsolation=false` のとき:
  - 何もしない（Codex のデフォルトに任せる）

---

## 5. JSON-RPC クライアント設計

### 5.1 メッセージ種別
- **request**: `{ "id": number, "method": string, "params"?: any }`
- **response**: `{ "id": number, "result"?: any, "error"?: { code, message, data? } }`
- **notification**: `{ "method": string, "params"?: any }`
- **server-initiated request**: app-server → minico にも request が来る（承認など）

### 5.2 相関（id 管理）
- クライアント発 request の `id` は単調増加
- server-initiated request は server が `id` を振る
  - 受け取ったら必ず response を返す（UIで待ってもOKだが、無視は不可）

### 5.3 I/O とスレッドモデル（例）
- 読み取り: `stdout` を 1行ずつ読み、JSON parse → Dispatcher
- 書き込み: `stdin` に JSON を 1行で write + flush
- 共有状態:
  - pending map: `id -> oneshot sender`
  - notifications / server requests は channel 経由で UI/Core に配送

### 5.4 Backpressure（`-32001`）の扱い
- `error.code == -32001` の場合は retryable とみなし指数バックオフ
  - 例: 200ms → 400ms → 800ms …（最大 5回）
- retry してもダメなら UI に「混雑」表示

---

## 6. initialize ハンドシェイク

### 6.1 フロー
1. transport 接続（spawn 完了）
2. `initialize` request を送る（clientInfo を含める）
3. response を待つ
4. `initialized` notification を送る
5. 以後の request を許可

### 6.2 clientInfo
- `clientInfo.name = "minico"`
- `clientInfo.title = "minico"`
- `clientInfo.version = <app version>`

> `clientInfo.name` はコンプライアンスログ識別に使われ得るので固定文字列にする。

---

## 7. 認証（ChatGPT managed OAuth only）

### 7.1 起動時チェック
- `account/read { refreshToken: false }` を実行
- 結果に応じて UI を分岐:
  - `account == null` or `authMode == null` かつ `requiresOpenaiAuth == true` → ログインが必要
  - `authMode == "chatgpt"` → OK
  - `authMode == "apikey"` → **サポート外**（後述）

### 7.2 ChatGPT ログイン開始
- `account/login/start { type: "chatgpt" }`
- response の `authUrl` を OS ブラウザで開く
- `account/login/completed` notify（success=true）と `account/updated` notify（authMode=chatgpt）を待つ

### 7.3 APIキー認証検出時の挙動（今後も固定）
- `authMode == "apikey"` を検出したら:
  - UI: 「APIキー認証はサポートしません。ログアウトして ChatGPT でログインしてください」
  - ボタン: `account/logout`（成功したら 7.2へ）

> homeIsolation=false で `~/.codex` を共有する場合、ユーザーが CLI で APIキー認証を使っている可能性があるため、このガードは必須。

---

## 8. Thread / Turn / Item の扱い

### 8.1 スレッドの生成
- 新規:
  - `thread/start` を呼ぶ
  - params は原則 “最小” にする（モデル/承認/サンドボックスは Codex 設定に寄せる）
  - `cwd` は必須（V0方針）
    - デフォルトは `~/.minico/workspace`（空ディレクトリ）を用意してそれを使う
    - ユーザーが明示的にワークスペースを選んだら、そのパスを使う
- 再開:
  - `thread/resume { threadId }`

### 8.2 履歴の表示（minico と codex の論理分離）
- `thread/list` を呼ぶ際、既定で `sourceKinds: ["appServer"]` を指定する
  - これで CLI/IDE のスレッドが UI 上混ざりにくい
- homeIsolation=true の場合は、物理的に履歴も分離される

### 8.3 ターンの開始（ユーザー入力）
- `turn/start { threadId, input: [{type:"text", text:"..."}], cwd }`
- 通知（notification）を購読して UI を更新:
  - `turn/started`
  - `item/started`
  - `item/agentMessage/delta` など（テキストを逐次表示）
  - `item/completed`
  - `turn/completed`

### 8.4 キャンセル
- `turn/interrupt { threadId, turnId }`

---

## 9. 承認フロー（Codex側判定 / minicoはUI + decision応答のみ）

### 9.1 コマンド実行の承認
- `item/commandExecution/requestApproval` が server-initiated request として届く
- UI:
  - 提案コマンド、cwd、理由（reason）、推奨アクション等を表示
  - ボタン: Accept / Accept for session / Decline / Cancel
- response:
  - decision を返す（スキーマは app-server の JSON schema に従う）
  - 受理後、最終結果は `item/completed` を正とする

### 9.2 ファイル変更の承認
- `item/fileChange/requestApproval` が server-initiated request として届く
- UI:
  - 変更対象ファイル、diff（`item/started` で出る changes）を表示
  - ボタン: Accept / Accept for session / Decline / Cancel
- response:
  - decision を返す
  - 最終結果は `item/completed` を正とする（失敗/拒否もここで確定）

### 9.3 minicoが「自動承認」しないルール
- どの decision もユーザー操作無しに返してはいけない
- 承認 UI が表示できない状態（例: バックグラウンド）では:
  - Turn を interrupt するか
  - もしくは Cancel を返す（UI方針で一貫させる）

---

## 10. minico 設定（MinicoConfig）

### 10.1 置き場所
- 例: `$HOME/.minico/config.json`（OSごとの standard path は実装側で決定）

### 10.2 スキーマ（案 / V0）
```json5
{
  "schema_version": 1,
  "codex": {
    // 未指定/null の場合、PATH 上の `codex` を使用する
    // 例: "/usr/local/bin/codex" / "C:\\Program Files\\Codex\\codex.exe"
    "path": null,

    // 既定OFF。ON の場合、app-server 起動時に `CODEX_HOME=$HOME/.minico/codex/` を注入する（パスは固定）
    "homeIsolation": false
  },
  "window": {
    "placement": {
      "x": 100,
      "y": 80,
      "width": 980,
      "height": 720,
      "maximized": false
    }
  }
}
```

### 10.3 マイグレーション
- `schema_version` による上方互換
- 未知フィールドは無視（将来拡張用）

---

## 11. Window placement 保存・復元（DPI/座標崩れ対策）

> 目的: “保存した位置・サイズをできるだけ再現しつつ、画面外/異常サイズにならない” を保証する。

### 11.1 保存時
- 取得:
  - outer position（ウィンドウ外枠座標）
  - outer size
  - maximized 状態
  - （可能なら）取得時の scale factor（DPI）
- 保存形式:
  - 基本は **論理座標（DIP）** で保存 + `scale_factor` を併記
  - ただし OS/ライブラリによって取得単位が異なるため、内部では `Physical` / `Logical` を明確に区別する

### 11.2 復元時（安全な復元アルゴリズム）
1. モニタ一覧を取得（各モニタの work area / scale factor）
2. 保存値を現在の座標系に変換（必要なら）
3. “可視領域に入っているか” を判定:
   - すべてのモニタ work area と intersection が 0 → **画面外**とみなす
4. 画面外の場合:
   - primary monitor の中央に寄せる（サイズはクランプ）
5. サイズのクランプ:
   - 最小: `min_width/min_height`（例: 480x360）
   - 最大: work area の 95% 程度
6. maximized の復元:
   - まず通常サイズで生成 → 位置調整 → maximize を適用（順序が重要）

### 11.3 よくある壊れ方と対策
- 複数モニタ構成が変わった
  - → intersection 判定で検出してセンタリング
- DPI/スケールが変わった
  - → 物理/論理変換を行い、サイズ・位置をクランプ
- 座標が負になる（仮想デスクトップ）
  - → 負値は許容するが、完全に不可視なら修正

---

## 12. エラー処理（最小）

- JSON-RPC `error`:
  - `-32001`（overload）: retry
  - `Unauthorized`: auth 画面へ（account/read → login）
- turn の `status: failed`:
  - UI にエラーメッセージ + 再試行導線
- app-server 異常終了:
  - 自動再起動（回数制限あり）→ initialize → account/read

---

## 13. 仕様固定のための実装メモ（推奨）

app-server 側は schema を生成できるため、minico も開発時に以下を取り込むと安全:

- `codex app-server generate-json-schema --out <dir>`
- 生成 schema から型生成（Rustなら `schemars`/`typeshare` 等、TSならそのまま）

これにより、approval decision の shape や notification payload の差分をビルド時に検知できる。

---

## 14. 参考資料

- Codex App Server: https://developers.openai.com/codex/app-server/
- app-server README（生テキスト）: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md
- Codex Security: https://developers.openai.com/codex/security/
- Codex Config basics: https://developers.openai.com/codex/config-basic/
- Codex Config advanced: https://developers.openai.com/codex/config-advanced/
- Codex Sample config: https://developers.openai.com/codex/config-sample/
