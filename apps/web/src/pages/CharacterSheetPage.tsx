import { rulesetFor, type Campaign } from '@stagehand/shared';
import { Link, useNavigate, useParams } from 'react-router';

import { CharacterSheetForm } from '@/components/sheets/CharacterSheetForm';
import { CharacterSheetView } from '@/components/sheets/CharacterSheetView';
import { useCampaign, useCharacterSheet, useMembers, useOwnCharacterSheet } from '@/lib/queries';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/characters/:characterId`: the GM edits any PC's sheet; a player
 * reads their own PC's sheet only (D-23).
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
    <GmSheet campaign={campaign} characterId={characterId} />
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
      />
    </div>
  );
}

function PlayerSheet({ campaign, characterId }: { campaign: Campaign; characterId: string }) {
  const sheetQuery = useOwnCharacterSheet(campaign.id, characterId, true);

  if (sheetQuery.isPending) return <p className="text-muted-foreground">Loading sheet…</p>;
  if (sheetQuery.isError) {
    return <p role="alert">Could not load this sheet. Try again in a moment.</p>;
  }
  const sheet = sheetQuery.data;
  if (sheet === null) return <CharacterNotFound campaign={campaign} />;

  return (
    <div className="space-y-4">
      <BackLink campaign={campaign} />
      <p className="text-sm text-muted-foreground">
        Your GM keeps this sheet up to date. During play you&apos;ll spend Hope from here.
      </p>
      <CharacterSheetView sheet={sheet} ruleset={rulesetFor(campaign.rulesetVersion)} />
    </div>
  );
}
