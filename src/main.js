// 入口：把 UI、相机、事件、游戏循环整合在这里
import {
    GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT, WORLD_ASPECT_RATIO, EMP_RANGE,
    NUM_SHIPS, SHIP_SIZE, RESPAWN_TIME, fleetColors, particleColors,
    weaponProps, WEAPON_MISSILE, MISSILE_ENGAGEMENT_RADIUS, WARHEAD_EXPLOSION_RADIUS
} from './constants.js';
import { Vector } from './vector.js';
import { Particle, KineticProjectile, SeekingProjectile, EnergyProjectile, EMPProjectile, Drone } from './projectiles.js';
import { Ship } from './ship.js';
import { randomShipType, randomMissileWarhead } from './utils.js';
import { iconLoader } from './iconLoader.js'

const canvas = document.getElementById('beeCanvas');
const ctx = canvas.getContext('2d');

let ships = [];
const particles = [];
const projectiles = [];
let respawnCooldown1 = RESPAWN_TIME;
let respawnCooldown2 = RESPAWN_TIME;

const camera = { x: 0, y: 0, zoom: 1, trackedShip: null, manualControl: false };
window.camera = camera;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
let timeScale = 1;

function resizeCanvas() {
    const containerWidth = window.innerWidth - 32;
    const containerHeight = window.innerHeight - 150;

    let newWidth, newHeight;
    if (containerWidth / containerHeight > WORLD_ASPECT_RATIO) {
        newHeight = containerHeight;
        newWidth = newHeight * WORLD_ASPECT_RATIO;
    } else {
        newWidth = containerWidth;
        newHeight = newWidth / WORLD_ASPECT_RATIO;
    }

    canvas.width = Math.min(newWidth, 1200);
    canvas.height = Math.min(newHeight, 800);

    camera.zoom = Math.min(canvas.width / GAME_WORLD_WIDTH, canvas.height / GAME_WORLD_HEIGHT);
    camera.x = (GAME_WORLD_WIDTH - (canvas.width / camera.zoom)) / 2;
    camera.y = (GAME_WORLD_HEIGHT - (canvas.height / camera.zoom)) / 2;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// 交互
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener('mousedown', (e) => {
    if (camera.manualControl) return;
    isDragging = true;
    canvas.classList.add('grabbing');
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    camera.trackedShip = null;
    updateTrackingDisplay();
});
canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});
canvas.addEventListener('mouseup', () => { isDragging = false; canvas.classList.remove('grabbing'); });
canvas.addEventListener('mouseleave', () => { isDragging = false; canvas.classList.remove('grabbing'); });

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = camera.x + mouseX / camera.zoom;
    const worldY = camera.y + mouseY / camera.zoom;
    const scaleFactor = 1.05;
    let newZoom = e.deltaY < 0 ? camera.zoom * scaleFactor : camera.zoom / scaleFactor;
    newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));
    camera.zoom = newZoom;
    camera.x = worldX - mouseX / camera.zoom;
    camera.y = worldY - mouseY / camera.zoom;
});

canvas.addEventListener('dblclick', (e) => {
    if (camera.manualControl) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = camera.x + mouseX / camera.zoom;
    const worldY = camera.y + mouseY / camera.zoom;

    let found = null;
    for (const s of ships) {
        if (s.health <= 0) continue;
        const dx = Math.abs(s.position.x - worldX);
        const dy = Math.abs(s.position.y - worldY);
        const wrapDx = Math.min(dx, GAME_WORLD_WIDTH - dx);
        const wrapDy = Math.min(dy, GAME_WORLD_HEIGHT - dy);
        const dist = Math.sqrt(wrapDx * wrapDx + wrapDy * wrapDy);
        if (dist < (SHIP_SIZE * 3)) {
            found = s;
            break;
        }
    }

    camera.trackedShip = found || null;
    updateTrackingDisplay();
    updateShipInfoPanel();
});

