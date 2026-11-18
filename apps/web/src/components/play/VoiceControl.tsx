import { Mic as MicIcon, MicOff } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';

import { Slider } from '@/components/scenes/PlacementControls';
import { Button } from '@/components/ui/button';
import { thresholdDb, type Mic, type MicStatus } from '@/play/mic';
import type { Voice } from '@/play/voice';

const KEY_HINT = 'Hold T to talk.';

/** Where a level sits on the meter, 0 to 100: the floor to as loud as the mic goes. */
function meter(db: number): number {
  const lowest = -80;
  return Math.round((100 * (Math.max(lowest, Math.min(0, db)) - lowest)) / -lowest);
}

const STATUS_LABEL: Record<MicStatus, string> = {
  off: 'Mic off',
  asking: 'Asking for the mic…',
  on: 'Mic on',
  muted: 'Mic muted',
  blocked: 'Mic blocked',
  unavailable: 'No mic',
};

/**
 * The mic at the table (F3.9): whether it is listening, a mute, and how sensitive it is, with
 * the level it hears against the line it must pass to count as talking.
 */
function MicControl({ mic }: { mic: Mic }) {
  const { status, level, talking, settings } = useStore(mic.store);
  const [open, setOpen] = useState(false);
  const canMute = status === 'on' || status === 'muted' || status === 'asking';
  const threshold = thresholdDb(settings.sensitivity);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant="secondary"
          aria-pressed={settings.muted}
          disabled={!canMute}
          title={settings.muted ? 'Unmute the mic' : 'Mute the mic'}
          onClick={() => {
            mic.setMuted(!settings.muted);
          }}
        >
          {settings.muted || status !== 'on' ? (
            <MicOff aria-hidden="true" />
          ) : (
            <MicIcon aria-hidden="true" className={talking ? 'text-amber-500' : ''} />
          )}
          {STATUS_LABEL[status]}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          Mic settings
        </Button>
      </div>
      {status === 'blocked' && (
        <p className="text-xs">
          The browser isn&apos;t letting Stagehand hear the mic. Allow it in the site settings (by
          the address bar), then reload. {KEY_HINT}
        </p>
      )}
      {status === 'unavailable' && <p className="text-xs">No mic was found. {KEY_HINT}</p>}
      {open && (
        <div role="group" aria-label="Mic settings" className="w-56 space-y-2 text-xs">
          <div
            role="meter"
            aria-label="Mic level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={meter(level)}
            className="relative h-2 overflow-hidden rounded-full bg-white/20"
          >
            <div
              className={`h-full ${level >= threshold ? 'bg-amber-400' : 'bg-white/60'}`}
              style={{ width: `${String(meter(level))}%` }}
            />
            <div
              aria-hidden="true"
              className="absolute inset-y-0 w-0.5 bg-red-400"
              style={{ left: `${String(meter(threshold))}%` }}
            />
          </div>
          <Slider
            label="Sensitivity"
            value={settings.sensitivity}
            min={0}
            max={100}
            step={5}
            shown={`${String(settings.sensitivity)}%`}
            disabled={false}
            onChange={(value) => {
              mic.setSensitivity(value);
            }}
          />
          <p>
            Your puppet talks while the level passes the red line; only that, never any sound,
            leaves this browser. Use headphones so others&apos; voices don&apos;t set it off.{' '}
            {KEY_HINT}
          </p>
        </div>
      )}
    </div>
  );
}

/** How the table hears its person talk (F3.9): the mic, Discord, or only the T key. */
export function VoiceControl({ voice }: { voice: Voice }) {
  if (voice.from === 'mic') return <MicControl mic={voice.mic} />;
  if (voice.from === 'discord') {
    return (
      <p className="text-xs">
        {voice.failed ? `Discord isn't saying who talks. ${KEY_HINT}` : 'Voice: from Discord'}
      </p>
    );
  }
  return <p className="text-xs">{KEY_HINT}</p>;
}
