import { test, expect } from '@playwright/test';

test('renders the party workbench and a party row', async ({ page }) => {
  await page.route('**/api/v1/parties', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: '1', partyNumber: 'PTY-000000001', displayName: 'Acme Manufacturing', partyType: 'ORGANIZATION', status: 'ACTIVE' }])
      });
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Party' })).toBeVisible();
  await expect(page.getByText('Acme Manufacturing')).toBeVisible();
});
