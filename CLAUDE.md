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
- Renk ve font için Tailwind token'larını kullan (`bg-bg`, `text-ink`, `text-accent`, `text-success`, `text-warn`, `font-sans`, `font-mono`); ham hex yazma. Token'lar `packages/web/src/index.css` içindeki `@theme` bloğunda.

## Test

- Her aşamada yeni davranış testle gelir (Vitest; `core` ve `server`).
- Sunucu testleri `buildApp()` + `app.inject()` ile, port açmadan.
- İş bitmeden önce hepsi geçmeli: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Komutlar

| Komut            | Ne yapar                                                           |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm dev`       | core'u build eder, server (4317) ve web'i (5173) birlikte başlatır |
| `pnpm test`      | Vitest, tüm paketler                                               |
| `pnpm lint`      | ESLint + Prettier kontrolü                                         |
| `pnpm format`    | Prettier ile düzelt                                                |
| `pnpm typecheck` | `tsc --noEmit`, tüm paketler                                       |
| `pnpm build`     | Tüm paketleri build eder                                           |

## Sürüm notları

- TypeScript `~6.0` sabit: typescript-eslint 8 henüz TS 7'yi desteklemiyor.
- Tailwind v4: config dosyası yok, token'lar CSS `@theme` içinde.
