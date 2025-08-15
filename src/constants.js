// 全局常量与配置
export const GAME_WORLD_WIDTH = 5000;
export const GAME_WORLD_HEIGHT = 3000;
export const WORLD_ASPECT_RATIO = GAME_WORLD_WIDTH / GAME_WORLD_HEIGHT;

export const NUM_SHIPS = 500;
export const MAX_FORCE = 0.05;
export const PERCEPTION_RADIUS = 100;
export const SEPARATION_RADIUS = 20;
export const ATTACK_RADIUS = 15;
export const COLLISION_DAMAGE = 1;
export const SHIP_SIZE = 6;
export const RESPAWN_TIME = 30;
export const MISSILE_ENGAGEMENT_RADIUS = 100;

export const SEPARATION_WEIGHT = 6.0;
export const ALIGNMENT_WEIGHT = 3.0;
export const COHESION_WEIGHT = 3.0;
export const ATTACK_WEIGHT = 1.5;
export const FLEE_WEIGHT = 1.0;

// 武器常量（更新）
export const WEAPON_PULSE_LASER = 'pulse_laser';
export const WEAPON_CONTINUOUS_LASER = 'continuous_laser';
export const WEAPON_RAPID_ENERGY = 'rapid_energy';
export const WEAPON_PDEF = 'point_defense';
export const WEAPON_COIL = 'coilgun';
export const WEAPON_MISSILE = 'missile';

// 导弹战斗部类型
export const WARHEAD_KINETIC = 'kinetic';
export const WARHEAD_AP = 'ap';
export const WARHEAD_HE = 'he';
export const WARHEAD_NUCLEAR = 'nuclear';

// 武器属性表
export const weaponProps = {
    [WEAPON_PULSE_LASER]: { damage: 2.0, cooldown: 30, range: 220, speed: null },
    [WEAPON_CONTINUOUS_LASER]: { damage: 0.45, cooldown: 1, range: 180, speed: null },
    [WEAPON_RAPID_ENERGY]: { damage: 0.9, cooldown: 6, range: 200, speed: 30 },
    [WEAPON_PDEF]: { damage: 0.6, cooldown: 4, range: 120, speed: 35 },
    [WEAPON_COIL]: { damage: 6.0, cooldown: 90, range: 350, speed: 50 },
    [WEAPON_MISSILE]: { damage: 4.0, cooldown: 180, range: 800, speed: 6 }
};

export const fleetColors = { 'fleet1': '#00bfff', 'fleet2': '#ff3300' };
export const particleColors = { 'fleet1': '#ffffff', 'fleet2': '#ffcc00' };

// 舰种
export const shipTypes = {
    'frigate': { label: '护卫舰 Frigate', maxHealth: 300, maxSpeed: 2.8, weaponSlots: 1 },
    'destroyer': { label: '驱逐舰 Destroyer', maxHealth: 500, maxSpeed: 2.2, weaponSlots: 2 },
    'cruiser': { label: '巡洋舰 Cruiser', maxHealth: 900, maxSpeed: 1.6, weaponSlots: 3 }
};
