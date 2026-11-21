import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Link, useMatch } from 'react-router';

import { QuickJump } from '@/components/search/QuickJump';
import { UserAvatar } from '@/components/UserAvatar';
import { useMe } from '@/lib/queries';

/** Pages laid out wider than the rest: a record page has a side column (F1.5b). */
const WIDE_PAGE = '/campaigns/:campaignId/records/:recordId';
/** A sheet page (F4.7): a player's sheet has its cards to either side on a wide screen. */
const SHEET_PAGE = '/campaigns/:campaignId/characters/:characterId';

/** Pages that are all stage: they fill the window, with no header (F3.1). */
const STAGE_PAGE = '/stage-test';
const ACTIVITY_PAGE = '/activity-test';
/** The scene builder (F3.2): the theater with its tray and panel. */
const SCENE_PAGE = '/campaigns/:campaignId/scenes/:sceneId';
/** The table during a live session (F3.3). */
const PLAY_PAGE = '/campaigns/:campaignId/play';

/** The whole window for the stage: black, no header, nothing scrolls. */
export function StageShell({ children }: { children: ReactNode }) {
  return <main className="h-svh w-full overflow-hidden bg-black text-white">{children}</main>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const wide = useMatch(WIDE_PAGE) !== null;
  const sheetPage = useMatch(SHEET_PAGE) !== null;
  const width = sheetPage ? 'max-w-[88rem]' : wide ? 'max-w-6xl' : 'max-w-3xl';
  const stageTest = useMatch(STAGE_PAGE) !== null;
  const activityTest = useMatch(ACTIVITY_PAGE) !== null;
  const sceneBuilder = useMatch(SCENE_PAGE) !== null;
  const play = useMatch(PLAY_PAGE) !== null;

  if (stageTest || activityTest || sceneBuilder || play) {
    return <StageShell>{children}</StageShell>;
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className={cn('mx-auto flex h-14 items-center justify-between px-4', width)}>
          <Link to="/" className="text-lg font-bold tracking-tight">
            Stagehand
          </Link>
          {me && (
            <div className="flex items-center gap-4">
              <QuickJump />
              <Link to="/settings" className="text-sm font-medium hover:underline">
                Settings
              </Link>
              <Link
                to="/profile"
                className="flex items-center gap-2 text-sm font-medium"
                aria-label="Your profile"
              >
                <span className="hidden sm:inline">{me.displayName}</span>
                <UserAvatar user={me} className="size-8" />
              </Link>
            </div>
          )}
        </div>
      </header>
      <main className={cn('mx-auto px-4 py-10', width)}>{children}</main>
    </div>
  );
}