canvas.addEventListener('click', (e) => {
    if (!camera.manualControl) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = camera.x + mouseX / camera.zoom;
    const worldY = camera.y + mouseY / camera.zoom;

    let found = null;
    for (const s of ships) {
        if (s.health <= 0) continue;
        const dx = Math.abs(s.position.x - worldX);
        const dy = Math.abs(s.position.y - worldY);
        const wrapDx = Math.min(dx, GAME_WORLD_WIDTH - dx);
        const wrapDy = Math.min(dy, GAME_WORLD_HEIGHT - dy);
        const dist = Math.sqrt(wrapDx * wrapDx + wrapDy * wrapDy);
        if (dist < (SHIP_SIZE * 3)) {
            found = s;
            break;
        }
    }

    if (found && camera.trackedShip && found.fleet !== camera.trackedShip.fleet) {
        camera.trackedShip.manualTarget = found;
        createExplosion(found.position.x, found.position.y, particleColors[found.fleet]);
        found._selectedAt = performance.now();
    }
    updateShipInfoPanel();
});

// 控制输入
const controlInputs = { up:false, down:false, left:false, right:false, fire:false };
window.addEventListener('keydown', (e) => {
    if (e.key === '[' || e.key === '【') timeScale = Math.max(0, timeScale - 0.1);
    else if (e.key === ']' || e.key === '】') timeScale = Math.min(5, timeScale + 0.1);
    else if (e.key === 'r' || e.key === 'R') timeScale = 1;
    else if (e.key === 't' || e.key === 'T') {
        if (camera.manualControl) return;
        let nextShipIndex = -1;
        if (camera.trackedShip) {
            const currentShipIndex = ships.findIndex(s => s === camera.trackedShip);
            for (let i = currentShipIndex + 1; i < ships.length; i++) {
                if (ships[i].health > 0) { nextShipIndex = i; break; }
            }
        }
        if (nextShipIndex === -1) {
            for (let i = 0; i < ships.length; i++) { if (ships[i].health > 0) { nextShipIndex = i; break; } }
        }
        camera.trackedShip = nextShipIndex !== -1 ? ships[nextShipIndex] : null;
    } else if (e.key === 'o' || e.key === 'O') {
        if (camera.trackedShip && camera.trackedShip.health > 0) {
            camera.manualControl = !camera.manualControl;
            if (camera.manualControl) {
                isDragging = false;
                canvas.classList.remove('grabbing');
            } else {
                if (camera.trackedShip) {
                    camera.trackedShip.manualTarget = null;
                    camera.trackedShip.state = 'patrol';
                }
            }
        }
    } else if (camera.manualControl && camera.trackedShip && camera.trackedShip.health > 0) {
    switch (e.key.toLowerCase()) {
        case 'f':
            // 火控限制解锁
            camera.trackedShip.fireControlOverride = !camera.trackedShip.fireControlOverride;
            updateManualDisplay();
            break;

        case 'm':
            // 自动反导弹
            camera.trackedShip.autoAntiMissile = !camera.trackedShip.autoAntiMissile;
            updateManualDisplay();
            break;

        case 'n':
            // 自动反无人机
            camera.trackedShip.autoAntiDrone = !camera.trackedShip.autoAntiDrone;
            updateManualDisplay();
            break;
        case 'b':
            // 自动反舰
            camera.trackedShip.autoAntiShip = !camera.trackedShip.autoAntiShip;
            updateManualDisplay();
            break;
    }
}

    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') controlInputs.up = true;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') controlInputs.down = true;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') controlInputs.left = true;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') controlInputs.right = true;
    if (e.key === ' ' ) controlInputs.fire = true;

    updateTrackingDisplay();
    updateManualDisplay();
    updateShipInfoPanel();
    updateTimeScaleDisplay();
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') controlInputs.up = false;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') controlInputs.down = false;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') controlInputs.left = false;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') controlInputs.right = false;
    if (e.key === ' ' ) controlInputs.fire = false;
});

