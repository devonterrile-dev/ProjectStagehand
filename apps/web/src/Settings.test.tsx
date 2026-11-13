import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ANTHROPIC_KEYS_URL, OPENROUTER_KEYS_URL } from '@/components/settings/ProviderKeyCard';
import {
  currentUrl,
  KEY_REJECTED_MESSAGE,
  KEY_UNREACHABLE_MESSAGE,
  MIRA,
  mockApi,
  OPENROUTER_KEY_REJECTED_MESSAGE,
  renderAt,
} from '@/test/app-harness';

const KEY = 'sk-ant-api03-MiraMiraMiraMiraMira0123456789_-abcd';
const NEW_KEY = 'sk-ant-api03-MiraSecondKeySecondKey0123456789-wxyz';
const OR_KEY = `sk-or-v1-${'0123456789abcdef'.repeat(3)}0123456789ab9876`;

const SAVED = {
  provider: 'anthropic',
  lastFour: 'abcd',
  createdAt: '2026-11-01T09:00:00.000Z',
} as const;
const SAVED_OR = {
  provider: 'openrouter',
  lastFour: '4321',
  createdAt: '2026-11-02T09:00:00.000Z',
} as const;

type CardName = 'Anthropic API key' | 'OpenRouter API key';

/** One provider's card: every query below looks inside it, since both cards share labels. */
function card(name: CardName = 'Anthropic API key') {
  return within(screen.getByRole('region', { name }));
}

function keyInput(name?: CardName): HTMLInputElement {
  return card(name).getByLabelText<HTMLInputElement>(/API key/);
}

function bodiesSent(
  fetchMock: ReturnType<typeof mockApi>,
  method: 'PUT' | 'DELETE',
  provider = 'anthropic',
): unknown[] {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) => input === `/api/me/credentials/${provider}` && init?.method === method,
    )
    .map(([, init]) =>
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    );
}

