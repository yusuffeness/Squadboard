# Squadboard – proje kuralları

Teknik tasarım: `docs/ARCHITECTURE.md`. Her işe onu okuyarak başla.

## Git

- **Claude branch açmaz, commit atmaz, push yapmaz.** Tüm git işlemlerini proje sahibi yapar. İş bitince "commit'e hazır" de ve değişen dosyaları listele.
- Commit'ler (insan tarafından) küçük ve anlamlı olur: bir commit = bir mantıklı değişiklik.

## Kapsam

- Sadece istenen aşamanın kapsamını yap. Sonraki aşamanın özelliklerini erkenden yazma, "fırsat bu fırsat" refactor yapma.
- Kapsam dışı bir sorun görürsen düzeltme, not olarak bildir.
- Elle denenmesi gereken adımları (tarayıcıda açma, `pnpm dev` ile deneme) proje sahibi yapar; sen ne denenmesi gerektiğini yaz.

## Kod

- TypeScript `strict` (bkz. `tsconfig.base.json`). `any`, `@ts-ignore` ve non-null `!` kullanma; gerekirse tipi daralt.
- ESM (`"type": "module"`). Node paketlerinde relative import'lar `.js` uzantılı.
- Kod, yorum ve tanımlayıcılar İngilizce.
- Sunucu yalnızca `127.0.0.1`'e bağlanır. `--dangerously-skip-permissions` asla kullanılmaz.
- Yeni `/api` uç noktaları `security.ts` hook'unun arkasında kalır (Host, Origin, token); güvenliği atlayan bir yol açma, token'ı loglama.
- Kullanıcının reposunda çalışma ağacına ve ana dalına asla dokunulmaz: ajanlar yalnızca `~/.squadboard/worktrees/` altındaki worktree'lerde çalışır; git servisi yalnızca `team/` dallarında oluşturur, commit'ler, siler. Git testleri her senaryodan sonra kullanıcı reposunun değişmediğini doğrular; yeni git kodu da bunu yapmalı.
- web, core'dan yalnızca `import type` ile tip alır (`tsconfig` `paths` → `core/src`); çalışma zamanında core'a bağlı değildir.
- Renk ve font için Tailwind token'larını kullan (`bg-bg`, `text-ink`, `text-accent`, `text-success`, `text-warn`, `font-sans`, `font-mono`); ham hex yazma. Token'lar `packages/web/src/index.css` içindeki `@theme` bloğunda.

## Test

- Her aşamada yeni davranış testle gelir (Vitest; `core` ve `server`).
- Sunucu testleri `buildApp()` + `app.inject()` ile, port açmadan.
- İş bitmeden önce hepsi geçmeli: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Komutlar

| Komut                                          | Ne yapar                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | core'u build eder, server (4317) ve web'i (5173) birlikte başlatır; terminaldeki `#token=…` bağlantısını aç |
| `pnpm start`                                   | Her şeyi build eder ve `squadboard` komutunu çalıştırır (tarayıcıyı açar)                                   |
| `pnpm test`                                    | Vitest, tüm paketler                                                                                        |
| `pnpm lint`                                    | ESLint + Prettier kontrolü                                                                                  |
| `pnpm format`                                  | Prettier ile düzelt                                                                                         |
| `pnpm typecheck`                               | `tsc --noEmit`, tüm paketler                                                                                |
| `pnpm build`                                   | Tüm paketleri build eder                                                                                    |
| `pnpm --filter @squadboard/server db:generate` | Şema değişince yeni SQL migration'ı üretir (`packages/server/drizzle/`)                                     |
| `pnpm --filter @squadboard/server try`         | Gerçek `claude` ile tek bir görev çalıştırır (kredi harcar; elle deneme için)                               |

## Sürüm notları

- TypeScript `~6.0` sabit: typescript-eslint 8 henüz TS 7'yi desteklemiyor.
- Tailwind v4: config dosyası yok, token'lar CSS `@theme` içinde.
- server, core'u derlenmiş `dist` üzerinden kullanır; server'ın `test` ve `typecheck` script'leri önce core'u build eder.
- `better-sqlite3` hazır binary'lerle gelir. `onlyBuiltDependencies`'e **ekleme**: pnpm o zaman `node-gyp` çalıştırır ve C++ derleyicisi olmayan makinede kurulum kırılır.
- Runner testleri gerçek CLI yerine `packages/server/test/fake-claude.mjs` kullanır; CLI'ın gerçek davranışı değişirse önce Aşama 1 kayıtlarını (`packages/core/test/fixtures/claude-cli/`) yenile.
- Testlerde geçici klasörü `realpathSync.native(mkdtempSync(...))` ile aç: Windows CI'da `tmpdir()` 8.3 kısa yol döner (`RUNNER~1`), git ise uzun yolu raporlar; yol karşılaştıran testler yalnızca CI'da kırılır. Yerelde denemek için `TEMP`'i kısa bir yola çevirip testleri çalıştır.
