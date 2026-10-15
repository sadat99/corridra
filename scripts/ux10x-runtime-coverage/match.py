#!/usr/bin/env python3
"""Link statically discovered UI controls to controls exercised by passing browser tests.

Static side: scripts/ux10x-inventory.mjs output at current HEAD (807 controls).
Runtime side: events recorded by a passive proxy while the unchanged Playwright suites ran.
Matching is by observable identity (name, aria-label, href, visible text, wrapper label,
placeholder, first option, maxlength). It is evidence that a test touched the control; it does
not say whether allowed AND denied states were asserted.
"""
import json, re, sys, collections

inv_path, out_path = sys.argv[1], sys.argv[2]
event_files = sys.argv[3:]
import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'

inv = json.load(open(inv_path))
actions = inv['actions']

# ---------- JSX helpers ----------
def parse_jsx(label):
    """Return (first_tag_attrs_text, literals[], texts[]) crudely but deterministically."""
    i, n = 0, len(label)
    literals, texts, buf = [], [], []
    first_tag = None
    def read_braces(j):
        depth, k, start = 0, j, j
        while k < n:
            c = label[k]
            if c in '"\'`':
                q = c; k += 1; s = k
                while k < n and label[k] != q:
                    if label[k] == '\\': k += 1
                    k += 1
                literals.append(label[s:k]); k += 1; continue
            if c == '{': depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0: return k + 1
            k += 1
        return k
    while i < n:
        c = label[i]
        if c == '<' and i + 1 < n and (label[i+1].isalpha() or label[i+1] == '/'):
            j = i + 1
            while j < n and label[j] != '>':
                if label[j] == '{': j = read_braces(j); continue
                if label[j] in '"\'':
                    q = label[j]; j += 1
                    while j < n and label[j] != q: j += 1
                j += 1
            if first_tag is None: first_tag = label[i:j+1]
            else:
                # attribute string literals (aria-label, placeholder, title) are visible text
                pass
            t = ' '.join(''.join(buf).split())
            if t: texts.append(t)
            buf = []
            i = j + 1
        elif c == '{':
            j = read_braces(i); i = j
        else:
            buf.append(c); i += 1
    t = ' '.join(''.join(buf).split())
    if t: texts.append(t)
    return first_tag or '', literals, texts

def attr(tag, name):
    m = re.search(r'(?<![\w-])' + re.escape(name) + r'="([^"]*)"', tag)
    if m: return m.group(1)
    m = re.search(r'(?<![\w-])' + re.escape(name) + r"=\{'([^']*)'\}", tag)
    return m.group(1) if m else ''

src_cache = {}
def wrapper_label(file, line):
    """Text of the nearest enclosing <label> that opens shortly before the control."""
    if file not in src_cache:
        try: src_cache[file] = open(ROOT + file, encoding='utf8').read().split('\n')
        except Exception: src_cache[file] = []
    lines = src_cache[file]
    if not lines: return ''
    lo = max(0, line - 8)
    chunk = '\n'.join(lines[lo:line - 1] + [lines[line - 1].split('<')[0] if line - 1 < len(lines) else ''])
    k = chunk.rfind('<label')
    if k < 0: return ''
    seg = chunk[k:]
    if '</label>' in seg: return ''
    _, lit, txt = parse_jsx(seg + ' </label>')
    return ' '.join(txt + [l for l in lit if len(l) > 2])

def norm(s):
    return re.sub(r'[^0-9a-zÀ-￿]+', ' ', s.lower()).strip()

def route_regex(r):
    return re.compile('^' + re.sub(r'\\\[[^\]]+\\\]', '[^/]+', re.escape(r)) + '/?$')

feat = []
for a in actions:
    tag, lit, txt = parse_jsx(a['label'])
    line = int(a['id'].split(':')[1])
    el = a['element']
    f = {
        'id': a['id'], 'file': a['file'], 'element': el,
        'fam': 'a' if el in ('Link', 'a') else el,
        'routes': [route_regex(r) for r in a['routes'] if r.startswith('/')],
        'name': attr(tag, 'name'), 'aria': attr(tag, 'aria-label'), 'href': attr(tag, 'href'),
        'ph': attr(tag, 'placeholder'), 'max': attr(tag, 'maxLength') or re.sub(r'.*maxLength=\{(\d+)\}.*', r'\1', tag) if 'maxLength' in tag else '',
        'texts': [norm(t) for t in txt if norm(t)],
        'lits': [norm(l) for l in lit if norm(l)],
        'wrap': norm(wrapper_label(a['file'], line)) if el in ('input', 'select', 'textarea') else '',
        'first': '',
        'inner': set(re.findall(r'name="([^"]+)"', a['label'])) if el == 'form' else set(),
        'joined': ' '.join([norm(t) for t in txt] + [norm(l) for l in lit]),
    }
    if el == 'select':
        m = re.search(r'<option[^>]*>\s*([^<{]+?)\s*</option>', a['label'])
        f['first'] = norm(m.group(1)) if m else ''
    feat.append(f)

