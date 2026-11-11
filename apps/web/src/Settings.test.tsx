import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ANTHROPIC_KEYS_URL } from '@/components/settings/AnthropicKeyCard';
import {
  currentUrl,
  KEY_REJECTED_MESSAGE,
  KEY_UNREACHABLE_MESSAGE,
  MIRA,
  mockApi,
  renderAt,
} from '@/test/app-harness';

const KEY = 'sk-ant-api03-MiraMiraMiraMiraMira0123456789_-abcd';
const NEW_KEY = 'sk-ant-api03-MiraSecondKeySecondKey0123456789-wxyz';

const SAVED = {
  provider: 'anthropic',
  lastFour: 'abcd',
  createdAt: '2026-11-01T09:00:00.000Z',
} as const;

function keyInput(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(/API key/);
}

function putBodies(fetchMock: ReturnType<typeof mockApi>): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => input === '/api/me/credentials/anthropic' && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown);
}

function typeAndSave(value: string) {
  fireEvent.change(keyInput(), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
}

describe('Settings', () => {
  it('is linked from the header and the profile page', async () => {
    mockApi(MIRA);
    renderAt('/profile');

    fireEvent.click(await screen.findByRole('link', { name: 'Settings and AI keys' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeDefined();
    expect(currentUrl()).toBe('/settings');

    renderAt('/');
    expect(
      (await screen.findAllByRole('link', { name: 'Settings' })).some(
        (link) => link.getAttribute('href') === '/settings',
      ),
    ).toBe(true);
  });

  it('sends signed-out visitors to sign-in', async () => {
    mockApi(null);
    renderAt('/settings');

    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
  });

  it('explains where the key is used and links to the Anthropic Console', async () => {
    mockApi(MIRA);
    renderAt('/settings');

    expect(await screen.findByRole('heading', { name: 'Anthropic API key' })).toBeDefined();
    expect(screen.getByText(/sends your notes and the campaign's records/)).toBeDefined();
    expect(screen.getByText(/under your Anthropic account and Anthropic's terms/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Anthropic Console' }).getAttribute('href')).toBe(
      ANTHROPIC_KEYS_URL,
    );
    const input = keyInput();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('saves a key, clears the field and shows only the last four characters', async () => {
    const fetchMock = mockApi(MIRA);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Anthropic API key' });

    typeAndSave(`  ${KEY}  `);

    expect(await screen.findByText(/Key ending in/)).toHaveProperty(
      'textContent',
      expect.stringContaining('…abcd'),
    );
    expect(screen.getByRole('status').textContent).toBe('Saved. Anthropic accepted the key.');
    expect(putBodies(fetchMock)).toEqual([{ apiKey: KEY }]);
    // The form is gone and the key appears nowhere on the page.
    expect(screen.queryByRole('button', { name: 'Save key' })).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain(KEY.slice(13, 30));
  });

  it('checks the format before sending anything', async () => {
    const fetchMock = mockApi(MIRA);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Anthropic API key' });

    typeAndSave('sk-proj-notanthropic0123456789');

    expect((await screen.findByRole('alert')).textContent).toContain('should start with sk-ant-');
    typeAndSave('sk-ant-admin01-AdminAdminAdminAdminAdmin');
    expect((await screen.findByRole('alert')).textContent).toContain("That's an Admin API key");
    expect(putBodies(fetchMock)).toEqual([]);
  });

  it.each([
    ['Anthropic refuses the key', 'sk-ant-api03-thiskeyisrejected0123456789', KEY_REJECTED_MESSAGE],
    [
      "Anthropic can't be reached",
      'sk-ant-api03-anthropicisoffline0123456789',
      KEY_UNREACHABLE_MESSAGE,
    ],
  ])('shows the reason and saves nothing when %s', async (_case, key, message) => {
    mockApi(MIRA);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Anthropic API key' });

    typeAndSave(key);

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    await waitFor(() => {
      expect(keyInput().value).toBe('');
    });
    expect(screen.queryByText(/Key ending in/)).toBeNull();
  });

  it('replaces a stored key', async () => {
    const fetchMock = mockApi(MIRA, [], { credentials: [SAVED] });
    renderAt('/settings');

    expect((await screen.findByText(/Key ending in/)).textContent).toContain('…abcd');
    expect(screen.queryByRole('button', { name: 'Save key' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Replace key' }));
    expect(screen.getByLabelText('New API key')).toBeDefined();
    typeAndSave(NEW_KEY);

    await waitFor(() => {
      expect(screen.getByText(/Key ending in/).textContent).toContain('…wxyz');
    });
    expect(putBodies(fetchMock)).toEqual([{ apiKey: NEW_KEY }]);
  });

  it('can cancel replacing a key', async () => {
    mockApi(MIRA, [], { credentials: [SAVED] });
    renderAt('/settings');

    fireEvent.click(await screen.findByRole('button', { name: 'Replace key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('New API key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeDefined();
  });

  it('removes a key after confirming', async () => {
    const fetchMock = mockApi(MIRA, [], { credentials: [SAVED] });
    renderAt('/settings');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/delete it there too/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove key' }));

    expect(await screen.findByLabelText('Your API key')).toBeDefined();
    expect(screen.queryByText(/Key ending in/)).toBeNull();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => input === '/api/me/credentials/anthropic' && init?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
