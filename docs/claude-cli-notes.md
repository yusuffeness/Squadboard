# Claude CLI keşif notları (Aşama 1)

17 Kasım 2026 · Claude Code **2.1.150** · Windows 11 · Pro abonelik (claude.ai girişi)

Bu notlar `packages/spike` içindeki deneylerin sonucu. Ham çıktılar `packages/core/test/fixtures/claude-cli/` altında (core'un adapter testleri bunları kullanır, spike silinse de kalır); her `*.jsonl` / `*.json` dosyasının yanında komut satırı, exit code, süre, stderr ve satır zamanlamalarını tutan bir `*.meta.json` var. Fixture'lardan ev dizini, kullanıcı adı, e-posta ve thinking imzaları (org kimliği gömülü) temizlendi.

Yeniden çalıştırmak için: `pnpm --filter @squadboard/spike spike <basic|resume|perms|schema|karar|kill|followups>`. KARAR varyantı için `KARAR_VARIANT=strict`.

> ⚠️ işareti, `docs/ARCHITECTURE.md`'deki bir varsayımla **çelişen** ya da onu **değiştiren** bulguları gösterir.

## Kısa özet

| Konu                                               | Sonuç                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--output-format json`                             | Çalışıyor. Tek satır, tek `result` nesnesi.                                                                                   |
| `--output-format stream-json`                      | ⚠️ `--verbose` **zorunlu**, yoksa exit 1.                                                                                     |
| `--include-partial-messages`                       | Çalışıyor, token düzeyinde `stream_event` ekliyor.                                                                            |
| `--resume <id>`                                    | Çalışıyor, `session_id` aynı kalıyor. ⚠️ Yalnızca **aynı klasörden** (cwd) çalışıyor.                                         |
| `--session-id <uuid>`                              | Çalışıyor, oturum kimliğini biz seçebiliyoruz.                                                                                |
| `--permission-mode acceptEdits` + `--allowedTools` | Çalışıyor. `Bash(npm test:*)` söz dizimi geçerli.                                                                             |
| İzin reddi                                         | ⚠️ İş **durmuyor**. Ajan devam ediyor, `success` ile bitiyor; reddedilenler `result.permission_denials[]` içinde.             |
| `--max-turns`                                      | ⚠️ `--help`'te **yok** ama çalışıyor. Sınırda `error_max_turns`, exit 1.                                                      |
| `--json-schema`                                    | Çalışıyor. Çıktı `result.structured_output` alanında.                                                                         |
| KARAR bloğu                                        | Gevşek talimatla **0/10**, ölçütleri sayan talimatla **10/10** (yanlış alarm 0/3). Ama cevap sonrası zincirleme soru soruyor. |
| Process sonlandırma                                | ⚠️ Windows'ta `child.kill()` alt process'leri **yetim bırakıyor**. `taskkill /T /F` temiz.                                    |
| Toplam deney maliyeti                              | API karşılığı ~**$2.39** (abonelikte başsız kullanım kredisinden düşer).                                                      |

## 1. Çıktı biçimleri

### `--output-format json` (`01-json.json`)

Tek satır, tek nesne. Alanlar:

```
type, subtype, is_error, api_error_status, duration_ms, duration_api_ms, ttft_ms,
num_turns, result, stop_reason, session_id, total_cost_usd, usage, modelUsage,
permission_denials, terminal_reason, fast_mode_state, uuid
(+ structured_output, --json-schema verilince)
(+ errors[], hata durumlarında)
```

### `--output-format stream-json` (`02`, `03`)

- ⚠️ `--verbose` olmadan: `Error: When using --print, --output-format=stream-json requires --verbose`, exit 1, stdout boş (`02-stream-no-verbose.meta.json`). Raporda "gerekebilir" demiştik; **zorunlu**.
- Her satır bir JSON nesnesi. Gözlenen olaylar, sırasıyla:

| `type` / `subtype`                  | Ne zaman                             | Önemli alanlar                                                                                                                                            |
| ----------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system` / `init`                   | İlk satır (~0.9 s)                   | `session_id`, `cwd`, `model`, `permissionMode`, `tools[]`, `mcp_servers[]`, `claude_code_version`, `apiKeySource`, `skills[]`, `agents[]`, `memory_paths` |
| `rate_limit_event`                  | init'ten hemen sonra                 | `rate_limit_info.status`, `rateLimitType` (`five_hour`), `resetsAt`, `overageStatus`                                                                      |
| `assistant`                         | Her içerik bloğu için **ayrı** satır | `message.id`, `message.content[]` (`thinking` / `text` / `tool_use`), `message.usage`, `parent_tool_use_id`                                               |
| `user`                              | Her araç sonucu                      | `message.content[].tool_result` (`tool_use_id`, `content`, `is_error`), ayrıca yapılandırılmış `tool_use_result`                                          |
| `result` / `success` veya `error_*` | Son satır                            | json modundakiyle aynı alanlar                                                                                                                            |

- ⚠️ Bir API mesajı tek `assistant` olayı değil: **her içerik bloğu** (thinking, tool_use, text) aynı `message.id` ile ayrı satır olarak geliyor (`03-stream-verbose.jsonl`). Arayüz `message.id`'ye göre birleştirmeli.
- Alt ajan mesajları `parent_tool_use_id` ile ayrılıyor (bu deneylerde hep `null`).
- Canlılık: `--verbose` ile satırlar blok düzeyinde, yaklaşık 0.1–1 s aralıklarla geliyor (`03-stream-verbose.meta.json` → `lineTimingsMs`). Pano için yeterli.

### `--include-partial-messages` (`04-stream-partial.jsonl`)

Ek olarak `type: "stream_event"` satırları geliyor; içindeki `event` ham Anthropic API akış olayı:
`message_start`, `content_block_start`, `content_block_delta` (`text_delta`, `thinking_delta`, `input_json_delta`, `signature_delta`), `content_block_stop`, `message_delta`, `message_stop`. Ayrıca `system/status` (`status: "requesting"`). Tam `assistant` blokları yine geliyor, yani partial olaylar yalnızca "yazıyor…" efekti için. 67 satır / 2.7 s. İlk sürümde gerekmiyor.

## 2. Oturum ve `--resume`

| Deney                         | Sonuç                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `05` → `06` (json)            | `--resume <id>` aynı `session_id` ile devam ediyor, bağlamı hatırlıyor ("pelican").                                                                                                                                         |
| `07` (stream-json ile resume) | Aynı `session_id`, yeni bir `system/init` olayı geliyor.                                                                                                                                                                    |
| `08` `--fork-session`         | **Yeni** `session_id`, eski bağlam korunuyor. "Planı yeniden oluştur" ya da alternatif deneme için kullanışlı.                                                                                                              |
| `09` `--session-id <uuid>`    | Verdiğimiz UUID aynen kullanılıyor. Süreci başlatmadan önce oturum kimliğini DB'ye yazabiliriz.                                                                                                                             |
| `10` bilinmeyen id            | ⚠️ JSON **yok**. stderr: `No conversation found with session ID: …`, exit 1. Hata ayrıştırması stderr'den yapılmalı.                                                                                                        |
| `20` aynı id, başka klasör    | ⚠️ `No conversation found`. Oturumlar `~/.claude/projects/<cwd-slug>/` altında, **cwd'ye bağlı**. Bir işin oturumu yalnızca **kendi worktree yolundan** resume edilebilir; worktree silinir veya taşınırsa resume çalışmaz. |
| `21` öldürülen oturum         | Resume çalışıyor, ajan yarıda kalan komutu hatırlıyor. "Kaldığı yerden sürdür" mümkün.                                                                                                                                      |

## 3. İzinler (`11`–`15`)

Görev: "math.js'e `subtract` ekle, sonra `npm test`'i Bash ile çalıştır."

| Deney | Bayraklar                           | Sonuç                                                                                                                                                          |
| ----- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11`  | `acceptEdits`, `Read,Edit,Write`    | Edit yapıldı, Bash reddedildi. `success`, `permission_denials: [{tool_name:"Bash", tool_input:{command:"npm test"}}]`.                                         |
| `12`  | `acceptEdits`, `…,Bash(npm test:*)` | Edit ve `npm test` çalıştı, red yok. `Bash(<prefix>:*)` söz dizimi doğru.                                                                                      |
| `13`  | `default`                           | Edit'ler reddedildi, dosya değişmedi. Araç sonucu: `Claude requested permissions to write to …, but you haven't granted it yet.`                               |
| `14`  | `dontAsk`, `Read,Edit`              | Bash reddedildi. Araç sonucu açıkça "don't ask mode" diyor ve modele "durup açıkla" talimatı veriyor.                                                          |
| `15`  | `--max-turns 1`                     | `subtype: error_max_turns`, `is_error: true`, `terminal_reason: max_turns`, `errors: ["Reached maximum number of turns (1)"]`, **`result` alanı yok**, exit 1. |

Önemli noktalar:

- ⚠️ **Reddedilen araç işi durdurmuyor.** Rapor (Alınan kararlar, İzinler) "ajan listede olmayan bir aracı isterse iş durur" diyor. Gerçekte model reddi araç sonucu olarak görüyor, başka yoldan devam ediyor ya da pes edip `success` ile bitiriyor. `11`'deki sonuç metni kullanıcıyı yanıltıyor bile: "the system will prompt you for permission". **Runner `result.permission_denials`'a bakmalı.** Liste boş değilse işi `success` saymamalı, "izin gerekli" kartını göstermeli, onay gelirse `--allowedTools`'u genişletip `--resume` ile "İzin verildi, tekrar dene" göndermeli.
- `permission_denials[]` hem `tool_name` hem tam `tool_input` içeriyor; karttaki "Şu komuta izin verelim mi?" metni buradan doğrudan üretilebilir.
- `dontAsk` modu, reddi modele daha açık anlatıyor ve "dur, açıkla" diyor. Ajanlar için `acceptEdits`'ten daha uygun olabilir. `14`'te Edit `--allowedTools` içinde olduğu için çalıştı; listede olmayan Edit'in `dontAsk`'ta nasıl davrandığı ölçülmedi. Aşama 2'de karşılaştırmaya değer.
- ⚠️ `--max-turns` `--help` çıktısında listelenmiyor ama çalışıyor (gizli/eski flag). Gelecek sürümlerde kaldırılabilir; `--max-budget-usd` (listede var) asıl sınır olarak kullanılmalı. Not: `--max-turns 1` iken `num_turns: 2` raporlandı; sayım tam bire bir değil.
- `--tools "Read,Glob,Grep"` (araç kümesini daraltır) ve `--allowedTools` (onaysız izin verir) farklı şeyler. Reviewer ve Planner için `--tools` ile salt okunur küme vermek en temiz yol.

## 4. Yapılandırılmış çıktı (`16`, `17`)

- `--json-schema '<şema>'` çalışıyor. Şemaya uyan nesne **`result.structured_output`** alanında; `result` ise ayrıca serbest metin bir özet içeriyor.
- stream-json'da şema çıktısı `name: "StructuredOutput"` olan bir `tool_use` olarak görünüyor; son `result` olayında yine `structured_output` var.
- Planner şemasında `enum`, `additionalProperties: false`, `required` hepsine uyuldu; `dependsOn` anlamlı bir zincir kurdu (db → api → ui → test).
- Haiku ile 11–27 s, $0.02–0.03. Zod ile ikinci doğrulama yine yapılmalı (plan).

## 5. KARAR güvenilirliği

**Kurulum:** Model `sonnet`, `--append-system-prompt` ile talimat, `acceptEdits`, araçlar `Read,Edit,Write,Glob,Grep`. Her koşu temiz bir git sandbox'ında. Blok biçimi:

````
```karar
{"question": "...", "options": ["...", "..."]}
```
````

Bir koşu **doğru** sayılmak için dört şartı sağlamalı: blok son mesajın **sonunda**, içi **geçerli JSON**, **2–4 seçenek** ve **hiçbir dosya değişmemiş** (`git status` boş).

- Belirsiz görev: "Add persistence to this project so that results of add() are stored and can be listed later."
- Kontrol (net) görev: "Add an exported subtract(a, b) function to math.js that returns a - b." Burada KARAR bloğu **yazılmamalı**.

| Varyant  | Talimat                                                                                                                                                                     | Belirsiz görevde doğru | Net görevde yanlış alarm | Ort. maliyet |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------ | ------------ |
| `base`   | "Önemli bir seçim açık kalıyorsa dur, KARAR yaz"                                                                                                                            | **0/10**               | 0/3                      | $0.12/koşu   |
| `strict` | Ölçütleri sayıyor: depolama/dosya biçimi, yeni bağımlılık, public API, veri şeması, kullanıcıya görünen davranış. "Biri belirsizse varsayılan seçme, dosyaya dokunma, dur." | **10/10**              | 0/3                      | $0.06/koşu   |

Ham sonuçlar: `fixtures/karar-base-results.json`, `fixtures/karar-strict-results.json`; birer tam akış `karar-*-01.jsonl`.

**Bulgular**

1. ⚠️ **Gevşek talimatla model hiç durmuyor.** 10 koşunun 10'unda kendisi `results.json` seçip işi bitirdi. Format hatası değil: model durumu "karar gerektirmiyor" diye yorumluyor. "Önemli karar" ifadesi tek başına işe yaramıyor.
2. **Ölçütler açıkça sayılınca 10/10** doğru durdu; blok her seferinde sonda, JSON geçerli, 4 seçenekli, hiç dosya yazılmadı. Erken durduğu için maliyet de yarıya indi.
3. ⚠️ **Zincirleme soru (`19-karar-resume-answer.jsonl`).** `--resume` ile "Karar: JSON file" gönderilince ajan aynı oturuma devam etti, ama hemen **ikinci bir KARAR** sordu ("kayıtta hangi alanlar olsun?") ve yine dosya yazmadı. Katı talimat soruları tek tek sordurtuyor; kullanıcı her seferinde beklemek zorunda kalır.
4. Sınırlılıklar: tek görev, tek model (sonnet), net görevler çok netti. Gerçekçi görevlerde **gereksiz soru** oranı ölçülmedi.

**Değerlendirilen seçenekler**

- (a) Bloğu çok sorulu yapmak: `{"questions":[{question, options}, …]}`; "tüm açık kararları **tek seferde** sor" talimatı. Zinciri kırar.
- (b) Kararları Planner'a taşımak: plan aşamasında `--json-schema` ile `openDecisions[]` üretmek, kullanıcı plan onayında cevaplasın. Ajan talimatı gevşek kalır, `--json-schema` güvenilir olduğu için ayrıştırma riski de yok.
- (c) Ajan bitince sonucu `--json-schema` ile `{status: "done" | "needs_decision", decision?}` olarak döndürmek; serbest metin yerine yapılandırılmış çıktı.

**✅ Karar (17 Kasım 2026): (b), (a) yedek olarak.**

- **Asıl yol: Planner sorar.** Planner, planı `--json-schema` ile üretirken kendi başına veremeyeceği kararları `openDecisions[]` olarak döndürür: `{id, question, options (2–4), taskIds}`. `taskIds` boşsa karar tüm planı etkiler. Kullanıcı bunları **plan onayı ekranında** cevaplar; cevaplar ilgili işlerin talimatına eklenir. Böylece kararlar iş başlamadan, tek seferde alınır; ajan çalışırken beklemez.
- **Yedek yol: KARAR bloğu.** Ajan çalışırken yine de beklenmedik bir seçimle karşılaşırsa durur ve **tüm açık kararları tek blokta** sorar (zinciri önlemek için çok sorulu biçim tercih edilir). Tek soruluk eski biçim de kabul edilir:

  ````
  ```karar
  {"questions": [{"question": "...", "options": ["...", "..."]}]}
  ```
  ````

- Kod karşılığı (Aşama 2, `packages/core`): `Plan.openDecisions` / `PlanDecision` (`schemas.ts`), kararın kaynağını tutan `Decision.source: "planner" | "agent"` ve iki biçimi de okuyan `parseKarar()` (`karar.ts`).
- Ajan talimatında `strict` varyanttaki ölçüt listesi yedek yol için korunur; ama Planner kararları önceden topladığı için ajanın duracağı durumlar azalır. Gerçekçi görevlerde gereksiz soru oranı Planner aşamasında ölçülmeli.

## 6. Process sonlandırma (`18-kill-*`)

Ajana 120 s süren bir komut (`node -e "setTimeout(…)"`) çalıştırıldı; Windows'ta ağaç `claude.exe → bash.exe ×3 → node.exe`.

| Yöntem                      | Sonuç                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `child.kill()`              | ⚠️ Yalnızca `claude.exe` öldü. 3 `bash.exe` ve `node.exe` **yetim kaldı**, çalışmaya devam etti. |
| `taskkill /PID <pid> /T /F` | Tüm ağaç ~0.2 s içinde temizlendi, yetim yok.                                                    |

- Öldürülen koşuda **`result` olayı yok** (son olay `assistant` / `tool_use`). Runner "result gelmeden süreç kapandı" durumunu `stopped` olarak işaretlemeli.
- macOS/Linux'ta karşılığı `detached: true` ile spawn edip process grubunu (`process.kill(-pid)`) öldürmek; bu deneyde ölçülmedi, Aşama 1/2'de doğrulanmalı.
- Rapordaki `execa` seçimi Windows ağaç sonlandırmasını kendiliğinden çözmüyor; ayrıca `tree-kill` benzeri bir çözüm ya da `taskkill` gerekiyor.

## 7. Maliyet, oturum ve sayaç alanları

| Alan                                                 | Yer                                                | Not                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_id`                                         | Her stream satırında; json modunda `result` içinde | İlk satır (`system/init`) yeterli; `--session-id` ile önceden de belirlenebilir.                                                                 |
| `total_cost_usd`                                     | `result`                                           | Abonelikte de doluyor (API karşılığı tahmin).                                                                                                    |
| `num_turns`                                          | `result`                                           | Model çağrısı sayısı, kabaca.                                                                                                                    |
| `duration_ms`, `duration_api_ms`, `ttft_ms`          | `result`                                           |                                                                                                                                                  |
| `usage`                                              | `result` (toplam) ve her `assistant.message.usage` | input/output/cache token'ları; `iterations[]` alt dökümü.                                                                                        |
| `modelUsage`                                         | `result`                                           | Model başına token ve `costUSD`, `contextWindow`, `maxOutputTokens`.                                                                             |
| `permission_denials[]`                               | `result`                                           | Bkz. bölüm 3.                                                                                                                                    |
| `structured_output`                                  | `result`                                           | Yalnızca `--json-schema` ile.                                                                                                                    |
| `subtype`, `is_error`, `terminal_reason`, `errors[]` | `result`                                           | `success` / `error_max_turns` gözlendi.                                                                                                          |
| `rate_limit_info`                                    | `rate_limit_event`                                 | ⚠️ Yalnızca `five_hour` penceresi görüldü; rapordaki **ayrı aylık başsız kredi** hakkında bir alan **yok**. Kredi bilgisi stream'den okunamıyor. |

## 8. Ortam ve platform notları

- ⚠️ **İç içe çalıştırma:** Squadboard sunucusu bir Claude Code oturumunun içinden başlatılırsa `CLAUDECODE`, `CLAUDE_CODE_*` gibi değişkenler alt süreçlere geçiyor. Runner bunları temizleyerek spawn etmeli (`packages/spike/src/claude.ts` → `cleanEnv`).
- **Windows:** npm'in `claude` / `claude.cmd` dosyası `node_modules/@anthropic-ai/claude-code/bin/claude.exe`'ye yönlendiriyor. `.cmd` dosyası `shell: true` ister ve argüman tırnaklamasını bozar; `.exe`'yi doğrudan spawn etmek daha güvenli.
- **Bağlam sızıntısı:** `-p` modunda kullanıcının global ayarları, skill'leri ve otomatik memory'si yükleniyor (`system/init` → `skills[]`, `memory_paths`). Ajan davranışı kullanıcıdan kullanıcıya değişebilir. `--strict-mcp-config` MCP sunucularını kapattı; `--setting-sources` ve `--bare` (yalnızca API anahtarıyla çalışıyor, abonelikle **çalışmaz**) Aşama 2'de değerlendirilmeli.
- `system/init.tools[]`'ta PowerShell, Cron, Monitor gibi araçlar da var. Ajanlar için `--tools` ile açık bir küme vermek öngörülebilirliği artırır.

## 9. Rapordaki varsayımlarla çelişen noktalar (özet)

| #   | Raporda                                                 | Gerçekte                                                               | Etki                                                                                    |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `stream-json` ile `--verbose` "gerekebilir"             | **Zorunlu**                                                            | Runner her zaman ekler.                                                                 |
| 2   | Listede olmayan araç istenirse "iş durur"               | İş devam eder, `success` biter; red `permission_denials[]`'ta          | Runner `permission_denials`'a bakmalı; izin kartı akışı buna göre.                      |
| 3   | `--max-turns` bayrağı                                   | Çalışıyor ama `--help`'te yok; `result` alanı gelmiyor, exit 1         | `--max-budget-usd` asıl sınır; `result` opsiyonel tiplenmeli.                           |
| 4   | KARAR talimatı ("karar gerekiyorsa dur")                | Bu haliyle 0/10; ölçütlerle 10/10 ama zincirleme soru                  | Karar verildi: Planner `openDecisions[]`, KARAR çok sorulu yedek (bölüm 5).             |
| 5   | `--resume` ile her yerden sürdürme (örtük)              | Oturum **cwd'ye bağlı**                                                | Worktree yolu sabit kalmalı ve DB'de saklanmalı; worktree silinmeden önce iş kapanmalı. |
| 6   | "Durdurma basılınca süreç ağacı sonlandırılır", `execa` | Windows'ta `kill()` yetim bırakır                                      | `taskkill /T /F` (Windows) / process grubu (POSIX).                                     |
| 7   | Kredi bitince "CLI hata verir" ve maliyet takip edilir  | Stream'de aylık kredi bilgisi yok, sadece `five_hour` rate limit olayı | Kredi bitimi hata metninden yakalanmalı; deney ortamında tetiklenmedi, ölçülemedi.      |
| 8   | Her mesaj tek `assistant` olayı (örtük)                 | İçerik bloğu başına ayrı olay, aynı `message.id`                       | Ayrıştırıcı `message.id`'ye göre birleştirmeli.                                         |

## 10. Denenmedi / açık kalanlar

- Kredi bittiğinde ya da rate limit dolduğunda CLI'ın davranışı (tetiklenemedi).
- macOS/Linux'ta process grubu sonlandırma: Aşama 3'te uygulandı ve sahte CLI ile Linux CI'da test ediliyor; gerçek `claude` ile henüz denenmedi.
- KARAR'ın gerçekçi, daha az net görevlerde gereksiz soru oranı ve haiku/opus ile farkı.
- Worktree içinde çalıştırma (`git worktree add` + o klasörden `claude -p`) ve `-w` bayrağı.
- `--input-format stream-json` (açık oturuma stdin'den mesaj göndermek): KARAR/izin akışında `--resume` yerine kullanılabilir mi?

## 11. Runner'da nasıl uygulandı (Aşama 3)

Bu bulgular `packages/server/src/runner/` içinde koda döküldü; testler gerçek CLI yerine `packages/server/test/fake-claude.mjs` ile çalışıyor (yukarıdaki kayıtları oynatır).

| Bulgu                                              | Runner'daki karşılığı                                                                                                                             | Testi                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `stream-json` için `--verbose` zorunlu (§1)        | `buildClaudeArgs` ikisini her zaman birlikte ekler                                                                                                | `claude-cli.test.ts`; sahte CLI `--verbose` yoksa gerçek hatayı verir                                                    |
| `--session-id` çalışıyor (§2)                      | Oturum kimliği süreç başlamadan üretilir ve `runs` satırına yazılır                                                                               | "passes the agent options to the CLI"                                                                                    |
| Oturum klasöre bağlı (§2)                          | `resume()` oturumu kaydedildiği klasörden başlatır; başka klasör verilirse süreç başlatmadan hata verir                                           | "resume refuses another directory"                                                                                       |
| Bilinmeyen oturum yalnızca stderr'de (§2)          | `classifyCliStderr` → `session_not_found` olayı, run ve iş `failed`                                                                               | "resume of a session the CLI does not know"                                                                              |
| İzin reddi işi durdurmuyor (§3)                    | `permission_denials` doluysa run `succeeded` ama iş `waiting_decision`                                                                            | "denied tools"                                                                                                           |
| `error_max_turns`: `result` alanı yok, exit 1 (§3) | Run ve iş `failed`, hata `errors[]`'tan                                                                                                           | "error result (max turns)"                                                                                               |
| KARAR (§5)                                         | Geçerli blok → sorular `decisions` tablosuna `agent` kaynağıyla, iş `waiting_decision`                                                            | "KARAR block"                                                                                                            |
| Windows'ta `kill()` yetim bırakır (§6)             | Windows: `taskkill /PID <pid> /T /F`; POSIX: `detached` + `kill(-pid)`, önce SIGTERM sonra SIGKILL                                                | "stop kills the whole process tree": sahte CLI bir torun süreç başlatır, durdurmadan sonra ikisinin de öldüğü doğrulanır |
| Öldürülen koşuda `result` yok (§6)                 | `stop()` sonrası run ve iş `stopped`; o ana kadarki olaylar DB'de kalır                                                                           | aynı test                                                                                                                |
| İç içe oturum değişkenleri (§8)                    | `cleanEnv`: açık yasak listesi (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, …); kullanıcı ayarları (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`) korunur | "removes Claude Code session variables"                                                                                  |
| Windows'ta `.cmd` yerine `.exe` (§8)               | `resolveClaudeCommand` önce `claude.exe`'yi arar, `SQUADBOARD_CLAUDE_BIN` ile değiştirilebilir                                                    | —                                                                                                                        |

