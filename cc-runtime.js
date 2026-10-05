/* Control Centre runtime: stands in for the services the app used inside Claude.
   db      -> Supabase table "docs" (one JSON document per path, private to the signed-in owner)
   assets  -> Supabase Storage bucket "shots" (private, signed URLs)
   sample  -> Google Gemini (key kept in this browser only)
   user    -> the signed-in owner
   downloads -> normal browser download */
(function () {
  const CFG = window.CC_CONFIG || {};
  const LS = {
    get(k) { try { return localStorage.getItem(k) } catch (_) { return null } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch (_) {} }
  };
  const configured = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
  const sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  let uid = null, email = "";
  let readyResolve; const ready = new Promise(r => (readyResolve = r));

  /* ---------- sign-in gate ---------- */
  function gate(html) {
    let g = document.getElementById("ccGate");
    if (!g) { g = document.createElement("div"); g.id = "ccGate"; document.body.appendChild(g) }
    g.innerHTML = html; g.hidden = false; return g;
  }
  function showLogin(msg) {
    const g = gate(`<div class="gbox"><small>BuildNET · Portfolio register</small><h1>Control Centre</h1>
      <p>Sign in to open your portfolio.</p>
      <form id="gForm"><label for="gEmail">Email</label><input id="gEmail" type="email" autocomplete="email" required value="${(LS.get("cc_email") || "").replace(/"/g, "")}">
      <label for="gPass">Password</label><input id="gPass" type="password" autocomplete="current-password" required minlength="8">
      <button class="btn primary" type="submit" id="gIn">Sign in</button>
      <button class="btn" type="button" id="gUp">Create my account (first time only)</button>
      <button class="link" type="button" id="gReset">Forgot password</button>
      <p class="gmsg" id="gMsg">${msg || ""}</p></form></div>`);
    const m = t => (g.querySelector("#gMsg").textContent = t);
    const vals = () => ({ email: g.querySelector("#gEmail").value.trim(), password: g.querySelector("#gPass").value });
    g.querySelector("#gForm").onsubmit = async e => {
      e.preventDefault(); m("Signing in…"); const v = vals(); LS.set("cc_email", v.email);
      const { error } = await sb.auth.signInWithPassword(v);
      if (error) m(error.message.includes("Invalid") ? "Email or password is wrong." : error.message);
    };
    g.querySelector("#gUp").onclick = async () => {
      const v = vals(); if (!v.email || v.password.length < 8) return m("Enter your email and a password of at least 8 characters.");
      m("Creating your account…");
      const { data, error } = await sb.auth.signUp(v);
      if (error) return m(error.message);
      if (!data.session) m("Account created. Check your email to confirm it, then sign in here.");
    };
    g.querySelector("#gReset").onclick = async () => {
      const v = vals(); if (!v.email) return m("Enter your email first.");
      const { error } = await sb.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin + location.pathname });
      m(error ? error.message : "Reset link sent. Open it on this device.");
    };
  }
  function showNewPassword() {
    const g = gate(`<div class="gbox"><h1>Set a new password</h1><form id="gNew"><label for="gNP">New password</label><input id="gNP" type="password" minlength="8" required autocomplete="new-password"><button class="btn primary" type="submit">Save password</button><p class="gmsg" id="gMsg"></p></form></div>`);
    g.querySelector("#gNew").onsubmit = async e => {
      e.preventDefault(); const { error } = await sb.auth.updateUser({ password: g.querySelector("#gNP").value });
      g.querySelector("#gMsg").textContent = error ? error.message : "Saved. Opening your portfolio…";
      if (!error) setTimeout(() => location.reload(), 800);
    };
  }
  function hideGate() { const g = document.getElementById("ccGate"); if (g) g.hidden = true }

  if (!configured) {
    document.addEventListener("DOMContentLoaded", () => gate(`<div class="gbox"><h1>Control Centre</h1><p>This copy isn't connected to a database yet. Put the Supabase project URL and publishable key in <code>config.js</code>, then reload.</p></div>`));
  } else {
    let started = false;
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "PASSWORD_RECOVERY") return showNewPassword();
      if (session && session.user) {
        uid = session.user.id; email = session.user.email || "";
        hideGate();
        if (!started) { started = true; startRealtime(); readyResolve(true) }
      } else if (ev !== "INITIAL_SESSION" || !session) {
        if (started) location.reload(); else showLogin();
      }
    });
  }
  window.ccAccount = {
    email: () => email,
    signOut: async () => { await sb.auth.signOut(); location.reload() },
    configured
  };

  /* ---------- db: Firestore-style documents on one Supabase table ---------- */
  const cache = new Map(); const docL = new Map(); const colL = new Map();
  const depth = p => p.split("/").length;
  const clone = o => JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };
  function snap(path, data) { return { id: path.split("/").pop(), exists: data != null, data: () => (data == null ? undefined : data), metadata: meta } }
  function colSnap(col) {
    const docs = [...cache.entries()].filter(([p]) => p.startsWith(col + "/") && depth(p) === depth(col) + 1).sort(([a], [b]) => a.localeCompare(b)).map(([p, d]) => snap(p, d));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
  }
  function emit(path) {
    const d = cache.get(path);
    (docL.get(path) || new Set()).forEach(cb => { try { cb(snap(path, d)) } catch (e) { console.error(e) } });
    const col = path.split("/").slice(0, -1).join("/");
    if (colL.has(col)) { const s = colSnap(col); colL.get(col).forEach(cb => { try { cb(s) } catch (e) { console.error(e) } }) }
  }
  const fail = error => { console.error(error); return { code: "unavailable", message: (error && error.message) || "Request failed" } };
  async function fetchDoc(path) {
    const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
    if (error) throw fail(error);
    if (data) cache.set(path, data.data); else cache.delete(path);
    return cache.get(path);
  }
  async function fetchCol(col) {
    const { data, error } = await sb.from("docs").select("path,data").like("path", col.replace(/[%_]/g, "\\$&") + "/%");
    if (error) throw fail(error);
    [...cache.keys()].filter(p => p.startsWith(col + "/") && depth(p) === depth(col) + 1).forEach(p => cache.delete(p));
    (data || []).forEach(r => { if (depth(r.path) === depth(col) + 1) cache.set(r.path, r.data) });
  }
  async function write(path, data) {
    cache.set(path, clone(data)); emit(path);
    const { error } = await sb.from("docs").upsert({ path, data, updated_at: new Date().toISOString() }, { onConflict: "owner,path" });
    if (error) throw fail(error);
  }
  function merge(a, b) {
    const out = { ...(a || {}) };
    Object.entries(b).forEach(([k, v]) => {
      if (v && typeof v === "object" && v.__delete__ === true) delete out[k];
      else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = merge(out[k], v);
      else out[k] = v;
    });
    return out;
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { return snap(path, await fetchDoc(path)) },
      async set(data) { await write(path, data) },
      async update(data) { const cur = cache.has(path) ? cache.get(path) : await fetchDoc(path); if (cur == null) throw { code: "invalid_argument", message: "Document does not exist" }; await write(path, merge(cur, data)) },
      async delete() { cache.delete(path); emit(path); const { error } = await sb.from("docs").delete().eq("path", path); if (error) throw fail(error) },
      onSnapshot(next, err) {
        if (!docL.has(path)) docL.set(path, new Set()); docL.get(path).add(next);
        fetchDoc(path).then(d => next(snap(path, d))).catch(e => err && err(e));
        return () => docL.get(path) && docL.get(path).delete(next);
      },
      collection(sub) { return colRef(path + "/" + sub) }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc(id) { return docRef(col + "/" + (id || Math.random().toString(36).slice(2, 12))) },
      async add(data) { const r = this.doc(); await r.set(data); return r },
      async get() { await fetchCol(col); return colSnap(col) },
      onSnapshot(next, err) {
        if (!colL.has(col)) colL.set(col, new Set()); colL.get(col).add(next);
        fetchCol(col).then(() => next(colSnap(col))).catch(e => err && err(e));
        return () => colL.get(col) && colL.get(col).delete(next);
      },
      where() { return this }, orderBy() { return this }, limit() { return this }
    };
  }
  function startRealtime() {
    sb.channel("docs-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "owner=eq." + uid }, payload => {
        if (payload.eventType === "DELETE") { const p = payload.old && payload.old.path; if (p && cache.has(p)) { cache.delete(p); emit(p) } return }
        const row = payload.new; if (!row || !row.path) return;
        if (JSON.stringify(cache.get(row.path)) === JSON.stringify(row.data)) return;
        cache.set(row.path, row.data); emit(row.path);
      }).subscribe();
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- export / import ---------- */
  window.ccData = {
    async exportAll() {
      const { data, error } = await sb.from("docs").select("path,data").order("path");
      if (error) throw fail(error);
      return { format: "control-centre-export", version: 1, exportedAt: new Date().toISOString(), docs: data };
    },
    async importAll(file) {
      if (!file || file.format !== "control-centre-export" || !Array.isArray(file.docs)) throw { message: "That file isn't a Control Centre export." };
      const rows = file.docs.filter(d => d && d.path && d.data).map(d => ({ path: d.path, data: d.data, updated_at: new Date().toISOString() }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from("docs").upsert(rows.slice(i, i + 200), { onConflict: "owner,path" });
        if (error) throw fail(error);
      }
      return rows.length;
    },
    async count() { const { count } = await sb.from("docs").select("path", { count: "exact", head: true }); return count || 0 }
  };

  /* ---------- assets: private screenshot storage ---------- */
  const signed = new Map();
  async function signedUrl(path) {
    if (signed.has(path)) return signed.get(path);
    const { data, error } = await sb.storage.from("shots").createSignedUrl(path, 60 * 60 * 6);
    if (error) return ""; signed.set(path, data.signedUrl); return data.signedUrl;
  }
  const assets = {
    async upload(blob) {
      const ext = (blob.type.split("/")[1] || "bin").replace("jpeg", "jpg");
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from("shots").upload(path, blob, { contentType: blob.type, upsert: false });
      if (error) throw fail(error);
      return { id: path, url: await signedUrl(path), sizeBytes: blob.size, contentType: blob.type };
    }
  };
  // fill <img data-shot="path"> with a signed URL whenever one appears
  new MutationObserver(() => {
    document.querySelectorAll("img[data-shot]:not([data-filled])").forEach(async img => {
      img.setAttribute("data-filled", "1"); const u = await signedUrl(img.getAttribute("data-shot")); if (u) img.src = u;
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- sample: Gemini reads dictated updates ---------- */
  window.ccAI = {
    key: () => LS.get("cc_gemini_key") || "",
    model: () => LS.get("cc_gemini_model") || "",
    save(key, model) { LS.set("cc_gemini_key", key || null); LS.set("cc_gemini_model", model || null) },
    async listModels(key) {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(key));
      if (!r.ok) throw { code: "bad_key", message: "Google rejected that key." };
      const j = await r.json();
      const ok = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""))
        .filter(n => /gemini/i.test(n) && !/(image|tts|audio|live|embed|vision-preview|thinking-exp)/i.test(n));
      const ver = n => { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0 };
      const rank = n => (/flash/i.test(n) ? 2 : 0) + (/lite/i.test(n) ? -1 : 0) + (/preview|exp/i.test(n) ? -0.5 : 0);
      return ok.sort((a, b) => rank(b) - rank(a) || ver(b) - ver(a));
    }
  };
  async function toPart(blob) {
    let b = blob;
    try {
      const bmp = await createImageBitmap(blob); const max = 1600, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (s < 1 || blob.size > 1.5e6) {
        const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
      }
    } catch (_) {}
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(b) });
    return { inline_data: { mime_type: b.type || "image/jpeg", data } };
  }
  function parseJSON(t) {
    try { return JSON.parse(t) } catch (_) {}
    const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]) } catch (_) {} }
    const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch (_) {} }
    throw { code: "invalid_json", message: "Reply was not JSON", text: t };
  }
  async function geminiJSON(input, opts = {}) {
    const key = window.ccAI.key(); if (!key) throw { code: "no_key", message: "No Gemini key" };
    let model = window.ccAI.model();
    if (!model) { const list = await window.ccAI.listModels(key); model = list[0]; if (!model) throw { code: "bad_key" }; LS.set("cc_gemini_model", model) }
    const prompt = typeof input === "string" ? input : input.map(t => t.content).join("\n\n");
    const parts = [{ text: prompt }];
    if (opts.images) for (const im of Array.from(opts.images)) parts.push(await toPart(im));
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: opts.signal,
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } })
      });
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "upstream_error", message: String(e) } }
    if (r.status === 429) throw { code: "rate_limited", message: "Gemini free-tier limit reached" };
    if (r.status === 400 || r.status === 401 || r.status === 403) { const t = await r.text(); throw { code: /API key|PERMISSION|API_KEY/i.test(t) ? "bad_key" : "upstream_error", message: t } }
    if (r.status === 404) { LS.set("cc_gemini_model", null); throw { code: "upstream_error", message: "Model not found. Try again to pick another." } }
    if (!r.ok) throw { code: "upstream_error", message: await r.text() };
    const j = await r.json();
    if (j.promptFeedback && j.promptFeedback.blockReason) throw { code: "refused", message: j.promptFeedback.blockReason };
    const text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || "").join("");
    if (!text.trim()) throw { code: "empty_completion", message: "Empty reply" };
    return parseJSON(text);
  }
  const sample = async (input, opts) => { const out = await geminiJSON(input, opts); return { text: JSON.stringify(out), truncated: false, modelTierApplied: "default" } };
  sample.json = geminiJSON;
  sample.limits = async () => ({ maxPromptBytes: 900000, images: { maxCount: 4, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });
  window.ccHasKey = () => !!window.ccAI.key();

  /* ---------- user + downloads ---------- */
  const user = { isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => uid, me: async () => ({ id: uid, name: "", email }) };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000);
      return { status: "saved" };
    }
  };

  /* ---------- the window.claude shape the app expects ---------- */
  const caps = { db, assets, sample, user, downloads };
  window.claude = {
    async use(name) { if (!configured) return null; await ready; return caps[name] || null }
  };
})();
