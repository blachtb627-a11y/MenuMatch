/**
 * The Terms of Service, Privacy Policy and Community Guidelines, as data.
 *
 * They live here rather than in a CMS or a static page for one reason: these
 * documents make promises about what the app does, and keeping them next to
 * the code means a change in behaviour and a change in the promise land in the
 * same diff. Every factual claim below — what is stored, what is sent where,
 * what deletion does — is checked against the schema in supabase/migrations
 * and the Edge Functions in supabase/functions.
 *
 * NOT LEGAL ADVICE. These are drafts written to be accurate about the product;
 * they have not been reviewed by a lawyer. The bracketed placeholders in
 * OPERATOR must be filled in with real details before launch, and the whole
 * set should be reviewed by counsel in the jurisdiction you operate from.
 */

/** Real-world facts that only the operator can supply. */
export const OPERATOR = {
  /** The person or company legally responsible for the service. */
  legalName: '[LEGAL ENTITY NAME]',
  /** Where notices are sent. A real, monitored address is a legal requirement. */
  postalAddress: '[POSTAL ADDRESS]',
  supportEmail: '[support@menumatch.store]',
  privacyEmail: '[privacy@menumatch.store]',
  /** DMCA §512(c) designated agent, also registered with the US Copyright Office. */
  copyrightEmail: '[copyright@menumatch.store]',
  /** Whose law governs, and where disputes are heard. */
  jurisdiction: '[STATE / COUNTRY]',
} as const;

export const EFFECTIVE = 'Effective 7 September 2026';

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'callout'; text: string };

export type LegalSection = { heading: string; blocks: LegalBlock[] };

export type LegalDoc = {
  slug: 'terms' | 'privacy' | 'guidelines';
  title: string;
  effective: string;
  readingTime?: string;
  intro: string;
  sections: LegalSection[];
  footer: string;
};

const p = (text: string): LegalBlock => ({ kind: 'p', text });
const list = (...items: string[]): LegalBlock => ({ kind: 'bullets', items });
const callout = (text: string): LegalBlock => ({ kind: 'callout', text });

// ------------------------------------------------------------- guidelines

