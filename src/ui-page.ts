export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlowDoc</title>
<style>
  :root {
    --bg: #fafaf9;
    --surface: #ffffff;
    --surface-2: #f4f4f1;
    --border: #e5e5e3;
    --text: #1a1a1a;
    --text-dim: #6b6b6b;
    --accent: #2d9bf0;
    --accent-soft: #e8f3fd;
    --good: #4caf50;
    --bad: #e74c3c;
    --warn: #d99500;
    --code-bg: #f4f4f1;
    --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131312;
      --surface: #1c1c1b;
      --surface-2: #232321;
      --border: #2c2c2a;
      --text: #f0f0ee;
      --text-dim: #9c9c9a;
      --accent: #4eaff5;
      --accent-soft: #1a3247;
      --good: #5fc262;
      --bad: #ef6e60;
      --warn: #e5b04a;
      --code-bg: #232321;
      --shadow: 0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; line-height: 1.5; }
  .wrap { display: grid; grid-template-columns: 1fr; gap: 0; min-height: 100vh; }
  @media (min-width: 1100px) { .wrap { grid-template-columns: 1fr 1fr; } }
  header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 16px 28px; background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; }
  .brand { font-weight: 700; letter-spacing: -0.005em; font-size: 18px; }
  .brand small { color: var(--text-dim); font-weight: 400; margin-left: 8px; font-size: 13px; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); font-size: 13px; }
  .pill.idle { color: var(--text-dim); }
  .pill.running { color: var(--accent); background: var(--accent-soft); }
  .pill.failed { color: var(--bad); background: rgba(231, 76, 60, 0.12); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .pill.running .dot { animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
  .cards { padding: 24px 28px; display: grid; grid-template-columns: 1fr; gap: 16px; align-content: start; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; box-shadow: var(--shadow); }
  .card h2 { margin: 0 0 4px; font-size: 16px; letter-spacing: -0.005em; }
  .card p.hint { margin: 0 0 12px; color: var(--text-dim); font-size: 13px; }
  .row { display: grid; grid-template-columns: 110px 1fr; gap: 10px 12px; align-items: center; margin-bottom: 10px; }
  .row label { font-size: 13px; color: var(--text-dim); }
  input[type="text"], input[type="password"], select { width: 100%; padding: 7px 10px; font: inherit; font-size: 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  select[multiple] { min-height: 80px; }
  .checkbox { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  button { font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--code-bg); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.primary:hover:not(:disabled) { filter: brightness(0.95); }
  button.danger { background: var(--bad); color: #fff; border-color: var(--bad); }
  button.danger:hover:not(:disabled) { filter: brightness(0.95); }
  button.good { background: var(--good); color: #fff; border-color: var(--good); }
  .logs { position: sticky; top: 73px; align-self: start; padding: 24px 28px 24px 0; }
  @media (max-width: 1099px) { .logs { position: static; padding: 0 28px 28px; } }
  .log-frame { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; height: calc(100vh - 130px); display: flex; flex-direction: column; box-shadow: var(--shadow); }
  @media (max-width: 1099px) { .log-frame { height: 50vh; } }
  .log-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .log-header h3 { margin: 0; font-size: 14px; font-weight: 600; }
  .log-body { flex: 1; overflow-y: auto; padding: 12px 16px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .log-body .stdout { color: var(--text); }
  .log-body .stderr { color: var(--bad); }
  .log-body .system { color: var(--text-dim); font-style: italic; }
  .log-body .empty { color: var(--text-dim); }
  .footer-hint { font-size: 12px; color: var(--text-dim); padding: 8px 16px; border-top: 1px solid var(--border); }
  .token-row { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--text-dim); }
  .token-row input { width: 360px; max-width: 100%; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-dim); }
  .badge.audio { background: var(--accent-soft); color: var(--accent); }
  .badge.transcript { background: rgba(76, 175, 80, 0.15); color: var(--good); }
  .open-link { font-size: 13px; color: var(--accent); text-decoration: none; margin-top: 8px; display: inline-block; }
  .open-link:hover { text-decoration: underline; }
  code { background: var(--code-bg); padding: 1px 6px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">FlowDoc <small>local control panel</small></div>
    <span id="status-pill" class="pill idle"><span class="dot"></span><span id="status-text">Idle</span></span>
  </header>

  <main class="cards">

    <section class="card" id="card-doctor">
      <h2>Doctor</h2>
      <p class="hint">Check that your environment is set up. Diagnose only — never auto-installs.</p>
      <div class="actions">
        <button class="primary" data-cmd="doctor">Run doctor</button>
      </div>
    </section>

    <section class="card" id="card-capture">
      <h2>Capture</h2>
      <p class="hint">Two-step capture: <b>Start</b> opens the browser, <b>Start recording</b> begins capturing clicks + audio (equivalent to pressing Enter in the terminal). <b>Stop</b> only works once recording has begun.</p>
      <div class="row"><label for="cap-url">URL</label><input id="cap-url" type="text" placeholder="https://example.com"></div>
      <div class="row"><label for="cap-name">Name</label><input id="cap-name" type="text" placeholder="my-flow"></div>
      <div class="row"><label for="cap-mic">Mic</label><select id="cap-mic"></select></div>
      <div class="row"><label></label>
        <label class="checkbox"><input id="cap-no-audio" type="checkbox"> No audio</label>
      </div>
      <div class="actions">
        <button class="primary" id="cap-start" data-cmd="capture">Start</button>
        <button class="good" id="cap-enter" disabled>Start recording (Enter)</button>
        <button class="danger" id="cap-stop" disabled>Stop &amp; save (Ctrl+C)</button>
      </div>
    </section>

    <section class="card" id="card-transcribe">
      <h2>Transcribe</h2>
      <p class="hint">Run KBLab whisper on the audio narration. Local, Swedish.</p>
      <div class="row"><label for="tr-flow">Flow</label><select id="tr-flow"></select></div>
      <div class="actions">
        <button class="primary" data-cmd="transcribe">Run transcribe</button>
      </div>
    </section>

    <section class="card" id="card-site">
      <h2>Site</h2>
      <p class="hint">Re-generate the HTML documentation site for a flow.</p>
      <div class="row"><label for="site-flow">Flow</label><select id="site-flow"></select></div>
      <div class="actions">
        <button class="primary" data-cmd="site">Generate</button>
        <a id="site-open" class="open-link" style="display:none" href="#" target="_blank">Open index.html ↗</a>
      </div>
    </section>

    <section class="card" id="card-miro">
      <h2>Miro</h2>
      <p class="hint">Push a flow to a Miro board. Add branches to fork the layout.</p>
      <div class="row"><label for="miro-flow">Main flow</label><select id="miro-flow"></select></div>
      <div class="row"><label for="miro-branches">Branches</label><select id="miro-branches" multiple></select></div>
      <div class="row"><label for="miro-board">Board ID</label><input id="miro-board" type="text" placeholder="uXjVHOPXDss="></div>
      <div class="row"><label></label>
        <div class="token-row">
          <span id="miro-token-state">token: …</span>
          <input id="miro-token-input" type="password" placeholder="override (in-memory only)">
          <button id="miro-token-set">Set</button>
        </div>
      </div>
      <div class="actions">
        <button class="primary" data-cmd="miro">Push to Miro</button>
      </div>
    </section>

  </main>

  <aside class="logs">
    <div class="log-frame">
      <div class="log-header">
        <h3 id="log-title">Log</h3>
        <button id="log-clear">Clear</button>
      </div>
      <div id="log-body" class="log-body"><span class="empty">No output yet. Run a command to see live logs here.</span></div>
      <div class="footer-hint">Streaming over Server-Sent Events. Refresh-safe.</div>
    </div>
  </aside>
</div>

<script>
(function() {
  const $ = (id) => document.getElementById(id);
  const logBody = $("log-body");
  const logTitle = $("log-title");
  const statusPill = $("status-pill");
  const statusText = $("status-text");
  const capStart = $("cap-start");
  const capEnter = $("cap-enter");
  const capStop = $("cap-stop");
  const tokenState = $("miro-token-state");
  const tokenInput = $("miro-token-input");
  const siteOpen = $("site-open");
  const cmdButtons = Array.from(document.querySelectorAll("button[data-cmd]"));

  let evtSource = null;
  let elapsedTimer = null;
  let currentSession = null;

  async function api(method, path, body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || ("HTTP " + res.status));
    }
    return data;
  }

  function setStatus(state, label) {
    statusPill.className = "pill " + state;
    statusText.textContent = label;
  }

  function setLogTitle(t) { logTitle.textContent = t; }

  function appendLog(line) {
    if (logBody.querySelector(".empty")) logBody.innerHTML = "";
    const span = document.createElement("div");
    span.className = line.stream;
    span.textContent = line.text || "";
    logBody.appendChild(span);
    logBody.scrollTop = logBody.scrollHeight;
  }

  function clearLog() {
    logBody.innerHTML = '<span class="empty">No output yet. Run a command to see live logs here.</span>';
  }

  function setBusy(busy, name, started) {
    cmdButtons.forEach((b) => {
      b.disabled = busy;
      b.dataset.busy = busy ? "1" : "0";
    });
    if (busy && name === "capture") {
      capStart.disabled = true;
      capEnter.disabled = !!started;     // disable once recording has begun
      capStop.disabled = !started;       // enable only after recording has begun
    } else {
      capEnter.disabled = true;
      capStop.disabled = true;
    }
  }

  function startElapsed(startedAt) {
    stopElapsed();
    function tick() {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(s / 60).toString();
      const ss = (s % 60).toString().padStart(2, "0");
      const namePart = currentSession ? (currentSession + " · ") : "";
      setStatus("running", "Running " + namePart + m + ":" + ss);
    }
    tick();
    elapsedTimer = setInterval(tick, 500);
  }
  function stopElapsed() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  }

  function attachStream() {
    if (evtSource) { evtSource.close(); }
    evtSource = new EventSource("/api/stream");
    evtSource.onmessage = (msg) => {
      let line;
      try { line = JSON.parse(msg.data); } catch { return; }
      if (line.stream === "system" && line.text && line.text.startsWith("__DONE__")) {
        const code = parseInt(line.text.replace("__DONE__", "").trim(), 10);
        stopElapsed();
        setBusy(false, null, false);
        if (code === 0) {
          setStatus("idle", "Done");
          if (currentSession === "site") showSiteOpen();
        } else {
          setStatus("failed", "Exited with code " + code);
        }
        currentSession = null;
        refreshFlows();
        return;
      }
      appendLog(line);
    };
    evtSource.onerror = () => {
      if (evtSource) { evtSource.close(); evtSource = null; }
    };
  }

  function showSiteOpen() {
    const flow = $("site-flow").value;
    if (!flow) return;
    siteOpen.href = "/flowdocs/" + flow + "/index.html";
    siteOpen.style.display = "inline-block";
  }

  function badgeListFor(flow) {
    const out = [];
    if (flow.hasAudio) out.push('<span class="badge audio">audio</span>');
    if (flow.hasTranscripts) out.push('<span class="badge transcript">transcript</span>');
    if (flow.stepCount) out.push('<span class="badge">' + flow.stepCount + ' steps</span>');
    return out.join("");
  }

  function fillSelect(id, flows, includeNone) {
    const sel = $(id);
    const previousValue = sel.multiple ? Array.from(sel.selectedOptions).map((o) => o.value) : sel.value;
    sel.innerHTML = "";
    if (includeNone) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "(pick a flow)";
      sel.appendChild(opt);
    }
    for (const f of flows) {
      const opt = document.createElement("option");
      opt.value = f.name;
      const badges = [f.stepCount + " steps", f.hasAudio ? "audio" : null, f.hasTranscripts ? "transcript" : null].filter(Boolean).join(" · ");
      opt.textContent = f.name + (badges ? "  (" + badges + ")" : "");
      sel.appendChild(opt);
    }
    if (sel.multiple) {
      for (const opt of sel.options) {
        if (previousValue.includes(opt.value)) opt.selected = true;
      }
    } else if (previousValue) {
      sel.value = previousValue;
    }
  }

  async function refreshMics() {
    try {
      const data = await api("GET", "/api/mics");
      const sel = $("cap-mic");
      sel.innerHTML = "";
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      const defaultName = data.defaultName || "system default";
      defaultOpt.textContent = "Default (" + defaultName + ")";
      sel.appendChild(defaultOpt);
      (data.devices || []).forEach((name, idx) => {
        if (!name) return;
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = "[" + idx + "] " + name;
        sel.appendChild(opt);
      });
    } catch (err) {
      console.error("mics", err);
    }
  }

  async function refreshFlows() {
    try {
      const flows = await api("GET", "/api/flows");
      const usable = flows.filter((f) => f.stepCount > 0);
      const audioReady = usable.filter((f) => f.hasAudio);
      fillSelect("tr-flow", audioReady, true);
      fillSelect("site-flow", usable, true);
      fillSelect("miro-flow", usable, true);
      fillSelect("miro-branches", usable, false);
    } catch (err) {
      console.error("flows", err);
    }
  }

  function tokenStateText(set) { return set ? "token: ✓ set" : "token: not set"; }

  async function refreshStatus() {
    try {
      const status = await api("GET", "/api/status");
      tokenState.textContent = tokenStateText(status.miroTokenSet);
      if (status.idle) {
        currentSession = null;
        stopElapsed();
        setBusy(false, null, false);
        setStatus("idle", "Idle");
      } else {
        currentSession = status.name;
        setLogTitle("Log · " + status.name);
        clearLog();
        for (const line of (status.output || [])) appendLog(line);
        setBusy(true, status.name, !!status.started);
        if (status.exitCode !== null) {
          stopElapsed();
          setBusy(false, null, false);
          setStatus(status.exitCode === 0 ? "idle" : "failed", status.exitCode === 0 ? "Done" : "Exited " + status.exitCode);
          currentSession = null;
        } else {
          startElapsed(status.startedAt);
        }
        attachStream();
      }
    } catch (err) {
      console.error("status", err);
    }
  }

  cmdButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cmd = btn.dataset.cmd;
      const args = collectArgs(cmd);
      if (!args) return;
      clearLog();
      setLogTitle("Log · " + cmd);
      siteOpen.style.display = "none";
      try {
        await api("POST", "/api/start", { command: cmd, args });
        currentSession = cmd;
        // For capture, "started" stays false until the user clicks "Start recording".
        setBusy(true, cmd, false);
        startElapsed(Date.now());
        attachStream();
      } catch (err) {
        appendLog({ stream: "stderr", text: "Failed to start: " + err.message });
        setStatus("failed", "Failed");
      }
    });
  });

  capEnter.addEventListener("click", async () => {
    try {
      await api("POST", "/api/send-enter");
      appendLog({ stream: "system", text: "→ Sent Enter (recording started)" });
      setBusy(true, "capture", true);
    } catch (err) {
      appendLog({ stream: "stderr", text: err.message });
    }
  });

  capStop.addEventListener("click", async () => {
    capStop.disabled = true;
    try {
      await api("POST", "/api/stop");
      appendLog({ stream: "system", text: "→ Sent SIGINT (stopping… give it a moment to finish writing files)" });
    } catch (err) {
      appendLog({ stream: "stderr", text: err.message });
      capStop.disabled = false;
    }
  });

  $("log-clear").addEventListener("click", clearLog);

  $("miro-token-set").addEventListener("click", async () => {
    try {
      const r = await api("POST", "/api/miro-token", { token: tokenInput.value });
      tokenInput.value = "";
      tokenState.textContent = tokenStateText(r.miroTokenSet);
    } catch (err) {
      appendLog({ stream: "stderr", text: err.message });
    }
  });

  function collectArgs(cmd) {
    if (cmd === "capture") {
      const url = $("cap-url").value.trim();
      const name = $("cap-name").value.trim();
      if (!url) { alert("URL is required"); return null; }
      if (!name) { alert("Name is required"); return null; }
      return {
        url, name,
        mic: $("cap-mic").value.trim() || undefined,
        noAudio: $("cap-no-audio").checked,
      };
    }
    if (cmd === "transcribe") {
      const flow = $("tr-flow").value;
      if (!flow) { alert("Pick a flow"); return null; }
      return { flow };
    }
    if (cmd === "site") {
      const flow = $("site-flow").value;
      if (!flow) { alert("Pick a flow"); return null; }
      return { flow };
    }
    if (cmd === "miro") {
      const flow = $("miro-flow").value;
      const board = $("miro-board").value.trim();
      if (!flow) { alert("Pick a main flow"); return null; }
      if (!board) { alert("Board ID is required"); return null; }
      const branches = Array.from($("miro-branches").selectedOptions).map((o) => o.value).filter((v) => v && v !== flow);
      return { flow, board, branches };
    }
    if (cmd === "doctor") return {};
    return null;
  }

  refreshFlows();
  refreshMics();
  refreshStatus();
})();
</script>
</body>
</html>`;
