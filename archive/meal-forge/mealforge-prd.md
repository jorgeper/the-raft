# MealForge — Product Requirements Document

## Vision

MealForge is a personal meal prep planning app built around a **component-based recipe system**. Instead of browsing monolithic recipes, you compose meals by mixing and matching modular building blocks: a protein, a carb, a veggie, a fat, and a sauce/spice profile. An AI layer (Claude) acts as a **knowledge importer** — generating recipes, breaking them into components, and mapping flavor affinities — but the day-to-day experience runs entirely on local data. The more you use MealForge, the richer your personal food knowledge base becomes, and the less you need the AI.

---

## Core Architecture: The Four Layers

### Layer 1 — The Component Registry

The heart of the system. A persistent, growing database of food components organized by slot type. Each component is a rich data object, not just a name:

[JP] make sauces and spices (or spice blends) different types. I also want to have recipes for sauces. consider things like "salsa" a sauce too. so sauces and spice blends probably need their own schema with fields.
[jp] prep instructions also need their own type. in the app i should be able to manage them and view them too.

| Field | Description |
|---|---|
| `name` | Display name (e.g., "Chicken Thighs", "Quinoa", "Harissa Spice Blend") |
| `slot` | One of: `protein`, `carb`, `veggie`, `fat`, `sauce_spice` |
| `macros_per_serving` | `{ protein_g, carb_g, fat_g, calories }` |
| `default_serving_g` | Typical serving size in grams |
| `prep_methods` | Array of prep approaches this component supports (e.g., `["roast", "pan_sear", "grill"]` for chicken thighs; `["raw", "canned_drain"]` for tuna) |
| `prep_instructions` | Generic instructions keyed by prep method |
| `prep_notes` | Practical knowledge (e.g., "Thighs reheat better than breast over 5 days") |
| `flavor_affinities` | Array of `sauce_spice` component IDs this pairs well with |
| `tags` | Freeform tags: `["quick", "canned", "budget", "high_omega3", "seasonal_summer"]` |
| `cuisine_origins` | Optional: `["mediterranean", "japanese", "tex_mex"]` |
| `source` | `"seed"` \| `"ai_imported"` \| `"manual"` |

**Flavor affinities are the key innovation.** They encode which components taste good together, enabling the app to suggest valid swaps without calling an AI. If sardines have affinity with `lemon_caper`, `soy_sesame`, and `mediterranean` sauce profiles, the app can locally compute that sardines are a valid swap into any recipe using those profiles.

Sauce/spice profiles are **first-class components**, not just strings. They carry their own data: sub-ingredient list (cumin + chili + lime = Tex-Mex profile), flavor notes, heat level, cuisine origin. This makes them composable and queryable just like proteins or carbs.

### Layer 2 — Recipe Templates

A recipe template captures a **preparation pattern** that is reusable across different component combinations. A template is NOT rigidly tied to specific ingredients — it's a shape:

> "Roast [PROTEIN] with [SPICE_PROFILE], serve over [CARB] with [ROASTED_VEGGIE] and [FAT]"

Each template stores:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `name` | Pattern name (e.g., "Sheet Pan Bowl", "Greek-Style Grain Bowl", "Stir-Fry over Rice") |
| `slot_constraints` | Per-slot constraints: which prep methods are required, which flavor profiles are compatible |
| `instruction_pattern` | Parameterized steps with slot placeholders |
| `prep_method_variants` | Pre-generated instruction variants keyed by prep method |
| `estimated_prep_time_min` | Base time (adjusted per component swap) |
| `servings` | Default batch size |

When Claude generates a recipe, the app extracts BOTH the specific instance AND the underlying template. One "Chicken & Quinoa Greek Bowl" recipe yields a template that can later be instantiated as "Shrimp & Farro Greek Bowl" without another AI call.

### Layer 3 — Claude as Knowledge Importer

Claude's role is **batch knowledge acquisition**, not a runtime dependency. It operates in three modes:

