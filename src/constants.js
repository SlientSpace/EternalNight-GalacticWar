// 全局常量与配置
export const GAME_WORLD_WIDTH = 5000;
export const GAME_WORLD_HEIGHT = GAME_WORLD_WIDTH * (window.innerHeight - 10) / (window.innerWidth - 10);
export const WORLD_ASPECT_RATIO = GAME_WORLD_WIDTH / GAME_WORLD_HEIGHT;

export const NUM_SHIPS = 40;
export const MAX_FORCE = 0.05;
export const MAX_PARTICLES = 1800;
export const MIN_ZOOM = 0.0001;
export const MAX_ZOOM = 8.0;



// 新增：最大角速度（弧度/帧），限制转向剧烈程度
export const MAX_ANGULAR_SPEED = 0.02;
export const PERCEPTION_RADIUS = 100;
export const SEPARATION_RADIUS = 20;
export const ATTACK_RADIUS = 15;
export const COLLISION_DAMAGE = 1;
export const SHIP_SIZE = 6;
export const RESPAWN_TIME = 300000000000000;
export const MISSILE_ENGAGEMENT_RADIUS = 200;

export const SEPARATION_WEIGHT = 5.0;
export const ALIGNMENT_WEIGHT = 3.0;
export const COHESION_WEIGHT = 3.0;
export const ATTACK_WEIGHT = 3.0;
export const FLEE_WEIGHT = 1.0;

export const NUM_WORKERS = navigator.hardwareConcurrency ? Math.max(2, navigator.hardwareConcurrency - 1) : 4;

// 武器常量（更新）
export const WEAPON_PULSE_LASER = 'pulse_laser';
export const WEAPON_CONTINUOUS_LASER = 'continuous_laser';
export const WEAPON_RAPID_ENERGY = 'rapid_energy';
export const WEAPON_PDEF = 'point_defense';
export const WEAPON_COIL = 'coilgun';
export const WEAPON_MISSILE = 'missile';
export const WEAPON_EMP = 'emp';
export const WEAPON_DRONE_BAY = 'drone_bay';

// 导弹战斗部类型
export const WARHEAD_KINETIC = 'kinetic';
export const WARHEAD_AP = 'ap';
export const WARHEAD_HE = 'he';
export const WARHEAD_NUCLEAR = 'nuclear';

// 战斗部爆炸半径
export const WARHEAD_EXPLOSION_RADIUS = {
    [WARHEAD_KINETIC]: 0,     // 动能弹无爆炸
    [WARHEAD_AP]: 0,          // 穿甲弹无爆炸
    [WARHEAD_HE]: 60,         // 高爆弹60半径
    [WARHEAD_NUCLEAR]: 200    // 核弹200半径
};

// 武器属性表
export const weaponProps = {
    [WEAPON_PULSE_LASER]: { damage: 2.0, cooldown: 30, range: 220, speed: null, energyCost: 15, heatGen: 8 },
    [WEAPON_CONTINUOUS_LASER]: { damage: 0.1, cooldown: 1, range: 180, speed: null, energyCost: 3, heatGen: 2 },
    [WEAPON_RAPID_ENERGY]: { damage: 0.9, cooldown: 6, range: 200, speed: 10, energyCost: 8, heatGen: 4 },
    [WEAPON_PDEF]: { damage: 0.6, cooldown: 4, range: 120, speed: 10, energyCost: 5, heatGen: 3 },
    [WEAPON_COIL]: { damage: 6.0, cooldown: 90, range: 350, speed: 15, energyCost: 25, heatGen: 12 },
    [WEAPON_MISSILE]: { damage: 4.0, cooldown: 180, range: 800, speed: 2, energyCost: 10, heatGen: 5 },
    [WEAPON_EMP]: { damage: 0, cooldown: 300, range: 300, speed: 7, energyCost: 30, heatGen: 20 },
    [WEAPON_DRONE_BAY]: { damage: 0, cooldown: 300, range: 800, speed: 0, energyCost: 50, heatGen: 0 }
};

