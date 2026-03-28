# MealForge — Product Requirements Document

## Vision

MealForge is a personal meal prep planning app built around a **component-based recipe system**. Instead of browsing monolithic recipes, you compose meals by mixing and matching modular building blocks: a protein, a carb, a veggie, a fat, a sauce, and a spice blend. An AI layer (Claude) acts as a **knowledge importer** — generating recipes, breaking them into components, and mapping flavor affinities — but the day-to-day experience runs entirely on local data. The more you use MealForge, the richer your personal food knowledge base becomes, and the less you need the AI.

---

## Core Architecture: The Four Layers

### Layer 1 — The Component Registry

The heart of the system. A persistent, growing database of food components organized by slot type. Each component is a rich data object, not just a name:

| Field | Description |
|---|---|
| `name` | Display name (e.g., "Chicken Thighs", "Quinoa", "Avocado") |
| `slot` | One of: `protein`, `carb`, `veggie`, `fat` |
| `macros_per_serving` | `{ protein_g, carb_g, fat_g, calories }` |
| `default_serving_g` | Typical serving size in grams |
| `prep_methods` | Array of prep approaches this component supports (e.g., `["roast", "pan_sear", "grill"]` for chicken thighs; `["raw", "canned_drain"]` for tuna) |
| `prep_notes` | Practical knowledge (e.g., "Thighs reheat better than breast over 5 days") |
| `flavor_affinities` | Array of `sauce` and/or `spice_blend` IDs this pairs well with |
| `tags` | Freeform tags: `["quick", "canned", "budget", "high_omega3", "seasonal_summer"]` |
| `cuisine_origins` | Optional: `["mediterranean", "japanese", "tex_mex"]` |
| `source` | `"seed"` \| `"ai_imported"` \| `"manual"` |

**Flavor affinities are the key innovation.** They encode which components taste good together, enabling the app to suggest valid swaps without calling an AI. If sardines have affinity with `lemon_caper_sauce`, `soy_sesame_sauce`, and `mediterranean_blend`, the app can locally compute that sardines are a valid swap into any recipe using those sauces or spice blends.

#### Sauces

Sauces are **first-class entities**, not a sub-type of Component. A sauce is something you prepare or assemble — salsa, harissa-yogurt, chimichurri, pesto, teriyaki glaze, lemon-caper butter. Sauces can have their own recipes (prep instructions, sub-ingredients with quantities, yield).

| Field | Description |
|---|---|
| `name` | Display name (e.g., "Harissa-Yogurt Sauce", "Fresh Salsa", "Chimichurri") |
| `sub_ingredients` | Array of `{ name, quantity, unit }` (e.g., `[{ "harissa paste", "2 tbsp" }, { "yogurt", "1/2 cup" }]`) |
| `recipe_instructions` | Step-by-step prep instructions for making the sauce (array of `PrepInstruction`) |
| `flavor_notes` | Tasting description: "smoky, tangy, creamy" |
| `heat_level` | 0–5 scale |
| `cuisine_origins` | `["north_african", "mediterranean"]` |
| `macros_per_serving` | `{ protein_g, carb_g, fat_g, calories }` |
| `default_serving_g` | Typical serving size in grams |
| `yield` | How much one batch makes (e.g., "1 cup", "6 servings") |
| `shelf_life_days` | How long it keeps in the fridge |
| `tags` | Freeform tags: `["make_ahead", "no_cook", "fermented", "quick"]` |
| `source` | `"seed"` \| `"ai_imported"` \| `"manual"` |

#### Spice Blends

Spice blends are dry or semi-dry seasoning combinations — a rub, a spice mix, a curry powder. Unlike sauces, they are typically mixed and applied rather than prepared as a separate dish.

