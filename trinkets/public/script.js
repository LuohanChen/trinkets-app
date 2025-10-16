// ========== Start screen + sequence + floating images ==========
(() => {
  const loading     = document.getElementById('loading');
  const studio      = document.getElementById('studio');
  const startBtn    = document.getElementById('startBtn');
  const startTitle  = document.getElementById('startTitle');
  const seqWrap     = document.getElementById('sequence');
  const storiesWord = document.getElementById('storiesWord');
  const finalPrompt = document.getElementById('finalPrompt');
  const floatLayer  = document.getElementById('floatLayer');

  const WORDS = ["our passions", "our love", "our friendships", "our fight"];
  const TYPE_SPEED = 90, ERASE_SPEED = 65;
  const HOLD_AFTER_TYPE = 900, HOLD_AFTER_ERASE = 350, FINAL_HOLD = 1300;
  const FADE_OUT_FIRST_MS = 900, FADE_IN_SECOND_MS = 1000;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const IMAGE_SRCS = [
    "image/feature1square.jpg","image/feature2square.jpg","image/feature3square.jpg","image/feature4square.jpg",
    "image/feature5square.jpg","image/feature6square.jpg","image/feature7square.jpg","image/feature8square.jpg"
  ];

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
    return ()=>{ if(!pool.length) refill(); return pool.pop(); };
  }

  let hasEnteredStudio=false, skipRequested=false;

  function removeStartInterceptors(){
    window.removeEventListener('click',      requestSkipToStudio, { capture: true });
    window.removeEventListener('touchstart', requestSkipToStudio, { capture: true });
    window.removeEventListener('keydown',    requestSkipToStudio, { capture: true });
    window.removeEventListener('keydown',    onKeyStart);
  }

  function revealStudio(){
    if(hasEnteredStudio) return;
    hasEnteredStudio=true;
    loading.style.opacity='0';
    setTimeout(()=>{
      loading.classList.add('hidden');
      studio.classList.remove('hidden');
      studio.setAttribute('aria-hidden','false');
      document.body.style.overflow='auto';
      removeStartInterceptors();
      if(window.__konvaEnsure){
        window.__konvaEnsure();
        requestAnimationFrame(window.__konvaEnsure);
      }
    },720);
  }

  function fadeOut(el,ms){ if(ms) el.style.setProperty('--fade-ms',`${ms}ms`); el.classList.add('fade-out'); el.classList.remove('fade-in'); }
  function fadeIn(el,ms){ if(ms) el.style.setProperty('--fade-ms',`${ms}ms`); el.classList.add('fade-in'); el.classList.remove('fade-out','hidden'); }
  const randBetween=(a,b)=>Math.random()*(b-a)+a;
  const wait=ms=>new Promise(res=>setTimeout(res,ms));

  function startFloatingImages(){
    if(!floatLayer) return;
    const W=window.innerWidth;
    const isSmall=W<640, isMedium=W>=640&&W<1024;
    const count=isSmall?5:isMedium?8:11;
    const sizeMin=isSmall?90:isMedium?130:180, sizeMax=isSmall?150:isMedium?220:360;
    const durMin=isSmall?36:isMedium?48:60, durMax=isSmall?65:isMedium?80:110;
    const nextSrc=makeShuffler(IMAGE_SRCS);

    for(let i=0;i<count;i++){
      const img=document.createElement('img');
      img.className='float-img';
      img.src=nextSrc();
      const size=Math.round(randBetween(sizeMin,sizeMax));
      img.style.width=`${size}px`; img.style.height=`${size}px`;
      img.style.top=`${randBetween(4,92)}%`;
      const dur=randBetween(durMin,durMax), delay=-randBetween(0,dur);
      img.style.animation=`floatLeft ${dur}s linear infinite`;
      img.style.animationDelay=`${delay}s`;
      floatLayer.appendChild(img);
      void img.offsetWidth;
      img.classList.add('visible');
      img.addEventListener('animationiteration',()=>{
        img.style.top=`${randBetween(4,92)}%`;
        const nsize=Math.round(randBetween(sizeMin,sizeMax));
        img.style.width=`${nsize}px`; img.style.height=`${nsize}px`;
        const ndur=randBetween(durMin,durMax);
        img.style.animationDuration=`${ndur}s`;
      });
    }
  }

  async function typeWord(el,text){
    for(let i=1;i<=text.length;i++){
      if(skipRequested) return;
      el.textContent=text.slice(0,i);
      await wait(TYPE_SPEED);
    }
    await wait(HOLD_AFTER_TYPE);
    for(let i=text.length;i>=0;i--){
      if(skipRequested) return;
      el.textContent=text.slice(0,i);
      await wait(ERASE_SPEED);
    }
    await wait(HOLD_AFTER_ERASE);
  }

  async function runSequence(){
    if(skipRequested) return revealStudio();
    startBtn.style.pointerEvents='none'; startBtn.classList.add('fade-out');
    document.querySelector('.start-hint')?.classList.add('fade-out');
    setTimeout(()=>{
      startBtn.classList.add('hidden');
      document.querySelector('.start-hint')?.classList.add('hidden');
    },300);

    if(!prefersReduced) startFloatingImages();

    fadeOut(startTitle,FADE_OUT_FIRST_MS);
    await wait(FADE_OUT_FIRST_MS+50);
    if(skipRequested) return revealStudio();
    startTitle.classList.add('hidden');

    seqWrap.classList.remove('hidden');
    seqWrap.setAttribute('aria-hidden','false');
    fadeIn(seqWrap,FADE_IN_SECOND_MS);
    await wait(FADE_IN_SECOND_MS+50);
    if(skipRequested) return revealStudio();

    if(prefersReduced){
      for(const w of WORDS){ if(skipRequested) return revealStudio(); storiesWord.textContent=w; await wait(900); }
    } else {
      for(const w of WORDS){ if(skipRequested) return revealStudio(); await typeWord(storiesWord,w); }
    }

    storiesWord.textContent='';
    fadeOut(seqWrap);
    await wait(450);
    if(skipRequested) return revealStudio();
    seqWrap.classList.add('hidden');

    finalPrompt.classList.remove('hidden');
    fadeIn(finalPrompt,700);
    await wait(FINAL_HOLD);
    if(skipRequested) return revealStudio();
    fadeOut(finalPrompt,500);
    await wait(550);
    revealStudio();
  }

  function requestSkipToStudio(e){
    if(hasEnteredStudio) return;
    const isStartClick = e && (
      e.target===startBtn ||
      (startBtn && startBtn.contains(e.target)) ||
      (e.type==='keydown' && (e.key==='Enter'||e.key===' ') && document.activeElement===startBtn)
    );
    if(isStartClick) return;
    skipRequested=true;
    revealStudio();
  }

  function addStartInterceptors(){
    window.addEventListener('click',      requestSkipToStudio, { capture: true });
    window.addEventListener('touchstart', requestSkipToStudio, { capture: true });
    window.addEventListener('keydown',    requestSkipToStudio, { capture: true });
  }

  function onKeyStart(e){
    // Don't hijack keys when typing
    const t = e.target;
    const tag = (t && t.tagName) ? t.tagName.toUpperCase() : "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable;
    if (typing) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      runSequence();
    }
  }

  window.addEventListener('DOMContentLoaded',()=>{
    document.body.style.overflow='hidden';
    studio.classList.add('hidden');
    studio.setAttribute('aria-hidden','true');
    addStartInterceptors();
    startBtn?.addEventListener('click',runSequence);
    window.addEventListener('keydown',onKeyStart,{passive:false});
    startTitle.classList.add('fade-in');
  });
})();


