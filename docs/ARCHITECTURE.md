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

Tıklanabilir dört ekranlık taslak [Ajan Ekibim – Tasarım Taslağı](https://claude.ai/artifact/Sb2sNmJ27NvBkTsPmPLKbx) kanvasında duruyor. Her ekranın kapladığı iş aşağıda.

| # | Ekran | Amaç | Ana bileşenler | Veri kaynağı |
| --- | --- | --- | --- | --- |
| 1 | Ekibini kur | Projeyi, şablonu ve ajanları seçmek | Klasör ve dal alanı, şablon kartları (Full-stack, API, Hata düzelt), ajan listesi ve anahtarları, eşzamanlılık seçimi, üç ayar anahtarı (ayrı dal, plan onayı, Reviewer), isim modu anahtarı | `.team/` klasörü, proje ayarları |
| 2 | Plan onayı | Planlayıcının böldüğü işleri görüp düzeltmek | İstek kutusu, aşama sütunları, iş kartları (ajan, beklenen dosyalar, Kaldır, Ajanı değiştir), çakışma kontrolü kutusu, Planı onayla ve başlat | Planner çıktısı (JSON) |
| 3 | Pano | Çalışan işleri izlemek, karar vermek | Yeni iş kutusu, ajan şeridi (durum ve ne yaptığı), Kararın lazım kutusu, dört sütunlu iş panosu (Planlandı, Çalışıyor, İncelemede, Bitti), seçili ajanın sade özeti ve canlı çıktısı | Çalıştırma olayları (stream-json) |
| 4 | İnceleme | Bir işi onaylamak, geri göndermek | Ne değişti özeti, risk rozeti, risk kontrol listesi, değişen dosyalar, Onayla ve birleştir, Değişiklik iste | Reviewer çıktısı (JSON), git diff |

**Tasarım kararları**

- İsim modu: Teknik (Frontend, Backend, Database, Test, Reviewer, Planner) varsayılan; Sade (Pixel, Motor, Kutu, Dedektif, Usta, Kaptan) isteğe bağlı. İki isim de şablon dosyasında durur.
- Renk: zemin `#F6F3EE`, metin `#1F2430`, vurgu `#E8664A`, başarı `#2F9E6B`, uyarı `#B26A00`. Ajan renkleri pastel, kartlarda avatar olarak kullanılır.
- Yazı tipi: Nunito (arayüz), JetBrains Mono (dal, dosya ve çıktı).
- Erişilebilirlik: dokunma hedefi en az 44 px, metin kontrastı 4,5:1 ve üstü, durum yalnızca renkle değil metinle de gösterilir, anahtarlar `role="switch"`.
- Karar kutusu her zaman sayfanın üst yarısında; ajan bekliyorsa göz ardı edilemez.
- Canlı çıktı koyu zeminli ve ayrı bir kutuda; sade özet ise insan diliyle yazılmış üç dört satır.

## Mimari

Tüm parçalar kullanıcının bilgisayarında çalışır. Dışarı çıkan tek şey, Claude Code'un kendi Anthropic bağlantısıdır.

| Bileşen | Görev |
| --- | --- |
| Web arayüzü (React) | Dört ekran. Sunucuyla HTTP ile konuşur, canlı olayları SSE ile alır. |
| Yerel sunucu (Fastify) | API, olay akışı, statik arayüz dosyaları. Yalnızca `127.0.0.1`'e bağlanır. |
| Orkestratör | Planı bağımlılık grafiğine çevirir, hazır işleri eşzamanlılık sınırına göre başlatır, karar bekleyenleri durdurur. |
| Runner | `claude -p` sürecini başlatır, `stream-json` satırlarını okuyup olaylara çevirir, durdurma ve devam ettirmeyi yönetir. |
| Git servisi | Worktree oluşturma, diff, dal birleştirme, temizlik. |
| Şablon yükleyici | `.team/` klasörünü okur ve doğrular. |
| Depo (SQLite) | Projeler, işler, çalıştırmalar, olaylar, kararlar, incelemeler. |

**Veri akışı**

1. Kullanıcı isteği yazar. Sunucu Planner'ı çalıştırır ve JSON plan alır.
2. Plan arayüzde gösterilir. Kullanıcı düzenleyip onaylar.
3. Orkestratör işleri bağımlılık sırasına göre kuyruğa alır. Her iş için bir worktree ve dal açılır (`team/<ad>`).
4. Runner ilgili ajanla `claude -p` başlatır. Çıkan olaylar veritabanına yazılır ve arayüze akar.
5. İş bitince Reviewer çalışır, inceleme özetini üretir. İş "İncelemede" sütununa geçer.
6. Kullanıcı onaylarsa Git servisi dalı `main`'e birleştirir, worktree'yi siler. Değişiklik isterse not, aynı oturuma `--resume` ile gönderilir.

**Klasör yapısı (monorepo, pnpm workspaces)**

```
ekip-panosu/
  packages/
    core/      # tipler, şablon şeması, plan şeması, olay tipleri
    server/    # Fastify, orkestratör, runner, git, SQLite
    web/       # React arayüzü (Vite)
  templates/   # hazır ekip şablonları (fullstack, api, fix)
  docs/
```

## Teknoloji yığını

Tek dil: TypeScript. Sunucu, arayüz ve ortak tipler aynı dilde olur, katkı verenler için giriş eşiği düşer. Claude Code da npm ile kurulduğu için kullanıcının makinesinde Node.js zaten bulunur.

| Katman | Seçim | Neden | Alternatif |
| --- | --- | --- | --- |
| Dil | TypeScript (Node.js 20+) | Tek dil, tip güvenli olay ve şema yapısı | Python (kurulumu daha zor) |
| Paket yönetimi | pnpm workspaces | Monorepo, hızlı kurulum | npm workspaces |
| Sunucu | Fastify | Hızlı, şema doğrulamalı, SSE kolay | Hono, Express |
| Canlı olaylar | Server-Sent Events | Tek yönlü akış yeter, WebSocket'ten basit | WebSocket |
| Süreç yönetimi | `execa` | `claude` sürecini satır satır okumak ve sonlandırmak için | `child_process` |
| Git | `git` komutu (`simple-git` sarıcı) | Worktree ve diff için resmi komutlar | `isomorphic-git` (worktree zayıf) |
| Depo | SQLite (`better-sqlite3`) + Drizzle ORM | Kurulum gerektirmez, tek dosya | JSON dosyaları |
| Şema doğrulama | Zod | Plan, şablon ve olay şemaları | Ajv |
| Arayüz | React + Vite | Olgun ekosistem, hızlı geliştirme | Svelte, Solid |
| Stil | Tailwind CSS (tasarım token'larıyla) | Tasarımdaki renk ve boşlukları token yapmak kolay | CSS Modules |
| Arayüz durumu | TanStack Query + SSE, hafif Zustand | Sunucu verisi ve canlı olay ayrımı | Redux |
| Test | Vitest, Playwright | Birim ve uçtan uca (kayıtlı CLI çıktılarıyla) | Jest |
| Dağıtım | npm paketi, `npx ekip-panosu` | Tek komut kurulum | Tauri masaüstü uygulaması (sonra) |

**Neden masaüstü uygulama değil?** İlk sürümde `npx` ile açılan yerel web uygulaması yeterli, imzalama ve yükleyici derdi yok. Talep olursa aynı sunucu Tauri veya Electron kabuğuna konabilir.

## Claude Code entegrasyonu

Uygulama Claude Code'u başsız modda çalıştırır. Kimlik bilgisine dokunmaz, kullanıcının kendi girişini kullanan resmi CLI'ı çağırır.

**Kullanılacak bayraklar** ([CLI belgeleri](https://docs.claude.com/en/docs/claude-code/headless), [bayrak listesi](https://www.mintlify.com/shanraisshan/claude-code-best-practice/best-practices/cli-startup-flags))

| Bayrak | Ne için |
| --- | --- |
| `-p`, `--print` | Etkileşimsiz çalıştırma |
| `--output-format stream-json` | Satır satır JSON olayları (canlı izleme) |
| `--output-format json` | Tek seferde sonuç; `result`, `session_id`, `total_cost_usd`, `num_turns` gibi alanlar |
| `--resume <session_id>`, `--session-id` | Oturumu devam ettirme (karar, değişiklik isteği) |
| `--permission-mode`, `--allowedTools` | İzin politikası ve araç beyaz listesi |
| `--append-system-prompt` | Ajanın rol talimatını eklemek |
| `--json-schema` | Planner ve Reviewer çıktısını şemaya zorlamak (yalnızca print modunda) |
| `--max-turns`, `--max-budget-usd` | Bir koşunun sınırı |
| `--include-partial-messages` | Kısmi metin akışı (isteğe bağlı) |

**Örnek çağrı (Backend işi)**

```bash
cd .ekip/worktrees/auth-api
claude -p "$GÖREV_METNİ" \
  --append-system-prompt "$(cat .team/backend.md)" \
  --output-format stream-json --verbose \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Grep,Glob,Bash(npm test:*)" \
  --max-turns 40
```

`stream-json` ile sürüme göre `--verbose` gerekebilir; örneklerde çoğunlukla birlikte kullanılıyor.

**Olay ayrıştırma.** Her satır bir JSON nesnesi. Oturum başlangıcında `session_id` alınır, ara mesajlarda araç çağrıları ve sonuçları gelir, son olay süre ve maliyet bilgisini taşır. Alan adları sürüme göre değişebileceğinden ayrıştırıcı ince bir adaptör katmanında durur ve gerçek CLI çıktılarından kaydedilmiş örneklerle test edilir.

**Karar alınması.** Başsız modda ajan sana söz ortasında soru soramaz. Çözüm: ajanın talimatında "karar gerekiyorsa işi durdur ve son mesaja bir `KARAR` bloğu yaz (soru, seçenekler)" denir. Runner bu bloğu yakalar, işi `karar bekliyor` durumuna geçirir, arayüzde Kararın lazım kutusunu gösterir. Seçim gelince aynı oturum `--resume` ile "Karar: …" mesajıyla sürdürülür.

**İzin istekleri.** Başsız modda izin sorulamaz; beyaz liste dışındaki araç reddedilir. İzinleri MCP aracına yönlendiren bir bayrak da var (CLI bayrak listesinde), ilk sürümde kullanmayız, adını ve davranışını hedef sürümde doğrulamak gerekir.

**Worktree.** Claude Code'un kendi [`--worktree`/`-w` bayrağı](https://claudefa.st/blog/guide/development/worktree-guide) `.claude/worktrees/<ad>/` altında çalışma dizini açıyor ve değişiklik yoksa temizliyor. Biz ilk sürümde worktree'yi kendimiz `git worktree add` ile açıyoruz: dal adını (`team/auth-api`) ve bir önceki işin dalından başlatmayı biz belirlemek istiyoruz. Bu bir tasarım tercihi; `-w` daha az kod demek, ikisi de denenebilir.

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

Planlayıcı çıktısı kesin bir JSON şemasına bağlıdır (`--json-schema` ile zorlanır, Zod ile bir kez daha doğrulanır). Her iş şunları taşır: `id`, `title`, `agent`, `dependsOn[]`, `expectedFiles[]`.

```json
{
  "tasks": [
    { "id": "db", "title": "users ve oturum tabloları", "agent": "database", "dependsOn": [], "expectedFiles": ["db/migrations/*"] },
    { "id": "api", "title": "Giriş ve kayıt API", "agent": "backend", "dependsOn": ["db"], "expectedFiles": ["src/api/auth.ts", "src/types/user.ts"] },
    { "id": "ui", "title": "Giriş formu", "agent": "frontend", "dependsOn": ["api"], "expectedFiles": ["src/pages/login.tsx"] }
  ]
}
```

**Aşamalar.** Sunucu, `dependsOn` bağlarından topolojik sıralama ile aşamaları hesaplar. Aynı aşamadaki işler eşzamanlılık sınırına kadar paralel başlar.

**Çakışma önleme (3 katman)**

1. Plan zamanı: aynı aşamadaki iki işin `expectedFiles` listeleri çakışıyorsa sunucu ikisini ardışık yapar (ek bağımlılık ekler) ve plan ekranında bunu uyarı olarak gösterir. Planlayıcı de aynı kuralı talimat olarak alır.
2. Çalışma zamanı: her iş kendi worktree ve dalında koşar. Bağımlı bir iş, önceki işin dalından başlar (yığın dallar), böylece önceki işin tip ve dosyalarını görür.
3. Birleştirme zamanı: iş bitince `git diff --name-only` gerçek dosyaları verir. Beklenenin dışına çıkılmışsa inceleme ekranında bu not edilir. Birleştirme çakışırsa iş "Değişiklik gerekli" durumuna düşer ve ilgili ajan güncel dalı alarak çözmesi için çalıştırılır.

**Plan onayı.** Ayar açıksa hiçbir ajan plan onaylanmadan başlamaz. Kullanıcı kart silebilir, ekleyebilir, ajanı değiştirebilir; sunucu değişiklikten sonra aşamaları ve çakışma kontrolünü yeniden hesaplar. "Planı yeniden oluştur" aynı isteği Planner'a tekrar verir.

**Reviewer.** Salt okunur araçlarla çalışır (`Read, Grep, Glob` ve diff için kısıtlı `Bash`). Çıktısı şemalı JSON: `summary` (sade dil), `risk` (düşük, orta, yüksek), `checks[]` (başlık, not, durum), `files[]`. Bu çıktı İnceleme ekranını doğrudan besler. Proje ayarlarında bir test komutu tanımlıysa test sonucu da kontrollere eklenir.

## Veri modeli ve durum yönetimi

Bir SQLite dosyası (`.ekip/panosu.db`), proje klasöründe. Olaylar yalnızca eklenir; arayüz durumu olaylardan türetilir, böylece sayfa yenilense ya da sunucu yeniden başlasa kaldığı yerden devam edilir.

| Tablo | Ana alanlar |
| --- | --- |
| `projects` | id, yol, ana dal, test komutu, ayarlar |
| `requests` | id, project, metin, oluşturma zamanı, plan JSON'u |
| `tasks` | id, request, başlık, ajan, bağımlılıklar, beklenen dosyalar, dal, worktree yolu, durum, aşama |
| `runs` | id, task, oturum kimliği, başlangıç, bitiş, sonuç durumu, maliyet, tur sayısı |
| `events` | id, run, sıra, tip, ham JSON (araç çağrısı, mesaj, sonuç) |
| `decisions` | id, task, soru, seçenekler, seçim, zaman |
| `reviews` | id, task, özet, risk, kontroller, dosyalar, karar (onay, geri gönder) |

**İş durumları**

| Durum | Panodaki sütun | Geçiş |
| --- | --- | --- |
| `planned` | Planlandı | Plan onaylandı |
| `blocked` | Planlandı | Bağımlı olduğu iş bitmedi |
| `running` | Çalışıyor | Başladı |
| `waiting_decision` | Çalışıyor (Kararın lazım) | Ajan KARAR bloğu yazdı |
| `in_review` | İncelemede | İş bitti, Reviewer çalışıyor ya da sıra sende |
| `changes_requested` | Çalışıyor | Sen geri gönderdin |
| `done` | Bitti | Birleştirildi |
| `failed`, `stopped` | Çalışıyor (kart kırmızı/gri) | Hata ya da kullanıcı durdurdu |

Sunucu başlangıcında çalışıyor görünen ama süreci ölen işleri `stopped` yapar ve "Kaldığı yerden sürdür" seçeneği sunar (`--resume` ile).

## Güvenlik ve izinler

Uygulama bilgisayarında kod çalıştıran ajanları yönetiyor; bu yüzden varsayılanlar kapalı taraftadır.

- **Yerel sunucu.** Yalnızca `127.0.0.1`'e bağlanır. Her başlatışta rastgele bir oturum anahtarı üretilir; arayüz anahtarla açılır, API çağrılarında `Origin` ve `Host` başlıkları denetlenir. Böylece başka bir web sitesi yerel sunucuya komut gönderemez.
- **Ajan sınırları.** Her ajan yalnızca kendi worktree klasöründe ve kendi araç beyaz listesiyle çalışır. Her yetkiyi atlayan bayrak (`--dangerously-skip-permissions`) kullanılmaz.
- **Gizli dosyalar.** `.env` ve anahtar dosyalarının okunmasını yasaklayan izin kuralları şablonla gelir. Kural söz dizimi hedef Claude Code sürümünde doğrulanmalıdır.
- **Sınırlar.** `--max-turns`, `--max-budget-usd`, iş başına zaman aşımı ve eşzamanlılık üst sınırı (varsayılan 3). Durdurma basılınca süreç ağacı sonlandırılır.
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
- Kredi bitince CLI'ın hata verdiği durum özel olarak yakalanır; iş `stopped` olur ve kullanıcıya açık bir mesaj gösterilir.
- Ayarda `ANTHROPIC_API_KEY` ile çalışma seçeneği bulunur (kullanıcı kendi anahtarını ortam değişkenine koyar, uygulama görmez).

**Marka.** Ürün adında "Claude" geçmeyecek. Kurallar "… Powered by Claude" gibi bir kullanıma izin veriyor. Lisans önerisi: MIT ya da Apache-2.0.

## Yol haritası

Tarih vermiyorum; her aşama kendi ölçütüyle biter, bir sonrakine ancak o zaman geçilir.

| Aşama | Kapsam | Bitti sayılır |
| --- | --- | --- |
| 0. Prototip | `claude -p` ile tek iş, `stream-json` canlı ekranda, oturum kimliği ve `--resume` | Arayüzden verilen bir istek canlı çıktıyla bitiyor, gerçek CLI çıktıları test örneği olarak kaydedildi |
| 1. Pano ve worktree | SQLite, işler ve durumlar, worktree ve dal açma, Pano ekranı, durdur ve sürdür | İki iş paralel, farklı dallarda çalışıp biri birleştirilebiliyor |
| 2. Planner ve zamanlayıcı | Plan JSON şeması, Plan onayı ekranı, bağımlılık ve çakışma kontrolü, KARAR akışı | Tek istekten 4-5 iş sırayla ve paralel çalışıyor, bir karar sorulup iş sürdürülüyor |
| 3. Reviewer ve cilalama | Reviewer şeması, İnceleme ekranı, test komutu, isim modları, Ekibini kur ekranı | Tasarım taslaklarındaki dört ekranın tam akışı çalışıyor |
| 4. Yayın | `npx` paketi, Windows/macOS/Linux denemesi, README (kurulum, kredi uyarısı), şablonlar, lisans, kısa demo videosu | Temiz bir bilgisayarda tek komutla kurulup ilk işin bittiği görülüyor |
| 5. Sonrası | Topluluk şablonları, başka alanlar (içerik ekibi gibi), başka CLI sürücüleri, masaüstü kabuğu | Talebe göre |

En önemli ilk adım Aşama 0: planın boşa gitmemesi için gerçek `claude -p` çıktısının biçimini ve KARAR bloğunun güvenilirliğini en başta ölçmek gerekiyor.

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
| Windows yol ve süreç farkları | Kurulum sorunları | Aşama 1'den itibaren Windows'ta test |

**Açık sorular**

- [ ] Ajanlar KARAR bloğunu ne kadar güvenilir yazıyor? Aşama 0'da ölçülür.
- [ ] Worktree'yi biz mi açalım, yoksa `--worktree` bayrağı mı kullanalım?
- [ ] İzinleri MCP aracına yönlendiren bayrak ilk sürümde kullanılabilir mi?
- [ ] Aylık Agent SDK kredisi plan bazında ne kadar ve bitince ne oluyor?
- [ ] Üçüncü taraf kuralının bu modelle ilgili yorumu için Anthropic'ten teyit.
- [ ] Ürün adı ve lisans (MIT mi Apache-2.0 mı)?
- [ ] İlk sürümde yalnızca Claude Code mı, yoksa baştan çoklu CLI desteği mi?

**Alınan kararlar (17 Kasım 2026)**

- **İlk sürüm yalnızca Claude Code.** Çoklu CLI desteği ve ajan başına model seçimi sonraya. Sürücü soyutlaması baştan hazır kalır, böylece sonra başka CLI eklemek kolay olur.
- **Worktree'yi biz açıyoruz** (`git worktree add`): dal adı (`team/auth-api`) ve yığın dallar bizde kalır, kullanıcı temiz dal adları görür.
- **İzinler kullanıcıyı yormasın:** `--permission-mode acceptEdits` ve ajan başına `--allowedTools` beyaz listesi. Ajan listede olmayan bir aracı isterse iş durur, arayüzde "Şu komuta izin verelim mi?" kartı çıkar; onaylanırsa liste genişler ve oturum `--resume` ile sürer. MCP izin bayrağı v1'de kullanılmıyor.
- **Lisans: MIT.** En düşük sürtünme, katkı vermek ve kullanmak en kolay olanı.
- **Ürün adı: Squadboard.** npm'de "squadboard" boş. GitHub'da aynı adlı birkaç küçük depo var; biri (sabbour/squadboard) "Squad AI ajanları için yerel kanban panosu" diyor, 0 yıldızlı ama konsept benziyor. Alan adı ve marka kaydı bir kayıtçiden kontrol edilmeli.
- **Sonraya bırakıldı:** abonelik kredisi ve Anthropic'ten kural teyidi (Aşama 0'dan sonra).

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