Notlar:

- Spike'taki ortam temizliği bütün `CLAUDE*` değişkenlerini siliyordu; runner'da bu, kullanıcının kendi ayarlarını da sileceği için açık bir yasak listesine çevrildi.
- Durdurma testinin gerçekten yetim süreci yakaladığı doğrulandı: `taskkill /T` geçici olarak düz `process.kill` ile değiştirilince test kırmızıya döndü (yetim torun süreç yüzünden zaman aşımı).
- Gerçek CLI ile uçtan uca deneme için: `pnpm --filter @squadboard/server try` (haiku, salt okunur araçlar, $0.25 bütçe sınırı, geçici bir klasörde).

## 12. Sunucu ve arayüz tarafı (Aşama 4)

CLI davranışıyla ilgili olarak bu aşamada eklenenler:

- **Kapanışta yetim süreç kalmıyor.** POSIX'te ajanlar `detached` başlatıldığı için sunucuyla birlikte ölmezler (§6, §11). Sunucu `SIGINT` / `SIGTERM` / `SIGHUP` (Windows'ta ayrıca `SIGBREAK`) alınca önce `runner.stopAll()` çağırıyor. Windows'ta Ctrl+C Node'a `SIGINT` olarak geliyor. Testte (`server.test.ts`) torun süreçli bir run açıkken `close()` çağrılıyor ve iki sürecin de öldüğü doğrulanıyor. Sunucu zorla öldürülürse bu çalışmaz.
- **Canlı akış blok düzeyinde.** Arayüz `--include-partial-messages` kullanmıyor; §1'deki gibi her içerik bloğu (düşünce, araç çağrısı, metin) ayrı bir satır olarak ve ~0.1–1 sn aralıklarla geliyor. Prototip için yeterli.
- **İzin reddi görünür.** `result.permission_denials` (§3) canlı panelde "İzin verilmedi: …" satırı olarak gösteriliyor; iş `waiting_decision` oluyor. İzin verme akışı sonraki bir aşamada.
- **Prototip ajanı kabuk komutu çalıştıramaz** (`Read, Edit, Write, Glob, Grep`, `acceptEdits`, $1 bütçe). "Testleri çalıştır" gibi istekler bu yüzden izin reddine düşer; beklenen davranış.

