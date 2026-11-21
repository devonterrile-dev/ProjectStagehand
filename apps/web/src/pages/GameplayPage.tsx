import { DOMAIN_NAME_MAX, domainNameSchema, type Campaign } from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { SRD_ATTRIBUTION } from '@/components/gameplay/attribution';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCampaign, useCreateDomain, useDomains } from '@/lib/queries';
import { domainPath, statBlocksPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/gameplay` (F4.3, governance §8 "Gameplay records"): the game's
 * mechanics, apart from the campaign's records. Domains for everyone; stat blocks for the GM.
 */
export function GameplayPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <GameplayView campaign={campaign} />;
}

/** The first sentence of a description, for a list. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end < 0 ? text : text.slice(0, end + 1);
}

function GameplayView({ campaign }: { campaign: Campaign }) {
  const isGm = campaign.role === 'gm';
  const canWrite = isGm && campaign.archivedAt === null;
  const { data: domains, isPending, isError } = useDomains(campaign.id);
  const create = useCreateDomain(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <Link
        to={`/campaigns/${campaign.id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {campaign.name}
      </Link>
      <h1 className="text-2xl font-bold">Gameplay</h1>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>
              <h2 className="text-xl">Domains</h2>
            </CardTitle>
            <CardDescription>
              Each class draws its cards from two domains. Open one to read its cards.
            </CardDescription>
          </div>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon aria-hidden />
              New domain
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {isPending && <p className="text-muted-foreground">Loading domains…</p>}
          {isError && <p role="alert">Could not load the domains. Try again in a moment.</p>}
          {domains?.length === 0 && (
            <p className="text-sm text-muted-foreground">No domains yet.</p>
          )}
          {domains !== undefined && domains.length > 0 && (
            <ul aria-label="Domains" className="divide-y rounded-md border">
              {domains.map((domain) => (
                <li key={domain.id}>
                  <Link
                    to={domainPath(campaign.id, domain.id)}
                    className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{domain.name}</span>
                      {domain.description !== '' && (
                        <span className="block text-sm text-muted-foreground">
                          {firstSentence(domain.description)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {domain.cardCount === 1 ? '1 card' : `${String(domain.cardCount)} cards`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{SRD_ATTRIBUTION}</p>
        </CardContent>
      </Card>

      {isGm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>
                <h2 className="text-xl">Stat blocks</h2>
              </CardTitle>
              <CardDescription>Monsters and NPCs who may fight. Only you see them.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to={statBlocksPath(campaign.id)}>Open stat blocks</Link>
            </Button>
          </CardHeader>
        </Card>
      )}

      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New domain"
        description="You can describe it and add its cards after."
        submitLabel="Create domain"
        label="Name"
        schema={domainNameSchema}
        maxLength={DOMAIN_NAME_MAX}
        onSave={async (name) => {
          const domain = await create.mutateAsync({ name });
          void navigate(domainPath(campaign.id, domain.id));
        }}
      />
    </div>
  );
}
