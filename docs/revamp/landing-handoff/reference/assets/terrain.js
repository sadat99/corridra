function mountTerrain(canvas, ambient) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = {x: .5, y: .5, active: false};
  const peaks = [[.18,.54,.35,.57,1.1],[.67,.39,.49,.56,.5],[.91,.86,.37,.47,3.8],[-.03,.02,.31,.28,6]];
  let width = 0;
  let height = 0;
  let base = document.createElement("canvas");
  let reverse = false;
  let hue = 0;
  let routeMode = "open";
  let paused = false;
  let visible = true;
  let frame = 0;
  let epoch = performance.now();
  function drawBase() {
    base.width = width;
    base.height = height;
    const ink = base.getContext("2d");
    ink.strokeStyle = "#9bbbd72c";
    ink.lineWidth = 1;
    for (let x = 10; x < width; x += 25) {
      for (let y = 12; y < height; y += 25) {
        ink.beginPath();
        ink.moveTo(x - 2,y);ink.lineTo(x + 2,y);ink.moveTo(x,y - 2);ink.lineTo(x,y + 2);ink.stroke();
      }
    }
    for (const [x, y, rx, ry, phase] of peaks) {
      for (let ring = 1; ring <= 22; ring++) {
        const radius = ring / 19;
        ink.beginPath();
        for (let i = 0; i <= 120; i++) {
          const angle = i / 120 * Math.PI * 2;
          const warp = 1 + .12 * Math.sin(angle * 3 + phase + ring * .13) + .07 * Math.cos(angle * 6 + phase) + .04 * Math.sin(angle * 11 + phase + ring * .12);
          const px = width * (x + rx * radius * warp * Math.cos(angle));
          const py = height * (y + ry * radius * warp * Math.sin(angle));
          if (i === 0) ink.moveTo(px, py); else ink.lineTo(px, py);
        }
        ink.closePath();
        ink.strokeStyle = ring % 5 === 0 ? "#8fafd17d" : "#82a6ca42";
        ink.stroke();
      }
    }
  }
  function routePoint(t) {
    const u = 1 - t;
    return [
      width * (u*u*u*.23 + 3*u*u*t*.54 + 3*u*t*t*.56 + t*t*t*.80),
      height * (u*u*u*.59 + 3*u*u*t*.6 + 3*u*t*t*(.04 + hue*.02) + t*t*t*.24)
    ];
  }
  function paint(now) {
    frame = 0;
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(base, 0, 0, width, height);
    if (pointer.active && !motion.matches && !paused) {
      const spotX = pointer.x * width;
      const spotY = pointer.y * height;
      const mask = context.createRadialGradient(spotX, spotY, 0, spotX, spotY, width * .25);
      mask.addColorStop(0, "#a2d5ff48");
      mask.addColorStop(1, "#a2d5ff00");
      context.fillStyle = mask;
      context.fillRect(0,0,width,height);
    }
    if (!ambient) {
      const [startX,startY] = routePoint(0);
      const [endX,endY] = routePoint(1);
      context.beginPath();
      context.moveTo(startX,startY);
      context.bezierCurveTo(width*.54,height*.6,width*.56,height*(.04+hue*.02),endX,endY);
      context.lineWidth = 3;
      context.strokeStyle = routeMode === "open" ? "#e1edb2" : "#adc8f4";
      context.setLineDash(routeMode === "open" ? [] : routeMode === "selective" ? [9, 6] : [2, 7]);
      context.stroke();
      context.setLineDash([]);
      const time = motion.matches || paused ? .56 : Math.max(0, now - epoch) / 3500 % 1;
      const [x,y] = routePoint(reverse ? 1-time : time);
      context.beginPath();
      context.arc(x,y,9,0,Math.PI*2);
      context.fillStyle = "#e1edb249";
      context.fill();
      for (const [cx,cy,radius] of [[startX,startY,5],[endX,endY,5],[x,y,4]]) {
        context.beginPath();
        context.arc(cx,cy,radius,0,Math.PI*2);
        context.fillStyle = "#f9ffc3";
        context.fill();
      }
    }
    if (!ambient && visible && !paused && !motion.matches && !document.hidden) frame = requestAnimationFrame(paint);
  }
  function redraw() {
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1,Math.round(bounds.width));
    height = Math.max(1,Math.round(bounds.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio,0,0,ratio,0,0);
    drawBase();
    redraw();
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) redraw(); }).observe(canvas);
  motion.addEventListener("change", redraw);
  document.addEventListener("visibilitychange", redraw);
  const surface = canvas.parentElement;
  surface.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse") return;
    const bounds = surface.getBoundingClientRect();
    pointer.x = (event.clientX - bounds.left) / bounds.width;
    pointer.y = (event.clientY - bounds.top) / bounds.height;
    pointer.active = true;
    redraw();
  });
  surface.addEventListener("pointerleave", () => { pointer.active = false; redraw(); });
  function setRoute(isReverse, destinationIndex, mode = "open") {
    reverse = isReverse;
    hue = destinationIndex;
    routeMode = mode;
    epoch = performance.now();
    redraw();
  }
  setRoute.pause = (value) => {
    paused = value;
    if (!paused) epoch = performance.now();
    redraw();
  };
  return setRoute;
}
document.querySelectorAll("canvas[data-ambient]").forEach(canvas => mountTerrain(canvas, true));
