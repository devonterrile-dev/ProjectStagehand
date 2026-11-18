import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MEASURE_SECONDS, NO_FRAMES_MESSAGE } from '@/pages/StageTestPage';
import type { LiveStats } from '@/stage/PerfProbe';
import { SAMPLE_BACKDROPS } from '@/stage/samples';
import type { StageTestCanvasProps } from '@/stage/StageTestCanvas';
import { currentUrl, MIRA, mockApi, renderAt } from '@/test/app-harness';

/** What the page last handed the canvas, so a test can play the part of the 3D stage. */
let canvasProps: StageTestCanvasProps | null = null;

// jsdom has no WebGL, so the 3D canvas is replaced by a stand-in that shows what it was given.
vi.mock('@/stage/StageTestCanvas', () => ({
  StageTestCanvas: (props: StageTestCanvasProps) => {
    canvasProps = props;
    return (
      <div
        data-testid="stage-canvas"
        data-backdrop={props.backdropUrl ?? ''}
        data-curtain={props.curtainOpen ? 'open' : 'closed'}
        data-objects={String(props.objectCount)}
        data-sway={String(props.sway)}
        data-talking={String(props.talking)}
        data-emote={props.emote === null ? '' : `${props.emote.id}:${props.emote.emote}`}
        data-pixel-ratio={String(props.maxPixelRatio)}
        data-measure={props.measure === null ? '' : String(props.measure.seconds)}
      />
    );
  },
}));

const LIVE: LiveStats = {
  fps: 59.7,
  drawCalls: 118,
  triangles: 2304,
  textures: 37,
  pixelRatio: 1.5,
  width: 1280,
  height: 720,
  gpu: 'Test GPU 3000',
  measuringLeft: null,
};

const canvas = () => screen.findByTestId('stage-canvas');
const group = (name: string) => within(screen.getByRole('group', { name }));
const panel = () => within(screen.getByRole('region', { name: 'Performance' }));

/** The stage reports its live numbers. */
function sendLive(live: Partial<LiveStats> = {}) {
  act(() => {
    canvasProps?.onLive({ ...LIVE, ...live });
  });
}

/** The stage finishes the measurement it was asked for. */
function finishMeasurement(frameSeconds: number[]) {
  act(() => {
    const run = canvasProps?.measure;
    if (run == null) throw new Error('No measurement is running');
    canvasProps?.onMeasured(run.id, frameSeconds, LIVE);
  });
}

async function open() {
  mockApi(MIRA);
  renderAt('/stage-test');
  return canvas();
}

