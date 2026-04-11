/* ═══════════════════════════════════════════════════════════
   Chrono Empires — Hardcoded Card Data
   360 Category Cards (4 categories × 3 cards × 30 boards)
   + Transportation Cards (3 tiers)
   ═══════════════════════════════════════════════════════════ */

export type CardCategory = 'geography' | 'food' | 'entertainment' | 'history';
export type CardTier = 'low' | 'mid' | 'high';

export interface CategoryCard {
  id: string;          // e.g. "b100_geo_1"
  boardId: number;     // 100, 200, ... 3000
  classLevel: number;  // 1–30
  category: CardCategory;
  name: string;
  emoji: string;
}

export interface TransportCard {
  id: string;
  tier: CardTier;
  name: string;
  emoji: string;
  unlockBoard: number; // 0 = default, 1000, 2000
}

/* ── Board list (30 boards) ────────────────────────────── */
export const BOARDS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
  1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000,
  2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000,
] as const;

export function boardToClass(boardId: number): number {
  const idx = BOARDS.indexOf(boardId as any);
  return idx >= 0 ? idx + 1 : 1;
}

export function classToBoard(classLevel: number): number {
  const c = Math.max(1, Math.min(30, Math.round(classLevel)));
  return BOARDS[c - 1];
}

export function gemsToClass(gems: number): number {
  return Math.min(30, Math.max(1, Math.floor(gems / 100) + 1));
}

/* ── Helper to build a card id ─────────────────────────── */
function cid(board: number, cat: string, n: number): string {
  return `b${board}_${cat}_${n}`;
}

/* ── 360 Category Cards ────────────────────────────────── */
type RawBoard = {
  board: number;
  geo: [string, string, string];
  food: [string, string, string];
  ent: [string, string, string];
  hist: [string, string, string];
};