function updateTrackingDisplay() {
    let el = document.getElementById('trackingDisplay');
    if (!el) {
        el = document.createElement('div'); el.id = 'trackingDisplay';
        el.style.position = 'absolute'; el.style.left = '20px'; el.style.top = '20px'; el.style.zIndex = 11;
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '14px';
        el.style.padding = '6px 10px';
        el.style.backgroundColor = 'rgba(0,0,0,0.7)';
        el.style.borderRadius = '4px';
        el.style.border = '1px solid rgba(255,255,255,0.2)';
        document.body.appendChild(el);
    }
    if (camera.trackedShip) {
        const s = camera.trackedShip;
        const pos = `位置: (${Math.round(s.position.x)}, ${Math.round(s.position.y)})`;
        const vel = `速度: ${s.velocity.mag().toFixed(1)}`;
        const healthPercent = ((s.health / s.maxHealth) * 100).toFixed(0);
        const energyPercent = ((s.energy / s.maxEnergy) * 100).toFixed(0);
        const heatPercent = ((s.heat / s.maxHeat) * 100).toFixed(0);
        const dvPercent = ((s.deltaV / s.maxDeltaV) * 100).toFixed(0);
        const empActive = (s.empedUntil && s.empedUntil > 0) ? `EMP:${Math.ceil(s.empedUntil)}帧` : 'EMP:无';
        const jam = s.jamming ? '干扰:是' : '干扰:否';
        const droneCount = s.drones ? s.drones.length : 0;
        const avgFuelPct = (s.drones && s.drones.length>0) ? Math.round(s.drones.reduce((acc,d)=>acc + (d.fuel||0),0) / (600 * s.drones.length) * 100) : 0;
        const readyMissileIdx = s.weapons.findIndex(w=>w===WEAPON_MISSILE);
        const warheadTxt = (readyMissileIdx!==-1 && s.weaponWarheads && s.weaponWarheads[readyMissileIdx]) ? s.weaponWarheads[readyMissileIdx] : '—';
        el.innerHTML = `
            <div style="color: ${fleetColors[s.fleet]}; font-weight: bold;">追踪: 舰队 ${s.fleet} ${s.typeLabel}</div>
            <div style="color: #ccc; font-size: 12px;">状态: ${s.state} | 生命值: ${healthPercent}%</div>
            <div style="color: #aaa; font-size: 11px;">${pos} | ${vel}</div>
            <div style="color:#9fe; font-size: 11px;">能量: ${energyPercent}% (${Math.round(s.energy)}/${s.maxEnergy}) | 热量: ${heatPercent}% (${Math.round(s.heat)}/${s.maxHeat}) | ΔV: ${dvPercent}% (${Math.round(s.deltaV)}/${s.maxDeltaV})</div>
            <div style="color:#c9f; font-size: 11px;">电子战: ${empActive} | ${jam} | 无人机: ${droneCount}/3${droneCount>0?` (平均燃料${avgFuelPct}%)`:''} | 战斗部: ${warheadTxt}</div>
        `;
    } else {
        el.innerHTML = `<div style="color: #e2e8f0;">未追踪</div>`;
    }
}
function updateManualDisplay() {
    let el = document.getElementById('manualDisplay');
    if (!el) {
        el = document.createElement('div'); el.id = 'manualDisplay';
        el.style.position = 'absolute'; el.style.left = '20px'; el.style.top = '90px'; el.style.zIndex = 11;
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '14px';
        el.style.padding = '6px 10px';
        el.style.backgroundColor = 'rgba(0,0,0,0.7)';
        el.style.borderRadius = '4px';
        el.style.border = '1px solid rgba(255,255,255,0.2)';
        document.body.appendChild(el);
    }
    if (camera.manualControl && camera.trackedShip) {
        const s = camera.trackedShip;
        const targetTxt = s.manualTarget && s.manualTarget.health > 0 ? `${s.manualTarget.typeLabel || '目标'} (${s.manualTarget.fleet})` : '无目标';
        const fcs = s.fireControlOverride ? '已解锁' : '限制中';
        const pdMissile = s.autoAntiMissile ? '开' : '关';
        const pdDrone = s.autoAntiDrone ? '开' : '关';
        const antiShip = s.autoAntiShip ? '开' : '关';

        let html = `
            <div style="color:#ffb000;font-weight:bold;">接管中</div>
            <div style="color:#bbb;font-size:12px;">目标: ${targetTxt}</div>
            <div style="color:#9fe;font-size:12px;">火控: ${fcs} (F) | 反舰: ${antiShip} (B)</div>
            <div style="color:#9fe;font-size:12px;">点防: 反导弹 ${pdMissile} (M) | 反无人机 ${pdDrone} (N)</div>
            <div id="weaponToggles" style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;"></div>
            <div style="color:#999;font-size:11px;">提示: WSAD 控制，空格开火，单击敌舰设为目标</div>`;
        
        el.innerHTML = html;

        // 渲染武器开关按钮
        const wt = document.getElementById('weaponToggles');
        wt.innerHTML = '';
        for (let i=0;i<s.weapons.length;i++){
            const name = s.weapons[i];
            const enabled = (s.weaponEnabled && s.weaponEnabled[i] !== false);
            const btn = document.createElement('button');
            btn.textContent = `${i+1}:${name}${s.weaponWarheads[i]?`[${s.weaponWarheads[i]}]`:''}`;
            btn.style.padding = '2px 6px';
            btn.style.fontSize = '12px';
            btn.style.borderRadius = '3px';
            btn.style.border = '1px solid rgba(255,255,255,0.2)';
            btn.style.background = enabled ? 'rgba(0, 160, 90, 0.6)' : 'rgba(90, 90, 90, 0.6)';
            btn.style.color = enabled ? '#eafff0' : '#ddd';
            btn.title = '点击切换此武器启用/禁用';
            btn.addEventListener('click', ()=>{
                if (!s.weaponEnabled) s.weaponEnabled = new Array(s.weapons.length).fill(true);
                s.weaponEnabled[i] = !s.weaponEnabled[i];
                updateManualDisplay();
            });
            wt.appendChild(btn);
        }
    } else {
        el.innerHTML = `<div style=\"color:#e2e8f0;\">未接管</div>`;
    }
}

