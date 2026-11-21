import { expect, test, type Page } from '@playwright/test';
import { BOARD_URL, TASKS, mockApi } from './mock-api';
import type { TaskView } from '../src/api';

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page must not scroll sideways').toBeLessThanOrEqual(client);
}

const waiting = (over: Partial<TaskView>): TaskView[] =>
  TASKS.map((t) => (t.id === 't-table' ? { ...t, ...over } : t));

test.describe('Kararın lazım (v2-03)', () => {
  test('all questions in one box, sent together; the permission card resumes the rest', async ({
    page,
  }) => {
    const log = await mockApi(page);
    await page.goto(BOARD_URL);

    const box = page.locator('#karar-t-table');
    await expect(box.getByRole('heading', { name: 'Kararın lazım' })).toBeVisible();
    await expect(
      box.getByText('Veritabanı ajanı ilerlemeden önce 2 şeyi bilmek istiyor.'),
    ).toBeVisible();
    await expect(box.getByText('2 soru', { exact: true })).toBeVisible();

    const send = box.getByRole('button', { name: 'Cevapları gönder' });
    await expect(send).toBeDisabled();
    await box.getByRole('radio', { name: 'SQLite' }).click();
    await expect(box.getByRole('radio', { name: 'SQLite' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(send).toBeDisabled();
    // Own words instead of a card.
    await box.getByLabel('Başka bir cevap').nth(1).fill('Yalnızca yöneticiler');
    await expect(send).toBeEnabled();
    await expect(box.getByText('İzin isteği de cevaplanınca ajan devam eder')).toBeVisible();
    await send.click();
    await expect
      .poll(() => log.answers)
      .toEqual([
        {
          taskId: 't-table',
          body: { answers: { 'q-db': 'SQLite', 'q-login': 'Yalnızca yöneticiler' } },
        },
      ]);

    // The questions are answered; the agent still waits for the permission.
    await expect(box.getByRole('heading', { name: 'Kararın lazım' })).toHaveCount(0);
    const card = box.getByRole('region', { name: 'İzin isteği' });
    await expect(card.getByText('Veritabanı bir komut çalıştırmak istiyor')).toBeVisible();
    await expect(card.getByText('$ pnpm add better-sqlite3', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Bir kez' }).click();
    await expect
      .poll(() => log.permissions)
      .toEqual([{ taskId: 't-table', permissionId: 'perm-1', body: { action: 'once' } }]);
    // Nothing left: the agent runs again and the box is gone.
    await expect(box).toHaveCount(0);
  });

  test('"Ajanın kararına bırak" and "Hep izin ver"', async ({ page }) => {
    const log = await mockApi(page);
    await page.goto(BOARD_URL);
    const box = page.locator('#karar-t-table');
    await box.getByRole('button', { name: 'Ajanın kararına bırak' }).click();
    await expect
      .poll(() => log.answers)
      .toEqual([{ taskId: 't-table', body: { delegate: true, answers: {} } }]);
    await box.getByRole('button', { name: 'Hep izin ver · yalnızca bu proje' }).click();
    await expect.poll(() => log.permissions.map((p) => p.body)).toEqual([{ action: 'always' }]);
  });

  test('the task card says "Cevapla" (not "Yeniden başlat") and leads to the box', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto(BOARD_URL);
    const card = page.getByTestId('task-card').filter({ hasText: 'Sipariş tablosu' });
    await expect(
      card.getByText('Ajan durdu, senden cevap bekliyor (2 soru · 1 izin)'),
    ).toBeVisible();
    await expect(card.getByRole('button', { name: 'Yeniden başlat' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Cevapla' }).click();
    await expect(page.locator('#karar-t-table')).toBeFocused();
  });

  test('an unreadable question is shown, not swallowed', async ({ page }) => {
    const log = await mockApi(page, {
      tasks: waiting({
        pending: {
          questions: [
            {
              id: 'q-bad',
              question: 'Devam etmeden önce:\n```karar\n{"question": "Hangi veritabanı?"',
              options: [],
              multiSelect: false,
              problem: 'Block is not closed',
            },
          ],
          permissions: [],
          round: 1,
        },
      }),
    });
    await page.goto(BOARD_URL);
    const box = page.locator('#karar-t-table');
    await expect(
      box.getByText('Ajan bir şey sormak istemiş olabilir', { exact: false }).first(),
    ).toBeVisible();
    await expect(box.getByText('"Hangi veritabanı?"', { exact: false })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Ajanın kararına bırak' })).toHaveCount(0);
    await box.getByLabel('Cevabın').fill('SQLite kullan');
    await box.getByRole('button', { name: 'Cevapları gönder' }).click();
    await expect
      .poll(() => log.answers)
      .toEqual([{ taskId: 't-table', body: { answers: { 'q-bad': 'SQLite kullan' } } }]);
  });

  test('warns after the agent keeps asking', async ({ page }) => {
    const base = TASKS.find((t) => t.id === 't-table');
    await mockApi(page, {
      tasks: waiting({
        pending: { ...(base?.pending ?? { questions: [], permissions: [] }), round: 3 },
      }),
    });
    await page.goto(BOARD_URL);
    await expect(
      page.getByText('Ajan bu görevde 3. kez soru soruyor', { exact: false }),
    ).toBeVisible();
  });
});

test.describe('mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the decision box fits', async ({ page }) => {
    await mockApi(page);
    await page.goto(BOARD_URL);
    await expect(
      page.locator('#karar-t-table').getByRole('heading', { name: 'Kararın lazım' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