const RAW: RawBoard[] = [
  // 🌿 Boards 100–1000: The Roots & The Streets
  {
    board: 100,
    geo: ['Mit Ghamr', 'El Ayat', 'Dishna'],
    food: ['Eish Baladi', 'Eish Shamsi', 'Eish Bataw'],
    ent: ['Tahtib (Stick Dance)', 'Bambouty', 'Tannoura'],
    hist: ['Ra', 'Anubis', 'Horus'],
  },
  {
    board: 200,
    geo: ['Tanta', 'Mansoura', 'Zagazig'],
    food: ['Qamh (Wheat)', 'Dora (Corn)', 'Ruz (Rice)'],
    ent: ['Oud', 'Rababa', 'Ney'],
    hist: ['Thebes', 'Memphis', 'Abydos'],
  },
  {
    board: 300,
    geo: ['Edfu', 'Kom Ombo', 'Esna'],
    food: ['Shai Koshary', 'Sahlab', 'Yansoon'],
    ent: ['Radio Soap Operas', 'Morning Poetry Readings', "Children's Story Hour"],
    hist: ['The Sphinx', 'The Griffin', 'Bennu Bird'],
  },
  {
    board: 400,
    geo: ['Sayeda Zeinab', 'El Gamaleya', 'El Darb El Ahmar'],
    food: ['Foul Medames', 'Taameya', 'Termes'],
    ent: ['Al qird fi ayn ommo ghazal', 'Elli yekhaf mel efrit yetlaalo', 'El sabr moftah el farag'],
    hist: ['Rosetta Stone', 'Golden Mask of Tutankhamun', 'Narmer Palette'],
  },
  {
    board: 500,
    geo: ['Khan El Khalili', 'Souq El Gomaa', 'Wekalet El Balah'],
    food: ['Torshy', 'Limoon Meaasfar', 'Basal Mekhalel'],
    ent: ['Madrast El Moshaghbeen', 'El Eyal Kebret', 'Kedah Ok'],
    hist: ['Copper Beating', 'Pottery Making', 'Carpet Weaving'],
  },
  {
    board: 600,
    geo: ['Tahrir Square', 'Ramses Square', 'Opera Square'],
    food: ['Kawareh', 'Fatta', 'Mombar'],
    ent: ['Bab El Hadid', 'Doaa Al Karawan', 'Seraa Fil Wadi'],
    hist: ['Great Pyramid of Giza', 'Karnak Temple', 'Abu Simbel'],
  },
  {
    board: 700,
    geo: ['Bahary', 'Mahatet El Raml', 'Anfoushi'],
    food: ['Waraq Enab', 'Kromb', 'Betingan'],
    ent: ['Zahma Ya Donia Zahma', 'El Enab', 'Kalam El Nas'],
    hist: ['Spilling coffee is good luck', 'Blue bead wards off evil eye', 'Flipping upside-down slipper'],
  },
  {
    board: 800,
    geo: ['Miami Beach', 'Maamoura Beach', 'Agami'],
    food: ['Gebna Rumi', 'Gebna Areesh', 'Mesh'],
    ent: ['Melodrama', 'Farce Comedy', 'Musical Romances'],
    hist: ['Al-Azhar University', 'El Kuttab', 'Madrasa of Sultan Hassan'],
  },
  {
    board: 900,
    geo: ['Misr Station (Cairo)', 'Sidi Gaber Station', 'Mahatet El Raml Station'],
    food: ['Meshabek', 'Ghazl El Banat', 'Halawa Tahiniya'],
    ent: ['Bakkar', 'Bogy w Tamtam', 'Super Henedy'],
    hist: ['Salah El-Din Citadel', 'Sultan Hassan Mosque', 'Ibn Tulun Mosque'],
  },
  {
    board: 1000,
    geo: ['Kafr El Sheikh', 'Beheira', 'Fayoum'],
    food: ['Freska', 'Bake Rolz', 'Mandolin'],
    ent: ['Al-Ahram', 'Al-Akhbar', 'Al-Gomhuria'],
    hist: ['The Hanging Church', "Saint Catherine's Monastery", 'The Cave Church'],
  },

  // 📻 Boards 1100–2000: The Mainstream Middle
  {
    board: 1100,
    geo: ['Gezira Sporting Club', 'Smouha Sporting Club', 'Tersana Sporting Club'],
    food: ['Spiro Spathis', 'V7', 'Big Cola'],
    ent: ['Nour El Ein', 'Awel Mara', 'Lola El Malama'],
    hist: ['Old Kingdom', 'Ptolemaic Dynasty', 'Mamluk Sultanate'],
  },
  {
    board: 1200,
    geo: ['Cairo University', 'Ain Shams University', 'Alexandria University'],
    food: ["Mo'men", 'Cook Door', 'Gad'],
    ent: ['Lan Aeesh Fi Gilab Aby', 'Layali El Helmeya', 'Raafat El Haggan'],
    hist: ['6th of October Day', 'Revolution Day', 'Sham El Nessim'],
  },
  {
    board: 1300,
    geo: ['Hurghada', 'Safaga', 'Marsa Alam'],
    food: ['Sayadeya Rice', 'Feseekh', 'Fried Bolti'],
    ent: ['Al Ahly', 'Zamalek', 'Ismaily'],
    hist: ['Battle of Kadesh', 'Battle of Ain Jalut', 'Crossing of the Suez Canal'],
  },
  {
    board: 1400,
    geo: ['6th of October Bridge', 'Qasr El Nil Bridge', 'Stanley Bridge'],
    food: ['Kahk', 'Ghorayeba', 'Petit Four'],
    ent: ['Cairo International Stadium', 'Borg El Arab Stadium', 'Petrosport Stadium'],
    hist: ['Millim', 'Qirsh', 'Riyal'],
  },
  {
    board: 1500,
    geo: ['Abbas El Akkad', 'Talaat Harb', 'Kasr El Nil Street'],
    food: ['Awees', 'Fass', 'Zebdya'],
    ent: ['Man Sayarbah Al-Million', 'Al-Abakera', 'Benk El Haz'],
    hist: ['Galabeya', 'Tarboush', 'Melaya Lef'],
  },
  {
    board: 1600,
    geo: ['Sadat', 'Al Shohadaa', 'Attaba'],
    food: ['Koshary El Tahrir', 'Sayed Hanafy', 'Abou Tarek'],
    ent: ['Majed Magazine', 'Mickey Magazine', 'Hawaa'],
    hist: ['Egyptian Museum', 'NMEC', 'Grand Egyptian Museum'],
  },
  {
    board: 1700,
    geo: ['City Stars', 'Genena Mall', 'San Stefano'],
    food: ['Sobia', 'Karkadeh', 'Qamar El Din'],
    ent: ['Channel 1 (Al Oula)', 'Channel 2', 'Nile TV'],
    hist: ['The Ankh', 'The Eye of Horus', 'The Scarab Beetle'],
  },
  {
    board: 1800,
    geo: ['Ras Mohammed', 'Wadi El Hitan', 'Elba National Park'],
    food: ['Asab (Sugarcane)', 'Kharoub', 'Tamr Hindi'],
    ent: ['Mafish Fayda', 'Ya Halawa!', 'Khali El Silaah Sahi'],
    hist: ["Ruq'ah", 'Naskh', 'Thuluth'],
  },
  {
    board: 1900,
    geo: ['Porto Sokhna', 'Stella Di Mare', 'Azha'],
    food: ['Kamoun (Cumin)', 'Kosbara (Coriander)', 'Shata (Chili)'],
    ent: ['Late Night Interviews', 'Morning News Reviews', 'Call-in Debates'],
    hist: ['Camp David Accords', 'Treaty of Kadesh', 'Anglo-Egyptian Treaty'],
  },
  {
    board: 2000,
    geo: ['Dream Park', 'Aqua Park', 'Magic Land'],
    food: ['Mandarine Koueider', 'El Abd', 'Rigoletto'],
    ent: ['The Batates kid reaction', 'The Suez Canal Excavator', "The Ma'alesh meme"],
    hist: ['Fatimid Architecture', 'Mamluk Architecture', 'Khedivial Architecture'],
  },

  // 💎 Boards 2100–3000: The Elite & The Modern
  {
    board: 2100,
    geo: ['AUC', 'GUC', 'BUE'],
    food: ['Carrefour', 'Seoudi', 'Spinneys'],
    ent: ['Open Mic Nights', 'Comedy Club Showcases', 'Satirical News Shows'],
    hist: ['The Zaffa procession', 'Choreographed First Dances', 'Multi-tier cake cutting'],
  },
  {
    board: 2200,
    geo: ['El Tagamoa El Khames', 'Madinaty', 'El Rehab'],
    food: ['Salad Bars', 'Cold-pressed Juice Bars', 'Plant-based Cafes'],
    ent: ['Paranormal (Ma Waraa El Tabiaa)', 'Finding Ola', 'Bimbo'],
    hist: ['VeryNile', 'Red Sea Coral Protection', 'E-waste recycling drives'],
  },
  {
    board: 2300,
    geo: ['Cairo Festival City', 'Mall of Arabia', 'Mall of Egypt'],
    food: ['Patchi', 'Corona Premium', 'Nola Cupcakes'],
    ent: ['Dorak Gai', 'Keify Keda', 'El Bakht'],
    hist: ['National Council for Women', 'Baheya Foundation', 'Banati'],
  },
  {
    board: 2400,
    geo: ['Palm Hills', 'Mivida', 'Allegria'],
    food: ['Avocado Toast Cafes', 'Specialty Pancake Houses', 'Artisanal Bagel Shops'],
    ent: ['TikTok Egypt Trends', 'Instagram Reels', 'Facebook Neighborhood Groups'],
    hist: ['EgyptSat 1', 'Nilesat 101', 'TIBA-1'],
  },
  {
    board: 2500,
    geo: ['Cairo International Airport', 'Sphinx International Airport', 'Borg El Arab Airport'],
    food: ['V60 Pour Over', 'Flat White', 'Cortado'],
    ent: ['Microphone', 'Clash (Eshtebak)', 'Yomeddine'],
    hist: ['Contemporary Calligraffiti', 'Digital Surrealism', 'Neo-Pharaonism'],
  },
  {
    board: 2600,
    geo: ['Four Seasons Nile Plaza', 'Marriott Mena House', 'The St. Regis Cairo'],
    food: ['Omakase Sushi', 'Truffle Pasta', 'Caviar Bars'],
    ent: ['Sandbox Festival', "Chill O'posite", 'Nacelle House Sessions'],
    hist: ['FinTech Mobile Wallets', 'AI Traffic Systems', 'Smart Farming Sensors'],
  },
  {
    board: 2700,
    geo: ['Smart Village', 'The GrEEK Campus', 'Cairo Business Park'],
    food: ['Sourdough Loaves', 'Croissants with local twists', 'Cruffins'],
    ent: ['Metaverse Virtual Galleries', '3D Pharaonic NFTs', 'AR Social Filters'],
    hist: ['GERD Negotiations', 'Eastern Mediterranean Gas Forum', 'COP27 Agreements'],
  },
  {
    board: 2800,
    geo: ['Marassi Marina', 'El Gouna Abu Tig Marina', 'Swan Lake El Gouna'],
    food: ['Molecular Gastronomy', 'Deconstructed Traditional Dishes', "Chef's Tasting Menus"],
    ent: ['LoL MENA', 'PUBG Mobile Arab', 'Valorant Local Leagues'],
    hist: ['Okhtein', 'Kojak Studio', 'Temraza'],
  },
  {
    board: 2900,
    geo: ['The Iconic Tower', 'The Octagon', 'Green River Park'],
    food: ['Gourmet Egypt', 'Royal House', 'Fresh Food Market'],
    ent: ['Swvl', 'Fawry', 'Instabug'],
    hist: ['Grand Egyptian Museum facade', 'New Alamein Towers', 'New Capital Opera House'],
  },
  {
    board: 3000,
    geo: ['Hacienda White', 'Silversands', 'Almaza Bay'],
    food: ['Edible Smoke cocktails', 'Spherified Mango juice', 'Foam Koshary'],
    ent: ['El Gouna Film Festival', 'Cairo Intl Film Festival', 'D-CAF'],
    hist: ['Culturvator', 'Bibliotheca Alexandrina', 'Darb 1718'],
  },
];