export const GUIDELINES: LegalDoc = {
  slug: 'guidelines',
  title: 'Community Guidelines',
  effective: EFFECTIVE,
  readingTime: '4 min read',
  intro:
    'MenuMatch is for finding something to cook tonight. These are the rules '
    + 'that keep it that way. They are short on purpose, and we enforce the '
    + 'ones about safety and other people’s work strictly.',
  sections: [
    {
      heading: 'Post recipes people can actually cook',
      blocks: [
        p('A recipe here needs a title, an ingredient list, and steps that get '
          + 'someone from those ingredients to that dish. That is the whole bar.'),
        p('Things that are not recipes get removed: a photo of a restaurant meal '
          + 'with no method, a link to a recipe somewhere else, a list of '
          + 'ingredients with no instructions, or a post that is really an '
          + 'advertisement wearing a recipe as a costume.'),
      ],
    },
    {
      heading: 'Post recipes you have the right to post',
      blocks: [
        p('Copy someone else’s recipe post and you are taking their work. The '
          + 'law here is more specific than most people expect, so it is worth '
          + 'being precise about it.'),
        p('In the United States, a bare list of ingredients is a statement of '
          + 'fact and is not protected by copyright. Nobody owns "flour, butter, '
          + 'sugar, eggs". What is protected is the expression around it: the '
          + 'story above the recipe, the particular wording of the method, and '
          + 'the photographs. Those belong to whoever wrote and shot them.'),
        p('So: cooking a recipe you read in a book or on a blog and posting your '
          + 'own version is fine and always has been. Pasting their headnote and '
          + 'their instructions verbatim is not. Using their photo is not.'),
        list(
          'Write the method in your own words.',
          'Photograph your own plate. Not a stock image, not their photo, not a '
            + 'screenshot.',
          'Credit where the idea came from. It is good manners and it costs you '
            + 'nothing — "adapted from" is a normal thing to write.',
          'If a recipe is genuinely yours and someone posts it here, tell us. '
            + 'There is a dedicated copyright path, separate from ordinary '
            + 'reports, and it is faster.',
        ),
      ],
    },
    {
      heading: 'Be accurate about allergens and diet',
      blocks: [
        p('People filter this app by what they cannot eat. When you tag a recipe '
          + 'vegan, or gluten-free, or nut-free, someone may act on that tag '
          + 'without reading the ingredients twice.'),
        callout('Tag what is actually in the dish, including what is in the stock, '
          + 'the sauce, and the fat you fried it in. If you are not certain a '
          + 'recipe is free of something, do not tag it as free of that thing.'),
        p('Deliberately mislabelling an allergen is treated as an unsafe-content '
          + 'report, not a mistake. It is the fastest way to be removed from '
          + 'MenuMatch.'),
      ],
    },
    {
      heading: 'Do not post food that will hurt someone',
      blocks: [
        p('Most cooking is not dangerous. A few things are, and they get removed '
          + 'on sight:'),
        list(
          'Home canning, curing or fermenting methods that skip a tested process '
            + '— botulism is not a matter of opinion.',
          'Foraging posts that identify a wild mushroom or plant as safe to eat.',
          'Methods that leave meat, eggs or dairy at unsafe temperatures without '
            + 'saying so.',
          'Recipes built around non-food items, undeclared alcohol in food aimed '
            + 'at children, or any drug.',
          'Content that promotes disordered eating: extreme restriction, purging, '
            + 'or calorie targets framed as a challenge.',
        ),
        p('If a recipe is legitimately risky but legitimate — raw egg in a '
          + 'mayonnaise, rare steak, a proper sourdough starter — say so in the '
          + 'recipe. Being upfront about the risk is the difference.'),
      ],
    },
    {
      heading: 'Keep it about the food',
      blocks: [
        p('MenuMatch has no comments section and no DMs, which removes most of '
          + 'the ways people hurt each other online. What remains still matters:'),
        list(
          'No harassment, hate, or targeting a person or group.',
          'No sexual content, and nothing sexualising a minor — this one ends an '
            + 'account immediately and is reported onward.',
          'No impersonating another cook, publication or brand.',
          'No spam: affiliate funnels, dropshipping links, engagement bait, or '
            + 'the same recipe posted fifteen times.',
        ),
      ],
    },
    {
      heading: 'Reporting something',
      blocks: [
        p('Every recipe has a report control. Reports go to a human queue, not '
          + 'to an automated filter that decides on its own.'),
        p('Reports about unsafe food, copyright, impersonation, harassment or '
          + 'sexual content are triaged within 24 hours. Everything else is '
          + 'triaged within 72. Triaged means a person has looked at it and '
          + 'decided what happens next.'),
        p('You can also block an account. Blocking is immediate, needs no '
          + 'justification, and is not visible to the person blocked — their '
          + 'recipes stop appearing for you and yours stop appearing for them.'),
      ],
    },
    {
      heading: 'What happens if you break these',
      blocks: [
        p('The response is meant to fit what happened. In rough order: a warning, '
          + 'removing the recipe, restricting an account, suspending it, and '
          + 'banning it.'),
        p('Serious breaches skip straight to the end. Sexual content involving '
          + 'minors, and credible threats, end an account on the first instance.'),
        p('Repeated copyright infringement ends an account too. That is not us '
          + 'being strict — a platform that does not terminate repeat infringers '
          + 'loses its legal protection, so it is not a discretionary call.'),
      ],
    },
    {
      heading: 'If you think we got it wrong',
      blocks: [
        p('Every moderation action can be appealed once, in writing, and a '
          + 'different person reviews it than the one who made the call. You will '
          + 'be told the outcome and the reason.'),
        p('We do get it wrong. An appeal that shows we did is the fastest way to '
          + 'fix it, and reinstatement restores the recipe and the account '
          + 'exactly as they were.'),
      ],
    },
  ],
  footer:
    'These guidelines form part of the Terms of Service. Where the two overlap, '
    + 'the Terms control.',
};