#### Mode 1: "Seed My Library"
On first run or whenever the user wants to expand their repertoire. The user triggers a generation session:

- Claude generates a batch of 5–10 complete recipes.
- The app parses each recipe into structured components.
- New components are registered in the Component Registry.
- Flavor affinities are mapped (Claude explicitly outputs which sauce profiles pair with which proteins, veggies, etc.).
- Recipe templates are extracted and stored.
- Specific recipe instances are saved to the archive.

**One Claude call might yield 10 recipes, 30 new components, and dozens of affinity edges.** This is the primary growth mechanism for the knowledge base.

#### Mode 2: "Inspire Me"
When weekly planning feels stale. The user provides a prompt:

- "Give me something North African"
- "I'm tired of chicken, surprise me"
- "High protein, under 20 minutes prep"

Claude generates fresh ideas. The app ingests them the same way as Mode 1 — breaking recipes into components, registering new entries, mapping affinities. After this call, "harissa spice blend" and "couscous" are in the registry forever.

[JP] not interested in this mode below number 3. instead, what I am interested is in optimizing for this user journey: it is sunday and I need to choose what to prep for that week. 
i want to browse existing recipes in the archive easily. sometimes when i pick a recipe i like, i want to be able to do some swaps myself, e.g. the UI would give me some
easy way to click on the "protein" and swap it with some other options that would go well (ranked by affinity). I'd also like a mode where it gives me several suggestions 
based on that recipe by doing swaps. I also want a mode where I don't even choose any "base" recipe by browsing, I simply tell it to give me 5 random recipes. I think this is 
exactly mode 2 already. so consider mode 3 instead being the journey that I describe above which is, let me browse, and then let me explicitly swap, and then let me generate
iterations of that base recipe. I think what I am described is similar to mode 4.

#### Mode 3: "Validate a Weird Swap" (Optional, Power-User)
When a user attempts a swap that has no known affinity in the registry. The app can optionally fire a lightweight Claude call:

- "Would sardines work with a harissa-yogurt sauce?"
- Claude returns: yes/no + a brief tip + updated affinity data.
- The new affinity is written back to the registry — this swap is now known locally.

This mode is optional. The app should always allow the user to force any swap — the validation is a suggestion, not a gate.

### Layer 4 — The Local Swap Engine

Once the Component Registry has flavor affinities populated, **swapping is a local operation with zero AI calls:**

1. User opens a recipe: "Chicken & Quinoa Greek Bowl"
2. Taps the protein slot.
3. App queries the registry: all `protein` components where `flavor_affinities` includes the current recipe's `sauce_spice` profile ID.
4. Results displayed: shrimp, ground turkey, chickpeas, white fish, sardines.
5. User picks shrimp.
6. App looks up the recipe template's `prep_method_variants` for shrimp's prep method (`pan_sear`).
7. Instructions update automatically. Macros recalculate from component data.
8. No API call was made.

**Instruction adjustment strategy (phased):**

- **MVP:** Each prep method has a generic instruction snippet stored on the component. Swapping replaces the relevant steps with the new component's generic instructions. Slightly rough but functional.
- **V2:** When Claude generates a recipe (Modes 1 & 2), it also pre-generates 2–3 instruction variants for the most common swaps. These are stored on the template. Swaps that match a pre-generated variant get polished instructions; others fall back to generic.
- **V3:** If no variant exists, optionally fire a Mode 3 call to generate custom instructions for the specific swap, then cache the result on the template.

---

## The Flywheel

```
  ┌─────────────────────────────────────────┐
  │  Use the app (browse, swap, plan)       │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  Discover gaps (stale meals, unknown    │
  │  affinities, empty slots)               │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  Call Claude (seed, inspire, validate)  │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  Registry grows (new components,        │
  │  affinities, templates, variants)       │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  More swaps work locally, less AI       │
  │  needed, richer planning experience     │
  └──────────────────┬──────────────────────┘
                     │
                     └──────── loops back ──┘
```