const CAT_EMOJI: Record<CardCategory, string> = {
  geography: '🗺️',
  food: '🥙',
  entertainment: '🎭',
  history: '🏛️',
};

export const ALL_CATEGORY_CARDS: CategoryCard[] = RAW.flatMap((r) => {
  const cls = boardToClass(r.board);
  const cats: Array<{ key: CardCategory; items: string[] }> = [
    { key: 'geography', items: r.geo },
    { key: 'food', items: r.food },
    { key: 'entertainment', items: r.ent },
    { key: 'history', items: r.hist },
  ];
  return cats.flatMap(({ key, items }) =>
    items.map((name, i) => ({
      id: cid(r.board, key.slice(0, 3), i + 1),
      boardId: r.board,
      classLevel: cls,
      category: key,
      name,
      emoji: CAT_EMOJI[key],
    })),
  );
});

/* ── Transportation Cards ──────────────────────────────── */
export const ALL_TRANSPORT_CARDS: TransportCard[] = [
  // Low Class (default)
  { id: 'tr_microbus',   tier: 'low',  name: 'The Microbus',          emoji: '🚐', unlockBoard: 0 },
  { id: 'tr_toktok',     tier: 'low',  name: 'The Toktok',            emoji: '🛺', unlockBoard: 0 },
  { id: 'tr_felucca',    tier: 'low',  name: 'Felucca on the Nile',   emoji: '⛵', unlockBoard: 0 },
  { id: 'tr_hantour',    tier: 'low',  name: 'The Hantour',           emoji: '🐴', unlockBoard: 0 },
  { id: 'tr_mashy',      tier: 'low',  name: 'Mashy',                 emoji: '🚶', unlockBoard: 0 },
  // Mid Class (board 1000+)
  { id: 'tr_swvl',       tier: 'mid',  name: 'Swvl Premium Bus',      emoji: '🚌', unlockBoard: 1000 },
  { id: 'tr_metro',      tier: 'mid',  name: 'Cairo Metro',           emoji: '🚇', unlockBoard: 1000 },
  { id: 'tr_taxi',       tier: 'mid',  name: 'The White Taxi',        emoji: '🚕', unlockBoard: 1000 },
  { id: 'tr_careem',     tier: 'mid',  name: 'Careem Bike / Scooter', emoji: '🛵', unlockBoard: 1000 },
  // High Class (board 2000+)
  { id: 'tr_helicopter', tier: 'high', name: 'Private Helicopter',    emoji: '🚁', unlockBoard: 2000 },
  { id: 'tr_yacht',      tier: 'high', name: 'Private Yacht',         emoji: '🛥️', unlockBoard: 2000 },
  { id: 'tr_monorail',   tier: 'high', name: 'The Monorail / LRT',   emoji: '🚝', unlockBoard: 2000 },
  { id: 'tr_uberblack',  tier: 'high', name: 'Uber Black / Chauffeur', emoji: '🖤', unlockBoard: 2000 },
];