// ------------------------------------------------------------------ terms

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  effective: EFFECTIVE,
  readingTime: '8 min read',
  intro:
    `These terms are the agreement between you and ${OPERATOR.legalName} `
    + '("MenuMatch", "we") about your use of the MenuMatch app and '
    + 'menumatch.store. Using MenuMatch means you accept them.',
  sections: [
    {
      heading: 'Who can use MenuMatch',
      blocks: [
        p('You must be at least 13 years old. If you are under 18, you may use '
          + 'MenuMatch only with the involvement of a parent or guardian who '
          + 'accepts these terms on your behalf.'),
        p('Some countries set a higher minimum age for consenting to data '
          + 'processing on your own — 16 in parts of the EU. Where that applies '
          + 'to you, that age is the minimum instead of 13.'),
        p('You may browse recipes without an account. Creating an account, '
          + 'saving recipes and posting recipes require one.'),
      ],
    },
    {
      heading: 'Your account',
      blocks: [
        p('Keep your password to yourself and tell us if you think someone else '
          + 'has it. You are responsible for what happens under your account.'),
        p('One person, one account. Do not create an account to evade a '
          + 'suspension, and do not sell or transfer an account.'),
      ],
    },
    {
      heading: 'Your recipes stay yours',
      blocks: [
        p('You keep ownership of everything you post. We do not claim it, and we '
          + 'do not sell it.'),
        p('To run the service we need your permission to do specific things with '
          + 'what you post. So you grant MenuMatch a non-exclusive, worldwide, '
          + 'royalty-free licence to host, store, reproduce, resize and display '
          + 'your recipes and photographs, for the purpose of operating and '
          + 'promoting MenuMatch. That licence covers showing your recipe in the '
          + 'discovery deck, in search, in another user’s cookbook, and in '
          + 'screenshots of the app.'),
        callout('This licence exists so the app can show your recipe to other '
          + 'people. It does not let us sell your recipe, license it to a third '
          + 'party, or put it in a cookbook we publish.'),
        p('The licence ends when you delete the recipe, except that a copy may '
          + 'remain in the cookbooks of people who already saved it, and in '
          + 'backups, until those expire. Removing a published recipe takes it '
          + 'out of discovery immediately.'),
        p('You confirm that what you post is yours to post, and that it does not '
          + 'infringe anyone’s copyright, trade mark or privacy. See the '
          + 'Community Guidelines for what that means for recipes specifically.'),
      ],
    },
    {
      heading: 'Rules of use',
      blocks: [
        p('The Community Guidelines are part of these terms. In addition, do not:'),
        list(
          'Scrape, crawl or bulk-download recipes, or use automated means to '
            + 'access the service.',
          'Reverse-engineer the app, or probe, scan or test the security of our '
            + 'systems without written permission.',
          'Interfere with anyone else’s use of the service, or with the ranking '
            + 'of recipes — no vote manipulation, no fake accounts, no bot saves.',
          'Use MenuMatch to build a competing dataset or to train a machine '
            + 'learning model on other people’s recipes.',
        ),
      ],
    },
    {
      heading: 'Moderation, suspension and appeals',
      blocks: [
        p('We may remove a recipe, restrict, suspend or terminate an account that '
          + 'breaches these terms or the Community Guidelines, and we may do it '
          + 'without notice where the breach is serious or ongoing.'),
        p('You will be told what action was taken and why, and you may appeal '
          + 'once. A different reviewer handles the appeal. If the appeal '
          + 'succeeds, the content and the account are restored.'),
        p('We terminate the accounts of repeat copyright infringers.'),
      ],
    },
    {
      heading: 'Copyright complaints',
      blocks: [
        p('If you believe a recipe on MenuMatch infringes your copyright, send a '
          + `notice to ${OPERATOR.copyrightEmail} containing: your contact `
          + 'details; identification of the work; identification of the '
          + 'infringing recipe; a statement that you believe in good faith the '
          + 'use is unauthorised; a statement that the information is accurate '
          + 'and that you are authorised to act; and your signature.'),
        p('We will remove or disable access to the recipe and notify the person '
          + 'who posted it, who may submit a counter-notice.'),
        p('Bear in mind the point made in the Community Guidelines: a list of '
          + 'ingredients on its own is generally not protectable. A notice about '
          + 'ingredients alone is unlikely to succeed. Misrepresenting '
          + 'infringement in a notice can make you liable for damages.'),
      ],
    },
    {
      heading: 'The AI features',
      blocks: [
        p('MenuMatch can read a photograph of a recipe and fill in the composer '
          + 'fields for you, and can estimate the nutrition of a recipe from its '
          + 'ingredients. Both use a third-party model (Anthropic’s Claude).'),
        p('Both are drafting aids and both are sometimes wrong. The scan can '
          + 'misread a quantity. The nutrition figures are an estimate from '
          + 'ingredient names and amounts, not a laboratory analysis, and can be '
          + 'substantially off.'),
        callout('Check what the scan produced before you publish it. Nutrition '
          + 'estimates are not dietary, nutritional or medical advice, and should '
          + 'not be relied on for managing a medical condition.'),
        p('You are responsible for what you publish, including anything the scan '
          + 'drafted for you. Scanning a recipe from a book does not give you the '
          + 'right to publish it — see the Community Guidelines.'),
      ],
    },
    {
      heading: 'Food safety',
      blocks: [
        p('MenuMatch hosts recipes written by its users. We do not test them, '
          + 'cook them, or verify their claims — including their allergen and '
          + 'dietary tags.'),
        callout('If you have a food allergy or intolerance, read the full '
          + 'ingredient list every time. Do not rely on a tag, a filter, or a '
          + 'dietary preference setting to keep you safe. They are conveniences '
          + 'for browsing, not a safety mechanism.'),
        p('Cooking involves heat, blades and raw ingredients. Follow safe food '
          + 'handling practice, cook to safe internal temperatures, and use your '
          + 'judgement. If a recipe looks wrong to you, it may well be — report '
          + 'it.'),
      ],
    },
    {
      heading: 'The service itself',
      blocks: [
        p('MenuMatch is provided as it is. We do not promise it will be '
          + 'uninterrupted, error-free, or that any recipe will suit you.'),
        p('We may change, suspend or discontinue features. Where a change removes '
          + 'something you rely on we will give notice if we reasonably can. You '
          + 'can export your data at any time from Settings.'),
        p('You may stop using MenuMatch at any time.'),
      ],
    },
    {
      heading: 'Disclaimers and liability',
      blocks: [
        p('To the fullest extent the law allows, MenuMatch is provided without '
          + 'warranties of any kind, express or implied, including merchantability, '
          + 'fitness for a particular purpose and non-infringement.'),
        p('To the fullest extent the law allows, MenuMatch is not liable for '
          + 'indirect, incidental, special, consequential or punitive damages, or '
          + 'for loss of profits, data or goodwill, arising from your use of the '
          + 'service or from any recipe on it. Our total liability for any claim '
          + 'is limited to the greater of the amount you paid us in the twelve '
          + 'months before the claim, or fifty US dollars.'),
        p('Nothing in these terms excludes liability that cannot lawfully be '
          + 'excluded — including liability for death or personal injury caused '
          + 'by negligence, or for fraud. Some jurisdictions do not allow the '
          + 'exclusions above, so they may not apply to you, and you may have '
          + 'consumer rights that these terms cannot reduce.'),
      ],
    },
    {
      heading: 'Indemnity',
      blocks: [
        p('You agree to indemnify MenuMatch against claims, damages and '
          + 'reasonable legal costs arising from recipes you post, from your '
          + 'breach of these terms, or from your infringement of someone else’s '
          + 'rights.'),
      ],
    },
    {
      heading: 'Governing law and disputes',
      blocks: [
        p(`These terms are governed by the laws of ${OPERATOR.jurisdiction}, and `
          + `the courts of ${OPERATOR.jurisdiction} have jurisdiction over any `
          + 'dispute. If you are a consumer resident elsewhere, you keep the '
          + 'protection of the mandatory laws of your country of residence and '
          + 'may bring proceedings there.'),
        p('Before filing anything, email us. Most disputes are a misunderstanding '
          + 'that a person can resolve in a day.'),
      ],
    },
    {
      heading: 'Changes to these terms',
      blocks: [
        p('We may update these terms. If a change materially affects your rights '
          + 'we will give notice in the app before it takes effect. Continuing to '
          + 'use MenuMatch after that means you accept the new terms; if you do '
          + 'not, stop using the service and delete your account.'),
      ],
    },
    {
      heading: 'Contact',
      blocks: [
        p(`${OPERATOR.legalName}\n${OPERATOR.postalAddress}\n`
          + `${OPERATOR.supportEmail}`),
      ],
    },
  ],
  footer:
    'If any part of these terms is held unenforceable, the rest continues to '
    + 'apply. These terms, together with the Community Guidelines and the '
    + 'Privacy Policy, are the entire agreement between you and MenuMatch.',
};

