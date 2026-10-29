// Español C1: offline study app. Plain JS, no build step.
// Content comes from data/*.json; personal progress lives in localStorage.

const STORE_KEY = "c1.state.v1";
const DAY = 86400000;
const $view = document.getElementById("view");

const data = {};
let state = loadState();

function loadState() {
  const empty = { cards: {}, custom: [], notes: [], drafts: {}, settings: { rate: 0.9, voice: "", newPerDay: 8 }, newLog: {} };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return empty;
    const s = JSON.parse(raw);
    return { ...empty, ...s, settings: { ...empty.settings, ...(s.settings || {}) } };
  } catch (e) {
    return empty;
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: keep in memory */ }
}

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const todayKey = () => new Date().toISOString().slice(0, 10);
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.¡!¿?]/g, "");
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function loadData() {
  const files = ["vocab", "grammar", "culture", "news", "dele"];
  await Promise.all(files.map(async (f) => {
    try {
      const r = await fetch(`data/${f}.json`);
      data[f] = await r.json();
    } catch (e) {
      data[f] = null;
    }
  }));
}

function allCards() {
  return [...(data.vocab || []), ...state.custom];
}

// ---------- speech (Web Speech API, uses the phone's own Spanish voice, works offline) ----------
let voices = [];
function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("es"));
}
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}
function pickVoice() {
  if (state.settings.voice) {
    const v = voices.find((v) => v.name === state.settings.voice);
    if (v) return v;
  }
  return voices.find((v) => v.lang === "es-ES") || voices[0] || null;
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : "es-ES";
  u.rate = state.settings.rate;
  speechSynthesis.speak(u);
}
const listenBtn = (text, label = "Escuchar") =>
  `<button class="chip" data-say="${esc(text)}">${label}</button>`;

// ---------- spaced repetition (SM-2 style, three buttons) ----------
function dueCards() {
  const t = today();
  const cards = allCards();
  const due = cards.filter((c) => state.cards[c.id] && state.cards[c.id].due <= t);
  const usedToday = state.newLog[todayKey()] || 0;
  const fresh = cards.filter((c) => !state.cards[c.id]).slice(0, Math.max(0, state.settings.newPerDay - usedToday));
  return [...due, ...fresh];
}
function rate(card, grade) {
  const isNew = !state.cards[card.id];
  const s = state.cards[card.id] || { interval: 0, ease: 2.5, reps: 0, due: today() };
  if (isNew) state.newLog[todayKey()] = (state.newLog[todayKey()] || 0) + 1;
  if (grade === "again") {
    s.reps = 0; s.interval = 0; s.ease = Math.max(1.3, s.ease - 0.2);
  } else if (grade === "hard") {
    s.interval = Math.max(1, Math.round((s.interval || 1) * 1.2)); s.ease = Math.max(1.3, s.ease - 0.15); s.reps++;
  } else {
    s.interval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(s.interval * s.ease); s.reps++;
  }
  s.due = today() + s.interval * DAY;
  state.cards[card.id] = s;
  save();
}
const known = () => Object.values(state.cards).filter((s) => s.interval >= 21).length;

// ---------- views ----------
const views = {};
let session = null;

