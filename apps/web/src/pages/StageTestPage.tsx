import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { SAMPLE_BACKDROPS } from '@/stage/samples';
import { StageCanvas } from '@/stage/StageCanvas';

export const STAGE_TEST_PATH = '/stage-test';

/**
 * `/stage-test`: the tabletop theater on its own, with bundled sample art (F3.1). It needs no
 * campaign, so anyone signed in can open it to see how the stage looks and runs on their
 * device. Rendered inside RequireAuth and loaded lazily, so Three.js stays out of the main
 * bundle.
 */
export function StageTestPage() {
  const [backdropName, setBackdropName] = useState(SAMPLE_BACKDROPS[0]?.name ?? null);
  const [curtainOpen, setCurtainOpen] = useState(true);
  const backdrop = SAMPLE_BACKDROPS.find((sample) => sample.name === backdropName) ?? null;

  return (
    <div className="relative h-full w-full">
      <h1 className="sr-only">Stage test</h1>
      <StageCanvas backdropUrl={backdrop?.url ?? null} curtainOpen={curtainOpen} />

      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md bg-black/70 px-3 py-2 text-sm text-white">
        <Link to="/" className="underline">
          ← Stagehand
        </Link>
        <div role="group" aria-label="Backdrop" className="flex items-center gap-1.5">
          <span aria-hidden>Backdrop</span>
          {SAMPLE_BACKDROPS.map((sample) => (
            <Button
              key={sample.name}
              size="xs"
              variant={sample.name === backdropName ? 'default' : 'secondary'}
              aria-pressed={sample.name === backdropName}
              onClick={() => {
                setBackdropName(sample.name);
              }}
            >
              {sample.label}
            </Button>
          ))}
        </div>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => {
            setCurtainOpen((open) => !open);
          }}
        >
          {curtainOpen ? 'Close curtain' : 'Open curtain'}
        </Button>
      </div>
    </div>
  );
}
