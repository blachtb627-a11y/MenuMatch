-- batch-2026-10-covers.sql — queues the 40 recipes in batch-2026-10.json for
-- cover resolution. Run after creating the functions in resolve-covers.sql, then
-- follow its Usage steps 2–6 exactly as for the original catalog.
--
-- Usernames for step 6 (the attribution update):
--   'cookduck', 'flourhands', 'mirasplate', 'pourandplate', 'ryanccooks', 'sundaysimmer', 'swipzy.kitchen', 'tenminutetable', 'wokweekly'

insert into public.zz_cover (slug, title, query, must) values
  ('jamaican-jerk-chicken', 'Jamaican Jerk Chicken', 'jerk chicken', 'jerk'),
  ('rice-and-peas', 'Rice and Peas', 'rice and peas jamaican', 'peas'),
  ('ropa-vieja', 'Ropa Vieja', 'ropa vieja', 'vieja'),
  ('arroz-con-gandules', 'Arroz con Gandules', 'arroz con gandules', 'gandules'),
  ('trinidad-doubles', 'Trinidad Doubles', 'doubles trinidad', 'doubles'),
  ('black-bean-arepas', 'Black Bean Arepas', 'arepa', 'arepa'),
  ('peruvian-ceviche', 'Peruvian Ceviche', 'ceviche', 'ceviche'),
  ('pao-de-queijo', 'Pão de Queijo', 'pao de queijo', 'queijo'),
  ('egusi-soup', 'Egusi Soup', 'egusi soup', 'egusi'),
  ('beef-suya', 'Beef Suya', 'suya', 'suya'),
  ('chicken-yassa', 'Chicken Yassa', 'chicken yassa', 'yassa'),
  ('red-red', 'Red-Red', 'red red ghana', 'red'),
  ('bobotie', 'Bobotie', 'bobotie', 'bobotie'),
  ('ful-medames', 'Ful Medames', 'ful medames', 'medames'),
  ('swahili-pilau', 'Swahili Pilau', 'pilau', 'pilau'),
  ('chicken-adobo', 'Chicken Adobo', 'chicken adobo', 'adobo'),
  ('lumpia-shanghai', 'Lumpia Shanghai', 'lumpia', 'lumpia'),
  ('pancit-bihon', 'Pancit Bihon', 'pancit', 'pancit'),
  ('chicken-karahi', 'Chicken Karahi', 'chicken karahi', 'karahi'),
  ('kottu-roti', 'Kottu Roti', 'kottu', 'kottu'),
  ('nasi-lemak', 'Nasi Lemak', 'nasi lemak', 'lemak'),
  ('nasi-goreng', 'Nasi Goreng', 'nasi goreng', 'goreng'),
  ('mohinga', 'Mohinga', 'mohinga', 'mohinga'),
  ('ghormeh-sabzi', 'Ghormeh Sabzi', 'ghormeh sabzi', 'sabzi'),
  ('saffron-tahdig', 'Saffron Tahdig', 'tahdig', 'tahdig'),
  ('uzbek-plov', 'Uzbek Plov', 'plov uzbek', 'plov'),
  ('adjarian-khachapuri', 'Adjarian Khachapuri', 'khachapuri', 'khachapuri'),
  ('leche-flan', 'Leche Flan', 'leche flan', 'flan'),
  ('ube-halaya', 'Ube Halaya', 'ube halaya', 'halaya'),
  ('tres-leches-cake', 'Tres Leches Cake', 'tres leches cake', 'leches'),
  ('gulab-jamun', 'Gulab Jamun', 'gulab jamun', 'jamun'),
  ('baklava', 'Baklava', 'baklava', 'baklava'),
  ('strawberry-daifuku', 'Strawberry Daifuku', 'daifuku', 'daifuku'),
  ('brigadeiros', 'Brigadeiros', 'brigadeiro', 'brigadeiro'),
  ('air-fryer-chicken-tenders', 'Air-Fryer Chicken Tenders', 'chicken fingers', 'finger'),
  ('gochujang-crispy-tofu-bowls', 'Gochujang Crispy Tofu Bowls', 'fried tofu', 'tofu'),
  ('sambal-tempeh-stir-fry', 'Sambal Tempeh Stir-Fry', 'tempeh', 'tempeh'),
  ('sheet-pan-shrimp-fajitas', 'Sheet-Pan Shrimp Fajitas', 'shrimp fajitas', 'fajita'),
  ('chicken-burrito-meal-prep-bowls', 'Chicken Burrito Meal-Prep Bowls', 'burrito bowl', 'burrito'),
  ('red-beans-and-rice', 'Red Beans and Rice', 'red beans and rice', 'beans')
on conflict (slug) do nothing;