views.vocab = () => {
  if (!session) session = { queue: dueCards(), shown: false };
  const { queue } = session;
  const total = allCards().length;
  const learning = Object.keys(state.cards).length;
  let html = `<h2>Vocabulario</h2>
    <div class="stats">
      <div class="stat"><b>${queue.length}</b><span>para hoy</span></div>
      <div class="stat"><b>${learning}</b><span>en estudio</span></div>
      <div class="stat"><b>${known()}</b><span>asentadas</span></div>
      <div class="stat"><b>${total}</b><span>en total</span></div>
    </div>`;
  if (!queue.length) {
    html += `<div class="card"><h3>Nada pendiente por hoy.</h3><p class="muted">Puedes repasar la lista completa o leer algo en Actualidad.</p></div>`;
  } else {
    const c = queue[0];
    html += `<div class="card">
      <span class="reg">${esc(c.reg || "")}</span>
      <div class="big">${esc(c.es)}</div>
      <div class="row">${listenBtn(c.es)}</div>
      ${session.shown ? `<div class="answer">
          <p><b>${esc(c.en)}</b></p>
          ${c.ej ? `<p class="example">${esc(c.ej)}</p><div class="row">${listenBtn(c.ej, "Escuchar ejemplo")}</div>` : ""}
          ${c.col && c.col.length ? `<p class="muted">Combina con: ${c.col.map(esc).join(" · ")}</p>` : ""}
          ${c.nota ? `<p class="small">${esc(c.nota)}</p>` : ""}
        </div>
        <div class="rates">
          <button class="rate" data-rate="again">Otra vez<small>hoy</small></button>
          <button class="rate" data-rate="hard">Difícil<small>pronto</small></button>
          <button class="rate" data-rate="good">Bien<small>más tarde</small></button>
        </div>`
      : `<div class="rates" style="grid-template-columns:1fr"><button class="primary" data-act="show">Mostrar</button></div>`}
    </div>`;
  }
  html += `<h3 style="margin-top:20px">Todas las palabras</h3>
    <input type="search" id="vsearch" placeholder="Buscar en español o inglés" autocomplete="off">
    <div id="vlist"></div>`;
  $view.innerHTML = html;
  renderVList("");
  document.getElementById("vsearch").addEventListener("input", (e) => renderVList(e.target.value));
};
function renderVList(q) {
  const n = norm(q);
  const list = allCards().filter((c) => !n || norm(c.es).includes(n) || norm(c.en).includes(n));
  document.getElementById("vlist").innerHTML = list.map((c) =>
    `<details class="card"><summary><b>${esc(c.es)}</b> <span class="muted">${esc(c.en)}</span></summary>
      ${c.ej ? `<p class="example" style="margin-top:8px">${esc(c.ej)}</p>` : ""}
      ${c.nota ? `<p class="small">${esc(c.nota)}</p>` : ""}
      <div class="row">${listenBtn(c.ej || c.es)}</div></details>`).join("");
}

let currentGrammar = null;
views.gram = (id) => {
  const g = data.grammar || [];
  if (!id) {
    $view.innerHTML = `<h2>Gramática</h2>` + g.map((p) =>
      `<div class="card tap" data-go="gram/${p.id}"><h3>${esc(p.titulo)}</h3><p class="muted">${p.ejercicios.length} ejercicios</p></div>`).join("");
    return;
  }
  const p = g.find((x) => x.id === id);
  if (!p) return go("gram");
  $view.innerHTML = `<button class="link back" data-go="gram">Gramática</button>
    <h2>${esc(p.titulo)}</h2>
    ${p.explicacion.map((t) => `<p>${esc(t)}</p>`).join("")}
    <div class="card"><b>Ejemplos</b><ul class="list-plain">${p.ejemplos.map((e) => `<li class="example">${esc(e)}</li>`).join("")}</ul></div>
    <h3>Practica</h3>
    ${p.ejercicios.map((e, i) => `<div class="card exercise">
      <p>${esc(e.frase)}</p>
      <div class="row"><input type="text" data-ex="${i}" autocapitalize="off" autocomplete="off" style="flex:1">
      <button class="ghost" data-check="${i}">Comprobar</button></div>
      <div class="fb" id="fb${i}"></div></div>`).join("")}`;
  currentGrammar = p;
};
function checkExercise(i) {
  const p = currentGrammar;
  const e = p.ejercicios[i];
  const val = norm($view.querySelector(`[data-ex="${i}"]`).value);
  const ok = e.respuestas.some((r) => norm(r) === val);
  const fb = document.getElementById(`fb${i}`);
  fb.className = "fb " + (ok ? "ok" : "bad");
  fb.textContent = (ok ? "Correcto. " : `Respuesta: ${e.respuestas.join(" / ")}. `) + e.explicacion;
}

function glossify(text, glossary) {
  let out = esc(text);
  glossary.forEach((g, i) => {
    const t = esc(g.termino);
    const idx = out.indexOf(t);
    if (idx >= 0) out = out.slice(0, idx) + `<button class="gloss" data-gloss="${i}">${t}</button>` + out.slice(idx + t.length);
  });
  return out;
}

