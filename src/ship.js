import { Vector } from './vector.js';
import { weaponProps, WEAPON_PULSE_LASER, WEAPON_CONTINUOUS_LASER, WEAPON_RAPID_ENERGY, WEAPON_PDEF, WEAPON_COIL, WEAPON_MISSILE, WEAPON_EMP, WEAPON_DRONE_BAY, shipTypes, fleetColors } from './constants.js';
import { EnergyProjectile, KineticProjectile, SeekingProjectile, EMPProjectile, Drone } from './projectiles.js';
import { MAX_FORCE, PERCEPTION_RADIUS, SEPARATION_RADIUS, SEPARATION_WEIGHT, ALIGNMENT_WEIGHT, COHESION_WEIGHT, ATTACK_WEIGHT, FLEE_WEIGHT, MISSILE_ENGAGEMENT_RADIUS, HEAT_DISSIPATION_RATE, ENERGY_REGEN_RATE, DELTA_V_CONSUMPTION_RATE, OVERHEATING_DAMAGE, EMP_DURATION, MAX_ANGULAR_SPEED } from './constants.js';

export class Ship {
    constructor(x,y,fleet, shipTypeKey) {
        this.position = new Vector(x,y);
        this.velocity = new Vector(Math.random()*2-1, Math.random()*2-1);
        this.acceleration = new Vector(0,0);
        this.fleet = fleet;
        this.color = fleetColors[fleet];

        // 舰种属性
        this.typeKey = shipTypeKey;
        const t = shipTypes[shipTypeKey] || shipTypes['frigate'];
        this.typeLabel = t.label;
        this.maxHealth = t.maxHealth;
        this.health = this.maxHealth;
        this.maxSpeed = t.maxSpeed;
        this.weaponSlots = t.weaponSlots;

        // 系统管理
        this.maxEnergy = t.maxEnergy;
        this.energy = this.maxEnergy;
        this.maxHeat = t.maxHeat;
        this.heat = 0;
        this.maxDeltaV = t.maxDeltaV;
        this.deltaV = this.maxDeltaV;
        this.empedUntil = 0; // EMP 持续时间
        this.jamming = false; // 是否被干扰

        // 武器槽：随机分配（并为导弹分配战斗部）
        this.weapons = [];
        this.weaponWarheads = [];
        this.shootCooldowns = [];
        const weaponTypes = [WEAPON_PULSE_LASER, WEAPON_CONTINUOUS_LASER, WEAPON_RAPID_ENERGY, WEAPON_PDEF, WEAPON_COIL, WEAPON_MISSILE, WEAPON_EMP, WEAPON_DRONE_BAY];
        for (let i = 0; i < this.weaponSlots; i++) {
            const wt = weaponTypes[Math.floor(Math.random()*weaponTypes.length)];
            this.weapons.push(wt);
            this.weaponWarheads.push(wt === WEAPON_MISSILE ? null : null); // warhead 会由外部 init 替代（或 utils 中处理）
            this.shootCooldowns.push(0);
        }
        this.primaryWeapon = this.weapons[0];
        this.laserTarget = null;
        this.manualTarget = null;
        this.state = 'patrol';
        this.drones = []; // 无人机列表
        this.fireControlOverride = false; // 火控限制解锁状态
        this.autoAntiMissile = false; // 自动反导弹开关
        this.autoAntiDrone = false; // 自动反无人机开关
        this.autoAntiShip = false; // 自动反舰开关
        this.weaponEnabled = new Array(this.weaponSlots).fill(true); // 武器启用状态（接管模式下可控制）
    }

    applyForce(force){ this.acceleration.add(force); }

    seek(target) {
        const dx = target.x - this.position.x;
        const dy = target.y - this.position.y;
        const shortestDx = dx > (5000/2) ? dx - 5000 : (dx < -(5000/2) ? dx + 5000 : dx);
        const shortestDy = dy > (3000/2) ? dy - 3000 : (dy < -(3000/2) ? dy + 3000 : dy);
        const desired = new Vector(shortestDx, shortestDy);
        desired.setMag(this.maxSpeed);
        const steer = desired.clone().sub(this.velocity);
        steer.limit(MAX_FORCE);
        return steer;
    }