| Field | Description |
|---|---|
| `name` | Display name (e.g., "Tex-Mex Spice Blend", "Za'atar", "Japanese Curry Powder") |
| `sub_ingredients` | Array of spices/herbs with ratios (e.g., `["cumin", "chili powder", "lime zest", "garlic powder"]`) |
| `flavor_notes` | Tasting description: "warm, earthy, citrusy" |
| `heat_level` | 0–5 scale |
| `cuisine_origins` | `["tex_mex", "mexican"]` |
| `application_method` | How it's typically used: `"dry_rub"`, `"mixed_into"`, `"sprinkled"`, `"toasted"` |
| `tags` | Freeform tags: `["pantry_staple", "smoky", "bright"]` |
| `source` | `"seed"` \| `"ai_imported"` \| `"manual"` |

Both sauces and spice blends participate in the flavor affinity graph and can be referenced by recipes and components alike. A recipe's flavor profile is defined by the combination of its sauce and/or spice blend — some recipes use both (e.g., a dry-rubbed chicken with a dipping sauce), some use only one.

#### Prep Instructions

Prep instructions are a **first-class type** — reusable, browsable, and manageable in the app. Instead of embedding instruction text directly on components, instructions are standalone objects that can be viewed, edited, and shared across components that use the same prep method.

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `title` | Short label (e.g., "Roast Chicken Thighs", "Boil Quinoa", "Pan-Sear Shrimp") |
| `component_id` | The component this instruction applies to (nullable — can be generic) |
| `prep_method` | The method: `"roast"`, `"pan_sear"`, `"boil"`, `"grill"`, `"raw"`, etc. |
| `steps` | Array of `Step` objects with ordered instructions |
| `estimated_time_minutes` | How long this prep takes |
| `tips` | Practical notes (e.g., "Pat dry for better sear", "Let rest 5 min before slicing") |
| `source` | `"seed"` \| `"ai_imported"` \| `"manual"` |

The app provides a dedicated view for browsing and managing prep instructions — searchable by component, prep method, or keyword. Users can edit instructions, add personal tips, or create new ones for methods not yet covered. When a component swap happens, the app looks up the appropriate prep instruction for the new component + prep method combination.

### Layer 2 — Recipe Templates

A recipe template captures a **preparation pattern** that is reusable across different component combinations. A template is NOT rigidly tied to specific ingredients — it's a shape:

> "Roast [PROTEIN] with [SPICE_BLEND], serve over [CARB] with [ROASTED_VEGGIE], [FAT], and [SAUCE]"

Each template stores:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `name` | Pattern name (e.g., "Sheet Pan Bowl", "Greek-Style Grain Bowl", "Stir-Fry over Rice") |
| `slot_constraints` | Per-slot constraints: which prep methods are required, which sauces/spice blends are compatible |
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
- New components, sauces, spice blends, and prep instructions are registered in their respective registries.
- Flavor affinities are mapped (Claude explicitly outputs which sauces and spice blends pair with which proteins, veggies, etc.).
- Recipe templates are extracted and stored.
- Specific recipe instances are saved to the archive.

**One Claude call might yield 10 recipes, 30 new components, a handful of new sauces and spice blends, and dozens of affinity edges.** This is the primary growth mechanism for the knowledge base.

#### Mode 2: "Inspire Me"
When weekly planning feels stale or the user wants fresh ideas without browsing. The user provides a prompt:

- "Give me something North African"
- "I'm tired of chicken, surprise me"
- "High protein, under 20 minutes prep"
- Or simply: "Give me 5 random recipes"

Claude generates fresh ideas. The app ingests them the same way as Mode 1 — breaking recipes into components, registering new entries, mapping affinities. After this call, "harissa-yogurt sauce" and "couscous" are in the registry forever.

#### Mode 3: "Riff on This"
The core Sunday planning workflow. The user starts from a recipe they already know and like, then explores variations:

1. **Browse** — User opens the archive and picks a recipe they want to riff on (e.g., "Chicken & Quinoa Greek Bowl").
2. **Manual swap** — User taps a component pill (e.g., the protein) and the app shows compatible alternatives ranked by flavor affinity. This is a **local operation** — no AI call. User swaps chicken for shrimp, sees macros update instantly.
3. **Generate variations** — User hits "Give me variations" on the current recipe. Claude receives the base recipe and generates 3–5 alternative versions by swapping components, adjusting sauces/spice blends, or suggesting a different template with the same flavor profile. Each variation is ingested into the registry like any other AI-generated recipe.

