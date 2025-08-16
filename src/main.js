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
const MAX_ZOOM = 8;
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

});

let lastTouchX = 0;
let lastTouchY = 0;
let lastTap = 0; // 用于双击检测

// 双指缩放状态
let isPinching = false;
let initialDistance = 0;
let initialZoom = 0;

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!camera.manualControl) {
        camera.trackedShip = null;
    }
    updateTrackingDisplay();

    // 单指平移
    if (e.touches.length === 1) {
        if (camera.manualControl) {
            // 在手动模式下，单击可能用于选择目标，这里不进行拖动
            return;
        }
        isDragging = true;
        canvas.classList.add('grabbing');
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
    } 
    // 双指缩放
    else if (e.touches.length === 2) {
        isPinching = true;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        initialDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
        initialZoom = camera.zoom;
    }
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();

    // 单指平移
    if (isDragging && e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchX;
        const dy = e.touches[0].clientY - lastTouchY;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
    } 
    // 双指缩放
    else if (isPinching && e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
        
        // 计算缩放中心
        const rect = canvas.getBoundingClientRect();
        const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

        const worldX = camera.x + centerX / camera.zoom;
        const worldY = camera.y + centerY / camera.zoom;
        
        // 计算新的缩放级别
        let newZoom = initialZoom * (currentDistance / initialDistance);
        newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));
        camera.zoom = newZoom;

        // 保持缩放中心不变
        camera.x = worldX - centerX / camera.zoom;
        camera.y = worldY - centerY / camera.zoom;
    }
});

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();

    // 重置状态
    isDragging = false;
    isPinching = false;
    canvas.classList.remove('grabbing');

    // 处理单指点击和双击
    // 如果没有触摸点，并且之前的操作不是缩放，则进行点击/双击检测
    if (e.touches.length === 0) {
        const now = Date.now();
        const deltaT = now - lastTap;
        
        // 双击
        if (deltaT < 300) {
            // 触发双击逻辑
            handleTap(e, true);
        } else {
            // 单击
            // 使用 setTimeout 延迟执行，以便有时间检测双击
            setTimeout(() => {
                const now_check = Date.now();
                if (now_check - now > 250) { // 如果在250ms内没有第二次点击，则认为是单次点击
                    handleTap(e, false);
                }
            }, 300);
        }
        lastTap = now;
    }
});

