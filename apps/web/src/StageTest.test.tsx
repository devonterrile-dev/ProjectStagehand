import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StageCanvasProps } from '@/stage/StageCanvas';
import { SAMPLE_BACKDROPS } from '@/stage/samples';
import { currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

// jsdom has no WebGL, so the 3D canvas is replaced by a stand-in that shows what it was given.
vi.mock('@/stage/StageCanvas', () => ({
  StageCanvas: ({ backdropUrl, curtainOpen }: StageCanvasProps) => (
    <div
      data-testid="stage-canvas"
      data-backdrop={backdropUrl ?? ''}
      data-curtain={curtainOpen ? 'open' : 'closed'}
    />
  ),
}));

const canvas = () => screen.findByTestId('stage-canvas');

describe('Stage test page', () => {
  it('shows the theater with the first backdrop and the curtain open', async () => {
    mockApi(MIRA);
    renderAt('/stage-test');

    const stage = await canvas();
    expect(stage.dataset['backdrop']).toBe(SAMPLE_BACKDROPS[0]?.url);
    expect(stage.dataset['curtain']).toBe('open');
    expect(screen.getByRole('heading', { name: 'Stage test' })).toBeDefined();
  });

  it('fills the window, without the app header', async () => {
    mockApi(MIRA);
    renderAt('/stage-test');

    await canvas();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Your profile' })).toBeNull();
  });

  it('swaps the backdrop', async () => {
    mockApi(MIRA);
    renderAt('/stage-test');

    const stage = await canvas();
    const [first, second] = SAMPLE_BACKDROPS;
    const firstButton = screen.getByRole('button', { name: first?.label });
    const secondButton = screen.getByRole('button', { name: second?.label });
    expect(firstButton.getAttribute('aria-pressed')).toBe('true');
    expect(secondButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(secondButton);

    expect(stage.dataset['backdrop']).toBe(second?.url);
    expect(firstButton.getAttribute('aria-pressed')).toBe('false');
    expect(secondButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('closes and opens the curtain', async () => {
    mockApi(MIRA);
    renderAt('/stage-test');

    const stage = await canvas();
    fireEvent.click(screen.getByRole('button', { name: 'Close curtain' }));
    expect(stage.dataset['curtain']).toBe('closed');

    fireEvent.click(screen.getByRole('button', { name: 'Open curtain' }));
    expect(stage.dataset['curtain']).toBe('open');
  });

  it('sends signed-out visitors to sign-in', async () => {
    mockApi(null);
    renderAt('/stage-test');

    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
    expect(currentUrl()).toBe('/');
  });

  it('is linked from Settings', async () => {
    mockApi(MIRA);
    renderAt('/settings');

    const link = await screen.findByRole('link', { name: 'Stage test' });
    expect(link.getAttribute('href')).toBe('/stage-test');
  });
});
