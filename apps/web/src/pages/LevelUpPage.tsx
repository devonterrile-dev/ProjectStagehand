import type { Campaign } from '@stagehand/shared';
import { LEVEL_UP_MESSAGES } from '@stagehand/shared';
import { Link, useParams } from 'react-router';

import { LevelUpGuide } from '@/components/level-up/LevelUpGuide';
import { useCampaign, useCharacterSheet, useOwnCharacterSheet } from '@/lib/queries';
import { characterPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/characters/:characterId/level-up`: the level-up guide (F4.9). The PC's
 * own player levels up, or the GM for them, once the GM has granted a level.
 */
export function LevelUpPage() {
  const { campaignId = '', characterId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  return <LevelUpFor campaign={campaign} characterId={characterId} />;
}

function LevelUpFor({ campaign, characterId }: { campaign: Campaign; characterId: string }) {
  const isGm = campaign.role === 'gm';
  const gmSheet = useCharacterSheet(campaign.id, characterId, isGm);
  const ownSheet = useOwnCharacterSheet(campaign.id, characterId, !isGm);
  const query = isGm ? gmSheet : ownSheet;

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

  const blocked =
    campaign.archivedAt !== null
      ? "This campaign is archived, so its characters can't level up."
      : !sheet.levelUp.granted
        ? 'No level is granted right now: the GM grants one when the character levels up.'
        : sheet.links.classId === null
          ? LEVEL_UP_MESSAGES.needsClass
          : null;
  return (
    <div className="space-y-6">
      <Link
        to={characterPath(campaign.id, characterId)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to the sheet
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          Level {sheet.name} up to {sheet.level + 1}
        </h1>
        <p className="text-muted-foreground">
          {isGm
            ? 'You are levelling this character up for its player.'
            : 'Pick your options and your new card. Nothing is saved until you finish.'}
        </p>
      </div>
      {blocked === null ? <LevelUpGuide campaign={campaign} sheet={sheet} /> : <p>{blocked}</p>}
    </div>
  );
}