## 13. Worktree içinde çalıştırma (Aşama 5)

- Her görev `claude -p`'yi kendi worktree'sinde (`~/.squadboard/worktrees/<proje>/<dal>`) başlatır. Worktree normal bir git çalışma ağacı olduğu için reponun `CLAUDE.md`'si ve `.claude/` ayarları orada da vardır ve yüklenir.
- Oturum kimliği worktree yoluna bağlıdır (§2). Temizlenen bir görev yeniden başlatılınca worktree **aynı yolda** yeniden açılır, böylece önceki oturum yine sürdürülebilir.
- Ajan commit atmaz (kabuk aracı yok); Squadboard run `in_review` ile bitince değişiklikleri görevin `team/` dalına kendisi commit'ler. Bağımlı görev bu commit'ten başlar.
- Gerçek `claude` ile worktree içinde çalıştırma bu aşamanın elle denemesinde doğrulanacak; otomatik testler sahte CLI ile (§11) ve gerçek git repolarıyla çalışıyor.

### Aşama 5 elle denemesinden iki bulgu (gerçek `claude`)

- ⚠️ **`--allowedTools` bir beyaz liste değil.** Yalnızca `--allowedTools Read,Edit,Write,Glob,Grep` verilen bir ajan Bash ile `ls` çalıştırabildi; reddedilmedi (`permission_denials` boş). Listede olmayan araçlar kullanılabilir kalıyor ve Claude Code salt okunur kabuk komutlarını kendiliğinden onaylıyor. Kullanılabilir araç kümesini gerçekten daraltan flag **`--tools`**. Varsayılan ajan artık ikisini birlikte veriyor (`DEFAULT_AGENT_OPTIONS`, testi var).
- ⚠️ **Ajan `AskUserQuestion` ile soru sormaya çalışıyor.** "README'ye bir satır ekle" isteğinde ajan hangi satırı ekleyeceğini sordu; başsız modda araç reddedildi, ajan bir varsayılan seçip işi bitirdi. Runner reddi gördüğü için görev `waiting_decision` oldu ve iş commit'lenmedi. `--tools` ile bu araç o aşamada hiç sunulmadı. Aşama 9'da soruların ana yolu bu araç oldu: §17.