    separation(ships) {
        const steer = new Vector(0,0); let count = 0;
        for (const other of ships) {
            if (other === this) continue;
            const d = Math.sqrt(Math.pow(this.position.x - other.position.x,2) + Math.pow(this.position.y - other.position.y,2));
            if (d < SEPARATION_RADIUS) {
                const diff = new Vector(this.position.x - other.position.x, this.position.y - other.position.y);
                diff.div(d || 1);
                steer.add(diff); count++;
            }
        }
        if (count > 0) { steer.div(count); steer.setMag(this.maxSpeed); steer.sub(this.velocity); steer.limit(MAX_FORCE); }
        return steer;
    }

    alignment(ships) {
        const steer = new Vector(0,0); let count=0;
        for (const other of ships) {
            const d = Math.sqrt(Math.pow(this.position.x - other.position.x,2) + Math.pow(this.position.y - other.position.y,2));
            if (other !== this && other.fleet === this.fleet && d < PERCEPTION_RADIUS) {
                steer.add(other.velocity); count++;
            }
        }
        if (count>0) { steer.div(count); steer.setMag(this.maxSpeed); steer.sub(this.velocity); steer.limit(MAX_FORCE); }
        return steer;
    }

    cohesion(ships) {
        const centerOfMass = new Vector(0,0); let count=0;
        for (const other of ships) {
            const d = Math.sqrt(Math.pow(this.position.x - other.position.x,2) + Math.pow(this.position.y - other.position.y,2));
            if (other !== this && other.fleet === this.fleet && d < PERCEPTION_RADIUS) {
                centerOfMass.add(other.position); count++;
            }
        }
        if (count>0) { centerOfMass.div(count); return this.seek(centerOfMass); }
        return centerOfMass;
    }