// 新增：弹药系统常量
// 解释：游戏采用“弹药体积”作为统一度量，每次发射消耗不同的体积。每艘船有总弹药舱容积（ammoCapacity）。
export const AMMO_VOLUME_PER_SHOT = {
    // 激光类不消耗弹药体积
    [WEAPON_PULSE_LASER]: 0,
    [WEAPON_CONTINUOUS_LASER]: 0,
    // 非激光类武器按体积消耗
    [WEAPON_RAPID_ENERGY]: 1,
    [WEAPON_PDEF]: 0.5,
    [WEAPON_COIL]: 4,
    [WEAPON_MISSILE]: 8,
    [WEAPON_EMP]: 6,
    [WEAPON_DRONE_BAY]: 10
};

// 若需要，也可定义每武器的最大携弹量比例，用于GUI显示或AI策略（当前逻辑只用总容量）
export const DEFAULT_SHIP_AMMO_CAPACITY = {
    'frigate': 60,
    'destroyer': 120,
    'cruiser': 200,
    'battlecruiser': 280,
    'battleship': 360,
    'supply': 400,
    'repair': 80
};

export const fleetColors = { 'fleet1': '#00bfff', 'fleet2': '#ff3300' };
export const particleColors = { 'fleet1': '#ffffff', 'fleet2': '#ffcc00' };

// 系统管理常量
export const MAX_HEAT = 100;
export const HEAT_DISSIPATION_RATE = 1.5;
export const MAX_ENERGY = 100;
export const ENERGY_REGEN_RATE = 2.0;
export const MAX_DELTA_V = 1000;
export const DELTA_V_CONSUMPTION_RATE = 2;
export const OVERHEATING_DAMAGE = 2;
export const EMP_DURATION = 180;
export const EMP_RANGE = 40;
export const DRONE_ATTACK_MUTI = 1.2;

//后勤常量
export const LOGI_SEARCH_RANGE = 200;
export const LOGI_REPAIR_RATE = 1;
export const LOGI_SELF_ENERGY_COST = 1;
export const LOGI_SUPPLY_ENERGY = 1;
export const LOGI_SUPPLY_DV = 10;
export const LOGI_SUPPLY_COOL = 1;
export const LOGI_SUPPLY_AMMO = 5;

// 舰种
export const shipTypes = {
    'frigate': { label: '护卫舰 Frigate', maxHealth: 300, maxAcceleration: 0.06, weaponSlots: 1, maxEnergy: 80, maxHeat: 60, maxDeltaV: 800 },
    'destroyer': { label: '驱逐舰 Destroyer', maxHealth: 500, maxAcceleration: 0.06, weaponSlots: 2, maxEnergy: 120, maxHeat: 80, maxDeltaV: 1200 },
    'cruiser': { label: '巡洋舰 Cruiser', maxHealth: 900, maxAcceleration: 0.05, weaponSlots: 3, maxEnergy: 200, maxHeat: 120, maxDeltaV: 2000 },
    'battlecruiser': { label: '战巡舰 Battlecruiser', maxHealth: 1400, maxAcceleration: 0.04, weaponSlots: 4, maxEnergy: 300, maxHeat: 160, maxDeltaV: 2800 },
    'battleship': { label: '战列舰 Battleship', maxHealth: 2200, maxAcceleration: 0.03, weaponSlots: 5, maxEnergy: 400, maxHeat: 200, maxDeltaV: 3500 },
    'supply': { label: '补给舰 Supply Ship', maxHealth: 400, maxAcceleration: 0.05, weaponSlots: 0, maxEnergy: 150, maxHeat: 50, maxDeltaV: 1500, logisticsType: 'supply', logisticsRadius: 80 },
    'repair': { label: '维修舰 Repair Ship', maxHealth: 350, maxAcceleration: 0.05, weaponSlots: 0, maxEnergy: 140, maxHeat: 45, maxDeltaV: 1400, logisticsType: 'repair', logisticsRadius: 75 }
};
