// at top of this IIFE (you already have these)
const API_BASE = window.API_BASE || ""; // "" = same origin
const API_URL  = `${API_BASE}/api/trinkets`;

document.getElementById('submitTrinket')?.addEventListener('click', async () => {
  try {
    const drawing     = stage.toDataURL({ pixelRatio: 2 });
    const trinketName = document.getElementById('trinketName')?.value.trim() || '';
    const trinketText = document.getElementById('trinketText')?.value.trim() || '';

    // keep last name locally (optional)
    try {
      localStorage.setItem('lastTrinketName', trinketName);
      localStorage.setItem('lastTrinketSavedAt', String(Date.now()));
    } catch {}

    // 👉 capture the response here
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trinketName, trinketText, drawing })
    });

    if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
    // const saved = await res.json(); // if you need the returned item

    // optional: broadcast locally so street can react immediately
    try {
      const bc = new BroadcastChannel('trinkets');
      bc.postMessage({ trinketName, when: Date.now() });
    } catch {}

    alert('Thank you for submitting! Please take a look at the screen!');
  } catch (e) {
    console.error(e);
    alert('Failed to submit. Check console.');
  }
});