Early on: frequent Claude calls to seed knowledge.
After a few months: 90% of interactions are local. Claude is for genuine new inspiration only.

---

## User Personas

**Primary: Jorge** — Software engineer, meal preps on Sundays, targets high protein (~40–50g per container), values simplicity and variety. Wants the system to help him avoid repeating the same 3 meals forever while keeping prep under 90 minutes total.

---

## Feature Requirements

### P0 — MVP (Build First)

#### F1: Seeded Component Registry
- Ship with a default library of ~40 components across all 5 slots:
  - **Proteins (8–10):** chicken thighs, chicken breast, canned tuna, sardines, ground turkey, eggs, shrimp, tofu, salmon, chickpeas
  - **Carbs (6–8):** quinoa, brown rice, jasmine rice, sweet potato, farro, couscous, black beans, lentils
  - **Veggies (8–10):** broccoli, spinach, bell peppers, cucumber, cherry tomatoes, corn, zucchini, roasted carrots, kale, edamame
  - **Fats (5–6):** avocado, olive oil, feta cheese, sesame oil, nuts/seeds, tahini
  - **Sauce/Spice Profiles (6–8):** Greek (lemon-oregano-olive oil), Tex-Mex (cumin-chili-lime), Teriyaki (soy-honey-sesame-garlic), Mediterranean (olive oil-lemon-caper), Mustard-Lemon, Harissa, Pesto, Soy-Sesame-Ginger
- Each component fully populated with macros, prep methods, flavor affinities, and tags.
- Stored as JSON, loaded into local state on app start.
- User can add custom components through a simple form.

#### F2: AI Recipe Generation (Claude Integration)
- User triggers generation from the planning screen with optional constraints:
  - Free-text input: "Give me something with sardines and rice"
  - Component locks: pin a specific component and generate around it
  - Dietary targets: "High protein, over 40g per meal"
- App calls Claude (Sonnet via Anthropic API) with a system prompt encoding:
  - The component model schema
  - The user's current component registry (so Claude references known components when possible)
  - Macro targets
  - Recent archive (last 2–4 weeks) for variety nudging
- Claude returns structured JSON: an array of 3–5 recipes, each decomposed into components + instructions + macros.
- App parses the response:
  - Registers any new components not already in the registry.
  - Maps flavor affinities declared by Claude.
  - Extracts recipe templates.
  - Presents recipe cards to the user.

