// ============================================================
// Acesso ao Supabase pela API REST (sem biblioteca, fetch nativo)
// ============================================================
'use strict';

function baseUrl() {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new Error('SUPABASE_URL nao configurada');
  return u.replace(/\/+$/, '');
}

function key() {
  const k = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SECRET_KEY nao configurada');
  return k;
}

async function rest(path, opts) {
  opts = opts || {};
  const url = new URL(baseUrl() + '/rest/v1/' + path);
  if (opts.query) {
    for (const k of Object.keys(opts.query)) {
      const v = opts.query[k];
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const headers = Object.assign(
    {
      apikey: key(),
      Authorization: 'Bearer ' + key(),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    opts.headers || {}
  );
  const res = await fetch(url.toString(), {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.hint)) || ('Supabase HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// SELECT
function select(table, query) {
  return rest(table, { query: query || {} });
}

async function selectOne(table, query) {
  const rows = await rest(table, { query: Object.assign({ limit: 1 }, query || {}) });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// INSERT
async function insert(table, row) {
  const rows = await rest(table, { method: 'POST', body: Array.isArray(row) ? row : [row] });
  if (Array.isArray(row)) return rows;
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// UPSERT
async function upsert(table, row, onConflict) {
  const rows = await rest(table, {
    method: 'POST',
    body: Array.isArray(row) ? row : [row],
    query: onConflict ? { on_conflict: onConflict } : undefined,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
  });
  if (Array.isArray(row)) return rows;
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// UPDATE
async function update(table, patch, query) {
  const rows = await rest(table, { method: 'PATCH', body: patch, query: query || {} });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// DELETE
function remove(table, query) {
  return rest(table, { method: 'DELETE', query: query || {} });
}

// Contagem exata de linhas
async function count(table, query) {
  const url = new URL(baseUrl() + '/rest/v1/' + table);
  url.searchParams.set('select', 'id');
  if (query) for (const k of Object.keys(query)) url.searchParams.set(k, query[k]);
  const res = await fetch(url.toString(), {
    headers: {
      apikey: key(),
      Authorization: 'Bearer ' + key(),
      Prefer: 'count=exact',
      Range: '0-0'
    }
  });
  const range = res.headers.get('content-range') || '0-0/0';
  return parseInt(range.split('/')[1] || '0', 10);
}

module.exports = { rest, select, selectOne, insert, upsert, update, remove, count };