This mode optimizes for the real user journey: *"It's Sunday, I need to pick my meals for the week. Let me start from something I like and explore from there."* It blends local browsing/swapping with targeted AI assistance, keeping the user in control while surfacing ideas they wouldn't have thought of.

### Layer 4 — The Local Swap Engine

Once the Component Registry has flavor affinities populated, **swapping is a local operation with zero AI calls:**

1. User opens a recipe: "Chicken & Quinoa Greek Bowl"
2. Taps the protein slot.
3. App queries the registry: all `protein` components where `flavor_affinities` includes the current recipe's sauce and/or spice blend IDs.
4. Results displayed: shrimp, ground turkey, chickpeas, white fish, sardines.
5. User picks shrimp.
6. App looks up the prep instruction for shrimp + the required prep method.
7. Instructions update automatically. Macros recalculate from component data.
8. No API call was made.

**Instruction adjustment strategy (phased):**

- **MVP:** Each prep method has a generic prep instruction stored as a PrepInstruction object. Swapping replaces the relevant steps with the new component's prep instruction. Slightly rough but functional.
- **V2:** When Claude generates a recipe (Modes 1 & 2), it also pre-generates 2–3 instruction variants for the most common swaps. These are stored on the template. Swaps that match a pre-generated variant get polished instructions; others fall back to generic.
- **V3:** If no variant exists, optionally fire a lightweight Claude call to generate custom instructions for the specific swap, then cache the result on the template.

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
  │  Call Claude (seed, inspire, riff)      │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  Registry grows (new components,        │
  │  sauces, spice blends, affinities,     │
  │  prep instructions, templates)          │
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
- Ship with a default library of ~40 components across all 4 base slots:
  - **Proteins (8–10):** chicken thighs, chicken breast, canned tuna, sardines, ground turkey, eggs, shrimp, tofu, salmon, chickpeas
  - **Carbs (6–8):** quinoa, brown rice, jasmine rice, sweet potato, farro, couscous, black beans, lentils
  - **Veggies (8–10):** broccoli, spinach, bell peppers, cucumber, cherry tomatoes, corn, zucchini, roasted carrots, kale, edamame
  - **Fats (5–6):** avocado, olive oil, feta cheese, sesame oil, nuts/seeds, tahini
- Ship with a default library of sauces and spice blends:
  - **Sauces (6–8):** Greek lemon-olive oil, chimichurri, teriyaki glaze, lemon-caper butter, pesto, harissa-yogurt, fresh salsa, soy-sesame-ginger
  - **Spice Blends (5–7):** Tex-Mex (cumin-chili-lime), Mediterranean herb blend, Za'atar, Japanese curry powder, Cajun seasoning, Mustard-herb rub
- Sauces include sub-ingredient lists, recipe instructions, and flavor metadata.
- Spice blends include sub-ingredient lists, application methods, and flavor metadata.
- Each component fully populated with macros, prep methods, flavor affinities, and tags.
- Stored as JSON, loaded into local state on app start.
- User can add custom components, sauces, and spice blends through simple forms.

#### F2: AI Recipe Generation (Claude Integration)
- User triggers generation from the planning screen with optional constraints:
  - Free-text input: "Give me something with sardines and rice"
  - Component locks: pin a specific component and generate around it
  - Dietary targets: "High protein, over 40g per meal"
- App calls Claude (Sonnet via Anthropic API) with a system prompt encoding:
  - The component model schema (including sauce and spice blend schemas)
  - The user's current registries (so Claude references known components when possible)
  - Macro targets
  - Recent archive (last 2–4 weeks) for variety nudging