views.cultura = (id) => {
  const list = data.culture || [];
  if (!id) {
    $view.innerHTML = `<h2>Cultura</h2>` + list.map((r) =>
      `<div class="card tap" data-go="cultura/${r.id}"><span class="section-label">${esc(r.tema)}</span><h3>${esc(r.titulo)}</h3></div>`).join("");
    return;
  }
  const r = list.find((x) => x.id === id);
  if (!r) return go("cultura");
  $view.gloss = r.glosario;
  $view.innerHTML = `<button class="link back" data-go="cultura">Cultura</button>
    <span class="section-label">${esc(r.tema)}</span><h2>${esc(r.titulo)}</h2>
    <div class="row" style="margin-bottom:12px">${listenBtn(r.texto.join(" "), "Escuchar el texto")}</div>
    <div class="reading">${r.texto.map((t) => `<p>${glossify(t, r.glosario)}</p>`).join("")}</div>
    <p class="muted small">Toca las palabras subrayadas para ver su significado.</p>
    <h3>Preguntas</h3>
    ${r.preguntas.map((q) => `<div class="card"><p>${esc(q.q)}</p><details><summary>Ver respuesta</summary><p>${esc(q.a)}</p></details></div>`).join("")}`;
};

views.actualidad = () => {
  const n = data.news;
  if (!n) { $view.innerHTML = `<h2>Actualidad</h2><p>No hay noticias cargadas.</p>`; return; }
  const ids = new Set(state.custom.map((c) => c.id));
  $view.innerHTML = `<h2>Actualidad</h2>
    <p class="muted">${esc(n.semana)} · actualizado ${esc(n.actualizado)}</p>
    ${n.historias.map((h) => `<details class="card">
      <summary><span class="section-label">${esc(h.seccion)}</span><br><b style="color:var(--ink)">${esc(h.titular)}</b></summary>
      <p class="reading" style="margin-top:10px">${esc(h.resumen)}</p>
      <div class="row">${listenBtn(h.titular + ". " + h.resumen)}</div>
      ${h.como ? `<div class="como"><b>Cómo lo cuentan.</b> ${esc(h.como)}</div>` : ""}
      <p class="muted small" style="margin:10px 0 6px">Vocabulario (toca para añadir a tus tarjetas)</p>
      <div class="row">${h.vocab.map((v) => {
        const id = "n-" + slug(v.es);
        return `<button class="chip ${ids.has(id) ? "added" : ""}" data-add="${esc(h.id)}|${esc(v.es)}">${esc(v.es)} · ${esc(v.en)}</button>`;
      }).join("")}</div>
      <p class="sources" style="margin-top:12px">${h.fuentes.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.nombre)}</a>`).join("")}</p>
    </details>`).join("")}
    <p class="muted small">${esc(n.nota)}</p>`;
};
function addNewsWord(key) {
  const [hid, es] = key.split("|");
  const h = data.news.historias.find((x) => x.id === hid);
  const v = h && h.vocab.find((x) => x.es === es);
  if (!v) return;
  const id = "n-" + slug(v.es);
  if (state.custom.some((c) => c.id === id)) return;
  state.custom.push({ id, es: v.es, en: v.en, reg: h.seccion.toLowerCase(), ej: "", col: [], nota: `De: ${h.titular}` });
  save();
  session = null;
}

let timer = null;
views.dele = (id) => {
  const d = data.dele;
  if (!d) return;
  if (id) return deleWriting(id);
  $view.innerHTML = `<h2>DELE C1</h2>
    <div class="como">${esc(d.aviso)}</div>
    <p>${esc(d.aprobado)}</p>
    ${d.pruebas.map((p) => `<div class="card">
      <span class="section-label">Prueba ${p.n} · ${esc(p.duracion)} · ${p.puntos} puntos</span>
      <h3>${esc(p.nombre)}</h3>
      <ul class="list-plain">${p.tareas.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <p class="small muted">${esc(p.consejo)}</p></div>`).join("")}
    <h3>Práctica de expresión escrita</h3>
    ${d.escritura.map((w) => `<div class="card tap" data-go="dele/${w.id}"><span class="section-label">${esc(w.tipo)} · ${w.minutos} min · ${esc(w.palabras)} palabras</span><p style="margin-top:6px">${esc(w.enunciado.slice(0, 110))}…</p></div>`).join("")}`;
};
function deleWriting(id) {
  const w = data.dele.escritura.find((x) => x.id === id);
  if (!w) return go("dele");
  const draft = state.drafts[id] || "";
  $view.innerHTML = `<button class="link back" data-go="dele">DELE</button>
    <span class="section-label">${esc(w.tipo)} · ${esc(w.palabras)} palabras</span>
    <p>${esc(w.enunciado)}</p>
    <div class="row spread"><span class="timer" id="clock">${w.minutos}:00</span>
      <button class="primary" id="startTimer">Empezar</button></div>
    <textarea class="writing" id="draft" placeholder="Escribe aquí…">${esc(draft)}</textarea>
    <div class="row spread" style="margin-top:8px"><span class="muted" id="wc"></span>
      <button class="ghost" id="copyDraft">Copiar para Claude</button></div>
    <p class="muted small">Pega el texto en Claude y pide una corrección con criterios del DELE C1.</p>`;
  const ta = document.getElementById("draft");
  const wc = () => { document.getElementById("wc").textContent = `${(ta.value.match(/\S+/g) || []).length} palabras`; };
  wc();
  ta.addEventListener("input", () => { state.drafts[id] = ta.value; save(); wc(); });
  document.getElementById("copyDraft").onclick = () => copy(`Corrige este texto (${w.tipo}, DELE C1) y puntúalo:\n\nEnunciado: ${w.enunciado}\n\n${ta.value}`);
  document.getElementById("startTimer").onclick = (e) => {
    clearInterval(timer);
    let left = w.minutos * 60;
    e.target.textContent = "Reiniciar";
    timer = setInterval(() => {
      left--;
      const el = document.getElementById("clock");
      if (!el) return clearInterval(timer);
      el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      if (left <= 0) { clearInterval(timer); el.textContent = "Tiempo"; }
    }, 1000);
  };
}

views.apuntar = () => {
  $view.innerHTML = `<h2>Apuntar</h2>
    <p class="muted">Palabras o frases que oigas por la calle. Luego cópialas y pásaselas a Claude para convertirlas en tarjetas.</p>
    <div class="row"><input type="text" id="noteIn" placeholder="p. ej. 'me ha cundido' en el bar" style="flex:1">
      <button class="primary" id="noteAdd">Guardar</button></div>
    <div id="notes" style="margin-top:12px">${state.notes.map((n, i) =>
      `<div class="note-item"><span>${esc(n.text)} <span class="muted small">${esc(n.date)}</span></span><button class="link" data-del="${i}">Quitar</button></div>`).join("") || `<p class="muted">Todavía no has apuntado nada.</p>`}</div>
    ${state.notes.length ? `<div class="row" style="margin-top:12px"><button class="ghost" id="copyNotes">Copiar todo</button><button class="ghost" id="clearNotes">Vaciar lista</button></div>` : ""}`;
  const add = () => {
    const el = document.getElementById("noteIn");
    if (!el.value.trim()) return;
    state.notes.push({ text: el.value.trim(), date: todayKey() });
    save(); views.apuntar();
  };
  document.getElementById("noteAdd").onclick = add;
  document.getElementById("noteIn").onkeydown = (e) => { if (e.key === "Enter") add(); };
  const c = document.getElementById("copyNotes");
  if (c) c.onclick = () => copy("Convierte estas notas en tarjetas para mi app de español C1:\n" + state.notes.map((n) => `- ${n.text}`).join("\n"));
  const cl = document.getElementById("clearNotes");
  if (cl) cl.onclick = () => { if (confirm("¿Vaciar la lista? Cópiala antes si no se la has pasado a Claude.")) { state.notes = []; save(); views.apuntar(); } };
};

views.ajustes = () => {
  refreshVoices();
  $view.innerHTML = `<h2>Ajustes</h2>
    <div class="card"><h3>Voz</h3>
      <label class="muted small">Voz en español</label>
      <select id="voice"><option value="">Automática (es-ES si existe)</option>
        ${voices.map((v) => `<option ${v.name === state.settings.voice ? "selected" : ""} value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</select>
      <label class="muted small" style="display:block;margin-top:10px">Velocidad: <span id="rateVal">${state.settings.rate}</span></label>
      <input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${state.settings.rate}" style="width:100%">
      <div class="row" style="margin-top:8px">${listenBtn("Me ha cundido mucho el día, la verdad.", "Probar voz")}</div>
      <p class="muted small" style="margin-top:8px">En iPhone, las voces de mejor calidad se descargan en Ajustes > Accesibilidad > Contenido leído > Voces > Español (España).</p>
    </div>
    <div class="card"><h3>Repaso</h3>
      <label class="muted small">Palabras nuevas al día</label>
      <input type="text" inputmode="numeric" id="npd" value="${state.settings.newPerDay}">
    </div>
    <div class="card"><h3>Copia de seguridad</h3>
      <p class="muted small">El progreso solo vive en este móvil. Exporta de vez en cuando.</p>
      <div class="row"><button class="ghost" id="exp">Exportar</button><button class="ghost" id="imp">Importar</button></div>
      <input type="file" id="impFile" accept="application/json" hidden>
    </div>
    <p class="muted small">Sin rachas, sin puntos, sin notificaciones.</p>`;
  document.getElementById("voice").onchange = (e) => { state.settings.voice = e.target.value; save(); };
  document.getElementById("rate").oninput = (e) => { state.settings.rate = +e.target.value; document.getElementById("rateVal").textContent = e.target.value; save(); };
  document.getElementById("npd").onchange = (e) => { const n = parseInt(e.target.value, 10); if (n >= 0) { state.settings.newPerDay = n; save(); session = null; } };
  document.getElementById("exp").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `espanol-c1-backup-${todayKey()}.json`;
    a.click();
  };
  const f = document.getElementById("impFile");
  document.getElementById("imp").onclick = () => f.click();
  f.onchange = async () => {
    try {
      const s = JSON.parse(await f.files[0].text());
      if (!s.cards) throw new Error();
      state = { ...loadState(), ...s };
      save(); session = null; alert("Importado.");
    } catch (e) { alert("Ese archivo no es una copia válida."); }
  };
};

