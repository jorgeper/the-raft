# The playable Viking

`public/models/viking.glb` (skinned character) and `public/models/viking-anims.glb` (8 clips) are built from
Quaternius' CC0 packs and committed, since itch.io downloads can't be scripted. All three packs share one
65-bone skeleton (UE-mannequin names: `pelvis`, `spine_01`…, `hand_r`), so clips bind to the character by bone name.

| Part | Source (free "Standard" tier, CC0) |
| --- | --- |
| Head, eyes, brows | Universal Base Characters: `Superhero_Male_FullBody` (head only) |
| Beard, long hair | Universal Base Characters: `Hair_Beard`, `Hair_Long` (rigged to head bone) |
| Tunic, pauldron, bracers, belts, boots | Modular Character Outfits – Fantasy: `Male_Ranger` (hood removed) |
| Cloak | Generated in the Blender script, crimson wool texture painted procedurally |
| Animations | Universal Animation Library: `UAL1_Standard.glb` (no root motion) |

## Rebuilding

1. Download the free tiers from quaternius.itch.io (`universal-base-characters`,
   `modular-character-outfits-fantasy`, `universal-animation-library`) and unzip them into one folder.
2. In a fresh Blender file run `scripts/blender/assemble-viking.py` (set `Q` and `OUT` at the top). It strips the
   superhero body down to the head, moves `Hair_Long` onto this head (it was rigged 5 cm lower), rebinds
   everything to the Ranger armature, tints the hair dark auburn, recolors the green cloth Valheim blue, adds the
   cloak, shrinks textures to 1024/512 and exports `viking_raw.glb`.
3. `node scripts/build-character.mjs viking_raw.glb UAL1_Standard.glb` converts textures to WebP and cuts the
   animation library to the clips `src/character.ts` plays, keeping translation only on the pelvis.

## In the game (`src/character.ts`)

- Locomotion by ground speed with hysteresis: `Walk_Loop` (natural 0.97 m/s), `Jog_Fwd_Loop` (5.36 m/s),
  `Sprint_Loop` (8.25 m/s), playback rate scaled to the real speed so feet don't slide. Natural speeds were
  measured from the library's root-motion file (`UAL1_Standard_RM.glb`).
- Jumps: `Jump_Start` from 0.35 s (skipping the crouch, our jump leaves at once), `Jump_Loop` in the air,
  `Jump_Land` on touchdown after more than 0.3 s airborne. `Idle_Torch_Loop` while the torch is lit.
- The model faces +Z; the root turns toward the direction of travel.
- Third person (default, **V** toggles): a spring arm over the right shoulder that shortens instead of dipping
  into terrain; mouse wheel sets its length. The torch moves to `hand_r` (`Torch.handOffset/handRotation`).