/* ── Upgrade level definitions (Clash Royale style) ──── */
export const CARD_UPGRADE_LEVELS = [
  { level: 1, label: '🥉 The Local Stand',      copiesNeeded: 1,  coinCost: 0,     rentMultiplier: 1,   sabotageDefense: 0,    borderColor: '#b87333' },
  { level: 2, label: '🥈 The Popular Exhibit',   copiesNeeded: 5,  coinCost: 1000,  rentMultiplier: 3,   sabotageDefense: 0,    borderColor: '#C0C0C0' },
  { level: 3, label: '🥇 The Premium Pavilion',  copiesNeeded: 20, coinCost: 10000, rentMultiplier: 10,  sabotageDefense: 0.5,  borderColor: '#FFD700' },
  { level: 4, label: '💎 The Iconic Landmark',   copiesNeeded: 50, coinCost: 50000, rentMultiplier: 100, sabotageDefense: 1.0,  borderColor: '#B9F2FF' },
] as const;

/* ── Rent calculation ──────────────────────────────────── */
export type ZoneName = 'history' | 'geography' | 'food' | 'entertainment';

const ZONE_MULTIPLIER: Record<ZoneName, number> = {
  history: 1.0,
  geography: 1.2,
  food: 1.5,
  entertainment: 2.0,
};

