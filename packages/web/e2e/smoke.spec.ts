import { expect, test, type Page } from '@playwright/test';
import { BOARD_URL, PROJECT, mockApi } from './mock-api';

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page must not scroll sideways').toBeLessThanOrEqual(client);
}

test.describe('Pano', () => {
  test('opens with the four columns, agent strip and real cost', async ({ page }) => {
    await mockApi(page);
    await page.goto(BOARD_URL);

    await expect(page.getByRole('heading', { name: 'Ekibin hazır.' })).toBeVisible();
    for (const name of ['Bekliyor', 'Çalışıyor', 'Karar / İnceleme', 'Bitti']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    const column = (id: string) => page.locator(`[data-column="${id}"]`);
    await expect(column('working').getByText('Sipariş sayfası')).toBeVisible();
    await expect(column('waiting').getByText('Sipariş akışı testleri')).toBeVisible();
    await expect(column('attention').getByText('Menü kartları')).toBeVisible();
    await expect(column('done').getByText('Ürün şeması')).toBeVisible();

    // Running task: indeterminate bar (no invented percentage).
    const bar = column('working').getByRole('progressbar');
    await expect(bar).toBeVisible();
    await expect(bar).not.toHaveAttribute('aria-valuenow');

    // Only today's runs with a real cost: 0.12 + 0.30.
    await expect(page.getByText('$0,42').filter({ visible: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /kafe-siparis/ })).toBeVisible();
  });

  test('empty project shows the first-run state', async ({ page }) => {
    await mockApi(page, { projects: [{ ...PROJECT, taskCount: 0 }], tasks: [] });
    await page.goto(BOARD_URL);

    await expect(page.getByRole('heading', { name: 'Buradan başlayabilirsin' })).toBeVisible();
    await expect(page.getByText('Henüz görev yok')).toBeVisible();
    await expect(page.getByText('Ajanlar boşta')).toBeVisible();

    await page.getByRole('button', { name: /REST API yaz/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Yeni iş' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox').first()).toHaveValue(/REST API/);
    await expect(dialog.getByRole('radio', { name: 'Arka Yüz' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('no project shows the add-project state', async ({ page }) => {
    await mockApi(page, { projects: [], tasks: [] });
    await page.goto(BOARD_URL);
    await expect(page.getByLabel('Proje klasörü (git reposu)')).toBeVisible();
  });

  test('opens the agent detail with live logs', async ({ page }) => {
    await mockApi(page);
    await page.goto(BOARD_URL);
    await page.getByRole('button', { name: 'Sipariş sayfası' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Ön Yüz' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Loglar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('src/pages/Menu.tsx')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Durdur' })).toBeVisible();
    expect(page.url()).toContain('task=t-page');
    expect(page.url()).toContain('token=test-token');
  });
});

test('name mode switches and is remembered', async ({ page }) => {
  await mockApi(page);
  await page.goto(BOARD_URL);
  const strip = page.getByRole('region', { name: 'Ekip' });

  await expect(strip.getByText('Ön Yüz', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Sade' }).click();
  await expect(strip.getByText('Pixel', { exact: true })).toBeVisible();
  await expect(strip.getByText('Kaptan', { exact: true })).toBeVisible();
  await expect(strip.getByText('Ön Yüz', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Sade' })).toHaveAttribute('aria-checked', 'true');
  await expect(strip.getByText('Pixel', { exact: true })).toBeVisible();
});

test('menu routes work', async ({ page }) => {
  await mockApi(page);
  await page.goto(BOARD_URL);
  await page
    .getByRole('navigation', { name: 'Ana menü' })
    .first()
    .getByRole('button', { name: 'Geçmiş' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Geçmiş' })).toBeVisible();
  await expect(page.getByText('Yakında')).toBeVisible();
  expect(page.url()).toContain('p=gecmis');
  expect(page.url()).toContain('token=test-token');
});

test.describe('mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('board fits without sideways scroll and has the tab bar', async ({ page }) => {
    await mockApi(page);
    await page.goto(BOARD_URL);
    await expect(page.getByRole('heading', { name: 'Ekibin hazır.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sipariş sayfası' })).toBeVisible();
    await noHorizontalOverflow(page);

    const tabBar = page.getByRole('navigation', { name: 'Ana menü' }).last();
    await expect(tabBar).toBeVisible();
    await expect(tabBar.getByRole('button', { name: 'Pano' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('detail and empty states fit too', async ({ page }) => {
    await mockApi(page);
    await page.goto(`${BOARD_URL}&task=t-menu`);
    await expect(page.getByRole('tab', { name: /Dosyalar/ })).toBeVisible();
    await noHorizontalOverflow(page);

    await mockApi(page, { tasks: [] });
    await page.goto(BOARD_URL);
    await page.reload();
    await expect(page.getByText('Buradan başlayabilirsin')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
