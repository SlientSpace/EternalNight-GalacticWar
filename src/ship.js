import { Vector } from './vector.js';
import { weaponProps, WEAPON_PULSE_LASER, WEAPON_CONTINUOUS_LASER, WEAPON_RAPID_ENERGY, WEAPON_PDEF, WEAPON_COIL, WEAPON_MISSILE, shipTypes, fleetColors } from './constants.js';
import { EnergyProjectile, KineticProjectile, SeekingProjectile } from './projectiles.js';
import { MAX_FORCE, PERCEPTION_RADIUS, SEPARATION_RADIUS, SEPARATION_WEIGHT, ALIGNMENT_WEIGHT, COHESION_WEIGHT, ATTACK_WEIGHT, FLEE_WEIGHT, MISSILE_ENGAGEMENT_RADIUS } from './constants.js';

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

        // 武器槽：随机分配（并为导弹分配战斗部）
        this.weapons = [];
        this.weaponWarheads = [];
        this.shootCooldowns = [];
        const weaponTypes = [WEAPON_PULSE_LASER, WEAPON_CONTINUOUS_LASER, WEAPON_RAPID_ENERGY, WEAPON_PDEF, WEAPON_COIL, WEAPON_MISSILE];
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

    updateAI(ships, projectiles) {
        let closestEnemy = null; let minDistance = Infinity;
        for (const other of ships) {
            if (other.fleet !== this.fleet && other.health > 0) {
                const d = Math.sqrt(Math.pow(this.position.x - other.position.x,2) + Math.pow(this.position.y - other.position.y,2));
                if (d < minDistance) { minDistance = d; closestEnemy = other; }
            }
        }

        let closestMissile = null; let minMissileDistance = Infinity;
        for (const p of projectiles) {
            if (p.fleet !== this.fleet && p.constructor.name === 'SeekingProjectile') {
                const d = Math.sqrt(Math.pow(this.position.x - p.position.x,2) + Math.pow(this.position.y - p.position.y,2));
                if (d < minMissileDistance) { minMissileDistance = d; closestMissile = p; }
            }
        }

        if (this.health < this.maxHealth/2 && closestEnemy) {
            this.state = 'flee';
        } else if (closestMissile && minMissileDistance < MISSILE_ENGAGEMENT_RADIUS) {
            this.state = 'intercept';
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

        if (this.state === 'intercept' && closestMissile) {
            const interceptForce = this.seek(closestMissile.position);
            interceptForce.mult(ATTACK_WEIGHT);
            this.applyForce(interceptForce);
            const idx = this._firstReadyWeaponIndex();
            if (idx !== -1) this.shoot(idx, closestMissile, projectiles);
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
            if (this.shootCooldowns[i] <= 0) return i;
        }
        return -1;
    }

    controlUpdate(inputs, projectiles) {
        if (inputs.up) this.velocity.y -= 0.15;
        if (inputs.down) this.velocity.y += 0.15;
        if (inputs.left) this.velocity.x -= 0.15;
        if (inputs.right) this.velocity.x += 0.15;

        this.velocity.limit(this.maxSpeed * 1.6);

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
    }

    shoot(weaponIndex, target, projectiles) {
        if (weaponIndex < 0 || weaponIndex >= this.weapons.length) return;
        const wtype = this.weapons[weaponIndex];
        const props = weaponProps[wtype];
        if (this.shootCooldowns[weaponIndex] > 0) return;
        if (!target) return;

        const dx = this.position.x - target.position.x;
        const dy = this.position.y - target.position.y;
        const distanceX = Math.min(Math.abs(dx), 5000 - Math.abs(dx));
        const distanceY = Math.min(Math.abs(dy), 3000 - Math.abs(dy));
        const distance = Math.sqrt(distanceX*distanceX + distanceY*distanceY);

        let rangeCheck = props.range;
        if (target.constructor.name === 'SeekingProjectile') rangeCheck = MISSILE_ENGAGEMENT_RADIUS;

        // 激光直接命中
        if (wtype === WEAPON_PULSE_LASER || wtype === WEAPON_CONTINUOUS_LASER) {
            if (distance <= rangeCheck) {
                if (target.health !== undefined) target.health -= props.damage;
                this.laserTarget = target;
            } else {
                this.laserTarget = null;
            }
            this.shootCooldowns[weaponIndex] = props.cooldown;
            return;
        }

        if (distance > rangeCheck) return;

        const shortestDx = dx > 5000/2 ? dx - 5000 : (dx < -5000/2 ? dx + 5000 : dx);
        const shortestDy = dy > 3000/2 ? dy - 3000 : (dy < -3000/2 ? dy + 3000 : dy);
        const desired = new Vector(-shortestDx, -shortestDy);

        let newProjectile;
        switch (wtype) {
            case WEAPON_RAPID_ENERGY:
                newProjectile = new EnergyProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed, '#aaffff');
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
                // fallback
                newProjectile = new KineticProjectile(this.position.x, this.position.y, desired.x, desired.y, this.fleet, props.damage, props.speed || 30, '#ffffff');
                projectiles.push(newProjectile);
                break;
        }
        this.shootCooldowns[weaponIndex] = props.cooldown;
    }

    update(timeScale) {
        for (let i=0;i<this.shootCooldowns.length;i++){
            this.shootCooldowns[i] -= timeScale;
            if (this.shootCooldowns[i] < 0) this.shootCooldowns[i] = 0;
        }

        const scaledAcceleration = this.acceleration.clone().mult(timeScale);
        this.velocity.add(scaledAcceleration);
        this.velocity.limit(this.maxSpeed);
        const sv = this.velocity.clone().mult(timeScale); this.position.add(sv);
        this.acceleration.mult(0);

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
            ctx.beginPath();
            ctx.arc(screenX, screenY, primaryProps.range * camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = 'rgba(255,200,50,0.25)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        if ((this.primaryWeapon === WEAPON_PULSE_LASER || this.primaryWeapon === WEAPON_CONTINUOUS_LASER) && this.laserTarget && this.laserTarget.health > 0) {
            const targetScreenX = (this.laserTarget.position.x - camera.x) * camera.zoom;
            const targetScreenY = (this.laserTarget.position.y - camera.y) * camera.zoom;
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(targetScreenX, targetScreenY);
            ctx.strokeStyle = this.primaryWeapon === WEAPON_PULSE_LASER ? '#00ff88' : '#00ff00';
            ctx.lineWidth = 2 * camera.zoom;
            ctx.stroke();
        }

        // 舰船三角体
        ctx.beginPath();
        const size = SHIP_SIZE * camera.zoom;
        const angle = Math.atan2(this.velocity.y, this.velocity.x);
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(angle);
        ctx.moveTo(size,0);
        ctx.lineTo(-size, -size/2);
        ctx.lineTo(-size, size/2);
        ctx.closePath();
        ctx.fillStyle = this.color;
        ctx.fill();
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