// 处理点击和双击的函数
function handleTap(e, isDoubleClick) {
    const rect = canvas.getBoundingClientRect();
    const touchX = e.changedTouches[0].clientX - rect.left;
    const touchY = e.changedTouches[0].clientY - rect.top;
    const worldX = camera.x + touchX / camera.zoom;
    const worldY = camera.y + touchY / camera.zoom;

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

    if (isDoubleClick) {
        // 双击逻辑
        if (!camera.manualControl) {
            camera.trackedShip = found || null;
            updateTrackingDisplay();
        }
    } else {
        // 单击逻辑
        if (camera.manualControl) {
            if (found && camera.trackedShip && found.fleet !== camera.trackedShip.fleet) {
                camera.trackedShip.manualTarget = found;
                createExplosion(found.position.x, found.position.y, particleColors[found.fleet]);
                found._selectedAt = performance.now();
            }
        }
    }
}

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
        el = document.createElement('div');
        el.id = 'trackingDisplay';
        el.style.position = 'fixed';
        el.style.left = '20px';
        el.style.top = '20px';
        el.style.zIndex = 1000;
        el.style.pointerEvents = 'auto';
        el.style.width = '320px';
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '13px';
        el.style.color = '#e2e8f0';
        el.style.background = 'rgba(12,14,20,0.85)';
        el.style.backdropFilter = 'blur(6px)';
        el.style.border = '1px solid rgba(255,255,255,0.08)';
        el.style.borderRadius = '10px';
        el.style.padding = '10px 12px';
        el.style.boxShadow = '0 8px 18px rgba(0,0,0,0.4)';
        document.body.appendChild(el);
    }

    if (camera.trackedShip) {
        const s = camera.trackedShip;
        const healthPercent = ((s.health / s.maxHealth) * 100).toFixed(0);
        const energyPercent = ((s.energy / s.maxEnergy) * 100).toFixed(0);
        const heatPercent = ((s.heat / s.maxHeat) * 100).toFixed(0);
        const dvPercent = ((s.deltaV / s.maxDeltaV) * 100).toFixed(0);
        const empActive = (s.empedUntil && s.empedUntil > 0) ? `${Math.ceil(s.empedUntil)} 帧` : '无';
        const jam = s.jamming ? '是' : '否';
        const droneCount = s.drones ? s.drones.length : 0;
        const avgFuelPct = (s.drones && s.drones.length > 0) ? Math.round(s.drones.reduce((acc,d)=>acc + (d.fuel||0),0) / (600 * s.drones.length) * 100) : 0;
        const readyMissileIdx = s.weapons.findIndex(w=>w===WEAPON_MISSILE);
        const warheadTxt = (readyMissileIdx!==-1 && s.weaponWarheads && s.weaponWarheads[readyMissileIdx]) ? s.weaponWarheads[readyMissileIdx] : '—';

        // helper: 进度条
        const bar = (pct,color='#4fd1c5') => `
            <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
                <div style="width:${pct}%; height:100%; background:${color};"></div>
            </div>
        `;

        // 武器区
        let weaponsHtml = '';
        for (let i=0;i<s.weapons.length;i++){
            const name = s.weapons[i];
            const props = weaponProps[name];
            const cooldown = s.shootCooldowns[i];
            const percent = props.cooldown ? Math.max(0, Math.min(100, (cooldown/props.cooldown)*100)) : 0;
            const warhead = s.weaponWarheads[i];
            const weaponLabel = warhead ? `${name}[${warhead}]` : name;
            weaponsHtml += `
                <div style="margin:4px 0;">
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#ddd;">
                        <span>${i+1}. ${weaponLabel}</span>
                        <span>${props.damage}dmg/${props.range}r | CD:${Math.round(cooldown)}</span>
                    </div>
                    ${bar(percent,'#f6ad55')}
                </div>
            `;
        }

        el.innerHTML = `
            <div style="font-weight:bold; color:${fleetColors[s.fleet]}; font-size:14px; margin-bottom:4px;">
                追踪: 舰队 ${s.fleet} ${s.typeLabel}
            </div>
            <div style="font-size:12px; color:#cbd5e0; margin-bottom:6px;">
                状态: ${s.state} | 速度: ${s.velocity.mag().toFixed(1)} | 位置: (${Math.round(s.position.x)}, ${Math.round(s.position.y)})
            </div>

            <div style="font-size:12px; margin-bottom:4px;">生命值 ${healthPercent}%</div>
            ${bar(healthPercent,'#f56565')}

            <div style="font-size:12px; margin:6px 0 4px;">能量 ${energyPercent}% (${Math.round(s.energy)}/${s.maxEnergy})</div>
            ${bar(energyPercent,'#63b3ed')}

            <div style="font-size:12px; margin:6px 0 4px;">热量 ${heatPercent}%</div>
            ${bar(heatPercent,'#ed8936')}

            <div style="font-size:12px; margin:6px 0 4px;">ΔV ${dvPercent}%</div>
            ${bar(dvPercent,'#9f7aea')}

            <div style="font-size:11px; color:#c9f; margin:8px 0;">
                EMP: ${empActive} | 干扰: ${jam} | 无人机: ${droneCount}/3${droneCount>0?` (燃料${avgFuelPct}%)`:''} | 战斗部: ${warheadTxt}
            </div>

            <div style="color:#ffeb3b; font-size:12px; font-weight:bold; margin-top:6px;">武器系统</div>
            ${weaponsHtml}
        `;
    } else {
        el.innerHTML = `<div style="color:#e2e8f0;">未追踪</div>`;
    }
}



