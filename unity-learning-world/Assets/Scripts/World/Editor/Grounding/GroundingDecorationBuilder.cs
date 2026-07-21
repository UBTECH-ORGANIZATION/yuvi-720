using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    /// <summary>
    /// Sharp, semi-realistic dressing kit for the Yuvi learning world. The art direction is a
    /// clean, cool, faceted island — crisp low-poly forms, cool greens and slate stone, and neon
    /// cyan accents that echo the glossy grey/white Yuvi robot (chest ring, ear pods, antenna).
    /// Vegetation/rock use the half-Lambert ground shader (baked AO vertex colors); buildings and
    /// glow accents use hard-surface / emissive Standard materials for a crisper plastic sheen.
    /// Assets are self-contained roots (some carry their own cyan point light). Purely visual — no
    /// colliders — so walkability stays authored by the grounding traversal surfaces.
    /// </summary>
    internal static class GroundingDecorationBuilder
    {
        // ---- Palette -----------------------------------------------------------------------
        private static Material Veg(string name, int hex) =>
            GroundingAssetWriter.GetConnectorMaterial($"MAT_YW_Dressing_{name}", RGB(hex));
        private static Material Hard(string name, int hex, float gloss, float metal) =>
            GroundingAssetWriter.GetHardSurfaceMaterial($"MAT_YW_Dressing_{name}", RGB(hex), gloss, metal);
        private static Material Glow(string name, int hex, float intensity) =>
            GroundingAssetWriter.GetEmissiveMaterial($"MAT_YW_Dressing_{name}", RGB(hex), intensity);

        // Vegetation (cool, saturated, sharp facets)
        private static Material BarkCool => Veg("BarkCool", 0x584636);
        private static Material PineDeep => Veg("PineDeep", 0x2E4F37);
        private static Material PineMid => Veg("PineMid", 0x3C6A46);
        private static Material LeafDeep => Veg("LeafDeep", 0x3A5E33);
        private static Material LeafCool => Veg("LeafCool", 0x4F7A42);
        private static Material LeafLight => Veg("LeafLight", 0x6FA054);
        private static Material Rock => Veg("RockCool", 0x848C92);          // near the robot body grey (0x85878c)
        private static Material RockDark => Veg("RockDark", 0x5D656C);
        private static Material MountainCool => Veg("MountainCool", 0xA3B3C4); // hazy aerial blue-grey
        private static Material MountainDark => Veg("MountainDark", 0x8496AB);
        private static Material Snow => Veg("Snow", 0xEDF2F7);

        // Buildings — warm, realistic island village: cream walls, red/terracotta roofs, wood + stone.
        private static Material StoneWhite => Hard("StoneWhite", 0xEDE7DA, .26f, .03f);      // warm white stone
        private static Material StoneGrey => Hard("StoneGrey", 0xC0B5A3, .22f, .04f);        // warm grey stone
        private static Material WallCream => Hard("WallCream", 0xF1EADA, .16f, .0f);         // house walls
        private static Material RoofRed => Hard("RoofRed", 0xB2483A, .22f, .0f);             // classic red roof
        private static Material RoofTerracotta => Hard("RoofTerracotta", 0xC16A44, .22f, .0f);
        private static Material BrickRed => Hard("BrickRed", 0x9C4536, .18f, .0f);           // chimney
        private static Material DoorWood => Hard("DoorWood", 0x6E4A30, .2f, .0f);
        private static Material Timber => Hard("Timber", 0x7A6349, .2f, .0f);
        private static Material MetalTrim => Hard("MetalTrim", 0x8A7F6E, .4f, .45f);         // warm metal
        private static Material AwningRed => Hard("AwningRed", 0xB84B3D, .2f, .0f);
        private static Material AwningCream => Hard("AwningCream", 0xF0E7D2, .2f, .0f);
        private static Material Gold => Hard("Gold", 0xC9A24B, .5f, .55f);
        private static Material WaterPale => Hard("WaterPale", 0x8FCBD6, .5f, .0f);          // fountain spray (matches pool teal)

        // Warm cozy glow (lamps, lit windows) — replaces the cyan tech accents.
        private static Material WarmGlow => Glow("WarmGlow", 0xFFC271, 1.8f);
        private const int WarmGlowRGB = 0xFFB74D;

        // Animated water (Yuvi/Water shader): a calm, always-filled teal pool with gentle concentric
        // ripples — puddles OFF so the water never appears/disappears.
        private static Material FountainWater
        {
            get
            {
                var m = GroundingAssetWriter.GetWaterMaterial("MAT_YW_Dressing_FountainWater",
                    RGB(0x145663), RGB(0x2E8FA0), RGB(0xDDF0F2), 0.02f, 2.0f, 0.10f, 0.24f);
                if (m.HasProperty("_PuddleAmount")) m.SetFloat("_PuddleAmount", 0f);
                return m;
            }
        }

        // Flowing-water sheet for the fountain cascade + jet: a TRANSLUCENT teal tinted to the SAME
        // colour as the pool (FountainWater shallow tone) so the cascade/jet read as the same water,
        // not a pale cyan cone. Scrolled by FlowScroll.
        private static Material WaterSheet
        {
            get
            {
                var m = GroundingTextureFactory.WaterSheet(RGB(0x2E8FA0));
                m.SetFloat("_Mode", 3f);                       // Transparent
                m.SetOverrideTag("RenderType", "Transparent");
                m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                m.SetInt("_ZWrite", 0);
                m.DisableKeyword("_ALPHATEST_ON");
                m.EnableKeyword("_ALPHABLEND_ON");
                m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
                m.renderQueue = 3000;
                var c = m.color; c.a = 0.66f; m.color = c;
                return m;
            }
        }

        // ---- Vegetation --------------------------------------------------------------------

        // Textured vegetation: dappled foliage rides the ground shader (keeps AO + half-Lambert) and
        // trunks use vertical-groove bark (planar-UV Standard), so trees read as real surfaces.
        private static Material FoliageMat(string name, int hex)
        {
            var m = GroundingAssetWriter.GetConnectorMaterial($"MAT_YW_Dressing_Foliage_{name}", RGB(hex));
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", GroundingTextureFactory.FoliageTexture());
            if (m.HasProperty("_MainTexScale")) m.SetFloat("_MainTexScale", 0.7f);
            return m;
        }
        private static Material PineDeepTex => FoliageMat("PineDeep", 0x2E4F37);
        private static Material PineMidTex => FoliageMat("PineMid", 0x3C6A46);
        private static Material LeafDeepTex => FoliageMat("LeafDeep", 0x3A5E33);
        private static Material LeafCoolTex => FoliageMat("LeafCool", 0x4F7A42);
        private static Material LeafLightTex => FoliageMat("LeafLight", 0x6FA054);
        private static Material BarkTexMat => GroundingTextureFactory.Bark(RGB(0x5B4A38));

        // Sharp conifer — the primary silhouette. Stacked faceted cones, textured needles.
        public static Transform CreateConifer(string name, float scale, int seed)
        {
            var root = new GameObject(name).transform;
            var trunk = new MeshB();
            trunk.Cylinder(Vector3.zero, 0.13f * scale, 0.09f * scale, 0.6f * scale, 6, 0.4f, 0.85f);
            Add(root, "Trunk", trunk, BarkTexMat);

            var canopy = new MeshB();
            // three overlapping 6-sided cones, tightening toward a crisp tip
            canopy.Cone(new Vector3(0, 0.42f * scale, 0), 1.02f * scale, 1.35f * scale, 6, 0.55f, 0.98f);
            canopy.Cone(new Vector3(0, 1.12f * scale, 0), 0.80f * scale, 1.25f * scale, 6, 0.6f, 0.98f);
            canopy.Cone(new Vector3(0, 1.85f * scale, 0), 0.52f * scale, 1.15f * scale, 6, 0.62f, 1f);
            Add(root, "Canopy", canopy, (seed % 3 == 0) ? PineMidTex : PineDeepTex, flat: true);
            return root;
        }

        // Faceted broadleaf — secondary silhouette. Crisp low-poly canopy, textured leaves.
        public static Transform CreateTree(string name, float scale, int seed)
        {
            var root = new GameObject(name).transform;
            var h = 2.1f * scale;
            var trunk = new MeshB();
            trunk.Cylinder(Vector3.zero, 0.17f * scale, 0.12f * scale, h * 0.5f, 6, 0.4f, 0.88f);
            // a couple of angular boughs where the canopy meets the trunk
            Add(root, "Trunk", trunk, BarkTexMat);

            var canopy = new MeshB();
            var cr = 0.95f * scale;
            canopy.Facet(new Vector3(0f, h * 0.72f, 0f), cr, seed, 0.18f, 6, 4, 0.5f);
            canopy.Facet(new Vector3(cr * 0.55f, h * 0.6f, cr * 0.15f), cr * 0.62f, seed + 3, 0.2f, 5, 3, 0.45f);
            canopy.Facet(new Vector3(-cr * 0.5f, h * 0.64f, -cr * 0.2f), cr * 0.6f, seed + 7, 0.2f, 5, 3, 0.45f);
            Add(root, "Canopy", canopy, (seed % 2 == 0) ? LeafCoolTex : LeafLightTex, flat: true);
            var under = new MeshB();
            under.Facet(new Vector3(0f, h * 0.58f, 0f), cr * 0.6f, seed + 11, 0.16f, 5, 3, 0.32f);
            Add(root, "CanopyUnder", under, LeafDeepTex, flat: true);
            return root;
        }

        public static Transform CreateBush(string name, float scale, int seed)
        {
            var root = new GameObject(name).transform;
            var m = new MeshB();
            var r = 0.55f * scale;
            m.Facet(new Vector3(0f, r * 0.65f, 0f), r, seed, 0.2f, 6, 3, 0.4f);
            m.Facet(new Vector3(r * 0.7f, r * 0.5f, 0f), r * 0.72f, seed + 2, 0.22f, 5, 3, 0.4f);
            m.Facet(new Vector3(-r * 0.6f, r * 0.48f, r * 0.3f), r * 0.68f, seed + 5, 0.22f, 5, 3, 0.4f);
            Add(root, "Bush", m, (seed % 2 == 0) ? LeafCool : LeafDeep, flat: true);
            return root;
        }

        public static Transform CreateRock(string name, float scale, int seed)
        {
            var root = new GameObject(name).transform;
            var m = new MeshB();
            m.FacetRock(Vector3.zero, 0.7f * scale, seed);
            Add(root, "Rock", m, (seed % 3 == 0) ? RockDark : Rock, flat: true);
            return root;
        }

        public static Transform CreateGrassTuft(string name, float scale, int seed)
        {
            var root = new GameObject(name).transform;
            var m = new MeshB();
            var blades = 8;
            for (var i = 0; i < blades; i++)
            {
                var ang = (i / (float)blades) * Mathf.PI * 2f + Hash(seed + i) * 0.7f;
                var spread = (0.12f + 0.09f * Hash(seed + i * 5)) * scale;
                var dir = new Vector3(Mathf.Cos(ang), 0f, Mathf.Sin(ang)) * spread;
                var tip = dir * 1.5f + Vector3.up * (0.5f + 0.26f * Hash(seed + i * 2)) * scale;
                m.Blade(dir, tip, 0.05f * scale);
            }
            Add(root, "Grass", m, (seed % 2 == 0) ? LeafLight : LeafCool, flat: true);
            return root;
        }

        public static Transform CreateFlowerCluster(string name, int seed)
        {
            var root = new GameObject(name).transform;
            var stems = new MeshB();
            var heads = new MeshB();
            var count = 5;
            var mat = FlowerMat(seed);
            for (var i = 0; i < count; i++)
            {
                var off = new Vector3(Hash(seed + i) * 0.32f, 0f, Hash(seed + i * 3) * 0.32f);
                var top = off + Vector3.up * (0.4f + 0.13f * Hash(seed + i));
                stems.Cylinder(off, 0.022f, 0.022f, top.y, 4, 0.6f, 0.9f);
                heads.Facet(top, 0.11f, seed + i, 0.1f, 5, 3, 0.7f);
            }
            Add(root, "Stems", stems, LeafDeep);
            Add(root, "Heads", heads, mat, flat: true);
            return root;
        }

        // ---- Background mountains ----------------------------------------------------------

        // Large faceted peak in cool aerial blue-grey with a snow cap; reads as distant depth.
        public static Transform CreateMountain(string name, float scale, int seed)
        {
            var root = new GameObject(name).transform;
            var body = new MeshB();
            // Sized for the ZOOMED isometric follow-camera, which frames roughly 22 world units of height.
            // These are a coastal backdrop ridge, not alps: the old 10.5×4.8 peaks with a 3.4r apron measured
            // ~25 units across and buried the village in grey rock the moment they were placed on the shore.
            // Squatter than a spire (h/r ~1.8): steep narrow cones read as flat paper shards at this zoom.
            var h = 6.5f * scale;
            var r = 3.6f * scale;
            // Stone shelf at the foot — the "stone ground" under each peak that hides the strip of sea between
            // the range and the shore. This MUST be a Cylinder, not a Cone: a Cone tapers to a point, so its
            // height fell below the -1.5 waterline well before its rim and neighbouring aprons drowned exactly
            // where they were meant to merge — which is why open water kept showing through no matter how close
            // the peaks were moved. A flat top (rTop 1.5r vs spacing ~4) overlaps into one continuous shelf,
            // and 2.3 height puts that top at plaza level so it meets the grass instead of plateauing over it.
            // doubleSided is REQUIRED, not defensive: MeshB's caps are wound so the up-facing top is culled
            // from above (the same quirk that made a bare Box invisible from overhead). Without it the shelf is
            // geometrically present but see-through from the play camera, so the sea reads straight through it
            // and the range looks detached from the coast no matter how close the peaks are moved.
            body.Cylinder(Vector3.zero, r * 1.8f, r * 1.5f, 1.9f, 14, 0.7f, 0.92f, doubleSided: true);
            // More sides + gentler jitter than before → rounded, layered rock instead of sharp paper shards.
            body.RidgeCone(Vector3.zero, r, h, 13, seed, 0.20f);
            // Two shoulder peaks (both sides) for a natural, layered range silhouette rather than a lone cone.
            body.RidgeCone(new Vector3(r * 0.72f, 0f, -r * 0.22f), r * 0.62f, h * 0.66f, 11, seed + 4, 0.18f);
            body.RidgeCone(new Vector3(-r * 0.66f, 0f, r * 0.18f), r * 0.5f, h * 0.5f, 10, seed + 9, 0.16f);
            // Cool blue-grey rock through the vendored TRIPLANAR shader, so the chiselled stone texture projects
            // onto the steep faces (it used to smear top-down and read flat). Faint emission built into the
            // shader keeps back-lit slopes from crushing to black.
            var rockCol = (seed % 2 == 0) ? RGB(0xB4C2D4) : RGB(0xA6B6CB);
            Add(root, "Rock", body, GroundingTextureFactory.StoneTriplanar(rockCol), flat: true);

            // Snow caps on EVERY peak (the shoulders used to have none, so only one tip in three read white).
            // Each cap starts halfway up its own cone and flares wider than that cone's radius at the same
            // height — otherwise it sits buried inside the rock and no white shows.
            var cap = new MeshB();
            cap.RidgeCone(new Vector3(0f, h * 0.5f, 0f), r * 0.58f, h * 0.52f, 9, seed, 0.24f);
            cap.RidgeCone(new Vector3(r * 0.72f, h * 0.33f, -r * 0.22f), r * 0.36f, h * 0.35f, 8, seed + 4, 0.22f);
            cap.RidgeCone(new Vector3(-r * 0.66f, h * 0.25f, r * 0.18f), r * 0.29f, h * 0.27f, 7, seed + 9, 0.22f);
            Add(root, "Snow", cap, Snow, flat: true);
            return root;
        }

        // ---- Plaza sand path ---------------------------------------------------------------

        // Cobblestone paths with a raised light-stone kerb frame on both edges (see the reference: cobbles
        // inside, stone border tiles along the sides). Cool blue-grey to sit with the world's slate/robot palette.
        private static Material CobblePathMat => GroundingTextureFactory.CobblePath(new Color(0.68f, 0.73f, 0.78f));
        private static Material KerbStoneMat => GroundingTextureFactory.Stone(new Color(0.82f, 0.83f, 0.86f));

        public static Transform CreatePathRing(string name, float innerR, float outerR, int sides)
        {
            var root = new GameObject(name).transform;
            var surf = new MeshB();
            surf.Ring(new Vector3(0f, 0.02f, 0f), innerR, outerR, sides, 0.92f);
            Add(root, "Path", surf, CobblePathMat, flat: true);
            // Flat stone frame band flush with the surface, just outside the outer edge and inside the inner edge.
            var kerb = new MeshB();
            const float kw = 0.34f;
            KerbRingEdge(kerb, outerR, outerR + kw, 0.02f, sides);
            KerbRingEdge(kerb, innerR - kw, innerR, 0.02f, sides);
            Add(root, "Kerb", kerb, KerbStoneMat, flat: true);
            return root;
        }

        // A winding centreline from → to: a gentle S laid across the straight run, tapered to zero at both
        // ends so each path still meets its house and the plaza ring cleanly.
        public static List<Vector3> WindingCenter(Vector3 from, Vector3 to, float amp, float waves, int steps)
        {
            var pts = new List<Vector3>();
            var a = new Vector3(from.x, 0f, from.z);
            var b = new Vector3(to.x, 0f, to.z);
            var dir = b - a; dir.y = 0f;
            var length = dir.magnitude;
            dir = dir.normalized;
            var perp = new Vector3(-dir.z, 0f, dir.x);
            // Cap the sideways swing to a fraction of the run — otherwise a SHORT spur wiggles more than its
            // own length and the ribbon folds on itself (the pinched/broken path). Short spurs stay near-straight.
            amp = Mathf.Min(amp, length * 0.2f);
            for (var i = 0; i <= steps; i++)
            {
                var t = i / (float)steps;
                var basep = Vector3.Lerp(a, b, t);
                var taper = Mathf.Sin(t * Mathf.PI);                 // 0 at both ends
                var off = amp * taper * Mathf.Sin(t * Mathf.PI * waves);
                pts.Add(basep + perp * off);
            }
            return pts;
        }

        // Builds a cobblestone ribbon following a centreline, with a raised stone kerb along each edge.
        // Per-vertex perpendiculars (central difference) keep the ribbon continuous around the curves.
        public static Transform CreatePathRibbon(string name, List<Vector3> center, float halfW, bool kerb)
        {
            var root = new GameObject(name).transform;
            var surf = new MeshB();
            var rail = new MeshB();
            const float kw = 0.32f;                 // frame width; laid FLAT, level with the path surface
            var n = center.Count;
            var perp = new Vector3[n];
            for (var i = 0; i < n; i++)
            {
                var prev = center[Mathf.Max(0, i - 1)];
                var next = center[Mathf.Min(n - 1, i + 1)];
                var tan = next - prev; tan.y = 0f; tan = tan.normalized;
                perp[i] = new Vector3(-tan.z, 0f, tan.x);
            }
            for (var i = 0; i < n - 1; i++)
            {
                var l0 = center[i] - perp[i] * halfW; var r0 = center[i] + perp[i] * halfW;
                var l1 = center[i + 1] - perp[i + 1] * halfW; var r1 = center[i + 1] + perp[i + 1] * halfW;
                surf.Quad(l0, r0, r1, l1, 0.92f, 0.92f, 0.92f, 0.92f);
                surf.Quad(l1, r1, r0, l0, 0.92f, 0.92f, 0.92f, 0.92f);
                if (kerb)
                {
                    AddKerbRail(rail, l0, l1, -perp[i], -perp[i + 1], kw);
                    AddKerbRail(rail, r0, r1, perp[i], perp[i + 1], kw);
                }
            }
            Add(root, "Surface", surf, CobblePathMat, flat: true);
            if (kerb) Add(root, "Kerb", rail, KerbStoneMat, flat: true);
            return root;
        }

        // A FLAT frame strip running along a path edge e0→e1, w wide outward, coplanar with the path surface
        // (a stone border laid flush, not a raised kerb). Double-sided.
        private static void AddKerbRail(MeshB m, Vector3 e0, Vector3 e1, Vector3 out0, Vector3 out1, float w)
        {
            Vector3 i0 = e0, i1 = e1, o0 = e0 + out0 * w, o1 = e1 + out1 * w;
            m.Quad(i0, o0, o1, i1, 1f, 1f, 1f, 1f);
            m.Quad(i1, o1, o0, i0, 1f, 1f, 1f, 1f);
        }

        // A FLAT stone frame band between two radii, coplanar with the plaza ring surface.
        private static void KerbRingEdge(MeshB m, float rIn, float rOut, float y, int sides)
        {
            for (var i = 0; i < sides; i++)
            {
                var a0 = i / (float)sides * Mathf.PI * 2f;
                var a1 = (i + 1) / (float)sides * Mathf.PI * 2f;
                Vector3 Pt(float r, float a) => new Vector3(Mathf.Cos(a) * r, y, Mathf.Sin(a) * r);
                Vector3 iA = Pt(rIn, a0), iB = Pt(rIn, a1), oA = Pt(rOut, a0), oB = Pt(rOut, a1);
                m.Quad(iA, oA, oB, iB, 1f, 1f, 1f, 1f);
                m.Quad(iB, oB, oA, iA, 1f, 1f, 1f, 1f);
            }
        }

        // ---- River creature ("Nessie") ----------------------------------------------------
        // A friendly plesiosaur: an arcing neck of stacked blobs up to a head with cyan glow eyes, plus a
        // couple of low back humps that break the surface. Built with its surfaced base at local y≈0 so the
        // RiverSerpent runtime component can sink it below the water and raise it on a cycle.
        public static Transform CreateRiverSerpent(string name)
        {
            var root = new GameObject(name).transform;
            var body = new MeshB();
            const int segs = 6;
            for (var i = 0; i <= segs; i++)
            {
                var t = i / (float)segs;
                var y = t * 2.15f;
                var z = 0.6f * Mathf.Sin(t * 1.5f);              // neck arcs up and forward
                var rad = Mathf.Lerp(0.46f, 0.28f, t);
                body.Facet(new Vector3(0f, y, z), rad, 100 + i, 0.12f, 6, 4, 0.7f);
            }
            var headC = new Vector3(0f, 2.32f, 0.72f);
            body.Facet(headC, 0.52f, 77, 0.1f, 6, 4, 0.75f);                                // head
            body.Facet(headC + new Vector3(0f, -0.05f, 0.42f), 0.3f, 78, 0.1f, 5, 3, 0.75f); // snout
            body.Facet(new Vector3(0f, 0.08f, -0.9f), 0.5f, 60, 0.1f, 6, 3, 0.6f);           // hump 1
            body.Facet(new Vector3(0f, 0.02f, -1.7f), 0.4f, 61, 0.1f, 6, 3, 0.6f);           // hump 2
            Add(root, "Body", body, Hard("SerpentBody", 0x3F8048, 0.4f, 0f), flat: true);

            var eyes = new MeshB(); var pupils = new MeshB();
            for (var s = -1; s <= 1; s += 2)
            {
                eyes.Facet(headC + new Vector3(0.3f * s, 0.16f, 0.28f), 0.13f, 80 + s, 0.05f, 5, 3, 0.8f);
                pupils.Facet(headC + new Vector3(0.32f * s, 0.16f, 0.37f), 0.06f, 82 + s, 0.05f, 4, 3, 0.8f);
            }
            Add(root, "Eyes", eyes, Glow("SerpentEye", 0x36E0E0, 1.5f), flat: true);
            Add(root, "Pupils", pupils, Hard("SerpentPupil", 0x11201F, 0.1f, 0f), flat: true);
            return root;
        }

        // ---- Fountain centerpiece (inside the plaza) --------------------------------------

        public static Transform CreateFountain(string name)
        {
            var root = new GameObject(name).transform;
            var sides = 18;

            // Solid, double-sided drums so the basin reads as a real tiered fountain from any angle;
            // matte teal pools sit inset below each rim, and only the jet uses the cyan glow.
            var stone = new MeshB();
            stone.Cylinder(Vector3.zero, 2.55f, 2.5f, 0.3f, sides, 0.5f, 0.82f, true);            // plinth
            stone.Cylinder(new Vector3(0, 0.3f, 0), 2.4f, 2.4f, 1.0f, sides, 0.5f, 0.9f, true);   // bowl wall
            stone.Disc(new Vector3(0, 0.35f, 0), 2.38f, sides, 0.45f);                            // bowl floor
            stone.Cylinder(new Vector3(0, 1.3f, 0), 0.6f, 0.55f, 1.0f, sides, 0.55f, 0.95f, true);// pedestal
            stone.Cylinder(new Vector3(0, 2.3f, 0), 1.05f, 1.05f, 0.28f, sides, 0.6f, 0.95f, true);// upper bowl wall
            stone.Disc(new Vector3(0, 2.32f, 0), 1.03f, sides, 0.6f);                             // upper floor
            Add(root, "Stone", stone, StoneGrey);

            var rim = new MeshB();
            rim.Cylinder(new Vector3(0, 1.28f, 0), 2.48f, 2.48f, 0.12f, sides, 0.85f, 1f, true);  // lower coping
            rim.Cylinder(new Vector3(0, 2.55f, 0), 1.12f, 1.12f, 0.1f, sides, 0.85f, 1f, true);   // upper coping
            Add(root, "Rim", rim, StoneWhite);

            // Pools sit just above the copings (the stone drums are capped) so the water reads as a
            // filled, brimming pool with a stone rim around it. Animated by the Yuvi/Water shader.
            var water = new MeshB();
            water.Disc(new Vector3(0, 1.42f, 0), 2.2f, sides);   // lower pool
            water.Disc(new Vector3(0, 2.68f, 0), 0.92f, sides);  // upper pool
            Add(root, "Water", water, FountainWater);

            // Falling-water curtain sheeting from the upper bowl down into the lower pool — the texture
            // scrolls DOWNWARD (FlowScroll) so it reads as real cascading water.
            var cascade = new MeshB();
            cascade.Cylinder(new Vector3(0, 1.48f, 0), 2.02f, 1.14f, 1.12f, sides, 0.75f, 1f, true); // wide bottom → narrow top
            var cascadeT = Add(root, "Cascade", cascade, WaterSheet);
            if (cascadeT != null)
            {
                var fs = cascadeT.gameObject.AddComponent<Yuvi720.LearningWorld.World.FlowScroll>();
                fs.speed = 0.5f; fs.tiling = new Vector2(7f, 2.4f); // downward flow
            }

            // Central jet: a rising water column from the spout (texture scrolls UP) + a droplet cap.
            var jet = new MeshB();
            jet.Cylinder(new Vector3(0, 2.68f, 0), 0.16f, 0.09f, 1.05f, 8, 0.8f, 1f, true);
            var jetT = Add(root, "Spout", jet, WaterSheet);
            if (jetT != null)
            {
                var fs = jetT.gameObject.AddComponent<Yuvi720.LearningWorld.World.FlowScroll>();
                fs.speed = -0.9f; fs.tiling = new Vector2(3f, 3f); // upward jet
            }
            var drop = new MeshB();
            drop.Facet(new Vector3(0, 3.78f, 0), 0.17f, 3, 0.1f, 6, 4, 0.7f);
            Add(root, "SpoutTop", drop, WaterPale, flat: true);
            return root;
        }

        // ---- Village houses — four distinct textured designs (double-sided walls/roofs) -----

        private static Material WindowFrame => Hard("WindowFrame", 0xF5F0E6, .2f, 0f);
        private static Material Shutter(int seed) =>
            Hard($"Shutter{Mathf.Abs(seed) % 3}", (seed % 3 == 0) ? 0x5E7E86 : (seed % 3 == 1) ? 0x6E8B5A : 0x9C4536, .2f, 0f);

        // Distinct-but-believable village colours so every house reads differently (liveliness, not neon).
        private static readonly int[] WallPalette = { 0xF1EADA, 0xE7E0D0, 0xF3E7C6, 0xE4EADF, 0xEADBC6, 0xDCE6EC, 0xF1DBD2, 0xE9E2D2 };
        // cream / warm-grey / pale-yellow / sage / sand / soft blue-grey / blush / stone
        private static readonly int[] RoofPalette = { 0xB2483A, 0xC2643E, 0x9C5040, 0x6E7E86, 0x8A6D4B, 0xA8474F, 0xC77F3E };
        // red / terracotta / brown-red / muted slate / ochre / rose-red / amber

        public static Transform CreateHouse(string name, float scale, int seed, int style)
        {
            var root = new GameObject(name).transform;
            var wallCol = RGB(WallPalette[Mathf.Abs(seed) % WallPalette.Length]);
            var wall = (seed % 3 == 1) ? GroundingTextureFactory.WallTimber(wallCol) : GroundingTextureFactory.WallPlaster(wallCol);
            var roof = GroundingTextureFactory.Roof(RGB(RoofPalette[Mathf.Abs(seed * 3 + 1) % RoofPalette.Length]));
            var brick = GroundingTextureFactory.Brick(RGB(0x9C4536));
            switch (style)
            {
                case 1: BuildTownhouse(root, scale, seed, wall, roof); break;
                case 2: BuildFarmhouse(root, scale, seed, wall, roof, brick); break;
                case 3: BuildRoundHut(root, scale, seed, wall, roof); break;
                default: BuildCottage(root, scale, seed, wall, roof, brick); break;
            }
            return root;
        }

        // Style 0 — wide cottage with a gable roof, brick chimney, shuttered windows.
        private static void BuildCottage(Transform root, float s, int seed, Material wall, Material roof, Material brick)
        {
            var w = 3.0f * s; var d = 2.6f * s; var h = 2.2f * s; var rH = 1.15f * s;
            var walls = new MeshB(); walls.Box(new Vector3(0, h * 0.5f, 0), new Vector3(w, h, d), 0.95f, 0.72f, 0.74f, 0.4f, true);
            Add(root, "Walls", walls, wall);
            var rm = new MeshB(); rm.Gable(new Vector3(0, h, 0), w + 0.5f * s, d + 0.5f * s, rH, 0.6f, 0.98f, true);
            Add(root, "Roof", rm, roof, flat: true);
            var chim = new MeshB(); chim.Box(new Vector3(w * 0.28f, h + rH * 0.9f, -d * 0.18f), new Vector3(0.42f * s, 0.95f * s, 0.42f * s), 0.9f, 0.7f, 0.7f, 0.4f, true);
            Add(root, "Chimney", chim, brick);
            AddSmoke(root, new Vector3(w * 0.28f, h + rH * 0.9f + 0.55f * s, -d * 0.18f), s);
            BuildOpenings(root, s, seed, d * 0.5f, new[] { (-w * 0.3f, h * 0.6f), (w * 0.3f, h * 0.6f) }, 0f, true);
        }

        // Style 1 — tall two-storey townhouse: hip roof, string-course, 4 windows.
        private static void BuildTownhouse(Transform root, float s, int seed, Material wall, Material roof)
        {
            var w = 2.5f * s; var d = 2.3f * s; var h = 3.5f * s;
            var walls = new MeshB();
            walls.Box(new Vector3(0, h * 0.5f, 0), new Vector3(w, h, d), 0.95f, 0.72f, 0.74f, 0.4f, true);
            Add(root, "Walls", walls, wall);
            var band = new MeshB();
            band.Box(new Vector3(0, h * 0.5f, 0), new Vector3(w + 0.08f, 0.16f * s, d + 0.08f), 0.9f, 0.72f, 0.72f, 0.5f, true);
            band.Box(new Vector3(0, 0.05f * s, 0), new Vector3(w + 0.14f, 0.24f * s, d + 0.14f), 0.9f, 0.7f, 0.7f, 0.5f, true); // plinth
            Add(root, "Trim-Stone", band, StoneWhite);
            var rm = new MeshB(); rm.Hip(new Vector3(0, h, 0), w + 0.5f * s, d + 0.5f * s, 1.3f * s, 0.5f, 0.96f, true);
            Add(root, "Roof", rm, roof, flat: true);
            BuildOpenings(root, s, seed, d * 0.5f,
                new[] { (-w * 0.28f, h * 0.72f), (w * 0.28f, h * 0.72f), (-w * 0.28f, h * 0.4f), (w * 0.28f, h * 0.4f) }, 0f, true);
        }

        // Style 2 — long farmhouse with a covered front porch (reads as one clean building).
        private static void BuildFarmhouse(Transform root, float s, int seed, Material wall, Material roof, Material brick)
        {
            var w = 3.7f * s; var d = 2.5f * s; var h = 2.2f * s;
            var walls = new MeshB(); walls.Box(new Vector3(0, h * 0.5f, 0), new Vector3(w, h, d), 0.95f, 0.72f, 0.74f, 0.4f, true);
            Add(root, "Walls", walls, wall);
            var rm = new MeshB(); rm.Gable(new Vector3(0, h, 0), w + 0.5f * s, d + 0.5f * s, 1.15f * s, 0.6f, 0.98f, true);
            Add(root, "Roof", rm, roof, flat: true);
            var chim = new MeshB(); chim.Box(new Vector3(-w * 0.34f, h + 0.9f * s, 0), new Vector3(0.42f * s, 1.0f * s, 0.42f * s), 0.9f, 0.7f, 0.7f, 0.4f, true);
            Add(root, "Chimney", chim, brick);
            AddSmoke(root, new Vector3(-w * 0.34f, h + 0.9f * s + 0.58f * s, 0), s);

            // Covered veranda across the front: posts + a shingled lean roof.
            var porchZ = d * 0.5f + 0.9f * s; var porchY = 1.95f * s;
            var posts = new MeshB();
            for (var i = -1; i <= 1; i++)
                posts.Box(new Vector3(i * w * 0.34f, porchY * 0.5f, porchZ), new Vector3(0.14f * s, porchY, 0.14f * s), 0.85f, 0.65f, 0.65f, 0.4f, true);
            Add(root, "PorchPosts", posts, DoorWood);
            var porchRoof = new MeshB();
            porchRoof.Box(new Vector3(0, porchY + 0.06f * s, d * 0.5f + 0.45f * s), new Vector3(w + 0.3f * s, 0.12f * s, 1.05f * s), 0.9f, 0.7f, 0.7f, 0.5f, true);
            Add(root, "PorchRoof", porchRoof, roof);

            BuildOpenings(root, s, seed, d * 0.5f, new[] { (-w * 0.3f, h * 0.58f), (w * 0.3f, h * 0.58f) }, 0f, false);
        }

        // Style 3 — small round hut with a conical roof.
        private static void BuildRoundHut(Transform root, float s, int seed, Material wall, Material roof)
        {
            var r = 1.35f * s; var h = 1.8f * s;
            var walls = new MeshB(); walls.Cylinder(Vector3.zero, r, r, h, 14, 0.55f, 0.9f, true);
            Add(root, "Walls", walls, wall);
            var rm = new MeshB(); rm.Cone(new Vector3(0, h, 0), r + 0.35f * s, 1.5f * s, 14, 0.55f, 0.98f, true);
            Add(root, "Roof", rm, roof, flat: true);
            // Two windows flanking the door symmetrically. Kept at ±0.52r (not further out) so the flat
            // window panels stay close to the curved wall instead of floating off it.
            BuildOpenings(root, s, seed, r, new[] { (-r * 0.52f, h * 0.62f), (r * 0.52f, h * 0.62f) }, 0f, false);
        }

        // Door + framed/shuttered windows on the front (+z) wall; panes go to the warm-glow "Windows" mesh.
        private static void BuildOpenings(Transform root, float s, int seed, float frontZ, (float x, float y)[] windows, float doorX, bool shutters)
        {
            var frame = new MeshB(); var pane = new MeshB(); var muntin = new MeshB(); var shutterM = new MeshB();

            // Door: recessed wood door + white frame + lintel canopy.
            frame.Box(new Vector3(doorX, 0.66f * s, frontZ + 0.03f), new Vector3(0.9f * s, 1.42f * s, 0.06f), 0.9f, 0.7f, 0.7f, 0.5f, true);
            frame.Box(new Vector3(doorX, 1.42f * s, frontZ + 0.16f), new Vector3(1.0f * s, 0.1f * s, 0.34f * s), 0.95f, 0.7f, 0.7f, 0.5f, true); // canopy
            var door = new MeshB();
            door.Box(new Vector3(doorX, 0.62f * s, frontZ + 0.05f), new Vector3(0.66f * s, 1.24f * s, 0.06f), 0.85f, 0.6f, 0.6f, 0.4f, true);
            Add(root, "Door", door, DoorWood);

            var ww = 0.55f * s; var wh = 0.6f * s;
            foreach (var (x, y) in windows)
            {
                frame.Box(new Vector3(x, y, frontZ + 0.03f), new Vector3(ww + 0.16f * s, wh + 0.16f * s, 0.06f), 0.95f, 0.75f, 0.75f, 0.5f, true);          // casing
                frame.Box(new Vector3(x, y - wh * 0.5f - 0.06f * s, frontZ + 0.06f), new Vector3(ww + 0.28f * s, 0.1f * s, 0.16f * s), 0.95f, 0.7f, 0.7f, 0.5f, true); // sill
                pane.Box(new Vector3(x, y, frontZ + 0.055f), new Vector3(ww, wh, 0.04f), 1f, 0.9f, 0.9f, 0.8f, true);
                muntin.Box(new Vector3(x, y, frontZ + 0.075f), new Vector3(0.045f * s, wh, 0.02f), 1f, 0.9f, 0.9f, 0.9f, true);   // vertical
                muntin.Box(new Vector3(x, y, frontZ + 0.075f), new Vector3(ww, 0.045f * s, 0.02f), 1f, 0.9f, 0.9f, 0.9f, true);   // horizontal
                if (shutters)
                {
                    var sx = ww * 0.5f + 0.13f * s;
                    shutterM.Box(new Vector3(x - sx, y, frontZ + 0.04f), new Vector3(0.2f * s, wh + 0.06f * s, 0.05f), 0.9f, 0.7f, 0.7f, 0.5f, true);
                    shutterM.Box(new Vector3(x + sx, y, frontZ + 0.04f), new Vector3(0.2f * s, wh + 0.06f * s, 0.05f), 0.9f, 0.7f, 0.7f, 0.5f, true);
                }
            }
            Add(root, "Trim", frame, WindowFrame);
            Add(root, "Muntins", muntin, WindowFrame);
            if (shutters) Add(root, "Shutters", shutterM, Shutter(seed));
            Add(root, "Windows", pane, WarmGlow);
        }

        // ---- Entry portal / gate (clean modern landmark) -----------------------------------

        public static Transform CreateGate(string name)
        {
            var root = new GameObject(name).transform;
            var pillars = new MeshB();
            for (var s = -1; s <= 1; s += 2)
            {
                pillars.Box(new Vector3(2.1f * s, 1.7f, 0), new Vector3(0.6f, 3.4f, 0.6f), 0.9f, 0.62f, 0.7f, 0.4f);
                pillars.Box(new Vector3(2.1f * s, 0.2f, 0), new Vector3(0.85f, 0.4f, 0.85f), 0.85f, 0.6f, 0.65f, 0.4f); // base
                pillars.Box(new Vector3(2.1f * s, 3.55f, 0), new Vector3(0.78f, 0.3f, 0.78f), 0.95f, 0.65f, 0.7f, 0.4f); // cap
            }
            Add(root, "Pillars", pillars, StoneWhite);

            var lintel = new MeshB();
            lintel.Box(new Vector3(0, 3.95f, 0), new Vector3(5.4f, 0.5f, 0.7f), 0.95f, 0.65f, 0.7f, 0.4f);
            Add(root, "Lintel", lintel, RoofRed);   // warm red welcome beam

            var beam = new MeshB();
            beam.Box(new Vector3(0, 3.4f, 0), new Vector3(3.9f, 0.28f, 0.24f), 0.95f, 0.7f, 0.7f, 0.5f); // wooden sign board
            Add(root, "Board", beam, DoorWood);
            return root;
        }

        // ---- Hero: welcome pavilion (white columns, red roof, gold trim) -------------------

        public static Transform CreatePavilion(string name)
        {
            var root = new GameObject(name).transform;
            var sides = 8;
            var radius = 2.4f;

            // Two-step circular stone platform + a solid tiled deck, so the floor reads as a real,
            // finished carousel platform from the ground (not a thin see-through disc).
            var basem = new MeshB();
            basem.Cylinder(Vector3.zero, radius + 0.78f, radius + 0.66f, 0.2f, sides, 0.52f, 0.9f, true);            // lower step
            basem.Cylinder(new Vector3(0, 0.2f, 0), radius + 0.52f, radius + 0.44f, 0.18f, sides, 0.6f, 0.94f, true); // upper step
            Add(root, "Base", basem, StoneWhite);

            var floorTile = GroundingTextureFactory.Brick(RGB(0xCBC2AE)); // paved-stone deck
            var floor = new MeshB();
            floor.Cylinder(new Vector3(0, 0.38f, 0), radius + 0.4f, radius + 0.4f, 0.12f, sides, 0.72f, 1f, true);
            floor.Disc(new Vector3(0, 0.5f, 0), radius + 0.39f, sides, 0.85f);
            Add(root, "Floor", floor, floorTile);

            // Carousel-style gold centre medallion inlaid in the deck.
            var medal = new MeshB();
            medal.Disc(new Vector3(0, 0.51f, 0), radius * 0.42f, sides * 3, 0.95f);
            Add(root, "Medallion", medal, Gold, flat: true);

            var columns = new MeshB();
            var colH = 2.3f;
            for (var i = 0; i < sides; i++)
            {
                var ang = (i / (float)sides) * Mathf.PI * 2f;
                var p = new Vector3(Mathf.Cos(ang), 0f, Mathf.Sin(ang)) * (radius - 0.2f) + new Vector3(0, 0.5f, 0);
                columns.Cylinder(p, 0.15f, 0.13f, colH, 8, 0.5f, 0.95f);
            }
            Add(root, "Columns", columns, StoneWhite);

            var eaveY = 0.5f + colH;
            var beam = new MeshB();
            beam.Cylinder(new Vector3(0, eaveY, 0), radius + 0.5f, radius + 0.5f, 0.28f, sides, 0.6f, 0.85f); // stone entablature
            Add(root, "Entablature", beam, StoneWhite);
            var ring = new MeshB();
            ring.Cylinder(new Vector3(0, eaveY + 0.02f, 0), radius + 0.52f, radius + 0.52f, 0.08f, sides, 0.9f, 1f); // gold trim line
            Add(root, "GoldRing", ring, Gold);

            // Ceiling disc so the underside reads as a finished roof (not see-through) from the ground.
            var ceiling = new MeshB();
            ceiling.Disc(new Vector3(0, eaveY + 0.29f, 0), radius + 0.5f, sides, 0.62f);
            Add(root, "Ceiling", ceiling, StoneWhite);

            var roof = new MeshB();
            roof.Cone(new Vector3(0, eaveY + 0.28f, 0), radius + 0.55f, 2.9f, sides, 0.42f, 0.92f, true); // solid, double-sided
            Add(root, "Roof", roof, RoofRed, flat: true);

            var finial = new MeshB();
            finial.Facet(new Vector3(0, eaveY + 3.25f, 0), 0.2f, 1, 0.1f, 6, 4, 0.7f);
            Add(root, "Finial", finial, Gold, flat: true);
            return root;
        }

        // ---- Secondary: market stall (red/cream awning) ------------------------------------

        public static Transform CreateKiosk(string name)
        {
            var root = new GameObject(name).transform;
            var wood = GroundingTextureFactory.Wood(RGB(0x8A6A46));
            var woodDark = GroundingTextureFactory.Wood(RGB(0x6E5334));
            var body = new MeshB();
            body.Box(new Vector3(0, 0.85f, 0), new Vector3(2.6f, 1.3f, 1.6f), 0.95f, 0.6f, 0.55f, 0.35f, true);
            Add(root, "Body", body, wood);

            var counter = new MeshB();
            counter.Box(new Vector3(0, 1.5f, 0.85f), new Vector3(2.8f, 0.16f, 0.5f), 0.98f, 0.6f, 0.6f, 0.4f, true);
            Add(root, "Counter", counter, woodDark);

            for (var i = 0; i < 6; i++)
            {
                var x = -1.3f + (i + 0.5f) * (2.6f / 6f);
                (i % 2 == 0 ? _awA : _awB).Box(new Vector3(x, 2.15f, 1.0f), new Vector3(2.6f / 6f, 0.1f, 1.3f), 1f, 0.7f, 0.7f, 0.5f);
            }
            Add(root, "AwningA", _awA, AwningCream); _awA = new MeshB();
            Add(root, "AwningB", _awB, AwningRed); _awB = new MeshB();

            // Four posts — front pair from the counter, REAR pair rising off the cart body — so the awning
            // is visibly attached to the cart from every angle instead of floating.
            var posts = new MeshB();
            posts.Cylinder(new Vector3(1.25f, 1.5f, 1.55f), 0.05f, 0.05f, 0.65f, 6, 0.5f, 0.9f);
            posts.Cylinder(new Vector3(-1.25f, 1.5f, 1.55f), 0.05f, 0.05f, 0.65f, 6, 0.5f, 0.9f);
            posts.Cylinder(new Vector3(1.2f, 1.5f, 0.42f), 0.05f, 0.05f, 0.65f, 6, 0.5f, 0.9f);
            posts.Cylinder(new Vector3(-1.2f, 1.5f, 0.42f), 0.05f, 0.05f, 0.65f, 6, 0.5f, 0.9f);
            Add(root, "Posts", posts, MetalTrim);

            var wheels = new MeshB();
            wheels.Wheel(new Vector3(1.0f, 0.42f, -0.85f), 0.42f);
            wheels.Wheel(new Vector3(-1.0f, 0.42f, -0.85f), 0.42f);
            wheels.Wheel(new Vector3(1.0f, 0.42f, 0.85f), 0.42f);
            wheels.Wheel(new Vector3(-1.0f, 0.42f, 0.85f), 0.42f);
            Add(root, "Wheels", wheels, woodDark, flat: true);
            return root;
        }

        private static MeshB _awA = new();
        private static MeshB _awB = new();

        // ---- Props -------------------------------------------------------------------------

        public static Transform CreateSignpost(string name)
        {
            var root = new GameObject(name).transform;
            var post = new MeshB();
            post.Cylinder(Vector3.zero, 0.09f, 0.08f, 1.6f, 6, 0.4f, 0.9f);
            Add(root, "Post", post, Timber);
            var boards = new MeshB();
            boards.Box(new Vector3(0.25f, 1.25f, 0), new Vector3(0.7f, 0.28f, 0.06f), 0.95f, 0.6f, 0.6f, 0.5f);
            boards.Box(new Vector3(-0.2f, 0.9f, 0), new Vector3(0.6f, 0.24f, 0.06f), 0.95f, 0.6f, 0.6f, 0.5f);
            Add(root, "Boards", boards, StoneWhite);
            return root;
        }

        // Classic wrought-metal lamp with a warm cozy lantern.
        public static Transform CreateLamp(string name)
        {
            var root = new GameObject(name).transform;
            var post = new MeshB();
            post.Cylinder(Vector3.zero, 0.07f, 0.05f, 2.1f, 8, 0.4f, 0.9f);
            Add(root, "Post", post, MetalTrim);
            var lantern = new MeshB();
            lantern.Box(new Vector3(0, 2.15f, 0), new Vector3(0.24f, 0.32f, 0.24f), 1f, 0.9f, 0.9f, 0.8f);
            Add(root, "Lantern", lantern, WarmGlow);
            AddLight(root, "Glow", new Vector3(0, 2.15f, 0), WarmGlowRGB, 1.0f, 5f);
            // Night behaviour: the glow swells (intensity + range) as the sun cycle darkens, pooling warm
            // light on the ground below — see LampNightLight.
            root.Find("Glow").gameObject.AddComponent<Yuvi720.LearningWorld.World.LampNightLight>();
            return root;
        }

        public static Transform CreateBench(string name)
        {
            var root = new GameObject(name).transform;
            var m = new MeshB();
            m.Box(new Vector3(0, 0.42f, 0), new Vector3(1.5f, 0.1f, 0.45f), 0.95f, 0.6f, 0.6f, 0.4f);
            m.Box(new Vector3(0, 0.72f, -0.18f), new Vector3(1.5f, 0.5f, 0.08f), 0.9f, 0.6f, 0.6f, 0.4f);
            Add(root, "Slats", m, Timber);
            var legs = new MeshB();
            legs.Box(new Vector3(-0.6f, 0.2f, 0), new Vector3(0.09f, 0.4f, 0.4f), 0.7f, 0.5f, 0.5f, 0.35f);
            legs.Box(new Vector3(0.6f, 0.2f, 0), new Vector3(0.09f, 0.4f, 0.4f), 0.7f, 0.5f, 0.5f, 0.35f);
            Add(root, "Legs", legs, MetalTrim);
            return root;
        }

        // Faithful Unity replica of the production three.js Yuvi (YubiAvatar3D): same palette, proportions
        // and cyan face/antenna/ears, built from smooth primitives. In the shipped learning page the real
        // three.js robot is composited over the Unity canvas (externalAvatar); this proxy makes the
        // standalone Unity demo preview that same robot.
        public static Transform CreateYuviProxy(string name)
        {
            var root = new GameObject(name).transform;
            var rig = new GameObject("Rig").transform; rig.SetParent(root, false);
            const float s = 0.7f;                       // three.js units → in-world height ~1.6m
            rig.localScale = Vector3.one * s;
            rig.localPosition = new Vector3(0f, 0.043f, 0f); // lift so the feet rest on y≈0

            var body = Hard("YuviBody", 0x717378, .62f, .14f);   // grey shell
            var joint = Hard("YuviJoint", 0x5C5E62, .6f, .1f);   // darker joints
            var white = Hard("YuviWhite", 0xFFFFFF, .72f, .08f); // torso / boots / forearms
            var face = Hard("YuviFace", 0x050711, .4f, .1f);     // dark screen
            var cyan = Glow("YuviCyan", 0x3FD9E0, 2.0f);         // eyes / smile / ears / chest
            var cyanTip = Glow("YuviCyanTip", 0x4EEEF0, 1.4f);   // antenna tip

            // ── Legs (hip, thigh, knee, shin + white highlight, ankle, foot, white toe) ──
            for (var side = -1; side <= 1; side += 2)
            {
                var leg = new GameObject(side < 0 ? "LegL" : "LegR").transform;
                leg.SetParent(rig, false); leg.localPosition = new Vector3(0.145f * side, 0.12f, 0f);
                PrimSphere(leg, new Vector3(0.014f * side, 0.39f, 0.015f), 0.104f, new Vector3(1.08f, 0.92f, 1f), body);
                PrimBox(leg, new Vector3(0.01f * side, 0.29f, 0.018f), new Vector3(0.16f, 0.165f, 0.145f), body);
                PrimCyl(leg, new Vector3(0.003f * side, 0.18f, 0.025f), 0.078f, 0.052f, new Vector3(1.05f, 0.78f, 1f), joint);
                PrimBox(leg, new Vector3(-0.003f * side, 0.075f, 0.04f), new Vector3(0.162f, 0.19f, 0.145f), body);
                PrimBox(leg, new Vector3(-0.003f * side, 0.078f, 0.126f), new Vector3(0.108f, 0.13f, 0.026f), white);
                PrimCyl(leg, new Vector3(-0.003f * side, -0.045f, 0.04f), 0.078f, 0.052f, new Vector3(1.12f, 0.66f, 1f), body);
                PrimBox(leg, new Vector3(0.006f * side, -0.1f, 0.105f), new Vector3(0.255f, 0.125f, 0.36f), body, new Vector3(-5.2f, 0, 0));
                PrimBox(leg, new Vector3(0.006f * side, -0.078f, 0.208f), new Vector3(0.205f, 0.07f, 0.17f), white, new Vector3(-5.7f, 0, 0));
            }
            PrimBox(rig, new Vector3(0, 0.54f, 0), new Vector3(0.33f, 0.11f, 0.25f), body);                       // hips
            PrimSphere(rig, new Vector3(0, 0.82f, 0), 0.27f, new Vector3(0.9f, 1.02f, 0.76f), white);            // torso
            PrimBox(rig, new Vector3(0, 1.08f, 0), new Vector3(0.36f, 0.12f, 0.27f), body);                       // yoke
            PrimBox(rig, new Vector3(0, 0.845f, 0.235f), new Vector3(0.17f, 0.17f, 0.02f), cyan);                 // chest "Y" badge

            // ── Arms (shoulder, upper, elbow, white forearm, wrist, hand) ──
            for (var side = -1; side <= 1; side += 2)
            {
                var arm = new GameObject(side < 0 ? "ArmL" : "ArmR").transform;
                arm.SetParent(rig, false);
                arm.localPosition = new Vector3(0.318f * side, 1.015f, -0.005f);
                arm.localEulerAngles = new Vector3(0, 0, 5.4f * side);
                PrimSphere(arm, Vector3.zero, 0.118f, new Vector3(1.05f, 0.92f, 1.03f), body);
                PrimBox(arm, new Vector3(0.028f * side, -0.13f, 0.008f), new Vector3(0.128f, 0.2f, 0.125f), body);
                PrimCyl(arm, new Vector3(0.045f * side, -0.232f, 0.008f), 0.085f, 0.064f, new Vector3(1.05f, 0.74f, 1f), joint);
                PrimCyl(arm, new Vector3(0.052f * side, -0.34f, 0.026f), 0.095f, 0.235f, new Vector3(1.06f, 1f, 0.82f), white);
                PrimCyl(arm, new Vector3(0.056f * side, -0.47f, 0.035f), 0.086f, 0.062f, new Vector3(1.08f, 0.64f, 0.94f), body);
                PrimSphere(arm, new Vector3(0.058f * side, -0.545f, 0.068f), 0.096f, new Vector3(0.98f, 1.1f, 0.82f), body);
            }

            // ── Head (helmet, antenna, dark screen, cyan eyes + smile, ears + cyan caps) ──
            var head = new GameObject("Head").transform;
            head.SetParent(rig, false); head.localPosition = new Vector3(0, 1.59f, 0); head.localScale = Vector3.one * 0.9f;
            PrimBox(head, Vector3.zero, new Vector3(1.12f, 1.02f, 0.893f), body);                                 // helmet
            PrimCyl(head, new Vector3(0, 0.63f, 0.02f), 0.016f, 0.22f, Vector3.one, joint);                       // antenna rod
            PrimSphere(head, new Vector3(0, 0.76f, 0.02f), 0.052f, Vector3.one, cyanTip);                         // antenna tip
            PrimBox(head, new Vector3(0, -0.03f, 0.47f), new Vector3(0.82f, 0.62f, 0.05f), face);                 // face screen
            PrimBox(head, new Vector3(-0.165f, 0.03f, 0.5f), new Vector3(0.12f, 0.12f, 0.02f), cyan);             // eye L
            PrimBox(head, new Vector3(0.165f, 0.03f, 0.5f), new Vector3(0.12f, 0.12f, 0.02f), cyan);              // eye R
            PrimBox(head, new Vector3(0, -0.14f, 0.5f), new Vector3(0.34f, 0.05f, 0.02f), cyan);                  // smile
            PrimCyl(head, new Vector3(-0.56f, -0.02f, 0.02f), 0.15f, 0.12f, Vector3.one, body, new Vector3(0, 0, 90f));
            PrimCyl(head, new Vector3(0.56f, -0.02f, 0.02f), 0.15f, 0.12f, Vector3.one, body, new Vector3(0, 0, 90f));
            PrimSphere(head, new Vector3(-0.628f, -0.02f, 0.02f), 0.07f, new Vector3(0.35f, 1f, 1f), cyan);       // ear cap L
            PrimSphere(head, new Vector3(0.628f, -0.02f, 0.02f), 0.07f, new Vector3(0.35f, 1f, 1f), cyan);        // ear cap R
            return root;
        }

        // ---- primitive helpers for the Yuvi replica (smooth Unity meshes, colliders stripped) -----------
        private static Transform Prim(Transform parent, PrimitiveType type, Vector3 pos, Vector3 scale, Material mat, Vector3? euler)
        {
            var go = GameObject.CreatePrimitive(type);
            var col = go.GetComponent<Collider>(); if (col) Object.DestroyImmediate(col);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = scale;
            if (euler.HasValue) go.transform.localEulerAngles = euler.Value;
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            return go.transform;
        }
        private static void PrimSphere(Transform p, Vector3 pos, float r, Vector3 mul, Material m) =>
            Prim(p, PrimitiveType.Sphere, pos, Vector3.Scale(Vector3.one * (2f * r), mul), m, null);
        private static void PrimBox(Transform p, Vector3 pos, Vector3 size, Material m, Vector3? euler = null) =>
            Prim(p, PrimitiveType.Cube, pos, size, m, euler);
        private static void PrimCyl(Transform p, Vector3 pos, float r, float h, Vector3 mul, Material m, Vector3? euler = null) =>
            Prim(p, PrimitiveType.Cylinder, pos, Vector3.Scale(new Vector3(2f * r, h * 0.5f, 2f * r), mul), m, euler);

        // Floating "task ready" marker (a gold pin + gem) the proximity animator rises into view.
        public static Transform CreateTaskMarker(string name)
        {
            var root = new GameObject(name).transform;
            var pin = new MeshB();
            pin.Cone(new Vector3(0, 0f, 0), 0.16f, 0.42f, 6, 0.7f, 1f);     // pin body (point up)
            Add(root, "Pin", pin, RoofRed, flat: true);
            var gem = new MeshB();
            gem.Facet(new Vector3(0, 0.62f, 0), 0.17f, 3, 0.08f, 6, 4, 0.7f);
            Add(root, "Gem", gem, Gold, flat: true);
            return root;
        }

        // Cheerful bunch of coloured balloons on ribbons, floating up from a knot (tied to the cart).
        // Each balloon rides its own child (rotated so the ribbon leans out from the shared knot).
        public static Transform CreateBalloonBunch(string name)
        {
            var root = new GameObject(name).transform;
            var colors = new[] { 0xE0483A, 0xE79A34, 0xEBD24B, 0x5FB35A, 0x4E9DE0, 0xC85BA8, 0xE86A5B };
            //                    red        orange      yellow      green      blue      magenta    coral

            var knot = new MeshB(); knot.Facet(Vector3.zero, 0.09f, 7, 0.12f, 5, 3, 0.6f);
            Add(root, "Knot", knot, DoorWood, flat: true);

            for (var i = 0; i < colors.Length; i++)
            {
                var ang = i * 2.399963f;                       // golden-angle fan
                var spread = 0.5f + 0.16f * (i % 3);
                var dir = new Vector3(Mathf.Cos(ang) * spread, 2.5f + 0.32f * i, Mathf.Sin(ang) * spread * 0.7f);
                var len = dir.magnitude;

                var child = new GameObject($"Balloon-{i}").transform;
                child.SetParent(root, false);
                child.localRotation = Quaternion.FromToRotation(Vector3.up, dir.normalized);

                var str = new MeshB();
                str.Cylinder(Vector3.zero, 0.014f, 0.014f, len - 0.26f, 4, 0.7f, 0.9f);
                Add(child, "String", str, MetalTrim);

                var ball = new MeshB();
                ball.Facet(new Vector3(0, len, 0), 0.28f, i * 3 + 1, 0.05f, 8, 6, 0.78f);   // round balloon
                ball.Cone(new Vector3(0, len - 0.34f, 0), 0.07f, 0.12f, 5, 0.6f, 0.95f);    // tie nub
                Add(child, "Balloon", ball, Hard($"Balloon{i}", colors[i], 0.55f, 0f), flat: true);
            }
            // NOTE: BalloonSway is attached by the CALLER after the bunch is placed — it captures its base
            // pose in OnEnable, so adding it here (before Place) pinned the balloons to the world origin.
            return root;
        }

        // Attaches a looping rising-smoke plume at a chimney top (local-space position on the house root).
        private static void AddSmoke(Transform root, Vector3 topLocal, float scale)
        {
            var go = new GameObject("ChimneySmoke");
            go.transform.SetParent(root, false);
            go.transform.localPosition = topLocal;
            var s = go.AddComponent<Yuvi720.LearningWorld.World.ChimneySmoke>();
            s.baseSize = 0.15f * scale;
            s.riseHeight = 1.9f * scale;
            s.drift = 0.38f * scale;
        }

        // ---- helpers -----------------------------------------------------------------------

        private static Material FlowerMat(int seed)
        {
            switch (Mathf.Abs(seed) % 3)
            {
                case 0: return Veg("FlowerWarm", 0xE0A24B);
                case 1: return Veg("FlowerRose", 0xD07A86);
                default: return Veg("FlowerPale", 0xE9E3D2);
            }
        }

        private static void AddLight(Transform parent, string name, Vector3 localPos, int hex, float intensity, float range)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            var l = go.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = RGB(hex);
            l.intensity = intensity;
            l.range = range;
            l.shadows = LightShadows.None;
            l.renderMode = LightRenderMode.ForceVertex; // cheap fill; keeps the pixel-light budget for the sun
        }

        private static Transform Add(Transform parent, string name, MeshB buf, Material mat, bool flat = false)
        {
            var mesh = buf.ToMesh($"MESH_YW_Dressing_{parent.name}_{name}", flat);
            if (mesh.vertexCount == 0) return null;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            return go.transform;
        }

        private static float Hash(int n)
        {
            var v = Mathf.Sin(n * 12.9898f) * 43758.5453f;
            return (v - Mathf.Floor(v)) * 2f - 1f;
        }

        private static Color RGB(int hex) =>
            new(((hex >> 16) & 0xFF) / 255f, ((hex >> 8) & 0xFF) / 255f, (hex & 0xFF) / 255f);

        // Mesh accumulator with primitive generators (bake AO into vertex colors for the ground shader).
        private sealed class MeshB
        {
            private readonly List<Vector3> _v = new();
            private readonly List<int> _t = new();
            private readonly List<Color> _c = new();

            public void Tri(Vector3 a, Vector3 b, Vector3 c, float ca, float cb, float cc)
            {
                var o = _v.Count; _v.Add(a); _v.Add(b); _v.Add(c);
                _c.Add(G(ca)); _c.Add(G(cb)); _c.Add(G(cc));
                _t.Add(o); _t.Add(o + 1); _t.Add(o + 2);
            }

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, float ca, float cb, float cc, float cd)
            {
                var o = _v.Count; _v.Add(a); _v.Add(b); _v.Add(c); _v.Add(d);
                _c.Add(G(ca)); _c.Add(G(cb)); _c.Add(G(cc)); _c.Add(G(cd));
                _t.Add(o); _t.Add(o + 1); _t.Add(o + 2); _t.Add(o); _t.Add(o + 2); _t.Add(o + 3);
            }

            public void Box(Vector3 center, Vector3 size, float top, float side, float front, float bottom, bool doubleSided = false)
            {
                var h = size * 0.5f;
                Vector3 C(float x, float y, float z) => center + new Vector3(x, y, z);
                var a = C(-h.x, -h.y, -h.z); var b = C(h.x, -h.y, -h.z); var c = C(h.x, -h.y, h.z); var d = C(-h.x, -h.y, h.z);
                var e = C(-h.x, h.y, -h.z); var f = C(h.x, h.y, -h.z); var g = C(h.x, h.y, h.z); var hh = C(-h.x, h.y, h.z);
                void Q(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float c0, float c1, float c2, float c3)
                {
                    Quad(p0, p1, p2, p3, c0, c1, c2, c3);
                    if (doubleSided) Quad(p3, p2, p1, p0, c3, c2, c1, c0);
                }
                Q(e, f, g, hh, top, top, top, top);
                Q(d, c, b, a, bottom, bottom, bottom, bottom);
                Q(a, b, f, e, front, front, top, top);
                Q(c, d, hh, g, side, side, top, top);
                Q(b, c, g, f, side, side, top, top);
                Q(d, a, e, hh, side, side, top, top);
            }

            public void Cylinder(Vector3 baseCenter, float rBottom, float rTop, float height, int sides, float aoBottom, float aoTop, bool doubleSided = false)
            {
                for (var i = 0; i < sides; i++)
                {
                    var a0 = (i / (float)sides) * Mathf.PI * 2f;
                    var a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    var b0 = baseCenter + new Vector3(Mathf.Cos(a0) * rBottom, 0, Mathf.Sin(a0) * rBottom);
                    var b1 = baseCenter + new Vector3(Mathf.Cos(a1) * rBottom, 0, Mathf.Sin(a1) * rBottom);
                    var t0 = baseCenter + new Vector3(Mathf.Cos(a0) * rTop, height, Mathf.Sin(a0) * rTop);
                    var t1 = baseCenter + new Vector3(Mathf.Cos(a1) * rTop, height, Mathf.Sin(a1) * rTop);
                    Quad(b0, b1, t1, t0, aoBottom, aoBottom, aoTop, aoTop);
                    Tri(baseCenter + Vector3.up * height, t0, t1, aoTop, aoTop, aoTop);
                    if (doubleSided)
                    {
                        Quad(t0, t1, b1, b0, aoTop, aoTop, aoBottom, aoBottom);      // back-face wall
                        Tri(baseCenter + Vector3.up * height, t1, t0, aoTop, aoTop, aoTop); // back-face cap
                    }
                }
            }

            public void Cone(Vector3 baseCenter, float rBottom, float height, int sides, float aoBottom, float aoTop, bool doubleSided = false)
            {
                var apex = baseCenter + Vector3.up * height;
                for (var i = 0; i < sides; i++)
                {
                    var a0 = (i / (float)sides) * Mathf.PI * 2f;
                    var a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    var b0 = baseCenter + new Vector3(Mathf.Cos(a0) * rBottom, 0, Mathf.Sin(a0) * rBottom);
                    var b1 = baseCenter + new Vector3(Mathf.Cos(a1) * rBottom, 0, Mathf.Sin(a1) * rBottom);
                    Tri(b0, b1, apex, aoBottom, aoBottom, aoTop);
                    if (doubleSided) Tri(b1, b0, apex, aoBottom, aoBottom, aoTop);   // solid underside
                    else Tri(baseCenter, b1, b0, aoBottom * 0.8f, aoBottom * 0.8f, aoBottom * 0.8f);
                }
            }

            // Rectangular hip/pyramid roof aligned to a box (4 slopes to a centre apex).
            public void Hip(Vector3 c, float w, float d, float h, float aoBottom, float aoTop, bool doubleSided = false)
            {
                var hw = w * 0.5f; var hd = d * 0.5f;
                var c0 = c + new Vector3(-hw, 0, -hd); var c1 = c + new Vector3(hw, 0, -hd);
                var c2 = c + new Vector3(hw, 0, hd); var c3 = c + new Vector3(-hw, 0, hd);
                var ap = c + new Vector3(0, h, 0);
                void T(Vector3 a, Vector3 b, Vector3 t)
                {
                    Tri(a, b, t, aoBottom, aoBottom, aoTop);
                    if (doubleSided) Tri(b, a, t, aoBottom, aoBottom, aoTop);
                }
                T(c0, c1, ap); T(c1, c2, ap); T(c2, c3, ap); T(c3, c0, ap);
            }

            public void Disc(Vector3 center, float radius, int sides, float ao = 1f)
            {
                for (var i = 0; i < sides; i++)
                {
                    var a0 = (i / (float)sides) * Mathf.PI * 2f;
                    var a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    var o0 = center + new Vector3(Mathf.Cos(a0) * radius, 0, Mathf.Sin(a0) * radius);
                    var o1 = center + new Vector3(Mathf.Cos(a1) * radius, 0, Mathf.Sin(a1) * radius);
                    Tri(center, o0, o1, ao, ao, ao);        // both windings so the surface shows from any side
                    Tri(center, o1, o0, ao, ao, ao);
                }
            }

            // Flat annulus (a ring on the ground) — used for the sand plaza path around the fountain.
            public void Ring(Vector3 center, float innerR, float outerR, int sides, float ao = 1f)
            {
                for (var i = 0; i < sides; i++)
                {
                    var a0 = (i / (float)sides) * Mathf.PI * 2f;
                    var a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    var i0 = center + new Vector3(Mathf.Cos(a0) * innerR, 0, Mathf.Sin(a0) * innerR);
                    var i1 = center + new Vector3(Mathf.Cos(a1) * innerR, 0, Mathf.Sin(a1) * innerR);
                    var o0 = center + new Vector3(Mathf.Cos(a0) * outerR, 0, Mathf.Sin(a0) * outerR);
                    var o1 = center + new Vector3(Mathf.Cos(a1) * outerR, 0, Mathf.Sin(a1) * outerR);
                    Quad(i0, o0, o1, i1, ao, ao, ao, ao);   // top face
                    Quad(i1, o1, o0, i0, ao, ao, ao, ao);   // underside (double-sided)
                }
            }

            // Gable (pitched) roof: ridge along x at the top centre, two slopes + triangular ends.
            public void Gable(Vector3 c, float w, float d, float h, float aoBottom, float aoTop, bool doubleSided = false)
            {
                var hw = w * 0.5f; var hd = d * 0.5f;
                Vector3 P(float x, float y, float z) => c + new Vector3(x, y, z);
                var efL = P(-hw, 0, -hd); var efR = P(hw, 0, -hd);
                var ebL = P(-hw, 0, hd); var ebR = P(hw, 0, hd);
                var rL = P(-hw, h, 0); var rR = P(hw, h, 0);
                void Q(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3)
                {
                    Quad(p0, p1, p2, p3, aoBottom, aoBottom, aoTop, aoTop);
                    if (doubleSided) Quad(p3, p2, p1, p0, aoTop, aoTop, aoBottom, aoBottom);
                }
                void T(Vector3 p0, Vector3 p1, Vector3 p2)
                {
                    Tri(p0, p1, p2, aoBottom, aoBottom, aoTop);
                    if (doubleSided) Tri(p1, p0, p2, aoBottom, aoBottom, aoTop);
                }
                Q(efL, efR, rR, rL);  // front slope
                Q(ebR, ebL, rL, rR);  // back slope
                T(ebL, efL, rL);      // left gable end
                T(efR, ebR, rR);      // right gable end
            }

            // Faceted sphere-ish form; low seg/rings + modest wobble reads as crisp planes, not a blob.
            public void Facet(Vector3 center, float radius, int seed, float wob, int seg, int rings, float aoBottom)
            {
                for (var r = 0; r < rings; r++)
                {
                    var v0 = r / (float)rings; var v1 = (r + 1) / (float)rings;
                    for (var s = 0; s < seg; s++)
                    {
                        var u0 = s / (float)seg; var u1 = (s + 1) / (float)seg;
                        var p00 = Sphere(center, radius, u0, v0, seed, wob);
                        var p10 = Sphere(center, radius, u1, v0, seed, wob);
                        var p01 = Sphere(center, radius, u0, v1, seed, wob);
                        var p11 = Sphere(center, radius, u1, v1, seed, wob);
                        var c0 = Mathf.Lerp(aoBottom, 1f, v0); var c1 = Mathf.Lerp(aoBottom, 1f, v1);
                        Quad(p00, p10, p11, p01, c0, c0, c1, c1);
                    }
                }
            }

            public void FacetRock(Vector3 center, float radius, int seed)
            {
                const int seg = 5; const int rings = 3;
                for (var r = 0; r < rings; r++)
                {
                    var v0 = r / (float)rings; var v1 = (r + 1) / (float)rings;
                    for (var s = 0; s < seg; s++)
                    {
                        var u0 = s / (float)seg; var u1 = (s + 1) / (float)seg;
                        var p00 = RockPt(center, radius, u0, v0, seed);
                        var p10 = RockPt(center, radius, u1, v0, seed);
                        var p01 = RockPt(center, radius, u0, v1, seed);
                        var p11 = RockPt(center, radius, u1, v1, seed);
                        var c0 = Mathf.Lerp(0.4f, 1f, v0); var c1 = Mathf.Lerp(0.4f, 1f, v1);
                        Quad(p00, p10, p11, p01, c0, c0, c1, c1);
                    }
                }
            }

            // Natural faceted peak: apex leans off-centre and each base spoke jitters in radius,
            // height and angle so the ridgeline breaks up instead of reading as a clean pyramid.
            public void RidgeCone(Vector3 baseCenter, float rBottom, float height, int sides, int seed, float jitter)
            {
                var lean = new Vector3(Hash01(seed) * 2f - 1f, 0f, Hash01(seed + 91) * 2f - 1f) * rBottom * 0.28f;
                var apex = baseCenter + lean + Vector3.up * (height * (0.9f + Hash01(seed) * 0.18f));
                Vector3 Spoke(int k)
                {
                    var a = ((k % sides) / (float)sides) * Mathf.PI * 2f + (Hash01(seed + k * 7) - 0.5f) * 0.4f;
                    var jr = 1f + jitter * (Hash01(seed + k) * 2f - 1f);
                    var jy = height * 0.18f * Hash01(seed + k * 3); // uneven foothills
                    return baseCenter + new Vector3(Mathf.Cos(a) * rBottom * jr, jy, Mathf.Sin(a) * rBottom * jr);
                }
                for (var i = 0; i < sides; i++)
                    Tri(Spoke(i), Spoke(i + 1), apex, 0.5f, 0.5f, 1f);
            }

            // Sharp crystal shard — a tapered spike rising from an offset base.
            public void Shard(Vector3 baseCenter, float radius, float height, Quaternion rot)
            {
                const int sides = 4;
                var apex = baseCenter + rot * (Vector3.up * height);
                for (var i = 0; i < sides; i++)
                {
                    var a0 = (i / (float)sides) * Mathf.PI * 2f;
                    var a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    var b0 = baseCenter + rot * new Vector3(Mathf.Cos(a0) * radius, 0, Mathf.Sin(a0) * radius);
                    var b1 = baseCenter + rot * new Vector3(Mathf.Cos(a1) * radius, 0, Mathf.Sin(a1) * radius);
                    Tri(b0, b1, apex, 0.7f, 0.7f, 1f);
                }
            }

            public void Blade(Vector3 baseDir, Vector3 tip, float width)
            {
                var right = Vector3.Cross(Vector3.up, (tip - baseDir).normalized).normalized * width;
                Quad(baseDir - right, baseDir + right, tip + right * 0.2f, tip - right * 0.2f, 0.4f, 0.4f, 1f, 1f);
            }

            public void Wheel(Vector3 center, float radius)
            {
                const int sides = 12;
                for (var i = 0; i < sides; i++)
                {
                    var a0 = (i / (float)sides) * Mathf.PI * 2f;
                    var a1 = ((i + 1) / (float)sides) * Mathf.PI * 2f;
                    var o0 = new Vector3(Mathf.Cos(a0) * radius, Mathf.Sin(a0) * radius, 0);
                    var o1 = new Vector3(Mathf.Cos(a1) * radius, Mathf.Sin(a1) * radius, 0);
                    var w = Vector3.forward * 0.12f;
                    Quad(center + o0 - w, center + o1 - w, center + o1 + w, center + o0 + w, 0.6f, 0.6f, 0.6f, 0.6f);
                    Tri(center + w, center + o0 + w, center + o1 + w, 0.85f, 0.85f, 0.85f);
                    Tri(center - w, center + o1 - w, center + o0 - w, 0.5f, 0.5f, 0.5f);
                }
            }

            private static Vector3 Sphere(Vector3 c, float radius, float u, float v, int seed, float wob)
            {
                var theta = u * Mathf.PI * 2f; var phi = v * Mathf.PI;
                var n = new Vector3(Mathf.Sin(phi) * Mathf.Cos(theta), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Sin(theta));
                var w = 1f + wob * Mathf.Sin(theta * 3f + seed) * Mathf.Sin(phi * 2f + seed);
                return c + n * radius * w;
            }

            private static Vector3 RockPt(Vector3 c, float radius, float u, float v, int seed)
            {
                var theta = u * Mathf.PI * 2f; var phi = v * Mathf.PI;
                var n = new Vector3(Mathf.Sin(phi) * Mathf.Cos(theta), Mathf.Cos(phi) * 0.8f, Mathf.Sin(phi) * Mathf.Sin(theta));
                var wob = 1f + 0.34f * H(u * 7.3f + seed) + 0.22f * H(v * 5.1f + seed * 2);
                var p = c + n * radius * wob;
                if (p.y < c.y) p.y = c.y + (p.y - c.y) * 0.35f;
                return p;
            }

            private static float H(float x) { var v = Mathf.Sin(x * 12.9898f) * 43758.5453f; return (v - Mathf.Floor(v)) * 2f - 1f; }
            private static float Hash01(int n) { var v = Mathf.Sin(n * 12.9898f) * 43758.5453f; return v - Mathf.Floor(v); }

            public Mesh ToMesh(string name, bool flat)
            {
                var m = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
                m.SetVertices(_v); m.SetTriangles(_t, 0); m.SetColors(_c);
                m.RecalculateNormals();
                // World-scale planar UVs (1 unit = 1 uv unit) projected along each face's dominant axis,
                // so textured materials tile consistently; tiling density is set per-material.
                var normals = m.normals;
                var uv = new Vector2[_v.Count];
                for (var i = 0; i < _v.Count; i++)
                {
                    var n = normals[i]; var p = _v[i];
                    var ax = Mathf.Abs(n.x); var ay = Mathf.Abs(n.y); var az = Mathf.Abs(n.z);
                    if (ay >= ax && ay >= az) uv[i] = new Vector2(p.x, p.z);
                    else if (ax >= az) uv[i] = new Vector2(p.z, p.y);
                    else uv[i] = new Vector2(p.x, p.y);
                }
                m.uv = uv;
                m.RecalculateBounds();
                return m;
            }

            private static Color G(float v) { v = Mathf.Clamp01(v); return new Color(v, v, v, 1f); }
        }
    }
}
