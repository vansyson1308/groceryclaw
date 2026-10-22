// MCP Apps (SEP-1865, spec 2026-01-26): an interactive reorder plan for hosts
// that render `ui://` resources. suggest_reorder declares it in
// `_meta.ui.resourceUri`; hosts without MCP Apps keep the spoken/text answer,
// which stays complete on its own. The page is one self-contained HTML file
// (no external origins, so the host's default CSP applies) that speaks the
// MCP Apps postMessage JSON-RPC: ui/initialize, ui/notifications/initialized,
// ui/notifications/tool-result, ui/notifications/size-changed, and proxied
// tools/call for create_reorder_draft and confirm_reorder. Every order still
// takes two explicit steps: "Draft" and then "Confirm", both clicked by the owner.

export const REORDER_PLAN_URI = 'ui://shopvoice/reorder-plan';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** Tool `_meta` that points MCP Apps hosts at the plan view (legacy key kept for older hosts). */
export const REORDER_PLAN_TOOL_META: Record<string, unknown> = {
  ui: { resourceUri: REORDER_PLAN_URI },
  'ui/resourceUri': REORDER_PLAN_URI
};

export const REORDER_PLAN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShopVoice reorder plan</title>
<style>
  :root { color-scheme: light dark; --fg: #1d2433; --muted: #5b6475; --line: #d9dee8; --accent: #0f766e; --bg: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8ecf5; --muted: #9aa5bb; --line: #2b3550; --accent: #34d399; --bg: #0f1526; } }
  body { margin: 0; padding: 12px; font: 14px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  h1 { font-size: 16px; margin: 0 0 4px; } .muted { color: var(--muted); font-size: 12px; }
  section { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 10px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  td, th { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); font-size: 13px; }
  input { width: 72px; font: inherit; padding: 2px 4px; }
  button { font: inherit; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; }
  button.primary { background: var(--accent); color: var(--bg); } button:disabled { opacity: .5; cursor: default; }
  .status { margin-top: 6px; font-size: 13px; } .rule { font-size: 12px; color: var(--accent); }
</style>
</head>
<body>
<h1>Reorder plan</h1>
<div class="muted" id="summary">Waiting for the plan…</div>
<div id="rules"></div>
<div id="plan"></div>
<script>
(function () {
  var nextId = 1;
  var pending = {};
  var data = null;
  function send(msg) { window.parent.postMessage(msg, '*'); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  function money(v) { return (data && data.currency === 'USD' ? '$' : '') + Math.round(v).toLocaleString() + (data && data.currency !== 'USD' ? ' ' + data.currency : ''); }

  window.addEventListener('message', function (event) {
    var m = event.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id !== undefined && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id];
      if (m.error) p.reject(new Error(m.error.message || 'error')); else p.resolve(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-result' && m.params && m.params.structuredContent) render(m.params.structuredContent);
  });

  function render(sc) {
    data = sc;
    var plan = document.getElementById('plan');
    plan.textContent = '';
    document.getElementById('summary').textContent = sc.item_count
      ? sc.item_count + ' items from ' + sc.suppliers.length + ' suppliers, about ' + money(sc.total) + '. Edit quantities, then draft and confirm each supplier.'
      : 'Nothing needs reordering right now.';
    var rules = document.getElementById('rules');
    rules.textContent = '';
    (sc.applied_rules || []).forEach(function (r) { rules.appendChild(el('div', 'As you asked: ' + r.rule, 'rule')); });
    (sc.suppliers || []).forEach(function (s) {
      var box = el('section');
      var head = el('header');
      head.appendChild(el('strong', s.supplier_name));
      head.appendChild(el('span', 'about ' + money(s.total), 'muted'));
      box.appendChild(head);
      var table = el('table');
      var hr = el('tr'); ['Product', 'On hand', 'Order'].forEach(function (h) { hr.appendChild(el('th', h)); }); table.appendChild(hr);
      var inputs = [];
      s.lines.forEach(function (l) {
        var tr = el('tr');
        tr.appendChild(el('td', l.name));
        tr.appendChild(el('td', String(l.on_hand)));
        var td = el('td'); var input = el('input'); input.type = 'number'; input.min = '0'; input.step = String(l.pack_size || 1); input.value = String(l.suggested_qty);
        input.setAttribute('aria-label', 'Quantity of ' + l.name); td.appendChild(input); tr.appendChild(td);
        inputs.push({ line: l, input: input });
        table.appendChild(tr);
      });
      box.appendChild(table);
      var draft = el('button', 'Draft ' + s.supplier_name);
      var confirm = el('button', 'Confirm', 'primary'); confirm.disabled = true;
      var status = el('div', '', 'status');
      var token = null;
      draft.onclick = function () {
        var items = inputs.filter(function (x) { return Number(x.input.value) > 0; }).map(function (x) { return { product: x.line.name, qty: Number(x.input.value) }; });
        if (!items.length) { status.textContent = 'Nothing to order.'; return; }
        draft.disabled = true; status.textContent = 'Drafting…';
        request('tools/call', { name: 'create_reorder_draft', arguments: { items: items } }).then(function (res) {
          var sc2 = res && res.structuredContent;
          status.textContent = (res && res.content && res.content[0] && res.content[0].text) || '';
          if (sc2 && sc2.status === 'draft_created') { token = sc2.confirmation_token; confirm.disabled = false; } else { draft.disabled = false; }
        }).catch(function (e) { status.textContent = 'Could not draft: ' + e.message; draft.disabled = false; });
      };
      confirm.onclick = function () {
        if (!token) return;
        confirm.disabled = true; status.textContent = 'Confirming…';
        request('tools/call', { name: 'confirm_reorder', arguments: { confirmation_token: token } }).then(function (res) {
          token = null;
          status.textContent = (res && res.content && res.content[0] && res.content[0].text) || 'Done.';
        }).catch(function (e) { status.textContent = 'Could not confirm: ' + e.message; confirm.disabled = false; });
      };
      var row = el('div'); row.appendChild(draft); row.appendChild(document.createTextNode(' ')); row.appendChild(confirm);
      box.appendChild(row); box.appendChild(status);
      plan.appendChild(box);
    });
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () {
      notify('ui/notifications/size-changed', { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
    }).observe(document.body);
  }
  request('ui/initialize', { protocolVersion: '2026-01-26', appCapabilities: {}, appInfo: { name: 'shopvoice-reorder-plan', version: '1.0.0' } })
    .then(function () { notify('ui/notifications/initialized'); })
    .catch(function () { notify('ui/notifications/initialized'); });
})();
</script>
</body>
</html>
`;
