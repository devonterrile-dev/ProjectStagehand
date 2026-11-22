import type { Campaign } from '@stagehand/shared';
import { Link, useParams } from 'react-router';

import { CreationGuide } from '@/components/build/CreationGuide';
import { useCampaign, useCharacterSheet, useOwnCharacterSheet } from '@/lib/queries';
import { characterPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/characters/:characterId/build`: the character creation guide (F4.8).
 * The PC's own player builds it, or the GM for them, while it waits for the guide.
 */
export function CharacterBuildPage() {
  const { campaignId = '', characterId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  return <BuildFor campaign={campaign} characterId={characterId} />;
}

function BuildFor({ campaign, characterId }: { campaign: Campaign; characterId: string }) {
  const isGm = campaign.role === 'gm';
  const gmSheet = useCharacterSheet(campaign.id, characterId, isGm);
  const ownSheet = useOwnCharacterSheet(campaign.id, characterId, !isGm);
  const query = isGm ? gmSheet : ownSheet;
  const back = (
    <Link
      to={characterPath(campaign.id, characterId)}
      className="text-sm text-muted-foreground hover:underline"
    >
      ← Back to the sheet
    </Link>
  );

  if (query.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (query.isError)
    return <p role="alert">Could not load this character. Try again in a moment.</p>;
  const sheet = query.data;
  if (sheet === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Character not found</h1>
        <Link to={`/campaigns/${campaign.id}`} className="underline">
          Back to {campaign.name}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Build {sheet.name}</h1>
        <p className="text-muted-foreground">
          {isGm
            ? 'You are building this character for its player.'
            : 'Build your level 1 character, a step at a time. Nothing is saved until Finish.'}
        </p>
      </div>
      {campaign.archivedAt !== null ? (
        <p>This campaign is archived, so its characters can&apos;t be built.</p>
      ) : !sheet.needsGuide ? (
        <p>This character is already built.</p>
      ) : (
        <CreationGuide campaign={campaign} sheet={sheet} />
      )}
    </div>
  );
}
