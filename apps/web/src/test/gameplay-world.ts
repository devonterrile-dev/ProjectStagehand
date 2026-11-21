/**
 * The gameplay records part of the fake API: domains and domain cards (F4.3), weapons and armor
 * (F4.4), classes and subclasses (F4.5), species (F4.6), following the server's rules and
 * messages (`apps/server/src/campaigns/domains.ts`, `domain-cards.ts`, `gear.ts`, `classes.ts`,
 * `species.ts`).
 * Every campaign starts with the ten default domains unless a test seeds its own.
 */
import {
  createSpeciesRequestSchema,
  updateSpeciesRequestSchema,
  type SpeciesRecord,
  createClassRequestSchema,
  createSubclassRequestSchema,
  DEFAULT_STARTING_EVASION,
  DEFAULT_STARTING_HP,
  emptyHopeFeature,
  SAME_DOMAIN_TWICE,
  SUGGESTION_NOT_FIT,
  updateClassRequestSchema,
  updateSubclassRequestSchema,
  type ClassRecord,
  type ClassSummary,
  type FeatureRow,
  type HopeFeature,
  type SubclassRecord,
  type SuggestedTraits,
  createArmorRequestSchema,
  createDomainCardRequestSchema,
  createDomainRequestSchema,
  DEFAULT_DOMAINS,
  createWeaponRequestSchema,
  emptyRichText,
  noGearBonuses,
  SECONDARY_ONE_HANDED,
  updateArmorRequestSchema,
  updateDomainCardRequestSchema,
  updateDomainRequestSchema,
  updateWeaponRequestSchema,
  type ArmorRecord,
  type Campaign,
  type DomainCard,
  type DomainCardSummary,
  type DomainCardType,
  type RichText,
  type WeaponRecord,
} from '@stagehand/shared';

export interface DomainSeed {
  id: string;
  name: string;
  description?: string;
}

export interface DomainCardSeed {
  id: string;
  domainId: string;
  name: string;
  level?: number;
  recallCost?: number;
  type?: DomainCardType;
  feature?: RichText;
}

export interface GameplayWorldOptions {
  /** A campaign's domains, by campaign id, instead of the ten defaults. */
  domains?: Record<string, DomainSeed[]>;
  /** A campaign's domain cards, by campaign id. */
  domainCards?: Record<string, DomainCardSeed[]>;
  /** A campaign's weapons, by campaign id (F4.4). */
  weapons?: Record<string, (Partial<WeaponRecord> & { id: string; name: string })[]>;
  /** A campaign's armor, by campaign id (F4.4). */
  armor?: Record<string, (Partial<ArmorRecord> & { id: string; name: string })[]>;
  /** A campaign's classes, by campaign id (F4.5). */
  classes?: Record<string, (Partial<StoredClass> & { id: string; name: string })[]>;
  /** A campaign's species, by campaign id (F4.6). */
  species?: Record<
    string,
    { id: string; name: string; description?: string; features?: FeatureRow[] }[]
  >;
  /** A campaign's subclasses, by campaign id. */
  subclasses?: Record<
    string,
    (Partial<StoredSubclass> & { id: string; classId: string; name: string })[]
  >;
}

export interface StoredClass {
  id: string;
  name: string;
  description: string;
  domainIds: [string | null, string | null];
  startingEvasion: number;
  startingHp: number;
  hopeFeature: HopeFeature;
  classFeatures: FeatureRow[];
  suggestedTraits: SuggestedTraits;
  suggestedPrimaryWeaponId: string | null;
  suggestedSecondaryWeaponId: string | null;
  suggestedArmorId: string | null;
}

export interface StoredSubclass {
  id: string;
  classId: string;
  name: string;
  description: string;
  spellcastTrait: string | null;
  foundation: FeatureRow[];
  specialization: FeatureRow[];
  mastery: FeatureRow[];
}

interface Ctx {
  refused: (status: number, message: string) => Response;
  notFound: (message: string) => Response;
  invalid: (issues: { path: PropertyKey[]; message: string }[]) => Response;
}

