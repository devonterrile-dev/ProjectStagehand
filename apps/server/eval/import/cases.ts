/**
 * The AI import eval cases (F1.9b, D-32): 12 steps of made-up notes in different writing
 * styles, with what each must and must not produce. They are synthetic on purpose: the GM's
 * real notes stay in the git-ignored `local/` folder.
 *
 * Every step is also held to the checks every import must pass (see `grade.ts`): a valid
 * answer, no game mechanics outside GM notes unless the notes had them, no new record that
 * duplicates an existing one, and at most 8 questions.
 */
import type { EvalCase, EvalRecord } from './types';

/** A small mining town most of the single-step cases add to. */
const ASHFORD: EvalRecord[] = [
  {
    key: 'ashford',
    type: 'area',
    name: 'Ashford',
    publicDescription: 'A soot-stained mining town in the Greyback Hills.',
    fields: {
      kindOfPlace: 'Mining town',
      overview: 'Ashford lives and dies by the copper mine above it.',
    },
  },
  {
    key: 'anvil',
    type: 'spot',
    name: 'The Black Anvil',
    area: 'ashford',
    publicDescription: "Ashford's only smithy, always ringing.",
  },
  {
    key: 'inn',
    type: 'spot',
    name: 'The Lamplighter Inn',
    area: 'ashford',
    publicDescription: 'A warm, crowded inn by the town gate.',
  },
  {
    key: 'union',
    type: 'faction',
    name: "Miners' Union",
    publicDescription: "The miners' own guild, proud and stubborn.",
  },
  {
    key: 'company',
    type: 'faction',
    name: 'Copper Company',
    publicDescription: 'The company that owns the mine.',
    fields: { secrets: 'It is quietly buying up every claim in the hills.' },
  },
  {
    key: 'varn',
    type: 'npc',
    name: 'Captain Ilsa Varn',
    publicDescription: 'The stern captain of the Ashford watch.',
    gmNotes: 'Ambitious. Wants to be mayor.',
    fields: {
      appearance: 'Tall, close-cropped grey hair, a scar across her chin.',
      status: 'alive',
    },
  },
  {
    key: 'mara',
    type: 'npc',
    name: 'Mara Quill',
    publicDescription: 'The cheerful landlady of the Lamplighter Inn.',
    fields: { status: 'alive' },
    links: [{ field: 'homeSpot', to: 'inn' }],
  },
];

