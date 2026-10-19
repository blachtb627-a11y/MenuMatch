#!/usr/bin/env python3
"""
Rewrites the seed catalog in American English, and writes the migration that
makes the same change to the recipes already in the database.

    python3 tools/americanize-catalog.py

Swipzy is a US app — °F, cups, a .store domain — but the catalog was written
in British English: courgettes, caster sugar, "prove 1 hour", 180C, a 20cm tin.
To an American cook those read as a puzzle at best and as the wrong thing at
worst (plain flour, double cream and a 23cm tin all have a US name).

What changes: titles, descriptions, ingredient names and notes, and steps.
What does not: slugs (the cover pipeline joins on them), and structured
quantities — a row stored as 200 g stays 200 g, because turning grams into
cups needs the ingredient's density and a wrong guess spoils a bake.

The database side is a list of exact updates, each guarded by the old text, so
it changes only rows that still read the way the seed file did. A recipe a
person has since edited, or one that was never loaded, is left alone.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / 'supabase' / 'seed'
MIGRATION = ROOT / 'supabase' / 'migrations' / '0044_catalog_in_american_english.sql'

# Longest first: "chilli flakes" before "chilli", "spring onions" before "spring onion".
WORDS = [
    # ingredients
    (r'chilli flakes', 'red pepper flakes'),
    (r'chillies', 'chilies'), (r'chilli', 'chili'),
    (r'courgettes', 'zucchini'), (r'courgette', 'zucchini'),
    (r'aubergines', 'eggplants'), (r'aubergine', 'eggplant'),
    (r'spring onions', 'green onions'), (r'spring onion', 'green onion'),
    (r'caster sugar', 'superfine sugar'),
    (r'icing sugar', 'powdered sugar'),
    (r'demerara sugar', 'turbinado sugar'), (r'demerara', 'turbinado sugar'),
    (r'self-raising flour', 'self-rising flour'),
    (r'plain flour', 'all-purpose flour'),
    (r'wholemeal', 'whole wheat'),
    (r'cornflour', 'cornstarch'),
    (r'bicarbonate of soda', 'baking soda'), (r'bicarbonate', 'baking soda'),
    (r'bicarb', 'baking soda'),
    (r'double cream', 'heavy cream'), (r'single cream', 'light cream'),
    (r'tomato pur[ée]e', 'tomato paste'),
    (r'minced (beef|pork|lamb|chicken|turkey)', r'ground \1'),
    (r'(beef|pork|lamb) mince', r'ground \1'),
    (r'streaky bacon', 'bacon'),
    (r'prawns', 'shrimp'), (r'prawn', 'shrimp'),
    (r'rocket', 'arugula'),
    (r'beetroots', 'beets'), (r'beetroot', 'beets'),
    (r'yoghurt', 'yogurt'),
    (r'tinned', 'canned'),
    # kitchen
    (r'frying pans', 'skillets'), (r'frying pan', 'skillet'),
    (r'kitchen paper', 'paper towels'),
    (r'baking paper', 'parchment paper'), (r'greaseproof paper', 'parchment paper'),
    (r'cling ?film', 'plastic wrap'),
    (r'hob', 'stovetop'),
    (r'moulds', 'molds'), (r'mould', 'mold'),
    (r'jug', 'pitcher'),
    (r'tins', 'pans'), (r'tin', 'pan'),
    (r'proving', 'proofing'), (r'proved', 'proofed'), (r'prove', 'proof'),
    # spelling
    (r'colours', 'colors'), (r'coloured', 'colored'), (r'colour', 'color'),
    (r'flavours', 'flavors'), (r'flavoured', 'flavored'), (r'flavour', 'flavor'),
    (r'savoury', 'savory'), (r'centres', 'centers'), (r'centre', 'center'),
    (r'grey', 'gray'), (r'litres', 'liters'), (r'litre', 'liter'),
    (r'favourites', 'favorites'), (r'favourite', 'favorite'),
    (r'caramelised', 'caramelized'), (r'caramelise', 'caramelize'),
    (r'tenderises', 'tenderizes'), (r'tenderising', 'tenderizing'),
    (r'aluminium', 'aluminum'),
]
COMPILED = [(re.compile(r'\b' + a + r'\b', re.I), b) for a, b in WORDS]

# Exceptions that a word swap gets wrong.
PHRASES = [
    ('Twenty minutes, one tin,', 'Twenty minutes, one can,'),
    ('racks pork spare ribs', 'racks of pork spare ribs'),
    ('Overcooked prawns are rubber', 'Overcooked shrimp turn to rubber'),
]


def match_case(found: str, repl: str) -> str:
    if found.isupper() and len(found) > 1:
        return repl.upper()
    if found[0].isupper():
        return repl[0].upper() + repl[1:]
    return repl


def swap_words(text: str) -> str:
    for old, new in PHRASES:
        text = text.replace(old, new)
    for rx, repl in COMPILED:
        text = rx.sub(lambda m: match_case(m.group(0), m.expand(repl)), text)
    return text


# -------------------------------------------------------------- coriander
# In British recipes "coriander" on its own is the leaf, which Americans call
# cilantro; ground coriander and coriander seed are the same word in both. A
# recipe that uses the spice keeps "coriander" in its steps, where the two
# cannot be told apart.
FRESH_CORIANDER = re.compile(r'^(fresh coriander|coriander leaves|coriander)$', re.I)


def uses_coriander_spice(recipe) -> bool:
    return any(re.search(r'ground coriander|coriander seed', i[3] or '', re.I)
               for i in recipe['ingredients'])


def coriander_to_cilantro(text: str) -> str:
    text = re.sub(r'\bfresh coriander\b', 'cilantro', text, flags=re.I)
    text = re.sub(r'\bcoriander leaves\b', 'cilantro', text, flags=re.I)
    return re.sub(r'\bcoriander\b(?! seed)', lambda m: match_case(m.group(0), 'cilantro'), text)


# ----------------------------------------------------------- measurements
def to_f(c: float, oven: bool) -> int:
    f = c * 9 / 5 + 32
    # Ovens and fryers are set in 25° steps on a US dial; a probe is read exactly.
    step = 25 if oven else 5
    return int(round(f / step) * step)


TEMP = re.compile(r'(\d{2,3})\s?°?C(\s+fan)?\b')


def convert_temps(text: str) -> str:
    def repl(m):
        c = int(m.group(1))
        fan = bool(m.group(2))
        before = text[max(0, m.start() - 30):m.start()].lower()
        after = text[m.end():m.end() + 16].lower()
        exact = (re.search(r'reads?\b|water|about $', before)
                 or re.match(r'\s*(in the|inside|at the)', after))
        if fan:
            c += 20  # a fan oven runs about 20° hotter than the dial says
        return f'{to_f(c, oven=not exact)}°F'
    return TEMP.sub(repl, text)


INCHES = {1: '1/2', 2: '3/4', 3: '1', 4: '1 1/2', 8: '3', 20: '8', 23: '9',
          24: '9', 26: '10', 60: '24'}
LENGTH = re.compile(r'(\d+)\s?cm\b(\s+(\w+))?')


def convert_lengths(text: str) -> str:
    def repl(m):
        cm = int(m.group(1))
        inch = INCHES.get(cm)
        if inch is None:
            raise SystemExit(f'no inch conversion for {cm}cm in: {text}')
        nxt = (m.group(3) or '').lower()
        if nxt and nxt not in ('thick', 'across', 'of', 'wide', 'long', 'deep'):
            return f'{inch}-inch{m.group(2)}'          # "a 20cm tin" → "an 8-inch pan"
        unit = 'inch' if inch in ('1/2', '3/4', '1') else 'inches'
        return f'{inch} {unit}{m.group(2) or ""}'      # "1cm thick" → "1/2 inch thick"
    out = LENGTH.sub(repl, text)
    return re.sub(r'\ba (8|1[18])\b', r'an \1', out)


VOLUME = {100: '1/2 cup', 250: '1 cup'}


def convert_volumes(text: str) -> str:
    def repl(m):
        ml = int(m.group(1))
        if ml not in VOLUME:
            raise SystemExit(f'no cup conversion for {ml}ml in: {text}')
        return VOLUME[ml]
    text = re.sub(r'(\d+)\s?ml\b', repl, text)
    return re.sub(r'about 1\.5\s?kg', 'about 3 1/2 lb', text)


def americanize(text, recipe, cilantro: bool):
    if not text:
        return text
    out = swap_words(text)
    if cilantro:
        out = coriander_to_cilantro(out)
    return convert_volumes(convert_lengths(convert_temps(out)))


def convert_recipe(r):
    """Returns (new recipe, list of (field, position, old, new))."""
    cilantro = not uses_coriander_spice(r)
    changes = []
    new = dict(r)

    for field in ('title', 'description'):
        old = r.get(field)
        val = americanize(old, r, cilantro)
        if val != old:
            new[field] = val
            changes.append((field, None, old, val))

    rows = []
    for pos, row in enumerate(r['ingredients']):
        row = list(row)
        text, note = row[3], row[4] if len(row) > 4 else None
        if cilantro and FRESH_CORIANDER.match(text or ''):
            new_text = 'cilantro'
        else:
            new_text = americanize(text, r, cilantro)
        new_note = americanize(note, r, cilantro)
        if new_text != text:
            changes.append(('ingredient', pos, text, new_text))
            row[3] = new_text
        if new_note != note:
            changes.append(('note', pos, note, new_note))
            row[4] = new_note
        rows.append(row)
    new['ingredients'] = rows

    steps = []
    for pos, step in enumerate(r['steps']):
        val = americanize(step, r, cilantro)
        if val != step:
            changes.append(('step', pos, step, val))
        steps.append(val)
    new['steps'] = steps

    # "quick" is a time bucket worked out from prep + cook, not a tag; there is
    # no such tag row, so seed_recipe was skipping it on every load.
    if 'quick' in r.get('tags', []):
        new['tags'] = [t for t in r['tags'] if t != 'quick']
    return new, changes


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def sql_for(creator, old_title, changes):
    out = []
    recipe = (f"(select r.id from public.recipes r join public.users u on u.id = r.creator_id\n"
              f"      where u.username = {q(creator)} and r.is_seed and r.title = {q(old_title)})")
    for field, pos, old, new in changes:
        if field == 'ingredient':
            out.append(f"update public.recipe_ingredients set ingredient_text = {q(new)}\n"
                       f" where recipe_id = {recipe}\n   and position = {pos} and ingredient_text = {q(old)};")
        elif field == 'note':
            out.append(f"update public.recipe_ingredients set note = {q(new)}\n"
                       f" where recipe_id = {recipe}\n   and position = {pos} and note = {q(old)};")
        elif field == 'step':
            out.append(f"update public.recipe_steps set instruction = {q(new)}\n"
                       f" where recipe_id = {recipe}\n   and position = {pos} and instruction = {q(old)};")
        elif field == 'description':
            out.append(f"update public.recipes set description = {q(new)}\n"
                       f" where id = {recipe}\n   and description = {q(old)};")
    # Title last: every statement above finds the recipe by its old title.
    for field, pos, old, new in changes:
        if field == 'title':
            out.append(f"update public.recipes set title = {q(new)}\n where id = {recipe};")
    return out


HEADER = """\
-- The catalog in American English. Generated by tools/americanize-catalog.py
-- from the seed files, which it rewrites in the same pass — edit the script,
-- not this file.
--
-- Swipzy is a US app and the catalog was written in British English:
-- courgettes, caster sugar, double cream, "prove 1 hour", 180C, a 20cm tin.
-- Each statement is guarded by the old text, so a recipe someone has edited
-- since, or one that was never loaded, is left as it is.
--
-- Not changed: slugs, and quantities stored in grams or millilitres — turning
-- grams into cups needs the ingredient's density.