## 14. Pano arayüzü (Aşama 6)

CLI davranışının arayüze yansıyan kısımları:

- **İlerleme yüzdesi yok.** Stream'de ne yüzde ne de kalan iş tahmini var. Çalışan işin ilerleme çubuğu bu yüzden belirsiz (`aria-valuenow` yok); yalnızca biten iş dolu gösterilir. Kartta "ne yapıyor" satırı, canlı akıştaki son `tool_use` olayından gelir.
- **Maliyet yalnızca `result` ile gelir.** `costUsd` run bitene kadar `null`; "Bugün" hapı yalnızca bugün başlayan ve maliyeti bilinen run'ları toplar, tahmin göstermez.
- **Canlı güncelleme yoklamasız.** Etkin her run için tek bir `EventSource` açılır (birden çok bileşen aynı akışı paylaşır). `end` olayında görev ve run listeleri yenilenir; commit `end`'den hemen sonra yazıldığı için 1,5 sn sonra bir kez daha yenilenir. Aşama 5'teki 2 sn'lik görev yoklaması kaldırıldı; yalnızca menüdeki bağlantı kartı 30 sn'de bir `/health` soruyor.
- **Olayların zaman damgası yok.** SSE olayı `seq` ve `AgentEvent` taşır; log panelindeki satırlarda tasarımdaki saat sütunu bu yüzden gösterilmiyor.

