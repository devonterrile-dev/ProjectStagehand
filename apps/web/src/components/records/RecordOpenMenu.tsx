import { ExternalLinkIcon, FileTextIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRecordNavigation } from '@/lib/record-navigation';

interface RecordOpenMenuProps {
  recordId: string;
  /** Read out with the menu items, e.g. "Mira". */
  name: string;
  /** The clickable chip. Rendered as the menu's trigger, so it must be a button. */
  children: ReactNode;
}

/**
 * A linked or mentioned record's two ways to open it (F1.5b). "Open" waits for the autosave,
 * then goes there in this tab; "Open in new tab" leaves this page alone. Clicking away or
 * Esc closes the menu with nothing opened. Non-modal, so the editor keeps its place.
 */
export function RecordOpenMenu({ recordId, name, children }: RecordOpenMenuProps) {
  const navigation = useRecordNavigation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={`Open ${name}`}>
        <DropdownMenuItem
          onSelect={() => {
            void navigation.open(recordId);
          }}
        >
          <FileTextIcon aria-hidden />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={navigation.hrefOf(recordId)} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon aria-hidden />
            Open in new tab
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
