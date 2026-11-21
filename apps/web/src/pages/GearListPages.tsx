import {
  formatDamage,
  GEAR_NAME_MAX,
  gearNameSchema,
  rulesetFor,
  traitLabel,
  WEAPON_SLOTS,
  type ArmorRecord,
  type Campaign,
  type WeaponRecord,
} from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { burdenLabel, damageKindLabel, rangeLabel, slotLabel } from '@/components/gameplay/labels';
import { Button } from '@/components/ui/button';
import {
  useArmorList,
  useCampaign,
  useCreateArmor,
  useCreateWeapon,
  useWeapons,
} from '@/lib/queries';
import { armorPath, gameplayPath, weaponPath } from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/gameplay/weapons` and `/armor` (F4.4): the campaign's gear under a
 * heading for each tier, as tables. A row's name opens it: the GM's form, or a player's card.
 */

/** Loads the campaign, then renders the list for it. */
function WithCampaign({ children }: { children: (campaign: Campaign) => ReactNode }) {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);
  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return children(campaign);
}

function ListLayout({
  campaign,
  title,
  description,
  newLabel,
  onNew,
  children,
}: {
  campaign: Campaign;
  title: string;
  description: string;
  newLabel: string;
  onNew: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Link
        to={gameplayPath(campaign.id)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Gameplay
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {onNew !== null && (
          <Button size="sm" onClick={onNew}>
            <PlusIcon aria-hidden />
            {newLabel}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Groups by tier, keeping the server's order inside each. */
function byTier<T extends { tier: number }>(items: readonly T[]): [number, T[]][] {
  const tiers = new Map<number, T[]>();
  for (const item of items) tiers.set(item.tier, [...(tiers.get(item.tier) ?? []), item]);
  return [...tiers.entries()].sort(([a], [b]) => a - b);
}

function featureOf(item: { featureName: string; featureText: string }): string {
  if (item.featureName !== '') return item.featureName;
  return item.featureText;
}

function GearTable({ label, head, rows }: { label: string; head: string[]; rows: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {head.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{rows}</tbody>
      </table>
    </div>
  );
}

const cell = 'px-3 py-2 align-top';

export function WeaponsPage() {
  return <WithCampaign>{(campaign) => <WeaponsView campaign={campaign} />}</WithCampaign>;
}

function WeaponsView({ campaign }: { campaign: Campaign }) {
  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  const ruleset = rulesetFor(campaign.rulesetVersion);
  const { data: weapons, isPending, isError } = useWeapons(campaign.id);
  const create = useCreateWeapon(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <ListLayout
      campaign={campaign}
      title="Weapons"
      description="By tier. A PC can use gear of their own tier or lower."
      newLabel="New weapon"
      onNew={
        canWrite
          ? () => {
              setCreating(true);
            }
          : null
      }
    >
      {isPending && <p className="text-muted-foreground">Loading weapons…</p>}
      {isError && <p role="alert">Could not load the weapons. Try again in a moment.</p>}
      {weapons?.length === 0 && <p className="text-sm text-muted-foreground">No weapons yet.</p>}
      {byTier(weapons ?? []).map(([tier, inTier]) => (
        <section key={tier} aria-label={`Tier ${String(tier)}`} className="space-y-2">
          <h2 className="text-xl font-semibold">Tier {tier}</h2>
          {WEAPON_SLOTS.map((slot) => {
            const rows = inTier.filter((weapon) => weapon.slot === slot);
            if (rows.length === 0) return null;
            return (
              <div key={slot} className="space-y-1">
                <h3 className="text-sm font-semibold text-muted-foreground">{slotLabel(slot)}</h3>
                <GearTable
                  label={`Tier ${String(tier)} ${slot} weapons`}
                  head={['Name', 'Trait', 'Range', 'Damage', 'Burden', 'Feature']}
                  rows={rows.map((weapon: WeaponRecord) => (
                    <tr key={weapon.id}>
                      <td className={cell}>
                        <Link
                          to={weaponPath(campaign.id, weapon.id)}
                          className="font-medium hover:underline"
                        >
                          {weapon.name}
                        </Link>
                      </td>
                      <td className={cell}>{traitLabel(ruleset, weapon.trait)}</td>
                      <td className={cell}>{rangeLabel(weapon.range)}</td>
                      <td className={cell}>
                        {formatDamage(weapon.damageDie, weapon.damageBonus)}{' '}
                        {damageKindLabel(weapon.kind).toLowerCase()}
                      </td>
                      <td className={cell}>{burdenLabel(weapon.burden)}</td>
                      <td className={`${cell} text-muted-foreground`}>{featureOf(weapon)}</td>
                    </tr>
                  ))}
                />
              </div>
            );
          })}
        </section>
      ))}
      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New weapon"
        description="You can set its tier, trait, range, damage and feature after."
        submitLabel="Create weapon"
        label="Name"
        schema={gearNameSchema}
        maxLength={GEAR_NAME_MAX}
        onSave={async (name) => {
          const weapon = await create.mutateAsync({ name });
          void navigate(weaponPath(campaign.id, weapon.id));
        }}
      />
    </ListLayout>
  );
}

export function ArmorListPage() {
  return <WithCampaign>{(campaign) => <ArmorListView campaign={campaign} />}</WithCampaign>;
}

function ArmorListView({ campaign }: { campaign: Campaign }) {
  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  const { data: armor, isPending, isError } = useArmorList(campaign.id);
  const create = useCreateArmor(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <ListLayout
      campaign={campaign}
      title="Armor"
      description="By tier. Thresholds are major / severe; a sheet adds the PC's level to both."
      newLabel="New armor"
      onNew={
        canWrite
          ? () => {
              setCreating(true);
            }
          : null
      }
    >
      {isPending && <p className="text-muted-foreground">Loading armor…</p>}
      {isError && <p role="alert">Could not load the armor. Try again in a moment.</p>}
      {armor?.length === 0 && <p className="text-sm text-muted-foreground">No armor yet.</p>}
      {byTier(armor ?? []).map(([tier, inTier]) => (
        <section key={tier} aria-label={`Tier ${String(tier)}`} className="space-y-2">
          <h2 className="text-xl font-semibold">Tier {tier}</h2>
          <GearTable
            label={`Tier ${String(tier)} armor`}
            head={['Name', 'Thresholds', 'Score', 'Feature']}
            rows={inTier.map((piece: ArmorRecord) => (
              <tr key={piece.id}>
                <td className={cell}>
                  <Link
                    to={armorPath(campaign.id, piece.id)}
                    className="font-medium hover:underline"
                  >
                    {piece.name}
                  </Link>
                </td>
                <td className={cell}>
                  {piece.baseMajorThreshold} / {piece.baseSevereThreshold}
                </td>
                <td className={cell}>{piece.baseScore}</td>
                <td className={`${cell} text-muted-foreground`}>{featureOf(piece)}</td>
              </tr>
            ))}
          />
        </section>
      ))}
      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New armor"
        description="You can set its tier, thresholds, score and feature after."
        submitLabel="Create armor"
        label="Name"
        schema={gearNameSchema}
        maxLength={GEAR_NAME_MAX}
        onSave={async (name) => {
          const piece = await create.mutateAsync({ name });
          void navigate(armorPath(campaign.id, piece.id));
        }}
      />
    </ListLayout>
  );
}