## 15. Ajan tanımları worktree'de görünüyor mu? (Aşama 7)

Soru: ajan tanımı kullanıcının ana klasöründe `.claude/agents/` altında **commit'lenmemiş** duruyorsa, worktree'de çalışan `claude -p` onu görüyor mu?

Deney (Claude Code 2.1.150, haiku, `--tools ""`, `--max-turns 1`, toplam ~0,02 $): geçici bir repo, tek boş commit; `.claude/agents/sb-probe.md` yalnızca ana klasörde, commit'siz ("cevabının sonuna `[probe-ok]` yaz" talimatıyla). Worktree, Squadboard'daki gibi repodan tamamen ayrı bir klasörde açıldı; worktree'de `.claude/` yok.

| Durum                                                               | `init.agents` içinde         | Talimat uygulandı                     |
| ------------------------------------------------------------------- | ---------------------------- | ------------------------------------- |
| Worktree, `--agent sb-probe`                                        | ✅ `sb-probe`                | ✅                                    |
| Worktree, bayraksız                                                 | ✅ (alt ajan olarak listede) | –                                     |
| Worktree, `--agents '<json>' --agent sb-json`                       | ✅ ikisi de                  | ✅                                    |
| Worktree, `--append-system-prompt "<talimat>"`                      | –                            | ✅                                    |
| Dosya ana klasörden silindikten sonra, worktree, `--agent sb-probe` | ❌                           | ❌, **hata yok**, sessizce varsayılan |

