import { loadoutMaxOf, rulesetFor, type Campaign } from '@stagehand/shared';
import { Link, useNavigate, useParams } from 'react-router';

import { CharacterSheetForm } from '@/components/sheets/CharacterSheetForm';
import { Button } from '@/components/ui/button';
import { CharacterSheetView } from '@/components/sheets/CharacterSheetView';
import { DomainPiles, FeatureSideCards } from '@/components/sheets/SideCards';
import { VisualCard } from '@/components/visuals/VisualCard';
import {
  useCampaign,
  useCharacterSheet,
  useMembers,
  useMoveHeldCard,
  useOwnCharacterSheet,
} from '@/lib/queries';
import { useRememberRecent } from '@/lib/recent-items';
import { characterBuildPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/characters/:characterId`: the GM edits any PC's sheet and makes its
 * puppet's visual (F2.3); a player reads their own PC's sheet only (D-23).
 */
export function CharacterSheetPage() {
  const { campaignId = '', characterId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;

  return campaign.role === 'gm' ? (
    <div className="mx-auto max-w-3xl">
      <GmSheet campaign={campaign} characterId={characterId} />
    </div>
  ) : (
    <PlayerSheet campaign={campaign} characterId={characterId} />
  );
}

function BackLink({ campaign }: { campaign: Campaign }) {
  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="text-sm text-muted-foreground hover:underline"
    >
      ← {campaign.name}
    </Link>
  );
}

function CharacterNotFound({ campaign }: { campaign: Campaign }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Character not found</h1>
      <p className="text-muted-foreground">It may have been deleted, or it isn&apos;t yours.</p>
      <Link to={`/campaigns/${campaign.id}`} className="underline">
        Back to {campaign.name}
      </Link>
    </div>
  );
}

function GmSheet({ campaign, characterId }: { campaign: Campaign; characterId: string }) {
  const sheetQuery = useCharacterSheet(campaign.id, characterId, true);
  const { data: members } = useMembers(campaign.id);
  const navigate = useNavigate();
  const loaded = sheetQuery.data ?? null;
  useRememberRecent(campaign.id, loaded === null ? null : { kind: 'character', id: loaded.id });

  if (sheetQuery.isPending) return <p className="text-muted-foreground">Loading sheet…</p>;
  if (sheetQuery.isError) {
    return <p role="alert">Could not load this sheet. Try again in a moment.</p>;
  }
  const sheet = sheetQuery.data;
  if (sheet === null) return <CharacterNotFound campaign={campaign} />;

  const player = members?.find((member) => member.userId === sheet.assignedToUserId);

  return (
    <div className="space-y-4">
      <BackLink campaign={campaign} />
      {campaign.archivedAt !== null && (
        <div className="rounded-md border bg-muted px-4 py-3 text-sm">
          This campaign is archived, so its sheets are read-only.
        </div>
      )}
      <CharacterSheetForm
        key={sheet.id}
        campaign={campaign}
        sheet={sheet}
        playerName={player?.displayName ?? null}
        onDeleted={() => {
          void navigate(`/campaigns/${campaign.id}`, { replace: true });
        }}
        visual={
          <VisualCard
            campaignId={campaign.id}
            owner={{ characterId: sheet.id }}
            name={sheet.name}
            subject="pc"
            readOnly={campaign.archivedAt !== null}
          />
        }
      />
    </div>
  );
}

function PlayerSheet({ campaign, characterId }: { campaign: Campaign; characterId: string }) {
  const sheetQuery = useOwnCharacterSheet(campaign.id, characterId, true);
  const move = useMoveHeldCard(campaign.id, characterId, 'player');

  if (sheetQuery.isPending) return <p className="text-muted-foreground">Loading sheet…</p>;
  if (sheetQuery.isError) {
    return <p role="alert">Could not load this sheet. Try again in a moment.</p>;
  }
  const sheet = sheetQuery.data;
  if (sheet === null) return <CharacterNotFound campaign={campaign} />;

  const ruleset = rulesetFor(campaign.rulesetVersion);
  const held = sheet.cards.loadout.length + sheet.cards.vault.length;

  // A PC waiting for the creation guide (F4.8) is built first.
  if (sheet.needsGuide && campaign.archivedAt === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink campaign={campaign} />
        <h1 className="text-2xl font-bold">{sheet.name}</h1>
        <p>Your GM has given you this character to build, a step at a time.</p>
        <Button asChild>
          <Link to={characterBuildPath(campaign.id, sheet.id)}>Build your character</Link>
        </Button>
      </div>
    );
  }

  // On a wide screen the domain card piles lie left of the sheet and the subclass and ancestry
  // cards right of it (F4.7); on a narrow one they follow it.
  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink campaign={campaign} />
        <p className="text-sm text-muted-foreground">
          Your GM keeps this sheet up to date.
          {held > 0 &&
            ' You move your domain cards between the loadout and the vault here or at the table.'}
        </p>
      </div>
      <div className="grid items-start gap-6 xl:justify-center xl:grid-cols-[18.5rem_minmax(0,48rem)_18.5rem]">
        <div className="mx-auto w-full max-w-3xl xl:order-2">
          <CharacterSheetView sheet={sheet} ruleset={ruleset} />
        </div>
        <aside aria-label="Subclass and ancestry" className="mx-auto xl:order-3">
          <FeatureSideCards cards={sheet.cards} ruleset={ruleset} />
        </aside>
        <aside aria-label="Domain cards" className="mx-auto xl:order-1">
          {held > 0 && (
            <DomainPiles
              cards={sheet.cards}
              loadoutMax={loadoutMaxOf(ruleset)}
              actions={
                campaign.archivedAt === null
                  ? {
                      onMove: (cardId, to, swapOut) =>
                        move.mutateAsync({
                          cardId,
                          input: { to, ...(swapOut === undefined ? {} : { swapOut }) },
                        }),
                    }
                  : undefined
              }
            />
          )}
        </aside>
      </div>
    </div>
  );
}
