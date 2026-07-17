import { expect, test } from '@playwright/test'

const email = process.env.E2E_LOGIN_EMAIL ?? 'owner@acme.dev'

test.describe('Auth (passwordless)', () => {
  test('login page shows the passwordless options', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Welcome back!' })).toBeVisible()
    await expect(page.getByPlaceholder('Work email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue with Microsoft/i })).toBeVisible()
    // Password sign-in has been removed entirely.
    await expect(page.getByPlaceholder('Password')).toHaveCount(0)
  })

  test('requesting a code advances to the code-entry step', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Work email').fill(email)
    await page.getByRole('button', { name: 'Send sign-in code' }).click()

    // The request always succeeds (no account enumeration), so the UI moves to
    // the 6-digit code step regardless of whether the email has access.
    await expect(page.getByPlaceholder('Enter 6-digit code')).toBeVisible({ timeout: 15_000 })
  })
})
