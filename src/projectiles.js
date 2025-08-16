import { Vector } from './vector.js';
import { GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT, EMP_RANGE } from './constants.js';

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
    }
    update(timeScale){ const v = this.velocity.clone().mult(timeScale); this.position.add(v); }
    isOffscreen(){ return this.position.x < -10 || this.position.x > GAME_WORLD_WIDTH + 10 || this.position.y < -10 || this.position.y > GAME_WORLD_HEIGHT + 10; }
    draw(){}
}

// 动能弹（方形）
export class KineticProjectile extends Weapon {
    constructor(x,y,vx,vy,fleet,damage,speed,color){
        super(x,y,vx,vy,fleet,damage);
        this.velocity.setMag(speed);
        this.color = color;
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
        this.maxSpeed = speed;
        this.maxForce = 0.1;
        this.fuel = 300;
        this.warhead = warhead;
        this.health = 8; // 导弹血量较少，容易被激光摧毁
        this.maxHealth = 8;
    }
    update(ships, timeScale){
        if (!this.target || (this.target.health !== undefined && this.target.health <= 0)) {
            let closest=null; let minD=Infinity;
            for (const o of ships) {
                if (o.fleet !== this.fleet && o.health > 0) {
                    const dx = Math.abs(this.position.x - o.position.x), dy = Math.abs(this.position.y - o.position.y);
                    const d = Math.sqrt(Math.min(dx,GAME_WORLD_WIDTH-dx)**2 + Math.min(dy,GAME_WORLD_HEIGHT-dy)**2);
                    if (d < minD){ minD=d; closest=o; }
                }
            }
            this.target = closest;
        }
        if (this.target && this.target.health > 0) {
            const dx = this.target.position.x - this.position.x;
            const dy = this.target.position.y - this.position.y;
            const shortestDx = dx > GAME_WORLD_WIDTH/2 ? dx - GAME_WORLD_WIDTH : (dx < -GAME_WORLD_WIDTH/2 ? dx + GAME_WORLD_WIDTH : dx);
            const shortestDy = dy > GAME_WORLD_HEIGHT/2 ? dy - GAME_WORLD_HEIGHT : (dy < -GAME_WORLD_HEIGHT/2 ? dy + GAME_WORLD_HEIGHT : dy);
            const desired = new Vector(shortestDx, shortestDy);
            desired.setMag(this.maxSpeed);
            const steer = desired.clone().sub(this.velocity);
            steer.limit(this.maxForce);
            this.velocity.add(steer); this.velocity.limit(this.maxSpeed);
        }
        const sv = this.velocity.clone().mult(timeScale);
        this.position.add(sv);
        this.fuel -= timeScale;
        if (this.fuel <= 0) {
            this.health = 0;
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
                // 燃料条
        const fuelPercent = this.fuel / 300;
        const barWidth = 8 * camera.zoom;
        const barHeight = 1 * camera.zoom;
        const barX = screenX - barWidth/2;
        const barY = screenY + baseSize + 2 * camera.zoom;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = fuelPercent > 0.3 ? '#0099ff' : '#ff9900';
        ctx.fillRect(barX, barY, barWidth * fuelPercent, barHeight);

        // 血量条（在燃料条下方）
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
        
        // 设置初始速度朝向目标
        if (target) {
            const dx = target.position.x - x;
            const dy = target.position.y - y;
            this.velocity = new Vector(dx, dy);
            this.velocity.setMag(this.speed);
        } else {
            this.velocity = new Vector(0, 0);
        }
    }

    update(timeScale) {
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
        this.fuel = 600; // 燃料限制
        this.maxSpeed = 3.5;
        this.maxForce = 0.08;
        this.target = null;
        this.state = 'patrol'; // patrol, attack, return
        this.orbitAngle = Math.random() * Math.PI * 2;
        this.orbitRadius = 60 + Math.random() * 40;
        this.attackCooldown = 0;
        this.size = 3;
    }
    
    update(ships, timeScale) {
        this.fuel -= timeScale;
        this.attackCooldown -= timeScale;
        if (this.attackCooldown < 0) this.attackCooldown = 0;
        
        // 寻找目标
        if (!this.target || this.target.health <= 0) {
            let closest = null;
            let minDist = Infinity;
            for (const ship of ships) {
                if (ship.fleet !== this.fleet && ship.health > 0) {
                    const dist = Math.sqrt(
                        Math.pow(this.position.x - ship.position.x, 2) + 
                        Math.pow(this.position.y - ship.position.y, 2)
                    );
                    if (dist < 200 && dist < minDist) {
                        minDist = dist;
                        closest = ship;
                    }
                }
            }
            this.target = closest;
        }
        
        let desired = new Vector(0, 0);

        if (this.fuel <= 0) {
            this.health = 0;
        }

        if (this.fuel < 300 || !this.motherShip || this.motherShip.health <= 0) {
            // 返回母舰或自毁
            this.state = 'return';
            if (this.motherShip && this.motherShip.health > 0) {
                desired = new Vector(
                    this.motherShip.position.x - this.position.x,
                    this.motherShip.position.y - this.position.y
                );
                desired.setMag(this.maxSpeed);
            } else {
                this.health = 0; // 母舰已毁，自毁
            }
        } else if (this.target && this.target.health > 0) {
            // 攻击模式
            this.state = 'attack';
            const dist = Math.sqrt(
                Math.pow(this.position.x - this.target.position.x, 2) + 
                Math.pow(this.position.y - this.target.position.y, 2)
            );
            
            if (dist < 30 && this.attackCooldown <= 0) {
                // 攻击目标
                this.target.health -= this.damage;
                this.attackCooldown = 20;
                this.health -= 5; // 撞击伤害
            }
            
            desired = new Vector(
                this.target.position.x - this.position.x,
                this.target.position.y - this.position.y
            );
            desired.setMag(this.maxSpeed);
        } else {
            // 巡逻模式 - 围绕母舰盘旋
            this.state = 'patrol';
            this.orbitAngle += 0.02 * timeScale;
            const orbitX = this.motherShip.position.x + Math.cos(this.orbitAngle) * this.orbitRadius;
            const orbitY = this.motherShip.position.y + Math.sin(this.orbitAngle) * this.orbitRadius;
            
            desired = new Vector(orbitX - this.position.x, orbitY - this.position.y);
            desired.setMag(this.maxSpeed);
        }
        
        // 应用运动
        const steer = desired.clone().sub(this.velocity);
        steer.limit(this.maxForce);
        this.velocity.add(steer.clone().mult(timeScale));
        this.velocity.limit(this.maxSpeed);
        
        const movement = this.velocity.clone().mult(timeScale);
        this.position.add(movement);
        
        // 边界处理
        if (this.position.x < 0) this.position.x = GAME_WORLD_WIDTH;
        if (this.position.x > GAME_WORLD_WIDTH) this.position.x = 0;
        if (this.position.y < 0) this.position.y = GAME_WORLD_HEIGHT;
        if (this.position.y > GAME_WORLD_HEIGHT) this.position.y = 0;
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
        
        // 燃料条
        const fuelPercent = this.fuel / 600;
        const barWidth = 8 * camera.zoom;
        const barHeight = 1 * camera.zoom;
        const barX = screenX - barWidth/2;
        const barY = screenY + baseSize + 2 * camera.zoom;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = fuelPercent > 0.3 ? '#0099ff' : '#ff9900';
        ctx.fillRect(barX, barY, barWidth * fuelPercent, barHeight);

        // 血量条（在燃料条下方）
        const healthPercent = Math.max(0, this.health / this.maxHealth); 
        const healthY = barY + barHeight + 1 * camera.zoom; // 往下偏移一点
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, healthY, barWidth, barHeight);
        ctx.fillStyle = healthPercent > 0.5 ? '#00cc44' : '#ff3333';
        ctx.fillRect(barX, healthY, barWidth * healthPercent, barHeight);
    }
    
    isOffscreen() {
        return this.health <= 0 || this.fuel <= 0;
    }
}