function typeAndSave(value: string, name?: CardName) {
  fireEvent.change(keyInput(name), { target: { value } });
  fireEvent.click(card(name).getByRole('button', { name: 'Save key' }));
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
    expect(card().getByText(/sends your notes and the campaign's records/)).toBeDefined();
    expect(card().getByText(/under your Anthropic account and Anthropic's terms/)).toBeDefined();
    expect(card().getByRole('link', { name: 'Anthropic Console' }).getAttribute('href')).toBe(
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

    expect(await card().findByText(/Key ending in/)).toHaveProperty(
      'textContent',
      expect.stringContaining('…abcd'),
    );
    expect(card().getByRole('status').textContent).toBe('Saved. Anthropic accepted the key.');
    expect(bodiesSent(fetchMock, 'PUT')).toEqual([{ apiKey: KEY }]);
    // The form is gone and the key appears nowhere on the page.
    expect(card().queryByRole('button', { name: 'Save key' })).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain(KEY.slice(13, 30));
  });

  it('checks the format before sending anything', async () => {
    const fetchMock = mockApi(MIRA);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Anthropic API key' });

    typeAndSave('sk-proj-notanthropic0123456789');

    expect((await card().findByRole('alert')).textContent).toContain('should start with sk-ant-');
    typeAndSave('sk-ant-admin01-AdminAdminAdminAdminAdmin');
    expect((await card().findByRole('alert')).textContent).toContain("That's an Admin API key");
    expect(bodiesSent(fetchMock, 'PUT')).toEqual([]);
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

    expect((await card().findByRole('alert')).textContent).toBe(message);
    await waitFor(() => {
      expect(keyInput().value).toBe('');
    });
    expect(card().queryByText(/Key ending in/)).toBeNull();
  });

  it('replaces a stored key', async () => {
    const fetchMock = mockApi(MIRA, [], { credentials: [SAVED] });
    renderAt('/settings');

    expect((await screen.findByText(/Key ending in/)).textContent).toContain('…abcd');
    expect(card().queryByRole('button', { name: 'Save key' })).toBeNull();

    fireEvent.click(card().getByRole('button', { name: 'Replace key' }));
    expect(card().getByLabelText('New API key')).toBeDefined();
    typeAndSave(NEW_KEY);

    await waitFor(() => {
      expect(card().getByText(/Key ending in/).textContent).toContain('…wxyz');
    });
    expect(bodiesSent(fetchMock, 'PUT')).toEqual([{ apiKey: NEW_KEY }]);
  });

  it('can cancel replacing a key', async () => {
    mockApi(MIRA, [], { credentials: [SAVED] });
    renderAt('/settings');

    await screen.findByText(/Key ending in/);
    fireEvent.click(card().getByRole('button', { name: 'Replace key' }));
    fireEvent.click(card().getByRole('button', { name: 'Cancel' }));

    expect(card().queryByLabelText('New API key')).toBeNull();
    expect(card().getByRole('button', { name: 'Replace key' })).toBeDefined();
  });

  it('removes a key after confirming', async () => {
    const fetchMock = mockApi(MIRA, [], { credentials: [SAVED] });
    renderAt('/settings');

    await screen.findByText(/Key ending in/);
    fireEvent.click(card().getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/delete it there too/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove key' }));
    // The dialog hides the rest of the page from assistive tech until it closes.
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(card().getByLabelText('Your API key')).toBeDefined();
    expect(card().queryByText(/Key ending in/)).toBeNull();
    expect(bodiesSent(fetchMock, 'DELETE')).toHaveLength(1);
  });

  describe('OpenRouter key (F2.2)', () => {
    const OR = 'OpenRouter API key' as const;

    it('explains what the key is for and links to OpenRouter', async () => {
      mockApi(MIRA);
      renderAt('/settings');

      expect(await screen.findByRole('heading', { name: OR })).toBeDefined();
      expect(card(OR).getByText(/art for your puppets, props and backdrops/)).toBeDefined();
      expect(card(OR).getByText(/style's reference images, to OpenRouter/)).toBeDefined();
      expect(
        card(OR).getByRole('link', { name: 'OpenRouter Keys page' }).getAttribute('href'),
      ).toBe(OPENROUTER_KEYS_URL);
      expect(keyInput(OR).placeholder).toBe('sk-or-…');
      expect(keyInput(OR).type).toBe('password');
    });

    it('saves a key to the OpenRouter route and shows only its last four', async () => {
      const fetchMock = mockApi(MIRA);
      renderAt('/settings');
      await screen.findByRole('heading', { name: OR });

      typeAndSave(` ${OR_KEY} `, OR);

      expect((await card(OR).findByText(/Key ending in/)).textContent).toContain('…9876');
      expect(card(OR).getByRole('status').textContent).toBe('Saved. OpenRouter accepted the key.');
      expect(bodiesSent(fetchMock, 'PUT', 'openrouter')).toEqual([{ apiKey: OR_KEY }]);
      expect(bodiesSent(fetchMock, 'PUT', 'anthropic')).toEqual([]);
      // The Anthropic card still asks for its own key.
      expect(card().getByLabelText('Your API key')).toBeDefined();
      expect(document.body.innerHTML).not.toContain(OR_KEY);
    });

    it('checks the format before sending anything', async () => {
      const fetchMock = mockApi(MIRA);
      renderAt('/settings');
      await screen.findByRole('heading', { name: OR });

      typeAndSave(KEY, OR);

      expect((await card(OR).findByRole('alert')).textContent).toContain(
        'should start with sk-or-',
      );
      expect(bodiesSent(fetchMock, 'PUT', 'openrouter')).toEqual([]);
    });

    it("shows OpenRouter's refusal and saves nothing", async () => {
      mockApi(MIRA);
      renderAt('/settings');
      await screen.findByRole('heading', { name: OR });

      typeAndSave(`sk-or-v1-thiskeyisrejected0123456789`, OR);

      expect((await card(OR).findByRole('alert')).textContent).toBe(
        OPENROUTER_KEY_REJECTED_MESSAGE,
      );
      expect(card(OR).queryByText(/Key ending in/)).toBeNull();
    });

    it('removes only the OpenRouter key', async () => {
      const fetchMock = mockApi(MIRA, [], { credentials: [SAVED, SAVED_OR] });
      renderAt('/settings');
      await screen.findByRole('heading', { name: OR });

      expect(card(OR).getByText(/Key ending in/).textContent).toContain('…4321');
      fireEvent.click(card(OR).getByRole('button', { name: 'Remove' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/Generating visuals won't work/)).toBeDefined();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove key' }));
      // The dialog hides the rest of the page from assistive tech until it closes.
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
      expect(card(OR).getByLabelText('Your API key')).toBeDefined();
      expect(bodiesSent(fetchMock, 'DELETE', 'openrouter')).toHaveLength(1);
      expect(bodiesSent(fetchMock, 'DELETE', 'anthropic')).toEqual([]);
      expect(card().getByText(/Key ending in/).textContent).toContain('…abcd');
    });
  });
});