// ========== Konva drawing tools + POST ==========
(() => {
  const stageHost = document.getElementById('konvaStage');
  if (!stageHost || !window.Konva) return;

  const API_URL = 'http://localhost:5050/api/trinkets'; // adjust if needed
  const NAVIGATE_AFTER_SUBMIT = true;                    // redirect to street.html

  // Your drawing's logical resolution (export size)
  const BASE_W = 1200, BASE_H = 800;

  // choose how the drawing fits the container: 'cover' fills, 'contain' keeps all visible
  const SCALE_MODE = 'cover';

  const stage = new Konva.Stage({
    container: stageHost,
    width: stageHost.clientWidth || 1,
    height: stageHost.clientHeight || 1,
  });
  const layer = new Konva.Layer();
  stage.add(layer);

  // Backing bitmap we draw into
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = BASE_W;
  baseCanvas.height = BASE_H;
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
  baseCtx.fillStyle = '#00000000';
  baseCtx.fillRect(0, 0, BASE_W, BASE_H);

  // Visible node for the bitmap
  const imageNode = new Konva.Image({
    image: baseCanvas,
    x: 0, y: 0,
    width: BASE_W,
    height: BASE_H
  });
  layer.add(imageNode);
  layer.draw();

  // Fit + center the bitmap in the available area
  function fitStage() {
    const cw = stageHost.clientWidth  || 1;
    const ch = stageHost.clientHeight || 1;

    stage.size({ width: cw, height: ch });

    const scaleContain = Math.min(cw / BASE_W, ch / BASE_H);
    const scaleCover   = Math.max(cw / BASE_W, ch / BASE_H);
    const s = SCALE_MODE === 'cover' ? scaleCover : scaleContain;

    // Center; with 'cover' one axis will be negative (intentionally spilling out)
    const x = (cw - BASE_W * s) / 2;
    const y = (ch - BASE_H * s) / 2;

    imageNode.scale({ x: s, y: s });
    imageNode.position({ x, y });
    layer.batchDraw();
  }

  // Initial + deferred ensure
  fitStage();
  requestAnimationFrame(fitStage);
  window.addEventListener('resize', fitStage);
  window.__konvaEnsure = fitStage;

  // ---------- Tools ----------
  const colorEl = document.getElementById('brushColor');

  // Convert stage pointer -> bitmap coordinates (accounts for scale & centering)
  function toBitmapPoint() {
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    const inv = imageNode.getAbsoluteTransform().copy().invert();
    const pt  = inv.point(pos);
    return {
      x: Math.max(0, Math.min(BASE_W - 1, Math.round(pt.x))),
      y: Math.max(0, Math.min(BASE_H - 1, Math.round(pt.y)))
    };
  }

  // Brush
  let painting = false;
  function brushStart() {
    const { x, y } = toBitmapPoint();
    baseCtx.strokeStyle = colorEl?.value || '#111';
    baseCtx.lineWidth   = Number((document.getElementById('brushSize')?.value) || 6);
    baseCtx.lineJoin = 'round';
    baseCtx.lineCap  = 'round';
    baseCtx.beginPath();
    baseCtx.moveTo(x, y);
    painting = true;
  }
  function brushMove() {
    if (!painting) return;
    const { x, y } = toBitmapPoint();
    baseCtx.lineTo(x, y);
    baseCtx.stroke();
    layer.batchDraw();
  }
  function brushEnd() {
    if (!painting) return;
    painting = false;
    baseCtx.closePath();
    layer.draw();
  }

  // Paint bucket
  function hexToRGBA(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000');
    if (!m) return [0,0,0,255];
    return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16), 255];
  }
  function colorsMatch(pix, i, target, tol) {
    return Math.abs(pix[i]   - target[0]) <= tol &&
           Math.abs(pix[i+1] - target[1]) <= tol &&
           Math.abs(pix[i+2] - target[2]) <= tol &&
           Math.abs(pix[i+3] - target[3]) <= tol;
  }
  function setColor(pix, i, fill) {
    pix[i]   = fill[0]; pix[i+1] = fill[1]; pix[i+2] = fill[2]; pix[i+3] = fill[3];
  }
  function floodFillSeed(startX, startY, fillColorHex, tolerance = 24) {
    const w = BASE_W, h = BASE_H;
    const img = baseCtx.getImageData(0, 0, w, h);
    const data = img.data;
    const idx = (x, y) => (y * w + x) * 4;
    const startI = idx(startX, startY);
    const target = [data[startI], data[startI+1], data[startI+2], data[startI+3]];
    const fill   = hexToRGBA(fillColorHex);
    if (Math.abs(fill[0]-target[0]) <= 1 &&
        Math.abs(fill[1]-target[1]) <= 1 &&
        Math.abs(fill[2]-target[2]) <= 1 &&
        Math.abs(fill[3]-target[3]) <= 1) return;

    const stack = [[startX, startY]];
    const seen  = new Uint8Array(w * h);

    while (stack.length) {
      const [x, y] = stack.pop();
      let xi = x; while (xi >= 0 && !seen[y*w+xi] && colorsMatch(data, idx(xi,y), target, tolerance)) xi--; xi++;
      let spanAbove = false, spanBelow = false;
      for (; xi < w && !seen[y*w+xi] && colorsMatch(data, idx(xi,y), target, tolerance); xi++) {
        setColor(data, idx(xi,y), fill);
        seen[y*w+xi] = 1;
        if (y > 0) {
          const a = y - 1;
          if (!seen[a*w+xi] && colorsMatch(data, idx(xi,a), target, tolerance)) {
            if (!spanAbove) { stack.push([xi,a]); spanAbove = true; }
          } else if (spanAbove) spanAbove = false;
        }
        if (y < h - 1) {
          const b = y + 1;
          if (!seen[b*w+xi] && colorsMatch(data, idx(xi,b), target, tolerance)) {
            if (!spanBelow) { stack.push([xi,b]); spanBelow = true; }
          } else if (spanBelow) spanBelow = false;
        }
      }
    }

    baseCtx.putImageData(img, 0, 0);
    layer.draw();
  }

  // Pointer routing
  const toolBrush  = document.getElementById('toolBrush');
  const toolBucket = document.getElementById('toolBucket');
  let currentTool = 'brush';
  toolBrush?.addEventListener('change',()=>{ if (toolBrush.checked) currentTool='brush'; });
  toolBucket?.addEventListener('change',()=>{ if (toolBucket.checked) currentTool='bucket'; });

  function onDown(){
    if (currentTool === 'bucket') {
      const { x, y } = toBitmapPoint();
      floodFillSeed(x, y, (document.getElementById('brushColor')?.value || '#111'), 24);
      return;
    }
    brushStart();
  }
  function onMove(){ if (currentTool === 'brush') brushMove(); }
  function onUp(){ if (currentTool === 'brush') brushEnd(); }

  stage.on('mousedown touchstart', onDown);
  stage.on('mousemove touchmove', onMove);
  stage.on('mouseup touchend touchcancel', onUp);

  // Buttons
  document.getElementById('clearCanvas')?.addEventListener('click',()=>{
    baseCtx.clearRect(0,0,BASE_W,BASE_H);
    layer.draw();
  });
  document.getElementById('savePNG')?.addEventListener('click',()=>{
    const dataURL = stage.toDataURL({ pixelRatio: 2 });
    const a = document.createElement('a'); a.href = dataURL; a.download = 'my-trinket.png'; a.click();
  });

  // Submit to backend
  document.getElementById('submitTrinket')?.addEventListener('click', async ()=>{
    try{
      const drawing = stage.toDataURL({ pixelRatio: 2 });
      const trinketName = document.getElementById('trinketName')?.value.trim() || '';
      const trinketText = document.getElementById('trinketText')?.value.trim() || ''; // unused by street now

      // Save name locally as a courtesy (may be read by street if same-origin)
      try {
        localStorage.setItem('lastTrinketName', trinketName);
        localStorage.setItem('lastTrinketSavedAt', String(Date.now()));
      } catch {}

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          trinketName,
          trinketText, // saved but not displayed on street
          drawing,
          // legacy aliases:
          name: trinketName,
          text: trinketText
        })
      });

      if(!res.ok) throw new Error(`Submit failed: ${res.status}`);

      // Optional: live broadcast of the name (same-origin)
      try {
        const bc = new BroadcastChannel('trinkets');
        bc.postMessage({ trinketName, when: Date.now() });
      } catch {}

      alert('Thank you for submitting! Please take a look at the screen!');
      console.log('Submitted:', { trinketName, drawingLen: drawing.length });
    }catch(e){
      console.error(e);
      alert('Failed to submit. Check console.');
    }
  });
})();
