import { Vector } from './vector.js';
import { MAX_ANGULAR_SPEED, GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT, EMP_RANGE, AMMO_VOLUME_PER_SHOT, WEAPON_DRONE_BAY, DRONE_ATTACK_MUTI } from './constants.js';

// 粒子（特效）
export class Particle {
    constructor(x,y,color){
        this.position = new Vector(x,y);
        this.velocity = new Vector(Math.random()*4-2, Math.random()*4-2);
        this.life = 1;
        this.color = color;
    }
    update(timeScale){
        const v = this.velocity.clone().mult(timeScale);
        this.position.add(v);
        this.velocity.mult(0.92);
        this.life -= 0.04 * timeScale; // 更慢衰减，亮度更高
    }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        // 视口裁剪：超出屏幕一定边距则跳过
        const r = 3 * camera.zoom;
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        if (screenX < -r || screenX > cw + r || screenY < -r || screenY > ch + r) return;
        ctx.beginPath(); ctx.arc(screenX, screenY, 2.2 * camera.zoom, 0, Math.PI*2);
        ctx.fillStyle = this.color; ctx.globalAlpha = Math.min(1, this.life*1.2); ctx.fill(); ctx.globalAlpha = 1;
    }
    // 对象池（静态）
    static _pool = [];
    static obtain(x, y, color){
        const p = Particle._pool.pop() || new Particle(x,y,color);
        // 重置状态
        p.position.x = x; p.position.y = y;
        p.velocity.x = Math.random()*4-2; p.velocity.y = Math.random()*4-2;
        p.life = 1; p.color = color;
        return p;
    }
    static release(p){
        if (!p) return;
        // 限制池大小，防止无限增长
        if (Particle._pool.length < 2000) Particle._pool.push(p);
    }
}

// 基类：弹丸
export class Weapon {
    constructor(x,y,vx,vy,fleet,damage){
        this.position = new Vector(x,y);
        this.velocity = new Vector(vx,vy);
        this.fleet = fleet;
        this.damage = damage;
        this.alive = true;
    }
    update(timeScale){
        const v = this.velocity.clone().mult(timeScale);
        this.position.add(v);
        // 硬边界：弹丸越界则标记为死亡
        if (this.position.x < 0 || this.position.x > GAME_WORLD_WIDTH || this.position.y < 0 || this.position.y > GAME_WORLD_HEIGHT) {
            this.alive = false;
        }
    }
    isOffscreen(){ return !this.alive; }
    draw(){}
}

// 动能弹（方形）
export class KineticProjectile extends Weapon {
    constructor(x,y,vx,vy,fleet,damage,speed,color){
        super(x,y,vx,vy,fleet,damage);
        this.velocity.setMag(speed);
        this.color = color;
    }
    update(timeScale){
        super.update(timeScale);
    }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        const size = 4 * camera.zoom;
        ctx.fillStyle = this.color;
        ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
    }
}

// 追踪导弹（可带战斗部）
export class SeekingProjectile extends Weapon {
    constructor(x,y,vx,vy,fleet,damage,speed,color,target,warhead){
        super(x,y,vx,vy,fleet,damage);
        this.velocity.setMag(speed);
        this.color = color;
        this.target = target;
        this.maxSpeed = speed; // 保留作为期望速度参考
        this.maxAcceleration = 0.3; // 导弹的最大加速度
        this.acceleration = new Vector(0, 0); // 加速度向量
        this.deltaV = 600; // 使用ΔV替代燃料
        this.maxDeltaV = 600;
        this.warhead = warhead;
        this.health = 8; // 导弹血量较少，容易被激光摧毁
        this.maxHealth = 8;
        this.navConstant = 3.5; // 比例导引常数 N（典型范围 3~5）
    }
    
    applyForce(force) {
        this.acceleration.add(force);
    }
    