interface StoredDomain {
  id: string;
  name: string;
  description: string;
}

interface StoredCard {
  id: string;
  domainId: string;
  name: string;
  level: number;
  recallCost: number;
  type: DomainCardType;
  feature: RichText;
}

const AT = '2026-11-20T12:00:00.000Z';

let nextId = 0;
const id = () => {
  nextId += 1;
  return `00000000-0000-4000-a400-${String(nextId).padStart(12, '0')}`;
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

export function gameplayWorld(options: GameplayWorldOptions, ctx: Ctx) {
  const domainStores = new Map<string, StoredDomain[]>();
  const cardStores = new Map<string, StoredCard[]>();

  const weaponStores = new Map<string, WeaponRecord[]>();
  const armorStores = new Map<string, ArmorRecord[]>();

  const newWeapon = (seed: Partial<WeaponRecord> & { name: string }): WeaponRecord => ({
    id: id(),
    tier: 1,
    slot: 'primary',
    kind: 'physical',
    trait: 'agility',
    range: 'melee',
    damageDie: 6,
    damageBonus: 0,
    burden: 'one_handed',
    featureName: '',
    featureText: '',
    bonuses: noGearBonuses(),
    createdAt: AT,
    updatedAt: AT,
    ...seed,
  });
  const newArmor = (seed: Partial<ArmorRecord> & { name: string }): ArmorRecord => ({
    id: id(),
    tier: 1,
    baseMajorThreshold: 0,
    baseSevereThreshold: 0,
    baseScore: 0,
    featureName: '',
    featureText: '',
    bonuses: noGearBonuses(),
    createdAt: AT,
    updatedAt: AT,
    ...seed,
  });

  const speciesStores = new Map<string, SpeciesRecord[]>();
  const newSpecies = (seed: {
    id?: string;
    name: string;
    description?: string;
    features?: FeatureRow[];
  }): SpeciesRecord => {
    const features = seed.features ?? [];
    return {
      id: seed.id ?? id(),
      name: seed.name,
      description: seed.description ?? '',
      features,
      featureCount: features.length,
      createdAt: AT,
      updatedAt: AT,
    };
  };
  const speciesOf = (campaignId: string): SpeciesRecord[] => {
    let list = speciesStores.get(campaignId);
    if (list === undefined) {
      list = (options.species?.[campaignId] ?? []).map(newSpecies);
      speciesStores.set(campaignId, list);
    }
    return list;
  };
  const classStores = new Map<string, StoredClass[]>();
  const subclassStores = new Map<string, StoredSubclass[]>();
  const newClass = (seed: Partial<StoredClass> & { name: string }): StoredClass => ({
    id: id(),
    description: '',
    domainIds: [null, null],
    startingEvasion: DEFAULT_STARTING_EVASION,
    startingHp: DEFAULT_STARTING_HP,
    hopeFeature: emptyHopeFeature(),
    classFeatures: [],
    suggestedTraits: {},
    suggestedPrimaryWeaponId: null,
    suggestedSecondaryWeaponId: null,
    suggestedArmorId: null,
    ...seed,
  });
  const newSubclass = (
    seed: Partial<StoredSubclass> & { classId: string; name: string },
  ): StoredSubclass => ({
    id: id(),
    description: '',
    spellcastTrait: null,
    foundation: [],
    specialization: [],
    mastery: [],
    ...seed,
  });
  const classesOf = (campaignId: string): StoredClass[] => {
    let list = classStores.get(campaignId);
    if (list === undefined) {
      list = (options.classes?.[campaignId] ?? []).map(newClass);
      classStores.set(campaignId, list);
    }
    return list;
  };
  const subclassesOf = (campaignId: string): StoredSubclass[] => {
    let list = subclassStores.get(campaignId);
    if (list === undefined) {
      list = (options.subclasses?.[campaignId] ?? []).map(newSubclass);
      subclassStores.set(campaignId, list);
    }
    return list;
  };
  const weaponsOf = (campaignId: string): WeaponRecord[] => {
    let list = weaponStores.get(campaignId);
    if (list === undefined) {
      list = (options.weapons?.[campaignId] ?? []).map(newWeapon);
      weaponStores.set(campaignId, list);
    }
    return list;
  };
  const armorOf = (campaignId: string): ArmorRecord[] => {
    let list = armorStores.get(campaignId);
    if (list === undefined) {
      list = (options.armor?.[campaignId] ?? []).map(newArmor);
      armorStores.set(campaignId, list);
    }
    return list;
  };
  const slotOrder = { primary: 0, secondary: 1 } as const;
  const sortedWeapons = (campaignId: string) =>
    [...weaponsOf(campaignId)].sort(
      (a, b) => a.tier - b.tier || slotOrder[a.slot] - slotOrder[b.slot] || byName(a, b),
    );
  const sortedArmor = (campaignId: string) =>
    [...armorOf(campaignId)].sort((a, b) => a.tier - b.tier || byName(a, b));

  const domainsOf = (campaignId: string): StoredDomain[] => {
    let domains = domainStores.get(campaignId);
    if (domains === undefined) {
      domains = (
        options.domains?.[campaignId] ?? DEFAULT_DOMAINS.map((domain) => ({ id: id(), ...domain }))
      ).map((seed) => ({ description: '', ...seed }));
      domainStores.set(campaignId, domains);
    }
    return domains;
  };
  const cardsOf = (campaignId: string): StoredCard[] => {
    let cards = cardStores.get(campaignId);
    if (cards === undefined) {
      cards = (options.domainCards?.[campaignId] ?? []).map((seed) => ({
        level: 1,
        recallCost: 0,
        type: 'ability' as const,
        feature: emptyRichText(),
        ...seed,
      }));
      cardStores.set(campaignId, cards);
    }
    return cards;
  };

  const summary = (campaignId: string, card: StoredCard): DomainCardSummary => ({
    id: card.id,
    name: card.name,
    domainId: card.domainId,
    domainName: domainsOf(campaignId).find((domain) => domain.id === card.domainId)?.name ?? '',
    level: card.level,
    recallCost: card.recallCost,
    type: card.type,
    updatedAt: AT,
  });
  const full = (campaignId: string, card: StoredCard): DomainCard => ({
    ...summary(campaignId, card),
    feature: card.feature,
    createdAt: AT,
  });
  const sortedCards = (campaignId: string, domainId?: string) =>
    cardsOf(campaignId)
      .filter((card) => domainId === undefined || card.domainId === domainId)
      .map((card) => summary(campaignId, card))
      .sort(
        (a, b) => a.domainName.localeCompare(b.domainName) || a.level - b.level || byName(a, b),
      );
  const domainView = (campaignId: string, domain: StoredDomain) => {
    const cards = sortedCards(campaignId, domain.id);
    return { ...domain, cardCount: cards.length, cards, createdAt: AT, updatedAt: AT };
  };

  const subclassSummary = (sub: StoredSubclass) => ({
    id: sub.id,
    classId: sub.classId,
    name: sub.name,
    spellcastTrait: sub.spellcastTrait,
    updatedAt: AT,
  });
  const subclassView = (campaignId: string, sub: StoredSubclass): SubclassRecord => ({
    ...subclassSummary(sub),
    className: classesOf(campaignId).find((cls) => cls.id === sub.classId)?.name ?? '',
    description: sub.description,
    foundation: sub.foundation,
    specialization: sub.specialization,
    mastery: sub.mastery,
    createdAt: AT,
  });
  const domainRef = (campaignId: string, domainId: string | null) => {
    const domain = domainsOf(campaignId).find((entry) => entry.id === domainId);
    return domain === undefined ? null : { id: domain.id, name: domain.name };
  };
  const classSummary = (campaignId: string, cls: StoredClass): ClassSummary => ({
    id: cls.id,
    name: cls.name,
    domains: [domainRef(campaignId, cls.domainIds[0]), domainRef(campaignId, cls.domainIds[1])],
    startingEvasion: cls.startingEvasion,
    startingHp: cls.startingHp,
    subclassCount: subclassesOf(campaignId).filter((sub) => sub.classId === cls.id).length,
    updatedAt: AT,
  });
  const classView = (campaignId: string, cls: StoredClass): ClassRecord => {
    const weapon = (weaponId: string | null) =>
      weaponsOf(campaignId).find((entry) => entry.id === weaponId) ?? null;
    const primary = weapon(cls.suggestedPrimaryWeaponId);
    const secondary = weapon(cls.suggestedSecondaryWeaponId);
    const piece = armorOf(campaignId).find((entry) => entry.id === cls.suggestedArmorId) ?? null;
    const warnings: string[] = [];
    if (primary !== null && (primary.tier !== 1 || primary.slot !== 'primary')) {
      warnings.push(`${primary.name} is no longer a tier 1 primary weapon`);
    }
    if (secondary !== null && (secondary.tier !== 1 || secondary.slot !== 'secondary')) {
      warnings.push(`${secondary.name} is no longer a tier 1 secondary weapon`);
    }
    if (piece !== null && piece.tier !== 1)
      warnings.push(`${piece.name} is no longer tier 1 armor`);
    if (primary !== null && secondary !== null && primary.burden === 'two_handed') {
      warnings.push(`${primary.name} is two-handed, which leaves no hand for ${secondary.name}`);
    }
    const ref = (gear: { id: string; name: string } | null) =>
      gear === null ? null : { id: gear.id, name: gear.name };
    return {
      ...classSummary(campaignId, cls),
      description: cls.description,
      hopeFeature: cls.hopeFeature,
      classFeatures: cls.classFeatures,
      suggestedTraits: cls.suggestedTraits,
      suggestedPrimaryWeapon: ref(primary),
      suggestedSecondaryWeapon: ref(secondary),
      suggestedArmor: ref(piece),
      suggestionWarnings: warnings,
      subclasses: subclassesOf(campaignId)
        .filter((sub) => sub.classId === cls.id)
        .sort(byName)
        .map(subclassSummary),
      createdAt: AT,
    };
  };
  const nameTaken = (campaignId: string, name: string, except?: string) =>
    domainsOf(campaignId).some(
      (domain) => domain.id !== except && domain.name.toLowerCase() === name.toLowerCase(),
    );

  /** A new campaign: the defaults, or a copy of another campaign's records (19.14). */
  function created(campaignId: string, from?: string) {
    if (from === undefined) return;
    const newIdOf = new Map<string, string>();
    domainStores.set(
      campaignId,
      domainsOf(from).map((domain) => {
        const copy = { ...domain, id: id() };
        newIdOf.set(domain.id, copy.id);
        return copy;
      }),
    );
    cardStores.set(
      campaignId,
      cardsOf(from).map((card) => ({
        ...card,
        id: id(),
        domainId: newIdOf.get(card.domainId) ?? card.domainId,
      })),
    );
    weaponStores.set(
      campaignId,
      weaponsOf(from).map((weapon) => ({ ...weapon, id: id() })),
    );
    const newGearOf = new Map<string, string>();
    weaponStores.set(
      campaignId,
      weaponsOf(from).map((weapon) => {
        const copy = { ...weapon, id: id() };
        newGearOf.set(weapon.id, copy.id);
        return copy;
      }),
    );
    armorStores.set(
      campaignId,
      armorOf(from).map((piece) => {
        const copy = { ...piece, id: id() };
        newGearOf.set(piece.id, copy.id);
        return copy;
      }),
    );
    const mapped = (map: Map<string, string>, old: string | null) =>
      old === null ? null : (map.get(old) ?? null);
    const newClassOf = new Map<string, string>();
    classStores.set(
      campaignId,
      classesOf(from).map((cls) => {
        const copy: StoredClass = {
          ...cls,
          id: id(),
          domainIds: [mapped(newIdOf, cls.domainIds[0]), mapped(newIdOf, cls.domainIds[1])],
          suggestedPrimaryWeaponId: mapped(newGearOf, cls.suggestedPrimaryWeaponId),
          suggestedSecondaryWeaponId: mapped(newGearOf, cls.suggestedSecondaryWeaponId),
          suggestedArmorId: mapped(newGearOf, cls.suggestedArmorId),
        };
        newClassOf.set(cls.id, copy.id);
        return copy;
      }),
    );
    speciesStores.set(
      campaignId,
      speciesOf(from).map((one) => ({ ...one, id: id() })),
    );
    subclassStores.set(
      campaignId,
      subclassesOf(from).map((sub) => ({
        ...sub,
        id: id(),
        classId: newClassOf.get(sub.classId) ?? sub.classId,
      })),
    );
  }

  /** Species (F4.6); null for any other request. */
  function respondSpecies(
    campaignId: string,
    path: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    const taken = (name: string, except?: string) =>
      speciesOf(campaignId).some(
        (one) => one.id !== except && one.name.toLowerCase() === name.toLowerCase(),
      );
    if (path === '/species') {
      if (method === 'GET') {
        const species = [...speciesOf(campaignId)].sort(byName).map((one) => ({
          id: one.id,
          name: one.name,
          description: one.description,
          featureCount: one.features.length,
          updatedAt: AT,
        }));
        return Response.json({ species });
      }
      if (method === 'POST') {
        const parsed = createSpeciesRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (taken(parsed.data.name)) {
          return ctx.refused(409, 'A species with that name already exists');
        }
        const one = newSpecies(parsed.data);
        speciesOf(campaignId).push(one);
        return Response.json(one, { status: 201 });
      }
      return null;
    }
    const match = /^\/species\/([^/]+)$/.exec(path);
    const one = speciesOf(campaignId).find((entry) => entry.id === match?.[1]);
    if (one === undefined) return ctx.notFound('Species not found');
    if (method === 'GET') return Response.json(one);
    if (method === 'PATCH') {
      const parsed = updateSpeciesRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.invalid(parsed.error.issues);
      if (parsed.data.name !== undefined && taken(parsed.data.name, one.id)) {
        return ctx.refused(409, 'A species with that name already exists');
      }
      Object.assign(one, parsed.data);
      one.featureCount = one.features.length;
      return Response.json(one);
    }
    if (method === 'DELETE') {
      speciesStores.set(
        campaignId,
        speciesOf(campaignId).filter((entry) => entry.id !== one.id),
      );
      return new Response(null, { status: 204 });
    }
    return null;
  }

  /** Clears the class suggestions of gear about to be deleted (F4.5). */
  function clearSuggestions(campaignId: string, gearId: string) {
    for (const cls of classesOf(campaignId)) {
      if (cls.suggestedPrimaryWeaponId === gearId) cls.suggestedPrimaryWeaponId = null;
      if (cls.suggestedSecondaryWeaponId === gearId) cls.suggestedSecondaryWeaponId = null;
      if (cls.suggestedArmorId === gearId) cls.suggestedArmorId = null;
    }
  }

  /** Classes and subclasses (F4.5); null for any other request. */
  function respondClasses(
    campaignId: string,
    path: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    const classMatch = /^\/classes\/([^/]+)$/.exec(path);
    const subclassMatch = /^\/subclasses\/([^/]+)$/.exec(path);
    const classTaken = (name: string, except?: string) =>
      classesOf(campaignId).some(
        (cls) => cls.id !== except && cls.name.toLowerCase() === name.toLowerCase(),
      );
    if (path === '/classes') {
      if (method === 'GET') {
        const classes = [...classesOf(campaignId)]
          .sort(byName)
          .map((cls) => classSummary(campaignId, cls));
        return Response.json({ classes });
      }
      if (method === 'POST') {
        const parsed = createClassRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (classTaken(parsed.data.name)) {
          return ctx.refused(409, 'A class with that name already exists');
        }
        const cls = newClass(parsed.data);
        classesOf(campaignId).push(cls);
        return Response.json(classView(campaignId, cls), { status: 201 });
      }
      return null;
    }
    if (classMatch) {
      const cls = classesOf(campaignId).find((entry) => entry.id === classMatch[1]);
      if (cls === undefined) return ctx.notFound('Class not found');
      if (method === 'GET') return Response.json(classView(campaignId, cls));
      if (method === 'PATCH') {
        const parsed = updateClassRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        const { domainIds, ...rest } = parsed.data;
        if (rest.name !== undefined && classTaken(rest.name, cls.id)) {
          return ctx.refused(409, 'A class with that name already exists');
        }
        if (domainIds !== undefined) {
          for (const domainId of domainIds) {
            if (domainId !== null && domainRef(campaignId, domainId) === null) {
              return ctx.notFound('Domain not found');
            }
          }
          if (domainIds[0] !== null && domainIds[0] === domainIds[1]) {
            return ctx.refused(400, SAME_DOMAIN_TWICE);
          }
        }
        const weapon = (weaponId: string | null | undefined) =>
          weaponsOf(campaignId).find((entry) => entry.id === weaponId);
        if (rest.suggestedPrimaryWeaponId) {
          const primary = weapon(rest.suggestedPrimaryWeaponId);
          if (primary === undefined) return ctx.notFound('Weapon not found');
          if (primary.tier !== 1 || primary.slot !== 'primary') {
            return ctx.refused(400, SUGGESTION_NOT_FIT.primary);
          }
        }
        if (rest.suggestedSecondaryWeaponId) {
          const secondary = weapon(rest.suggestedSecondaryWeaponId);
          if (secondary === undefined) return ctx.notFound('Weapon not found');
          if (secondary.tier !== 1 || secondary.slot !== 'secondary') {
            return ctx.refused(400, SUGGESTION_NOT_FIT.secondary);
          }
        }
        if (rest.suggestedArmorId) {
          const piece = armorOf(campaignId).find((entry) => entry.id === rest.suggestedArmorId);
          if (piece === undefined) return ctx.notFound('Armor not found');
          if (piece.tier !== 1) return ctx.refused(400, SUGGESTION_NOT_FIT.armor);
        }
        if (
          rest.suggestedPrimaryWeaponId !== undefined ||
          rest.suggestedSecondaryWeaponId !== undefined
        ) {
          const primary = weapon(rest.suggestedPrimaryWeaponId ?? cls.suggestedPrimaryWeaponId);
          const secondaryId =
            rest.suggestedSecondaryWeaponId === undefined
              ? cls.suggestedSecondaryWeaponId
              : rest.suggestedSecondaryWeaponId;
          if (primary?.burden === 'two_handed' && secondaryId !== null) {
            return ctx.refused(400, SUGGESTION_NOT_FIT.twoHanded);
          }
        }
        Object.assign(cls, rest, domainIds === undefined ? {} : { domainIds });
        return Response.json(classView(campaignId, cls));
      }
      if (method === 'DELETE') {
        classStores.set(
          campaignId,
          classesOf(campaignId).filter((entry) => entry.id !== cls.id),
        );
        subclassStores.set(
          campaignId,
          subclassesOf(campaignId).filter((sub) => sub.classId !== cls.id),
        );
        return new Response(null, { status: 204 });
      }
      return null;
    }
    if (path === '/subclasses') {
      if (method === 'POST') {
        const parsed = createSubclassRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (!classesOf(campaignId).some((cls) => cls.id === parsed.data.classId)) {
          return ctx.notFound('Class not found');
        }
        const sub = newSubclass(parsed.data);
        subclassesOf(campaignId).push(sub);
        return Response.json(subclassView(campaignId, sub), { status: 201 });
      }
      return null;
    }
    if (subclassMatch) {
      const sub = subclassesOf(campaignId).find((entry) => entry.id === subclassMatch[1]);
      if (sub === undefined) return ctx.notFound('Subclass not found');
      if (method === 'GET') return Response.json(subclassView(campaignId, sub));
      if (method === 'PATCH') {
        const parsed = updateSubclassRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        Object.assign(sub, parsed.data);
        return Response.json(subclassView(campaignId, sub));
      }
      if (method === 'DELETE') {
        subclassStores.set(
          campaignId,
          subclassesOf(campaignId).filter((entry) => entry.id !== sub.id),
        );
        return new Response(null, { status: 204 });
      }
      return null;
    }
    return null;
  }

  /** Weapons and armor (F4.4); null for any other request. */
  function respondGear(
    campaignId: string,
    path: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    const weaponMatch = /^\/weapons\/([^/]+)$/.exec(path);
    const armorMatch = /^\/armor\/([^/]+)$/.exec(path);
    if (path === '/weapons') {
      if (method === 'GET') return Response.json({ weapons: sortedWeapons(campaignId) });
      if (method === 'POST') {
        const parsed = createWeaponRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (parsed.data.slot === 'secondary' && parsed.data.burden === 'two_handed') {
          return ctx.refused(400, SECONDARY_ONE_HANDED);
        }
        const weapon = newWeapon(parsed.data);
        weaponsOf(campaignId).push(weapon);
        return Response.json(weapon, { status: 201 });
      }
      return null;
    }
    if (weaponMatch) {
      const weapon = weaponsOf(campaignId).find((entry) => entry.id === weaponMatch[1]);
      if (weapon === undefined) return ctx.notFound('Weapon not found');
      if (method === 'GET') return Response.json(weapon);
      if (method === 'PATCH') {
        const parsed = updateWeaponRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        const slot = parsed.data.slot ?? weapon.slot;
        const burden =
          parsed.data.burden ?? (parsed.data.slot === 'secondary' ? 'one_handed' : weapon.burden);
        if (slot === 'secondary' && burden === 'two_handed') {
          return ctx.refused(400, SECONDARY_ONE_HANDED);
        }
        Object.assign(weapon, parsed.data, { burden });
        return Response.json(weapon);
      }
      if (method === 'DELETE') {
        clearSuggestions(campaignId, weapon.id);
        weaponStores.set(
          campaignId,
          weaponsOf(campaignId).filter((entry) => entry.id !== weapon.id),
        );
        return new Response(null, { status: 204 });
      }
      return null;
    }
    if (path === '/armor') {
      if (method === 'GET') return Response.json({ armor: sortedArmor(campaignId) });
      if (method === 'POST') {
        const parsed = createArmorRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        const piece = newArmor(parsed.data);
        armorOf(campaignId).push(piece);
        return Response.json(piece, { status: 201 });
      }
      return null;
    }
    if (armorMatch) {
      const piece = armorOf(campaignId).find((entry) => entry.id === armorMatch[1]);
      if (piece === undefined) return ctx.notFound('Armor not found');
      if (method === 'GET') return Response.json(piece);
      if (method === 'PATCH') {
        const parsed = updateArmorRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        Object.assign(piece, parsed.data);
        return Response.json(piece);
      }
      if (method === 'DELETE') {
        clearSuggestions(campaignId, piece.id);
        armorStores.set(
          campaignId,
          armorOf(campaignId).filter((entry) => entry.id !== piece.id),
        );
        return new Response(null, { status: 204 });
      }
      return null;
    }
    return null;
  }

  function respond(
    found: Campaign,
    rest: string,
    method: string,
    rawBody: unknown,
  ): Response | null {
    const [path = '', search = ''] = rest.split('?');
    const domainMatch = /^\/domains\/([^/]+)$/.exec(path);
    const cardMatch = /^\/domain-cards\/([^/]+)$/.exec(path);
    const gear = /^\/(weapons|armor)(\/[^/]+)?$/.test(path);
    const classes = /^\/(classes|subclasses)(\/[^/]+)?$/.test(path);
    const speciesPath = /^\/species(\/[^/]+)?$/.test(path);
    if (
      path !== '/domains' &&
      path !== '/domain-cards' &&
      !domainMatch &&
      !cardMatch &&
      !gear &&
      !classes &&
      !speciesPath
    ) {
      return null;
    }
    const campaignId = found.id;
    if (method !== 'GET') {
      if (found.role !== 'gm') return ctx.refused(403, 'Only the GM can do that');
      if (found.archivedAt !== null) return ctx.refused(409, 'Campaign is archived');
    }
    if (gear) return respondGear(campaignId, path, method, rawBody);
    if (classes) return respondClasses(campaignId, path, method, rawBody);
    if (speciesPath) return respondSpecies(campaignId, path, method, rawBody);

    if (path === '/domains') {
      if (method === 'GET') {
        const domains = [...domainsOf(campaignId)].sort(byName).map((domain) => ({
          id: domain.id,
          name: domain.name,
          description: domain.description,
          cardCount: sortedCards(campaignId, domain.id).length,
          updatedAt: AT,
        }));
        return Response.json({ domains });
      }
      if (method === 'POST') {
        const parsed = createDomainRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (nameTaken(campaignId, parsed.data.name)) {
          return ctx.refused(409, 'A domain with that name already exists');
        }
        const domain = { id: id(), description: '', ...parsed.data };
        domainsOf(campaignId).push(domain);
        return Response.json(domainView(campaignId, domain), { status: 201 });
      }
      return null;
    }

    if (domainMatch) {
      const domain = domainsOf(campaignId).find((entry) => entry.id === domainMatch[1]);
      if (domain === undefined) return ctx.notFound('Domain not found');
      if (method === 'GET') return Response.json(domainView(campaignId, domain));
      if (method === 'PATCH') {
        const parsed = updateDomainRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (parsed.data.name !== undefined && nameTaken(campaignId, parsed.data.name, domain.id)) {
          return ctx.refused(409, 'A domain with that name already exists');
        }
        Object.assign(domain, parsed.data);
        return Response.json(domainView(campaignId, domain));
      }
      if (method === 'DELETE') {
        const users = classesOf(campaignId)
          .filter((cls) => cls.domainIds.includes(domain.id))
          .sort(byName);
        const used = [...users, ...sortedCards(campaignId, domain.id)];
        if (used.length > 0) {
          const names = used.map((entry) => entry.name);
          return ctx.refused(409, `Used by ${names.join(', ')}. Change or delete them first.`);
        }
        domainStores.set(
          campaignId,
          domainsOf(campaignId).filter((entry) => entry.id !== domain.id),
        );
        return new Response(null, { status: 204 });
      }
      return null;
    }

    if (path === '/domain-cards') {
      if (method === 'GET') {
        const domainId = new URLSearchParams(search).get('domainId') ?? undefined;
        return Response.json({ cards: sortedCards(campaignId, domainId) });
      }
      if (method === 'POST') {
        const parsed = createDomainCardRequestSchema.safeParse(rawBody);
        if (!parsed.success) return ctx.invalid(parsed.error.issues);
        if (!domainsOf(campaignId).some((domain) => domain.id === parsed.data.domainId)) {
          return ctx.notFound('Domain not found');
        }
        const card: StoredCard = {
          id: id(),
          level: 1,
          recallCost: 0,
          type: 'ability',
          feature: emptyRichText(),
          ...parsed.data,
        };
        cardsOf(campaignId).push(card);
        return Response.json(full(campaignId, card), { status: 201 });
      }
      return null;
    }

    const card = cardsOf(campaignId).find((entry) => entry.id === cardMatch?.[1]);
    if (card === undefined) return ctx.notFound('Domain card not found');
    if (method === 'GET') return Response.json(full(campaignId, card));
    if (method === 'PATCH') {
      const parsed = updateDomainCardRequestSchema.safeParse(rawBody);
      if (!parsed.success) return ctx.invalid(parsed.error.issues);
      if (
        parsed.data.domainId !== undefined &&
        !domainsOf(campaignId).some((domain) => domain.id === parsed.data.domainId)
      ) {
        return ctx.notFound('Domain not found');
      }
      Object.assign(card, parsed.data);
      return Response.json(full(campaignId, card));
    }
    if (method === 'DELETE') {
      cardStores.set(
        campaignId,
        cardsOf(campaignId).filter((entry) => entry.id !== card.id),
      );
      return new Response(null, { status: 204 });
    }
    return null;
  }

  return { respond, created };
}