export function calcRent(classLevel: number, zone: ZoneName, cardLevel: number): number {
  const base = 500 * Math.max(1, classLevel);
  const zoneMul = ZONE_MULTIPLIER[zone] ?? 1;
  const lvl = CARD_UPGRADE_LEVELS.find((l) => l.level === cardLevel);
  const rentMul = lvl ? lvl.rentMultiplier : 1;
  return Math.round(base * zoneMul * rentMul);
}

/* ── Wheel segments ────────────────────────────────────── */
export interface WheelSegment {
  id: string;
  label: string;
  emoji: string;
  weight: number; // relative probability
}

export const WHEEL_SEGMENTS: WheelSegment[] = [
  { id: 'w_1k',      label: '1,000 Coins',     emoji: '🪙', weight: 25 },
  { id: 'w_5k',      label: '5,000 Coins',     emoji: '🪙', weight: 20 },
  { id: 'w_10k',     label: '10,000 Coins',    emoji: '💰', weight: 15 },
  { id: 'w_25k',     label: '25,000 Coins',    emoji: '💰', weight: 10 },
  { id: 'w_50k',     label: '50,000 Coins',    emoji: '💎', weight: 5 },
  { id: 'w_100k',    label: '100,000 Coins',   emoji: '👑', weight: 2 },
  { id: 'w_cat',     label: 'Category Card',   emoji: '🎴', weight: 10 },
  { id: 'w_trans',   label: 'Transport Card',  emoji: '🚂', weight: 5 },
  { id: 'w_defend',  label: 'Defend Card',     emoji: '🛡️', weight: 4 },
  { id: 'w_attack',  label: 'Attack Card',     emoji: '⚔️', weight: 4 },
];

export function spinWheel(rng = Math.random): WheelSegment {
  const total = WHEEL_SEGMENTS.reduce((s, w) => s + w.weight, 0);
  let r = rng() * total;
  for (const seg of WHEEL_SEGMENTS) {
    r -= seg.weight;
    if (r <= 0) return seg;
  }
  return WHEEL_SEGMENTS[0];
}
