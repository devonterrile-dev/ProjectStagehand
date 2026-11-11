import { PlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** One §8 group of the sheet. */
export function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg">{title}</h2>
        </CardTitle>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      <PlusIcon aria-hidden />
      {label}
    </Button>
  );
}

/** A removable section (a weapon in hand, the armor, the class feature). */
export function SectionBox({
  removeLabel,
  disabled,
  waiting,
  onRemove,
  children,
}: {
  removeLabel: string;
  disabled: boolean;
  /** True while it has no name, so it isn't saved yet. */
  waiting: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">{children}</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {waiting && <p className="text-xs text-muted-foreground">Give it a name to save it.</p>}
    </div>
  );
}