    updateAI(ships, projectiles, inputs = null) {
        // 如果有手动输入，处理手动控制逻辑
        if (inputs) {
            if (inputs.up) this.velocity.y -= 0.15;
            if (inputs.down) this.velocity.y += 0.15;
            if (inputs.left) this.velocity.x -= 0.15;
            if (inputs.right) this.velocity.x += 0.15;

            this.velocity.limit(this.maxSpeed * 1.6);

            // 自动反舰：选取最近敌舰进行攻击
            if (this.autoAntiShip) {
                if (!(this.manualTarget && this.manualTarget.health > 0)){
                    let nearest = null; let nearestDist = Infinity;
                    for (const s of window.__allShips || []) {
                        if (s === this || s.fleet === this.fleet || s.health <= 0) continue;
                        const dx = Math.abs(this.position.x - s.position.x);
                        const dy = Math.abs(this.position.y - s.position.y);
                        const distanceX = Math.min(dx, 5000 - dx);
                        const distanceY = Math.min(dy, 3000 - dy);
                        const d = Math.hypot(distanceX, distanceY);
                        if (d < nearestDist) { nearestDist = d; nearest = s; }
                    }
                    if (nearest) {
                        this.manualTarget = nearest;
                    }
                }
                const idx = this._firstReadyWeaponIndex();
                if (idx !== -1) {
                    this.shoot(idx, this.manualTarget, projectiles);
                }
            }

            // 自动点防：所有武器可作为拦截器
            if (this.autoAntiMissile || this.autoAntiDrone) {
                let bestTarget = null; let bestDist = Infinity;
                for (const p of (window.__allProjectiles || [])) {
                    if (p.fleet === this.fleet) continue;
                    const isMissile = p.constructor && p.constructor.name === 'SeekingProjectile';
                    const isDrone = p.constructor && p.constructor.name === 'Drone';
                    if (!((isMissile && this.autoAntiMissile) || (isDrone && this.autoAntiDrone))) continue;
                    const dx = Math.abs(this.position.x - p.position.x);
                    const dy = Math.abs(this.position.y - p.position.y);
                    const distanceX = Math.min(dx, 5000 - dx);
                    const distanceY = Math.min(dy, 3000 - dy);
                    const d = Math.hypot(distanceX, distanceY);
                    if (d < bestDist) { bestDist = d; bestTarget = p; }
                }
                if (bestTarget) {
                    // 使用第一个就绪武器射击
                    const idx = this._firstReadyWeaponIndex();
                    if (idx !== -1) this.shoot(idx, bestTarget, projectiles);
                }
            }

            if (inputs.fire) {
                const idx = this._firstReadyWeaponIndex();
                if (idx !== -1) {
                    if (this.manualTarget && this.manualTarget.health > 0) {
                        this.shoot(idx, this.manualTarget, projectiles);
                    } else {
                        const fakeTarget = { position: new Vector(this.position.x + this.velocity.x * 10, this.position.y + this.velocity.y * 10), constructor:{name:'Fake'} };
                        this.shoot(idx, fakeTarget, projectiles);
                    }
                }
            }
            return; // 手动控制时不执行AI逻辑
        }

        // AI控制逻辑
        let closestEnemy = null; let minDistance = Infinity;
        for (const other of ships) {
            if (other.fleet !== this.fleet && other.health > 0) {
                const d = Math.sqrt(Math.pow(this.position.x - other.position.x,2) + Math.pow(this.position.y - other.position.y,2));
                if (d < minDistance) { minDistance = d; closestEnemy = other; }
            }
        }

        let closestMissile = null; let minMissileDistance = Infinity;
        let closestDrone = null; let minDroneDistance = Infinity;
        for (const p of projectiles) {
            if (p.fleet === this.fleet) continue;
            const d = Math.sqrt(Math.pow(this.position.x - p.position.x,2) + Math.pow(this.position.y - p.position.y,2));
            if (p.constructor.name === 'SeekingProjectile') {
                if (d < minMissileDistance && (p.health && p.health > 0)) { minMissileDistance = d; closestMissile = p; }

            } else if (p.constructor.name === 'Drone') {
                if (d < minDroneDistance && (p.health && p.health > 0)) { minDroneDistance = d; closestDrone = p; }
            }
        }

        if ((closestMissile && minMissileDistance < MISSILE_ENGAGEMENT_RADIUS) || (closestDrone && minDroneDistance < MISSILE_ENGAGEMENT_RADIUS)) {
            this.state = 'intercept';
        } else if (this.health < this.maxHealth/2 && closestEnemy) {
            this.state = 'flee';
        } else {
            const pwp = weaponProps[this.primaryWeapon];
            if (closestEnemy && minDistance < pwp.range) this.state = 'attack';
            else this.state = 'patrol';
        }

        const separation = this.separation(ships);
        const alignment = this.alignment(ships);
        const cohesion = this.cohesion(ships);

        separation.mult(SEPARATION_WEIGHT);
        alignment.mult(ALIGNMENT_WEIGHT);
        cohesion.mult(COHESION_WEIGHT);

        this.applyForce(separation);

        if (this.state === 'intercept') {
            // 选择最近的导弹或无人机作为拦截目标（优先最近目标）
            let pdTarget = null;
            if (closestMissile && minMissileDistance < MISSILE_ENGAGEMENT_RADIUS) pdTarget = closestMissile;
            if (closestDrone && minDroneDistance < MISSILE_ENGAGEMENT_RADIUS) {
                if (!pdTarget || minDroneDistance < minMissileDistance) pdTarget = closestDrone;
            }
            if (pdTarget) {
                const interceptForce = this.seek(pdTarget.position);
                interceptForce.mult(ATTACK_WEIGHT);
                this.applyForce(interceptForce);
                const idx = this._firstReadyWeaponIndex();
                if (idx !== -1) this.shoot(idx, pdTarget, projectiles);
            }
        } else if (this.state === 'attack' && closestEnemy) {
            let attackForce = new Vector(0,0);
            const pwp = weaponProps[this.primaryWeapon];
            if (this.primaryWeapon === WEAPON_PULSE_LASER || this.primaryWeapon === WEAPON_CONTINUOUS_LASER) {
                if (minDistance > pwp.range * 0.8) {
                    attackForce = this.seek(closestEnemy.position);
                } else if (minDistance < SEPARATION_RADIUS) {
                    const evade = new Vector(this.position.x - closestEnemy.position.x, this.position.y - closestEnemy.position.y);
                    evade.setMag(this.maxSpeed);
                    attackForce = new Vector(evade.x, evade.y); attackForce.sub(this.velocity); attackForce.limit(MAX_FORCE);
                } else {
                    attackForce = new Vector(0,0);
                }
            } else {
                if (minDistance > pwp.range * 0.9) {
                    attackForce = this.seek(closestEnemy.position);
                } else if (minDistance < pwp.range * 0.5) {
                    const evade = new Vector(this.position.x - closestEnemy.position.x, this.position.y - closestEnemy.position.y);
                    evade.setMag(this.maxSpeed);
                    attackForce = new Vector(evade.x, evade.y); attackForce.sub(this.velocity); attackForce.limit(MAX_FORCE);
                } else attackForce = new Vector(0,0);
            }
            attackForce.mult(ATTACK_WEIGHT);
            this.applyForce(attackForce);
            const idx = this._firstReadyWeaponIndex();
            if (idx !== -1) this.shoot(idx, closestEnemy, projectiles);
        } else if (this.state === 'flee' && closestEnemy) {
            const evade = new Vector(this.position.x - closestEnemy.position.x, this.position.y - closestEnemy.position.y);
            evade.setMag(this.maxSpeed);
            const steer = new Vector(evade.x, evade.y); steer.sub(this.velocity); steer.limit(MAX_FORCE);
            steer.mult(FLEE_WEIGHT);
            this.applyForce(steer);
        } else {
            this.applyForce(alignment);
            this.applyForce(cohesion);
        }
    }

