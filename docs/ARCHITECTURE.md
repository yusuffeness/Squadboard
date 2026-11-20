# Ekip Panosu – Teknik Rapor

Nov 17, 2026 · @yusuf

## Özet

Ekip Panosu, geliştiricilerin kendi bilgisayarında çalıştırdığı açık kaynaklı bir web arayüzü: isteği yazıyorsun, planlayıcı işi parçalara bölüyor, ajanlar (Frontend, Backend, Database, Test, Reviewer) ayrı git dallarında çalışıyor, plan ve sonucu sen onaylıyorsun. Motor, bilgisayarında kurulu resmi Claude Code CLI'ı; ayrı API anahtarı gerekmez.

**Ana kararlar**

1. Yerel uygulama: Node.js + TypeScript sunucu, React arayüz, SQLite veritabanı. `npx` ile tek komutla kurulur.
2. Motor: `claude -p` (başsız mod) ve `stream-json` çıktısı. Her iş kendi git worktree'sinde çalışır.
3. Akış: plan, senin onayın, paralel çalışma, Reviewer özeti, senin birleştirme onayın. Sen onaylamadan hiçbir şey `main`'e girmez.
4. Ajanlar `.team/` klasöründeki dosyalarla tanımlanır. Arayüzde teknik isim (Frontend) ve sade isim (Pixel) modu vardır.
5. İlk sürüm yalnızca yazılım içindir. Şablon yapısı sayesinde başka alanlar sonradan eklenir.

**En büyük riskler:** abonelikle başsız kullanımın ayrı bir aylık krediden düşmesi ve Anthropic'in üçüncü taraf kimlik doğrulama kuralları (bölüm 11), ayrıca CLI çıktı biçiminin sürümler arasında değişebilmesi (bölüm 13).

## Ürün tanımı, kullanıcı ve rakipler

