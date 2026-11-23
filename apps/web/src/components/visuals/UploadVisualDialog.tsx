import {
  isCutoutKind,
  VISUAL_UPLOAD_MAX_BYTES,
  VISUAL_UPLOAD_MESSAGES,
  VISUAL_UPLOAD_TYPES,
  type AssetKind,
} from '@stagehand/shared';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

import { CHECKERBOARD } from './visual-style';

export interface UploadChoice {
  file: File;
  /** Only where there is a choice (NPCs). */
  kind?: AssetKind | undefined;
  finished: boolean;
}

interface UploadVisualDialogProps {
  name: string;
  /** The kinds this record or PC may be: two for an NPC, one elsewhere. */
  kinds: readonly AssetKind[];
  /** The kind it opens on, for an NPC. */
  initialKind: AssetKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (choice: UploadChoice) => void;
  /** True while the upload is being sent. */
  busy: boolean;
  /** Why the server refused the last upload, shown in the dialog. */
  error: string | null;
}

const KIND_CHOICES: { kind: AssetKind; label: string }[] = [
  { kind: 'character', label: 'Humanoid' },
  { kind: 'monster', label: 'Monster' },
];

/**
 * Upload image (F2.6, D-70): the GM's own picture, which becomes a draft to review like a
 * generated one. It is cut out and bordered for the stage, unless the GM says it already is a
 * finished stage image (one downloaded from another campaign, say): then it is kept as it is.
 * Backdrops are only cropped and sized either way, so they don't ask.
 */
export function UploadVisualDialog({ open, onOpenChange, ...props }: UploadVisualDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so it starts empty every time. */}
        <UploadForm
          {...props}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({
  name,
  kinds,
  initialKind,
  onUpload,
  busy,
  error,
  onCancel,
}: Omit<UploadVisualDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kind, setKind] = useState<AssetKind>(initialKind);
  const [finished, setFinished] = useState(false);
  const [preview, showPreview] = usePreview();
  const cutout = isCutoutKind(kind);

  function pick(picked: File | undefined) {
    setFile(null);
    setProblem(null);
    showPreview(null);
    if (picked === undefined) return;
    if (!(VISUAL_UPLOAD_TYPES as readonly string[]).includes(picked.type)) {
      setProblem(VISUAL_UPLOAD_MESSAGES.notImage);
    } else if (picked.size > VISUAL_UPLOAD_MAX_BYTES) {
      setProblem(VISUAL_UPLOAD_MESSAGES.tooBig);
    } else {
      setFile(picked);
      showPreview(picked);
    }
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === null) return;
    onUpload({
      file,
      kind: kinds.length > 1 ? kind : undefined,
      finished: cutout && finished,
    });
  }

  const shownError = problem ?? error;
  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Upload an image for {name}</DialogTitle>
        <DialogDescription>
          A PNG, JPEG or WebP image up to 10 MB. It becomes a new image to review, like a generated
          one.
          {cutout &&
            ' For a cut-out, use a transparent background or a flat magenta one (#FF00FF).'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-file`}>Image file</Label>
        <input
          id={`${id}-file`}
          type="file"
          accept={VISUAL_UPLOAD_TYPES.join(',')}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          onChange={(event) => {
            pick(event.target.files?.[0]);
          }}
        />
      </div>

      {preview !== null && (
        <div className="overflow-hidden rounded-md border" style={CHECKERBOARD}>
          <img src={preview} alt="The image to upload" className="max-h-60 w-full object-contain" />
        </div>
      )}

      {kinds.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Is {name} a humanoid or a monster?</legend>
          <div className="flex flex-wrap gap-4">
            {KIND_CHOICES.filter((choice) => kinds.includes(choice.kind)).map((choice) => (
              <label key={choice.kind} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={choice.kind}
                  checked={kind === choice.kind}
                  onChange={() => {
                    setKind(choice.kind);
                  }}
                />
                {choice.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            It picks the style used if you later regenerate it with notes.
          </p>
        </fieldset>
      )}

      {cutout && (
        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={finished}
              onChange={(event) => {
                setFinished(event.target.checked);
              }}
            />
            <span>Already a finished Stagehand image (skip the cut-out and border)</span>
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            Tick this for a stage image downloaded from another campaign. It is kept as it is, and
            can&apos;t be regenerated with notes.
          </p>
        </div>
      )}

      {shownError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {shownError}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={file === null || busy}>
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * An object URL for the chosen file, to show it before it is sent. The last one is revoked when
 * another file is chosen and when the form closes.
 */
function usePreview(): [string | null, (file: File | null) => void] {
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (current.current !== null) URL.revokeObjectURL(current.current);
    },
    [],
  );
  function show(file: File | null) {
    if (current.current !== null) URL.revokeObjectURL(current.current);
    // jsdom has no object URLs.
    current.current =
      file === null || typeof URL.createObjectURL !== 'function' ? null : URL.createObjectURL(file);
    setUrl(current.current);
  }
  return [url, show];
}