// ---------------------------------------------------------------- privacy

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  effective: EFFECTIVE,
  readingTime: '9 min read',
  intro:
    'This explains what MenuMatch stores about you, why, who else sees it, and '
    + 'how to get it back or get rid of it. It describes what the app actually '
    + 'does, not what a privacy policy generator thinks an app might do.',
  sections: [
    {
      heading: 'The short version',
      blocks: [
        list(
          'We store your account, your recipes, and what you swipe on. That is '
            + 'most of it.',
          'There are no analytics SDKs, no crash reporters, no advertising '
            + 'identifiers and no third-party trackers in this app. We are not '
            + 'measuring you for anyone else.',
          'We do not collect your location, your contacts, or any payment '
            + 'information. There is no code in the app that can.',
          'We do not sell your data or share it for advertising. Ever.',
          'Your recipes and profile are public. Your swipes, saves, collections '
            + 'and preferences are not.',
        ),
      ],
    },
    {
      heading: 'What we collect',
      blocks: [
        p('Your account. An email address, a username, a display name, and '
          + 'optionally a bio and an avatar. Your password is handled by our '
          + 'authentication provider and we never see it.'),
        p('Your age band, not your birthday. Onboarding asks your age and we keep '
          + 'only which band you fall into — under 13, 13–15, 16–17, or 18 and '
          + 'over — because that is all we need to apply the right rules.'),
        p('What you tell us you like. Dietary tags, allergens, cuisines, '
          + 'disliked ingredients, skill level and units, from onboarding and '
          + 'from Dietary preferences in Settings.'),
        p('What you make. Recipes, their ingredients, steps, tags and photos; '
          + 'collections; and a record of the recipes you mark as cooked.'),
        p('What you do. Every swipe (whether it was a save or a pass, on which '
          + 'recipe, at what time), which recipes you open, what you save, and '
          + 'the "less like this" signals you give. This is what makes the deck '
          + 'get better; there is no way to run the feed without it.'),
        p('Your device. When the app starts it registers an opaque random '
          + 'identifier that the app generates on your device, along with the '
          + 'platform (iOS, Android or web) and the app version. It is not your '
          + 'hardware ID, your advertising ID or anything Apple or Google issues, '
          + 'and it cannot be linked to you outside MenuMatch.'),
        p('Safety records. Reports you file, appeals you make, moderation '
          + 'decisions about your account, and an internal audit log of '
          + 'administrator actions. We keep these because a moderation system '
          + 'that cannot show its own history cannot be held to account.'),
      ],
    },
    {
      heading: 'Browsing without an account',
      blocks: [
        p('You can use the discovery deck as a guest. In that mode your swipes '
          + 'are recorded against the device identifier described above, with no '
          + 'account attached, so the deck can stop showing you what you have '
          + 'already seen.'),
        p('If you later create an account, that guest history is attached to it, '
          + 'so the taste you built up as a guest is not thrown away. If you '
          + 'never create an account, it stays a set of rows tied to an '
          + 'identifier with no name on it.'),
      ],
    },
    {
      heading: 'What is public and what is not',
      blocks: [
        p('Public: your username, display name, bio, avatar, your published '
          + 'recipes and their photos, and how many times each recipe has been '
          + 'saved and cooked.'),
        p('Private: your email, your age band, your swipes, your saves, your '
          + 'collections, your dietary preferences, who you have blocked, and '
          + 'reports you file. Other users cannot see any of it. Blocking is '
          + 'invisible to the person you block.'),
        callout('One thing worth knowing: recipe photos are stored on a public '
          + 'URL. Anyone who has the link can open the image without signing in, '
          + 'and the link contains your account identifier. The links are long '
          + 'and random, so they are not guessable, but treat a photo you upload '
          + 'as published rather than as private.'),
        p('Photo metadata is removed. The app asks the picker not to hand over '
          + 'EXIF data and re-encodes images before upload, so the GPS '
          + 'coordinates and camera details a phone normally embeds do not '
          + 'travel with your photo.'),
      ],
    },
    {
      heading: 'Why we use it',
      blocks: [
        list(
          'To run your account and let you sign in — necessary to provide the '
            + 'service you asked for.',
          'To rank and personalise the deck, and to keep already-seen recipes '
            + 'out of it — our legitimate interest in the product working, and '
            + 'the core of what MenuMatch is.',
          'To show your recipes to other people — necessary to provide the '
            + 'service.',
          'To keep the platform safe and enforce the guidelines — our legitimate '
            + 'interest, and in places a legal obligation.',
          'To fix things when they break, using server logs.',
        ),
        p('Where you are in the UK or EU, those are the lawful bases we rely on. '
          + 'We do not rely on consent for any of the above, because none of it '
          + 'is optional to the service; there is nothing here you would need to '
          + 'opt out of separately.'),
      ],
    },
    {
      heading: 'Who else touches your data',
      blocks: [
        p('Three companies, each for a specific job, none of them advertisers.'),
        p('Supabase hosts the database, file storage, and the authentication '
          + 'system that holds your email and password. Effectively everything '
          + 'described above lives on their infrastructure.'),
        p('Anthropic processes the AI features described in the next section.'),
        p('GitHub serves the web version of the app at menumatch.store, which '
          + 'means it handles the request when you load the page.'),
        p('We also disclose data where the law requires it — a valid legal '
          + 'process — or where it is necessary to investigate a credible threat '
          + 'to someone’s safety. If MenuMatch is ever sold or merged, account '
          + 'data would transfer with it, and we would tell you before that '
          + 'happened.'),
        p('That is the complete list. There is no analytics vendor, no crash '
          + 'reporting service, no advertising network and no data broker, '
          + 'because there is no code in the app that talks to one.'),
      ],
    },
    {
      heading: 'The AI features, specifically',
      blocks: [
        p('Two features send data to Anthropic, and it is worth being exact '
          + 'about what.'),
        p('Scanning a recipe sends the photograph you took, and nothing else. No '
          + 'name, no email, no account identifier, no device identifier travels '
          + 'with it. The photo is sent directly in the request rather than being '
          + 'uploaded anywhere first, so it never becomes a stored file and we do '
          + 'not keep a copy. Once the fields come back, the image is gone from '
          + 'our side.'),
        p('Estimating nutrition sends text only: the recipe title, the number of '
          + 'servings, and the ingredient lines. No photo and no identifiers.'),
        p('Anthropic processes this on our behalf as a service provider. Their '
          + 'own handling and retention of API requests is governed by their '
          + 'terms, not by ours. Both features are things you choose to press; '
          + 'nothing is sent to Anthropic unless you scan or estimate.'),
      ],
    },
    {
      heading: 'How long we keep it',
      blocks: [
        p('Your account and recipes stay until you remove them. Swipe history '
          + 'accumulates while you use the app, because the deck reads it.'),
        p('When an account is deleted it is immediately taken out of MenuMatch: '
          + 'sign-in stops working, the profile disappears, and the account’s '
          + 'recipes come out of discovery. After 30 days the personal details '
          + 'are erased — email, username, display name, bio, avatar, age band '
          + 'and saved preferences — leaving a pseudonymous shell that keeps '
          + 'other people’s cookbooks and the moderation record from breaking.'),
        p('Recipes that other people saved are kept as removed rather than '
          + 'erased, for the same reason. A draft you never published is deleted '
          + 'outright when you delete it.'),
        p('Moderation and audit records outlive the account they concern. A '
          + 'record of why an account was banned is the one thing that has to '
          + 'survive the ban.'),
      ],
    },
    {
      heading: 'Your rights over your data',
      blocks: [
        p('Wherever you live, you can:'),
        list(
          'Get a copy. Settings → Export my data returns everything we hold '
            + 'that is meaningfully yours — account, preferences, recipes, saves, '
            + 'collections, cooks, blocks and swipe history — as a JSON file, '
            + 'immediately and without asking us.',
          'Correct it. Profile fields and preferences are editable in the app.',
          'Delete it. See below.',
          'Object to how we use it, or ask us to restrict it, by writing to us.',
        ),
        p('If you are in the UK or EU you have these rights under the UK GDPR and '
          + 'GDPR, including the right to complain to your data protection '
          + 'authority. If you are in California you have the rights under the '
          + 'CCPA, including the right to know and to delete; note that we do not '
          + 'sell or share personal information as those terms are defined there, '
          + 'so there is nothing to opt out of.'),
        p(`To exercise anything that is not a button in the app, write to `
          + `${OPERATOR.privacyEmail} from your account email address. We answer `
          + 'within 30 days.'),
      ],
    },
    {
      heading: 'Deleting your account',
      blocks: [
        p(`To delete your account, email ${OPERATOR.privacyEmail} from the address `
          + 'on the account. We action it and confirm when it is done, and the '
          + '30-day erasure described above runs from that point.'),
        p('You can delete individual recipes yourself at any time, from the '
          + 'recipe’s own edit screen.'),
      ],
    },
    {
      heading: 'Children',
      blocks: [
        p('MenuMatch is not for children under 13, and we do not knowingly '
          + 'collect their data. If you believe a child under 13 has an account, '
          + `tell us at ${OPERATOR.privacyEmail} and we will remove it.`),
      ],
    },
    {
      heading: 'Where your data is held',
      blocks: [
        p('Our providers operate internationally, so your data may be processed '
          + 'outside the country you live in, including in the United States. '
          + 'Where data leaves the UK or EEA, transfers rely on the standard '
          + 'contractual clauses in our agreements with those providers.'),
      ],
    },
    {
      heading: 'Security',
      blocks: [
        p('Every table in the database enforces row-level security, so the rules '
          + 'about who can read what are applied by the database itself rather '
          + 'than trusted to the app. Passwords are hashed by our authentication '
          + 'provider and are not visible to us. Traffic is encrypted in transit. '
          + 'Administrator actions are logged.'),
        p('No system is perfectly secure, and we will not pretend otherwise. If '
          + 'you find a vulnerability, please tell us at '
          + `${OPERATOR.supportEmail} before telling anyone else.`),
      ],
    },
    {
      heading: 'Changes to this policy',
      blocks: [
        p('If we change what we collect or who we share it with, we will update '
          + 'this page and tell you in the app before the change takes effect. '
          + 'The effective date at the top always reflects the current version.'),
      ],
    },
    {
      heading: 'Contact',
      blocks: [
        p(`${OPERATOR.legalName}\n${OPERATOR.postalAddress}\n`
          + `${OPERATOR.privacyEmail}`),
      ],
    },
  ],
  footer:
    'MenuMatch is the data controller for the information described here.',
};

export const LEGAL_DOCS = { terms: TERMS, privacy: PRIVACY, guidelines: GUIDELINES };