**Problem.** Birden fazla ajanı terminalde yönetmek karışık: kim ne yapıyor, kim kimi bekliyor, hangi değişiklik güvenli, hepsi sekmelere dağılıyor. Üstelik ajanlar kodu hızlı yazsa da asıl darboğaz incelemede kalıyor: [MIT/Wharton çalışmasına göre](https://hyrax.dev/blog/mit-wharton-code-review-bottleneck-2026) otonom ajanlar %741 daha fazla kod üretirken yayınlanan sürümler yalnızca %20 artmış.

**Hedef kullanıcı.** Claude Code kullanan, projesi git'te duran geliştiriciler. İkinci halka: yazılımı yeni öğrenen ya da yazılımcı olmayan ama proje yapmak isteyenler (sade isim modu bunun için).

**Konumlandırma.** "Daha çok ajan" değil, "daha az bekleme ve daha net onay". Üç şey farkı yaratır: plan onayı, çakışmayı önceden gören bölme ve her işin sonunda sade bir inceleme özeti.

| Araç | Ne yapıyor | Bizim farkımız |
| --- | --- | --- |
| [Vibe Kanban](https://openapps.pro/apps/vibe-kanban) | Kanban panosundan Claude Code, Codex, Gemini CLI gibi 10 ajanı ayrı worktree'lere gönderir, diff'leri inceleyip birleştirir. | Biz plan onayı ve sade inceleme özetine odaklanıyoruz, çoklu CLI desteği ilk hedef değil. |
| [Kangentic](https://dev.to/tvorp/from-chaos-to-efficiency-a-visual-orchestration-layer-for-claude-code-lf6) | Masaüstü uygulama, kartları sütunlar arasında sürükleyerek yönetme, iş başına git worktree, eşzamanlılık sınırı. | Rol tabanlı ajan şablonları ve karar kutusu. |
| [KanBots](https://feedbagel.com/post/open-source-kanban-desktop-app-that-runs-parallel-agents-on-every-card) | MIT lisanslı, her karta ajan atar (Claude Code veya Codex), her biri kendi worktree'sinde. | Planlayıcı ve çakışma tahmini. |
| [Claude Agent Teams UI](https://gentic.news/article/claude-agent-teams-ui-the-visual-dashboard-that-makes-agent-teams-actually-usabl) | Claude Code'un Agent Teams özelliği için canlı pano ve hunk düzeyinde kod incelemesi. | Agent Teams'e bağımlı değiliz, kendi plan ve zamanlayıcımız var. |
| [Agent View](https://cobusgreyling.substack.com/p/claude-code-agent-view) | Anthropic'in terminal paneli, makinedeki tüm oturumları gösterir. | Biz web arayüzü ve onay akışıyız. |

**Not.** Rakiplerin hepsi geliştiriciye yönelik ve kalabalık. Teknik olarak yarışmak yerine akış ve sadelikle ayrışmak gerekiyor.

## Ekran tasarımları

İlk taslak [Ajan Ekibim – Tasarım Taslağı](https://claude.ai/artifact/Sb2sNmJ27NvBkTsPmPLKbx) kanvasında. Güncel referans ise [docs/design/](design/) içindeki 19 ekran görselidir (`v2-01-pano.jpg` … `v2-19-bilesenler.jpg`); arayüz bunlara birebir yakın yazılır. Aşama 6'da kabuk (v2-01, v2-18), bileşenler (v2-19) ve Pano (v2-01, v2-02, v2-04) yazıldı; karar, plan onayı, inceleme, ekip kurma, geçmiş, harcama, ayarlar, onboarding ve hata ekranları kendi aşamalarında o görsellere göre gelecek. Görsellerdeki rakamlar (%62, $0,42) örnektir: CLI ilerleme yüzdesi vermediği için çalışan işte ilerleme çubuğu belirsizdir, maliyet yalnızca run'ın gerçek `costUsd` alanından gelir.

| # | Ekran | Amaç | Ana bileşenler | Veri kaynağı |
| --- | --- | --- | --- | --- |
| 1 | Ekibini kur | Projeyi, şablonu ve ajanları seçmek | Klasör ve dal alanı, şablon kartları (Full-stack, API, Hata düzelt), ajan listesi ve anahtarları, eşzamanlılık seçimi, üç ayar anahtarı (ayrı dal, plan onayı, Reviewer), isim modu anahtarı | `.team/` klasörü, proje ayarları |
| 2 | Plan onayı | Planlayıcının böldüğü işleri görüp düzeltmek | İstek kutusu, aşama sütunları, iş kartları (ajan, beklenen dosyalar, Kaldır, Ajanı değiştir), çakışma kontrolü kutusu, Planı onayla ve başlat | Planner çıktısı (JSON) |
| 3 | Pano | Çalışan işleri izlemek, karar vermek | Yeni iş kutusu, ajan şeridi (durum ve ne yaptığı), Kararın lazım kutusu, dört sütunlu iş panosu (Planlandı, Çalışıyor, İncelemede, Bitti), seçili ajanın sade özeti ve canlı çıktısı | Çalıştırma olayları (stream-json) |
| 4 | İnceleme | Bir işi onaylamak, geri göndermek | Ne değişti özeti, risk rozeti, risk kontrol listesi, değişen dosyalar, Onayla ve birleştir, Değişiklik iste | Reviewer çıktısı (JSON), git diff |

**Tasarım kararları**

- İsim modu: Teknik (Planlayıcı, Ön Yüz, Arka Yüz, Veritabanı, Test, İnceleyici) varsayılan; Sade (Kaptan, Pixel, Motor, Kutu, Dedektif, Usta) isteğe bağlı. Üst çubuktaki anahtarla değişir, tercih tarayıcıda (`localStorage`) kalır. Şimdilik `packages/web/src/lib/agents.ts` içinde; ileride iki isim de şablon dosyasında durur.
- Renk: şeftali zemin `#FCF3EC` (gradyan ve bulanık renkli daireler), kart `#FFFCFA`, metin `#1F2430`, vurgu `#E8664A`, başarı `#2F9E6B`, uyarı `#B26A00`, koyu log paneli `#1D2130`. Ajan pastelleri: Planlayıcı `#9ED8E8`, Ön Yüz `#FFB38A`, Arka Yüz `#8FB3FF`, Veritabanı `#86D3AE`, Test `#C6A8F0`, İnceleyici `#F5D27A`. Hepsi `packages/web/src/index.css` `@theme` bloğunda token; bileşenlerde ham hex yazılmaz.
- Yazı tipi: Nunito (arayüz), JetBrains Mono (dal, dosya ve çıktı).
- Erişilebilirlik: dokunma hedefi en az 44 px, en küçük metin 13 px (`text-xs` buna göre tanımlı), metin kontrastı 4,5:1 ve üstü, durum yalnızca renkle değil metinle de gösterilir, anahtarlar `role="switch"`.
- Karar kutusu her zaman sayfanın üst yarısında; ajan bekliyorsa göz ardı edilemez.
- Canlı çıktı koyu zeminli ve ayrı bir kutuda; sade özet ise insan diliyle yazılmış üç dört satır.

## Mimari

Tüm parçalar kullanıcının bilgisayarında çalışır. Dışarı çıkan tek şey, Claude Code'un kendi Anthropic bağlantısıdır.

| Bileşen | Görev |
| --- | --- |
| Web arayüzü (React) | Kabuk, Pano ve sonraki aşamalarda gelen ekranlar. Sunucuyla HTTP ile konuşur, canlı olayları SSE ile alır. |
| Yerel sunucu (Fastify) | API, olay akışı, statik arayüz dosyaları. Yalnızca `127.0.0.1`'e bağlanır. |
| Orkestratör | Planı bağımlılık grafiğine çevirir, hazır işleri eşzamanlılık sınırına göre başlatır, karar bekleyenleri durdurur. |
| Runner | `claude -p` sürecini başlatır, `stream-json` satırlarını okuyup olaylara çevirir, durdurma ve devam ettirmeyi yönetir. |
| Git servisi | Worktree oluşturma, diff, dal birleştirme, temizlik. |
| Şablon yükleyici | `.team/` klasörünü okur ve doğrular. |
| Depo (SQLite) | Projeler, işler, çalıştırmalar, olaylar, kararlar, incelemeler. |

**Veri akışı**

1. Kullanıcı isteği yazar. Sunucu Planner'ı çalıştırır ve JSON plan alır.
2. Plan arayüzde gösterilir. Kullanıcı düzenleyip onaylar.
3. Orkestratör işleri bağımlılık sırasına göre kuyruğa alır. Her iş için kullanıcının reposunun dışında bir worktree ve `team/<ad>` dalı açılır (bkz. Git worktree stratejisi).
4. Runner ilgili ajanla `claude -p` başlatır. Çıkan olaylar veritabanına yazılır ve arayüze akar.
5. İş bitince Reviewer çalışır, inceleme özetini üretir. İş "İncelemede" sütununa geçer.
6. Kullanıcı onaylarsa Git servisi dalı `main`'e birleştirir, worktree'yi siler. Değişiklik isterse not, aynı oturuma `--resume` ile gönderilir.

**Klasör yapısı (monorepo, pnpm workspaces)**

```
squadboard/
  packages/
    core/      # tipler, Zod şemaları, durum makinesi, stream-json adaptörü, KARAR ve plan doğrulama
               # test/fixtures/claude-cli: gerçek CLI kayıtları (adaptör testleri kullanır)
    server/    # Fastify, orkestratör, runner, git, SQLite
               # drizzle/: SQL migration'ları; test/fake-claude.mjs: kayıtları oynatan sahte CLI
               # bin/squadboard.js → src/cli.ts: `squadboard` komutu; src/dev.ts: `pnpm dev` girişi
               # src/git: git servisi (worktree, diff, commit); src/tasks: proje ve görev yaşam döngüsü
    web/       # React arayüzü (Vite, Tailwind v4)
               # src/lib: API sorguları (TanStack Query), run başına tek SSE akışı, hash router
               #   (#token=…&p=…&task=…), Zustand (isim modu, seçili proje), pano kuralları (board.ts)
               # src/ui: v2-19 bileşenleri; src/shell: menü, üst çubuk, mobil sekme çubuğu
               # src/pages: Pano, ajan detayı, "Yakında" sayfaları; e2e: Playwright smoke testleri
    spike/     # Aşama 1 keşif kodu, ürün kodu değil (silinebilir)
  templates/   # hazır ekip şablonları (fullstack, api, fix)
  docs/        # ARCHITECTURE.md, claude-cli-notes.md (Aşama 1 bulguları)
```

`core` hiçbir Node'a özel ya da arayüz paketine bağlı değildir (tek bağımlılığı `zod`); hem sunucuda hem tarayıcıda çalışır.

## Teknoloji yığını

Tek dil: TypeScript. Sunucu, arayüz ve ortak tipler aynı dilde olur, katkı verenler için giriş eşiği düşer. Claude Code da npm ile kurulduğu için kullanıcının makinesinde Node.js zaten bulunur.

| Katman | Seçim | Neden | Alternatif |
| --- | --- | --- | --- |
| Dil | TypeScript (Node.js 20+) | Tek dil, tip güvenli olay ve şema yapısı | Python (kurulumu daha zor) |
| Paket yönetimi | pnpm workspaces | Monorepo, hızlı kurulum | npm workspaces |
| Sunucu | Fastify | Hızlı, şema doğrulamalı, SSE kolay | Hono, Express |
| Canlı olaylar | Server-Sent Events | Tek yönlü akış yeter, WebSocket'ten basit | WebSocket |
| Süreç yönetimi | `execa` + kendi süreç ağacı sonlandırmamız | `claude` sürecini başlatmak ve satır satır okumak için. execa ağacı kendisi öldürmez: Windows'ta `taskkill /T /F`, POSIX'te `detached` süreç grubu ve `kill(-pid)` (`packages/server/src/runner/kill-tree.ts`) | `child_process` |
| Git | `git` komutu, doğrudan execa ile (`packages/server/src/git/git.ts`) | Worktree ve diff için resmi komutlar; gereken birkaç komut için ayrı sarıcıya gerek yok | `simple-git`, `isomorphic-git` (worktree zayıf) |
| Depo | SQLite (`better-sqlite3`) + Drizzle ORM | Kurulum gerektirmez, tek dosya. `better-sqlite3` tüm platformlar için hazır derlenmiş binary'lerle gelir; build script'ine izin verilmez (`pnpm-workspace.yaml` → `ignoredBuiltDependencies`), yoksa pnpm C++ derleyicisi isteyen `node-gyp`'i çalıştırır | JSON dosyaları |
| Şema doğrulama | Zod | Plan, şablon ve olay şemaları | Ajv |
| Arayüz | React + Vite | Olgun ekosistem, hızlı geliştirme | Svelte, Solid |
| Stil | Tailwind CSS (tasarım token'larıyla) | Tasarımdaki renk ve boşlukları token yapmak kolay | CSS Modules |
| Arayüz durumu | TanStack Query + SSE, hafif Zustand | Sunucu verisi ve canlı olay ayrımı | Redux |
| Test | Vitest, Playwright | Birim ve uçtan uca (kayıtlı CLI çıktılarıyla) | Jest |
| Dağıtım | npm paketi, `npx ekip-panosu` | Tek komut kurulum | Tauri masaüstü uygulaması (sonra) |

**Neden masaüstü uygulama değil?** İlk sürümde `npx` ile açılan yerel web uygulaması yeterli, imzalama ve yükleyici derdi yok. Talep olursa aynı sunucu Tauri veya Electron kabuğuna konabilir.

## Claude Code entegrasyonu

Uygulama Claude Code'u başsız modda çalıştırır. Kimlik bilgisine dokunmaz, kullanıcının kendi girişini kullanan resmi CLI'ı çağırır.

**Kullanılacak bayraklar** ([CLI belgeleri](https://docs.claude.com/en/docs/claude-code/headless), [bayrak listesi](https://www.mintlify.com/shanraisshan/claude-code-best-practice/best-practices/cli-startup-flags)). Aşama 1'de Claude Code 2.1.150 ile tek tek denendi; ayrıntılar ve ham çıktılar [claude-cli-notes.md](claude-cli-notes.md) içinde.

| Bayrak | Ne için | Aşama 1'de görülen |
| --- | --- | --- |
| `-p`, `--print` | Etkileşimsiz çalıştırma | Çalışıyor |
| `--output-format stream-json` | Satır satır JSON olayları (canlı izleme) | **`--verbose` zorunlu**, yoksa exit 1 |
| `--output-format json` | Tek seferde sonuç; `result`, `session_id`, `total_cost_usd`, `num_turns` gibi alanlar | Çalışıyor |
| `--session-id <uuid>` | Oturum kimliğini süreci başlatmadan biz belirleriz, DB'ye önceden yazılır | Çalışıyor |
| `--resume <session_id>` | Oturumu devam ettirme (karar, izin, değişiklik isteği, durdurulan iş) | Çalışıyor, ama **yalnızca aynı klasörden** |
| `--fork-session` | Resume ederken yeni oturum kimliği (alternatif deneme) | Çalışıyor |
| `--permission-mode`, `--allowedTools` | İzin politikası ve araç beyaz listesi; `Bash(npm test:*)` söz dizimi geçerli | Çalışıyor; red işi **durdurmuyor** (aşağıda) |
| `--tools` | Kullanılabilir araç kümesini daraltmak (Planner ve Reviewer için salt okunur küme) | Çalışıyor |
| `--append-system-prompt` | Ajanın rol talimatını eklemek | Çalışıyor |
| `--json-schema` | Planner ve Reviewer çıktısını şemaya zorlamak (yalnızca print modunda) | Çalışıyor; çıktı `result.structured_output` alanında |
| `--max-budget-usd` | Bir koşunun asıl sınırı | Listede var |
| `--max-turns` | Tur sınırı | `--help`'te **yok** ama çalışıyor; kaldırılabilir, tek sınır olarak güvenilmez |
| `--strict-mcp-config` | Kullanıcının MCP sunucularını yüklememek | Çalışıyor |
| `--include-partial-messages` | Kısmi metin akışı (isteğe bağlı, "yazıyor…" efekti) | Çalışıyor, ilk sürümde gerekmiyor |

**Örnek çağrı (Backend işi)**

```bash
cd ~/.squadboard/worktrees/<proje-id>/auth-api-9f3c
claude -p "$GÖREV_METNİ" \
  --session-id "$RUN_SESSION_ID" \
  --append-system-prompt "$(cat .team/backend.md)" \
  --output-format stream-json --verbose \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Grep,Glob,Bash(npm test:*)" \
  --strict-mcp-config \
  --max-budget-usd 2
```

`stream-json` ile `--verbose` **zorunludur**; olmadan CLI JSON üretmeden exit 1 ile çıkar.

**Olay ayrıştırma.** Her satır bir JSON nesnesi: `system/init` (oturum kimliği, model, araçlar), `assistant`, `user` (araç sonuçları), `rate_limit_event`, en sonda `result` (maliyet, tur sayısı, `permission_denials`, varsa `structured_output`). Bir API mesajı tek olay değildir: her içerik bloğu (thinking, araç çağrısı, metin) aynı `message.id` ile ayrı satır gelir. Ayrıştırıcı `packages/core` içindeki adaptördedir (`createClaudeStreamAdapter`); ham satırları uygulamanın `AgentEvent` tiplerine çevirir, tanımadığı olayı çökmeden `unknown` olarak geçirir ve Aşama 1'de kaydedilen gerçek CLI çıktılarıyla test edilir. Bazı hatalar (bilinmeyen oturum, eksik `--verbose`) yalnızca stderr'e yazılır; bunlar ayrıca sınıflandırılır (`classifyCliStderr`).

**Karar alınması.** Başsız modda ajan sana söz ortasında soru soramaz. Aşama 1 ölçümü: "karar gerekiyorsa dur" talimatıyla ajan 10 denemenin hiçbirinde durmadı; ölçütler tek tek sayılınca 10/10 durdu ama cevaptan sonra yeni bir soru sordu (zincirleme soru). Bu yüzden:

1. **Asıl yol: Planner sorar.** Planner planı üretirken kendi veremeyeceği kararları `openDecisions[]` olarak döndürür (bkz. Plan akışı). Sen bunları **plan onayında** cevaplarsın; cevaplar ilgili işlerin talimatına eklenir. Kararlar iş başlamadan, tek seferde alınır.
2. **Yedek yol: KARAR bloğu.** Ajan çalışırken yine de beklenmedik bir seçimle karşılaşırsa durur ve son mesajına **tüm açık kararları tek blokta** yazar (`{"questions": [{question, options}]}`; tek soruluk biçim de kabul edilir). Runner bloğu yakalar, işi `waiting_decision` durumuna geçirir, arayüzde Kararın lazım kutusunu gösterir. Seçim gelince aynı oturum `--resume` ile "Karar: …" mesajıyla sürdürülür.

**İzin istekleri.** Başsız modda izin sorulamaz; beyaz liste dışındaki araç reddedilir. ⚠️ Red **işi durdurmaz**: ajan reddi araç sonucu olarak görür, başka yoldan devam eder ya da vazgeçer ve iş `success` ile biter. Reddedilen çağrılar yalnızca `result.permission_denials[]` içinde (araç adı ve tam girdi) listelenir. Bu yüzden runner her işin sonunda bu listeye bakar; boş değilse işi başarılı saymaz, "Şu komuta izin verelim mi?" kartını gösterir. Onay gelirse `--allowedTools` genişletilir ve oturum `--resume` ile "İzin verildi, tekrar dene" mesajıyla sürer. İzinleri MCP aracına yönlendiren bayrak v1'de kullanılmaz.

**Runner** (`packages/server/src/runner/`, Aşama 3). Her `claude -p` süreci bir `runs` satırıdır. Runner süreci execa ile başlatır (`--session-id` önceden üretilir, ortam temizlenir), stdout'u satır satır core adaptöründen geçirir, her olayı önce veritabanına (`seq` sırasıyla) yazar sonra yayınlar. Süreç kapanınca sonucu belirler:

| Durum | Run | İş |
| --- | --- | --- |
| `result` başarılı, KARAR yok, red yok | `succeeded` | `in_review` |
| `result` başarılı + geçerli KARAR bloğu (sorular `decisions` tablosuna `agent` kaynağıyla yazılır) | `succeeded` | `waiting_decision` |
| `result` başarılı + `permission_denials` boş değil | `succeeded` | `waiting_decision` |
| `result` hatalı (`error_max_turns` gibi) ya da `result` yok (stderr hatası, süreç başlamadı) | `failed` | `failed` |
| `stop()` çağrıldı | `stopped` | `stopped` |

`resume()` işin son oturumunu, o oturumun kaydedildiği klasörden `--resume` ile sürdürür; başka bir klasör verilirse süreci başlatmadan hata verir. Testler gerçek CLI yerine `packages/server/test/fake-claude.mjs` ile çalışır: Aşama 1 kayıtlarını oynatır, `--verbose` ve klasöre bağlı oturum davranışını taklit eder, durdurma testi için torun süreç başlatabilir. CI'da gerçek `claude` gerekmez.

**HTTP API** (`packages/server/src/routes/`, Aşama 4–5). Hepsi anahtar ister (yukarıdaki Güvenlik bölümü). Hatalar `{ "error": "…" }` olarak döner (400 geçersiz girdi, 404 bulunamadı, 409 şu an yapılamaz).

| Uç nokta | Ne yapar |
| --- | --- |
| `GET /api/projects` | Projeler: yol, ana dal, kullanıcının çalışma ağacı temiz mi (`clean`), görev sayısı. |
| `POST /api/projects` | `{ path }`. Mutlak yol, commit'i olan bir git reposu olmalı (alt klasör verilirse repo köküne çevrilir). O an çıkış yapılmış dal "ana dal" olur. Aynı repo ikinci kez eklenirse var olan proje döner. |
| `GET /api/projects/:id/tasks` | Görevler (oluşturulma sırasıyla): durum, ajan, dal, değişen ve beklenmeyen dosyalar, git hatası, son run. |
| `POST /api/projects/:id/tasks` | `{ title, prompt, agent?, expectedFiles?, dependsOn? }`. `dependsOn` bitmemiş bir görevse yeni görev `blocked` başlar. |
| `GET /api/tasks/:id` | Tek görev. |
| `POST /api/tasks/:id/start` | Worktree'yi (yoksa) açar ve görevi orada başlatır. Çalışıyorsa, bağımlılığı bitmediyse ya da durumu izin vermiyorsa 409. |
| `POST /api/tasks/:id/stop` | Görevin çalışan sürecini (ağacıyla) durdurur. |
| `POST /api/tasks/:id/cleanup` | `{ deleteBranch? }`. Worktree'yi siler; dal varsayılan olarak kalır. Çalışan görevde ya da dalı hâlâ başlangıç noktası olarak bekleyen bir görev varken dal silme isteğinde 409. |
| `GET /api/runs` | Son 50 run: istek metni, klasör, durum, iş durumu, maliyet, tur, süre, `active`. |
| `GET /api/runs/:id` | Tek run özeti. |
| `POST /api/runs/:id/stop` | Süreç ağacını öldürür, güncel özeti döner (bitmiş run'da etkisizdir). |
| `GET /api/runs/:id/events` | SSE. Önce kayıtlı olaylar `seq` sırasıyla (`event: agent`, `id: <seq>`), sonra canlı olanlar, en sonda `event: end` ile run özeti; ardından bağlantı kapanır. `Last-Event-ID` ya da `?after=` ile kalınan yerden devam eder. 15 sn'de bir yorum satırı (`: ping`) bağlantıyı canlı tutar. |

Geçmişi oynatma ile canlı dinlemeye geçiş aynı senkron adımda yapılır: `better-sqlite3` senkron çalışır ve runner her olayı yayınlamadan önce veritabanına yazar; bu yüzden aradaki bir olay kaybolamaz ya da iki kez gönderilemez.

Ajanlar şimdilik tek bir varsayılanla çalışır (`DEFAULT_AGENT_OPTIONS`, `tasks/task-service.ts`): `acceptEdits`, araçlar `Read, Edit, Write, Glob, Grep`, hem `--tools` (kullanılabilir araç kümesi) hem `--allowedTools` ile; yalnızca `--allowedTools` kabuk komutlarını engellemiyor (bkz. claude-cli-notes §13). Bütçe $1. Ajan adı (`general`, `backend`…) yalnızca etiket; gerçek ajanlar ve araç listeleri ileride `.team/` şablonlarından gelecek. Aşama 4'teki "klasörde doğrudan çalıştır" ucu (`POST /api/runs`) Aşama 5'te kaldırıldı, çünkü ajanı kullanıcının çalışma ağacında çalıştırıyordu; run'lar artık yalnızca görevler üzerinden, görevin worktree'sinde başlar.

**Oturum ve süreç.**

- Oturumlar `~/.claude/projects/<klasör>/` altında, **çalışma klasörüne bağlı** tutulur. Bir işin oturumu yalnızca kendi worktree yolundan `--resume` edilebilir; bu yüzden worktree yolu `runs` tablosunda saklanır ve iş kapanmadan worktree silinmez.
- Durdurma: Windows'ta `child.kill()` yalnızca `claude.exe`'yi öldürür, ajanın başlattığı bash ve node süreçleri yetim kalır. Süreç ağacı Windows'ta `taskkill /PID <pid> /T /F` ile, POSIX'te süreç grubu (`detached` + `process.kill(-pid)`) ile sonlandırılır. Öldürülen koşuda `result` olayı gelmez; runner bunu `stopped` sayar. Öldürülen oturum sonradan `--resume` ile sürdürülebilir.
- Windows'ta npm'in `claude.cmd` dosyası yalnızca `bin/claude.exe`'ye yönlendirir; `.exe` doğrudan çalıştırılır (`shell: true` argüman tırnaklamasını bozar).
- Sunucu bir Claude Code oturumunun içinden başlatılırsa `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` gibi oturum değişkenleri alt süreçlere geçer; runner bunları temizleyerek başlatır. Temizlik açık bir yasak listesiyle yapılır (`claude-cli.ts`), çünkü `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_API_KEY` gibi kullanıcı ayarları korunmalıdır.
- POSIX'te süreç `detached` başlatıldığı için Squadboard kapanırsa ajan süreçleri kendiliğinden ölmez. Bu yüzden sunucu `SIGINT`, `SIGTERM`, `SIGHUP` (Windows'ta ayrıca `SIGBREAK`; Windows'ta Ctrl+C `SIGINT` olarak gelir) aldığında önce `runner.stopAll()` ile tüm süreç ağaçlarını öldürür, run sonrası git işlerinin (commit, değişen dosyalar) bitmesini bekler (`tasks.drain()`), sonra HTTP sunucusunu ve veritabanını kapatır (`packages/server/src/shutdown.ts`). İkinci sinyal hemen çıkar. Sunucu zorla öldürülürse (`kill -9`, Görev Yöneticisi) bu çalışmaz; açılışta yetim run'ları `stopped` yapmak sonraki bir aşamanın işi.
- `-p` modunda kullanıcının global ayarları, skill'leri ve hafızası yüklenir; ajan davranışı kullanıcıdan kullanıcıya değişebilir. `--strict-mcp-config` MCP sunucularını kapatır; `--setting-sources` ileride değerlendirilir (`--bare` abonelikle çalışmaz).

**Git worktree stratejisi** (`packages/server/src/git/`, `packages/server/src/tasks/`, Aşama 5)

Claude Code'un kendi [`--worktree`/`-w` bayrağı](https://claudefa.st/blog/guide/development/worktree-guide) da var; biz worktree'yi kendimiz `git worktree add` ile açıyoruz, çünkü dal adını ve yığın dalları biz belirlemek istiyoruz.

*Temel kural: kullanıcının çalışma ağacına ve ana dalına asla dokunulmaz.* Squadboard kullanıcının klasöründe dosya yazmaz, `checkout` / `reset` / `commit` yapmaz, çıkış yapılmış dalı ve `main` ref'ini oynatmaz. Repoya dokunan tek şeyler `git worktree` kayıtları (`.git/worktrees/`) ve `team/` altındaki dallardır. Git servisi `team/` dışında dal oluşturmayı, silmeyi ve commit atmayı reddeder. Testler her senaryodan sonra kullanıcı reposunun dalını, HEAD'ini, `main` ref'ini ve `git status` çıktısını karşılaştırır.

| Konu | Karar |
| --- | --- |
| Worktree yeri | `~/.squadboard/worktrees/<proje-id>/<dal-adı>` (`SQUADBOARD_WORKTREES` ile değiştirilebilir). Kullanıcının reposunun **dışında**: rapordaki `.ekip/worktrees` yolu çalışma ağacına izlenmeyen bir klasör eklerdi. |
| Dal adı | `team/<başlık-slug>-<görev id'sinin ilk 4 karakteri>`, Türkçe karakterler ASCII'ye çevrilir (`Giriş API` → `team/giris-api-9f3c`). |
| Ne zaman açılır | Görev ilk kez başlatılınca. Temizlendikten sonra yeniden başlatılırsa aynı yolda, var olan dal üzerinde yeniden açılır; böylece Claude oturumu (klasöre bağlı) da sürdürülebilir kalır. |
| Başlangıç noktası | Bağımlılığı yoksa projenin ana dalı. Bağımlılığı varsa o görevin dalı (**yığın dal**). Başlangıç commit'i (`baseCommit`) kaydedilir; değişiklikler ona göre ölçülür. Şimdilik en fazla bir bağımlılık; birden çoğu iki dalı birleştirmeyi gerektirir (Aşama 8). |
| Bağımlılık | Bağımlı görev, bağımlılığı `in_review` ya da `done` olana kadar `blocked` kalır; bağımlılık bitince otomatik `planned` olur. |
| Ajanın işi | Run `in_review` ile bitince worktree'deki her şey görevin **kendi dalına** commit'lenir (`squadboard: <başlık>`), bağımlı görev bu commit'ten başlar. Repoda `user.email` yoksa "Squadboard &lt;squadboard@localhost&gt;" kimliği kullanılır. Durdurulan ya da beklemeye düşen işler commit'lenmez. |
| Değişen dosyalar | Her run'dan sonra `git diff --name-only <baseCommit>` + izlenmeyen yeni dosyalar. `expectedFiles` doluysa bunlarla eşleşmeyenler `unexpectedFiles` olarak işaretlenir (arayüzde uyarı). Desen eşleme core'daki `patternsOverlap` ile. |
| Temizlik | `git worktree remove --force` + `prune`. Dal varsayılan olarak kalır (commit'lenmiş iş onda). İstenirse dal da silinir; ama dalı başlangıç noktası olarak bekleyen bir görev varsa reddedilir. Çalışan görev temizlenemez. |
| Eşzamanlılık | Aynı repoda git işlemleri repo başına bir kilitle sıraya alınır (`.git` kilit dosyalarına takılmamak için). |
| Kullanıcının bekleyen değişiklikleri | Proje görünümünde `clean: false` ise uyarı gösterilir: ajanlar commit'lenmemiş değişiklikleri görmez, çünkü worktree'ler commit'ten açılır. |

**Alternatif: Agent SDK.** `@anthropic-ai/claude-agent-sdk` aynı motoru kütüphane olarak sunuyor, ama belgelere göre ürün yapan geliştiricilerin API anahtarı kullanması bekleniyor (bölüm 11). Bu yüzden CLI'ı doğrudan çağırmak ilk tercihimiz; SDK, API anahtarıyla çalışmak isteyenler için ikinci bir sürücü (driver) olabilir.

## Ajan ve ekip şablonu formatı

Bir ekip, projede `.team/` klasöründe duran dosyalardan oluşur ve git'e eklenebilir. Rol talimatları Claude Code'un alt ajan (subagent) biçimine benzer: Markdown dosyası, üstte YAML başlık (`name`, `description`, `tools`, `model`), altında sistem talimatı ([belge](https://docs.claude.com/en/docs/claude-code/sub-agents)). Arayüze özel alanlar (isim, renk, sahip olduğu dosyalar) ayrı bir `team.json` dosyasında durur, böylece başlık alanı Claude Code ile uyumlu kalır.

**`.team/backend.md`**

```markdown
---
name: backend
description: API uç noktaları, iş mantığı ve kimlik doğrulama yazar.
tools: Read, Edit, Write, Grep, Glob, Bash
model: sonnet
---
Sen bu projenin Backend ajanısın. Yalnızca `src/api/**` ve `src/server/**` içinde çalış.
Karar gerekiyorsa işi durdur ve son mesaja bir KARAR bloğu yaz: soru ve seçenekler.
İş bitince ne değiştirdiğini üç maddede özetle.
```

**`.team/team.json`**

```json
{
  "id": "fullstack",
  "name": "Full-stack web uygulaması",
  "agents": [
    {
      "id": "backend",
      "file": "backend.md",
      "names": { "tech": "Backend", "friendly": "Motor" },
      "color": "#8FB3FF",
      "owns": ["src/api/**", "src/server/**"]
    }
  ],
  "settings": { "concurrency": 3, "worktrees": true, "requirePlanApproval": true, "requireReview": true }
}
```

- `owns`: ajanın dokunması beklenen yollar. Planlayıcı görevleri buna göre dağıtır, çakışma tahmini de bundan beslenir.
- `names`: iki isim modu. Yeni bir alan (içerik ekibi gibi) eklemek yeni bir şablon klasörü eklemekten ibaret olur.
- Kullanıcı kendi ajanını arayüzden ya da dosya ekleyerek ekler. Ajan adı `claude` ya da `anthropic` içermemelidir (alt ajan ad kuralı).

## Plan akışı, bağımlılık ve çakışma yönetimi

Planlayıcı çıktısı kesin bir JSON şemasına bağlıdır (`--json-schema` ile zorlanır; sonuç `result.structured_output` alanından okunur ve Zod ile bir kez daha doğrulanır). Her iş şunları taşır: `id`, `title`, `agent`, `dependsOn[]`, `expectedFiles[]`. Planlayıcının kendi başına veremediği kararlar `openDecisions[]` içinde gelir: `id`, `question`, `options` (2–4), `taskIds` (boşsa tüm planı etkiler).

```json
{
  "tasks": [
    { "id": "db", "title": "users ve oturum tabloları", "agent": "database", "dependsOn": [], "expectedFiles": ["db/migrations/*"] },
    { "id": "api", "title": "Giriş ve kayıt API", "agent": "backend", "dependsOn": ["db"], "expectedFiles": ["src/api/auth.ts", "src/types/user.ts"] },
    { "id": "ui", "title": "Giriş formu", "agent": "frontend", "dependsOn": ["api"], "expectedFiles": ["src/pages/login.tsx"] }
  ],
  "openDecisions": [
    { "id": "session", "question": "Oturum nasıl tutulsun?", "options": ["Cookie + sunucu oturumu", "JWT"], "taskIds": ["db", "api"] }
  ]
}
```

Doğrulama ve sıralama `packages/core` içindedir (`validatePlan`, `computeStages`, `schedulePlan`): tekrarlanan ya da bilinmeyen iş kimlikleri, bilinmeyen ajanlar ve bağımlılık döngüleri (döngünün yoluyla birlikte) hata olarak raporlanır.

**Aşamalar.** Sunucu, `dependsOn` bağlarından topolojik sıralama ile aşamaları hesaplar. Aynı aşamadaki işler eşzamanlılık sınırına kadar paralel başlar.

**Çakışma önleme (3 katman)**

1. Plan zamanı: aynı aşamadaki iki işin `expectedFiles` listeleri çakışıyorsa (glob desenleri dahil, emin olunamayan durumda çakışıyor sayılır) sunucu ikisini ardışık yapar (plandaki sırasıyla, sonraki öncekine bağımlı olur) ve plan ekranında bunu uyarı olarak gösterir. Aynı dosyaya dokunan üç iş `a → b → c` zinciri olur. Planlayıcı de aynı kuralı talimat olarak alır.
2. Çalışma zamanı: her iş kendi worktree ve dalında koşar. Bağımlı bir iş, önceki işin dalından başlar (yığın dallar), böylece önceki işin tip ve dosyalarını görür.
3. Birleştirme zamanı: iş bitince `git diff --name-only` gerçek dosyaları verir. Beklenenin dışına çıkılmışsa inceleme ekranında bu not edilir. Birleştirme çakışırsa iş "Değişiklik gerekli" durumuna düşer ve ilgili ajan güncel dalı alarak çözmesi için çalıştırılır.

**Plan onayı.** Ayar açıksa hiçbir ajan plan onaylanmadan başlamaz. Planlayıcının `openDecisions` soruları bu ekranda cevaplanır; cevaplanmamış karar varken plan başlatılamaz. Kullanıcı kart silebilir, ekleyebilir, ajanı değiştirebilir; sunucu değişiklikten sonra aşamaları ve çakışma kontrolünü yeniden hesaplar. "Planı yeniden oluştur" aynı isteği Planner'a tekrar verir.

**Reviewer.** Salt okunur araçlarla çalışır (`Read, Grep, Glob` ve diff için kısıtlı `Bash`). Çıktısı şemalı JSON: `summary` (sade dil), `risk` (düşük, orta, yüksek), `checks[]` (başlık, not, durum), `files[]`. Bu çıktı İnceleme ekranını doğrudan besler. Proje ayarlarında bir test komutu tanımlıysa test sonucu da kontrollere eklenir.

## Veri modeli ve durum yönetimi

Tek bir SQLite dosyası, kullanıcının ana dizininde: `~/.squadboard/squadboard.db` (`SQUADBOARD_DB` ile değiştirilebilir). Proje klasörüne yazılmaz, böylece kullanıcının deposunu kirletmez ve birden çok proje tek yerde durur; her kayıt `projects.path` ile projesine bağlıdır. Erişim `better-sqlite3` + Drizzle ORM ile, şema `packages/server/src/db/schema.ts`, migration'lar `packages/server/drizzle/` altında (sunucu açılışta bekleyen migration'ları uygular). Olaylar yalnızca eklenir; arayüz durumu olaylardan türetilir, böylece sayfa yenilense ya da sunucu yeniden başlasa kaldığı yerden devam edilir.

| Tablo | Ana alanlar |
| --- | --- |
| `projects` | id, yol, ana dal, test komutu, ayarlar |
| `requests` | id, project, metin, oluşturma zamanı, plan JSON'u |
| `tasks` | id (tüm sistemde tekil; plandaki kısa kimlikler istek içinde tekil olduğundan sunucu bunları ad alanına koyar), request, başlık, ajan, bağımlılıklar, beklenen dosyalar, dal, worktree yolu, başlangıç dalı ve commit'i, değişen dosyalar, beklenmeyen dosyalar, git hatası, durum, aşama |
| `runs` | id, task, oturum kimliği, çalışma klasörü (resume için), devam ettirdiği run, pid, exit code, hata, başlangıç, bitiş, sonuç durumu, maliyet, tur sayısı |
| `events` | id, run, sıra (`run` içinde tekil), tip, `AgentEvent` JSON'u, ham CLI satırı (o satırdan çıkan ilk olayda) |
| `decisions` | id, request, task (Planner kararlarında boş), kaynak (`planner` / `agent`), soru, seçenekler, seçim, zaman |
| `reviews` | id, task, özet, risk, kontroller, dosyalar, karar (onay, geri gönder) |

**İş durumları**

| Durum | Panodaki sütun | Geçiş |
| --- | --- | --- |
| `planned` | Planlandı | Plan onaylandı |
| `blocked` | Planlandı | Bağımlı olduğu iş bitmedi |
| `running` | Çalışıyor | Başladı |
| `waiting_decision` | Çalışıyor (Kararın lazım) | Ajan KARAR bloğu yazdı (yedek yol) ya da izin reddedildi |
| `in_review` | İncelemede | İş bitti, Reviewer çalışıyor ya da sıra sende |
| `changes_requested` | Çalışıyor | Sen geri gönderdin |
| `done` | Bitti | Birleştirildi |
| `failed`, `stopped` | Çalışıyor (kart kırmızı/gri) | Hata ya da kullanıcı durdurdu |

Geçişler `packages/core` içindeki durum makinesinde tanımlıdır; geçersiz geçiş hata verir. Bir iş `in_review`'dan geçmeden `done` olamaz.

Sunucu başlangıcında çalışıyor görünen ama süreci ölen işleri `stopped` yapar ve "Kaldığı yerden sürdür" seçeneği sunar (`--resume` ile, işin kendi worktree klasöründen).

## Güvenlik ve izinler

Uygulama bilgisayarında kod çalıştıran ajanları yönetiyor; bu yüzden varsayılanlar kapalı taraftadır.

- **Yerel sunucu.** Yalnızca `127.0.0.1`'e bağlanır. Her başlatışta rastgele bir oturum anahtarı (32 bayt, base64url) üretilir. Her istek sırayla üç denetimden geçer (`packages/server/src/security.ts`):
  1. **Host:** hostname `127.0.0.1`, `localhost` ya da `[::1]` olmalı, yoksa 403. DNS rebinding'i engeller: `evil.com` 127.0.0.1'e çözülse bile tarayıcı `Host: evil.com` gönderir.
  2. **Origin:** varsa, izinli listedeki bir değerle **port dahil** birebir eşleşmeli, yoksa 403. Böylece başka siteler, localhost'ta başka bir portta çalışan uygulamalar da dahil, API'yi çağıramaz. İzinli liste sunucunun kendi adresidir; geliştirmede Vite'ın adresi (`127.0.0.1:5173`) eklenir.
  3. **Anahtar:** `/api` altındaki her istek anahtar ister, yoksa ya da yanlışsa 401. `Authorization: Bearer` ile gönderilir; `EventSource` başlık gönderemediği için yalnızca GET isteklerinde `?token=` de kabul edilir. Karşılaştırma sabit sürelidir; anahtar loglara yazılmaz.

  `squadboard` komutu adresi `http://127.0.0.1:4317/#token=…` olarak yazar ve tarayıcıyı açar. Anahtar URL'nin **fragment** kısmındadır: sunucuya, loglara ve Referer başlığına gitmez. Sayfa onu yalnızca bellekte tutar (localStorage'a yazmaz); adres çubuğunda kaldığı için sayfa yenilenince çalışmaya devam eder. Sayfanın kendisi (statik dosyalar) anahtarsız sunulur, içinde gizli bilgi yoktur.
- **Ajan sınırları.** Her ajan yalnızca kendi worktree klasöründe ve kendi araç beyaz listesiyle çalışır. Her yetkiyi atlayan bayrak (`--dangerously-skip-permissions`) kullanılmaz.
- **Gizli dosyalar.** `.env` ve anahtar dosyalarının okunmasını yasaklayan izin kuralları şablonla gelir. Kural söz dizimi hedef Claude Code sürümünde doğrulanmalıdır.
- **Sınırlar.** `--max-budget-usd` (asıl sınır; `--max-turns` belgelenmemiş olduğu için yalnızca ek önlem), iş başına zaman aşımı ve eşzamanlılık üst sınırı (varsayılan 3). Durdurma basılınca süreç ağacının tamamı sonlandırılır (Windows'ta `taskkill /T /F`); yalnızca `claude` sürecini öldürmek ajanın başlattığı komutları yetim bırakır.
- **Birleştirme.** Hiçbir dal sen onaylamadan birleşmez. Uzak depoya push v1'de yoktur. Zorla push hiç yoktur.
- **Komut enjeksiyonu.** Dosya ve web içeriği ajanı yönlendirmeye çalışabilir. Bu yüzden Reviewer çıktısı kesin hakem sayılmaz; diff her zaman "kodun tamamını göster" ile açılabilir, otomatik birleştirme varsayılan değildir.
- **Veri.** Olaylar ve loglar yalnızca yerel diske yazılır, uygulama telemetri göndermez. Log kaydedilirken bilinen gizli anahtar desenleri maskelenir.

## Kimlik doğrulama, kullanım limitleri ve yasal çerçeve

**Tasarım ilkesi.** Uygulama kimlik bilgisini görmez, saklamaz, sunmaz. Kullanıcı Claude Code'a kendisi giriş yapar; uygulama yalnızca o resmi CLI'ı kullanıcının kendi bilgisayarında çalıştırır. Ayrı bir "Claude ile giriş" ekranı yoktur.

**Anthropic kuralları (ne biliyoruz)**

- Agent SDK belgelerine göre [üçüncü taraf geliştiriciler, önceden onay almadıkça ürünlerinde Claude.ai girişi ya da abonelik kullanım hakkı sunamaz](https://platform.claude.com/docs/en/agent-sdk).
- Yasal sayfa, Claude ile çalışan ürün yapanların API anahtarı kullanması gerektiğini söyler; aynı sayfada her son kullanıcının [kendi API anahtarı, abonelik bilgisi ya da bulut sağlayıcı kimliğiyle doğrulanması](https://code.claude.com/docs/en/legal-and-compliance) gerektiği de yazıyor.
- Sonuç: "Biz giriş sunuyoruz" modeli yasak, "kullanıcı kendi makinesinde kendi CLI'ını çalıştırıyor" modeli ise Kangentic ve Vibe Kanban gibi araçlarca kullanılıyor. Bu bir gri alan olabilir; yayından önce Anthropic'ten ya da bir avukattan teyit alınması önerilir. Ben avukat değilim, bu bir hukuki görüş değil.

**Kullanım kredisi.** [15 Haziran 2026'dan itibaren](https://code.claude.com/docs/en/agent-sdk/overview.md) aboneliklerde Agent SDK ve `claude -p` kullanımı, normal etkileşimli limitten ayrı bir aylık krediden düşüyor. Bizim tüm çalıştırmalarım `claude -p` olduğu için bu krediyi kullanır. Plana göre kredinin büyüklüğünü ve bitince ne olduğunu bilmiyorum; belgelerden netleştirilmelidir.

**Ürünün bu konudaki davranışı**

- Her çalıştırmanın maliyeti ve tur sayısı (`json` çıktısındaki `total_cost_usd`, `num_turns`) panoda gösterilir, toplam bir gösterge olarak biriktirilir.
- Kredi bitince CLI'ın hata verdiği durum özel olarak yakalanır; iş `stopped` olur ve kullanıcıya açık bir mesaj gösterilir. Aşama 1'de görüldü: stream'de aylık kredi hakkında bir alan **yok**, yalnızca 5 saatlik pencereyi bildiren `rate_limit_event` geliyor. Kredi bitimi bu yüzden hata metninden yakalanmalı; deneyde tetiklenemediği için biçimi henüz bilinmiyor.
- Ayarda `ANTHROPIC_API_KEY` ile çalışma seçeneği bulunur (kullanıcı kendi anahtarını ortam değişkenine koyar, uygulama görmez).

**Marka.** Ürün adında "Claude" geçmeyecek. Kurallar "… Powered by Claude" gibi bir kullanıma izin veriyor. Lisans önerisi: MIT ya da Apache-2.0.

## Yol haritası

Tarih vermiyorum; her aşama kendi ölçütüyle biter, bir sonrakine ancak o zaman geçilir.

Numaralar "Aşama Planı ve Promptlar" belgesindeki aşamalarla aynıdır.

| Aşama | Kapsam | Bitti sayılır | Durum |
| --- | --- | --- | --- |
| 0. İskelet | pnpm monorepo, TypeScript strict, ESLint/Prettier/Vitest, boş web sayfası, `GET /health`, CI (Linux + Windows) | `pnpm dev` ile web ve server kalkıyor; lint, test, build ve CI yeşil | ✅ |
| 1. CLI keşfi | `claude -p` biçimleri, `--resume`, izinler, `--json-schema`, KARAR ölçümü, süreç sonlandırma; gerçek çıktılar kaydedildi | [claude-cli-notes.md](claude-cli-notes.md) yazıldı, KARAR güvenilirliği sayısal | ✅ |
| 2. Core | Zod şemaları ve tipler, iş durum makinesi, stream-json adaptörü, KARAR ayrıştırıcı, plan doğrulama ve sıralama | Kayıtlı CLI çıktıları adaptörden hatasız geçiyor; geçersiz geçiş ve plan döngüsü testlerle yakalanıyor | ✅ |
| 3. Runner ve SQLite | SQLite + Drizzle (7 tablo, ilk migration), `claude -p` sürecini başlatma ve süreç ağacıyla sonlandırma, `--session-id` / `--resume`, `permission_denials` ve stderr hatalarını işleme, ortam temizliği, sahte CLI ile testler | Sahte CLI ile başlat, akış, durdur ve sürdür testleri Windows ve Linux'ta yeşil; olaylar DB'ye sırayla yazılıyor; durdurma sonrası artık süreç kalmıyor | ✅ (Windows ve Linux CI) |
| 4. Server, SSE ve prototip arayüz | Anahtar + Host/Origin denetimi, run API'si, SSE canlı akış, tek sayfalık arayüz, `squadboard` komutu, kapanışta `stopAll()` | Tarayıcıda prompt yazıp gerçek `claude` çıktısı canlı izleniyor; Durdur süreci öldürüyor; anahtarsız ya da yanlış Origin'li istek reddediliyor; yenileyince geçmiş run'lar görünüyor | ✅ (elle denendi) |
| 5. Proje, görev ve git worktree | Git servisi, proje ekleme, görev oluşturma ve başlatma, her görev kendi worktree ve `team/` dalında, yığın dallar, değişen/beklenmeyen dosyalar, temizlik, sıralı görev listesi | İki görev aynı anda ayrı worktree'lerde çalışıyor; kullanıcının klasöründe hiçbir dosya değişmiyor; git testleri yeşil, worktree temizlenebiliyor | ✅ (elle denendi) |
| 6. Pano ve tasarım sistemi | Tasarım token'ları (v2 paleti, Nunito + JetBrains Mono, 44 px / 13 px), uygulama kabuğu (menü, proje hapı, isim modu, bugünkü maliyet, mobil sekme çubuğu), v2-19 temel bileşenleri, Pano (karşılama, ajan şeridi, 4 sütun, görev kartları, ajan detayı), boş ve hata durumları; TanStack Query + SSE + Zustand, 2 sn yoklama kaldırıldı | Pano gerçek API ile açılıyor ve canlı güncelleniyor; isim modu değişip kalıcı; 390 px'te yatay taşma yok; Playwright smoke testleri CI'da yeşil | ✅ (smoke testleri; elle deneme bekliyor) |
| 7. Şablonlar ve Ekibini kur | `.team/` şablon yükleyici ve doğrulama, hazır şablonlar (fullstack, api, fix), ajan başına araç ve izin listeleri, Ekibini kur ekranı (v2-07) | Şablon seçilip ekip kuruluyor; ajanlar şablondaki araç ve izinlerle çalışıyor | |
| 8. Planner ve scheduler | Planner (`--json-schema`, `openDecisions`), Plan onayı ekranı (v2-05, v2-06), bağımlılık ve çakışma kontrolü, eşzamanlılık sınırıyla zamanlayıcı | Tek istekten 4-5 iş sırayla ve paralel çalışıyor | |
| 9. Karar ve izin akışı | Plan kararlarının onayda cevaplanması, KARAR yedek akışı, izin kartı (`permission_denials` → izin → `--resume`), Karar ekranı (v2-03) | Plan kararları onayda cevaplanıyor; ajan durunca karar ya da izin kartı çıkıyor, cevaptan sonra aynı oturum sürüyor | |
| 10. Reviewer ve merge | Reviewer şeması, İnceleme ekranı (v2-08), test komutu, Onayla ve birleştir (v2-09), Değişiklik iste | İnceleme akışı uçtan uca çalışıyor; onaylanan dal ana dala birleşiyor, worktree temizleniyor | |
| 11. Dayanıklılık ve güvenlik | Sunucu yeniden başlayınca yarım kalan run ve görevlerin toparlanması, kredi ve limit bitimi (v2-16), Claude bulunamadı (v2-15) gibi hata durumları, güvenlik denetiminin gözden geçirilmesi | Çökme ya da kapanış sonrası veri kaybolmuyor, yetim süreç kalmıyor; hata ekranları gerçek durumlarda çıkıyor | |
| 12. Yayın | `npx` paketi, Windows/macOS/Linux denemesi, README (kurulum, kredi uyarısı), lisans, kısa demo videosu | Temiz bir bilgisayarda tek komutla kurulup ilk işin bittiği görülüyor | |
| Sonrası | Topluluk şablonları, başka alanlar (içerik ekibi gibi), başka CLI sürücüleri, masaüstü kabuğu | Talebe göre | |

Aşama 1 en riskli adımdı ve raporun birkaç varsayımını değiştirdi (izin reddi, `--verbose`, KARAR, oturumun klasöre bağlı olması, süreç sonlandırma); bu belge o bulgulara göre güncellendi.

## Riskler ve açık sorular

| Risk | Etki | Önlem |
| --- | --- | --- |
| Aboneliğin başsız kullanım kredisi hızlı bitiyor | İş yarıda kalıyor, kullanıcı hayal kırıklığına uğrıyor | Maliyet göstergesi, düşük varsayılan eşzamanlılık, API anahtarı modu, açık hata mesajı |
| Anthropic kural veya fiyat değişikliği | Proje durabilir | Kimlik bilgisine dokunmama, sürücü soyutlaması (başka CLI'a geçebilmek), yayın öncesi teyit |
| CLI çıktı biçimi değişiyor | Canlı pano bozuluyor | İnce adaptör katmanı, kayıtlı çıktı testleri, desteklenen sürüm aralığı, tanınmayan olayı ham gösterme |
| Planlayıcı işi kötü bölüyor | Boşa iş, çakışma | Plan onayı, düzenleme, yeniden oluşturma, dosya sahipliği (`owns`) |
| Birleştirme çakışmaları | İş geri dönüyor | Yığın dallar, ardışık çalıştırma, "Değişiklik gerekli" akışı |
| İnceleme darboğazı | Ajanlar hızlı, sen yavaşsın | Sade Reviewer özeti, küçük işler, eşzamanlılık varsayılanı 3 |
| Yerel sunucuya kötü amaçlı erişim, komut enjeksiyonu | Dosya zararı ya da sızıntı | Bölüm 10 önlemleri |
| Kalabalık rakipler | Fark edilmemek | Odak: plan onayı, çakışma tahmini, sade inceleme, şablon ekosistemi |
| Windows yol ve süreç farkları | Kurulum sorunları, yetim süreçler | CI'da Linux ve Windows job'ı; Windows'ta süreç ağacı `taskkill /T /F` ile sonlandırılır |
| Ajanın gereksiz ya da zincirleme soru sorması | Kullanıcı sürekli bekliyor | Kararları Planner önceden topluyor; KARAR bloğu yedek ve tek seferde çok soru |

**Açık sorular**

- [x] Ajanlar KARAR bloğunu ne kadar güvenilir yazıyor? Aşama 1'de ölçüldü: gevşek talimatla 0/10, ölçütlü talimatla 10/10 ama zincirleme soru. Kararları Planner soruyor (aşağıda).
- [x] Worktree'yi biz mi açalım, yoksa `--worktree` bayrağı mı kullanalım? Biz açıyoruz (aşağıda).
- [ ] İzinleri MCP aracına yönlendiren bayrak ilk sürümde kullanılabilir mi? (v1'de kullanılmıyor.)
- [ ] Aylık Agent SDK kredisi plan bazında ne kadar ve bitince ne oluyor? Stream'de bu bilgi yok; Aşama 4'te gerçek veriyle bakılacak.
- [ ] Üçüncü taraf kuralının bu modelle ilgili yorumu için Anthropic'ten teyit.
- [x] Ürün adı ve lisans: Squadboard, MIT.
- [x] İlk sürümde yalnızca Claude Code.
- [ ] macOS/Linux'ta süreç grubu sonlandırma, worktree içinden çalıştırma ve kredi bitince CLI davranışı henüz denenmedi.
- [ ] Gerçekçi görevlerde Planner'ın ve ajanın gereksiz soru oranı (Aşama 8–9'da ölçülür).

**Alınan kararlar (17 Kasım 2026)**

- **İlk sürüm yalnızca Claude Code.** Çoklu CLI desteği ve ajan başına model seçimi sonraya. Sürücü soyutlaması baştan hazır kalır, böylece sonra başka CLI eklemek kolay olur.
- **Worktree'yi biz açıyoruz** (`git worktree add`): dal adı (`team/auth-api`) ve yığın dallar bizde kalır, kullanıcı temiz dal adları görür.
- **İzinler kullanıcıyı yormasın:** `--permission-mode acceptEdits` ve ajan başına `--allowedTools` beyaz listesi. Ajan listede olmayan bir aracı isterse CLI onu reddeder ama işi durdurmaz; runner iş bitince `result.permission_denials[]`'a bakar, boş değilse arayüzde "Şu komuta izin verelim mi?" kartı çıkar; onaylanırsa liste genişler ve oturum `--resume` ile sürer. MCP izin bayrağı v1'de kullanılmıyor. (Aşama 1 bulgusuyla güncellendi.)
- **Lisans: MIT.** En düşük sürtünme, katkı vermek ve kullanmak en kolay olanı.
- **Ürün adı: Squadboard.** npm'de "squadboard" boş. GitHub'da aynı adlı birkaç küçük depo var; biri (sabbour/squadboard) "Squad AI ajanları için yerel kanban panosu" diyor, 0 yıldızlı ama konsept benziyor. Alan adı ve marka kaydı bir kayıtçiden kontrol edilmeli.
- **Kararları Planner soruyor** (Aşama 1 ölçümünden sonra). Planner, plan aşamasında açık kararları `openDecisions[]` olarak üretir, kullanıcı plan onayında cevaplar. KARAR bloğu yalnızca ajanın çalışırken karşılaştığı beklenmedik seçimler için yedektir ve tüm soruları tek seferde sorar (çok sorulu biçim).
- **Sonraya bırakıldı:** abonelik kredisi ve Anthropic'ten kural teyidi (Aşama 4 prototipinden sonra, gerçek veriyle).

## Kaynaklar

Kaynaklar 17 Kasım 2026'da aranıp okundu. Teknik bayrak ve sürüm bilgileri değişebilir; uygulamaya geçmeden önce hedef Claude Code sürümünde denenmelidir.

- [Claude Code başsız mod belgesi](https://docs.claude.com/en/docs/claude-code/headless)
- [CLI başlangıç bayrakları (topluluk listesi)](https://www.mintlify.com/shanraisshan/claude-code-best-practice/best-practices/cli-startup-flags)
- [Alt ajan (subagent) belgesi](https://docs.claude.com/en/docs/claude-code/sub-agents)
- [Worktree rehberi](https://claudefa.st/blog/guide/development/worktree-guide)
- [Agent SDK – genel bakış ve kredi duyurusu](https://code.claude.com/docs/en/agent-sdk/overview.md)
- [Agent SDK – kimlik doğrulama ve marka kuralları](https://platform.claude.com/docs/en/agent-sdk)
- [Claude Code – yasal ve uyumluluk](https://code.claude.com/docs/en/legal-and-compliance)
- [MIT/Wharton: kod incelemesi darboğazı](https://hyrax.dev/blog/mit-wharton-code-review-bottleneck-2026)
- [Harvard çalışması: ajanlar %30 fazla kod yazıyor](https://forkast.news/?p=131724)
- [Vibe Kanban](https://openapps.pro/apps/vibe-kanban)
- [Kangentic](https://dev.to/tvorp/from-chaos-to-efficiency-a-visual-orchestration-layer-for-claude-code-lf6)
- [KanBots](https://feedbagel.com/post/open-source-kanban-desktop-app-that-runs-parallel-agents-on-every-card)
- [Claude Agent Teams UI](https://gentic.news/article/claude-agent-teams-ui-the-visual-dashboard-that-makes-agent-teams-actually-usabl)
- [Claude Code Agent View](https://cobusgreyling.substack.com/p/claude-code-agent-view)
- [Mergify: paralel ajanlarda darboğazın inceleme olması](https://mergify.com/blog/how-agents-work-with-parallel-agents)
