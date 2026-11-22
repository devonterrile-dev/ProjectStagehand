import { DEFAULT_KIT_ITEMS, POTION_ITEMS, type Gold } from '@stagehand/shared';

/** "Torch, 50 feet of rope, …": what the Default mode hands out beside the picks (F4.8). */
export function defaultItemsLabel(): string {
  return [
    ...DEFAULT_KIT_ITEMS.map((item) => item.name),
    `${POTION_ITEMS.health.name} or ${POTION_ITEMS.stamina.name}`,
    'a handful of gold',
  ].join(', ');
}

/** "2 handfuls and 1 bag of gold"; empty when there is none. */
export function goldLabel(gold: Gold): string {
  const parts = [
    [gold.handfuls, 'handful', 'handfuls'],
    [gold.bags, 'bag', 'bags'],
    [gold.chests, 'chest', 'chests'],
  ] as const;
  const words = parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${String(count)} ${count === 1 ? one : many}`);
  if (words.length === 0) return '';
  const last = words.pop() ?? '';
  return `${words.length > 0 ? `${words.join(', ')} and ` : ''}${last} of gold`;
}
