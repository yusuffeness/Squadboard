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
- ⚠️ **Ajan `AskUserQuestion` ile soru sormaya çalışıyor.** "README'ye bir satır ekle" isteğinde ajan hangi satırı ekleyeceğini sordu; başsız modda araç reddedildi, ajan bir varsayılan seçip işi bitirdi. Runner reddi gördüğü için görev `waiting_decision` oldu ve iş commit'lenmedi. `--tools` ile bu araç artık hiç sunulmuyor. Açık soru: ajanın soruları KARAR akışına (Aşama 6) bağlanmalı mı? `AskUserQuestion` girdisi zaten soru + seçenekler biçiminde.
