import {
  CLASS_NAME_MAX,
  classNameSchema,
  followsCreationSpread,
  HOPE_FEATURE_COST_MAX,
  rulesetFor,
  SHEET_NUMBER_MAX,
  SHORT_TEXT_MAX,
  signed,
  SUGGESTED_TRAIT_MAX,
  SUGGESTED_TRAIT_MIN,
  TEXT_FIELD_MAX,
  TRAITS_NOT_SPREAD,
  traitLabel,
  updateClassRequestSchema,
  type Campaign,
  type ClassRecord,
  type Ruleset,
  type SuggestedTraits,
  type UpdateClassRequest,
} from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldError } from '@/components/FieldError';
import { FeatureListField } from '@/components/gameplay/ClassForm';
import { ClassView } from '@/components/gameplay/ClassViews';
import { GearTitle } from '@/components/gameplay/GearForm';
import { NumberField } from '@/components/sheets/NumberField';
import { TextField } from '@/components/sheets/TextField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  useArmorList,
  useCampaign,
  useClass,
  useCreateSubclass,
  useDeleteClass,
  useDomains,
  usePatchClass,
  useWeapons,
} from '@/lib/queries';
import { gameplayPath, subclassPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/classes/:classId` (F4.5): one class and its subclasses. */
export function ClassPage() {
  const { campaignId = '', classId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const classQuery = useClass(campaignId, classId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  if (classQuery.isPending) return <p className="text-muted-foreground">Loading class…</p>;
  if (classQuery.isError) {
    return <p role="alert">Could not load this class. Try again in a moment.</p>;
  }
  const cls = classQuery.data;
  if (cls === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Class not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link to={gameplayPath(campaign.id)} className="underline">
          Back to gameplay
        </Link>
      </div>
    );
  }

  const ruleset = rulesetFor(campaign.rulesetVersion);
  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  return (
    <div className="space-y-4">
      <Link
        to={gameplayPath(campaign.id)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Gameplay
      </Link>
      {canWrite ? (
        <ClassForm key={cls.id} campaign={campaign} cls={cls} ruleset={ruleset} />
      ) : (
        <>
          <ClassView cls={cls} ruleset={ruleset} />
          <SubclassList campaign={campaign} cls={cls} ruleset={ruleset} />
        </>
      )}
    </div>
  );
}

/** The class's subclasses, each a link to its page. */
function SubclassList({
  campaign,
  cls,
  ruleset,
  onNew,
}: {
  campaign: Campaign;
  cls: ClassRecord;
  ruleset: Ruleset;
  onNew?: () => void;
}) {
  return (
    <section aria-label="Subclasses" className="mx-auto max-w-sm space-y-2">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Subclasses</h2>
        {onNew !== undefined && (
          <Button size="sm" onClick={onNew}>
            <PlusIcon aria-hidden />
            New subclass
          </Button>
        )}
      </div>
      {cls.subclasses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No subclasses yet. The creation guide offers a class once it has one.
        </p>
      ) : (
        <ul aria-label={`${cls.name} subclasses`} className="divide-y rounded-md border">
          {cls.subclasses.map((sub) => (
            <li key={sub.id}>
              <Link
                to={subclassPath(campaign.id, cls.id, sub.id)}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted"
              >
                <span className="font-medium">{sub.name}</span>
                <span className="text-sm text-muted-foreground">
                  {sub.spellcastTrait === null
                    ? 'No spellcasting'
                    : `Casts with ${traitLabel(ruleset, sub.spellcastTrait)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Key = keyof UpdateClassRequest;
const COSTS = Array.from({ length: HOPE_FEATURE_COST_MAX + 1 }, (_, index) => index);
const TRAIT_VALUES = Array.from(
  { length: SUGGESTED_TRAIT_MAX - SUGGESTED_TRAIT_MIN + 1 },
  (_, index) => SUGGESTED_TRAIT_MIN + index,
);

/** The GM's editor for a class, autosaving key by key. */
function ClassForm({
  campaign,
  cls,
  ruleset,
}: {
  campaign: Campaign;
  cls: ClassRecord;
  ruleset: Ruleset;
}) {
  const { mutateAsync: sendPatch } = usePatchClass(campaign.id, cls.id);
  const del = useDeleteClass(campaign.id);
  const createSubclass = useCreateSubclass(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateClassRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const domains = useDomains(campaign.id).data ?? [];
  const weapons = useWeapons(campaign.id).data ?? [];
  const armor = useArmorList(campaign.id).data ?? [];

  const [domainIds, setDomainIds] = useState<[string | null, string | null]>([
    cls.domains[0]?.id ?? null,
    cls.domains[1]?.id ?? null,
  ]);
  const [hope, setHope] = useState(cls.hopeFeature);
  const [traits, setTraits] = useState<SuggestedTraits>(cls.suggestedTraits);
  const [primary, setPrimary] = useState(cls.suggestedPrimaryWeapon?.id ?? null);
  const [secondary, setSecondary] = useState(cls.suggestedSecondaryWeapon?.id ?? null);
  const [armorId, setArmorId] = useState(cls.suggestedArmor?.id ?? null);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  function commit(patch: UpdateClassRequest, now = false) {
    const keys = Object.keys(patch) as Key[];
    const parsed = updateClassRequestSchema.safeParse(patch);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      setErrors((current) => ({
        ...current,
        ...Object.fromEntries(keys.map((k) => [k, message])),
      }));
      return;
    }
    setErrors((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((k) => [k, undefined])),
    }));
    autosave.save(parsed.data);
    if (now) autosave.flush();
  }

  const twoHanded = weapons.find((weapon) => weapon.id === primary)?.burden === 'two_handed';
  /** Tier 1 gear of the slot, plus the current pick even if it no longer fits. */
  const choices = <T extends { id: string; name: string; tier: number }>(
    list: readonly T[],
    fits: (item: T) => boolean,
    current: string | null,
  ) => list.filter((item) => (item.tier === 1 && fits(item)) || item.id === current);

  const domainSelect = (index: 0 | 1, label: string) => {
    const other = domainIds[index === 0 ? 1 : 0];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`class-domain-${String(index + 1)}`}>{label}</Label>
        <NativeSelect
          id={`class-domain-${String(index + 1)}`}
          value={domainIds[index] ?? ''}
          onChange={(event) => {
            const next: [string | null, string | null] = [...domainIds];
            next[index] = event.target.value === '' ? null : event.target.value;
            setDomainIds(next);
            commit({ domainIds: next }, true);
          }}
        >
          <option value="">None</option>
          {domains
            .filter((domain) => domain.id !== other)
            .map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
        </NativeSelect>
      </div>
    );
  };

  const spreadWarning =
    Object.keys(traits).length > 0 && !followsCreationSpread(traits, ruleset)
      ? TRAITS_NOT_SPREAD
      : null;

  return (
    <div className="space-y-6">
      <GearTitle
        what="Class"
        initial={cls.name}
        error={errors.name ?? null}
        autosave={autosave}
        onChange={(name) => {
          commit({ name });
        }}
        onDelete={() => {
          setDeleting(true);
        }}
      />

      <TextField
        id="class-description"
        label="Description"
        initial={cls.description}
        maxLength={TEXT_FIELD_MAX}
        multiline
        disabled={false}
        error={errors.description ?? null}
        onCommit={(description) => {
          commit({ description });
        }}
        onBlur={autosave.flush}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {domainSelect(0, 'First domain')}
        {domainSelect(1, 'Second domain')}
        <NumberField
          id="class-evasion"
          label="Starting evasion"
          initial={cls.startingEvasion}
          min={0}
          max={SHEET_NUMBER_MAX}
          disabled={false}
          error={errors.startingEvasion ?? null}
          onCommit={(value) => {
            if (value === null) {
              setErrors((current) => ({ ...current, startingEvasion: 'Enter a whole number' }));
            } else commit({ startingEvasion: value });
          }}
          onBlur={autosave.flush}
        />
        <NumberField
          id="class-hp"
          label="Starting HP"
          initial={cls.startingHp}
          min={0}
          max={SHEET_NUMBER_MAX}
          disabled={false}
          error={errors.startingHp ?? null}
          onCommit={(value) => {
            if (value === null) {
              setErrors((current) => ({ ...current, startingHp: 'Enter a whole number' }));
            } else commit({ startingHp: value });
          }}
          onBlur={autosave.flush}
        />
      </div>
      <FieldError message={errors.domainIds ?? null} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Hope feature</legend>
        <p className="text-sm text-muted-foreground">The class&apos;s own way to spend Hope.</p>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="hope-name">Hope feature name</Label>
            <Input
              id="hope-name"
              value={hope.name}
              maxLength={SHORT_TEXT_MAX}
              placeholder="Make a Scene"
              onChange={(event) => {
                const next = { ...hope, name: event.target.value };
                setHope(next);
                commit({ hopeFeature: next });
              }}
              onBlur={autosave.flush}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hope-cost">Hope cost</Label>
            <NativeSelect
              id="hope-cost"
              value={String(hope.cost)}
              onChange={(event) => {
                const next = { ...hope, cost: Number(event.target.value) };
                setHope(next);
                commit({ hopeFeature: next }, true);
              }}
            >
              {COSTS.map((cost) => (
                <option key={cost} value={cost}>
                  {cost} Hope
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hope-text">What it does</Label>
          <Textarea
            id="hope-text"
            rows={3}
            value={hope.text}
            maxLength={TEXT_FIELD_MAX}
            onChange={(event) => {
              const next = { ...hope, text: event.target.value };
              setHope(next);
              commit({ hopeFeature: next });
            }}
            onBlur={autosave.flush}
          />
        </div>
        <FieldError message={errors.hopeFeature ?? null} />
      </fieldset>

      <FeatureListField
        id="class-features"
        title="Class features"
        description="What every character of this class can do, shown on the class card."
        itemLabel="Class feature"
        initial={cls.classFeatures}
        error={errors.classFeatures ?? null}
        onChange={(rows, now) => {
          commit({ classFeatures: rows }, now);
        }}
        onBlur={autosave.flush}
      />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Suggested traits</legend>
        <p className="text-sm text-muted-foreground">
          The creation guide fills these in to start: one +2, two +1, two 0 and one −1.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {ruleset.traits.map((trait) => (
            <div key={trait.id} className="space-y-1.5">
              <Label htmlFor={`suggested-${trait.id}`}>{trait.label}</Label>
              <NativeSelect
                id={`suggested-${trait.id}`}
                value={String(traits[trait.id] ?? 0)}
                onChange={(event) => {
                  const next = Object.fromEntries(
                    ruleset.traits.map((each) => [each.id, traits[each.id] ?? 0]),
                  );
                  next[trait.id] = Number(event.target.value);
                  setTraits(next);
                  commit({ suggestedTraits: next }, true);
                }}
              >
                {TRAIT_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {signed(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
        {spreadWarning !== null && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            {spreadWarning}.
          </p>
        )}
        <FieldError message={errors.suggestedTraits ?? null} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Suggested gear</legend>
        <p className="text-sm text-muted-foreground">
          Tier 1 gear the creation guide picks to start with.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="suggested-primary">Primary weapon</Label>
            <NativeSelect
              id="suggested-primary"
              value={primary ?? ''}
              onChange={(event) => {
                const next = event.target.value === '' ? null : event.target.value;
                setPrimary(next);
                const picked = weapons.find((weapon) => weapon.id === next);
                if (picked?.burden === 'two_handed' && secondary !== null) {
                  // A two-handed weapon leaves no hand for the secondary: clear it too.
                  setSecondary(null);
                  commit(
                    { suggestedPrimaryWeaponId: next, suggestedSecondaryWeaponId: null },
                    true,
                  );
                } else commit({ suggestedPrimaryWeaponId: next }, true);
              }}
            >
              <option value="">None</option>
              {choices(weapons, (weapon) => weapon.slot === 'primary', primary).map((weapon) => (
                <option key={weapon.id} value={weapon.id}>
                  {weapon.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suggested-secondary">Secondary weapon</Label>
            <NativeSelect
              id="suggested-secondary"
              value={secondary ?? ''}
              disabled={twoHanded}
              onChange={(event) => {
                const next = event.target.value === '' ? null : event.target.value;
                setSecondary(next);
                commit({ suggestedSecondaryWeaponId: next }, true);
              }}
            >
              <option value="">None</option>
              {choices(weapons, (weapon) => weapon.slot === 'secondary', secondary).map(
                (weapon) => (
                  <option key={weapon.id} value={weapon.id}>
                    {weapon.name}
                  </option>
                ),
              )}
            </NativeSelect>
            {twoHanded && (
              <p className="text-xs text-muted-foreground">The primary weapon is two-handed.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suggested-armor">Armor</Label>
            <NativeSelect
              id="suggested-armor"
              value={armorId ?? ''}
              onChange={(event) => {
                const next = event.target.value === '' ? null : event.target.value;
                setArmorId(next);
                commit({ suggestedArmorId: next }, true);
              }}
            >
              <option value="">None</option>
              {choices(armor, () => true, armorId).map((piece) => (
                <option key={piece.id} value={piece.id}>
                  {piece.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {cls.suggestionWarnings.length > 0 && (
          <ul role="status" className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
            {cls.suggestionWarnings.map((warning) => (
              <li key={warning}>{warning}.</li>
            ))}
          </ul>
        )}
      </fieldset>

      <SubclassList
        campaign={campaign}
        cls={cls}
        ruleset={ruleset}
        onNew={() => {
          setCreating(true);
        }}
      />

      <CampaignNameDialog
        open={creating}
        onOpenChange={setCreating}
        title={`New ${cls.name} subclass`}
        description="You can set its spellcast trait and features after."
        submitLabel="Create subclass"
        label="Name"
        schema={classNameSchema}
        maxLength={CLASS_NAME_MAX}
        onSave={async (name) => {
          const sub = await createSubclass.mutateAsync({ classId: cls.id, name });
          void navigate(subclassPath(campaign.id, cls.id, sub.id));
        }}
      />

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${cls.name}?`}
          description={deleteDescription(cls.subclassCount)}
          confirmLabel="Delete class"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(cls.id);
            void navigate(gameplayPath(campaign.id), { replace: true });
          }}
        />
      )}
    </div>
  );
}

function deleteDescription(subclasses: number): string {
  if (subclasses === 0) return "This can't be undone.";
  const which = subclasses === 1 ? 'its subclass' : `its ${String(subclasses)} subclasses`;
  return `This deletes ${which} too, and can't be undone.`;
}
