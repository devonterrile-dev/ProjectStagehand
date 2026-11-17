import type { Emote } from '@stagehand/shared';
import {
  Angry,
  ArrowBigUp,
  Drama,
  Eye,
  Frown,
  Hand,
  RotateCw,
  Search,
  Snowflake,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react';

/** The picture beside each emote's name (F3.7), on the player's card and the GM's desk. */
export const EMOTE_ICONS: Record<Emote, LucideIcon> = {
  'look-around': Eye,
  hop: ArrowBigUp,
  nod: ThumbsUp,
  shake: Angry,
  shiver: Snowflake,
  'lean-in': Search,
  bow: Drama,
  spin: RotateCw,
  droop: Frown,
  wave: Hand,
};