    update(ships, timeScale){
        if (!this.target || (this.target.health !== undefined && this.target.health <= 0) || (this.target.alive !== undefined && this.target.alive == false)) {

            let closest=null; let minD=Infinity;
            for (const o of ships) {
                if (o.fleet !== this.fleet && o.health > 0 && (this.target.alive == undefined || this.target.alive == true)) {
                    const dx = this.position.x - o.position.x;
                    const dy = this.position.y - o.position.y;
                    const d = Math.sqrt(dx*dx + dy*dy);
                    if (d < minD){ minD=d; closest=o; }
                }
            }
            this.target = closest;
        }
        
        // 寻路控制：比例导引（PN）
        if (this.target && this.target.health > 0) {
            const rx = this.target.position.x - this.position.x;
            const ry = this.target.position.y - this.position.y;
            const r2 = rx*rx + ry*ry;
            if (r2 > 1e-6) {
                const tvx = (this.target.velocity && typeof this.target.velocity.x === 'number') ? this.target.velocity.x : 0;
                const tvy = (this.target.velocity && typeof this.target.velocity.y === 'number') ? this.target.velocity.y : 0;
                const vrx = tvx - this.velocity.x;
                const vry = tvy - this.velocity.y;
                // 视线角速度 λ· = (r × v_rel) / |r|^2 （二维叉积标量）
                const lambdaDot = (rx * vry - ry * vrx) / r2;
                // 闭合速度 Vc = - (r · v_rel) / |r|
                const rMag = Math.sqrt(r2);
                const closing = -(rx * vrx + ry * vry) / (rMag || 1);
                const N = this.navConstant || 3.5;
                // 侧向加速度大小 a = N * Vc * |λ·|
                const aMag = Math.abs(N * closing * lambdaDot);
                // 法向单位向量（指向使导弹绕行方向与 λ· 符号一致）
                let nx = -ry / (rMag || 1);
                let ny =  rx / (rMag || 1);
                if (lambdaDot < 0) { nx = -nx; ny = -ny; }
                let ax = nx * aMag;
                let ay = ny * aMag;
                // 基本的追击分量，避免纯侧向导致不闭合
                const k_chase = 0.05; // 轻微比例追击
                ax += (rx / (rMag || 1)) * k_chase;
                ay += (ry / (rMag || 1)) * k_chase;
                const aVec = new Vector(ax, ay).limit(this.maxAcceleration);
                this.applyForce(aVec);
            }
        }
        
        // 加速度限制和ΔV消耗
        this.acceleration.limit(this.maxAcceleration);
        if (this.deltaV <= 0) {
            this.acceleration.mult(0);
        }
        
        // ΔV消耗（基于加速度大小）
        const accelMag = this.acceleration.mag();
        if (accelMag > 0) {
            this.deltaV -= 1.2 * accelMag * timeScale; // 导弹ΔV消耗更快
            if (this.deltaV < 0) this.deltaV = 0;
        }
        
        // 应用加速度到速度
        const scaledAcceleration = this.acceleration.clone().mult(timeScale);
        this.velocity.add(scaledAcceleration);
        
        // 位置更新
        const sv = this.velocity.clone().mult(timeScale);
        this.position.add(sv);
        
        // 重置加速度
        this.acceleration.mult(0);

        if (this.position.x > GAME_WORLD_WIDTH) {
            this.position.x = GAME_WORLD_WIDTH;
            this.velocity.x = 0; // 反弹并减速
        }
        if (this.position.x < 0) {
            this.position.x = 0;
            this.velocity.x = 0; // 反弹并减速
        }
        if (this.position.y > GAME_WORLD_HEIGHT) {
            this.position.y = GAME_WORLD_HEIGHT;
            this.velocity.y = 0; // 反弹并减速
        }
        if (this.position.y < 0) {
            this.position.y = 0;
            this.velocity.y = 0; // 反弹并减速
        }
        // ΔV耗尽时自毁
        if (this.deltaV <= 0) {
            this.health = 0;
            this.alive = false;
        }
    }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        const angle = Math.atan2(this.velocity.y, this.velocity.x);
        const baseSize = 5 * camera.zoom; // 比飞船略小
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        const margin = baseSize * 4;
        if (screenX < -margin || screenX > cw + margin || screenY < -margin || screenY > ch + margin) return;
        if (window.iconLoader && window.iconLoader.isLoaded && window.iconLoader.isLoaded()) {
            const iconW = baseSize * 6.0; // 调整到合适可见
            const iconH = iconW;
            window.iconLoader.drawColoredIcon(ctx, 'missile', screenX, screenY, iconW, iconH, this.color, angle);
        } else {
            ctx.fillStyle = this.color;
            const size = 6 * camera.zoom;
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(size,0);
            ctx.lineTo(-size,-size/2);
            ctx.lineTo(-size,size/2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        // ΔV条（替代燃料条）
        const deltaVPercent = this.deltaV / this.maxDeltaV;
        const barWidth = 8 * camera.zoom;
        const barHeight = 1 * camera.zoom;
        const barX = screenX - barWidth/2;
        const barY = screenY + baseSize + 2 * camera.zoom;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = deltaVPercent > 0.3 ? '#0099ff' : '#ff9900';
        ctx.fillRect(barX, barY, barWidth * deltaVPercent, barHeight);

        // 血量条（在ΔV条下方）
        const healthPercent = Math.max(0, this.health / this.maxHealth); 
        const healthY = barY + barHeight + 1 * camera.zoom; // 往下偏移一点
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, healthY, barWidth, barHeight);
        ctx.fillStyle = healthPercent > 0.5 ? '#00cc44' : '#ff3333';
        ctx.fillRect(barX, healthY, barWidth * healthPercent, barHeight);
    }
}

