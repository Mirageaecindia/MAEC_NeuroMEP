import { expect, test, type Page } from '@playwright/test';
import { FIXTURE } from './global-setup';

/**
 * WBS 1.5.2 frontend smoke tests: login, Import File (Page 1), Floor Setup and Building views and
 * the right panel, in a real browser against a real API. Dev users (CLAUDE.md), own data folder.
 */

const LEAD = { email: 'lead@neuromep.dev', password: 'neuromep-dev' };

async function signIn(page: Page, password = LEAD.password) {
  await page.goto('/');
  await page.getByLabel('User Email ID').fill(LEAD.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Sign In to Engineering Workspace/ }).click();
}

const tool = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true });

test('#TASK-01 login refuses a wrong password (E0101)', async ({ page }) => {
  await signIn(page, 'not-the-password');
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
  await expect(page).toHaveURL(/\/login/);
});

test('#TASK-16 login, Import File, Floor Setup, Building tab and Cable Size', async ({ page }) => {
  // Login > All Projects.
  await signIn(page);
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('navigation', { name: 'Pages' })).toContainText('All Projects');

  // Import File: open a project file (.json) as a new project (A-01: Technical Lead).
  await page.getByRole('navigation', { name: 'Pages' }).getByText('Import File').click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.getByLabel('Project file').setInputFiles(FIXTURE);
  await expect(page).toHaveURL(/\/projects\/[^/]+\/import$/);
  await expect(page.getByLabel('Plot Ref')).not.toHaveValue('');
  await expect(page.getByText('Floor Plans', { exact: true })).toBeVisible();

  // Next > Floor Setup: library, capacity panel, Cable Size waits for a riser (A-07).
  await tool(page, 'Next').click();
  await expect(page).toHaveURL(/\/floor$/);
  await expect(page.getByText('TRANSFORMER CAPACITY & CONNECTED LOAD SCHEDULE')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transformer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Feeder', exact: true })).toBeVisible();
  const cableSize = page.getByRole('button', { name: /^Cable Size( |$)/ });
  await expect(cableSize).toBeDisabled();

  // Building tab: a riser fed from TX-1 feeds the Ground Floor DB; then the calculator runs.
  await tool(page, 'Building').click();
  const summary = page.getByRole('complementary', { name: 'Building Summary' });
  const calculator = summary.getByRole('button', { name: 'Cable Size Calculator' });
  await expect(calculator).toBeDisabled();
  await summary.getByLabel('Riser 1 length').fill('26');
  await page.getByRole('button', { name: 'Riser 1', exact: true }).click();
  await expect(page.getByText('Riser 1 is fed from TX-1.')).toBeVisible();
  await page
    .getByRole('button', { name: /board$/ })
    .first()
    .click();
  await expect(calculator).toBeEnabled();
  await calculator.click();
  await summary.getByRole('button', { name: 'Save' }).click();

  // Back on the floor, the right-panel Cable Size is enabled and runs on the floor.
  await tool(page, 'Building').click();
  await expect(cableSize).toBeEnabled();
  await cableSize.click();
  await expect(
    page.getByText(/Cable Size ran on .* \(mock results until WBS 1\.6\)\./),
  ).toBeVisible();

  // Saved: a reload keeps the riser.
  await tool(page, 'Save').click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.goto(page.url().replace(/\/floor.*$/, '/floor?tab=building'));
  await expect(
    page.getByRole('complementary', { name: 'Building Summary' }).getByLabel('Riser 1 length'),
  ).toHaveValue('26');
});
