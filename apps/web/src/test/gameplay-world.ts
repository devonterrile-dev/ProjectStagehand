/**
 * The gameplay records part of the fake API: domains and domain cards (F4.3), weapons and armor
 * (F4.4), following the server's rules and messages (`apps/server/src/campaigns/domains.ts`,
 * `domain-cards.ts`, `gear.ts`).
 * Every campaign starts with the ten default domains unless a test seeds its own.
 */
import {
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
    armorStores.set(
      campaignId,
      armorOf(from).map((piece) => ({ ...piece, id: id() })),
    );
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
    if (path !== '/domains' && path !== '/domain-cards' && !domainMatch && !cardMatch && !gear) {
      return null;
    }
    const campaignId = found.id;
    if (method !== 'GET') {
      if (found.role !== 'gm') return ctx.refused(403, 'Only the GM can do that');
      if (found.archivedAt !== null) return ctx.refused(409, 'Campaign is archived');
    }
    if (gear) return respondGear(campaignId, path, method, rawBody);

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
        const used = sortedCards(campaignId, domain.id);
        if (used.length > 0) {
          const names = used.map((card) => card.name);
          return ctx.refused(409, `Used by ${names.join(', ')}. Move or delete them first.`);
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