// 能量弹（球形）
export class EnergyProjectile extends KineticProjectile {
    constructor(x,y,vx,vy,fleet,damage,speed,color){ super(x,y,vx,vy,fleet,damage,speed,color); }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        const size = 3 * camera.zoom;
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        const margin = size * 3;
        if (screenX < -margin || screenX > cw + margin || screenY < -margin || screenY > ch + margin) return;
        ctx.beginPath(); ctx.arc(screenX, screenY, size, 0, Math.PI*2);
        ctx.fillStyle = this.color; ctx.fill();
    }
}

// EMP 武器（电磁脉冲）
export class EMPProjectile extends Weapon {
    constructor(x, y, vx, vy, fleet, damage, speed, color, target) {
        super(x, y, vx, vy, fleet, damage);
        this.color = color || '#9900ff';
        this.target = target;
        this.speed = speed;
        this.lifespan = 500; // 最大飞行时间（帧）
        this.activated = false;
        this.range = EMP_RANGE; // EMP 影响范围
        this.proximityRange = Math.min(30, EMP_RANGE * 0.3); // 近炸感应范围
        
        // 设置初速为对目标的提前量解算
        if (target) {
            const rx = target.position.x - x;
            const ry = target.position.y - y;
            const tvx = (target.velocity && typeof target.velocity.x === 'number') ? target.velocity.x : 0;
            const tvy = (target.velocity && typeof target.velocity.y === 'number') ? target.velocity.y : 0;
            const s = this.speed || 0;
            const a = tvx*tvx + tvy*tvy - s*s;
            const b = 2 * (rx*tvx + ry*tvy);
            const c = rx*rx + ry*ry;
            let tLead;
            if (Math.abs(a) < 1e-6) {
                tLead = (Math.abs(b) < 1e-6) ? Infinity : (-c / b);
            } else {
                const disc = b*b - 4*a*c;
                if (disc < 0) {
                    tLead = Infinity;
                } else {
                    const sd = Math.sqrt(disc);
                    const t1 = (-b - sd) / (2*a);
                    const t2 = (-b + sd) / (2*a);
                    tLead = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
                }
            }
            const aimX = isFinite(tLead) ? (rx + tvx * tLead) : rx;
            const aimY = isFinite(tLead) ? (ry + tvy * tLead) : ry;
            this.velocity = new Vector(aimX, aimY);
            this.velocity.setMag(this.speed);
        } else {
            this.velocity = new Vector(0, 0);
        }
    }

    update(timeScale) {
        super.update()
        // 如果已激活或没有目标，停止运动
        if (this.activated || !this.target) {
            this.lifespan -= timeScale;
            return;
        }
        
        // 检查目标是否仍然存活
        if (this.target.health <= 0) {
            this.activated = true;
            return;
        }
        
        // 计算与目标的距离
        const dx = this.target.position.x - this.position.x;
        const dy = this.target.position.y - this.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // 近炸判定：接近目标或燃料耗尽时激活
        if (distance <= this.proximityRange || this.lifespan <= 0) {
            this.activated = true;
            return;
        }
        
        // 继续朝目标飞行
        const v = this.velocity.clone().mult(timeScale);
        this.position.add(v);
        this.lifespan -= timeScale;
    }
    
