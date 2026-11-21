import { expect, test, type Page } from '@playwright/test';
import { BOARD_URL, LOGIN_PLAN, PLANNING, mockApi } from './mock-api';

const planUrl = (id: string) => `${BOARD_URL}&plan=${id}`;

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page must not scroll sideways').toBeLessThanOrEqual(client);
}

test('Planla gives the request to the Planner and shows only reported steps', async ({ page }) => {
  const log = await mockApi(page);
  await page.goto(BOARD_URL);

  await page.getByRole('textbox', { name: 'Ne yapılsın?' }).fill('Giriş sayfası ve API ekle');
  await page.getByRole('button', { name: 'Planla' }).click();

  await expect(page.getByRole('heading', { name: 'Planlayıcı düşünüyor…' })).toBeVisible();
  expect(log.planRequests).toEqual([{ text: 'Giriş sayfası ve API ekle' }]);
  await expect(page.getByText('“Giriş sayfası ve API ekle”')).toBeVisible();
  const steps = page.getByRole('list', { name: 'Planlama adımları' }).getByRole('listitem');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toContainText('Proje dosyaları inceleniyor');
  await expect(steps.nth(1)).toContainText('sürüyor');
  // No invented percentages or remaining time.
  await expect(page.getByText(/%/)).toHaveCount(0);

  await page.getByRole('button', { name: 'İptal et' }).click();
  await expect(page.getByRole('heading', { name: 'Ekibin hazır.' })).toBeVisible();
});

test('"Tek görev ekle" still opens the single-task dialog', async ({ page }) => {
  await mockApi(page);
  await page.goto(BOARD_URL);
  await page.getByRole('textbox', { name: 'Ne yapılsın?' }).fill('README düzelt');
  await page.getByRole('button', { name: 'Tek görev ekle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Yeni iş' });
  await expect(dialog.getByRole('textbox').first()).toHaveValue('README düzelt');
});

test('plan approval: decisions first, then staged cards, edits and approval', async ({ page }) => {
  const log = await mockApi(page, { plans: [LOGIN_PLAN] });
  await page.goto(planUrl(LOGIN_PLAN.id));

  await expect(page.getByRole('heading', { name: 'Plan hazır' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Önce şunları netleştirelim' })).toBeVisible();
  // Cards wait for the answers; approval is off until then.
  await expect(page.getByTestId('plan-task')).toHaveCount(0);
  const approve = page.getByRole('button', { name: 'Onayla ve başlat' });
  await expect(approve).toBeDisabled();

  // Free text works as an answer too; picking an option replaces it.
  await page.getByLabel('Başka bir cevap').fill('Oturum tablosu');
  await expect(page.getByTestId('plan-task')).toHaveCount(3);
  await page.getByRole('radio', { name: 'JWT' }).click();
  await expect(page.getByLabel('Başka bir cevap')).toHaveValue('');

  // Stages, conflict note and the ownership warning.
  await expect(page.getByRole('region', { name: '1. aşama' })).toContainText('Kullanıcı tablosu');
  await expect(page.getByRole('region', { name: '3. aşama' })).toContainText('Giriş formu');
  await expect(page.getByText('Aynı dosyalar yüzünden sıraya alındı: Giriş API')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Çakışma kontrolü' })).toBeVisible();
  await expect(page.getByText(/Ön Yüz ajanının alanı dışına yazacak/)).toBeVisible();
  // Cost only as an upper bound from the agents' budgets.
  await expect(page.getByText('en fazla $3,00')).toBeVisible();

  // Only open agents that can write are offered.
  const select = page.getByLabel('Ajanı değiştir').first();
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual(['Ön Yüz', 'Arka Yüz', 'Veritabanı', 'Test']);
  await select.selectOption('backend');
  expect(log.planEdits).toContainEqual({ taskId: 'db', agent: 'backend' });

  await page.getByRole('button', { name: 'Kaldır: Giriş formu' }).click();
  await expect(page.getByTestId('plan-task')).toHaveCount(2);
  expect(log.planEdits).toContainEqual({ removeTask: 'ui' });

  await approve.click();
  expect(log.approvals).toEqual([{ answers: { session: 'JWT' } }]);
  await expect(page.getByRole('heading', { name: 'Ekibin hazır.' })).toBeVisible();
});

test('without plan approval the button says the plan starts after the answers', async ({
  page,
}) => {
  await mockApi(page, { plans: [{ ...LOGIN_PLAN, requirePlanApproval: false }] });
  await page.goto(planUrl(LOGIN_PLAN.id));
  await expect(page.getByText(/Plan onayı kapalı/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cevapla ve başlat' })).toBeDisabled();
});

test('a clean plan shows "Çakışma yok"', async ({ page }) => {
  const plan = LOGIN_PLAN.plan;
  if (!plan) throw new Error('fixture');
  await mockApi(page, {
    plans: [{ ...LOGIN_PLAN, plan: { ...plan, notes: [], warnings: [], openDecisions: [] } }],
  });
  await page.goto(planUrl(LOGIN_PLAN.id));
  await expect(page.getByRole('heading', { name: 'Çakışma yok' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Onayla ve başlat' })).toBeEnabled();
});

test('the board points at a waiting plan', async ({ page }) => {
  await mockApi(page, { plans: [LOGIN_PLAN] });
  await page.goto(BOARD_URL);
  const banner = page.getByRole('region', { name: 'Plan durumu' });
  await expect(banner).toContainText('Plan hazır, onayını bekliyor');
  await banner.getByRole('button', { name: 'Planı aç' }).click();
  await expect(page.getByRole('heading', { name: 'Plan hazır' })).toBeVisible();
});

test('an interrupted plan can be resumed from the board', async ({ page }) => {
  await mockApi(page, {
    plans: [
      {
        ...LOGIN_PLAN,
        status: 'interrupted',
        progress: { total: 3, finished: 1, failed: 0, interrupted: 1 },
      },
    ],
  });
  await page.goto(BOARD_URL);
  const banner = page.getByRole('region', { name: 'Plan durumu' });
  await expect(banner).toContainText('plan durdu; 1 iş kesildi');
  await banner.getByRole('button', { name: 'Devam et' }).click();
  await expect(banner).toHaveCount(0);
});

test('a failed plan explains itself and can be retried', async ({ page }) => {
  await mockApi(page, {
    plans: [
      {
        ...PLANNING,
        status: 'failed',
        error: 'Planlayıcı iki denemede de geçerli bir plan üretemedi.',
        errorDetail: 'task "ui" uses unknown agent "frontend"',
      },
    ],
  });
  await page.goto(planUrl(PLANNING.id));
  await expect(page.getByRole('heading', { name: 'Plan çıkmadı' })).toBeVisible();
  await expect(page.getByText(/iki denemede de geçerli bir plan üretemedi/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('plan screens fit without sideways scroll', async ({ page }) => {
    await mockApi(page, { plans: [LOGIN_PLAN, PLANNING] });
    await page.goto(planUrl(LOGIN_PLAN.id));
    await page.getByRole('radio', { name: 'Cookie' }).click();
    await expect(page.getByTestId('plan-task').filter({ visible: true })).toHaveCount(3);
    await noHorizontalOverflow(page);
    await page.goto(planUrl(PLANNING.id));
    await expect(page.getByRole('heading', { name: 'Planlayıcı düşünüyor…' })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