**System prompt contract (Claude's output schema):**
```json
{
  "recipes": [
    {
      "title": "string",
      "template_name": "string",
      "components": {
        "protein": { "name": "string", "serving_g": 200, "prep_method": "roast" },
        "carb": { "name": "string", "serving_g": 150, "prep_method": "boil" },
        "veggie": { "name": "string", "serving_g": 150, "prep_method": "roast" },
        "fat": { "name": "string", "serving_g": 50, "prep_method": "raw" },
        "sauce_spice": { "name": "string", "sub_ingredients": ["cumin", "chili", "lime"] }
      },
      "instructions": [
        { "order": 1, "title": "string", "content": "string", "timer_seconds": null }
      ],
      "macros_per_serving": { "protein_g": 45, "carb_g": 55, "fat_g": 12, "calories": 510 },
      "servings": 5,
      "prep_time_minutes": 45,
      "flavor_affinities": {
        "protein_to_sauce": ["sauce_id_1", "sauce_id_2"],
        "veggie_to_sauce": ["sauce_id_1"],
        "new_components": [
          { "name": "string", "slot": "string", "macros_per_serving": {}, "prep_methods": [], "affinities": [] }
        ]
      }
    }
  ]
}
```

#### F3: Local Component Swapping
- On any recipe card (generated or archived), each component slot is tappable.
- Tapping opens a swap panel showing compatible components from the registry:
  - Filtered by slot type.
  - Ranked by flavor affinity match with the current sauce/spice profile.
  - Shows macro delta: "Swapping chicken thighs → canned tuna: −5g protein, −8g fat per serving."
- Selecting a swap:
  - Updates the recipe's component list.
  - Recalculates macros from component data.
  - Adjusts instructions using the component's prep method data (MVP: generic swap; V2: pre-generated variants).
- User can also force any swap regardless of affinity — the app shows a "no known pairing" note but allows it.
- No AI call is made during swapping (unless user explicitly requests validation — Mode 3, post-MVP).

#### F4: Weekly Planning Flow
- "Plan My Week" screen: the Sunday ritual.
- User can:
  - Generate new suggestions (F2).
  - Pull favorites from the archive.
  - Mix both — 2 AI-generated new ideas + 3 archive favorites.
- Arrange into a 5-day (or custom) plan.
- "Commit" the plan → recipes snapshot into the archive with the week date.

#### F5: Recipe Archive
- All committed meals persist with:
  - Full recipe snapshot (components + instructions, frozen at commit time).
  - Template ID (links back to the reusable template).
  - Date committed.
  - Macros per serving, serving count, prep time.
  - Source: `"ai_generated"` | `"manual"` | `"swap_variant"`
- Browsable grid view with recipe cards.
- Filter by: component (show all recipes using quinoa), sauce profile, cuisine tag, date range, favorites only.
- Full-text search across recipe titles, component names, and tags.
- Star/favorite toggle.
- Users can manually add a recipe without the generation flow.

#### F6: Recipe Detail View
- Clean, readable recipe card:
  - Title and template name.
  - Component breakdown: 5 pills/chips showing each slot's component. Each tappable for swapping.
  - Step-by-step instructions with timers.
  - Macro summary bar: protein, carbs, fat, calories per serving.
  - Prep time, serving count.
  - "Save to Archive" / "Add to This Week's Plan" actions.

### P1 — Next Iteration

#### F7: Grocery List Generation
- After committing a weekly plan, auto-generate a consolidated shopping list.
- Aggregate quantities across recipes (if 3 recipes use olive oil, sum the amounts).
- Group by store section (produce, protein/seafood, pantry/dry goods, dairy, frozen).
- Check off items already in the pantry.
- Allow manual edits (add/remove items).

#### F8: Variety Tracking & Nudges
- Track component usage frequency over time.
- Surface in the generation prompt context: "You've had chicken thighs 4 of the last 5 weeks. You haven't used farro since January."
- Show a "variety score" on the planning screen — how diverse is this week's plan vs. recent history?
- Nudge toward underused components without forcing them.

#### F9: Component Library Manager
- Dedicated UI for browsing, editing, and curating the component registry.
- Browse by slot, filter by tag, sort by frequency of use.
- Edit any component: update macros, add prep notes, adjust affinities.
- Merge duplicates (if Claude imports "baby spinach" and you already have "spinach").
- See component stats: how many recipes use it, last used date, affinity count.

#### F10: Pre-Generated Swap Variants
- When Claude generates a recipe (Modes 1 & 2), the system prompt also requests 2–3 instruction variants for the most common protein and carb swaps.
- Stored on the recipe template.
- Swaps matching a pre-generated variant get polished, tested instructions instead of generic fallback.

### P2 — Future

#### F11: Prep Day Timeline
- Given committed meals, generate an optimized Sunday prep schedule.
- Parallelizes: "While rice cooks (20 min), roast chicken and broccoli. While chicken rests, chop cucumber."
- Timeline view showing what to do when across all recipes.

#### F12: Nutrition Dashboard
- Weekly/monthly macro trends: protein consistency, calorie spread, veggie diversity.
- Flag anomalies: "This week is 30% below your usual protein target."
- Track progress toward goals.

#### F13: Export & Sharing
- Export any recipe as Obsidian-compatible markdown (H1 title, description, bold Servings, HR, H2 Ingredients with gram equivalents, HR, H2 Instructions with H3 numbered steps and time estimates, HR, H2 Notes).
- Share a recipe via link.
- Import recipes from URL or plain text → Claude parses into component model.

#### F14: Swap Validation (Mode 3)
- When a user attempts a swap with no known affinity, offer an optional "Ask Claude" button.
- Lightweight API call: "Would [component] work with [sauce_spice profile]?"
- Returns: yes/no + tip + affinity data written back to registry.
- The swap is now known locally forever.

---

## Technical Architecture

### Frontend
- **React** single-page app (Vite + TypeScript)
- State management: Zustand (lightweight, fits the scale)
- Responsive: desktop for Sunday planning, mobile for mid-week recipe checking
- Styling: Tailwind CSS with a custom warm/editorial design token set

### Backend (Recommended: Option B)
- **Node.js + Express** API server on the Hostinger VPS (or containerized with Docker)
- **SQLite** database (via better-sqlite3 or Drizzle ORM)
- Proxies Anthropic API calls (keeps API key server-side)
- Serves the React frontend as static files
- REST API endpoints:
  - `POST /api/generate` — trigger Claude recipe generation
  - `GET/POST /api/components` — CRUD for component registry
  - `GET/POST /api/recipes` — CRUD for recipe archive
  - `GET/POST /api/templates` — CRUD for recipe templates
  - `GET/POST /api/plans` — weekly plan management
  - `POST /api/validate-swap` — Mode 3 swap validation (P2)

### AI Integration
- **Model:** Claude Sonnet (fast, cost-effective, strong at structured JSON output)
- **System prompt:** Encodes component model schema, output JSON contract, user's macro targets, and style preferences.
- **Context per call:** Current component registry (so Claude reuses known components), recent 2–4 weeks of archive (for variety), user constraints.
- **Structured output:** Claude returns JSON conforming to the defined schema. The frontend renders it. Claude never generates HTML or UI.
- **Token budget:** Each generation call includes registry + recent archive. At ~40 components + ~20 recent recipes, this fits comfortably in Sonnet's context window. As the registry grows, summarize rather than dump raw.

### Data Model

```
Component {
  id: string (uuid)
  name: string
  slot: "protein" | "carb" | "veggie" | "fat" | "sauce_spice"
  macros_per_serving: { protein_g, carb_g, fat_g, calories }
  default_serving_g: number
  prep_methods: PrepMethod[]
  prep_instructions: Map<PrepMethod, string>
  prep_notes: string
  flavor_affinities: string[]
  tags: string[]
  cuisine_origins: string[]
  source: "seed" | "ai_imported" | "manual"
  usage_count: number
  last_used_at: datetime | null
  created_at: datetime
}

SauceSpiceProfile extends Component {
  sub_ingredients: string[]
  flavor_notes: string
  heat_level: 0-5
}

RecipeTemplate {
  id: string (uuid)
  name: string
  slot_constraints: {
    protein: { required_prep_methods: PrepMethod[] }
    carb: { required_prep_methods: PrepMethod[] }
    veggie: { required_prep_methods: PrepMethod[] }
    fat: { required_prep_methods: PrepMethod[] }
    sauce_spice: { compatible_profile_ids: string[] }
  }
  instruction_pattern: Step[]
  prep_method_variants: Map<string, Step[]>
  base_prep_time_minutes: number
  base_servings: number
  created_at: datetime
}

Recipe {
  id: string (uuid)
  title: string
  template_id: string | null
  components: {
    protein: ComponentSnapshot
    carb: ComponentSnapshot
    veggie: ComponentSnapshot
    fat: ComponentSnapshot
    sauce_spice: ComponentSnapshot
  }
  instructions: Step[]
  servings: number
  macros_per_serving: { protein_g, carb_g, fat_g, calories }
  prep_time_minutes: number
  is_favorite: boolean
  source: "ai_generated" | "manual" | "swap_variant"
  created_at: datetime
}

ComponentSnapshot {
  component_id: string
  name: string
  slot: string
  serving_g: number
  prep_method: PrepMethod
  macros: { protein_g, carb_g, fat_g, calories }
}

WeeklyPlan {
  id: string (uuid)
  week_of: date
  recipes: Recipe[]
  committed_at: datetime
}

Step {
  order: number
  title: string
  content: string
  timer_seconds: number | null
}
```

---

## Design Direction

### Aesthetic
- **Warm, editorial, kitchen-magazine feel** — not a sterile SaaS dashboard.
- Earth tones: warm whites (#FAF7F2), olive greens (#5C6B4F), terracotta accents (#C4704B), charcoal text (#2D2D2D).
- Typography: A distinctive serif or slab-serif for headings (Fraunces, Bitter, or Playfair Display), paired with a clean sans-serif body (DM Sans, Source Sans 3).
- Cards with subtle texture — linen-paper feel, soft shadows, slight border radius.
- Component "pills" color-coded by slot: warm red for protein, golden for carb, green for veggie, amber for fat, purple for sauce/spice.
- Generous whitespace. Recipes should feel like reading a cookbook page, not a database row.

### Key Screens

1. **Home / This Week** — Current weekly plan (or empty state: "Ready to plan your week?"). Committed meals as horizontal recipe cards. Quick access to archive favorites.

2. **Plan My Week** — The Sunday ritual. Three sections: "Generate New Ideas" (text input + generate), "From Your Archive" (quick-pick favorites), "Your Plan" (drop zone for 5 meals).

3. **Recipe Card (Generated)** — AI suggestion with each component as a tappable pill. Swap panel slides up from bottom. Macro bar updates in real time. Accept / Reject buttons.

4. **Recipe Detail** — Full view. Component pills at top, step-by-step instructions below, macro sidebar. "Add to Plan" and "Save to Archive" actions.

5. **Archive** — Grid of recipe cards. Filter bar: component, sauce profile, cuisine, date range, favorites. Search. Cards show title, component pills, macro summary, date.

6. **Component Library** (P1) — Browse by slot tab. Component cards show name, macros, affinity count, usage stats, tags. Add/edit/merge actions.

---

## MVP Scope — What to Build First

To get a usable app in a focused build sprint:

1. **Seed the component registry** — Hardcoded JSON with ~40 components, fully populated with macros, prep methods, and flavor affinities.
2. **Build the generation flow** — User sets constraints → app calls Claude → parses structured JSON → renders recipe cards with swappable component pills.
3. **Implement local swapping** — Tap a component pill → see compatible alternatives from registry → swap → macros and instructions update.
4. **Build the archive** — Save recipes to persistent storage (SQLite via backend, or localStorage for prototype). Browse, search, favorite.
5. **Build the recipe detail view** — Clean, readable, with tappable component pills.
6. **Weekly plan screen** — Simple: pick 5 recipes (generated or from archive), commit.

**Out of scope for MVP:** Grocery list, variety tracking, prep day timeline, nutrition dashboard, export, Mode 3 validation.

---

## Open Questions

1. **Instruction adjustment fidelity** — For MVP, how rough is acceptable? Generic prep method snippets ("Pan-sear shrimp 3 min per side") vs. recipe-specific prose?

2. **Affinity bootstrapping** — Should Claude generate a big batch of affinity mappings upfront (every protein × sauce_spice pair rated 1–5), or let affinities accumulate organically through recipe generation?

3. **Multi-component slots** — Some recipes naturally have 2 veggies (broccoli + edamame). Support multiple components per slot, or keep strict 1:1 for simplicity?

4. **Recipe editing** — Can users edit instructions after committing, or are archived recipes immutable snapshots? (Recommendation: immutable snapshots; "duplicate and edit" to create variants.)

5. **Hosting** — Deploy to the Hostinger VPS alongside existing services (email-to-obsidian, etc.) in its own Docker container? Or separate deployment target?