    draw(ctx, camera) {
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        const margin = this.range * camera.zoom + 5;
        if (screenX < -margin || screenX > cw + margin || screenY < -margin || screenY > ch + margin) return;
        
        if (!this.activated) {
            // 飞行阶段显示为紫色球体
            const size = 4 * camera.zoom;
            ctx.beginPath();
            ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.globalAlpha = 0.8;
            ctx.fill();
            ctx.globalAlpha = 1;
            
            // 添加拖尾效果
            ctx.beginPath();
            ctx.arc(screenX, screenY, size * 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.3;
            ctx.stroke();
            ctx.globalAlpha = 1;
        } else {
            // 爆炸效果
            const size = this.range * camera.zoom;
            ctx.beginPath();
            ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.3;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
    
    isOffscreen() {
        return this.activated && this.lifespan < -30; // EMP 爆炸后清理
    }
}

// 无人机
export class Drone extends Weapon {
    constructor(x, y, fleet, motherShip) {
        super(x, y, 0, 0, fleet, 15); // 无人机基础伤害
        this.motherShip = motherShip;
        this.health = 20;
        this.maxHealth = 20;
        this.deltaV = 800; // 使用ΔV替代燃料
        this.maxDeltaV = 800;
        this.maxSpeed = 1.5; // 仅作期望速度参考
        this.maxAcceleration = 0.20;
        this.acceleration = new Vector(0, 0);
        this.target = null;
        this.state = 'patrol'; // patrol, attack, return
        this.attackCooldown = 0;
        this.size = 3;                    // 平滑系数（越小越平滑
       
        this.angle = Math.random() * Math.PI * 2;
        this.radius = 15 + Math.random() * 5;
        this.formationOffset = new Vector(Math.cos(this.angle) * this.radius, Math.sin(this.angle) * this.radius);

    }
    
    applyForce(force) { this.acceleration.add(force); }
    
    update(ships, timeScale) {
        this.attackCooldown -= timeScale;
        if (this.attackCooldown < 0) this.attackCooldown = 0;
        
        // 失去目标则搜索
        if (!this.target || this.target.health <= 0) {
            let closest = null;
            let minDist = Infinity;
            for (const ship of ships) {
                if (ship.fleet !== this.fleet && ship.health > 0) {
                    const dist = Math.hypot(this.position.x - ship.position.x, this.position.y - ship.position.y);
                    if (dist < 200 && dist < minDist) { minDist = dist; closest = ship; }
                }
            }
            this.target = closest;
        }
        
        let desired = new Vector(0, 0);
        
        if (this.deltaV <= 0) {
            this.health = 0;
            this.alive = false;
            return;
        }
        
        for (const drone of this.motherShip.drones) {
            if (drone != this && this.position.clone().sub(drone.position).mag() < 5) {
                this.applyForce(this.position.clone().sub(drone.position).setMag(1).mult(0.01));
            }
        }

        if (this.deltaV < this.maxDeltaV * 0.5 || !this.motherShip || this.motherShip.health <= 0) {
            // 返回母舰或自毁
            this.state = 'return';
            if (this.motherShip && this.motherShip.health > 0) {
                desired = new Vector(
                    this.motherShip.position.x - this.position.x,
                    this.motherShip.position.y - this.position.y
                );
                if (desired.mag() < 5) {
                    this.motherShip.ammoVolume = Math.min(this.motherShip.ammoVolume + AMMO_VOLUME_PER_SHOT[WEAPON_DRONE_BAY], this.motherShip.ammoCapacity);
                    this.health = 0;
                    this.alive = false;
                }

                // 参考母舰速度
                if (this.motherShip.velocity) {
                    desired.add(this.motherShip.velocity);
                }
                desired.setMag(this.motherShip.velocity.mag() + this.maxSpeed);

            } else {
                this.health = 0; // 母舰已毁，自毁
                this.alive = false;
            }
        } else if (this.target && this.target.health > 0) {
            // 攻击模式
            this.state = 'attack';
            const dist = Math.hypot(this.position.x - this.target.position.x, this.position.y - this.target.position.y);
            if (dist < 30 && this.attackCooldown <= 0) {
                // 攻击目标
                this.target.health -= 0.1;
                this.attackCooldown = 20;
            }
            desired = new Vector(
                this.target.position.x - this.position.x,
                this.target.position.y - this.position.y
            );
            // 参考目标速度
            if (this.target.velocity) {
                desired.add(new Vector(this.target.velocity.x * DRONE_ATTACK_MUTI, this.target.velocity.y * DRONE_ATTACK_MUTI));
            }
            desired.setMag(this.target.velocity.mag() + this.maxSpeed);
        } else {
            // ---- 固定编队跟随模式 ----
            this.state = 'patrol';
            this.angle += 0.02 * timeScale;
            this.formationOffset = new Vector(Math.cos(this.angle) * this.radius, Math.sin(this.angle) * this.radius);

            if (!this.motherShip || this.motherShip.health <= 0) {
                this.health = 0; // 没有母舰就自毁
            } else {
                // 目标点 = 母舰位置 + 固定偏移
                const targetPos = this.motherShip.position.clone().add(this.formationOffset);

                // 母舰速度分量
                const motherVel = this.motherShip.velocity ? this.motherShip.velocity.clone() : new Vector(0, 0);

                // 指向编队点的矫正速度
                const toFormation = targetPos.clone().sub(this.position);

                // 最终期望速度 = 母舰速度 + 矫正速度
                desired = motherVel.clone().add(toFormation);
            }
        }


        
        // 由期望速度计算转向力，但用加速度限制
        const steer = desired.clone().sub(this.velocity);
        steer.limit(this.maxAcceleration);
        this.applyForce(steer);
        
        // 加速度限幅与ΔV消耗
        this.acceleration.limit(this.maxAcceleration);
        const accelMag = this.acceleration.mag();
        if (accelMag > 0) {
            this.deltaV -= 0.8 * accelMag * timeScale;
            if (this.deltaV < 0) this.deltaV = 0;
        }

        const prevVel = this.velocity.clone();
        // 应用加速度
        this.velocity.add(this.acceleration.clone().mult(timeScale));
        
        // 更新位置
        this.position.add(this.velocity.clone().mult(timeScale));

        // 限制角速度（转向角度变化）
        const prevAngle = Math.atan2(prevVel.y, prevVel.x);
        const newAngle = Math.atan2(this.velocity.y, this.velocity.x);
        let dAngle = newAngle - prevAngle;
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        const maxAngular = 50 * MAX_ANGULAR_SPEED * timeScale;

        if (Math.abs(dAngle) > maxAngular) {
            const clampedAngle = prevAngle + Math.sign(dAngle) * maxAngular;
            const speedMag = this.velocity.mag();
            this.velocity.x = Math.cos(clampedAngle) * speedMag;
            this.velocity.y = Math.sin(clampedAngle) * speedMag;
        }
        const sv = this.velocity.clone().mult(timeScale);
        this.position.add(sv);

        // 重置加速度
        this.acceleration.mult(0);
        
        if (this.position.x > GAME_WORLD_WIDTH) {
            this.position.x = GAME_WORLD_WIDTH;
            this.velocity.x = 0; // 反弹并减速
        }
        if (this.position.x < 0) {
            this.position.x = 0;
            this.velocity.x = 0; // 反弹并减速
        }
        if (this.position.y > GAME_WORLD_HEIGHT) {
            this.position.y = GAME_WORLD_HEIGHT;
            this.velocity.y = 0; // 反弹并减速
        }
        if (this.position.y < 0) {
            this.position.y = 0;
            this.velocity.y = 0; // 反弹并减速
        }
    }
    
    draw(ctx, camera) {
        if (this.health <= 0) return;
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        const angle = Math.atan2(this.velocity.y, this.velocity.x);
        const baseSize = this.size * camera.zoom;
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        const margin = baseSize * 4;
        if (screenX < -margin || screenX > cw + margin || screenY < -margin || screenY > ch + margin) return;
        if (window.iconLoader && window.iconLoader.isLoaded && window.iconLoader.isLoaded()) {
            const iconW = baseSize * 6.0; // 无人机图标略小
            const iconH = iconW;
            // 状态颜色：在主色调基础上微调
            let color = '#66ff66';
            if (this.state === 'attack') color = '#ff6666';
            else if (this.state === 'return') color = '#ffff66';
            window.iconLoader.drawColoredIcon(ctx, 'drone', screenX, screenY, iconW, iconH, color, angle);
        } else {
            // 退化为三角形
            const size = baseSize;
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(size, 0);
            ctx.lineTo(-size, -size/2);
            ctx.lineTo(-size, size/2);
            ctx.closePath();
            if (this.state === 'attack') ctx.fillStyle = '#ff6666';
            else if (this.state === 'return') ctx.fillStyle = '#ffff66';
            else ctx.fillStyle = '#66ff66';
            ctx.fill();
            ctx.restore();
        }
        
        // ΔV条
        const dvPercent = this.deltaV / this.maxDeltaV;
        const barWidth = 8 * camera.zoom;
        const barHeight = 1 * camera.zoom;
        const barX = screenX - barWidth/2;
        const barY = screenY + baseSize + 2 * camera.zoom;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = dvPercent > 0.3 ? '#0099ff' : '#ff9900';
        ctx.fillRect(barX, barY, barWidth * dvPercent, barHeight);

        // 血量条（在ΔV条下方）
        const healthPercent = Math.max(0, this.health / this.maxHealth); 
        const healthY = barY + barHeight + 1 * camera.zoom; // 往下偏移一点
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, healthY, barWidth, barHeight);
        ctx.fillStyle = healthPercent > 0.5 ? '#00cc44' : '#ff3333';
        ctx.fillRect(barX, healthY, barWidth * healthPercent, barHeight);
    }
    
    isOffscreen() {
        return this.health <= 0 || this.deltaV <= 0;
    }
}
