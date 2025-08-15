import { shipTypes, WARHEAD_KINETIC, WARHEAD_AP, WARHEAD_HE, WARHEAD_NUCLEAR } from './constants.js';

export function randomShipType() {
    const keys = Object.keys(shipTypes);
    return keys[Math.floor(Math.random() * keys.length)];
}

export function randomMissileWarhead() {
    const arr = [WARHEAD_KINETIC, WARHEAD_AP, WARHEAD_HE, WARHEAD_NUCLEAR];
    const r = Math.random();
    if (r < 0.45) return WARHEAD_KINETIC;
    if (r < 0.75) return WARHEAD_AP;
    if (r < 0.96) return WARHEAD_HE;
    return WARHEAD_NUCLEAR;
}