Bulgular:

- **Evet, görüyor.** Claude Code worktree'de, worktree'nin bağlı olduğu ana çalışma klasörünün `.claude/agents/` dizinini (commit'lenmemiş hâliyle, canlı) okuyor. Bu belgelenmiş bir davranış değil; git worktree tespitine dayanıyor.
- `--agent` ile verilen ad bulunamazsa CLI hata vermiyor, ajan tanımı olmadan çalışıyor. Yanlış ajanla sessizce çalışmak tehlikeli.
- `--agent` ajan talimatını Claude Code'un kendi sistem prompt'unun **yerine** koyuyor gibi: aynı istek `--agent` ile ~0,001 $, `--append-system-prompt` ile ~0,009 $ tuttu (ikincisi Claude Code'un araç kullanım talimatlarını da taşıyor).

**Seçilen yol:** sunucu tanımı kullanıcının klasöründen kendisi okur, doğrular ve açık bayraklarla geçer: `--append-system-prompt <talimat>`, `--tools`, `--allowedTools`, `--model`, `--max-budget-usd`, `--permission-mode`. Nedenleri:

1. Belgelenmemiş worktree davranışına bağlı kalmıyor; Claude Code sürümü değişse de aynı çalışır.
2. Tanım bozuksa ya da yoksa bunu Squadboard bilir ve söyler; CLI gibi sessizce varsayılana düşmez.
3. Araç kısıtı `--tools` ile gerçekten uygulanır (İnceleyici salt okunur), bütçe ve model her run'da açık.
4. Claude Code'un kendi sistem prompt'u (araç kullanımı, dosya düzenleme kuralları) korunur; ajan talimatı ona eklenir.
5. Sahte CLI ile test edilebilir: testler `claude`'a giden argümanlara bakar.

Not: proje ajanları worktree'de alt ajan olarak da listeleniyor (`init.agents`). Squadboard'ın ajanlarında alt ajan çağıran araç (`Task`/`Agent`) `--tools` listesinde olmadığı için kullanılamıyorlar.

## 16. Planlayıcı ve zamanlayıcı (Aşama 8)

Bu aşamada gerçek CLI ile yeni bir deney yapılmadı; Planlayıcı çağrısı §4'teki `--json-schema` bulgularına dayanıyor ve testler sahte CLI ile çalışıyor (`FAKE_CLAUDE_PLANS`: `17-json-schema-stream.jsonl` kaydını, istenen planı `structured_output` yaparak oynatır). Gerçek bir küçük repoda elle denenmesi gerekiyor.

- **Çağrı.** `claude -p "<istek + açık ajanlar + kurallar>" --output-format stream-json --verbose --strict-mcp-config --session-id <yeni> --permission-mode default --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --append-system-prompt <planner.md> --model <planner.md> --max-budget-usd <team.json> --json-schema <planJsonSchema>`. Çalışma klasörü kullanıcının kendi klasörü: araçlar salt okunur olduğu için dosya yazamaz, worktree açmaya gerek yok.
- **Şemada `enum`.** `agent` alanı açık ve dosya yazabilen ajanların kimlikleriyle sınırlı (§4'te `enum`'a uyulduğu görüldü). Yine de sunucu `validatePlan` ile tekrar bakar; CLI'ın denetimi bizim denetimimiz değil.
- **`structured_output` yoksa** (model şemaya uymayan bir şeyle bitirirse) ya da doğrulama düşerse, aynı istek sorunun açıklamasıyla yeni bir oturumda bir kez daha verilir. `--resume` kullanılmıyor: oturum kullanıcının klasörüne bağlı ve yeniden denemenin önceki yanlış cevabı görmesine gerek yok.
- **İlerleme.** Stream'deki her `tool_use` (`Read`, `Glob`, `Grep`) "Proje dosyaları inceleniyor" adımının ayrıntısını günceller; `StructuredOutput` aracı sayılmaz. Planlama adımlarında yüzde ya da kalan süre yok, çünkü CLI vermiyor (§14).
- **Kabuk yok.** Hiçbir şablon ajanında `Bash` yok; Planlayıcıya bu açıkça söylenir ve "testleri çalıştır" görevi yazmaması istenir. Test komutu izni Aşama 9'un işi.
- **Açık soru.** Gerçekçi isteklerde Planlayıcının gereksiz soru oranı ve 12 iş sınırının yeterliliği henüz ölçülmedi.

## 17. Karar ve izin akışı için değerlendirme (Aşama 9)

21 Kasım 2026 · Claude Code 2.1.150 · gerçek `claude`, her koşu temiz bir git sandbox'ında (`math.js`, `test.js`, `package.json` içinde `test` ve `lint` script'leri). Toplam ~1 $. Kayıtlar: `22-ask-user-question`, `23-ask-resume-answer`, `24-perm-bash-denied`, `25-perm-bash-granted` (`.jsonl` + `.meta.json`; ev dizini, yollar ve imzalar temizlendi).

### (a) `AskUserQuestion` mı, KARAR bloğu mu?

| Koşu                | Kurulum                                                                                                                      | Sonuç                                                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 (haiku)          | `--tools …,AskUserQuestion`, görev "paleti sen seçme, bana sor"                                                              | Araç çağrıldı, iki soru tek çağrıda. Araç sonucu `is_error: true`, `"Answer questions?"`. Ajan turu bitirdi, dosya yazmadı, `success`. **`permission_denials[]` içinde `tool_name: "AskUserQuestion"` ve tam `tool_input`** (sorular, `header`, `options[{label, description}]`, `multiSelect`). |
| A2                  | A1'in oturumu `--resume` + "Kullanıcının cevapları: 1. … → … 2. … → …"                                                       | Ajan cevaplarla devam etti, dosyayı yazdı, yeni soru yok.                                                                                                                                                                                                                                        |
| A3, A4 (sonnet)     | Aşama 1'in belirsiz görevi ("persistence ekle"); talimatsız ve gevşek talimatla                                              | Hiç sormadı, `results.json` seçip bitirdi (0/2). §5'teki gevşek KARAR sonucuyla (0/10) aynı.                                                                                                                                                                                                     |
| A5 (sonnet, 3 koşu) | Ölçütler sayıldı ama yumuşak ifadeyle ("açıksa **ve önemliyse**")                                                            | 0/3. "Önemliyse" kaçış yolu oluyor.                                                                                                                                                                                                                                                              |
| A6 (sonnet, 3 koşu) | §5 `strict` metni kelimesi kelimesine; yalnızca son kısım "AskUserQuestion'ı bir kez, tüm sorularla çağır, sonra turu bitir" | **3/3** durdu, 3–4 soru tek çağrıda, hiç dosya değişmedi, ~0,06 $.                                                                                                                                                                                                                               |
| K1 (sonnet, 3 koşu) | Aynı `strict` metin, çok sorulu KARAR bloğuyla                                                                               | **3/3**; `parseKarar` üçünü de `ok` ve `atEnd` okudu (3–4 soru), ~0,05 $.                                                                                                                                                                                                                        |
| A7                  | A6 oturumu `--resume` + bütün cevaplar tek mesajda                                                                           | Ajan bitirdi, **zincirleme soru yok** (§5'teki zincir, sorular tek tek sorulduğu içindi).                                                                                                                                                                                                        |
| A8 (2 koşu)         | Net görev ("subtract ekle") + A6 talimatı                                                                                    | 0/2 yanlış alarm.                                                                                                                                                                                                                                                                                |

Bulgular:

- Soruyu ve seçenekleri `AskUserQuestion`'ın reddedilen çağrısından **güvenilir şekilde** çıkarabiliyoruz: `result.permission_denials[]` aracın tam girdisini taşıyor, biçimi CLI'ın kendi araç şeması zorluyor (markdown içinde JSON yazdırmak yok), çoklu soru zaten aracın biçiminde. Runner bu listeye zaten bakıyordu (§3).
- Cevaplar tek bir `--resume` mesajıyla verilebiliyor; A2 ve A7'de ajan kaldığı yerden devam etti.
- Sormayı tetikleyen şey biçim değil talimat: iki yolda da ölçütler sayılınca 3/3, gevşek talimatla 0. Güvenilirlik farkı yok.
- Model `AskUserQuestion`'a kendiliğinden uzanıyor (Aşama 5'te KARAR talimatlı şablonda bile denedi). Ona ikinci bir soru biçimi öğretmek yerine bildiği aracı kullandırmak daha doğal.
- Risk: araç reddedilince ajan bazen bir varsayılan seçip işi bitiriyor (Aşama 5'teki "README'ye satır ekle" koşusu). Talimattaki "çağırdıktan sonra turu bitir" cümlesiyle A1 ve A6'da hep durdu. Durmasa bile soru `permission_denials`'ta olduğu için kaybolmuyor; cevap gelince ajan yaptığını düzeltebilir.

**✅ Karar: `AskUserQuestion` ana yol, KARAR bloğu yedek.**

- Dosya yazabilen ajanlarda `--tools` listesine `AskUserQuestion` eklenir; `--allowedTools`'a **eklenmez** (reddedilmesi gerekiyor ki `permission_denials`'a düşsün). Salt okunur ajanlara (Planlayıcı, İnceleyici) eklenmez.
- Şablon talimatları `strict` ölçüt listesiyle "AskUserQuestion'ı bir kez, bütün açık sorularla çağır, sonra turu bitir" der.
- Runner iki biçimi de okur: önce `permission_denials` içindeki **son** `AskUserQuestion` çağrısı, yoksa son mesajdaki KARAR bloğu (eski ya da elle yazılmış ajan dosyaları için). Biri bozuksa görev sessizce bitmez, "ajan bir şey sormak istemiş olabilir" diye kullanıcıya gösterilir.
- Seçeneklerin `description` alanı saklanmaz (v2-03 yalnızca etiket gösteriyor); `multiSelect` saklanır.

### (b) İzin: başsız `claude -p` ne veriyor, nasıl sürdürülür?

| Koşu       | Kurulum                                                                                                       | Sonuç                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 (haiku) | `acceptEdits`, `--tools …,Bash`, `--allowedTools` Bash'siz; "npm test ve npm run lint çalıştır"               | `npm test` reddedildi, araç sonucu `"This command requires approval"`. Paralel `npm run lint` çağrısı **iptal edildi** (`Cancelled: parallel tool call … errored`) ve `permission_denials`'a **girmedi**. Ajan bir kez daha denedi, sonra "izin verin" deyip `success` ile bitti. `permission_denials`'ta aynı komut **iki kez**. |
| B3         | Aynısı, `dontAsk`                                                                                             | Aynı akış; araç sonucu modele "dolanma" diyor. Ajan yine durup izin istedi.                                                                                                                                                                                                                                                       |
| B4         | `--tools` Bash'siz, `--allowedTools …,Bash(npm test:*)`                                                       | `init.tools`'ta Bash **yok**; ajan "kabuk aracım yok" deyip bitti, `permission_denials` boş.                                                                                                                                                                                                                                      |
| B2         | B1'in oturumu `--resume`, `--allowedTools …,Bash(npm test),Bash(npm run lint:*)`, "İzin verildi, tekrar dene" | İki komut da çalıştı, red yok.                                                                                                                                                                                                                                                                                                    |
| B5         | `--allowedTools …,Bash(npm test:*)`, komut `npm test && node -e "…writeFileSync…"`                            | Reddedildi: "This Bash command contains multiple operations. The following part requires approval: node -e …". Bileşik komutun her parçası ayrı denetleniyor; `tool_input.command` tam bileşik komut.                                                                                                                             |
| B6, B7     | Tam bileşik komut tek kural `Bash(<komut>)` olarak / parçalar ayrı ayrı                                       | İkisi de çalıştı (B10 kontrol koşusu: kuralsız aynı komut reddedildi).                                                                                                                                                                                                                                                            |
| B8, B9     | İçinde virgül olan komut (`node -e "console.log(1,2)"`), kurallar virgülle birleşik / ayrı argüman            | İkisi de çalıştı; CLI parantez içindeki virgülü bölmüyor.                                                                                                                                                                                                                                                                         |

Bulgular:

- Reddedilen kabuk çağrısı `permission_denials[]`'ta `{tool_name: "Bash", tool_input: {command, timeout?, description?}}` olarak geliyor; kartta gösterilecek komut `tool_input.command`. Ajan çoğunlukla kendisi durup izin istiyor; durmasa da red kaybolmuyor.
- Aynı red birden çok kez gelebiliyor (tekilleştirilmeli). Paralel çağrılardan yalnızca ilki listeye giriyor: ikinci komut (B1'de `lint`) ancak sürdürmeden sonra yeni bir red olarak görünür. Bu yüzden izin akışı birkaç tur sürebilir; varsayılan allowlist'in test, lint ve typecheck komutlarını baştan kapsaması bu turları önlüyor.
- `--resume` ile her çalıştırmada yeni bayraklar geçerli: oturum aynı, `--allowedTools` yeni.
- **`--tools` ve `--allowedTools` birlikte:** `--tools` ajanın elindeki araç kümesidir (gerçek sınır: içinde olmayan araç hiç sunulmaz, izni de istenemez). `--allowedTools` bu kümenin içinden **onay istemeden** çalışacakları seçer; kümede olmayan bir aracı eklemez (B4). Yani bir ajanın kabuk izni isteyebilmesi için `Bash` `--tools`'ta olmalı; hangi komutların sorulmadan çalışacağını `--allowedTools` içindeki `Bash(<önek>:*)` / `Bash(<tam komut>)` kuralları belirler. Çıplak `Bash` asla `--allowedTools`'a yazılmaz.
- `Bash(<önek>:*)` kuralı bileşik komutla delinemiyor (B5): `npm test && <başka şey>` için `<başka şey>` ayrıca onay istiyor.
- Not: `npm test` projenin `package.json`'ındaki script'i çalıştırır. Ajan aynı worktree'de `package.json`'ı da düzenleyebildiği için test komutu izni pratikte o worktree'de kod çalıştırma iznidir. Aşama 11'in güvenlik gözden geçirmesine not edildi.

**✅ Karar: izin = `permission_denials` → kart → kurallarla `--resume`.**

- Görev sonunda `AskUserQuestion` dışındaki redler tekilleştirilip izin isteği olarak kaydedilir, görev `waiting_decision` olur.
- "Bir kez": tam komut kuralı (`Bash(<komut>)`) yalnızca bir sonraki `--resume` çalıştırmasına eklenir. "İzin ver": aynı kural o görevin sonraki bütün çalıştırmalarına eklenir. "Hep izin ver": kural projenin `.team/team.json` dosyasındaki `permissions.allow` listesine yazılır (yalnızca o proje, elle düzenlenebilir). "Reddet": kural eklenmez, ajana komutu çalıştırmadan devam etmesi söylenir.
- `--allowedTools` = ajanın araçları (`Bash` ve `AskUserQuestion` hariç) + projenin allowlist'indeki, aracı `--tools`'ta olan kurallar + görevin izinleri. Planlayıcı ve İnceleyici `--tools`'ta `Bash` olmadığı için allowlist'ten etkilenmez.
- Varsayılan allowlist, `team.json`'da `permissions` yoksa projeden çıkarılır: `package.json`'daki `test`, `lint`, `typecheck` script'leri, kilit dosyasına göre `npm`/`pnpm`/`yarn`/`bun` önekiyle. Ekip kurulurken bu liste `team.json`'a yazılır, böylece görünür ve düzenlenebilir.
- MCP izin aracı (`--permission-prompt-tool`) yine kullanılmıyor: süreci açık tutup cevap beklemek gerekirdi, sunucu kapanınca bekleyen istek kaybolurdu. `--resume` yolunda bekleyen her şey veritabanında durur.

### Uygulamadan sonra gerçek `claude` ile uçtan uca deneme

Squadboard'ın kendi `TaskService` + `DecisionService`'i, gerçek `claude`, `fullstack-web` ekibi, Ön Yüz ajanı haiku'ya çevrilmiş; görev "Sayfaya bir renk paleti ekle. Renk paletini ve yazı tipini sen seçme, bana sor." (~0,04 $ / deneme).

- **1. deneme:** görev `waiting_decision` oldu, cevaplar tek `--resume` ile gitti, aynı oturum sürdü, görev `in_review` (`styles.css` yazıldı). Ama ⚠️ ajan reddedilen `AskUserQuestion`'ı **üç kez** çağırdı: araç sonucundaki `"Answer questions?"` hatasını karakter sorunu sanıp aynı iki soruyu Türkçe, Türkçe harfsiz ve İngilizce sordu; arayüzde 6 soru çıktı. Her tekrar bütün soru kümesini taşıdığı için runner artık yalnızca **son** çağrıyı alıyor; şablonlara "araç hata döndürür, bu beklenen bir durum, ikinci kez çağırma" cümlesi eklendi.
- **2. deneme (bu düzeltmelerle):** tek çağrı, iki soru, cevap sonrası `in_review`. Ajan soruları ayrıca metin olarak da yazdı; zararsız (son mesaj görev özetinde görünür).