-- Pantry and seed matching find an ingredient by substring of its canonical
-- name or an alias. "green onion" contains neither "spring onion" nor
-- "green onions", so the singular is added; the rest already have their US
-- name as an alias (zucchini, eggplant, cilantro, all-purpose flour).
update public.ingredients
   set aliases = array(select distinct unnest(aliases || array['green onion','scallion']))
 where canonical_name = 'spring onion';
update public.ingredients
   set aliases = array(select distinct unnest(aliases || array['superfine sugar']))
 where canonical_name = 'sugar';
update public.ingredients
   set aliases = array(select distinct unnest(aliases || array['red pepper flakes','chili flakes']))
 where canonical_name = 'chilli flakes';

-- Search reads search_vector, a generated column over the title and
-- description, so the updates below keep it current with no further step.
"""


def main():
    files = sorted(SEED.glob('*.json')) + sorted((SEED / 'creators').glob('*.json'))
    sql = [HEADER]
    total = 0
    for f in files:
        raw = f.read_text()
        data = json.loads(raw)
        new_data = []
        for r in data:
            new_r, changes = convert_recipe(r)
            new_data.append(new_r)
            if changes:
                total += len(changes)
                sql.append(f"-- {r['creator']}: {r['title']}")
                sql.extend(sql_for(r['creator'], r['title'], changes))
                sql.append('')
        if new_data != data:
            write_like(f, raw, data, new_data)
        if f.name == 'batch-2026-10.json':
            retitle_covers(data, new_data)
    MIGRATION.write_text('\n'.join(sql).rstrip() + '\n')
    print(f'{total} changes; wrote {MIGRATION.relative_to(ROOT)}')


def write_like(path: Path, raw: str, old, new):
    """
    Writes in the file's own layout. Most are indent=1 and are re-dumped; the
    two oldest are hand-laid-out, so there each changed string is swapped in
    place, inside its own recipe's span of the text.
    """
    if json.dumps(old, indent=1, ensure_ascii=False).rstrip('\n') == raw.rstrip('\n'):
        body = json.dumps(new, indent=1, ensure_ascii=False)
        path.write_text(body + ('\n' if raw.endswith('\n') else ''))
        return
    starts = [raw.index(f'"slug":{json.dumps(r["slug"], ensure_ascii=False)}') for r in old]
    bounds = list(zip(starts, starts[1:] + [len(raw)]))
    pieces, at = [], 0
    for (a, b), r_old, r_new in zip(bounds, old, new):
        seg = raw[a:b]
        for x, y in zip(strings(r_old), strings(r_new)):
            if x != y:
                ex, ey = json.dumps(x, ensure_ascii=False), json.dumps(y, ensure_ascii=False)
                if ex not in seg:
                    raise SystemExit(f'{path.name}: cannot find {ex}')
                seg = seg.replace(ex, ey, 1)
        pieces += [raw[at:a], seg]
        at = b
    out = ''.join(pieces) + raw[at:]
    assert json.loads(out) == new, path
    path.write_text(out)


def strings(r):
    yield r['title']
    yield r.get('description')
    for row in r['ingredients']:
        yield row[3]
        yield row[4] if len(row) > 4 else None
    yield from r['steps']


def retitle_covers(old, new):
    """The credits step in resolve-covers.sql joins on zz_cover.title."""
    path = SEED / 'batch-2026-10-covers.sql'
    text = path.read_text()
    for a, b in zip(old, new):
        if a['title'] != b['title']:
            text = text.replace(f"({q(a['slug'])}, {q(a['title'])},", f"({q(a['slug'])}, {q(b['title'])},")
    path.write_text(text)


if __name__ == '__main__':
    main()