describe('Stage test page', () => {
  it('shows the theater with the first backdrop, the curtain open and 30 objects', async () => {
    const stage = await open();

    expect(stage.dataset['backdrop']).toBe(SAMPLE_BACKDROPS[0]?.url);
    expect(stage.dataset['curtain']).toBe('open');
    expect(stage.dataset['objects']).toBe('30');
    expect(stage.dataset['sway']).toBe('true');
    expect(stage.dataset['pixelRatio']).toBe('1.5');
    expect(screen.getByRole('heading', { name: 'Stage test' })).toBeDefined();
  });

  it('fills the window, without the app header', async () => {
    await open();

    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Your profile' })).toBeNull();
  });

  it('swaps the backdrop', async () => {
    const stage = await open();
    const [first, second] = SAMPLE_BACKDROPS;
    const firstButton = group('Backdrop').getByRole('button', { name: first?.label });
    const secondButton = group('Backdrop').getByRole('button', { name: second?.label });
    expect(firstButton.getAttribute('aria-pressed')).toBe('true');
    expect(secondButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(secondButton);

    expect(stage.dataset['backdrop']).toBe(second?.url);
    expect(firstButton.getAttribute('aria-pressed')).toBe('false');
    expect(secondButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('closes and opens the curtain', async () => {
    const stage = await open();

    fireEvent.click(screen.getByRole('button', { name: 'Close curtain' }));
    expect(stage.dataset['curtain']).toBe('closed');

    fireEvent.click(screen.getByRole('button', { name: 'Open curtain' }));
    expect(stage.dataset['curtain']).toBe('open');
  });

  it('tries the mic, with its settings, and lets it go (F3.9)', async () => {
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    // jsdom has no mic: the page says so rather than failing.
    expect(screen.getByText('No mic')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Mic settings' }));
    expect(screen.getByLabelText('Sensitivity')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Stop the mic' }));
    expect(screen.queryByText('No mic')).toBeNull();
  });

  it('makes every puppet talk, and plays the chosen emote on them (F3.7)', async () => {
    const stage = await open();
    expect(stage.dataset['talking']).toBe('false');
    expect(stage.dataset['emote']).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Talk' }));
    expect(stage.dataset['talking']).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Stop talking' }));
    expect(stage.dataset['talking']).toBe('false');

    fireEvent.change(screen.getByLabelText('Emote'), { target: { value: 'bow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(stage.dataset['emote']).toBe('1:bow');
    // The same emote again is a new play.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(stage.dataset['emote']).toBe('2:bow');
  });

  it('changes how many objects are on stage, their sway and the sharpness', async () => {
    const stage = await open();

    fireEvent.click(group('Objects').getByRole('button', { name: '10' }));
    expect(stage.dataset['objects']).toBe('10');
    expect(group('Objects').getByRole('button', { name: '10' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop swaying' }));
    expect(stage.dataset['sway']).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Sway puppets' }));
    expect(stage.dataset['sway']).toBe('true');

    fireEvent.click(group('Sharpness').getByRole('button', { name: '1x' }));
    expect(stage.dataset['pixelRatio']).toBe('1');
  });

  it('shows the live numbers once the stage reports them', async () => {
    await open();
    expect(panel().getByText('Starting the stage…')).toBeDefined();
    expect(panel().getByRole('button', { name: /Measure/ })).toHaveProperty('disabled', true);

    sendLive();

    expect(panel().getByLabelText('Frames per second').textContent).toBe('60 fps');
    expect(panel().getByText('118')).toBeDefined();
    expect(panel().getByText('2,304')).toBeDefined();
    expect(panel().getByText('37')).toBeDefined();
    expect(panel().getByText('1,280 × 720 at 1.5x')).toBeDefined();
    expect(panel().getByText('Test GPU 3000')).toBeDefined();
  });

  it('measures for 30 seconds and gives one line to copy', async () => {
    const stage = await open();
    sendLive();
    fireEvent.click(group('Objects').getByRole('button', { name: '20' }));

    fireEvent.click(panel().getByRole('button', { name: `Measure ${String(MEASURE_SECONDS)} s` }));

    expect(stage.dataset['measure']).toBe(String(MEASURE_SECONDS));
    sendLive({ measuringLeft: 11.2 });
    expect(panel().getByRole('button', { name: 'Measuring… 12 s left' })).toHaveProperty(
      'disabled',
      true,
    );
    // What is being measured can't change under the measurement.
    expect(group('Objects').getByRole('button', { name: '10' })).toHaveProperty('disabled', true);
    expect(group('Sharpness').getByRole('button', { name: '1x' })).toHaveProperty('disabled', true);

    finishMeasurement(Array.from({ length: 1500 }, () => 1 / 50));

    expect(stage.dataset['measure']).toBe('');
    const result = panel().getByLabelText<HTMLTextAreaElement>('Result').value;
    expect(result).toContain('Stage test: 20 objects, ');
    expect(result).toContain('Test GPU 3000, 1280×720 at 1.5x: average 50 fps, slowest 1% 50 fps');
    expect(group('Objects').getByRole('button', { name: '10' })).toHaveProperty('disabled', false);
    expect(panel().getByRole('button', { name: 'Copy result' })).toBeDefined();
  });

  it('copies the result', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    // jsdom has no clipboard.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      await open();
      sendLive();
      fireEvent.click(panel().getByRole('button', { name: /^Measure/ }));
      finishMeasurement([1 / 60, 1 / 60]);

      fireEvent.click(panel().getByRole('button', { name: 'Copy result' }));

      expect(await panel().findByRole('button', { name: 'Copied' })).toBeDefined();
      expect(writeText).toHaveBeenCalledWith(
        panel().getByLabelText<HTMLTextAreaElement>('Result').value,
      );
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('says so when no frames were drawn during the measurement', async () => {
    await open();
    sendLive();
    fireEvent.click(panel().getByRole('button', { name: /^Measure/ }));

    finishMeasurement([]);

    expect(panel().getByLabelText<HTMLTextAreaElement>('Result').value).toBe(NO_FRAMES_MESSAGE);
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
