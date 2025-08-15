export class Vector {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    add(o){ this.x += o.x; this.y += o.y; return this; }
    sub(o){ this.x -= o.x; this.y -= o.y; return this; }
    mult(s){ this.x *= s; this.y *= s; return this; }
    div(s){ this.x /= s; this.y /= s; return this; }
    mag(){ return Math.sqrt(this.x*this.x + this.y*this.y); }
    setMag(m){ const cm = this.mag(); if (cm>0){ this.div(cm); this.mult(m); } return this; }
    limit(max){ if (this.mag() > max) this.setMag(max); return this; }
    clone(){ return new Vector(this.x, this.y); }
}
