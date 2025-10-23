/* =========================================================
   INTRO SEQUENCE + SKIP (unchanged)
   ========================================================= */
(() => {
  const loading = document.getElementById("loading");
  const studio = document.getElementById("studio");
  const startBtn = document.getElementById("startBtn");
  const startTitle = document.getElementById("startTitle");
  const seqWrap = document.getElementById("sequence");
  const storiesWord = document.getElementById("storiesWord");
  const finalPrompt = document.getElementById("finalPrompt");
  const floatLayer = document.getElementById("floatLayer");

  const WORDS = ["our passions", "our love", "our friendships", "our fight"];
  const TYPE_SPEED = 90, ERASE_SPEED = 65;
  const HOLD_AFTER_TYPE = 900, HOLD_AFTER_ERASE = 350, FINAL_HOLD = 1300;
  const FADE_OUT_FIRST_MS = 900, FADE_IN_SECOND_MS = 1000;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const IMAGE_SRCS = [
    "image/feature1square.jpg","image/feature2square.jpg","image/feature3square.jpg","image/feature4square.jpg",
    "image/feature5square.jpg","image/feature6square.jpg","image/feature7square.jpg","image/feature8square.jpg"
  ];

  const randBetween = (a,b)=>Math.random()*(b-a)+a;
  const wait = (ms)=>new Promise(r=>setTimeout(r,ms));

  function makeShuffler(items){
    let pool=[];
    function refill(){
      pool = items.slice();
      for(let i=pool.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [pool[i],pool[j]]=[pool[j],pool[i]];
      }
    }
    refill();
    return ()=>{if(!pool.length)refill();return pool.pop();};
  }

  let hasEnteredStudio=false, skipRequested=false;

  function fadeOut(el,ms){ if(ms) el.style.setProperty("--fade-ms",`${ms}ms`); el.classList.add("fade-out"); el.classList.remove("fade-in"); }
  function fadeIn(el,ms){ if(ms) el.style.setProperty("--fade-ms",`${ms}ms`); el.classList.add("fade-in"); el.classList.remove("fade-out","hidden"); }

  function startFloatingImages(){
    if(!floatLayer)return;
    const W=window.innerWidth;
    const isSmall=W<640,isMedium=W>=640&&W<1024;
    const count=isSmall?5:isMedium?8:11;
    const sizeMin=isSmall?90:isMedium?130:180,sizeMax=isSmall?150:isMedium?220:360;
    const durMin=isSmall?36:isMedium?48:60,durMax=isSmall?65:isMedium?80:110;
    const nextSrc=makeShuffler(IMAGE_SRCS);
    for(let i=0;i<count;i++){
      const img=document.createElement("img");
      img.className="float-img";
      img.src=nextSrc();
      const size=Math.round(randBetween(sizeMin,sizeMax));
      img.style.width=`${size}px`;
      img.style.height=`${size}px`;
      img.style.top=`${randBetween(4,92)}%`;
      const dur=randBetween(durMin,durMax),delay=-randBetween(0,dur);
      img.style.animation=`floatLeft ${dur}s linear infinite`;
      img.style.animationDelay=`${delay}s`;
      floatLayer.appendChild(img);
      void img.offsetWidth;
      img.classList.add("visible");
    }
  }

  async function typeWord(el,text){
    for(let i=1;i<=text.length;i++){if(skipRequested)return;el.textContent=text.slice(0,i);await wait(TYPE_SPEED);}
    await wait(HOLD_AFTER_TYPE);
    for(let i=text.length;i>=0;i--){if(skipRequested)return;el.textContent=text.slice(0,i);await wait(ERASE_SPEED);}
    await wait(HOLD_AFTER_ERASE);
  }

  function revealStudio(){
    if(hasEnteredStudio)return;
    hasEnteredStudio=true;
    loading.style.opacity="0";
    setTimeout(()=>{
      loading.classList.add("hidden");
      studio.classList.remove("hidden");
      studio.setAttribute("aria-hidden","false");
      document.body.style.overflow="auto";
      if(window.__konvaEnsure){window.__konvaEnsure();}
      removeStartInterceptors();
    },720);
  }

  async function runSequence(){
    if(skipRequested)return revealStudio();
    startBtn.style.pointerEvents="none";
    startBtn.classList.add("fade-out");
    document.querySelector(".start-hint")?.classList.add("fade-out");
    setTimeout(()=>{
      startBtn.classList.add("hidden");
      document.querySelector(".start-hint")?.classList.add("hidden");
    },300);

    startFloatingImages();
    fadeOut(startTitle,FADE_OUT_FIRST_MS);
    await wait(FADE_OUT_FIRST_MS+50);
    startTitle.classList.add("hidden");

    seqWrap.classList.remove("hidden");
    fadeIn(seqWrap,FADE_IN_SECOND_MS);
    await wait(FADE_IN_SECOND_MS+50);

    for(const w of WORDS){
      if(skipRequested)return revealStudio();
      await typeWord(storiesWord,w);
    }

    storiesWord.textContent="";
    fadeOut(seqWrap);
    await wait(450);
    seqWrap.classList.add("hidden");

    finalPrompt.classList.remove("hidden");
    fadeIn(finalPrompt,700);
    await wait(FINAL_HOLD);
    fadeOut(finalPrompt,500);
    await wait(550);
    revealStudio();
  }

  function requestSkipToStudio(e){
    if(hasEnteredStudio)return;
    const isStart=e.target===startBtn;
    if(isStart)return runSequence();
    skipRequested=true;
    revealStudio();
  }

  function addStartInterceptors(){
    window.addEventListener("click",requestSkipToStudio,{capture:true});
    window.addEventListener("keydown",(e)=>{
      if(e.key==="Enter"||e.key===" "){runSequence();}
    });
  }
  function removeStartInterceptors(){
    window.removeEventListener("click",requestSkipToStudio,{capture:true});
  }

  window.addEventListener("DOMContentLoaded",()=>{
    document.body.style.overflow="hidden";
    startBtn.addEventListener("click",runSequence);
    addStartInterceptors();
  });
})();