const shipInfoPanel = document.getElementById('shipInfoPanel');
function updateShipInfoPanel() {
    const s = camera.trackedShip;
    if (!s || s.health <= 0) { shipInfoPanel.style.display = 'none'; shipInfoPanel.setAttribute('aria-hidden','true'); return; }
    shipInfoPanel.style.display = 'block'; shipInfoPanel.setAttribute('aria-hidden','false');

    document.getElementById('shipInfoTitle').textContent = `舰船信息 - ${s.typeLabel}`;
    document.getElementById('infoFleet').textContent = s.fleet;
    document.getElementById('infoType').textContent = `${s.typeLabel} (${s.typeKey})`;
    document.getElementById('infoState').textContent = s.state;
    document.getElementById('infoHealth').textContent = `${Math.max(0,Math.round(s.health))} / ${s.maxHealth}`;
    document.getElementById('infoSpeed').textContent = `${s.maxSpeed.toFixed(2)}`;

    const wl = document.getElementById('weaponsList');
    wl.innerHTML = '';
    for (let i=0;i<s.weapons.length;i++){
        const name = s.weapons[i];
        const props = weaponProps[name];
        const cooldown = s.shootCooldowns[i];
        const percent = props.cooldown ? Math.max(0, Math.min(100, (cooldown/props.cooldown)*100)) : 0;
        const warhead = s.weaponWarheads[i];
        const weaponLabel = warhead ? `${name} [${warhead}]` : name;
        const row = document.createElement('div');
        row.className = 'weapon-row';
        row.innerHTML = `<div class="weapon-name">${i+1}. ${weaponLabel} (${props.damage} dmg / ${props.range} r)</div>
            <div style="width:100px;display:flex;align-items:center;gap:6px;">
                <div class="cooldown-bar"><i style="width:${percent}%"></i></div>
                <div style="min-width:28px;text-align:right;font-size:12px">${Math.round(cooldown)}</div>
            </div>`;
        wl.appendChild(row);
    }
}

