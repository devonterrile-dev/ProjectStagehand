import {
  DOMAIN_CARD_LEVEL_MAX,
  DOMAIN_CARD_NAME_MAX,
  DOMAIN_CARD_TYPES,
  domainCardTypeSchema,
  emptyRichText,
  isEmptyRichText,
  RECALL_COST_MAX,
  updateDomainCardRequestSchema,
  type Campaign,
  type DomainCard,
  type UpdateDomainCardRequest,
} from '@stagehand/shared';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldError } from '@/components/FieldError';
import { DomainCardView } from '@/components/gameplay/DomainCardView';
import { cardTypeLabel } from '@/components/gameplay/labels';
import { RichTextEditor } from '@/components/records/RichTextEditor';
import { SaveStatus } from '@/components/records/SaveStatus';
import { NumberField } from '@/components/sheets/NumberField';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  useCampaign,
  useDeleteDomainCard,
  useDomainCard,
  useDomains,
  usePatchDomainCard,
} from '@/lib/queries';
import { domainPath, gameplayPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/domain-cards/:cardId` (F4.3): one domain card. */
export function DomainCardPage() {
  const { campaignId = '', cardId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const cardQuery = useDomainCard(campaignId, cardId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  if (cardQuery.isPending) return <p className="text-muted-foreground">Loading card…</p>;
  if (cardQuery.isError) {
    return <p role="alert">Could not load this card. Try again in a moment.</p>;
  }
  const card = cardQuery.data;
  if (card === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Card not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link to={gameplayPath(campaign.id)} className="underline">
          Back to gameplay
        </Link>
      </div>
    );
  }

  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  return (
    <div className="space-y-4">
      <Link
        to={domainPath(campaign.id, card.domainId)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {card.domainName}
      </Link>
      {canWrite ? (
        <DomainCardForm key={card.id} campaign={campaign} card={card} />
      ) : (
        <DomainCardView card={card} />
      )}
    </div>
  );
}

type Key = keyof UpdateDomainCardRequest;

/** The GM's editor for a domain card, autosaving key by key. */
function DomainCardForm({ campaign, card }: { campaign: Campaign; card: DomainCard }) {
  const { mutateAsync: sendPatch } = usePatchDomainCard(campaign.id, card.id);
  const del = useDeleteDomainCard(campaign.id);
  const domains = useDomains(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateDomainCardRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const [name, setName] = useState(card.name);
  const [domainId, setDomainId] = useState(card.domainId);
  const [type, setType] = useState(card.type);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [deleting, setDeleting] = useState(false);

  function commit(key: Key, value: unknown, now = false) {
    const parsed = updateDomainCardRequestSchema.safeParse({ [key]: value });
    if (!parsed.success) {
      setErrors((current) => ({ ...current, [key]: parsed.error.issues[0]?.message }));
      return;
    }
    setErrors((current) => ({ ...current, [key]: undefined }));
    autosave.save(parsed.data);
    if (now) autosave.flush();
  }

  const number = (key: 'level' | 'recallCost', label: string, min: number, max: number) => (
    <NumberField
      id={`card-${key}`}
      label={label}
      initial={card[key]}
      min={min}
      max={max}
      disabled={false}
      error={errors[key] ?? null}
      onCommit={(value) => {
        if (value === null) setErrors((current) => ({ ...current, [key]: 'Enter a whole number' }));
        else commit(key, value);
      }}
      onBlur={autosave.flush}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          <Input
            aria-label="Card name"
            className="text-lg font-semibold md:text-lg"
            value={name}
            maxLength={DOMAIN_CARD_NAME_MAX}
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
              <Button variant="ghost" size="icon" aria-label="Card settings">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="card-domain">Domain</Label>
          <NativeSelect
            id="card-domain"
            value={domainId}
            onChange={(event) => {
              setDomainId(event.target.value);
              commit('domainId', event.target.value, true);
            }}
          >
            {(domains.data ?? [{ id: card.domainId, name: card.domainName }]).map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="card-type">Type</Label>
          <NativeSelect
            id="card-type"
            value={type}
            onChange={(event) => {
              const next = domainCardTypeSchema.parse(event.target.value);
              setType(next);
              commit('type', next, true);
            }}
          >
            {DOMAIN_CARD_TYPES.map((option) => (
              <option key={option} value={option}>
                {cardTypeLabel(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {number('level', 'Level', 1, DOMAIN_CARD_LEVEL_MAX)}
        {number('recallCost', 'Recall cost', 0, RECALL_COST_MAX)}
      </div>

      <div className="space-y-2">
        <Label>Feature</Label>
        <RichTextEditor
          id="card-feature"
          label="Feature"
          value={card.feature}
          editable
          onChange={(doc) => {
            commit('feature', isEmptyRichText(doc) ? emptyRichText() : doc);
          }}
          onBlur={autosave.flush}
        />
        <FieldError message={errors.feature ?? null} />
      </div>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${card.name}?`}
          description="This can't be undone."
          confirmLabel="Delete card"
          onConfirm={async () => {
            await del.mutateAsync(card.id);
            void navigate(domainPath(campaign.id, domainId), { replace: true });
          }}
        />
      )}
    </div>
  );
}
