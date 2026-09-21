# Seed catalog

Ten seed accounts, 190 published recipes. All flagged `is_seed_account`, which
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
| `sundaysimmer` | braises, stews and the long cook | 20 |
| `tenminutetable` | food that is on the table before you have decided what else to do | 20 |
| `pourandplate` | drinks and the small plates that go with them | 20 |
| `quietkitchen` | classics, unhurried — picked for the photographs | 10 |

## Loading

`recipes-demo.json` carries its cover URLs and loads on its own:

```sql
select public.seed_recipes(<contents of recipes-demo.json>::jsonb);
```

The nine files under `creators/` do not. `recipes_publish_requires_rights`
refuses a published recipe with no cover, so a cover has to be resolved *before*
each recipe is inserted — see `resolve-covers.sql`, which is the reproducible
form of how this catalog was built, and which ends with the load and the
teardown.

## Where the photographs come from

Wikimedia Commons. Every recipe carries its photographer and licence in the
`attribution` field, whether or not the licence demands it — CC0 and public
domain included. A file with no recorded author is not used at all: under CC BY
there is no way to credit it correctly, however good the photograph is.

Three things `resolve-covers.sql` does that matter, all learned the hard way:

- The filename must mention the dish. Without that check the search returns
  whatever is nearest and you get a paella on a chorizo orzo and poutine on
  gnocchi — URLs that resolve perfectly and show the wrong food.
- Paintings and old cookbook plates are excluded. Commons has a lot of them,
  they are public domain, and a licence-first sort puts them top: a still life
  by Clara Peeters came back for "soft pretzel".
- A vision model looks at every candidate before it is accepted. This is the
  only check that catches a file named exactly right and showing the wrong
  thing: a bubble tea *sign*, a plate of moussaka *ingredients*, and, under
  "bruschetta", a headshot of the Italian actor Ninni Bruschetta.

Its verdict is advice, not a decision — read what it says it saw before
accepting a rejection. On the last batch it turned down five correct
photographs and caught four wrong ones. Every clam chowder was rejected for the
same reason: in a cream chowder the clams are under the surface, so it could
not see any.

Verification is a real GET, not a HEAD — `upload.wikimedia.org` rate-limits
HEAD far harder, and a GET is what a browser will do anyway.

## `quietkitchen` was chosen the other way round

The other nine accounts picked dishes and then hunted for a photograph of each.
That is what the filename check, the deny-list and the vision pass in
`resolve-covers.sql` are for: they are all damage control for having already
committed to a dish.

This one started from the pictures. Commons keeps community-assessed
categories — `Quality images of food` and `Featured pictures of food`, 158 files
between them — which are vetted for photographic quality by people, not by a
heuristic. The pool was read first, the ten best plated dishes were taken from
it, and the recipes were written to match. Nothing had to be rejected for
looking bad, because nothing that looked bad was ever a candidate.

Four candidates were still dropped, and only by looking at them:

- a soup described on Commons as courgette is plainly orange in the photograph.
  Either the picture or the source would have had to be misdescribed, so it went.
- "Four rainbow trouts on a grill, wrapped in aluminum foil" — and that is what
  you see. Foil.
- a mango tart that does not read as a tart, or as appetising.
- and one kept: a cake that looked like tiramisu in thumbnail and turned out,
  from its own description, to be the cocoa-dusted chocolate cake it says it is.

That last one is the argument for reading the description as well as looking.
The first three are the argument for looking at all.

## Known limitation

The covers are hotlinked to Wikimedia rather than hosted in the project's own
`recipe-media` bucket. Fine for a seed catalog; for anything beyond that the
images should be downloaded and re-uploaded, both because Wikimedia asks people
not to hotlink at scale and because the catalog should not depend on someone
else's CDN.