// END INTRO SECTION END INTRO SECTION END INTRO SECTION END INTRO SECTION END INTRO SECTION END INTRO SECTION END INTRO SECTION END INTRO SECTION END INTRO SECTION

/* =========================================================
   DRAWING + TOOLS + CURSOR (cursor=stroke size; icon offset)
   ========================================================= */
(() => {
  const stageHost = document.getElementById("konvaStage");
  if (!stageHost || !window.Konva) return;

  const BASE_W = 1200, BASE_H = 800;

  // ---- Konva stage/layer ----
  const stage = new Konva.Stage({
    container: "konvaStage",
    width: stageHost.clientWidth,
    height: stageHost.clientHeight,
  });
  const layer = new Konva.Layer();
  stage.add(layer);

  // Backing bitmap and visible image node
  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = BASE_W;
  baseCanvas.height = BASE_H;
  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });

  const imageNode = new Konva.Image({
    image: baseCanvas,
    width: BASE_W,
    height: BASE_H,
  });
  layer.add(imageNode);
  layer.draw();

  // ---- DOM controls ----
  const colorEl   = document.getElementById("brushColor");
  const sizeEl    = document.getElementById("brushSize");
  const clearBtn  = document.getElementById("clearCanvas");
  const submitBtn = document.getElementById("submitTrinket");

  // Hide native cursor over stage – we show a custom one
  stage.container().style.cursor = "none";

  // ---- Custom cursor (ring + tool icon) ----
  const cursor = document.createElement("div");
  cursor.className = "cursor-ring hidden";
  cursor.style.position = "fixed";
  cursor.style.transform = "translate(-50%, -50%)";
  cursor.style.borderRadius = "50%";
  cursor.style.pointerEvents = "none";
  cursor.style.boxSizing = "border-box";

  const cursorIcon = document.createElement("i");
  cursorIcon.style.position = "absolute";
  cursorIcon.style.left = "100%";               // outside the circle
  cursorIcon.style.top  = "100%";
  cursorIcon.style.transform = "translate(6px, 2px)"; // nudge away from ring
  cursorIcon.style.fontSize = "14px";
  cursorIcon.style.pointerEvents = "none";
  cursor.appendChild(cursorIcon);
  document.body.appendChild(cursor);

  // ---- Toolbar build (remove any previous injected rows) ----
  const toolsDiv = document.querySelector(".tools");
  toolsDiv.querySelectorAll(".tool-btn, .tool-row, .tool-group").forEach(el => el.remove());

  // Tool icons
  const toolIcons = {
    brush:  "fi fi-rs-paint-brush",
    bucket: "fi fi-rr-fill",
    eraser: "fi fi-rr-eraser",
  };
  const toolBtns = {};
  let currentTool = "brush";

  // Top row wrapper
  const topRow = document.createElement("div");
  topRow.className = "tool-row";
  Object.assign(topRow.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    flexWrap: "wrap",
    gap: "10px",
  });

  // Left group: Color • Brush • Bucket • Eraser
  const leftGroup = document.createElement("div");
  Object.assign(leftGroup.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  });
  leftGroup.appendChild(colorEl);

  const makeToolBtn = (name, iconClass) => {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.innerHTML = `<i class="${iconClass}"></i>`;
    b.addEventListener("click", () => setActiveTool(name));
    toolBtns[name] = b;
    return b;
  };
  leftGroup.appendChild(makeToolBtn("brush",  toolIcons.brush));
  leftGroup.appendChild(makeToolBtn("bucket", toolIcons.bucket));
  leftGroup.appendChild(makeToolBtn("eraser", toolIcons.eraser));

  // Right group: Size • Clear
  const rightGroup = document.createElement("div");
  Object.assign(rightGroup.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  });

  const sizeWrap = document.createElement("div");
  Object.assign(sizeWrap.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  });
  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = "Size";
  sizeLabel.style.fontWeight = "500";
  sizeLabel.style.color = "#111";
  sizeWrap.appendChild(sizeLabel);
  sizeWrap.appendChild(sizeEl);

  rightGroup.appendChild(sizeWrap);
  rightGroup.appendChild(clearBtn);

  topRow.appendChild(leftGroup);
  topRow.appendChild(rightGroup);

  // Bottom row: Submit centered
  const bottomRow = document.createElement("div");
  Object.assign(bottomRow.style, {
    display: "flex",
    justifyContent: "center",
    marginTop: "10px",
  });
  bottomRow.appendChild(submitBtn);

  // Apply into .tools
  toolsDiv.innerHTML = "";
  toolsDiv.appendChild(topRow);
  toolsDiv.appendChild(bottomRow);

  function setActiveTool(tool) {
    currentTool = tool;
    for (const [n, b] of Object.entries(toolBtns)) {
      b.classList.toggle("active-tool", n === tool);
    }
    updateCursorAppearance();
  }
  setActiveTool("brush");

  // ---- Fit / scale stage to container ----
  function fitStage() {
    const cw = stageHost.clientWidth  || 1;
    const ch = stageHost.clientHeight || 1;
    stage.size({ width: cw, height: ch });

    const s = Math.max(cw / BASE_W, ch / BASE_H); // cover
    imageNode.scale({ x: s, y: s });
    imageNode.position({ x: (cw - BASE_W * s) / 2, y: (ch - BASE_H * s) / 2 });
    layer.batchDraw();
    updateCursorAppearance(); // resync cursor size with new scale
  }
  fitStage();
  window.addEventListener("resize", fitStage);
  window.__konvaEnsure = fitStage;

  // ---- Helpers ----
  function toBitmapPoint() {
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    const inv = imageNode.getAbsoluteTransform().copy().invert();
    const pt = inv.point(pos);
    return { x: Math.floor(pt.x), y: Math.floor(pt.y) };
  }

  // ---- Drawing ----
  let painting = false;

  function penStart() {
    const { x, y } = toBitmapPoint();
    baseCtx.lineJoin = "round";
    baseCtx.lineCap  = "round";
    baseCtx.lineWidth   = Number(sizeEl.value);
    baseCtx.strokeStyle = currentTool === "eraser" ? "rgba(0,0,0,1)" : colorEl.value;
    baseCtx.globalCompositeOperation = currentTool === "eraser" ? "destination-out" : "source-over";
    baseCtx.beginPath();
    baseCtx.moveTo(x, y);
    painting = true;
  }

  function penMove() {
    if (!painting) return;
    const { x, y } = toBitmapPoint();
    baseCtx.lineTo(x, y);
    baseCtx.stroke();
    layer.batchDraw();
  }

  function penEnd() {
    if (!painting) return;
    painting = false;
    baseCtx.closePath();
    baseCtx.globalCompositeOperation = "source-over";
    layer.draw();
  }

  // ---- Bucket fill (safe) ----
  function hexToRGBA(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#000");
    return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16), 255] : [0,0,0,255];
  }
  function floodFillSafe(x0, y0, fillHex, tol = 28) {
    const w = BASE_W, h = BASE_H;
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;

    const img = baseCtx.getImageData(0, 0, w, h);
    const d   = img.data;
    const idx = (x, y) => (y * w + x) * 4;

    const start  = idx(x0, y0);
    const target = [d[start], d[start+1], d[start+2]];
    const fill   = hexToRGBA(fillHex);
    if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2]) return;

    const stack = [[x0, y0]];
    const seen  = new Uint8Array(w * h);

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = idx(x, y);
      if (seen[y*w + x]) continue;
      if (Math.abs(d[i]   - target[0]) > tol ||
          Math.abs(d[i+1] - target[1]) > tol ||
          Math.abs(d[i+2] - target[2]) > tol) continue;

      seen[y*w + x] = 1;
      d[i]   = fill[0];
      d[i+1] = fill[1];
      d[i+2] = fill[2];
      d[i+3] = 255;

      stack.push([x+1,y], [x-1,y], [x,y+1], [x,y-1]);
    }

    baseCtx.putImageData(img, 0, 0);
    layer.draw();
  }

  // ---- Events ----
  stage.on("mousedown touchstart", () => {
    if (currentTool === "bucket") {
      const { x, y } = toBitmapPoint();
      floodFillSafe(x, y, colorEl.value);
      return;
    }
    penStart();
  });
  stage.on("mousemove touchmove", penMove);
  stage.on("mouseup touchend touchcancel", penEnd);

  // ---- Cursor placement & sizing ----
  function updateCursorAppearance() {
    const brushSize = Number(sizeEl.value);                 // lineWidth in bitmap px
    const scale = imageNode.getAbsoluteScale().x || 1;      // on-screen scale
    const diameter = Math.max(1, brushSize * scale);        // match visible stroke thickness

    cursor.style.width  = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.border = `2px solid ${colorEl.value}`;
    cursor.style.background = "transparent";

    cursorIcon.className =
      currentTool === "brush"  ? "fi fi-rs-paint-brush" :
      currentTool === "bucket" ? "fi fi-rr-fill"        :
                                 "fi fi-rr-eraser";
  }

  stage.on("mousemove touchmove", () => {
    const pos = stage.getPointerPosition();
    if (!pos) return;

    // Use the stage container rect (avoid wrapper padding offsets)
    const contRect = stage.container().getBoundingClientRect();
    cursor.classList.remove("hidden");
    cursor.style.left = `${pos.x + contRect.left}px`;
    cursor.style.top  = `${pos.y + contRect.top }px`;
  });
  stage.on("mouseleave touchend", () => cursor.classList.add("hidden"));

  colorEl.addEventListener("input", updateCursorAppearance);
  sizeEl.addEventListener("input",  updateCursorAppearance);
  window.addEventListener("resize", () => { fitStage(); updateCursorAppearance(); });

  clearBtn?.addEventListener("click", () => {
    baseCtx.clearRect(0, 0, BASE_W, BASE_H);
    layer.draw();
  });

  submitBtn?.addEventListener("click", async () => {
    const drawing = stage.toDataURL({ pixelRatio: 2 });
    await fetch("/api/trinkets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drawing }),
    });
    alert("Submitted!");
  });

  updateCursorAppearance();
})();
