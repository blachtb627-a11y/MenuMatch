-- Allergen and diet tags on nine house recipes, applied to the live rows.
--
-- The fix went into supabase/seed/recipes-demo.json, found by checking each
-- recipe's ingredients against its tags — but the seed file only reaches the
-- database when the loader is re-run, and until then the app kept showing
-- Mujadara as vegan (it is finished with yogurt) and Menemen as gluten-free
-- (it is eaten with bread). The tags drive the diet filters and the
-- "Contains" chips, so a missing allergen is a safety problem, not a cosmetic
-- one. This applies the same change directly; the seed file and the database
-- now agree, and re-running the loader later changes nothing.

with fix(title, add_tags, drop_tags) as (values
  ('Chicken Katsu Curry',           array['allergen-soy'],                                   array[]::text[]),
  ('Thai Green Curry with Chicken', array['allergen-fish'],                                  array[]::text[]),
  ('Kimchi Jjigae',                 array['allergen-sesame','allergen-soy','allergen-wheat'], array[]::text[]),
  ('Coq au Vin',                    array['allergen-milk','allergen-wheat'],                 array[]::text[]),
  ('Lamb Souvlaki with Tzatziki',   array['allergen-wheat'],                                 array[]::text[]),
  ('Mujadara',                      array['allergen-milk'],                                  array['dairy-free','vegan']),
  ('Menemen',                       array['allergen-wheat'],                                 array['gluten-free']),
  ('Steak and Ale Pie',             array['allergen-eggs'],                                  array[]::text[]),
  ('Lomo Saltado',                  array['allergen-wheat'],                                 array[]::text[])
),
house as (
  select r.id, f.add_tags, f.drop_tags
    from fix f
    join public.recipes r on r.title = f.title and r.is_seed
    join public.users u on u.id = r.creator_id and u.username = 'swipzy.kitchen'
),
added as (
  insert into public.recipe_tags (recipe_id, tag_id, source)
  select h.id, t.id, 'creator'
    from house h
    join public.tags t on t.slug = any (h.add_tags)
  on conflict do nothing
  returning 1
)
delete from public.recipe_tags rt
 using house h, public.tags t
 where rt.recipe_id = h.id and rt.tag_id = t.id and t.slug = any (h.drop_tags);