- Claude returns structured JSON: an array of 3–5 recipes, each decomposed into components + sauces + spice blends + instructions + macros.
- App parses the response:
  - Registers any new components, sauces, or spice blends not already in the registry.
  - Registers new prep instructions.
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
        "fat": { "name": "string", "serving_g": 50, "prep_method": "raw" }
      },
      "sauce": {
        "name": "string",
        "sub_ingredients": [{ "name": "harissa paste", "quantity": "2 tbsp" }],
        "recipe_instructions": ["Combine yogurt and harissa..."],
        "serving_g": 40
      },
      "spice_blend": {
        "name": "string",
        "sub_ingredients": ["cumin", "chili powder", "lime zest"],
        "application_method": "dry_rub"
      },
      "instructions": [
        { "order": 1, "title": "string", "content": "string", "timer_seconds": null }
      ],
      "macros_per_serving": { "protein_g": 45, "carb_g": 55, "fat_g": 12, "calories": 510 },
      "servings": 5,
      "prep_time_minutes": 45,
      "flavor_affinities": {
        "protein_to_sauce": ["sauce_id_1", "sauce_id_2"],
        "protein_to_spice_blend": ["blend_id_1"],
        "veggie_to_sauce": ["sauce_id_1"],
        "new_components": [
          { "name": "string", "slot": "string", "macros_per_serving": {}, "prep_methods": [], "affinities": [] }
        ],
        "new_sauces": [
          { "name": "string", "sub_ingredients": [], "flavor_notes": "string", "heat_level": 0 }
        ],
        "new_spice_blends": [
          { "name": "string", "sub_ingredients": [], "flavor_notes": "string", "heat_level": 0 }
        ]
      }
    }
  ]
}
```

#### F3: Local Component Swapping
- On any recipe card (generated or archived), each component slot is tappable — including the sauce and spice blend.
- Tapping opens a swap panel showing compatible alternatives from the registry:
  - Filtered by slot type (or sauce/spice blend type).
  - Ranked by flavor affinity match with the current recipe's other components.
  - Shows macro delta: "Swapping chicken thighs -> canned tuna: -5g protein, -8g fat per serving."
- Selecting a swap:
  - Updates the recipe's component list.
  - Recalculates macros from component data.
  - Looks up the appropriate `PrepInstruction` for the new component + prep method and adjusts instructions accordingly (MVP: generic prep instruction; V2: pre-generated variants).
- User can also force any swap regardless of affinity — the app shows a "no known pairing" note but allows it.
- No AI call is made during local swapping.

#### F4: "Riff on This" — AI-Powered Recipe Variations
- From any recipe detail view, user can trigger "Give me variations."
- App sends the base recipe to Claude with a request for 3–5 alternative versions.
- Claude generates variations by swapping components, trying different sauces/spice blends, or applying a different template to the same flavor profile.
- Each variation is parsed and ingested the same way as Mode 1/2 recipes — new components, sauces, spice blends, and affinities are registered.
- User can accept, further tweak, or discard each variation.

#### F5: Weekly Planning Flow
- "Plan My Week" screen: the Sunday ritual.
- The primary flow:
  1. **Browse the archive** — Scan favorites and past meals. Pick recipes you want to repeat or riff on.
  2. **Swap & tweak** — Tap component pills to make quick local swaps on any picked recipe.
  3. **Generate variations** — Hit "Give me variations" on a base recipe to get fresh ideas (Mode 3).
  4. **Generate from scratch** — Or skip browsing entirely and ask for 5 random recipes (Mode 2).
  5. **Assemble the plan** — Drag recipes into a 5-day (or custom) plan.
  6. **Commit** — Snapshot the plan into the archive with the week date.

#### F6: Recipe Archive
- All committed meals persist with:
  - Full recipe snapshot (components + sauce + spice blend + instructions, frozen at commit time).
  - Template ID (links back to the reusable template).
  - Date committed.
  - Macros per serving, serving count, prep time.
  - Source: `"ai_generated"` | `"manual"` | `"swap_variant"` | `"riff_variant"`
- Browsable grid view with recipe cards.
- Filter by: component (show all recipes using quinoa), sauce, spice blend, cuisine tag, date range, favorites only.
- Full-text search across recipe titles, component names, sauce names, and tags.
- Star/favorite toggle.
- Users can manually add a recipe without the generation flow.

#### F7: Recipe Detail View
- Clean, readable recipe card:
  - Title and template name.
  - Component breakdown: pills/chips for each slot — protein, carb, veggie, fat, sauce, spice blend. Each tappable for swapping.
  - Step-by-step instructions with timers.
  - Sauce recipe (if the sauce has prep instructions, expandable section showing how to make it).
  - Macro summary bar: protein, carbs, fat, calories per serving.
  - Prep time, serving count.
  - "Save to Archive" / "Add to This Week's Plan" / "Give Me Variations" actions.

#### F8: Prep Instruction Browser
- Dedicated view for browsing and managing prep instructions.
- Browse by component, prep method, or keyword search.
- Each instruction shows: title, steps, estimated time, tips.
- Users can edit existing instructions, add personal tips, or create new ones.
- Accessible from the main navigation — useful for mid-week reference ("How did I say to pan-sear that shrimp again?").

### P1 — Next Iteration

#### F9: Grocery List Generation
- After committing a weekly plan, auto-generate a consolidated shopping list.
- Aggregate quantities across recipes (if 3 recipes use olive oil, sum the amounts).
- Include sauce sub-ingredients (harissa paste, yogurt, etc.) expanded into the list.
- Group by store section (produce, protein/seafood, pantry/dry goods, dairy, frozen, spices).
- Check off items already in the pantry.
- Allow manual edits (add/remove items).

#### F10: Variety Tracking & Nudges
- Track component usage frequency over time.
- Surface in the generation prompt context: "You've had chicken thighs 4 of the last 5 weeks. You haven't used farro since January."
- Show a "variety score" on the planning screen — how diverse is this week's plan vs. recent history?
- Nudge toward underused components without forcing them.

#### F11: Component & Sauce Library Manager
- Dedicated UI for browsing, editing, and curating all registries (components, sauces, spice blends).
- Browse by type/slot, filter by tag, sort by frequency of use.
- Edit any entry: update macros, add prep notes, adjust affinities, edit sauce recipes.
- Merge duplicates (if Claude imports "baby spinach" and you already have "spinach").
- See stats: how many recipes use it, last used date, affinity count.

#### F12: Pre-Generated Swap Variants
- When Claude generates a recipe (Modes 1 & 2), the system prompt also requests 2–3 instruction variants for the most common protein and carb swaps.
- Stored on the recipe template.
- Swaps matching a pre-generated variant get polished, tested instructions instead of generic fallback.

### P2 — Future

#### F13: Prep Day Timeline
- Given committed meals, generate an optimized Sunday prep schedule.
- Parallelizes: "While rice cooks (20 min), roast chicken and broccoli. While chicken rests, chop cucumber."
- Includes sauce prep steps interleaved with main cooking.
- Timeline view showing what to do when across all recipes.

#### F14: Nutrition Dashboard
- Weekly/monthly macro trends: protein consistency, calorie spread, veggie diversity.
- Flag anomalies: "This week is 30% below your usual protein target."
- Track progress toward goals.

#### F15: Export & Sharing
- Export any recipe as Obsidian-compatible markdown (H1 title, description, bold Servings, HR, H2 Ingredients with gram equivalents, HR, H2 Instructions with H3 numbered steps and time estimates, HR, H2 Sauce Recipe, HR, H2 Notes).
- Share a recipe via link.
- Import recipes from URL or plain text -> Claude parses into component model.

#### F16: Swap Validation
- When a user attempts a swap with no known affinity, offer an optional "Ask Claude" button.
- Lightweight API call: "Would [component] work with [sauce/spice blend]?"
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
  - `POST /api/generate` — trigger Claude recipe generation (Mode 1 & 2)
  - `POST /api/riff` — generate variations of a base recipe (Mode 3)
  - `GET/POST /api/components` — CRUD for component registry
  - `GET/POST /api/sauces` — CRUD for sauce registry
  - `GET/POST /api/spice-blends` — CRUD for spice blend registry
  - `GET/POST /api/prep-instructions` — CRUD for prep instructions
  - `GET/POST /api/recipes` — CRUD for recipe archive
  - `GET/POST /api/templates` — CRUD for recipe templates
  - `GET/POST /api/plans` — weekly plan management
  - `POST /api/validate-swap` — swap validation (P2)

### AI Integration
- **Model:** Claude Sonnet (fast, cost-effective, strong at structured JSON output)
- **System prompt:** Encodes component model schema (including sauce and spice blend schemas), output JSON contract, user's macro targets, and style preferences.
- **Context per call:** Current registries (components, sauces, spice blends) so Claude reuses known entries, recent 2–4 weeks of archive (for variety), user constraints.
- **Structured output:** Claude returns JSON conforming to the defined schema. The frontend renders it. Claude never generates HTML or UI.
- **Token budget:** Each generation call includes registries + recent archive. At ~40 components + ~15 sauces + ~10 spice blends + ~20 recent recipes, this fits comfortably in Sonnet's context window. As the registries grow, summarize rather than dump raw.

### Data Model

```
Component {
  id: string (uuid)
  name: string
  slot: "protein" | "carb" | "veggie" | "fat"
  macros_per_serving: { protein_g, carb_g, fat_g, calories }
  default_serving_g: number
  prep_methods: PrepMethod[]
  prep_notes: string
  flavor_affinities: string[]  // IDs of sauces and spice blends
  tags: string[]
  cuisine_origins: string[]
  source: "seed" | "ai_imported" | "manual"
  usage_count: number
  last_used_at: datetime | null
  created_at: datetime
}