// ---------- routing and events ----------
function go(route) { location.hash = route; }
function render() {
  const [name, arg] = (location.hash.slice(1) || "vocab").split("/");
  const fn = views[name] || views.vocab;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.go === name ? "page" : "false"));
  fn(arg);
  window.scrollTo(0, 0);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); alert("Copiado."); }
  catch (e) { prompt("Copia el texto:", text); }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-go]");
  const pop = document.querySelector(".gloss-pop");
  if (pop && !(t && t.dataset.gloss)) pop.remove();
  if (!t) return;
  if (t.dataset.go) { if (t.dataset.go.startsWith("vocab")) session = null; go(t.dataset.go); return; }
  if (t.dataset.say) return speak(t.dataset.say);
  if (t.dataset.act === "show") { session.shown = true; return views.vocab(); }
  if (t.dataset.rate) {
    const card = session.queue.shift();
    rate(card, t.dataset.rate);
    if (t.dataset.rate === "again") session.queue.push(card);
    session.shown = false;
    return views.vocab();
  }
  if (t.dataset.check) return checkExercise(+t.dataset.check);
  if (t.dataset.add) { addNewsWord(t.dataset.add); t.classList.add("added"); return; }
  if (t.dataset.del) { state.notes.splice(+t.dataset.del, 1); save(); return views.apuntar(); }
  if (t.dataset.gloss) {
    if (pop) pop.remove();
    const g = $view.gloss[+t.dataset.gloss];
    const div = document.createElement("div");
    div.className = "gloss-pop";
    div.innerHTML = `<b>${esc(g.termino)}</b>: ${esc(g.def)}`;
    document.body.appendChild(div);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.ex) checkExercise(+e.target.dataset.ex);
});
window.addEventListener("hashchange", render);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

loadData().then(render);