// 初始化舰艇
function initShips() {
    ships = [];
    for (let i = 0; i < NUM_SHIPS/2; i++) {
        const s = new Ship(Math.random()*(GAME_WORLD_WIDTH/2), Math.random()*GAME_WORLD_HEIGHT, 'fleet1', randomShipType());
        // 为导弹槽随机分配战斗部
        for (let j=0;j<s.weapons.length;j++){
            if (s.weapons[j] === WEAPON_MISSILE) s.weaponWarheads[j] = randomMissileWarhead();
        }
        ships.push(s);
    }
    for (let i = 0; i < NUM_SHIPS/2; i++) {
        const s = new Ship((GAME_WORLD_WIDTH/2) + Math.random()*(GAME_WORLD_WIDTH/2), Math.random()*GAME_WORLD_HEIGHT, 'fleet2', randomShipType());
        for (let j=0;j<s.weapons.length;j++){
            if (s.weapons[j] === WEAPON_MISSILE) s.weaponWarheads[j] = randomMissileWarhead();
        }
        ships.push(s);
    }
}
initShips();
// 暴露全局数组以供舰船自用逻辑访问（仅用于本地演示）
window.__allShips = window.__allShips || [];
window.__allProjectiles = window.__allProjectiles || [];
// 同步一次
window.__allShips = ships;
window.__allProjectiles = projectiles;

// 限制粒子总量，避免过度渲染
const MAX_PARTICLES = 1800;

function createExplosion(x,y,color,scale=1){
    // 根据规模确定基础数量，并限制总量
    const base = 10;
    const toSpawn = Math.min(MAX_PARTICLES - particles.length, Math.max(1, Math.floor(base * scale)));
    for (let i=0; i<toSpawn; i++) {
        particles.push(Particle.obtain(x, y, color));
    }
}

function updateCamera() {
    if (camera.trackedShip && camera.trackedShip.health > 0) {
        camera.x = camera.trackedShip.position.x - (canvas.width/2)/camera.zoom;
        camera.y = camera.trackedShip.position.y - (canvas.height/2)/camera.zoom;
    } else if (camera.trackedShip && camera.trackedShip.health <= 0) {
        camera.trackedShip = null;
        camera.manualControl = false;
        updateTrackingDisplay();
        updateManualDisplay();
        updateShipInfoPanel();
    }
}

function updateTimeScaleDisplay(){
    let el = document.getElementById('timeScaleDisplay');
    if (!el) {
        el = document.createElement('div'); el.id = 'timeScaleDisplay';
        el.style.position = 'absolute'; el.style.right = '20px'; el.style.top = '20px'; el.style.zIndex = 11;
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '14px';
        el.style.padding = '6px 10px';
        el.style.backgroundColor = 'rgba(0,0,0,0.7)';
        el.style.borderRadius = '4px';
        el.style.border = '1px solid rgba(255,255,255,0.2)';
        document.body.appendChild(el);
    }
    el.innerHTML = `<span style="color:#88f">时间倍率</span>: <span style="color:#fff">${timeScale.toFixed(1)}x</span>`;
}

