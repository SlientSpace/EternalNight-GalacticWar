// 图标加载系统
class IconLoader {
    constructor() {
        this.icons = new Map();
        this.loadPromises = new Map();
        this.loaded = false;
        // 缓存已着色并按尺寸渲染过的图标，key: `${iconName}|${color}|${w}x${h}`
        this.coloredCache = new Map();
        // 颜色解析缓存
        this.colorCache = new Map();
    }

    // 加载单个图标，始终返回 Promise
    loadIcon(name, path) {
        if (this.icons.has(name)) {
            return Promise.resolve(this.icons.get(name));
        }

        if (this.loadPromises.has(name)) {
            return this.loadPromises.get(name);
        }

        const promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.icons.set(name, img);
                this.loadPromises.delete(name);
                resolve(img);
            };
            img.onerror = (e) => {
                this.loadPromises.delete(name);
                console.error(`Failed to load icon: ${name} from ${path}`, e);
                reject(new Error(`Failed to load icon: ${name}`));
            };
            img.src = path;
        });

        this.loadPromises.set(name, promise);
        return promise;
    }

    // 批量加载所有图标
    async loadAllIcons() {
        const iconPaths = {
            'battlecruiser': 'assets/objects_icon/Battlecruiser.png',
            'battleship': 'assets/objects_icon/Battleship.png',
            'cruiser': 'assets/objects_icon/Cruiser.png',
            'destroyer': 'assets/objects_icon/Destroyer.png',
            'frigate': 'assets/objects_icon/Frigate.png',
            'missile': 'assets/objects_icon/Missile.png',
            'drone': 'assets/objects_icon/Drone.png'
        };

        const loadPromises = Object.entries(iconPaths).map(([name, path]) =>
            this.loadIcon(name, path)
        );

        try {
            await Promise.all(loadPromises);
            this.loaded = true;
            console.log('All icons loaded successfully');
        } catch (error) {
            console.error('Failed to load some icons:', error);
            throw error;
        }
    }

    // 获取图标（同步返回 Image 或 null）
    getIcon(name) {
        return this.icons.get(name) || null;
    }

    // 检查是否已加载
    isLoaded() {
        return this.loaded;
    }

    /**
     * 绘制带颜色的图标（不拉伸原图比例）
     * ctx: CanvasRenderingContext2D
     * iconName: 图标名
     * x,y: 绘制中心坐标（注意：函数会把图标中心放在 x,y）
     * maxWidth,maxHeight: 目标框的最大宽高（如果省略则使用原图尺寸）
     * color: 目标颜色（例如 '#ff00aa'）
     * rotation: 以弧度为单位的旋转角度（默认 0）
     * fit: 'contain'（默认，按比例缩放并完整显示）或 'cover'（按比例放大以填满框，可能裁切）
     */
    drawColoredIcon(ctx, iconName, x, y, maxWidth, maxHeight, color, rotation = 0, fit = 'contain') {
        const icon = this.getIcon(iconName);
        if (!icon) {
            console.warn(`Icon not found: ${iconName}`);
            return false;
        }

        // 原始尺寸
        const iw = icon.naturalWidth || icon.width;
        const ih = icon.naturalHeight || icon.height;

        // 如果没有提供目标尺寸，则使用原始尺寸
        let targetW = typeof maxWidth === 'number' ? maxWidth : iw;
        let targetH = typeof maxHeight === 'number' ? maxHeight : ih;

        // 计算缩放（保持宽高比）
        let scale;
        if (fit === 'cover') {
            scale = Math.max(targetW / iw, targetH / ih);
        } else { // 'contain' 或默认
            scale = Math.min(targetW / iw, targetH / ih);
        }
        // 如果你不希望放大可开启下面一行（当前注释，允许放大）
        // scale = Math.min(scale, 1);

        const drawW = Math.max(1, Math.round(iw * scale));
        const drawH = Math.max(1, Math.round(ih * scale));

        // 优先从缓存读取已着色图像
        const cacheKey = `${iconName}|${color}|${drawW}x${drawH}`;
        const cachedCanvas = this.coloredCache.get(cacheKey);
        ctx.save();
        ctx.translate(x, y);
        if (rotation !== 0) ctx.rotate(rotation);
        if (cachedCanvas) {
            ctx.drawImage(cachedCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
            return true;
        }

        // 创建临时画布来处理颜色（尺寸为实际绘制尺寸以避免缩放伪影）
        const tempCanvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(drawW, drawH) : document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!('width' in tempCanvas)) { tempCanvas.width = drawW; tempCanvas.height = drawH; }

        // 绘制原始图标到临时画布并缩放到 drawW/drawH
        tempCtx.drawImage(icon, 0, 0, drawW, drawH);

        // 获取图像数据并修改颜色
        try {
            const imageData = tempCtx.getImageData(0, 0, drawW, drawH);
            const data = imageData.data;

            // 解析颜色（带缓存）
            let rgb = this.colorCache.get(color);
            if (!rgb) {
                let r = 255, g = 255, b = 255;
                if (typeof color === 'string' && color.startsWith('#')) {
                    const hex = color.slice(1);
                    if (hex.length === 3) {
                        r = parseInt(hex[0] + hex[0], 16);
                        g = parseInt(hex[1] + hex[1], 16);
                        b = parseInt(hex[2] + hex[2], 16);
                    } else if (hex.length === 6) {
                        r = parseInt(hex.slice(0, 2), 16);
                        g = parseInt(hex.slice(2, 4), 16);
                        b = parseInt(hex.slice(4, 6), 16);
                    }
                }
                rgb = [r, g, b];
                this.colorCache.set(color, rgb);
            }
            const [r, g, b] = rgb;

            // 将非透明像素（包括黑色蒙版）替换为目标颜色，同时保留原始 alpha
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                if (alpha > 0) {
                    data[i] = r;     // Red
                    data[i + 1] = g; // Green
                    data[i + 2] = b; // Blue
                }
            }

            // 将修改后的数据绘制回临时画布
            tempCtx.putImageData(imageData, 0, 0);
        } catch (err) {
            console.warn('Failed to access imageData for coloring (maybe cross-origin). Drawing original image instead.', err);
            tempCtx.clearRect(0, 0, drawW, drawH);
            tempCtx.drawImage(icon, 0, 0, drawW, drawH);
        }

        // 将处理结果缓存，以便后续复用
        this.coloredCache.set(cacheKey, tempCanvas);

        // 绘制到主画布
        ctx.drawImage(tempCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
        return true;
    }
}

// 创建全局实例
const iconLoader = new IconLoader();

export { iconLoader };
