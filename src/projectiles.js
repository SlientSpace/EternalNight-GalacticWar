import { Vector } from './vector.js';
import { GAME_WORLD_WIDTH, GAME_WORLD_HEIGHT } from './constants.js';

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
        this.velocity.mult(0.95);
        this.life -= 0.05 * timeScale;
    }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        ctx.beginPath(); ctx.arc(screenX, screenY, 2 * camera.zoom, 0, Math.PI*2);
        ctx.fillStyle = this.color; ctx.globalAlpha = this.life; ctx.fill(); ctx.globalAlpha = 1;
    }
}

// Weapon 基类
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
        this.fuel = 200;
        this.warhead = warhead;
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
    }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        ctx.fillStyle = this.color;
        const size = 6 * camera.zoom;
        const angle = Math.atan2(this.velocity.y, this.velocity.x);
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
}

// 能量弹（球形）
export class EnergyProjectile extends KineticProjectile {
    constructor(x,y,vx,vy,fleet,damage,speed,color){ super(x,y,vx,vy,fleet,damage,speed,color); }
    draw(ctx, camera){
        const screenX = (this.position.x - camera.x) * camera.zoom;
        const screenY = (this.position.y - camera.y) * camera.zoom;
        const size = 3 * camera.zoom;
        ctx.beginPath(); ctx.arc(screenX, screenY, size, 0, Math.PI*2);
        ctx.fillStyle = this.color; ctx.fill();
    }
}
