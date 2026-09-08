# Seed catalog

Six seed accounts, 120 published recipes. All flagged `is_seed_account`, which
the creator page and the admin screens surface — nothing here pretends to be
somebody's real cooking.

| account | subject | recipes |
|---|---|---|
| `menumatch.kitchen` | house account, one dish per cuisine | 20 |
| `cookduck` | fast weeknight food, one pan | 20 |
| `ryanccooks` | grilling, smoking, American comfort | 20 |
| `wokweekly` | East and Southeast Asian | 20 |
| `flourhands` | bread and baking | 20 |
| `mirasplate` | vegetables first, Mediterranean and Levantine | 20 |

## Loading

`recipes-demo.json` carries its cover URLs and loads on its own:

```sql
select public.seed_recipes(<contents of recipes-demo.json>::jsonb);
```

The five files under `creators/` do not. `recipes_publish_requires_rights`
refuses a published recipe with no cover, so a cover has to be resolved *before*
each recipe is inserted — see `resolve-covers.sql`, which is the reproducible
form of how this catalog was built.

## Where the photographs come from

Wikimedia Commons, chosen freest-licence-first: most are CC0 or public domain
and need no credit, the rest are CC BY or CC BY-SA and carry the photographer
and licence in the recipe's `attribution` field.

Two things `resolve-covers.sql` does that matter, both learned the hard way:

- The filename must mention the dish. Without that check the search returns
  whatever is nearest and you get a paella on a chorizo orzo and poutine on
  gnocchi — URLs that resolve perfectly and show the wrong food.
- Paintings and old cookbook plates are excluded. Commons has a lot of them,
  they are public domain, and a licence-first sort puts them top: a still life
  by Clara Peeters came back for "soft pretzel".

Verification is a real GET, not a HEAD — `upload.wikimedia.org` rate-limits
HEAD far harder, and a GET is what a browser will do anyway.

## Known limitation

The covers are hotlinked to Wikimedia rather than hosted in the project's own
`recipe-media` bucket. Fine for a seed catalog; for anything beyond that the
images should be downloaded and re-uploaded, both because Wikimedia asks people
not to hotlink at scale and because the catalog should not depend on someone
else's CDN.