Sauce {
  id: string (uuid)
  name: string
  sub_ingredients: { name: string, quantity: string, unit: string }[]
  recipe_instructions: PrepInstruction[]
  flavor_notes: string
  heat_level: 0-5
  cuisine_origins: string[]
  macros_per_serving: { protein_g, carb_g, fat_g, calories }
  default_serving_g: number
  yield: string
  shelf_life_days: number | null
  tags: string[]
  source: "seed" | "ai_imported" | "manual"
  usage_count: number
  last_used_at: datetime | null
  created_at: datetime
}

SpiceBlend {
  id: string (uuid)
  name: string
  sub_ingredients: string[]
  flavor_notes: string
  heat_level: 0-5
  cuisine_origins: string[]
  application_method: "dry_rub" | "mixed_into" | "sprinkled" | "toasted"
  tags: string[]
  source: "seed" | "ai_imported" | "manual"
  usage_count: number
  last_used_at: datetime | null
  created_at: datetime
}

PrepInstruction {
  id: string (uuid)
  title: string
  component_id: string | null
  prep_method: PrepMethod
  steps: Step[]
  estimated_time_minutes: number
  tips: string
  source: "seed" | "ai_imported" | "manual"
  created_at: datetime
}

RecipeTemplate {
  id: string (uuid)
  name: string
  slot_constraints: {
    protein: { required_prep_methods: PrepMethod[] }
    carb: { required_prep_methods: PrepMethod[] }
    veggie: { required_prep_methods: PrepMethod[] }
    fat: { required_prep_methods: PrepMethod[] }
    sauce: { compatible_sauce_ids: string[] }
    spice_blend: { compatible_blend_ids: string[] }
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
  }
  sauce: SauceSnapshot | null
  spice_blend: SpiceBlendSnapshot | null
  instructions: Step[]
  servings: number
  macros_per_serving: { protein_g, carb_g, fat_g, calories }
  prep_time_minutes: number
  is_favorite: boolean
  source: "ai_generated" | "manual" | "swap_variant" | "riff_variant"
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

SauceSnapshot {
  sauce_id: string
  name: string
  serving_g: number
  macros: { protein_g, carb_g, fat_g, calories }
}

SpiceBlendSnapshot {
  spice_blend_id: string
  name: string
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
- Component "pills" color-coded by slot: warm red for protein, golden for carb, green for veggie, amber for fat, teal for sauce, purple for spice blend.
- Generous whitespace. Recipes should feel like reading a cookbook page, not a database row.

### Key Screens

1. **Home / This Week** — Current weekly plan (or empty state: "Ready to plan your week?"). Committed meals as horizontal recipe cards. Quick access to archive favorites.

2. **Plan My Week** — The Sunday ritual. Four sections: "Browse Your Archive" (filterable favorites grid), "Swap & Tweak" (inline component swapping on selected recipes), "Generate Ideas" (text input + generate, or "Give me variations" on a selected recipe), "Your Plan" (drop zone for 5 meals).

3. **Recipe Card (Generated)** — AI suggestion with each component as a tappable pill (including sauce and spice blend). Swap panel slides up from bottom. Macro bar updates in real time. Accept / Reject / "Give Me Variations" buttons.

4. **Recipe Detail** — Full view. Component pills at top (protein, carb, veggie, fat, sauce, spice blend), step-by-step instructions below, expandable sauce recipe section, macro sidebar. "Add to Plan", "Save to Archive", and "Give Me Variations" actions.

5. **Archive** — Grid of recipe cards. Filter bar: component, sauce, spice blend, cuisine, date range, favorites. Search. Cards show title, component pills, macro summary, date.

6. **Prep Instructions** — Browse by component or prep method. View step-by-step instructions, tips, and estimated times. Edit or add new instructions.

7. **Component Library** (P1) — Browse by type tab (proteins, carbs, veggies, fats, sauces, spice blends). Cards show name, macros, affinity count, usage stats, tags. Add/edit/merge actions. Sauce cards include expandable recipe view.

---

## MVP Scope — What to Build First

To get a usable app in a focused build sprint:

1. **Seed all registries** — Hardcoded JSON with ~40 components, ~8 sauces, ~6 spice blends, and prep instructions for common methods. Fully populated with macros, affinities, and metadata.
2. **Build the generation flow** — User sets constraints -> app calls Claude -> parses structured JSON -> renders recipe cards with swappable component pills (including sauce and spice blend pills).
3. **Implement local swapping** — Tap a component/sauce/spice blend pill -> see compatible alternatives from registry -> swap -> macros and instructions update.
4. **Build "Riff on This"** — From any recipe, generate AI-powered variations. Ingest results into registries.
5. **Build the archive** — Save recipes to persistent storage (SQLite via backend). Browse, search, favorite.
6. **Build the recipe detail view** — Clean, readable, with tappable pills, expandable sauce recipe, and "Give Me Variations" action.
7. **Build the prep instruction browser** — Viewable and editable prep instructions, searchable by component or method.
8. **Weekly plan screen** — The Sunday flow: browse archive -> swap/tweak -> generate ideas -> assemble plan -> commit.

**Out of scope for MVP:** Grocery list, variety tracking, prep day timeline, nutrition dashboard, export, swap validation.

---

## Open Questions

1. **Instruction adjustment fidelity** — For MVP, how rough is acceptable? Generic prep method snippets ("Pan-sear shrimp 3 min per side") vs. recipe-specific prose?

2. **Affinity bootstrapping** — Should Claude generate a big batch of affinity mappings upfront (every protein x sauce pair rated 1–5), or let affinities accumulate organically through recipe generation?

3. **Multi-component slots** — Some recipes naturally have 2 veggies (broccoli + edamame). Support multiple components per slot, or keep strict 1:1 for simplicity?

4. **Recipe editing** — Can users edit instructions after committing, or are archived recipes immutable snapshots? (Recommendation: immutable snapshots; "duplicate and edit" to create variants.)

5. **Hosting** — Deploy to the Hostinger VPS alongside existing services (email-to-obsidian, etc.) in its own Docker container? Or separate deployment target?

6. **Sauce + Spice Blend optionality** — Can a recipe have only a sauce, only a spice blend, both, or neither? (Recommendation: both optional, at least one required for flavor affinity to work.)