function gameLoop() {
    ctx.fillStyle = '#0b0c10'; ctx.fillRect(0,0,canvas.width,canvas.height);

    const shipsToRemoveIndices = new Set();
    const projectilesToRemoveIndices = new Set();

    const fleet1Count = ships.filter(s=>s.fleet==='fleet1').length;
    const fleet2Count = ships.filter(s=>s.fleet==='fleet2').length;
    if (fleet1Count < NUM_SHIPS/2) { respawnCooldown1 -= timeScale; if (respawnCooldown1 <= 0) { ships.push(new Ship(Math.random()*(GAME_WORLD_WIDTH/2), Math.random()*GAME_WORLD_HEIGHT, 'fleet1', randomShipType())); respawnCooldown1 = RESPAWN_TIME; } }
    if (fleet2Count < NUM_SHIPS/2) { respawnCooldown2 -= timeScale; if (respawnCooldown2 <= 0) { ships.push(new Ship((GAME_WORLD_WIDTH/2) + Math.random()*(GAME_WORLD_WIDTH/2), Math.random()*GAME_WORLD_HEIGHT, 'fleet2', randomShipType())); respawnCooldown2 = RESPAWN_TIME; } }

    for (let i=0;i<ships.length;i++){
        const ship = ships[i];
        if (!(camera.manualControl && camera.trackedShip === ship)) ship.updateAI(ships, projectiles);
        for (let j = i+1; j<ships.length; j++){
            const other = ships[j];
            if (ship.fleet !== other.fleet) {
                const d = Math.sqrt(Math.pow(ship.position.x - other.position.x,2) + Math.pow(ship.position.y - other.position.y,2));
                if (d < 15) {
                    if (Math.random() > 0.5) {
                        other.health -= 1;
                        if (other.health <= 0) shipsToRemoveIndices.add(j);
                    } else {
                        ship.health -= 1;
                        if (ship.health <= 0) shipsToRemoveIndices.add(i);
                    }
                }
            }
        }
    }

    // 更新并移动子弹/导弹/无人机/EMP
    for (let i=0;i<projectiles.length;i++){
        const p = projectiles[i];
        // 更新弹丸并检查是否需要移除
        if (p.constructor.name === 'SeekingProjectile' && p.fuel <= 0) { projectilesToRemoveIndices.add(i); continue; }
        if (p.constructor.name === 'SeekingProjectile' && p.health <= 0) { projectilesToRemoveIndices.add(i); continue; }
        if (p.isOffscreen()) { projectilesToRemoveIndices.add(i); continue; }
        if (p.constructor.name === 'SeekingProjectile') p.update(ships, timeScale);
        else if (p.constructor.name === 'Drone') p.update(ships, timeScale);
        else p.update(timeScale);
    }

    // EMP 爆炸/生效处理：触发后影响范围内敌舰 EMP_DURATION
    for (let i=0;i<projectiles.length;i++){
        const p = projectiles[i];
        if (p.constructor.name === 'EMPProjectile' && p.activated) {
            for (let j=0;j<ships.length;j++){
                const s = ships[j];
                if (s.fleet === p.fleet) continue;
                const d = Math.sqrt(
                    Math.pow(p.position.x - s.position.x,2) + Math.pow(p.position.y - s.position.y,2)
                );
                if (d < EMP_RANGE) {
                    s.empedUntil = Math.max(s.empedUntil || 0, 40);
                    s.jamming = true;
                }
            }
            projectilesToRemoveIndices.add(i);
            createExplosion(p.position.x, p.position.y, '#9977ff', 1.5);
        }
    }

    // 弹对弹判定（用于近防）
    for (let i=0;i<projectiles.length;i++){
        if (projectilesToRemoveIndices.has(i)) continue;
        for (let j=i+1;j<projectiles.length;j++){
            if (projectilesToRemoveIndices.has(j)) continue;
            const p = projectiles[i]; const q = projectiles[j];
            if (p.fleet === q.fleet) continue;
            const d = Math.sqrt(Math.pow(p.position.x - q.position.x,2) + Math.pow(p.position.y - q.position.y,2));
            if (d < 10) {
                if (p.constructor.name === 'SeekingProjectile' || q.constructor.name === 'SeekingProjectile') {
                    projectilesToRemoveIndices.add(i); projectilesToRemoveIndices.add(j);
                    createExplosion((p.position.x+q.position.x)/2, (p.position.y+q.position.y)/2, '#ffaa77', 0.6);
                }
            }
        }
    }

    // 子弹与舰船命中处理（考虑导弹战斗部）
    for (let i=0;i<projectiles.length;i++){
        if (projectilesToRemoveIndices.has(i)) continue;
        const p = projectiles[i];
        for (let j=0;j<ships.length;j++){
            const ship = ships[j];
            if (p.fleet !== ship.fleet) {
                const d = Math.sqrt(Math.pow(p.position.x - ship.position.x,2) + Math.pow(p.position.y - ship.position.y,2));
                if (d < 10) {
                    if (p.constructor.name === 'SeekingProjectile') {
                        const wh = p.warhead;
                        const R = WARHEAD_EXPLOSION_RADIUS[wh] ?? 0;
                        if (wh === 'kinetic') {
                            ship.health -= p.damage; // 无爆炸
                        } else if (wh === 'ap') {
                            ship.health -= p.damage * 1.5; // 无爆炸
                        } else {
                            // 高爆/核：中心直接伤害 + 半径衰减
                            const baseMult = wh === 'nuclear' ? 5 : 1;
                            // 直接命中的目标
                            ship.health -= p.damage * baseMult;
                            // 范围溅射
                            if (R > 0) {
                                for (let k=0;k<ships.length;k++){
                                    if (k===j) continue;
                                    const s2 = ships[k];
                                    if (s2.fleet !== p.fleet) {
                                        const dd = Math.hypot(p.position.x - s2.position.x, p.position.y - s2.position.y);
                                        if (dd < R) {
                                            const factor = Math.max(0, 1 - dd / R);
                                            s2.health -= p.damage * baseMult * 0.7 * factor; // 较柔和的衰减
                                        }
                                    }
                                }
                                // 对无人机的范围伤害
                                for (let k=0;k<projectiles.length;k++){
                                    const drone = projectiles[k];
                                    if (drone.constructor.name === 'Drone' && drone.fleet !== p.fleet) {
                                        const dd = Math.hypot(p.position.x - drone.position.x, p.position.y - drone.position.y);
                                        if (dd < R) {
                                            const factor = Math.max(0, 1 - dd / R);
                                            drone.health -= p.damage * baseMult * 0.5 * factor;
                                            if (drone.health <= 0) projectilesToRemoveIndices.add(k);
                                        }
                                    }
                                }
                                // 破片散布视觉（不额外伤害，只粒子）
                                const shards = wh === 'nuclear' ? 14 : 8;
                                for (let t=0;t<shards;t++) createExplosion(p.position.x, p.position.y, '#ffcc66', 0.7);
                            }
                        }
                        createExplosion(p.position.x, p.position.y, '#ff8844', wh === 'nuclear' ? 3 : (R>0?1.6:1.0));
                        projectilesToRemoveIndices.add(i);
                        if (ship.health <= 0) shipsToRemoveIndices.add(j);
                        break;
                    } else if (p.constructor.name === 'KineticProjectile' || p.constructor.name === 'EnergyProjectile') {
                        ship.health -= p.damage;
                        projectilesToRemoveIndices.add(i);
                        createExplosion(p.position.x, p.position.y, particleColors[ship.fleet]);
                        if (ship.health <= 0) shipsToRemoveIndices.add(j);
                        break;
                    }
                }
            }
        }
    }

    // 子弹与无人机命中处理
    for (let i=0;i<projectiles.length;i++){
        if (projectilesToRemoveIndices.has(i)) continue;
        const p = projectiles[i];
        if (p.constructor.name === 'Drone') continue; // 无人机不攻击无人机
        for (let j=0;j<projectiles.length;j++){
            if (projectilesToRemoveIndices.has(j)) continue;
            const drone = projectiles[j];
            if (drone.constructor.name !== 'Drone') continue;
            if (p.fleet === drone.fleet) continue;
            const d = Math.sqrt(Math.pow(p.position.x - drone.position.x,2) + Math.pow(p.position.y - drone.position.y,2));
            if (d < 6) { // 无人机较小，碰撞距离也小一些
                drone.health -= p.damage;
                projectilesToRemoveIndices.add(i);
                createExplosion(p.position.x, p.position.y, '#ff6600', 0.5);
                if (drone.health <= 0) {
                    projectilesToRemoveIndices.add(j);
                    createExplosion(drone.position.x, drone.position.y, '#ff4400', 0.8);
                }
                break;
            }
        }
    }

    // remove dead ships
    const newShips = [];
    for (let i=0;i<ships.length;i++){
        if (shipsToRemoveIndices.has(i)) {
            const dead = ships[i];
            createExplosion(dead.position.x, dead.position.y, particleColors[dead.fleet]);
        } else newShips.push(ships[i]);
    }

    if (camera.trackedShip) {
        const stillExists = newShips.includes(camera.trackedShip);
        if (!stillExists) {
            camera.trackedShip = null;
            camera.manualControl = false;
            updateTrackingDisplay();
            updateManualDisplay();
        }
    }
    ships = newShips;

    // 清理 projectiles
    const newProjectiles = [];
    for (let i=0;i<projectiles.length;i++) if (!projectilesToRemoveIndices.has(i)) newProjectiles.push(projectiles[i]);
    projectiles.length = 0;
    projectiles.push(...newProjectiles);

    // 同步全局引用，供舰船自用逻辑访问
    window.__allShips = ships;
    window.__allProjectiles = projectiles;

    updateCamera();

    // 接管模式下：自动点防火控（反导弹/反无人机）
    if (camera.manualControl && camera.trackedShip && camera.trackedShip.health > 0) {
        const s = camera.trackedShip;
        // 遍历所有武器
        for (let weaponIndex = 0; weaponIndex < s.weapons.length; weaponIndex++) {
            if (s.shootCooldowns[weaponIndex] <= 0) {
                const weaponRange = weaponProps[s.weapons[weaponIndex]]?.range || 120;
                let bestTarget = null;
                let bestDist = Infinity;
                
                // 搜索导弹/无人机
                for (const p of projectiles) {
                    if (p.fleet === s.fleet) continue;
                    const isMissile = p.constructor && p.constructor.name === 'SeekingProjectile';
                    const isDrone = p.constructor && p.constructor.name === 'Drone';
                    if ((isMissile && s.autoAntiMissile) || (isDrone && s.autoAntiDrone)) {
                        const dx = Math.abs(s.position.x - p.position.x);
                        const dy = Math.abs(s.position.y - p.position.y);
                        const distanceX = Math.min(dx, GAME_WORLD_WIDTH - dx);
                        const distanceY = Math.min(dy, GAME_WORLD_HEIGHT - dy);
                        const d = Math.hypot(distanceX, distanceY);
                        if (d <= weaponRange && d < bestDist) {
                            bestDist = d;
                            bestTarget = p;
                        }
                    }
                }

                if (bestTarget) {
                    s.shoot(weaponIndex, bestTarget, projectiles);
                }
            }
        }
    }

    for (const ship of ships) {
        if (camera.manualControl && camera.trackedShip === ship) ship.updateAI(ships, projectiles, controlInputs);
        ship.update(timeScale);
        ship.edges(GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT);
        ship.draw(ctx, camera, canvas, SHIP_SIZE, particleColors);
    }

    for (let i=particles.length-1;i>=0;i--){
        const p = particles[i]; p.update(timeScale); p.draw(ctx, camera); if (p.life <= 0) { Particle.release(p); particles.splice(i,1); }
    }
    for (const p of projectiles){
        p.draw(ctx, camera);
    }

    const now = performance.now();
    for (const s of ships) {
        if (s._selectedAt && now - s._selectedAt < 800) {
            const age = now - s._selectedAt;
            const alpha = 1 - age/800;
            const r = 12 + (age/40);
            const tx = (s.position.x - camera.x) * camera.zoom;
            const ty = (s.position.y - camera.y) * camera.zoom;
            const cw = canvas.width, ch = canvas.height;
            const margin = r * camera.zoom + 4;
            if (tx < -margin || tx > cw + margin || ty < -margin || ty > ch + margin) continue;
            ctx.beginPath();
            ctx.arc(tx, ty, r * camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = `rgba(255,255,0,${alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    updateManualDisplay();
    updateShipInfoPanel();

    updateTrackingDisplay();

    requestAnimationFrame(gameLoop);
}

async function startGame(){
    try {
        await iconLoader.loadAllIcons();
    } catch (e) {
        console.warn('图标加载失败，继续使用旧有绘制方式', e);
    }
    // 启动主循环
    window.addEventListener('load', gameLoop);
}

startGame();
window.iconLoader = iconLoader;