# ---------- runtime events ----------
events = []
for p in event_files:
    for line in open(p):
        line = line.strip()
        if line:
            try: events.append(json.loads(line))
            except Exception: pass
uniq = {}
for e in events:
    k = json.dumps(e, sort_keys=True)
    uniq[k] = e
events = list(uniq.values())

def score(f, e):
    if f['fam'] != e['tag']: return 0
    path = e['path']
    if f['routes'] and not any(r.match(path) for r in f['routes']): return 0
    s = 0
    t = norm(e.get('text', ''))
    if f['fam'] == 'form':
        if f['aria'] and f['aria'] == e.get('formAria'): s += 10
        names = set(filter(None, (e.get('names') or '').split(',')))
        if f['inner'] and names and len(f['inner'] & names) / len(names) >= 0.5: s += 6
        ft = norm(e.get('formText', ''))[:28]
        if len(ft) >= 12 and ft in f['joined']: s += 6
        sub = norm(e.get('sub', ''))
        if sub and (sub in f['texts'] or sub in f['lits'] or any(sub in x for x in f['texts'])): s += 6
        return s
    if f['name'] and f['name'] == e.get('name'): s += 10
    if f['aria'] and f['aria'] == e.get('aria'): s += 8
    if f['fam'] == 'a':
        h = e.get('href', '')
        if f['href'] and f['href'] == h: s += 7
        elif f['href'] and h and f['href'].split('?')[0] == h.split('?')[0]: s += 5
    if t and (t in f['texts'] or t in f['lits']): s += 6
    elif t and any(len(x) > 3 and (x in t or t in x) for x in f['texts']): s += 3
    if f['fam'] in ('input', 'select', 'textarea'):
        w = norm(e.get('wrap', ''))
        if f['wrap'] and w and (f['wrap'] in w or w.startswith(f['wrap'][:40])): s += 6
        if f['ph'] and f['ph'] == e.get('ph'): s += 6
        if f['first'] and f['first'] == norm(e.get('first', '')): s += 5
        if f['max'] and f['max'] == e.get('max'): s += 1
    return s

THRESH = 6
hits = collections.defaultdict(list)
unmatched_events = []
for e in events:
    if e['tag'] not in ('a', 'button', 'summary', 'input', 'select', 'textarea', 'form'):
        continue
    scored = [(score(f, e), f) for f in feat]
    best = max((s for s, _ in scored), default=0)
    if best < THRESH:
        unmatched_events.append(e)
        continue
    top = [f for s, f in scored if s == best]
    for f in top:
        hits[f['id']].append({'ev': e['ev'], 'path': e['path'], 'score': best, 'tie': len(top)})

# ---------- report ----------
rows = []
for a in actions:
    h = hits.get(a['id'], [])
    inter = [x for x in h if x['ev'] != 'seen']
    if inter: status = 'INTERACTED_AMBIGUOUS' if all(x['tie'] > 1 for x in inter) else 'INTERACTED'
    elif h: status = 'RENDERED_ONLY'
    else: status = 'NOT_SEEN'
    rows.append({'id': a['id'], 'file': a['file'], 'element': a['element'], 'routes': a['routes'][:3],
                 'status': status, 'events': sorted({x['ev'] for x in h}), 'paths': sorted({x['path'] for x in h})[:4],
                 'label': ' '.join(a['label'].split())[:140]})

by_status = collections.Counter(r['status'] for r in rows)
by_file = collections.defaultdict(collections.Counter)
for r in rows: by_file[r['file']][r['status']] += 1
by_el = collections.defaultdict(collections.Counter)
for r in rows: by_el[r['element']][r['status']] += 1

json.dump({'staticControls': len(actions), 'runtimeEventFingerprints': len(events),
           'byStatus': by_status, 'byFile': {k: dict(v) for k, v in by_file.items()},
           'byElement': {k: dict(v) for k, v in by_el.items()},
           'unmatchedRuntimeEvents': unmatched_events, 'rows': rows}, open(out_path, 'w'), indent=1)
print('static controls', len(actions), 'runtime fingerprints', len(events))
print(dict(by_status))
print('unmatched runtime fingerprints', len(unmatched_events))
