import {
  DOMAIN_CARD_NAME_MAX,
  DOMAIN_DESCRIPTION_MAX,
  DOMAIN_NAME_MAX,
  domainCardNameSchema,
  updateDomainRequestSchema,
  type Campaign,
  type Domain,
  type DomainCardSummary,
  type UpdateDomainRequest,
} from '@stagehand/shared';
import { MoreHorizontalIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldError } from '@/components/FieldError';
import { cardTypeLabel } from '@/components/gameplay/labels';
import { SaveStatus } from '@/components/records/SaveStatus';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useCampaign,
  useCreateDomainCard,
  useDeleteDomain,
  useDomain,
  usePatchDomain,
} from '@/lib/queries';
import { domainCardPath, gameplayPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/domains/:domainId` (F4.3): a domain and its cards. */
export function DomainPage() {
  const { campaignId = '', domainId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const domainQuery = useDomain(campaignId, domainId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;

  const backLink = (
    <Link to={gameplayPath(campaign.id)} className="text-sm text-muted-foreground hover:underline">
      ← Gameplay
    </Link>
  );
  if (domainQuery.isPending) return <p className="text-muted-foreground">Loading domain…</p>;
  if (domainQuery.isError) {
    return <p role="alert">Could not load this domain. Try again in a moment.</p>;
  }
  const domain = domainQuery.data;
  if (domain === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Domain not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        {backLink}
      </div>
    );
  }

  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  return (
    <div className="space-y-4">
      {backLink}
      {canWrite ? (
        <DomainEditor key={domain.id} campaign={campaign} domain={domain} />
      ) : (
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{domain.name}</h1>
          {domain.description !== '' && (
            <p className="whitespace-pre-line text-muted-foreground">{domain.description}</p>
          )}
        </div>
      )}
      <CardsByLevel campaign={campaign} domain={domain} canWrite={canWrite} />
    </div>
  );
}

/** The GM's name and description, autosaving, and the way to delete the domain. */
function DomainEditor({ campaign, domain }: { campaign: Campaign; domain: Domain }) {
  const { mutateAsync: sendPatch } = usePatchDomain(campaign.id, domain.id);
  const del = useDeleteDomain(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateDomainRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const [name, setName] = useState(domain.name);
  const [description, setDescription] = useState(domain.description);
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
  const [deleting, setDeleting] = useState(false);

  function commit(key: 'name' | 'description', value: string) {
    const parsed = updateDomainRequestSchema.safeParse({ [key]: value });
    if (!parsed.success) {
      setErrors((current) => ({ ...current, [key]: parsed.error.issues[0]?.message }));
      return;
    }
    setErrors((current) => ({ ...current, [key]: undefined }));
    autosave.save(parsed.data);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          <Input
            aria-label="Domain name"
            className="text-lg font-semibold md:text-lg"
            value={name}
            maxLength={DOMAIN_NAME_MAX}
            aria-invalid={errors.name !== undefined}
            onChange={(event) => {
              setName(event.target.value);
              commit('name', event.target.value);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errors.name ?? null} />
        </div>
        <div className="flex items-center gap-2">
          <SaveStatus status={autosave.status} error={autosave.error} onRetry={autosave.flush} />
          {/* Non-modal so the confirm dialog it opens can take focus cleanly. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Domain settings">
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDeleting(true);
                }}
              >
                <Trash2Icon aria-hidden />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="domain-description">Description</Label>
        <Textarea
          id="domain-description"
          rows={5}
          value={description}
          maxLength={DOMAIN_DESCRIPTION_MAX}
          aria-invalid={errors.description !== undefined}
          onChange={(event) => {
            setDescription(event.target.value);
            commit('description', event.target.value);
          }}
          onBlur={autosave.flush}
        />
        <FieldError message={errors.description ?? null} />
      </div>
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${domain.name}?`}
          description="A domain that still has cards can't be deleted. This can't be undone."
          confirmLabel="Delete domain"
          onConfirm={async () => {
            await del.mutateAsync(domain.id);
            void navigate(gameplayPath(campaign.id), { replace: true });
          }}
        />
      )}
    </div>
  );
}

/** The domain's cards under a heading for each level, and New card for the GM. */
function CardsByLevel({
  campaign,
  domain,
  canWrite,
}: {
  campaign: Campaign;
  domain: Domain;
  canWrite: boolean;
}) {
  const create = useCreateDomainCard(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const levels = new Map<number, DomainCardSummary[]>();
  for (const card of domain.cards)
    levels.set(card.level, [...(levels.get(card.level) ?? []), card]);

  return (
    <section aria-label="Cards" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Cards</h2>
        {canWrite && (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <PlusIcon aria-hidden />
            New card
          </Button>
        )}
      </div>
      {domain.cards.length === 0 && (
        <p className="text-sm text-muted-foreground">No cards in this domain yet.</p>
      )}
      {[...levels.entries()].map(([level, cards]) => (
        <div key={level} className="space-y-1">
          <h3 className="text-sm font-semibold text-muted-foreground">Level {level}</h3>
          <ul aria-label={`Level ${String(level)}`} className="divide-y rounded-md border">
            {cards.map((card) => (
              <li key={card.id}>
                <Link
                  to={domainCardPath(campaign.id, card.id)}
                  className="flex items-center justify-between gap-4 px-4 py-2 hover:bg-muted"
                >
                  <span className="font-medium">{card.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {cardTypeLabel(card.type)} · recall {card.recallCost}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title={`New ${domain.name} card`}
        description="You can set its level, recall cost, type and feature after."
        submitLabel="Create card"
        label="Name"
        schema={domainCardNameSchema}
        maxLength={DOMAIN_CARD_NAME_MAX}
        onSave={async (name) => {
          const card = await create.mutateAsync({ domainId: domain.id, name });
          void navigate(domainCardPath(campaign.id, card.id));
        }}
      />
    </section>
  );
}
