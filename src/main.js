// 入口：把 UI、相机、事件、游戏循环整合在这里
import {
    GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT, WORLD_ASPECT_RATIO,
    NUM_SHIPS, SHIP_SIZE, RESPAWN_TIME, fleetColors, particleColors,
    weaponProps, WEAPON_MISSILE, MISSILE_ENGAGEMENT_RADIUS
} from './constants.js';
import { Vector } from './vector.js';
import { Particle, KineticProjectile, SeekingProjectile, EnergyProjectile } from './projectiles.js';
import { Ship } from './ship.js';
import { randomShipType, randomMissileWarhead } from './utils.js';

const canvas = document.getElementById('beeCanvas');
const ctx = canvas.getContext('2d');

let ships = [];
const particles = [];
const projectiles = [];
let respawnCooldown1 = RESPAWN_TIME;
let respawnCooldown2 = RESPAWN_TIME;

const camera = { x: 0, y: 0, zoom: 1, trackedShip: null, manualControl: false };
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
    }

    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') controlInputs.up = true;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') controlInputs.down = true;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') controlInputs.left = true;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') controlInputs.right = true;
    if (e.key === ' ' ) controlInputs.fire = true;

    updateTrackingDisplay();
    updateManualDisplay();
    updateShipInfoPanel();
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
        document.body.appendChild(el);
    }
    if (camera.trackedShip) {
        el.textContent = `追踪舰队 ${camera.trackedShip.fleet} 飞船`;
        el.style.color = fleetColors[camera.trackedShip.fleet];
    } else {
        el.textContent = `未追踪`;
        el.style.color = '#e2e8f0';
    }
}
function updateManualDisplay() {
    let el = document.getElementById('manualDisplay');
    if (!el) {
        el = document.createElement('div'); el.id = 'manualDisplay';
        el.style.position = 'absolute'; el.style.left = '20px'; el.style.top = '40px'; el.style.zIndex = 11;
        document.body.appendChild(el);
    }
    if (camera.manualControl && camera.trackedShip) {
        el.textContent = `接管中：舰队 ${camera.trackedShip.fleet}`;
        el.style.color = '#ff8800';
    } else {
        el.textContent = `未接管`;
        el.style.color = '#e2e8f0';
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

function createExplosion(x,y,color,scale=1){ for (let i=0;i<12*scale;i++) particles.push(new Particle(x,y,color)); }

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

    // 更新并移动子弹/导弹
    for (let i=0;i<projectiles.length;i++){
        const p = projectiles[i];
        if (p.constructor.name === 'SeekingProjectile' && p.fuel <= 0) { projectilesToRemoveIndices.add(i); continue; }
        if (p.isOffscreen()) { projectilesToRemoveIndices.add(i); continue; }
        if (p.constructor.name === 'SeekingProjectile') p.update(ships, timeScale);
        else p.update(timeScale);
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
                        // 导弹命中 -> 根据战斗部处理范围伤害或穿甲
                        const wh = p.warhead;
                        if (wh === 'kinetic') {
                            ship.health -= p.damage;
                        } else if (wh === 'ap') {
                            ship.health -= p.damage * 1.5;
                        } else if (wh === 'he') {
                            ship.health -= p.damage;
                            const R = 60;
                            for (let k=0;k<ships.length;k++){
                                if (k===j) continue;
                                const s2 = ships[k];
                                if (s2.fleet !== ship.fleet) {
                                    const dd = Math.sqrt(Math.pow(p.position.x - s2.position.x,2) + Math.pow(p.position.y - s2.position.y,2));
                                    if (dd < R) s2.health -= p.damage * 0.5;
                                }
                            }
                        } else if (wh === 'nuclear') {
                            const R = 200;
                            for (let k=0;k<ships.length;k++){
                                const s2 = ships[k];
                                if (s2.fleet !== p.fleet) {
                                    const dd = Math.sqrt(Math.pow(p.position.x - s2.position.x,2) + Math.pow(p.position.y - s2.position.y,2));
                                    if (dd < R) {
                                        const factor = Math.max(0, 1 - dd / R);
                                        s2.health -= p.damage * 5 * factor;
                                    }
                                }
                            }
                        }
                        createExplosion(p.position.x, p.position.y, '#ff8844', p.warhead === 'nuclear' ? 3 : 1.2);
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

    updateCamera();

    for (const ship of ships) {
        if (camera.manualControl && camera.trackedShip === ship) ship.controlUpdate(controlInputs, projectiles);
        ship.update(timeScale);
        ship.edges(GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT);
        ship.draw(ctx, camera, canvas, SHIP_SIZE, particleColors);
    }

    for (let i=particles.length-1;i>=0;i--){
        const p = particles[i]; p.update(timeScale); p.draw(ctx, camera); if (p.life <= 0) particles.splice(i,1);
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
            ctx.beginPath();
            ctx.arc(tx, ty, r * camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = `rgba(255,255,0,${alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    updateManualDisplay();
    updateShipInfoPanel();

    requestAnimationFrame(gameLoop);
}

window.addEventListener('load', gameLoop);
