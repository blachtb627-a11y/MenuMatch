export type Tag = { slug: string; name: string; type: string };

export type Creator = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** §5.3: company-operated accounts must be visibly labeled. */
  isSeedAccount: boolean;
};

export type RecipeCard = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  category: string | null;
  cuisine: string | null;
  totalMinutes: number;
  servings: number;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  isSponsored: boolean;
  creator: Creator;
  tags: Tag[];
  saveCount: number;
  cookCount: number;
};

export type Ingredient = {
  id: string;
  position: number;
  quantity: { numerator: number; denominator: number } | null;
  unit: string | null;
  unitIsImprecise: boolean;
  ingredient: string;
  note: string | null;
};

export type Step = {
  id: string;
  position: number;
  instruction: string;
  imageUrl: string | null;
  timerSeconds: number | null;
};

export type Nutrition = {
  perServing?: boolean;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  source?: string;
};

export type Recipe = RecipeCard & {
  description: string | null;
  prepMinutes: number;
  cookMinutes: number;
  attribution: string | null;
  nutrition: Nutrition | null;
  containsAlcohol: boolean;
  publishedAt: string | null;
  isSaved: boolean;
  isFollowingCreator: boolean;
  ingredients: Ingredient[];
  steps: Step[];
  media: { url: string; width: number | null; height: number | null }[];
  /** §17: a saved recipe that was removed resolves to this rather than an error. */
  unavailable?: boolean;
};

export type Category = { slug: string; label: string; description: string | null };

export type AppConfig = {
  categories: Category[];
  flags: Record<string, boolean>;
  quickThresholdMinutes: number;
};

export type FeedPage = {
  category: string;
  /**
   * Which rung of the §8.3 ladder produced these cards. `popular_overall` means
   * the deck has left the requested category and the client says so;
   * `category_exhausted` means a gated category ran out and will not be padded.
   */
  fallback:
    | 'personalized' | 'relaxed' | 'popular_in_category'
    | 'popular_overall' | 'category_exhausted' | 'exhausted';
  cards: RecipeCard[];
};

export type SwipeAction = 'save' | 'pass';