    _firstReadyWeaponIndex() {
        for (let i=0;i<this.weapons.length;i++){
            // 在手动控制模式下，只返回启用的武器
            const isManual = window.camera && window.camera.manualControl && window.camera.trackedShip === this;
            if (isManual && !this.weaponEnabled[i]) continue;
            if (this.shootCooldowns[i] <= 0) return i;
        }
        return -1;
    }



    shoot(weaponIndex, target, projectiles) {
        if (weaponIndex < 0 || weaponIndex >= this.weapons.length) return;

        // 检查武器是否启用（在手动控制模式下）
        const isManual = window.camera && window.camera.manualControl && window.camera.trackedShip === this;
        if (isManual && !this.weaponEnabled[weaponIndex]) return;
        
        const wtype = this.weapons[weaponIndex];
        const props = weaponProps[wtype];
        if (this.shootCooldowns[weaponIndex] > 0) return;
        if (!target) return;

        // 检查能量和热量限制
        if (this.energy < props.energyCost) return;
        if (this.heat + props.heatGen > this.maxHeat * 0.9) return; // 防止过热
        if (this.empedUntil > 0 && !(wtype === WEAPON_COIL || wtype === WEAPON_RAPID_ENERGY)) return; // EMP 只影响非动能武器，速射动能与线圈炮可射击

        const dx = this.position.x - target.position.x;
        const dy = this.position.y - target.position.y;
        const distanceX = Math.min(Math.abs(dx), 5000 - Math.abs(dx));
        const distanceY = Math.min(Math.abs(dy), 3000 - Math.abs(dy));
        const distance = Math.sqrt(distanceX*distanceX + distanceY*distanceY);

        let rangeCheck = props.range;
        if (target.constructor.name === 'SeekingProjectile') rangeCheck = MISSILE_ENGAGEMENT_RADIUS;

        // 覆盖射程：接管模式下启用火控限制解锁
        const ignoreRange = this.fireControlOverride === true;

        // 激光武器（立即击中）
        if (wtype === WEAPON_PULSE_LASER || wtype === WEAPON_CONTINUOUS_LASER) {
            let didHit = false;
            if (ignoreRange || distance <= rangeCheck) {
                // 命中判定：有偏移概率
                let targetPoint = target.position.clone ? target.position.clone() : new Vector(target.position.x, target.position.y);
                if (ignoreRange) {
                    // 根据距离和武器类型引入随机偏移与角度误差
                    const baseMissProb = 0.35; // 基础偏移概率
                    const extraMissProb = Math.min(0.5, distance / (rangeCheck || 1) * 0.25);
                    const missProb = Math.max(0.25, baseMissProb + extraMissProb);
                    if (Math.random() < missProb) {
                        const offR = (10 + distance * 0.15) * (0.6 + Math.random()*0.8);
                        const offA = Math.random() * Math.PI * 2;
                        targetPoint = new Vector(targetPoint.x + Math.cos(offA)*offR, targetPoint.y + Math.sin(offA)*offR);
                    }
                }
                const dx2 = targetPoint.x - target.position.x;
                const dy2 = targetPoint.y - target.position.y;
                const dist2 = Math.hypot(dx2, dy2);
                const distanceAttenuation = Math.max(0.3, 1 - (rangeCheck ? Math.min(dist2, rangeCheck) / rangeCheck : 1));
                const actualDamage = props.damage * distanceAttenuation;
                // 只有当目标点确实是目标实体位置附近时才算命中
                if (target.health !== undefined && dist2 <= 12) {
                    target.health -= actualDamage;
                    didHit = true;
                }
                this.laserTarget = target && didHit ? target : null; // 只有命中才保留激光束

            } else {
                this.laserTarget = null;
            }
            this.shootCooldowns[weaponIndex] = props.cooldown;
            this.energy -= props.energyCost;
            this.heat += props.heatGen;
            return;
        }

        // EMP 武器特殊逻辑（直线飞行近炸）
        if (wtype === WEAPON_EMP) {
            if (ignoreRange || distance <= rangeCheck) {
                const newProjectile = new EMPProjectile(
                    this.position.x,
                    this.position.y,
                    0, 0,
                    this.fleet,
                    props.damage,
                    props.speed,
                    '#9900ff',
                    target // 传入目标对象
                );
                projectiles.push(newProjectile);
                this.shootCooldowns[weaponIndex] = props.cooldown;
                this.energy -= props.energyCost;
                this.heat += props.heatGen;
            }
            return;
        }

        // 无人机发射
        if (wtype === WEAPON_DRONE_BAY) {
            if (this.drones.length < 3) { // 每艘船最多3架无人机
                const angle = Math.random() * Math.PI * 2;
                const drone = new Drone(
                    this.position.x + Math.cos(angle) * 30,
                    this.position.y + Math.sin(angle) * 30,
                    this.fleet,
                    this
                );
                this.drones.push(drone);
                projectiles.push(drone);
                this.shootCooldowns[weaponIndex] = props.cooldown;
                this.energy -= props.energyCost;
                this.heat += props.heatGen;
            }
            return;
        }

        if (!ignoreRange && distance > rangeCheck) return;

        const shortestDx = dx > 5000/2 ? dx - 5000 : (dx < -5000/2 ? dx + 5000 : dx);
        const shortestDy = dy > 3000/2 ? dy - 3000 : (dy < -3000/2 ? dy + 3000 : dy);
        let desired = new Vector(-shortestDx, -shortestDy);

        // 在火控解锁下，发射方向加入角度偏差
        if (ignoreRange) {
            const angle = Math.atan2(desired.y, desired.x);
            const maxSpread = 0.18 + Math.min(0.6, distance / (rangeCheck || 200) * 0.12); // 距离越大越不准
            const spread = (Math.random() * 2 - 1) * maxSpread;
            const mag = desired.mag();
            desired = new Vector(Math.cos(angle + spread) * mag, Math.sin(angle + spread) * mag);
        }

        let newProjectile;
        switch (wtype) {
            case WEAPON_RAPID_ENERGY:
                newProjectile = new KineticProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed, '#00ff88');
                projectiles.push(newProjectile);
                break;
            case WEAPON_PDEF:
                newProjectile = new EnergyProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed, '#ffd7d7');
                projectiles.push(newProjectile);
                break;
            case WEAPON_COIL:
                newProjectile = new KineticProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed, '#ffdd00');
                projectiles.push(newProjectile);
                break;
            case WEAPON_MISSILE:
                const warhead = this.weaponWarheads[weaponIndex] || null;
                newProjectile = new SeekingProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed, '#ff00ff', target, warhead);
                projectiles.push(newProjectile);
                break;
            default:
                newProjectile = new KineticProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed || 30, '#ffffff');
                projectiles.push(newProjectile);
                break;
        }
        this.shootCooldowns[weaponIndex] = props.cooldown;
        this.energy -= props.energyCost;
        this.heat += props.heatGen;
    }

    update(timeScale) {
        // 武器冷却
        for (let i=0;i<this.shootCooldowns.length;i++){
            this.shootCooldowns[i] -= timeScale;
            if (this.shootCooldowns[i] < 0) this.shootCooldowns[i] = 0;
        }

        // EMP 效果
        if (this.empedUntil > 0) {
            this.empedUntil -= timeScale;
            if (this.empedUntil <= 0) this.jamming = false;
        }

        // 热量管理  
        this.heat -= HEAT_DISSIPATION_RATE * timeScale;
        if (this.heat < 0) this.heat = 0;
        if (this.heat >= this.maxHeat) {
            this.health -= OVERHEATING_DAMAGE * timeScale;
        }

        // 能量管理
        this.energy += ENERGY_REGEN_RATE * timeScale;
        if (this.energy > this.maxEnergy) this.energy = this.maxEnergy;

        // ΔV 管理（移动消耗）
        if (this.velocity.mag() > 0.1) {
            this.deltaV -= DELTA_V_CONSUMPTION_RATE * this.velocity.mag() * timeScale;
            if (this.deltaV < 0) this.deltaV = 0;
        }

        // 运动更新
        const prevVel = this.velocity.clone();
        const scaledAcceleration = this.acceleration.clone().mult(timeScale);
        this.velocity.add(scaledAcceleration);
        
        // ΔV 限制速度
        const maxSpeedByDeltaV = this.deltaV > 10 ? this.maxSpeed : this.maxSpeed * 1; // ΔV逻辑还没写好这样的（）
        this.velocity.limit(maxSpeedByDeltaV);

        // 限制角速度（转向角度变化）
        const prevAngle = Math.atan2(prevVel.y, prevVel.x);
        const newAngle = Math.atan2(this.velocity.y, this.velocity.x);
        let dAngle = newAngle - prevAngle;
        // 归一化到 [-PI, PI]
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        const maxAngular = MAX_ANGULAR_SPEED * timeScale;
        if (Math.abs(dAngle) > maxAngular) {
            const clampedAngle = prevAngle + Math.sign(dAngle) * maxAngular;
            const speedMag = this.velocity.mag();
            this.velocity.x = Math.cos(clampedAngle) * speedMag;
            this.velocity.y = Math.sin(clampedAngle) * speedMag;
        }
        
        const sv = this.velocity.clone().mult(timeScale); 
        this.position.add(sv);
        this.acceleration.mult(0);

        // 更新无人机
        for (let i = this.drones.length - 1; i >= 0; i--) {
            const drone = this.drones[i];
            if (drone.health <= 0 || drone.fuel <= 0) {
                this.drones.splice(i, 1);
            }
        }

        if (this.laserTarget) {
            const distance = Math.sqrt(Math.pow(this.position.x - this.laserTarget.position.x,2) + Math.pow(this.position.y - this.laserTarget.position.y,2));
            if (this.laserTarget.health <= 0 || distance > weaponProps[this.primaryWeapon].range) this.laserTarget = null;
        }

        this.primaryWeapon = this.weapons[0];
    }

    edges(GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT) {
        if (this.position.x > GAME_WORLD_WIDTH) this.position.x = 0;
        if (this.position.x < 0) this.position.x = GAME_WORLD_WIDTH;
        if (this.position.y > GAME_WORLD_HEIGHT) this.position.y = 0;
        if (this.position.y < 0) this.position.y = GAME_WORLD_HEIGHT;
    }

    draw(ctx, camera, canvas, SHIP_SIZE, particleColors){
        if (this.health <= 0) return;

        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        if (screenX < -SHIP_SIZE*camera.zoom || screenX > canvas.width + SHIP_SIZE*camera.zoom || screenY < -SHIP_SIZE*camera.zoom || screenY > canvas.height + SHIP_SIZE*camera.zoom) return;

        const isControlled = camera.manualControl && camera.trackedShip === this;

        const isTrackedThis = (camera.trackedShip === this);
        if (isTrackedThis) {
            for (let i=0;i<this.weapons.length;i++){
                const props = weaponProps[this.weapons[i]];
                const cooldown = this.shootCooldowns[i];
                const ratio = props.cooldown > 0 ? Math.max(0, Math.min(1, cooldown / props.cooldown)) : 0;
                const baseRadius = (this.weaponSlots + 1 + i) * 6 * camera.zoom;
                ctx.beginPath();
                ctx.arc(screenX, screenY, baseRadius, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.lineWidth = 2;
                ctx.stroke();
                const startAngle = -Math.PI/2;
                const endAngle = startAngle + (Math.PI*2) * (1 - ratio);
                ctx.beginPath();
                ctx.arc(screenX, screenY, baseRadius, startAngle, endAngle);
                ctx.strokeStyle = isControlled ? 'rgba(255,200,50,0.95)' : 'rgba(255,200,50,0.35)';
                ctx.lineWidth = 3 * camera.zoom;
                ctx.stroke();
            }
        }

        const primaryProps = weaponProps[this.primaryWeapon];
        if (isControlled && primaryProps) {
            // 绘制所有武器射程圈
            for (let i=0;i<this.weapons.length;i++){
                const props = weaponProps[this.weapons[i]];
                if (!props || !props.range) continue;
                ctx.beginPath();
                ctx.arc(screenX, screenY, props.range * camera.zoom, 0, Math.PI*2);
                const hue = 40 + (i * 30) % 300;
                ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.18)`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            // 主武器高亮
            ctx.beginPath();
            ctx.arc(screenX, screenY, primaryProps.range * camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = 'rgba(255,200,50,0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        if ((this.primaryWeapon === WEAPON_PULSE_LASER || this.primaryWeapon === WEAPON_CONTINUOUS_LASER) && this.laserTarget && this.laserTarget.health > 0) {
            const targetScreenX = (this.laserTarget.position.x - camera.x) * camera.zoom;
            const targetScreenY = (this.laserTarget.position.y - camera.y) * camera.zoom;
            const dx = this.laserTarget.position.x - this.position.x;
            const dy = this.laserTarget.position.y - this.position.y;
            const dist = Math.hypot(dx, dy);
            const maxRange = weaponProps[this.primaryWeapon].range;
            const t = Math.min(1, dist / maxRange);
            const alpha = Math.max(0.15, 1 - t); // 距离越远越透明
            const width = (this.primaryWeapon === WEAPON_PULSE_LASER ? 2.2 : 2.6) * camera.zoom * (1 - 0.4*t);
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(targetScreenX, targetScreenY);
            ctx.strokeStyle = this.primaryWeapon === WEAPON_PULSE_LASER ? '#00ff88' : '#00ff00';
            ctx.lineWidth = width;
            ctx.globalAlpha = alpha;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // 舰船图标绘制（替换原三角）
        const size = SHIP_SIZE * camera.zoom;
        const angle = Math.atan2(this.velocity.y, this.velocity.x);
        ctx.save();
        if (window.iconLoader && window.iconLoader.isLoaded && window.iconLoader.isLoaded()) {
            const typeKey = this.typeKey;
            const iconName = typeKey;
            const baseSize = SHIP_SIZE * 2; // 放大到更清晰
            const scaleByType = this.weaponSlots >= 5 ? 1.6 : this.weaponSlots === 4 ? 1.45 : this.weaponSlots === 3 ? 1.25 : this.weaponSlots === 2 ? 1.1 : 1.0;
            const iconW = baseSize * scaleByType * camera.zoom;
            const iconH = iconW; // 方形图标
            window.iconLoader.drawColoredIcon(ctx, iconName, screenX, screenY, iconW, iconH, this.color, angle);
        } else {
            // 退化为原三角形
            ctx.beginPath();
            ctx.translate(screenX, screenY);
            ctx.rotate(angle);
            ctx.moveTo(size,0);
            ctx.lineTo(-size, -size/2);
            ctx.lineTo(-size, size/2);
            ctx.closePath();
            ctx.fillStyle = this.color;
            ctx.fill();
        }
        ctx.restore();

        if (this.manualTarget && this.manualTarget.health > 0) {
            const tx = (this.manualTarget.position.x - camera.x) * camera.zoom;
            const ty = (this.manualTarget.position.y - camera.y) * camera.zoom;
            ctx.beginPath();
            ctx.arc(tx, ty, 12 * camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = 'rgba(255,0,0,0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = 'rgba(255,0,0,0.5)';
            ctx.lineWidth = 1 * camera.zoom;
            ctx.stroke();
        }

        const healthBarWidth = 16 * camera.zoom;
        const healthBarHeight = 2 * camera.zoom;
        const healthPercentage = Math.max(0, Math.min(1, this.health / this.maxHealth));
        const healthColor = healthPercentage > 0.6 ? 'lime' : healthPercentage > 0.3 ? 'yellow' : 'red';
        const barX = screenX - healthBarWidth/2;
        const barY = screenY + size + 2 * camera.zoom;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, healthBarWidth, healthBarHeight);
        ctx.fillStyle = healthColor;
        ctx.fillRect(barX, barY, healthBarWidth * healthPercentage, healthBarHeight);
    }
}