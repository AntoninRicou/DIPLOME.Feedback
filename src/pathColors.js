export const COLORS = [
    { key: 'cyan',    hex: 0x88ccff },
    { key: 'orange',  hex: 0xff9a3c },
    { key: 'magenta', hex: 0xff6ad5 },
    { key: 'lime',    hex: 0xb8ff5c },
];

const byKey = new Map(COLORS.map(c => [c.key, c.hex]));

export function pickRandom() {
    return COLORS[Math.floor(Math.random() * COLORS.length)].hex;
}

export function pickFor(relationKey) {
    if (relationKey && byKey.has(relationKey)) return byKey.get(relationKey);
    return pickRandom();
}