function updateManualDisplay() {
    // --- helpers ---
    function arraysEqualBool(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!!a[i] !== !!b[i]) return false;
        return true;
    }
    function snapshotForShip(s) {
        return {
            weaponsCount: s.weapons ? s.weapons.length : 0,
            weaponEnabled: (s.weaponEnabled || []).map(v => !!v),
            options: {
                fireControlOverride: !!s.fireControlOverride,
                autoAntiShip: !!s.autoAntiShip,
                autoAntiMissile: !!s.autoAntiMissile,
                autoAntiDrone: !!s.autoAntiDrone
            },
            weaponNames: (s.weapons || []).slice()
        };
    }

    // --- styles (once) ---
    if (!document.getElementById('manualDisplayStyles')) {
        const style = document.createElement('style');
        style.id = 'manualDisplayStyles';
        style.textContent = `
            .manual-display {
                position: fixed;
                right: 20px;
                top: 90px;
                z-index: 1000;
                pointer-events: auto;
                font-family: monospace;
                font-size: 14px;
                padding: 12px 14px;
                background: rgba(18,20,30,0.72);
                backdrop-filter: blur(6px);
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.10);
                box-shadow: 0 6px 18px rgba(0,0,0,0.45);
                color: #ddd;
                min-width: 260px;
            }
            .manual-display .title { color:#ffb000; font-weight:700; font-size:15px; }
            .manual-display .line { font-size:12px; color:#bbb; margin-bottom:4px; }
            .manual-display .small { font-size:11px; color:#999; margin-top:8px; }
            .header-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px; }
            .options-row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
            .option-btn {
                padding:6px 8px;
                border-radius:8px;
                border:1px solid rgba(255,255,255,0.06);
                background: rgba(80,80,80,0.12);
                color:#e6eef6;
                font-size:13px;
                cursor:pointer;
                transition: all .14s;
                user-select:none;
            }
            .option-btn.on {
                background: linear-gradient(180deg, rgba(0,200,120,0.95), rgba(0,160,100,0.95));
                color:#042613;
                box-shadow: 0 4px 10px rgba(0,160,100,0.14), inset 0 -1px rgba(0,0,0,0.08);
            }
            .weapon-list { margin-top:10px; display:flex; flex-direction:column; gap:8px; max-height:240px; overflow:auto; padding-right:4px; }
            .weapon-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 2px; }
            .weapon-label { color:#e6eef6; font-size:13px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; max-width:160px; }
            .weapon-btn {
                padding:5px 8px;
                border-radius:6px;
                border:1px solid rgba(255,255,255,0.06);
                background: rgba(100,100,100,0.12);
                color:#e6eef6;
                font-size:13px;
                cursor:pointer;
                transition: all .14s;
                user-select:none;
                min-width:54px;
                text-align:center;
            }
            .weapon-btn.on {
                background: rgba(0,180,100,0.92);
                color:#042613;
                box-shadow: 0 3px 8px rgba(0,160,90,0.12);
            }
            .weapon-list::-webkit-scrollbar { width:8px; height:8px; }
            .weapon-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius:4px; }
            /* 新的接管切换按钮（两种状态共用） */
            .takeover-toggle {
                padding:6px 10px;
                border-radius:8px;
                border:1px solid rgba(255,255,255,0.10);
                font-weight:700;
                font-size:13px;
                cursor:pointer;
                user-select:none;
                transition: filter .12s;
            }
            .takeover-toggle:hover { filter: brightness(1.05); }
            .takeover-toggle.on {
                background: linear-gradient(180deg, rgba(240,80,80,0.95), rgba(210,60,60,0.95));
                color:#2b0f0f;
                box-shadow: 0 6px 16px rgba(210,60,60,0.25), inset 0 -1px rgba(0,0,0,0.1);
            }
            .takeover-toggle.off {
                background: linear-gradient(180deg, rgba(40,120,255,0.95), rgba(30,90,220,0.95));
                color:#0b1320;
                box-shadow: 0 6px 16px rgba(30,90,220,0.25), inset 0 -1px rgba(0,0,0,0.1);
            }
            .takeover-toggle:disabled {
                opacity:.5; cursor:not-allowed; filter:none;
            }
        `;
        document.head.appendChild(style);
    }

    // --- container (once) ---
    let el = document.getElementById('manualDisplay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'manualDisplay';
        el.className = 'manual-display';
        document.body.appendChild(el);
        el._refs = null;
        el._lastSnapshot = null;
        el._forceRefresh = false;
    }

    // --- shortcut keys (once) ---
    if (!document._manualDisplayKeybindsAdded) {
        document._manualDisplayKeybindsAdded = true;
        document.addEventListener('keydown', (ev) => {
            const key = (ev.key || '').toLowerCase();
            // 新增 O 键作为接管切换
            if (key === 'o') {
                if (camera.trackedShip && camera.trackedShip.health > 0) {
                    camera.manualControl = !camera.manualControl;
                    try { isDragging = false; canvas.classList.remove('grabbing'); } catch (e) {}
                    updateManualDisplay();
                    ev.preventDefault();
                    return;
                }
            }
            if (!camera.manualControl || !camera.trackedShip) return;
            const s = camera.trackedShip;
            if (!s) return;
            if (key === 'f') {
                s.fireControlOverride = !s.fireControlOverride;
                updateManualDisplay();
                ev.preventDefault();
            } else if (key === 'b') {
                s.autoAntiShip = !s.autoAntiShip;
                updateManualDisplay();
                ev.preventDefault();
            } else if (key === 'm') {
                s.autoAntiMissile = !s.autoAntiMissile;
                updateManualDisplay();
                ev.preventDefault();
            } else if (key === 'n') {
                s.autoAntiDrone = !s.autoAntiDrone;
                updateManualDisplay();
                ev.preventDefault();
            } else {
                const num = parseInt(key, 10);
                if (!isNaN(num) && num >= 1) {
                    const idx = num - 1;
                    const s2 = camera.trackedShip;
                    if (!s2 || !s2.weapons) return;
                    if (!s2.weaponEnabled || s2.weaponEnabled.length !== s2.weapons.length) {
                        s2.weaponEnabled = new Array(s2.weapons.length).fill(true);
                    }
                    if (idx < s2.weapons.length) {
                        s2.weaponEnabled[idx] = !s2.weaponEnabled[idx];
                        updateManualDisplay();
                        ev.preventDefault();
                    }
                }
            }
        }, { capture: true });
    }

    // --- external force refresh ---
    window.manualDisplayForceRefresh = function () {
        const e = document.getElementById('manualDisplay');
        if (!e) return;
        e._forceRefresh = true;
        updateManualDisplay();
    };

    // --- display logic ---
    // 如果没有追踪目标，显示未追踪并禁用切换按钮
    if (!camera.trackedShip) {
        el.innerHTML = '';
        const header = document.createElement('div'); header.className = 'header-row';
        const title = document.createElement('div'); title.className = 'title'; title.textContent = '未追踪';
        const tbtn = document.createElement('button'); tbtn.className = 'takeover-toggle off'; tbtn.textContent = '接管';
        tbtn.disabled = true;
        header.appendChild(title); header.appendChild(tbtn);
        el.appendChild(header);
        el._refs = { title, takeoverBtn: tbtn };
        el._lastSnapshot = null;
        el._forceRefresh = false;
        return;
    }

    const s = camera.trackedShip;

    // ensure weaponEnabled exists
    if (!s.weaponEnabled || s.weaponEnabled.length !== s.weapons.length) {
        s.weaponEnabled = new Array(s.weapons.length).fill(true);
    }

    // snapshot for rebuild decision
    const curSnap = snapshotForShip(s);
    const last = el._lastSnapshot;
    const force = !!el._forceRefresh;

    const needFullRebuild =
        force ||
        !el._refs ||
        !last ||
        last.weaponsCount !== curSnap.weaponsCount ||
        !arraysEqualBool(last.weaponEnabled, curSnap.weaponEnabled) ||
        last.options.fireControlOverride !== curSnap.options.fireControlOverride ||
        last.options.autoAntiShip !== curSnap.options.autoAntiShip ||
        last.options.autoAntiMissile !== curSnap.options.autoAntiMissile ||
        last.options.autoAntiDrone !== curSnap.options.autoAntiDrone ||
        JSON.stringify(last.weaponNames) !== JSON.stringify(curSnap.weaponNames);

    const targetTxt = s.manualTarget && s.manualTarget.health > 0
        ? `${s.manualTarget.typeLabel || '目标'} (${s.manualTarget.fleet})` : '无目标';

    // ---------- partial update ----------
    if (!needFullRebuild && el._refs) {
        // 顶部标题与接管切换按钮
        el._refs.title.textContent = camera.manualControl ? '接管中' : '未接管';
        const tbtn = el._refs.takeoverBtn;
        if (tbtn) {
            tbtn.disabled = !(camera.trackedShip && camera.trackedShip.health > 0);
            tbtn.classList.remove('on', 'off');
            if (camera.manualControl) {
                tbtn.classList.add('on');
                tbtn.textContent = '解除接管 (O)';
                tbtn.title = '解除接管 (O)';
            } else {
                tbtn.classList.add('off');
                tbtn.textContent = '接管 (O)';
                tbtn.title = '接管 (O)';
            }
        }

        // 文本
        if (el._refs.lineTarget) el._refs.lineTarget.textContent = `目标: ${targetTxt}`;
        if (el._refs.lineFcs) el._refs.lineFcs.textContent = `火控: ${s.fireControlOverride ? '已解锁' : '限制中'} (F) | 反舰: ${s.autoAntiShip ? '开' : '关'} (B)`;
        if (el._refs.linePd)  el._refs.linePd.textContent  = `点防: 导弹 ${s.autoAntiMissile ? '开' : '关'} (M) | 无人机 ${s.autoAntiDrone ? '开' : '关'} (N)`;
        if (el._refs.hint)     el._refs.hint.textContent     = '提示: WSAD 控制，空格开火，单击敌舰设为目标（快捷键：O/F/B/M/N，数字键 1.. 用于武器）';

        // 选项按钮状态
        if (el._refs.optionsRow) {
            const optBtns = el._refs.optionsRow.querySelectorAll('.option-btn');
            optBtns.forEach(btn => {
                const opt = btn.dataset.opt;
                if (opt === 'fcs') {
                    btn.classList.toggle('on', !!s.fireControlOverride);
                    btn.textContent = `火控 (${s.fireControlOverride ? '已解锁' : '限制中'})`;
                } else if (opt === 'antiShip') {
                    btn.classList.toggle('on', !!s.autoAntiShip);
                    btn.textContent = `反舰 (${s.autoAntiShip ? '开' : '关'})`;
                } else if (opt === 'pdMissile') {
                    btn.classList.toggle('on', !!s.autoAntiMissile);
                    btn.textContent = `点防导弹 (${s.autoAntiMissile ? '开' : '关'})`;
                } else if (opt === 'pdDrone') {
                    btn.classList.toggle('on', !!s.autoAntiDrone);
                    btn.textContent = `点防无人机 (${s.autoAntiDrone ? '开' : '关'})`;
                }
            });
        }

        // 武器按钮
        if (el._refs.weaponList) {
            const rows = el._refs.weaponList.querySelectorAll('.weapon-row');
            rows.forEach(row => {
                const idx = Number(row.dataset.index);
                const btn = row.querySelector('.weapon-btn');
                const label = row.querySelector('.weapon-label');
                if (!btn || !label) return;
                const on = !!s.weaponEnabled[idx];
                btn.classList.toggle('on', on);
                btn.textContent = on ? '启用' : '禁用';
                label.textContent = `${idx+1}: ${s.weapons[idx]}${s.weaponWarheads && s.weaponWarheads[idx] ? `[${s.weaponWarheads[idx]}]` : ''}`;
            });
        }

        el._forceRefresh = false;
        el._lastSnapshot = curSnap;
        return;
    }

    // ---------- full rebuild ----------
    el.innerHTML = '';

    // Header: 标题 + 接管切换按钮（两种状态皆存在）
    const headerRow = document.createElement('div'); headerRow.className = 'header-row';
    const title = document.createElement('div'); title.className = 'title';
    title.textContent = camera.manualControl ? '接管中' : '未接管';

    const takeoverBtn = document.createElement('button');
    takeoverBtn.type = 'button';
    takeoverBtn.className = 'takeover-toggle ' + (camera.manualControl ? 'on' : 'off');
    takeoverBtn.textContent = camera.manualControl ? '解除接管 (O)' : '接管 (O)';
    takeoverBtn.title = camera.manualControl ? '解除接管 (O)' : '接管 (O)';
    takeoverBtn.disabled = !(camera.trackedShip && camera.trackedShip.health > 0);
    takeoverBtn.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        if (!(camera.trackedShip && camera.trackedShip.health > 0)) return;
        camera.manualControl = !camera.manualControl;
        try { isDragging = false; canvas.classList.remove('grabbing'); } catch (e) {}
        updateManualDisplay();
    });

    headerRow.appendChild(title);
    headerRow.appendChild(takeoverBtn);
    el.appendChild(headerRow);

    // 如果未接管，显示简要信息后返回（仍保留接管按钮）
    if (!camera.manualControl) {
        const line = document.createElement('div'); line.className = 'line'; line.style.color = '#e2e8f0';
        line.textContent = '未接管';
        el.appendChild(line);
        const tip = document.createElement('div'); tip.className = 'small';
        tip.textContent = '提示: 点右侧按钮或按 O 键接管。';
        el.appendChild(tip);

        el._refs = { title, takeoverBtn };
        el._lastSnapshot = curSnap; // 保存快照也行
        el._forceRefresh = false;
        return;
    }

    // 已接管：其余 UI
    const lineTarget = document.createElement('div'); lineTarget.className = 'line'; lineTarget.textContent = `🎯 目标: ${targetTxt}`;
    const lineFcs = document.createElement('div'); lineFcs.className = 'line'; lineFcs.textContent = `⚙️ 火控: ${s.fireControlOverride ? '已解锁' : '限制中'} (F) | 反舰: ${s.autoAntiShip ? '开' : '关'} (B)`;
    const linePd = document.createElement('div'); linePd.className = 'line'; linePd.textContent = `🛡️ 点防: 导弹 ${s.autoAntiMissile ? '开' : '关'} (M) | 无人机 ${s.autoAntiDrone ? '开' : '关'} (N)`;

    el.appendChild(lineTarget);
    el.appendChild(lineFcs);
    el.appendChild(linePd);

    // options buttons
    const optionsRow = document.createElement('div'); optionsRow.className = 'options-row';
    function makeOptionBtn(idSuffix, text, isOn, handler) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option-btn' + (isOn ? ' on' : '');
        btn.dataset.opt = idSuffix;
        btn.textContent = text;
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            handler();
            updateManualDisplay();
        });
        return btn;
    }
    const btnFcs = makeOptionBtn('fcs', `火控 (${s.fireControlOverride ? '已解锁' : '限制中'})`, !!s.fireControlOverride, () => { s.fireControlOverride = !s.fireControlOverride; });
    const btnAntiShip = makeOptionBtn('antiShip', `反舰 (${s.autoAntiShip ? '开' : '关'})`, !!s.autoAntiShip, () => { s.autoAntiShip = !s.autoAntiShip; });
    const btnPdMissile = makeOptionBtn('pdMissile', `点防导弹 (${s.autoAntiMissile ? '开' : '关'})`, !!s.autoAntiMissile, () => { s.autoAntiMissile = !s.autoAntiMissile; });
    const btnPdDrone = makeOptionBtn('pdDrone', `点防无人机 (${s.autoAntiDrone ? '开' : '关'})`, !!s.autoAntiDrone, () => { s.autoAntiDrone = !s.autoAntiDrone; });

    optionsRow.appendChild(btnFcs);
    optionsRow.appendChild(btnAntiShip);
    optionsRow.appendChild(btnPdMissile);
    optionsRow.appendChild(btnPdDrone);
    el.appendChild(optionsRow);

    // weapons
    const weaponList = document.createElement('div'); weaponList.className = 'weapon-list';
    for (let i = 0; i < s.weapons.length; i++) {
        const row = document.createElement('div'); row.className = 'weapon-row'; row.dataset.index = i;
        const label = document.createElement('div'); label.className = 'weapon-label';
        label.textContent = `${i+1}: ${s.weapons[i]}${s.weaponWarheads && s.weaponWarheads[i] ? `[${s.weaponWarheads[i]}]` : ''}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'weapon-btn' + (s.weaponEnabled[i] ? ' on' : '');
        btn.dataset.index = i;
        btn.textContent = s.weaponEnabled[i] ? '启用' : '禁用';
        btn.title = '点击切换此武器启用/禁用';
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            const idx = Number(this.dataset.index);
            s.weaponEnabled[idx] = !s.weaponEnabled[idx];
            updateManualDisplay();
        });

        row.appendChild(label);
        row.appendChild(btn);
        weaponList.appendChild(row);
    }
    el.appendChild(weaponList);

    // hint
    const hint = document.createElement('div'); hint.className = 'small';
    hint.textContent = '提示: WSAD 控制，空格开火，单击敌舰设为目标（快捷键：O/F/B/M/N，数字键 1.. 用于武器）';
    el.appendChild(hint);

    // refs & snapshot
    el._refs = {
        title,
        takeoverBtn,
        lineTarget,
        lineFcs,
        linePd,
        optionsRow,
        weaponList,
        hint
    };
    el._lastSnapshot = curSnap;
    el._forceRefresh = false;
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
    }
}

function updateTimeScaleDisplay() {
    // 如果没有全局 timeScale，初始化为 1.0
    if (typeof timeScale === 'undefined' || timeScale === null) timeScale = 1.0;

    // 注入样式（只注入一次）
    if (!document.getElementById('timeScaleDisplayStyles')) {
        const style = document.createElement('style');
        style.id = 'timeScaleDisplayStyles';
        style.textContent = `
            .time-scale-display {
                position: absolute;
                right: 20px;
                top: 20px;
                z-index: 1100;
                font-family: monospace;
                font-size: 14px;
                padding: 8px 10px;
                background: rgba(12,14,20,0.78);
                backdrop-filter: blur(4px);
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.08);
                color: #e6eef6;
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 140px;
                box-shadow: 0 6px 14px rgba(0,0,0,0.45);
            }
            .time-scale-label { color: #88f; font-weight: 600; margin-right: 4px; }
            .time-scale-value { color: #fff; min-width:48px; text-align:center; font-weight:700; }
            .time-scale-btn {
                padding:4px 8px;
                border-radius:6px;
                border:1px solid rgba(255,255,255,0.06);
                background: rgba(90,90,90,0.12);
                color: #e6eef6;
                cursor: pointer;
                user-select: none;
                transition: transform .08s ease, background .12s;
                font-weight:700;
            }
            .time-scale-btn:active { transform: translateY(1px) scale(0.98); }
            .time-scale-btn.small { padding:2px 6px; font-size:13px; border-radius:5px; }
            .time-scale-btn.positive { background: linear-gradient(180deg, rgba(0,200,120,0.95), rgba(0,160,100,0.95)); color:#042613; }
            .time-scale-btn.negative { background: linear-gradient(180deg, rgba(220,80,80,0.95), rgba(200,60,60,0.95)); color:#2b0f0f; }
        `;
        document.head.appendChild(style);
    }

    // 创建或获取容器（容器只创建一次，但内容会更新）
    let el = document.getElementById('timeScaleDisplay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'timeScaleDisplay';
        el.className = 'time-scale-display';

        // 内容结构
        const lbl = document.createElement('div');
        lbl.className = 'time-scale-label';
        lbl.textContent = '时间倍率';

        const minus = document.createElement('button');
        minus.className = 'time-scale-btn small';
        minus.type = 'button';
        minus.title = '减小 0.1';
        minus.textContent = '−';

        const value = document.createElement('div');
        value.className = 'time-scale-value';
        value.id = 'timeScaleValue';

        const plus = document.createElement('button');
        plus.className = 'time-scale-btn small';
        plus.type = 'button';
        plus.title = '增加 0.1';
        plus.textContent = '+';

        // 按钮事件（只绑定一次）
        minus.addEventListener('click', (ev) => {
            ev.stopPropagation(); ev.preventDefault();
            // 避免浮点误差：用整数运算（*10）
            let v = Math.round((timeScale * 10)) / 10;
            v = Math.max(0, Math.round((v - 0.1) * 10) / 10);
            // clamp to 1 decimal
            timeScale = Math.round(v * 10) / 10;
            updateTimeScaleDisplay();
            // 可选：触发回调如果需要
            if (typeof window.onTimeScaleChange === 'function') window.onTimeScaleChange(timeScale);
        });

        plus.addEventListener('click', (ev) => {
            ev.stopPropagation(); ev.preventDefault();
            let v = Math.round((timeScale * 10)) / 10;
            v = Math.min(10, Math.round((v + 0.1) * 10) / 10);
            timeScale = Math.round(v * 10) / 10;
            updateTimeScaleDisplay();
            if (typeof window.onTimeScaleChange === 'function') window.onTimeScaleChange(timeScale);
        });

        // 把节点加入容器并 append 到 body
        el.appendChild(lbl);
        el.appendChild(minus);
        el.appendChild(value);
        el.appendChild(plus);
        document.body.appendChild(el);

        // 保存引用用于后续更新
        el._refs = { lbl, minus, value, plus };
    }

    // 更新显示值
    const valueEl = el._refs && el._refs.value ? el._refs.value : document.getElementById('timeScaleValue');
    // 保证显示一位小数
    const display = (Math.round(timeScale * 10) / 10).toFixed(1) + 'x';
    if (valueEl) valueEl.textContent = display;

    // 可视化提示：当 timeScale>1 按钮变色为绿色；timeScale<1 为红；等于1 为中性（可选）
    const plusBtn = el._refs.plus, minusBtn = el._refs.minus;
    if (timeScale > 1.0) {
        plusBtn.classList.add('positive'); plusBtn.classList.remove('negative');
        minusBtn.classList.remove('positive'); minusBtn.classList.remove('negative');
    } else if (timeScale < 1.0) {
        minusBtn.classList.add('negative'); minusBtn.classList.remove('positive');
        plusBtn.classList.remove('positive'); plusBtn.classList.remove('negative');
    } else {
        plusBtn.classList.remove('positive','negative');
        minusBtn.classList.remove('positive','negative');
    }
}


updateTimeScaleDisplay();
function gameLoop() {
    updateManualDisplay();
    updateTrackingDisplay();
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
