using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    /// <summary>
    /// Generates simple procedural textures (plaster, half-timber, roof shingles, brick) as cached
    /// Texture2D assets and returns textured Standard materials for the village buildings, so walls and
    /// roofs read as real surfaces instead of flat colour. Planar world-UVs (from MeshB) let them tile.
    /// </summary>
    internal static class GroundingTextureFactory
    {
        private const string TexFolder = "Assets/Art/World/HighFidelity/Generated/Grounding/Textures";
        private static readonly Dictionary<string, Material> Cache = new();
        private static readonly Dictionary<string, Texture2D> TexCache = new();

        // ── Stylized-realism surface set ────────────────────────────────────────────────────────
        // Every hero surface now ships a derived TANGENT-SPACE NORMAL MAP (see NormalFor) so plaster,
        // tiles, stone and asphalt catch the daylight with real relief instead of reading as printed
        // colour on a flat plane. `bump` is the relief strength; 0 keeps a surface perfectly smooth.
        public static Material WallPlaster(Color tint) => Mat("Plaster", tint, 1.6f, .12f, () => Plaster(256), bump: 1.1f);
        public static Material WallTimber(Color tint) => Mat("Timber", tint, .5f, .1f, () => HalfTimber(256), bump: 1.4f);
        public static Material Roof(Color tint) => Mat($"Shingle_{Hex(tint)}", tint, .5f, .18f, () => Shingle(256), sharedTex: "Shingle", bump: 1.6f);
        public static Material Brick(Color tint) => Mat($"Brick_{Hex(tint)}", tint, .7f, .1f, () => Brick(128), sharedTex: "Brick", bump: 1.5f);
        public static Material Wood(Color tint) => Mat($"Plank_{Hex(tint)}", tint, .3f, .12f, () => Plank(256), sharedTex: "Plank", bump: 1.0f);
        /// <summary>Vertical-groove bark for tree trunks (planar-UV Standard material).</summary>
        public static Material Bark(Color tint) => Mat($"Bark_{Hex(tint)}", tint, 1.1f, .05f, () => BarkTex(256), sharedTex: "Bark", bump: 1.5f);
        /// <summary>Fine-grain compacted sand for the plaza path.</summary>
        public static Material Sand(Color tint) => Mat($"Sand_{Hex(tint)}", tint, 1.3f, .04f, () => SandTex(256), sharedTex: "Sand", bump: 0.7f);
        /// <summary>Banded, mottled rock for the background mountains (planar-UV Standard material).</summary>
        public static Material Stone(Color tint) => Mat($"Stone_{Hex(tint)}", tint, 0.9f, .05f, () => StoneTex(256), sharedTex: "Stone", bump: 1.2f);
        /// <summary>Rounded cobblestones with dark mortar grooves (seamless), for the plaza paths. Tuned so
        /// ~7 stones fill each ~4.5m tile. Planar-UV Standard material; tint sets the stone colour.</summary>
        public static Material CobblePath(Color tint) => Mat($"Cobble_{Hex(tint)}", tint, 0.22f, .12f, () => Cobble(256), sharedTex: "Cobble", bump: 1.8f);

        /// <summary>Modern asphalt: fine aggregate with a faint roller sheen. The main road surface.</summary>
        public static Material Asphalt(Color tint) => Mat($"Asphalt_{Hex(tint)}", tint, 0.30f, .17f, () => AsphaltTex(256), sharedTex: "Asphalt", bump: 0.9f);
        /// <summary>Large sawn paving slabs with tight joints — plaza aprons, pavements, kerb tops.</summary>
        public static Material Paving(Color tint) => Mat($"Paving_{Hex(tint)}", tint, 0.34f, .16f, () => PavingTex(256), sharedTex: "Paving", bump: 1.3f);
        /// <summary>Barrel clay roof tiles — deep rounded courses, the big upgrade over flat shingles.</summary>
        public static Material ClayRoof(Color tint) => Mat($"ClayTile_{Hex(tint)}", tint, 0.42f, .22f, () => ClayTileTex(256), sharedTex: "ClayTile", bump: 2.0f);
        /// <summary>Fine modern render/stucco — flatter and cleaner than village plaster, for new-build walls.</summary>
        public static Material Stucco(Color tint) => Mat($"Stucco_{Hex(tint)}", tint, 1.2f, .09f, () => StuccoTex(256), sharedTex: "Stucco", bump: 0.6f);
        /// <summary>Poured concrete with faint form lines — plinths, kerbs, fountain structure.</summary>
        public static Material Concrete(Color tint) => Mat($"Concrete_{Hex(tint)}", tint, 0.55f, .13f, () => ConcreteTex(256), sharedTex: "Concrete", bump: 0.6f);
        /// <summary>Honed masonry blocks — fountain basin, retaining walls, pavilion base.</summary>
        public static Material Masonry(Color tint) => Mat($"Masonry_{Hex(tint)}", tint, 0.55f, .20f, () => MasonryTex(256), sharedTex: "Masonry", bump: 1.4f);
        /// <summary>Rock for the mountains via the vendored TRIPLANAR shader — projects the stone texture onto
        /// steep faces instead of smearing it top-down, so the peaks read as chiselled rock, not flat shards.</summary>
        public static Material StoneTriplanar(Color tint) => Triplanar($"StoneTP_{Hex(tint)}", tint, () => StoneTex(256), "Stone", 0.16f, 0.1f, 0.22f);
        /// <summary>Dark timber via TRIPLANAR — planks project correctly onto the island's vertical cliff rim
        /// (the world-XZ shader smeared them). Used for the "wooden ramp".</summary>
        public static Material WoodTriplanar(Color tint) => Triplanar($"PlankTP_{Hex(tint)}", tint, () => Plank(256), "Plank", 0.42f, 0.05f, 0.06f);
        /// <summary>Streaky flowing-water sheet (glossy) for the fountain cascade/jet; scrolled by FlowScroll.</summary>
        public static Material WaterSheet(Color tint) => Mat($"WaterSheet_{Hex(tint)}", tint, 1f, .85f, () => WaterFlowTex(256), sharedTex: "WaterFlow");

        /// <summary>Grayscale grass-blade detail texture; the ground shader tints it green via _Color.</summary>
        public static Texture2D GrassTexture() => GetTex("Grass", () => Grass(256));
        /// <summary>Grayscale vertical plank grain; tint dark-brown for a timber embankment on the cliffs.</summary>
        public static Texture2D PlankTexture() => GetTex("Plank", () => Plank(256));
        /// <summary>
        /// Full-COLOUR painterly terrain (grass in several tones, dry ochre, bare dirt) baked at low frequency.
        /// The ground shader samples it by world-XZ so, tiled at a small scale, it reads as one continuous
        /// hand-painted field across the whole island — big lush/dry/earth regions with fine blade detail on
        /// top — instead of a single flat green. Use with _Color = white so the baked colour shows through.
        /// </summary>
        public static Texture2D GroundColorTexture() => GetTex("GroundColor", () => GroundColor(512));
        /// <summary>Grayscale dappled needle/leaf detail; the ground shader tints it green via _Color.</summary>
        public static Texture2D FoliageTexture() => GetTex("Foliage", () => Foliage(256));

        private static Material Mat(string key, Color tint, float tiling, float gloss, Func<Texture2D> build, string sharedTex = null, float bump = 0f)
        {
            var matName = $"MAT_YW_Tex_{key}";
            if (Cache.TryGetValue(matName, out var cached) && cached != null) return cached;

            var texKey = sharedTex ?? key;
            var tex = GetTex(texKey, build);
            var shader = Shader.Find("Standard");
            var path = $"{GroundingAssetWriter.MaterialFolder}/{matName}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) { mat = new Material(shader) { name = matName }; AssetDatabase.CreateAsset(mat, path); }
            if (mat.shader != shader) mat.shader = shader;
            mat.SetTexture("_MainTex", tex);
            mat.SetTextureScale("_MainTex", new Vector2(tiling, tiling));
            mat.color = tint;
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", gloss);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            ApplyRelief(mat, texKey, tex, tiling, bump);
            EditorUtility.SetDirty(mat);
            Cache[matName] = mat;
            return mat;
        }

        /// <summary>
        /// Attaches the derived tangent-space normal map so the surface picks up real relief under the
        /// daylight rig. The map is generated once per shared texture key and reused by every tint.
        /// Written with alpha = 1 so it decodes correctly on BOTH of Unity's normal unpack paths
        /// (plain RGB on GLES, and the RG-reconstruction path elsewhere) — a generated Texture2D asset
        /// never goes through the importer, so it can't be flagged as a "Normal map" texture type.
        /// </summary>
        private static void ApplyRelief(Material mat, string texKey, Texture2D albedo, float tiling, float bump)
        {
            if (!mat.HasProperty("_BumpMap")) return;
            if (bump <= 0f)
            {
                mat.SetTexture("_BumpMap", null);
                mat.DisableKeyword("_NORMALMAP");
                return;
            }
            var nrm = GetTex($"{texKey}_N", () => NormalFromHeight(albedo, 6f));
            mat.SetTexture("_BumpMap", nrm);
            mat.SetTextureScale("_BumpMap", new Vector2(tiling, tiling));
            if (mat.HasProperty("_BumpScale")) mat.SetFloat("_BumpScale", bump);
            mat.EnableKeyword("_NORMALMAP");
        }

        // Sobel height→normal over the albedo's luminance. Wraps at the edges so the normal map tiles
        // exactly like the albedo it was derived from.
        private static Texture2D NormalFromHeight(Texture2D src, float strength)
        {
            var n = src.width;
            var px = src.GetPixels();
            var h = new float[px.Length];
            for (var i = 0; i < px.Length; i++) h[i] = px[i].grayscale;
            float H(int x, int y) => h[(((y % n) + n) % n) * n + (((x % n) + n) % n)];

            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var dx = (H(x + 1, y - 1) + 2f * H(x + 1, y) + H(x + 1, y + 1)
                            - H(x - 1, y - 1) - 2f * H(x - 1, y) - H(x - 1, y + 1)) * 0.25f;
                    var dy = (H(x - 1, y + 1) + 2f * H(x, y + 1) + H(x + 1, y + 1)
                            - H(x - 1, y - 1) - 2f * H(x, y - 1) - H(x + 1, y - 1)) * 0.25f;
                    var v = new Vector3(-dx * strength, -dy * strength, 1f).normalized;
                    t.SetPixel(x, y, new Color(v.x * 0.5f + 0.5f, v.y * 0.5f + 0.5f, v.z * 0.5f + 0.5f, 1f));
                }
            return t;
        }

        // Material on the Yuvi/GrassBlades wind shader — textureless; the base→tip gradient and
        // per-clump tint variation are computed in-shader from baked vertex colours + world position.
        public static Material GrassBlades(string key, Color baseCol, Color tipCol)
        {
            var matName = $"MAT_YW_Tex_GrassBlades{key}";
            if (Cache.TryGetValue(matName, out var cached) && cached != null) return cached;
            var shader = Shader.Find("Yuvi/GrassBlades") ?? Shader.Find("Standard");
            var path = $"{GroundingAssetWriter.MaterialFolder}/{matName}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) { mat = new Material(shader) { name = matName }; AssetDatabase.CreateAsset(mat, path); }
            if (mat.shader != shader) mat.shader = shader;
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", baseCol);
            if (mat.HasProperty("_TipColor")) mat.SetColor("_TipColor", tipCol);
            EditorUtility.SetDirty(mat);
            Cache[matName] = mat;
            return mat;
        }

        // Builds a material on the vendored Yuvi/Triplanar shader (world-space triplanar projection + tint).
        private static Material Triplanar(string key, Color tint, Func<Texture2D> build, string sharedTex, float tiling, float gloss, float emission)
        {
            var matName = $"MAT_YW_Tex_{key}";
            if (Cache.TryGetValue(matName, out var cached) && cached != null) return cached;
            var tex = GetTex(sharedTex, build);
            var shader = Shader.Find("Yuvi/Triplanar") ?? Shader.Find("Standard");
            var path = $"{GroundingAssetWriter.MaterialFolder}/{matName}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) { mat = new Material(shader) { name = matName }; AssetDatabase.CreateAsset(mat, path); }
            if (mat.shader != shader) mat.shader = shader;
            mat.SetTexture("_MainTex", tex);
            mat.SetTextureScale("_MainTex", new Vector2(tiling, tiling));
            mat.color = tint;
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", tint);
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", gloss);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            if (mat.HasProperty("_Emission")) mat.SetFloat("_Emission", emission);
            EditorUtility.SetDirty(mat);
            Cache[matName] = mat;
            return mat;
        }

        private static Texture2D GetTex(string key, Func<Texture2D> build)
        {
            if (TexCache.TryGetValue(key, out var cached) && cached != null) return cached;
            GroundingAssetWriter.EnsureFolder(TexFolder);
            var path = $"{TexFolder}/TEX_YW_{key}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            var generated = build();
            generated.wrapMode = TextureWrapMode.Repeat;
            generated.filterMode = FilterMode.Bilinear;
            generated.Apply(true);
            if (existing == null) { AssetDatabase.CreateAsset(generated, path); TexCache[key] = generated; return generated; }
            EditorUtility.CopySerialized(generated, existing);
            EditorUtility.SetDirty(existing);
            UnityEngine.Object.DestroyImmediate(generated);
            TexCache[key] = existing;
            return existing;
        }

        // ---- pixel generators (return neutral-ish luminance; material.color tints) -----------

        private static Texture2D Plaster(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var v = 0.90f + 0.10f * Fbm(x * 0.06f, y * 0.06f);
                    v += 0.03f * Mathf.Sin(y * 0.20f + Fbm(x * 0.02f, y * 0.02f) * 4f); // faint trowel streaks
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        private static Texture2D HalfTimber(int n)
        {
            var t = New(n);
            var beam = new Color(0.36f, 0.26f, 0.17f);
            var plaster = new Color(0.93f, 0.89f, 0.80f);
            var b = Mathf.RoundToInt(n * 0.08f);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var edge = x < b || x >= n - b || y < b || y >= n - b;      // outer frame
                    var cross = Mathf.Abs(x - n / 2) < b / 2 || Mathf.Abs(y - n / 2) < b / 2; // cross beams
                    var isBeam = edge || cross;
                    var baseCol = isBeam ? beam : plaster;
                    var v = 1f + 0.06f * Fbm(x * 0.08f, y * 0.08f) - 0.03f;
                    t.SetPixel(x, y, baseCol * v);
                }
            return t;
        }

        private static Texture2D Shingle(int n)
        {
            var t = New(n);
            var rows = 6; var cols = 5;
            var rh = n / (float)rows; var cw = n / (float)cols;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var row = Mathf.FloorToInt(y / rh);
                    var offset = (row % 2) * cw * 0.5f;
                    var col = Mathf.FloorToInt((x + offset) / cw);
                    var inRow = (y - row * rh) / rh;            // 0 at eave side .. 1 at ridge side
                    var grout = inRow < 0.10f;                  // dark line between courses
                    var seam = Mathf.Abs(((x + offset) % cw) - 0f) < n * 0.008f;
                    var tileShade = 0.72f + 0.22f * inRow + 0.06f * Hash(row * 31 + col * 17);
                    var v = grout || seam ? 0.42f : tileShade;
                    t.SetPixel(x, y, Gray(v));
                }
            return t;
        }

        private static Texture2D Brick(int n)
        {
            var t = New(n);
            var rows = 8; var cols = 4;
            var rh = n / (float)rows; var cw = n / (float)cols;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var row = Mathf.FloorToInt(y / rh);
                    var offset = (row % 2) * cw * 0.5f;
                    var mortar = ((y % rh) < n * 0.02f) || (((x + offset) % cw) < n * 0.03f);
                    var v = mortar ? 0.62f : 0.86f + 0.1f * Hash(row * 13 + Mathf.FloorToInt((x + offset) / cw) * 7);
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        private static Texture2D Plank(int n)
        {
            var t = New(n);
            var planks = 5; var pw = n / (float)planks;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var plank = Mathf.FloorToInt(x / pw);
                    var gap = ((x % pw) < n * 0.012f);
                    var grain = 0.06f * Mathf.Sin(y * 0.35f + plank * 2.3f) + 0.05f * Fbm(x * 0.4f, y * 0.05f);
                    var v = gap ? 0.55f : Mathf.Clamp01(0.9f + grain + 0.05f * Hash(plank * 7));
                    t.SetPixel(x, y, Gray(v));
                }
            return t;
        }

        private static Texture2D Grass(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    // soft patchy variation + faint vertical blade streaks; grayscale (ground shader tints green)
                    var patch = 0.92f + 0.12f * Fbm(x * 0.03f, y * 0.03f);
                    var blades = 0.05f * Mathf.Sin(x * 0.9f + Fbm(x * 0.1f, y * 0.1f) * 6f) * Mathf.Sin(y * 0.5f);
                    var speck = Hash(x * 3 + y * 131) > 0.985f ? 0.12f : 0f;
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(patch + blades + speck)));
                }
            return t;
        }

        // Full-colour painterly ground. Big low-frequency masks pick between four ground tones; medium noise
        // mottles within a tone; fine streaks add blade/dirt grain. Sampled world-XZ at a small scale, one
        // 512² copy stretches across the whole island so the regions read as painted terrain, not tiles.
        private static Texture2D GroundColor(int n)
        {
            var t = New(n);
            // Softer, more natural stylized palette — the old one read as acid lime. Distinct painted regions
            // (lush / ordinary / dry / bare earth), but greens are calmer and a touch desaturated so vertex-AO
            // and the light wrap do the shaping. All noise is PERIODIC so the texture tiles with no seam.
            var lush = new Color(0.30f, 0.44f, 0.21f);   // deep healthy grass
            var mid  = new Color(0.41f, 0.51f, 0.26f);   // ordinary grass
            var dry  = new Color(0.60f, 0.58f, 0.34f);   // sun-dried grass
            var dirt = new Color(0.49f, 0.38f, 0.24f);   // bare earth
            var mud  = new Color(0.37f, 0.28f, 0.17f);   // darker trodden soil (patch cores)
            const float TAU = 6.2831853f;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var fx = x / (float)n; var fy = y / (float)n;
                    // Different base periods keep the two fields decorrelated while both stay seamless.
                    var region = PFbm(fx * 4f, fy * 4f, 4);
                    var earth  = PFbm(fx * 5f, fy * 5f, 5);
                    var col = Color.Lerp(mid, lush, Mathf.SmoothStep(-0.1f, 0.9f, region + 0.3f));
                    col = Color.Lerp(col, dry, Mathf.SmoothStep(0.08f, 0.55f, region));       // broad dry expanses
                    if (earth > 0.30f)                                                         // soil patches
                    {
                        var soil = Color.Lerp(dirt, mud, Mathf.SmoothStep(0.5f, 0.95f, earth)); // darker cores
                        col = Color.Lerp(col, soil, Mathf.SmoothStep(0.30f, 0.52f, earth));
                    }

                    // medium mottling + fine vertical blade grain + tiny highlight specks — all seamless.
                    var mott  = 0.14f * PFbm(fx * 12f, fy * 12f, 12);
                    var blade = 0.055f * Mathf.Sin(fx * TAU * 44f + PFbm(fx * 8f, fy * 8f, 8) * 6f) * Mathf.Sin(fy * TAU * 22f);
                    var shade = 1f + mott + blade;
                    t.SetPixel(x, y, new Color(
                        Mathf.Clamp01(col.r * shade), Mathf.Clamp01(col.g * shade), Mathf.Clamp01(col.b * shade), 1f));
                }
            return t;
        }

        private static Texture2D Foliage(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var clump = Fbm(x * 0.05f, y * 0.05f);   // broad leaf/needle masses
                    var fine = Fbm(x * 0.22f, y * 0.22f);    // fine detail
                    var v = 0.88f + 0.15f * clump + 0.06f * fine;
                    if (clump < -0.28f) v -= 0.15f;          // shadow pockets between clumps
                    var speck = Hash(x * 7 + y * 191) > 0.97f ? 0.10f : 0f; // highlight sparkles
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v + speck)));
                }
            return t;
        }

        private static Texture2D BarkTex(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var groove = 0.5f + 0.5f * Mathf.Sin(x * 0.55f + Fbm(x * 0.05f, y * 0.02f) * 3.2f); // vertical ridges
                    var v = 0.70f + 0.24f * groove + 0.05f * Fbm(x * 0.3f, y * 0.1f);
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        private static Texture2D SandTex(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var grain = 0.90f + 0.12f * Fbm(x * 0.15f, y * 0.15f);
                    var light = Hash(x * 13 + y * 57) > 0.90f ? 0.06f : 0f;  // pale grains
                    var dark = Hash(x * 57 + y * 13) > 0.95f ? -0.09f : 0f;  // grit specks
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(grain + light + dark)));
                }
            return t;
        }

        private static Texture2D StoneTex(int n)
        {
            var t = New(n);
            const float TAU = 6.2831853f;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var fx = x / (float)n; var fy = y / (float)n;
                    // Tilted rock strata (seamless) + broad mottling for form, then sharp dark CREVICES and
                    // bright highlight facets so the rock reads as chiselled stone instead of flat grey — this
                    // is what was missing from the mountains. All noise periodic → tiles on the peaks cleanly.
                    var strata = 0.5f + 0.5f * Mathf.Sin(fy * TAU * 5f + fx * TAU * 1f + PFbm(fx * 4f, fy * 4f, 4) * 3.2f);
                    var rough  = PFbm(fx * 8f, fy * 8f, 8);
                    var crev   = PFbm(fx * 10f, fy * 10f, 10);
                    var v = 0.60f + 0.20f * strata + 0.16f * rough;
                    if (crev < -0.35f) v -= 0.26f;                          // deep shaded cracks
                    if (rough > 0.42f) v += 0.14f;                          // sunlit facets
                    var speck = Hash(x * 41 + y * 17) > 0.93f ? -0.10f : 0f; // dark grit flecks
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v + speck)));
                }
            return t;
        }

        // Seamless cobblestones: a periodic Voronoi over P×P cells. Each pixel finds its two nearest jittered
        // sites; where they are ~equidistant (a cell boundary) we darken a mortar groove, and each stone domes
        // brighter toward its own centre with a little per-stone tone variation. All cell hashing wraps mod P,
        // so the texture tiles with no seam.
        private static Texture2D Cobble(int n)
        {
            var t = New(n);
            const int P = 7;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var px = x / (float)n * P; var py = y / (float)n * P;
                    int gx = Mathf.FloorToInt(px), gy = Mathf.FloorToInt(py);
                    float f1 = 9f, f2 = 9f; int cellX = 0, cellY = 0;
                    for (var dj = -1; dj <= 1; dj++)
                        for (var di = -1; di <= 1; di++)
                        {
                            int cx = gx + di, cy = gy + dj;
                            int wx = ((cx % P) + P) % P, wy = ((cy % P) + P) % P;
                            var jx = Frac(Mathf.Sin(wx * 127.1f + wy * 311.7f) * 43758.5453f);
                            var jy = Frac(Mathf.Sin(wx * 269.5f + wy * 183.3f) * 43758.5453f);
                            var sx = cx + 0.2f + 0.6f * jx;
                            var sy = cy + 0.2f + 0.6f * jy;
                            var dx = px - sx; var dy = py - sy;
                            var d = Mathf.Sqrt(dx * dx + dy * dy);
                            if (d < f1) { f2 = f1; f1 = d; cellX = wx; cellY = wy; }
                            else if (d < f2) f2 = d;
                        }
                    var mortar = Mathf.SmoothStep(0f, 0.14f, f2 - f1);       // 0 in groove → 1 on the stone
                    var tone = Frac(Mathf.Sin(cellX * 419.2f + cellY * 371.9f) * 43758.5453f);
                    var dome = Mathf.Clamp01(1f - f1 * 1.6f);                // highlight toward each stone's centre
                    var grain = 0.05f * PFbm(px * 2f, py * 2f, P * 2);
                    var v = Mathf.Lerp(0.60f, 0.82f, tone) + 0.10f * dome + grain;
                    v = Mathf.Lerp(v * 0.58f, v, mortar);                    // sink the mortar lines (kept mid-tone, not black)
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        private static float Frac(float f) => f - Mathf.Floor(f);

        private static Texture2D WaterFlowTex(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var u = x / (float)n;
                    // Smooth vertical rivulets (vary across u, gentle grain along the fall) — no horizontal
                    // banding, so scrolling reads as continuous flowing water instead of a grid.
                    var streak = 0.5f + 0.5f * Mathf.Sin(u * Mathf.PI * 2f * 7f + Fbm(x * 0.06f, 0f) * 2.5f);
                    var grain = 0.08f * Fbm(x * 0.4f, y * 0.02f);
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(0.68f + 0.30f * streak + grain)));
                }
            return t;
        }

        // ---- stylized-realism surfaces ---------------------------------------------------------

        // Modern asphalt: fine aggregate speckle over a low-frequency roller pattern, with a few darker
        // repair patches. Deliberately low contrast so the road reads as a surface, not as noise.
        private static Texture2D AsphaltTex(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var fx = x / (float)n; var fy = y / (float)n;
                    var roll = 0.055f * PFbm(fx * 3f, fy * 3f, 3);          // broad laying/roller bands
                    var patch = 0.05f * PFbm(fx * 7f, fy * 7f, 7);          // repair patches
                    var grit = 0.10f * PFbm(fx * 40f, fy * 40f, 40);        // aggregate
                    var chip = Hash(x * 29 + y * 71) > 0.955f ? 0.13f : 0f; // pale stone chips catching light
                    var pit = Hash(x * 71 + y * 29) > 0.975f ? -0.10f : 0f; // tiny pits
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(0.72f + roll + patch + grit + chip + pit)));
                }
            return t;
        }

        // Sawn paving slabs: a 4×4 grid of large stones with tight recessed joints, gentle per-slab tone
        // variation and a slight domed wear highlight — the pavement/plaza apron surface.
        private static Texture2D PavingTex(int n)
        {
            var t = New(n);
            const int cells = 4;
            var cw = n / (float)cells;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var cx = Mathf.FloorToInt(x / cw); var cy = Mathf.FloorToInt(y / cw);
                    var lx = (x - cx * cw) / cw; var ly = (y - cy * cw) / cw;   // 0..1 inside the slab
                    var joint = Mathf.Min(Mathf.Min(lx, 1f - lx), Mathf.Min(ly, 1f - ly));
                    var edge = Mathf.SmoothStep(0f, 0.055f, joint);             // 0 in the joint → 1 on the slab
                    var tone = Frac(Mathf.Sin(cx * 311.7f + cy * 127.1f) * 43758.5453f);
                    var wear = 1f - 0.22f * (Mathf.Pow(lx - 0.5f, 2f) + Mathf.Pow(ly - 0.5f, 2f)) * 4f; // domed
                    var grain = 0.05f * PFbm(x / (float)n * 16f, y / (float)n * 16f, 16);
                    var v = Mathf.Lerp(0.74f, 0.90f, tone) * wear + grain;
                    v = Mathf.Lerp(v * 0.60f, v, edge);                          // sink the joints
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        // Barrel clay roof tiles: overlapping half-round pantiles in staggered courses. The strong
        // cylindrical shading (plus its derived normal map) is what makes a roof stop reading as a
        // painted triangle and start reading as a real tiled slope.
        private static Texture2D ClayTileTex(int n)
        {
            var t = New(n);
            const int rows = 5, cols = 6;
            var rh = n / (float)rows; var cw = n / (float)cols;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var row = Mathf.FloorToInt(y / rh);
                    var offset = (row % 2) * cw * 0.5f;
                    var u = Frac((x + offset) / cw);                        // 0..1 across one barrel
                    var vRow = (y - row * rh) / rh;                         // 0 at the course lip .. 1 up-slope
                    // Half-round cross-section: bright on the crown, dark in the valley between barrels.
                    var barrel = Mathf.Sin(u * Mathf.PI);
                    var v = 0.55f + 0.38f * Mathf.Pow(barrel, 0.7f);
                    // Course lip: each row overlaps the one below, casting a hard shadow line.
                    if (vRow < 0.14f) v *= Mathf.Lerp(0.48f, 1f, vRow / 0.14f);
                    if (vRow > 0.90f) v *= 1.04f;                           // sunlit top edge of the tile
                    v += 0.05f * PFbm(x / (float)n * 18f, y / (float)n * 18f, 18);   // fired-clay mottle
                    v += 0.05f * (Frac(Mathf.Sin(row * 71.3f + Mathf.Floor((x + offset) / cw) * 37.1f) * 43758.5453f) - 0.5f);
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        // Fine modern render/stucco — a very quiet surface. Almost flat colour with a fine sand tooth so
        // it stays believable up close without adding visual noise to the skyline.
        private static Texture2D StuccoTex(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var fx = x / (float)n; var fy = y / (float)n;
                    var tooth = 0.045f * PFbm(fx * 30f, fy * 30f, 30);
                    var broad = 0.030f * PFbm(fx * 4f, fy * 4f, 4);
                    var speck = Hash(x * 17 + y * 43) > 0.98f ? 0.05f : 0f;
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(0.93f + tooth + broad + speck)));
                }
            return t;
        }

        // Poured concrete: broad pour mottling, faint horizontal form-board lines, sparse air pockets.
        private static Texture2D ConcreteTex(int n)
        {
            var t = New(n);
            const float TAU = 6.2831853f;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var fx = x / (float)n; var fy = y / (float)n;
                    var pour = 0.07f * PFbm(fx * 5f, fy * 5f, 5);
                    var form = 0.022f * Mathf.Sin(fy * TAU * 3f);
                    var fine = 0.035f * PFbm(fx * 24f, fy * 24f, 24);
                    var pocket = Hash(x * 53 + y * 97) > 0.988f ? -0.13f : 0f;
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(0.84f + pour + form + fine + pocket)));
                }
            return t;
        }

        // Honed masonry: coursed rectangular blocks with recessed joints and per-block tone — the fountain
        // basin, plaza retaining walls and pavilion base.
        private static Texture2D MasonryTex(int n)
        {
            var t = New(n);
            const int rows = 5, cols = 3;
            var rh = n / (float)rows; var cw = n / (float)cols;
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var row = Mathf.FloorToInt(y / rh);
                    var offset = (row % 2) * cw * 0.5f;
                    var col = Mathf.FloorToInt((x + offset) / cw);
                    var lx = Frac((x + offset) / cw);
                    var ly = (y - row * rh) / rh;
                    var joint = Mathf.Min(Mathf.Min(lx, 1f - lx) * (cw / rh), Mathf.Min(ly, 1f - ly));
                    var edge = Mathf.SmoothStep(0f, 0.07f, joint);
                    var tone = Frac(Mathf.Sin(col * 149.3f + row * 233.7f) * 43758.5453f);
                    var grain = 0.055f * PFbm(x / (float)n * 14f, y / (float)n * 14f, 14);
                    var v = Mathf.Lerp(0.74f, 0.92f, tone) + grain;
                    v = Mathf.Lerp(v * 0.55f, v, edge);
                    t.SetPixel(x, y, Gray(Mathf.Clamp01(v)));
                }
            return t;
        }

        /// <summary>
        /// Soft cloud puff (white with a feathered alpha) for the sky billboards. Replaces the faceted
        /// low-poly cloud blobs: a smooth radial falloff broken up by periodic fbm so the silhouette is
        /// wispy at the edges and dense at the core, with the underside slightly shaded.
        /// </summary>
        public static Texture2D CloudPuffTexture() => GetTex("CloudPuff", () => CloudPuff(256));

        private static Texture2D CloudPuff(int n)
        {
            var t = New(n);
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var fx = x / (float)n; var fy = y / (float)n;
                    // Elliptical core, wider than tall, sitting a little low in the tile.
                    var dx = (fx - 0.5f) / 0.46f;
                    var dy = (fy - 0.44f) / 0.34f;
                    var d = Mathf.Sqrt(dx * dx + dy * dy);
                    var lump = PFbm(fx * 5f, fy * 5f, 5) * 0.42f + PFbm(fx * 13f, fy * 13f, 13) * 0.18f;
                    var a = Mathf.SmoothStep(1.0f, 0.30f, d - lump);
                    a = Mathf.Clamp01(a);
                    a *= a;                                                  // feather the rim further
                    // Sunlit crown, softly shaded base — reads as volume, not a flat sticker.
                    var lit = Mathf.Lerp(0.80f, 1f, Mathf.SmoothStep(0.15f, 0.85f, fy) + lump * 0.25f);
                    t.SetPixel(x, y, new Color(lit, lit, Mathf.Min(1f, lit * 1.02f), a));
                }
            return t;
        }

        // ---- helpers ---------------------------------------------------------------------------

        private static Texture2D New(int n) => new(n, n, TextureFormat.RGBA32, true);
        private static Color Gray(float v) => new(v, v, v, 1f);
        private static string Hex(Color c) => ColorUtility.ToHtmlStringRGB(c);

        private static float Hash(float x)
        {
            var v = Mathf.Sin(x * 127.1f) * 43758.5453f;
            return v - Mathf.Floor(v);
        }

        private static float Noise(float x, float y)
        {
            float H(float a, float b) { var v = Mathf.Sin(a * 127.1f + b * 311.7f) * 43758.5453f; return v - Mathf.Floor(v); }
            var ix = Mathf.Floor(x); var iy = Mathf.Floor(y);
            var fx = x - ix; var fy = y - iy;
            var ux = fx * fx * (3 - 2 * fx); var uy = fy * fy * (3 - 2 * fy);
            var a = H(ix, iy); var b = H(ix + 1, iy); var c = H(ix, iy + 1); var d = H(ix + 1, iy + 1);
            return Mathf.Lerp(Mathf.Lerp(a, b, ux), Mathf.Lerp(c, d, ux), uy);
        }

        private static float Fbm(float x, float y)
        {
            var v = 0f; var amp = 0.5f; var f = 1f;
            for (var i = 0; i < 4; i++) { v += amp * (Noise(x * f, y * f) * 2f - 1f); f *= 2f; amp *= 0.5f; }
            return v;
        }

        // ---- SEAMLESS (tileable) noise ---------------------------------------------------------
        // The plain Noise/Fbm above do NOT wrap, so a texture built from them shows a hard seam where the
        // material's UVs repeat (the "split" across the grass). These periodic versions wrap the value-noise
        // lattice modulo `period`, so sampling fx,fy over [0,1]·period is identical at 0 and 1 → the whole
        // texture tiles with no seam. Higher octaves double both the coordinate and the period together, so
        // they stay periodic too. Decorrelate two fields by giving them different base periods, not offsets.
        private static float PNoise(float x, float y, int period)
        {
            float H(int a, int b)
            {
                var wa = ((a % period) + period) % period;
                var wb = ((b % period) + period) % period;
                var v = Mathf.Sin(wa * 127.1f + wb * 311.7f) * 43758.5453f;
                return v - Mathf.Floor(v);
            }
            var ix = Mathf.FloorToInt(x); var iy = Mathf.FloorToInt(y);
            var fx = x - ix; var fy = y - iy;
            var ux = fx * fx * (3f - 2f * fx); var uy = fy * fy * (3f - 2f * fy);
            var a = H(ix, iy); var b = H(ix + 1, iy); var c = H(ix, iy + 1); var d = H(ix + 1, iy + 1);
            return Mathf.Lerp(Mathf.Lerp(a, b, ux), Mathf.Lerp(c, d, ux), uy);
        }

        private static float PFbm(float x, float y, int period)
        {
            var v = 0f; var amp = 0.5f; var p = period;
            for (var i = 0; i < 4; i++) { v += amp * (PNoise(x, y, p) * 2f - 1f); x *= 2f; y *= 2f; p *= 2; amp *= 0.5f; }
            return v;
        }
    }
}
