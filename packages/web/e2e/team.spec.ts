import { expect, test, type Page } from '@playwright/test';
import { BOARD_URL, CHECKS, PROJECT, TEMPLATE, mockApi, teamOf } from './mock-api';

const TEAM_URL = `${BOARD_URL}&p=ekip`;

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page must not scroll sideways').toBeLessThanOrEqual(client);
}

test.describe('Ekibini kur', () => {
  test('installs the chosen members and shows what to commit', async ({ page }) => {
    const log = await mockApi(page, { team: { status: 'missing' } });
    await page.goto(TEAM_URL);

    await expect(page.getByRole('heading', { level: 1, name: 'Ekibini kur' })).toBeVisible();
    await expect(page.getByText('Git deposu bulundu')).toBeVisible();
    await expect(page.getByText('v2.1.150')).toBeVisible();
    await expect(page.getByText('Çalışma ağacı temiz')).toBeVisible();

    const members = page.getByRole('group', { name: 'Ekip üyeleri' });
    await expect(members.getByRole('checkbox')).toHaveCount(6);
    const database = members.getByRole('checkbox', { name: /Veritabanı/ });
    await expect(database).toHaveAttribute('aria-checked', 'true');
    await database.click();
    await expect(database).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('switch', { name: 'İnceleme' }).click();

    await page.getByRole('button', { name: 'Ekibi kur' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ekibin hazır.' })).toBeVisible();
    await expect(page.getByText('git add .team .claude/agents')).toBeVisible();
    expect(log.installs).toEqual([
      {
        templateId: 'fullstack-web',
        agents: ['planner', 'frontend', 'backend', 'test', 'reviewer'],
        settings: { ...TEMPLATE.settings, requireReview: false },
        overwrite: false,
      },
    ]);

    await page.getByRole('button', { name: 'Ekibi gör' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ekip' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Veritabanı açık' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('asks before overwriting files that differ', async ({ page }) => {
    const log = await mockApi(page, {
      team: { status: 'missing' },
      conflicts: ['.claude/agents/backend.md'],
    });
    await page.goto(TEAM_URL);
    await page.getByRole('button', { name: 'Ekibi kur' }).click();

    const dialog = page.getByRole('dialog', { name: 'Dosyalar zaten var' });
    await expect(dialog.getByText('.claude/agents/backend.md')).toBeVisible();
    await dialog.getByRole('button', { name: 'Üzerine yaz' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ekibin hazır.' })).toBeVisible();
    expect(log.installs.map((i) => (i as { overwrite: boolean }).overwrite)).toEqual([false, true]);
  });

  test('warns about a repository without commits', async ({ page }) => {
    await mockApi(page, {
      team: { status: 'missing' },
      projects: [{ ...PROJECT, hasCommits: false, taskCount: 0 }],
      tasks: [],
      checks: { ...CHECKS, hasCommits: false, changes: 3 },
    });
    await page.goto(TEAM_URL);
    await expect(page.getByText('Henüz commit yok')).toBeVisible();
    await expect(page.getByText('3 değişiklik')).toBeVisible();
  });
});

test.describe('Ekip', () => {
  test('edits an agent and saves name, prompt and model', async ({ page }) => {
    const log = await mockApi(page);
    await page.goto(TEAM_URL);
    await expect(page.getByRole('heading', { level: 1, name: 'Ekip' })).toBeVisible();
    await expect(page.locator('[data-agent="reviewer"]').getByText('Salt okuma')).toBeVisible();

    await page.getByRole('button', { name: 'Arka Yüz ajanını düzenle' }).click();
    const panel = page.getByRole('region', { name: 'Düzenle: Arka Yüz' });
    await panel.getByLabel('Ad', { exact: true }).fill('Sunucu');
    await panel.getByLabel(/Talimat/).fill('Sunucu ve API kodu yaz. Testsiz uç nokta bırakma.');
    await panel.getByRole('radio', { name: 'opus' }).click();
    await panel.getByRole('button', { name: 'Kaydet' }).click();

    await expect(page.getByText('Kaydedildi: .claude/agents/backend.md')).toBeVisible();
    expect(log.agentPatches).toEqual([
      {
        agentId: 'backend',
        body: {
          names: { tech: 'Sunucu' },
          prompt: 'Sunucu ve API kodu yaz. Testsiz uç nokta bırakma.',
          model: 'opus',
        },
      },
    ]);
    await expect(
      page.locator('[data-agent="backend"]').getByRole('heading', { name: 'Sunucu' }),
    ).toBeVisible();
  });

  test('switching an agent off removes it from the board', async ({ page }) => {
    const log = await mockApi(page);
    await page.goto(TEAM_URL);
    await page.getByRole('switch', { name: 'Test açık' }).click();
    await expect(page.getByRole('switch', { name: 'Test açık' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(log.agentPatches).toEqual([{ agentId: 'test', body: { enabled: false } }]);

    await page.getByRole('switch', { name: 'Plan onayı' }).click();
    expect(log.settingsPatches).toEqual([{ requirePlanApproval: false }]);

    await page.goto(BOARD_URL);
    const strip = page.getByRole('region', { name: 'Ekip' });
    await expect(strip.getByText('Ön Yüz', { exact: true })).toBeVisible();
    await expect(strip.getByText('Test', { exact: true })).toHaveCount(0);
  });

  test('explains a broken team file', async ({ page }) => {
    const error =
      '.team/team.json geçersiz: agents[0].color: color "#RRGGBB" biçiminde bir renk olmalı';
    await mockApi(page, { team: { status: 'invalid', error } });
    await page.goto(TEAM_URL);
    await expect(page.getByText(error)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yeniden oku' })).toBeVisible();

    await page.goto(BOARD_URL);
    await expect(page.getByText(/Ekip dosyaları okunamadı/)).toBeVisible();
  });
});

test('names and colours come from the team, both name modes still work', async ({ page }) => {
  const team = teamOf(TEMPLATE);
  if (team.status !== 'ok') throw new Error('fixture');
  team.team.agents = team.team.agents.map((a) =>
    a.id === 'frontend' ? { ...a, names: { tech: 'Arayüz', friendly: 'Piksel' } } : a,
  );
  await mockApi(page, { team });
  await page.goto(BOARD_URL);
  const strip = page.getByRole('region', { name: 'Ekip' });
  await expect(strip.getByText('Arayüz', { exact: true })).toBeVisible();
  await expect(page.locator('[data-column="working"]').getByText('Arayüz')).toBeVisible();

  await page.getByRole('radio', { name: 'Sade' }).click();
  await expect(strip.getByText('Piksel', { exact: true })).toBeVisible();
});

test('a project without a team falls back to the default names and offers setup', async ({
  page,
}) => {
  await mockApi(page, { team: { status: 'missing' } });
  await page.goto(BOARD_URL);
  await expect(
    page.getByRole('region', { name: 'Ekip' }).getByText('Ön Yüz', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ekibini kur' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ekibini kur' })).toBeVisible();
});

test('removes a project from Squadboard after confirming', async ({ page }) => {
  const log = await mockApi(page);
  await page.goto(BOARD_URL);
  await page.getByRole('button', { name: /kafe-siparis/ }).click();
  await page.getByRole('button', { name: 'kafe-siparis projesini kaldır' }).click();
  const dialog = page.getByRole('dialog', { name: 'Projeyi kaldır' });
  await expect(dialog.getByText(/Klasörüne, dallarına ve dosyalarına/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Kaldır' }).click();
  await expect(page.getByLabel('Proje klasörü (git reposu)').first()).toBeVisible();
  expect(log.deleted).toEqual([PROJECT.id]);
});

test.describe('mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('setup and team pages fit without sideways scroll', async ({ page }) => {
    await mockApi(page, { team: { status: 'missing' } });
    await page.goto(TEAM_URL);
    await expect(page.getByRole('heading', { level: 1, name: 'Ekibini kur' })).toBeVisible();
    await noHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Ekibi kur' }).click();
    await page.getByRole('button', { name: 'Ekibi gör' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ekip' })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