/** Things only the GM knows about the Lantern Marsh; none may reach a players' description. */
const MARSH_SECRETS = [/\blur(e|es|ed|ing)\b/i, /goes to the water/i, /real headquarters/i];

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'marsh',
    title: 'The Lantern Marsh: start a campaign, plan a session, fill in an item',
    style: 'A numbered campaign bible, then a session plan, then a fill-in request',
    steps: [
      {
        mode: 'bootstrap',
        notes: `THE LANTERN MARSH (campaign bible)

1. Premise
The Lantern Marsh is a fen of black water and reed islands, lit at night by thousands of floating lanterns. The marsh folk believe the lanterns are the souls of their ancestors keeping watch. In truth the lanterns are tended by the Order of the Wick, who use them to lure travellers into the deep channels and drown anyone who asks too many questions.

2. Places
- Reedholm: the largest village, built on stilts. Market day every fifth morning.
  - The Mooring Hall: where the elders meet. Smells of tar and eel smoke.
  - Widow Pell's Teahouse: the only place in Reedholm that serves anything stronger than reed tea.
- The Drowned Chapel: a half-sunk stone chapel in the eastern channels. The Order's real headquarters.

3. Factions
- The Order of the Wick: lantern tenders in grey oilskins. Publicly they are kindly guardians. Secretly they decide who "goes to the water".
- The Eel Guild: fishers and smugglers who know the channels better than anyone and quietly hate the Order.

4. People
- The Keeper: head of the Order, an old woman with milky eyes who never raises her voice. The fisherfolk call him Old Wick. He has led the Order for sixty years, which nobody finds strange.
- Brannoc Tull: master of the Eel Guild. Loud, generous, owes money to half of Reedholm.

5. A note for whoever writes this up
When you write new NPCs for this campaign, make every marsh local superstitious and give each of them a lantern-related nickname.`,
        answer:
          "The Keeper is a woman, so use she and her. Old Wick is only the fisherfolk's nickname for her, not a second person.",
        expect: {
          creates: [
            { type: 'faction', name: /order of the wick/i },
            { type: 'faction', name: /eel guild/i },
            { type: 'npc', name: /keeper|old wick/i },
            { type: 'npc', name: /brannoc/i },
            { type: 'spot', name: /mooring hall/i },
            { type: 'spot', name: /teahouse/i },
          ],
          atMost: [{ type: 'npc', name: /keeper|old wick/i, max: 1 }],
          onlyNamed: [{ type: 'npc', names: /keeper|old wick|brannoc|pell/i }],
          secrets: MARSH_SECRETS,
          questions: { min: 1, about: /keeper|old wick|\bhe\b|\bshe\b|\bher\b|\bhim\b|woman/i },
        },
      },
      {
        mode: 'add',
        notes: `Session 2 plan: the Festival of Floating Lights

Old Wick opens the festival at the Mooring Hall at dusk. Every family sets a lantern on the water.

Brannoc is going to try to smuggle a crate of Order lanterns out through the eastern channels during the festival. Inside the crate is the Glass Heart, a lantern that never goes out. Nobody knows what it does yet.

New face: Sefa, a ferry girl of about twelve, poles travellers between Reedholm and the Drowned Chapel. She is terrified of the Keeper.

If the party follows Brannoc's boat: Stealth DC 14 to stay unseen. On a failure, two Wick acolytes (use bandit stats, HP 11) attack.

Brannoc's debts have got worse: he now owes the Eel Guild itself.`,
        answer:
          'Old Wick is the Keeper. The crate is only context; the Glass Heart is the one item. The Eel Guild debt comes on top of the debts he already has.',
        expect: {
          creates: [
            { type: 'item', name: /glass heart/i },
            { type: 'npc', name: /sefa/i },
          ],
          atMost: [
            { type: 'npc', name: /keeper|old wick|brannoc/i, max: 0 },
            { type: 'faction', name: /order|eel guild/i, max: 0 },
          ],
          updates: [/brannoc/i],
          secrets: MARSH_SECRETS,
        },
      },
      {
        mode: 'fill',
        fillTarget: /glass heart/i,
        notes:
          'Give the Glass Heart a proper appearance: a lantern of cloudy green sea-glass whose flame is shaped like an open eye. Take some creative liberty and make it feel eerie. When the party first finds it, it is wrapped in wet sailcloth at the bottom of the crate.',
        answer: null,
        expect: {
          fills: [{ field: 'appearance', contains: /green|glass|eye/i }],
        },
      },
    ],
  },
  {
    id: 'terse-npc',
    title: 'A new NPC from terse bullet points',
    style: 'Terse bullets',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes: `- new npc: Hobb
- dwarf, ex-miner, one arm
- union rep now
- hates copper co.
- drinks at lamplighter`,
        answer: null,
        expect: {
          creates: [{ type: 'npc', name: /hobb/i }],
          atMost: [
            { type: 'faction', name: /union|copper/i, max: 0 },
            { type: 'spot', name: /lamplighter/i, max: 0 },
          ],
          onlyNamed: [{ type: 'npc', names: /hobb/i }],
        },
      },
    ],
  },
  {
    id: 'rambling-city',
    title: 'A new campaign from one long rambling paragraph',
    style: 'Run-on prose, no structure',
    steps: [
      {
        mode: 'bootstrap',
        notes:
          "ok so the whole thing starts in this coastal city called Saltreach, it's kind of a dump honestly but a pretty one, lots of white stone gone grey from the sea air, and the part the players will spend most of their time in is the Gutters which is the old harbour quarter, there's a fish market there (the Gull Market) that's always loud, and there's a bathhouse that's actually a front for a gambling den, I'm calling it the Copper Kettle, and up on the cliff above the city is the old lighthouse that hasn't been lit in twenty years since the keeper vanished and people say you can still see someone moving around up there at night. also there's a gang that runs the Gutters, the Salt Rats, and their boss is a half-orc named Grisel who used to be a priest",
        answer: null,
        expect: {
          creates: [
            { type: 'area', name: /saltreach|gutters/i },
            { type: 'spot', name: /gull market/i },
            { type: 'spot', name: /copper kettle/i },
            { type: 'spot', name: /lighthouse/i },
            { type: 'faction', name: /salt rats/i },
            { type: 'npc', name: /grisel/i },
          ],
          secrets: [/gambling/i, /\bfront\b/i],
        },
      },
    ],
  },
  {
    id: 'contradiction',
    title: 'Notes that contradict themselves about an existing NPC',
    style: 'Contradictory notes',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes: `Mara Quill is actually Captain Varn's younger sister. They fell out years ago over their father's will.
Mara is in her twenties.

Later note: Mara is the oldest person in Ashford, nearly ninety, and has never had any family.`,
        answer: null,
        expect: {
          atMost: [{ type: 'npc', name: /mara|varn/i, max: 0 }],
          questions: { min: 1, about: /mara|sister|age|old|family|ninety|twenties/i },
        },
      },
    ],
  },
  {
    id: 'session-recap',
    title: 'A session recap that changes existing records',
    style: 'Session recap',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes: `Session 7 recap (played 2026-10-30)

The party finally confronted Mara Quill about the missing ore shipments. She panicked and ran into the old mine, where a tunnel collapsed on her. She's dead.
Captain Varn took the credit for "solving" the case, and the Miners' Union is furious about it.
Loose ends: who was Mara selling the ore to? The party found a Copper Company seal in her room at the Lamplighter Inn.
Next time: the union calls a strike.`,
        answer: null,
        expect: {
          creates: [{ type: 'session_notes' }],
          atMost: [
            { type: 'npc', name: /mara|varn/i, max: 0 },
            { type: 'faction', name: /union|copper/i, max: 0 },
          ],
          updates: [/mara quill/i],
          updateValues: [{ record: /mara quill/i, field: 'status', value: /^dead$/ }],
        },
      },
    ],
  },
  {
    id: 'stat-block',
    title: 'A monster written up with its stat block',
    style: 'Notes with game statistics inline',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes: `New monster for the mine: the Ashford Bog Troll, which lives in the flooded lower tunnels.

Bog Troll: Large giant, AC 15, HP 84 (8d10+40), Speed 30 ft.
STR 18 DEX 13 CON 20 INT 7 WIS 9 CHA 7
Bite +7 to hit, 2d10+4 piercing. Regenerates 10 HP a turn unless burned.

It isn't evil, just hungry, and it hoards shiny ore. The miners leave it offerings so it leaves them alone.`,
        answer: null,
        expect: {
          creates: [{ name: /troll/i, type: 'npc' }],
          atMost: [{ type: 'faction', name: /union|miners/i, max: 0 }],
        },
      },
    ],
  },
  {
    id: 'one-liner',
    title: 'A one-line request',
    style: 'One line',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes: 'Add a blacksmith named Tovin who works at the Black Anvil.',
        answer: 'Tovin is a young human apprentice who took over the forge last winter.',
        expect: {
          creates: [{ type: 'npc', name: /tovin/i }],
          atMost: [{ type: 'spot', name: /anvil/i, max: 0 }],
          onlyNamed: [{ type: 'npc', names: /tovin/i }],
          questions: { max: 3 },
        },
      },
    ],
  },
  {
    id: 'nickname',
    title: 'An existing NPC named only by surname and title',
    style: 'Short gossip, no full names',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes:
          "Varn's been seen meeting someone from the Copper Company at night behind the Lamplighter. The captain is clearly taking bribes, and she's started carrying a new silver-hilted sword nobody can explain.",
        answer: "Yes, she's taking bribes from the Copper Company. The sword was a gift from them.",
        expect: {
          atMost: [
            { type: 'npc', name: /varn|captain/i, max: 0 },
            { type: 'faction', name: /copper/i, max: 0 },
          ],
          updates: [/ilsa varn/i],
          secrets: [/brib/i],
        },
      },
    ],
  },
  {
    id: 'make-it-up',
    title: 'A request to make up a place and a person',
    style: 'Asks Claude to invent',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        notes:
          'The party needs somewhere to stay on the road out of Ashford. Make up a roadside inn for them: come up with a name, a short read-aloud description, and an innkeeper with a name and a look. Keep it cozy.',
        answer: null,
        expect: {
          creates: [
            { type: 'spot', notName: /^(the )?(roadside )?inn$/i, fields: ['readAloud'] },
            {
              type: 'npc',
              notName: /^(the )?(roadside )?innkeeper$/i,
              fields: ['appearance'],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'type-filter',
    title: 'Notes about a person and a place, limited to NPCs',
    style: 'Short prose with a type filter',
    campaign: ASHFORD,
    steps: [
      {
        mode: 'add',
        targetTypes: ['npc'],
        notes:
          "There's a hermit called Old Juniper living in a shack at the edge of Ashford's slag heaps. The shack is full of jars of preserved mushrooms. She knows the mine's old tunnels better than anyone and is friendly with the union.",
        answer: null,
        expect: {
          creates: [{ type: 'npc', name: /juniper/i }],
        },
      },
    ],
  },
];
