// Test helper: decodes the compact batch the SDK sends (the same decoding the ingestion server
// does), so tests read the full event envelope. The SDK sends positional arrays and short system
// property keys so the browser carries no field names. The expansion only renames and reshapes.
//
// batch v2 (@datacub/web 0.1): [2, api_key, sent_at_ms, version, dropped, release, locale, webdriver, ...events]
// batch v3 (@datacub/web 0.2): [3, api_key, sent_at_ms, version, dropped, release, locale, webdriver, env,
//         ...events], env the positional device array below (null where the browser has nothing)
// event: [uuid, event, ts_ms, anon_id, user_id, account_id, session_id, page_id, seq, granted (0/1),
//         cookie (0/1), url, viewport, properties, pageview context [utm, click_id_type, referrer_host]]

// Short keys the SDK writes for its own $ properties. A customer property never starts with $
// (the SDK refuses those keys and the server drops them), so the two never collide.
const KEYS: Record<string, string> = {
  $p: '$prev_path',
  $b: '$bfcache',
  $c: '$closes_page_id',
  $v: '$visible_ms',
  $s: '$scroll_depth',
  $t: '$el_tag',
  $n: '$el_name',
  $r: '$el_role',
  $y: '$el_type',
  $h: '$el_href_path',
  $k: '$count',
  $f: '$form_name',
  $a: '$form_action_path',
  $i: '$field_count',
  $d: '$dropped_count',
  $S: '$state',
  $m: '$method',
  $P: '$policy_version',
  $A: '$anon_id',
  // 0.2: clicks
  $l: '$el_text',
  $g: '$el_sig',
  $o: '$el_in_form',
  $cx: '$click_x',
  $cy: '$click_y',
  // pages
  $N: '$nav_type',
  $vw: '$viewport_w',
  $vh: '$viewport_h',
  $e: '$returned',
  $ec: '$error_count',
  $rq: '$request_count',
  $rf: '$request_failed_count',
  // vitals, merged into $pageleave by the insights module
  $lcp: '$lcp_ms',
  $fcp: '$fcp_ms',
  $ttfb: '$ttfb_ms',
  $dns: '$dns_ms',
  $tcp: '$connect_ms',
  $dcl: '$dom_ready_ms',
  $load: '$load_ms',
  $inp: '$inp_ms',
  $ie: '$inp_el_tag',
  $cls: '$cls',
  $lt: '$long_tasks',
  $ltm: '$long_task_ms',
  $rc: '$resource_count',
  $rkb: '$resource_kb',
  // $error
  $ek: '$error_kind',
  $en: '$error_name',
  $em: '$error_message',
  $es: '$error_stack',
  $eu: '$error_source',
  $et: '$error_tag',
  // $request
  $nm: '$request_method',
  $nu: '$request_url',
  $ns: '$request_status',
  $nd: '$request_ms',
  $nk: '$request_kind',
  // forms
  $iv: '$invalid_count',
  $ff: '$form_fields',
  $fo: '$form_outcome',
}

// v3 env, by position: the expanded names (context.env), each column of the same name
const ENV = [
  'screen_w',
  'screen_h',
  'dpr',
  'timezone',
  'cpu_cores',
  'device_memory',
  'touch_points',
  'pointer',
  'color_scheme',
  'reduced_motion',
  'connection_type',
  'connection_rtt',
  'connection_downlink',
  'save_data',
  'device_model',
  'os_version',
  // minutes east of UTC from the core (free). Index 3 (the IANA zone) is null from the web SDK:
  // reading it costs about 50 ms of Intl on a slow phone, so the server takes the zone of the IP's location
  'utc_offset',
] as const
const CODES: Record<string, Record<string, string>> = {
  pointer: { c: 'coarse', f: 'fine' },
  color_scheme: { d: 'dark', l: 'light' },
}

function env(x: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(x)) return
  const out: Record<string, unknown> = {}
  ENV.forEach((k, i) => {
    let v = x[i]
    if (v === null || v === undefined) return
    if (k === 'reduced_motion' || k === 'save_data') v = v === 1 ? true : v === 0 ? false : v
    const code = CODES[k]
    if (code && typeof v === 'string') v = Object.hasOwn(code, v) ? code[v] : v
    out[k] = v
  })
  return out
}

// $q: the page's query as {key: value} or [[key, value], ...]; an object either way, own keys only
function query(q: unknown): unknown {
  const pairs = Array.isArray(q)
    ? q.filter((p) => Array.isArray(p) && p.length === 2)
    : q && typeof q === 'object'
      ? Object.entries(q)
      : null
  if (!pairs) return q
  const out: Record<string, unknown> = {}
  for (const [k, v] of pairs) if (k !== '__proto__') out[String(k)] = v
  return out
}

const origin = (u: string) => /^https?:\/\/[^/]*/.exec(u)?.[0] ?? ''
const iso = (ms: unknown) => {
  try {
    return new Date(ms as number).toISOString()
  } catch {
    return ms
  }
}

function event(e: unknown[], b: unknown[]): unknown {
  if (!Array.isArray(e)) return e
  const [uuid, name, ts, anon, user, account, sid, page, seq, granted, cookie, url, vp, p, x] = e
  const props: Record<string, unknown> = {}
  if (p && typeof p === 'object' && !Array.isArray(p))
    // a "__proto__" key from JSON.parse would set the prototype, not a property
    for (const [k, v] of Object.entries(p))
      if (k !== '__proto__') props[Object.hasOwn(KEYS, k) ? (KEYS[k] as string) : k] = v
  const u = typeof url === 'string' ? url : undefined
  // links and forms carry the cleaned target URL: a same-site target is stored as its path, another
  // site's as host and path
  const h = props.$el_href_path
  if (typeof h === 'string')
    props.$el_href_path =
      u && origin(h) === origin(u) ? h.slice(origin(u).length) : h.replace(/^https?:\/\//, '')
  const a = props.$form_action_path
  if (typeof a === 'string') props.$form_action_path = a.slice(origin(a).length)
  // the SDK sends the deepest point reached as a share of the page
  const s = props.$scroll_depth
  if (typeof s === 'number') props.$scroll_depth = Math.min(100, Math.floor(s * 10) * 10)
  // what the SDK no longer spells out: a rage click is 3 clicks, a consent event is a grant,
  if (name === '$rageclick') props.$count = 3
  // a page leave closes the page it belongs to
  if (name === '$pageleave') props.$closes_page_id = page
  if (name === '$consent') Object.assign(props, { $state: 'granted', $purposes: ['analytics'] })
  const context: Record<string, unknown> = {
    url: u,
    path: u?.slice(origin(u).length),
    locale: b[6],
    viewport: vp,
    webdriver: b[7] === 1 || b[7] === true,
    release: b[5] ?? null,
  }
  if (Array.isArray(x)) {
    if (x[0]) context.utm = x[0]
    if (x[1]) context.click_id_type = x[1]
    context.referrer_host = x[2] ?? null
  }
  // the page's title, query and referrer path ride as $T, $q, $R and are stored as columns
  if ('$T' in props) context.title = props.$T
  if ('$q' in props) context.query = query(props.$q)
  if ('$R' in props) context.referrer_path = props.$R
  delete props.$T
  delete props.$q
  delete props.$R
  const device = b[0] === 3 ? env(b[8]) : undefined
  if (device) context.env = device
  return {
    uuid,
    event: name,
    ts: iso(ts),
    anon_id: anon,
    user_id: user,
    account_id: account,
    session_id: sid,
    page_id: page,
    seq,
    consent_state: granted === 1 ? 'granted' : 'not_required',
    persistence: cookie === 1 ? 'cookie' : 'memory',
    context,
    properties: props,
  }
}

/** A compact batch as the browser batch the envelope schema checks; anything else unchanged. */
export function expandBatch(body: unknown): unknown {
  // more than 100 events never passes the schema: left as it is, so it is refused unexpanded
  if (!Array.isArray(body) || (body[0] !== 2 && body[0] !== 3)) return body
  const head = body[0] === 3 ? 9 : 8
  if (body.length > head + 100) return body
  const [, api_key, sent, version, dropped] = body
  const events = body.slice(head)
  return {
    api_key,
    sent_at: iso(sent),
    lib: { name: '@datacub/web', version },
    events: events.map((e) => event(e as unknown[], body)),
    ...(dropped ? { dropped } : {}),
  }
}
