using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Yuvi720.LearningWorld.World;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    /// <summary>
    /// Builds the production-dressed Arrival Valley: the clean grounding blockout plus a warm, realistic
    /// island-village decoration layer (welcome pavilion, cottages, market stall, entry arch, tiered
    /// fountain, conifers, rocks, background mountains) placed for the fixed section camera. Living water
    /// (Yuvi/Water shader) animates the ocean and the fountain basins; clickable task buildings carry a
    /// <see cref="ProximityPopAnimator"/> that pops + shows a marker when Yuvi is near. Grounding stays
    /// untouched; dressing lives under a Dressing root, and the plaza→bluff stairs are hidden (Yuvi flies).
    /// </summary>
    public static class ArrivalProductionBuilder
    {
        private const string ScenePath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Arrival_Production.unity";
        private const string BootScenePath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Boot.unity";
        private const string SectionArrivalPath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Section_Arrival.unity";
        private const string CaptureFolder = "Assets/Art/World/HighFidelity/ReviewCaptures/ArrivalProduction";
        private const float Plaza = 0.2f;
        private const float Bluff = 2.4f;
        private const float Pond = -0.7f;
        private const float HS = 1.2f;   // house scale — the homes read a bit small against the big island

        [MenuItem("Yuvi/World Art/Arrival/01 Build Dressed Arrival")]
        public static void BuildDressedArrival()
        {
            ProductionGroundingWorldBuilder.BuildProductionGroundingWorld();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ProductionGroundingWorldBuilder.PrefabPath);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var world = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);

            // Yuvi flies to the overlook, so the plaza→bluff (and pond) stairs are not needed —
            // hide them for a clean, uncluttered Arrival read.
            HideConnector(world, "Transition-overlook-rise");
            HideConnector(world, "Transition-pond-descent");
            // Replace the flat static water plane with an animated ocean below.
            HideByName(world, "WaterPlane");
            // Solid terrain so the player walks on the ground and cliffs block him (fly to reach the bluff).
            AddTerrainColliders(world);
            // Bridge railings must be flat invisible WALLS, not the climbable rail mesh the terrain-collider
            // pass produced (the CharacterController stepped up the angled posts/rope and got stuck).
            FixBridgeRailings(world);
            // Swap the flat theme-green grass for the painterly world-XZ terrain (grass tones + dry + dirt).
            RetextureArrivalGround(world);

            var dressing = new GameObject("Dressing-arrival").transform;
            BuildOceanPlane(dressing);
            DecorateArrival(dressing);

            // Demo Yuvi: CharacterController so colliders stop him — arrows move, Space flies.
            var yuvi = GroundingDecorationBuilder.CreateYuviProxy("Yuvi-Demo");
            yuvi.SetParent(dressing, false);
            yuvi.position = new Vector3(-10f, Plaza + 0.6f, -9f);
            var cc = yuvi.gameObject.AddComponent<CharacterController>();
            cc.radius = 0.4f; cc.height = 1.5f; cc.center = new Vector3(0f, 0.78f, 0f);
            cc.slopeLimit = 55f; cc.stepOffset = 0.4f;
            yuvi.gameObject.AddComponent<DemoPlayerController>();
            foreach (var a in dressing.GetComponentsInChildren<ProximityPopAnimator>())
                a.player = yuvi;

            var arrivalCam = BuildLighting();
            arrivalCam.gameObject.AddComponent<IsometricCameraRig>().target = yuvi;

            // Production bridge: React drives this "LearningWorld" GameObject and receives world events.
            // Movement/collision stay with the Unity CharacterController; the real three.js Yuvi overlays
            // via avatar-projection. The clickable task buildings become the landmark slots (in order).
            var bridgeGo = new GameObject("LearningWorld");
            var bridge = bridgeGo.AddComponent<ArrivalWorldBridge>();
            bridge.worldCamera = Camera.main;
            bridge.player = yuvi;
            bridge.playerController = yuvi.GetComponent<DemoPlayerController>();
            foreach (var animator in dressing.GetComponentsInChildren<ProximityPopAnimator>())
                bridge.landmarkSlots.Add(animator.transform);

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("✅ Dressed Arrival built: pavilion, cottages, market stall, arch, animated fountain + ocean, mountains, proximity animators.");
        }

        /// <summary>
        /// Builds the STREAMED variant as two scenes: <c>SCN_YW_Section_Arrival</c> (the island content — the
        /// only thing packed into a downloadable Addressable bundle) and <c>SCN_YW_Boot</c> (the tiny always-
        /// resident scene: camera, lights, player rig, the LearningWorld bridge + <see cref="SectionStreamer"/>).
        /// The section carries a <see cref="CloudCurtain"/> on its eastern edge that blocks the view toward the
        /// next section (which streams in behind it and fades on completion). Landmark slots are discovered at
        /// runtime as each section loads — see <see cref="ArrivalWorldBridge"/>.
        /// </summary>
        [MenuItem("Yuvi/World Art/Arrival/03 Build Streamed World")]
        public static void BuildStreamedWorld()
        {
            // ── Section scene: island content only (streamed as an Addressable bundle) ──
            ProductionGroundingWorldBuilder.BuildProductionGroundingWorld();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ProductionGroundingWorldBuilder.PrefabPath);
            var sectionScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var world = (GameObject)PrefabUtility.InstantiatePrefab(prefab, sectionScene);
            HideConnector(world, "Transition-overlook-rise");
            HideConnector(world, "Transition-pond-descent");
            HideByName(world, "WaterPlane");
            AddTerrainColliders(world);
            RetextureArrivalGround(world);

            var dressing = new GameObject("Dressing-arrival").transform;
            BuildOceanPlane(dressing);
            DecorateArrival(dressing);

            // Cloud curtain along the eastern edge — hides the view toward the next section (which is not yet
            // downloaded) and fades when this section is completed (revealsSectionId → RevealSection).
            var curtainGo = new GameObject("CloudCurtain-East");
            curtainGo.transform.SetParent(dressing, false);
            curtainGo.transform.SetPositionAndRotation(new Vector3(20f, Plaza - 1f, 0f), Quaternion.Euler(0f, -90f, 0f));
            var curtain = curtainGo.AddComponent<CloudCurtain>();
            curtain.width = 52f; curtain.height = 18f; curtain.columns = 15; curtain.rows = 6;
            curtain.puffSize = 4.2f;
            curtain.cloudColor = new Color(0.93f, 0.94f, 0.97f, 0.72f);
            curtain.revealsSectionId = "archive";

            EditorSceneManager.SaveScene(sectionScene, SectionArrivalPath);

            // ── Boot scene: persistent camera/lights/player/bridge/streamer ──
            var bootScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var yuvi = GroundingDecorationBuilder.CreateYuviProxy("Yuvi-Demo");
            yuvi.position = new Vector3(-10f, Plaza + 0.6f, -9f);
            var cc = yuvi.gameObject.AddComponent<CharacterController>();
            cc.radius = 0.4f; cc.height = 1.5f; cc.center = new Vector3(0f, 0.78f, 0f);
            cc.slopeLimit = 55f; cc.stepOffset = 0.4f;
            yuvi.gameObject.AddComponent<DemoPlayerController>();

            var bootCam = BuildLighting();
            bootCam.gameObject.AddComponent<IsometricCameraRig>().target = yuvi;

            var bridgeGo = new GameObject("LearningWorld");
            var bridge = bridgeGo.AddComponent<ArrivalWorldBridge>();
            bridge.worldCamera = Camera.main;
            bridge.player = yuvi;
            bridge.playerController = yuvi.GetComponent<DemoPlayerController>();
            var streamer = bridgeGo.AddComponent<SectionStreamer>();
            streamer.tracked = yuvi;
            streamer.sections = new System.Collections.Generic.List<SectionDef>
            {
                new SectionDef
                {
                    id = "arrival", sceneKey = "section.arrival",
                    center = new Vector3(-12f, 0f, 0f),
                    loadRadius = 240f, unloadRadius = 480f, startLoaded = true,
                },
            };
            bridge.streamer = streamer;

            EditorSceneManager.SaveScene(bootScene, BootScenePath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"✅ Streamed world built:\n  • {BootScenePath} (camera/player/bridge/streamer)\n  • {SectionArrivalPath} (Addressable island + east cloud curtain).");
        }

        [MenuItem("Yuvi/World Art/Arrival/02 Capture Dressed Arrival")]
        public static void CaptureDressedArrival()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath) == null) BuildDressedArrival();
            else EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var cam = Camera.main;

            // The follow rig is [ExecuteAlways], so it would snap the camera straight back onto Yuvi between
            // these framings. Review captures survey the whole island; the rig only owns the in-game view.
            foreach (var rig in Object.FindObjectsByType<IsometricCameraRig>(FindObjectsSortMode.None))
                rig.enabled = false;

            // Whole-island survey (orthographic). The in-game camera is a zoomed follow rig that never shows
            // this much at once — this framing exists to review the layout, not to represent what a player sees.
            cam.orthographic = true; cam.orthographicSize = 30f;
            cam.transform.SetPositionAndRotation(new Vector3(-12f, 44f, -42f), Quaternion.Euler(47f, 0f, 0f));
            Capture(cam, $"{CaptureFolder}/00-Arrival-Section-View.png", 1500, 1040);

            // Cinematic beauty angle (perspective, three-quarter).
            cam.orthographic = false; cam.fieldOfView = 40f;
            cam.transform.SetPositionAndRotation(new Vector3(-44f, 22f, -34f), Quaternion.Euler(24f, 38f, 0f));
            Capture(cam, $"{CaptureFolder}/01-Arrival-Beauty.png", 1760, 1040);

            // Player-eye framing: the real isometric rig's yaw/pitch and zoom, parked over the fountain plaza.
            cam.orthographic = true; cam.orthographicSize = 11f;
            cam.transform.SetPositionAndRotation(
                new Vector3(-10f, 1.1f, -2f) - Quaternion.Euler(30f, 45f, 0f) * Vector3.forward * 40f,
                Quaternion.Euler(30f, 45f, 0f));
            Capture(cam, $"{CaptureFolder}/02-Arrival-Fountain.png", 1760, 1040);

            AssetDatabase.Refresh();
            Debug.Log("✅ Dressed Arrival captures saved.");
        }

        [MenuItem("Yuvi/World Art/Arrival/03 Rebuild and Capture")]
        public static void RebuildAndCapture() { BuildDressedArrival(); CaptureDressedArrival(); }

        private static void HideConnector(GameObject world, string connectorName) => HideByName(world, connectorName);

        private static void HideByName(GameObject world, string name)
        {
            foreach (var t in world.GetComponentsInChildren<Transform>(true))
            {
                if (t.name == name) { t.gameObject.SetActive(false); return; }
            }
        }

        // Large subdivided plane at the waterline running the Yuvi/Water shader (animated waves + foam).
        private static void BuildOceanPlane(Transform parent)
        {
            const float y = -1.5f, cell = 2f;
            const float xMin = -72f, xMax = 84f, zMin = -44f, zMax = 74f;
            var nx = Mathf.RoundToInt((xMax - xMin) / cell);
            var nz = Mathf.RoundToInt((zMax - zMin) / cell);
            var verts = new Vector3[(nx + 1) * (nz + 1)];
            var uvs = new Vector2[verts.Length];
            for (var iz = 0; iz <= nz; iz++)
                for (var ix = 0; ix <= nx; ix++)
                {
                    var idx = iz * (nx + 1) + ix;
                    verts[idx] = new Vector3(xMin + ix * cell, y, zMin + iz * cell);
                    uvs[idx] = new Vector2(ix / (float)nx, iz / (float)nz);
                }
            var tris = new int[nx * nz * 6];
            var t = 0;
            for (var iz = 0; iz < nz; iz++)
                for (var ix = 0; ix < nx; ix++)
                {
                    var a = iz * (nx + 1) + ix; var b = a + 1; var c = a + (nx + 1); var d = c + 1;
                    tris[t++] = a; tris[t++] = c; tris[t++] = b;
                    tris[t++] = b; tris[t++] = c; tris[t++] = d;
                }
            var mesh = new Mesh { name = "MESH_YW_Dressing_Ocean", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.vertices = verts; mesh.uv = uvs; mesh.triangles = tris;
            mesh.RecalculateNormals(); mesh.RecalculateBounds();

            var go = new GameObject("OceanWater");
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = GroundingAssetWriter.GetWaterMaterial("MAT_YW_Dressing_Ocean",
                new Color(0.05f, 0.30f, 0.40f), new Color(0.12f, 0.56f, 0.63f), new Color(0.86f, 0.97f, 0.99f),
                0.17f, 8.5f, 0.12f, 0f);   // cyan, not dark navy
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            go.AddComponent<WaterTimeDriver>(); // drives continuous wave/fountain animation (edit + play)
        }

        // Fills the carved stream channel so it reads as a shallow blue stream, not a deep grey gorge. Two
        // ribbons along the plaza-hole centreline:
        //   • an OPAQUE bed just under the surface, so the grey foundation stratum 1.5 below never shows through
        //     the translucent water (which was making the channel read as murky green);
        //   • the animated water sheet almost FLUSH with the grass (y≈0.05, rim is 0.2), so the stream is
        //     visible from the gameplay angle instead of hidden at the bottom of its own banks.
        // Both double-sided so they're never back-face culled from the play camera.
        private static void BuildRiverWater(Transform parent)
        {
            var bed = RiverRibbonMesh("MESH_YW_Dressing_RiverBed", 2.25f, -0.12f);
            var bedGo = new GameObject("RiverBed");
            bedGo.transform.SetParent(parent, false);
            bedGo.AddComponent<MeshFilter>().sharedMesh = bed;
            var bedMr = bedGo.AddComponent<MeshRenderer>();
            bedMr.sharedMaterial = GroundingAssetWriter.GetHardSurfaceMaterial(
                "MAT_YW_Dressing_RiverBed", new Color(0.08f, 0.36f, 0.44f), 0.35f, 0f);   // cyan bed
            bedMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

            var sheet = RiverRibbonMesh("MESH_YW_Dressing_River", 2.1f, 0.05f);
            var go = new GameObject("RiverWater");
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = sheet;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = GroundingAssetWriter.GetWaterMaterial("MAT_YW_Dressing_River",
                new Color(0.10f, 0.46f, 0.56f), new Color(0.30f, 0.70f, 0.74f), new Color(0.90f, 0.97f, 0.99f),
                0.05f, 4f, 0.14f, 0f);   // cyan stream
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            go.AddComponent<WaterTimeDriver>();
        }

        // A flat double-sided ribbon mesh of the given half-width at height y, following the river centreline.
        private static Mesh RiverRibbonMesh(string name, float half, float y)
        {
            var ctrl = ProductionGroundingWorldBuilder.ArrivalRiverCenter;
            const int subdiv = 8;
            var pts = new System.Collections.Generic.List<Vector2>();
            for (var i = 0; i < ctrl.Length - 1; i++)
                for (var s = 0; s < subdiv; s++)
                    pts.Add(Vector2.Lerp(ctrl[i], ctrl[i + 1], s / (float)subdiv));
            pts.Add(ctrl[ctrl.Length - 1]);

            var m = pts.Count;
            var verts = new Vector3[m * 2];
            var uvs = new Vector2[m * 2];
            var run = 0f;
            for (var i = 0; i < m; i++)
            {
                var tan = i == 0 ? pts[1] - pts[0] : i == m - 1 ? pts[m - 1] - pts[m - 2] : pts[i + 1] - pts[i - 1];
                tan = tan.sqrMagnitude > 1e-6f ? tan.normalized : Vector2.up;
                var nrm = new Vector2(-tan.y, tan.x);
                var l = pts[i] + nrm * half;
                var r = pts[i] - nrm * half;
                verts[i * 2] = new Vector3(l.x, y, l.y);
                verts[i * 2 + 1] = new Vector3(r.x, y, r.y);
                if (i > 0) run += (pts[i] - pts[i - 1]).magnitude;
                uvs[i * 2] = new Vector2(0f, run * 0.25f);
                uvs[i * 2 + 1] = new Vector2(1f, run * 0.25f);
            }
            var tris = new System.Collections.Generic.List<int>((m - 1) * 12);
            for (var i = 0; i < m - 1; i++)
            {
                int a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
                tris.AddRange(new[] { a, c, b, b, c, d });   // top face
                tris.AddRange(new[] { a, b, c, c, b, d });   // underside (double-sided)
            }
            var mesh = new Mesh { name = name };
            mesh.SetVertices(verts);
            mesh.SetUVs(0, new System.Collections.Generic.List<Vector2>(uvs));
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        // Places a clickable building and wires a ProximityPopAnimator with a floating marker + glow.
        private static void PlaceTaskBuilding(Transform obj, Transform parent, Vector3 pos, float yRot, float triggerRadius, string glowChildName, float scale = 1f, bool openInterior = false)
        {
            if (obj == null) return;
            obj.SetParent(parent, false);
            obj.SetPositionAndRotation(pos, Quaternion.Euler(0f, yRot, 0f));
            obj.localScale = Vector3.one * scale;

            if (openInterior)
            {
                // Enterable structure (the pavilion): per-piece MeshColliders instead of a blanket no-fly
                // column — its steps become walkable stairs, the columns are solid, the interior is open, and
                // the ceiling/roof block flying up through it. Landmark clicks still work (the pointer raycast
                // accepts child colliders).
                foreach (var mf in obj.GetComponentsInChildren<MeshFilter>())
                    if (mf.sharedMesh != null && mf.GetComponent<Collider>() == null)
                        mf.gameObject.AddComponent<MeshCollider>().sharedMesh = mf.sharedMesh;
            }
            else
            {
                AddHitbox(obj, 0.9f); // solid building the player can't walk through
            }

            // The building keeps a ProximityPopAnimator ONLY so the bridge still discovers it as a clickable
            // landmark slot — the proximity EFFECT is neutralised (no scale pop, no bob, no glow pulse, no
            // floating marker), so houses stay calm and static as the player walks past. glowChildName is now
            // unused but kept in the signature so call sites are unchanged.
            _ = glowChildName;
            var animator = obj.gameObject.AddComponent<ProximityPopAnimator>();
            animator.triggerRadius = triggerRadius;
            animator.demoMode = false;
            animator.popScale = 1f;    // no scale-up
            animator.bobHeight = 0f;   // no bob
            animator.marker = null;    // no floating marker
            animator.glowRenderer = null; // no glow pulse
        }

        private static void DecorateArrival(Transform root)
        {
            // --- Background mountain range, hugging the MEASURED back coast. ---
            // Every earlier pass hand-guessed the shoreline z, which either buried the peaks inland or left a
            // band of open water between them and the island. The coast is now sampled per column, so the range
            // follows whatever the authored polygon actually produces and a reshape cannot re-open that gap.
            Physics.SyncTransforms();
            const int mtnCount = 18;
            for (var i = 0; i < mtnCount; i++)
            {
                var x = Mathf.Lerp(-46f, 24f, i / (float)(mtnCount - 1));
                var shore = NorthShoreZ(x);
                var far = i % 2 == 0;
                // Near row stands just off the measured shore — close enough that its stone collar (radius ~5)
                // still reaches back over the strip of water to the beach, far enough that the collar does not
                // climb inland across the village. The far row fills the skyline gaps behind it. Columns that
                // miss the island fall back to its northern extent so the range still closes the horizon.
                var z = (float.IsNaN(shore) ? 12f : shore) + (far ? 7.5f : 3.5f) + Jit(i * 5 + 1) * 0.8f;
                var scale = (far ? 1.1f : 0.9f) + 0.2f * Mathf.Abs(Jit(i * 3 + 2));
                Place(GroundingDecorationBuilder.CreateMountain($"Mountain-{i}", scale, i * 17 + 3), root, V(x, -2f, z), Jit(i) * 90f, 1f);
            }

            // Animated stream filling the carved channel (banks come from the plaza hole; see the grounding).
            BuildRiverWater(root);

            // A shy river creature ("Nessie") that surfaces now and then in the stream WELL SOUTH of the bridge
            // (deck spans z −2.5…0.5): at (1,−5) facing north, its whole body — head, neck and rearward humps —
            // stays south of z≈−3.9, so nothing pokes through the bridge deck when it rises. RiverSerpent
            // (runtime) sinks it below the water and raises it on a cycle.
            var serpent = GroundingDecorationBuilder.CreateRiverSerpent("RiverSerpent");
            serpent.SetParent(root, false);
            serpent.SetPositionAndRotation(new Vector3(1f, 0.1f, -5f), Quaternion.Euler(0f, 0f, 0f));
            serpent.gameObject.AddComponent<Yuvi720.LearningWorld.World.RiverSerpent>();

            // ══ DISTRICT LAYOUT ══ The enlarged island is organised into places, not an even scatter:
            //   • BLUFF (north)      — the welcome pavilion + a quiet garden, raised over the plaza.
            //   • WEST VILLAGE       — a cluster of homes around a little square.
            //   • CENTRAL PLAZA      — the fountain social heart, west of the stream.
            //   • STREAM + BRIDGE    — winds north→south; the plank bridge is the one crossing.
            //   • EAST MARKET        — the trade corner across the bridge, by the archive path out.
            // Task buildings are placed BLUFF→WEST→CENTRAL→EAST so the landmark slots the bridge collects read
            // in journey order.

            // ── Bluff: hero pavilion + garden ──
            PlaceTaskBuilding(GroundingDecorationBuilder.CreatePavilion("Pavilion"), root, new Vector3(-4f, Bluff, 18f), 20f, 5.2f, "Finial", 1.05f, openInterior: true);
            var bluffPines = new[]
            {
                V(-12f, Bluff, 15f), V(-13f, Bluff, 19f), V(-9f, Bluff, 21.5f),
                V(2f, Bluff, 15f), V(4f, Bluff, 19f), V(0.5f, Bluff, 21.5f)
            };
            for (var i = 0; i < bluffPines.Length; i++)
                Place(GroundingDecorationBuilder.CreateConifer($"Pine-Bluff-{i}", 0.98f + 0.12f * Jit(i), i * 5 + 9), root, bluffPines[i], Jit(i) * 180f, 1f, collide: 2);
            Place(GroundingDecorationBuilder.CreateBench("Bench-Bluff"), root, new Vector3(-7f, Bluff, 14.5f), 200f, 1f, collide: 1);

            // ── West village: homes around an OPEN little square — no house in the middle, and the two
            //    front (inward-facing) homes pushed back so the square breathes toward the plaza. ──
            PlaceTaskBuilding(GroundingDecorationBuilder.CreateHouse("House-Farm", 1.05f, 4, 2), root, new Vector3(-34f, Plaza, 4f), 95f, 4f, "Windows", HS);
            PlaceTaskBuilding(GroundingDecorationBuilder.CreateHouse("House-Cottage", 1.1f, 1, 0), root, new Vector3(-27f, Plaza, 10f), 165f, 4f, "Windows", HS);
            PlaceTaskBuilding(GroundingDecorationBuilder.CreateHouse("House-Hut", 1.0f, 3, 3), root, new Vector3(-22.5f, Plaza, -15.5f), 40f, 3.5f, "Windows", HS);
            // Turned to FACE the fountain (door faces local +Z, so yaw == world facing angle; 68° aims the
            // door at the plaza centre from here).
            Place(GroundingDecorationBuilder.CreateHouse("House-Demo-C", 0.98f, 5, 1), root, new Vector3(-33f, Plaza, -9f), 68f, HS, collide: 1);
            // Lamp + rock as western-edge dressing, out past the pushed-back houses.
            Place(GroundingDecorationBuilder.CreateLamp("Lamp-Village"), root, new Vector3(-38f, Plaza, 1f), 0f, 1f, collide: 1);
            Place(GroundingDecorationBuilder.CreateRock("Rock-Village", 0.9f, 21), root, new Vector3(-38f, Plaza, 7f), 40f, 1f, collide: 1);

            // ── Central plaza: fountain heart, west of the stream ──
            var fc = new Vector3(-13f, Plaza, -1f);
            Place(GroundingDecorationBuilder.CreateFountain("Fountain"), root, fc, 0f, 1f, collide: 1);
            Place(GroundingDecorationBuilder.CreatePathRing("Path-Plaza", 5f, 7.5f, 64), root, fc + new Vector3(0f, 0.03f, 0f), 0f, 1f);
            // Townhouse sits WEST of the pavilion's sightline (it used to hide the bluff pavilion from the
            // front camera at x≈-6).
            PlaceTaskBuilding(GroundingDecorationBuilder.CreateHouse("House-Townhouse", 1.0f, 2, 1), root, new Vector3(-12f, Plaza, 11f), 205f, 4f, "Windows", HS);

            // ── Path spurs: straight sand paths running from the west-village and south homes to the plaza
            //    ring, so the circle reads as the hub of a real path network. Each spur starts just clear of
            //    its house footprint and stops at the ring's outer edge (strips sit 5mm under the ring so the
            //    ring wins where they meet). ──
            var spurCenters = new System.Collections.Generic.List<System.Collections.Generic.List<Vector3>>();
            void PathSpur(string pname, Vector3 housePos, float clear)
            {
                var flat = new Vector3(housePos.x, 0f, housePos.z);
                var c = new Vector3(fc.x, 0f, fc.z);
                var dir = (c - flat).normalized;
                var a = flat + dir * clear;
                var b = c - dir * 7.4f;                                   // stop at the plaza ring's outer edge
                var center = GroundingDecorationBuilder.WindingCenter(a, b, 1.5f, 1.5f, 18); // gentle snaking S
                spurCenters.Add(center);                                  // remembered for the keep-off-path test
                Place(GroundingDecorationBuilder.CreatePathRibbon(pname, center, 0.9f, true), root, new Vector3(0f, Plaza + 0.025f, 0f), 0f, 1f);
            }
            PathSpur("Path-Spur-Farm", new Vector3(-34f, 0f, 4f), 4.5f);
            PathSpur("Path-Spur-DemoC", new Vector3(-33f, 0f, -9f), 4.5f);
            PathSpur("Path-Spur-Cottage", new Vector3(-27f, 0f, 10f), 4.2f);
            PathSpur("Path-Spur-Hut", new Vector3(-22.5f, 0f, -15.5f), 4.2f);
            // (Path-Spur-DemoB removed — its house sits so close to the plaza the spur was a tiny nub by spawn.)
            PathSpur("Path-Spur-DemoE", new Vector3(-1f, 0f, -14f), 4.2f);
            // Benches ring the plaza on the GRASS just outside the path (radius 9.2 > outer path edge ~7.84),
            // facing the fountain — previously W (r7.5) and E (r6.5) sat on the ring itself.
            // NE bench hugs the circle tangentially just outside the frame (r≈8.3), facing the fountain.
            Place(GroundingDecorationBuilder.CreateBench("Bench-NE"), root, fc + V(7.2f, 0f, 4.15f), 240f, 1f, collide: 1);
            Place(GroundingDecorationBuilder.CreateBench("Bench-S"), root, fc + V(0f, 0f, -9.2f), 0f, 1f, collide: 1);
            Place(GroundingDecorationBuilder.CreateBench("Bench-W"), root, fc + V(-9.2f, 0f, 0f), 90f, 1f, collide: 1);
            // (Bench-E removed — it crowded the bridge's west approach.)
            Place(GroundingDecorationBuilder.CreateLamp("Lamp-NW"), root, fc + V(-4.6f, 0f, 5.4f), 0f, 1f, collide: 1);
            Place(GroundingDecorationBuilder.CreateLamp("Lamp-NE"), root, fc + V(4.4f, 0f, 5.4f), 0f, 1f, collide: 1);
            Place(GroundingDecorationBuilder.CreateLamp("Lamp-SW"), root, fc + V(-4.6f, 0f, -5.4f), 0f, 1f, collide: 1);

            // ── Bridge approach: lamps flanking the west end of the crossing (bridge spans x −1…7 at z −1) ──
            Place(GroundingDecorationBuilder.CreateLamp("Lamp-BridgeW"), root, new Vector3(-2.5f, Plaza, -3.5f), 0f, 1f, collide: 1);

            // ── East market: trade corner across the bridge. Kept sparse (the east strip is narrow): the cart,
            //    ONE house, and stall dressing, spaced well apart so the cart and house no longer crowd. ──
            PlaceTaskBuilding(GroundingDecorationBuilder.CreateKiosk("Kiosk"), root, new Vector3(12f, Plaza, -5f), 195f, 3.0f, "AwningB");
            Place(GroundingDecorationBuilder.CreateSignpost("Signpost-Shop"), root, new Vector3(9f, Plaza, -7f), 150f, 1f, collide: 1);
            // Balloon bunch: the knot sits ON the cart's awning corner (kiosk at (12,-5) yaw 195 → that local
            // corner lands at world ≈ (11.0, 2.40, -5.6), the awning's top surface) so the strings read as
            // tied to the cart. BalloonSway must be attached AFTER placement — it captures its pose on enable.
            var balloons = GroundingDecorationBuilder.CreateBalloonBunch("Balloons");
            balloons.SetParent(root, false);
            balloons.SetPositionAndRotation(new Vector3(11.0f, 2.4f, -5.6f), Quaternion.identity);
            balloons.gameObject.AddComponent<Yuvi720.LearningWorld.World.BalloonSway>();
            Place(GroundingDecorationBuilder.CreateHouse("House-Demo-A", 0.92f, 7, 3), root, new Vector3(11f, Plaza, 5f), 250f, HS, collide: 1);
            Place(GroundingDecorationBuilder.CreateLamp("Lamp-BridgeE"), root, new Vector3(8.5f, Plaza, -3.5f), 0f, 1f, collide: 1);
            // Two more homes along the south, between the plaza and the coast (clear of the stream), so the
            // east house count coming off the bridge stays uncramped.
            Place(GroundingDecorationBuilder.CreateHouse("House-Demo-B", 0.95f, 12, 0), root, new Vector3(-9f, Plaza, -14f), 320f, HS, collide: 1);
            Place(GroundingDecorationBuilder.CreateHouse("House-Demo-E", 0.94f, 2, 3), root, new Vector3(-1f, Plaza, -14f), 317f, HS, collide: 1);

            // Keep dressing OFF the cobble paths: any prop that would land on the plaza ring or a winding spur
            // gets nudged to the nearest clear grass. Flowers additionally keep a little distance from benches.
            var benchPositions = new[]
            {
                new Vector2(fc.x + 7.2f, fc.z + 4.15f),   // NE
                new Vector2(fc.x, fc.z - 9.2f),           // S
                new Vector2(fc.x - 9.2f, fc.z),           // W
            };
            bool OnPath(float x, float z)
            {
                var dc = Mathf.Sqrt((x - fc.x) * (x - fc.x) + (z - fc.z) * (z - fc.z));
                if (dc >= 4.6f && dc <= 7.9f) return true;                  // plaza ring surface + stone kerb
                foreach (var cline in spurCenters)
                    for (var i = 0; i < cline.Count - 1; i++)
                    {
                        var p0 = cline[i]; var p1 = cline[i + 1];
                        var bx = p1.x - p0.x; var bz = p1.z - p0.z;
                        var len2 = bx * bx + bz * bz;
                        var t = len2 > 1e-5f ? Mathf.Clamp01(((x - p0.x) * bx + (z - p0.z) * bz) / len2) : 0f;
                        var dx = x - (p0.x + bx * t); var dz = z - (p0.z + bz * t);
                        if (dx * dx + dz * dz < 1.35f * 1.35f) return true; // spur half-width 0.9 + kerb + margin
                    }
                return false;
            }
            Vector3 NudgeClear(Vector3 pos, bool avoidBench)
            {
                bool Bad(float x, float z)
                {
                    if (OnPath(x, z)) return true;
                    if (avoidBench)
                        foreach (var bp in benchPositions)
                            if ((x - bp.x) * (x - bp.x) + (z - bp.y) * (z - bp.y) < 2.6f * 2.6f) return true;
                    return false;
                }
                if (!Bad(pos.x, pos.z)) return pos;
                var outDir = new Vector2(pos.x - fc.x, pos.z - fc.z);
                outDir = outDir.sqrMagnitude > 1e-4f ? outDir.normalized : Vector2.right;
                for (var step = 1f; step <= 7f; step += 0.5f)
                    foreach (var s in new[] { 1f, -1f })   // try nudging outward from the fountain, then inward
                    {
                        var nx = pos.x + outDir.x * step * s;
                        var nz = pos.z + outDir.y * step * s;
                        if (!Bad(nx, nz) && LandAt(nx, nz, out _)) return new Vector3(nx, pos.y, nz);
                    }
                return pos;
            }

            // ── Trees around the rim + between districts (clear of footprints, the stream, and the paths) ──
            var ringPines = new[]
            {
                V(-38f, Plaza, -7f), V(-31f, Plaza, -14f), V(-15f, Plaza, -17f),
                V(-2f, Plaza, -17f), V(13.5f, Plaza, -4f), V(13.5f, Plaza, 7f), V(-38f, Plaza, 8f)
            };
            for (var i = 0; i < ringPines.Length; i++)
                Place(GroundingDecorationBuilder.CreateConifer($"Pine-Ring-{i}", 0.9f + 0.16f * Jit(i), i * 3), root, NudgeClear(ringPines[i], false), Jit(i) * 180f, 1f, collide: 2);
            var ringTrees = new[] { V(-20f, Plaza, 6f), V(-24f, Plaza, -8f), V(-40f, Plaza, 0f), V(6f, Plaza, 9f) };
            for (var i = 0; i < ringTrees.Length; i++)
                Place(GroundingDecorationBuilder.CreateTree($"Tree-Ring-{i}", 0.7f + 0.16f * Jit(i), i * 7 + 4), root, NudgeClear(ringTrees[i], false), Jit(i) * 180f, 1f, collide: 2);

            // ── Rocks: a few along the stream banks + scattered accents (kept off the channel and the paths) ──
            var rocks = new[] { V(-1.5f, Plaza, 5f), V(8f, Plaza, 4f), V(-2f, Plaza, -8f), V(8f, Plaza, -11f), V(-18f, Plaza, 4f) };
            var rockScale = new[] { 0.8f, 0.75f, 0.85f, 0.8f, 0.9f };
            for (var i = 0; i < rocks.Length; i++)
                Place(GroundingDecorationBuilder.CreateRock($"Rock-{i}", rockScale[i], i * 6 + 3), root, NudgeClear(rocks[i], false), Jit(i) * 360f, 1f, collide: 1);

            // ── Flower clusters: a ring around the fountain + accents by the stream and bluff ──
            var flowers = new Vector3[10];
            for (var i = 0; i < 7; i++)
            {
                var a = (i / 7f) * Mathf.PI * 2f + 0.4f;
                flowers[i] = V(fc.x + Mathf.Cos(a) * 9f, Plaza, fc.z + Mathf.Sin(a) * 9f);
            }
            flowers[7] = V(-4f, Bluff, 15f);
            flowers[8] = V(-1.5f, Plaza, 1f);   // stream bank
            flowers[9] = V(8f, Plaza, -1f);     // stream bank, market side
            for (var i = 0; i < flowers.Length; i++)
                Place(GroundingDecorationBuilder.CreateFlowerCluster($"Flowers-{i}", i * 9 + 1), root, NudgeClear(flowers[i], true), Jit(i) * 360f, 1f);

            // Grass scattered across the whole island — the golden-angle spiral overshoots the coast and the
            // carved stream, so each tuft is only kept where there is actually dry land under it.
            for (var i = 0; i < 110; i++)
            {
                var ang = i * 2.399963f; // golden-angle scatter
                var rad = 6.8f + (i % 10) * 2.7f;
                var p = V(-12f + Mathf.Cos(ang) * rad * 1.7f, Plaza, -2f + Mathf.Sin(ang) * rad * 1.05f);
                if (!LandAt(p.x, p.z, out var groundY) || groundY < Plaza - 0.2f) continue;
                if (OnPath(p.x, p.z)) continue;   // keep the cobble paths clear of scattered grass tufts
                Place(GroundingDecorationBuilder.CreateGrassTuft($"Grass-{i}", 0.85f + 0.4f * Jit(i), i * 11 + 2), root, p, Jit(i) * 360f, 1f);
            }

            // --- Atmosphere: a few faint high clouds for a clean sky (mountains carry the backdrop). ---
            var clouds = new[] { V(-30, 15, 26), V(-8, 16, 28), V(8, 14, 24) };
            for (var i = 0; i < clouds.Length; i++)
                Place(GroundingDecorationBuilder.CreateBush($"Cloud-{i}", 3.0f + Jit(i), i * 13), root, clouds[i], Jit(i) * 360f, 1f, cloud: true);

            // Cloud bank standing on the path that connects this section to the next, just past the island's
            // east coast — dense enough to actually hide the crossing rather than veil it. In the streamed
            // world it fades on completion and the next section streams in behind it.
            var curtainGo = new GameObject("CloudCurtain-East");
            curtainGo.transform.SetParent(root, false);
            curtainGo.transform.SetPositionAndRotation(new Vector3(20f, Plaza - 1f, 0f), Quaternion.Euler(0f, -90f, 0f));
            var curtain = curtainGo.AddComponent<CloudCurtain>();
            curtain.width = 52f; curtain.height = 18f; curtain.columns = 15; curtain.rows = 6; curtain.puffSize = 4.2f;
            curtain.cloudColor = new Color(0.93f, 0.94f, 0.97f, 0.72f);
            curtain.revealsSectionId = "archive";

            // Invisible perimeter wall so Yuvi can't fly out over the open water — it rings the island and
            // rises high above the bluff, blocking horizontal escape while still letting him fly up in place.
            BuildWaterBarrier(root);

            // Precise fall-guards along the actual coast edges (the ring above sits ~1.4 out, leaving a
            // walkable sea-floor moat you could drop into).
            BuildCoastGuard(root);

            // Invisible walls along both banks of the stream so the CharacterController can't walk (or be
            // nudged) into the channel — with a gap at the bridge so the crossing stays passable.
            BuildRiverBarrier(root);
        }

        // A tall, invisible wall collider that follows the REAL coastline. No renderer, so it's unseen; the
        // CharacterController collides with it and is kept over land.
        //
        // It samples the terrain rather than using a fixed ring: a fixed radius either cut the land off or —
        // as before — sat well outside the shore, leaving a band of open sea Yuvi could fly out over.
        private static void BuildWaterBarrier(Transform parent)
        {
            const int seg = 96;
            const float yBot = -2f, yTop = 60f, margin = 1.4f;
            var center = new Vector3(-12f, 0f, 0f);

            Physics.SyncTransforms();
            var radii = new float[seg];
            for (var i = 0; i < seg; i++)
            {
                var a = i / (float)seg * Mathf.PI * 2f;
                var dir = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a));
                var last = 6f;
                // Stop well short of the eastward-placed court (x≈52, r≈64 from here): it is land too, and
                // probing that far would stretch the barrier across the open sea between the sections.
                for (var r = 6f; r <= 40f; r += 0.5f)
                {
                    var p = center + dir * r;
                    if (LandAt(p.x, p.z, out _)) last = r;
                }
                radii[i] = last + margin;
            }

            var verts = new Vector3[(seg + 1) * 2];
            for (var i = 0; i <= seg; i++)
            {
                var a = i / (float)seg * Mathf.PI * 2f;
                var dir = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a)) * radii[i % seg];
                verts[i * 2] = center + dir + Vector3.up * yBot;
                verts[i * 2 + 1] = center + dir + Vector3.up * yTop;
            }
            var tris = new int[seg * 12]; // double-sided so it blocks from inside the ring
            var t = 0;
            for (var i = 0; i < seg; i++)
            {
                int a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
                tris[t++] = a; tris[t++] = c; tris[t++] = b; tris[t++] = b; tris[t++] = c; tris[t++] = d;
                tris[t++] = a; tris[t++] = b; tris[t++] = c; tris[t++] = c; tris[t++] = b; tris[t++] = d;
            }
            var mesh = new Mesh { name = "MESH_YW_WaterBarrier" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            var go = new GameObject("WaterBarrier");
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshCollider>().sharedMesh = mesh; // no MeshRenderer → invisible
        }

        // Invisible collider walls running down both banks of the stream, from just below grass up to head
        // height, so Yuvi is stopped at the water's edge instead of walking into the channel. A gap is left
        // around the bridge (z≈-1) so the crossing stays open. No renderer → unseen.
        private static void BuildRiverBarrier(Transform parent)
        {
            var ctrl = ProductionGroundingWorldBuilder.ArrivalRiverCenter;
            const int subdiv = 12;   // fine segments so the bridge opening hugs the deck exactly
            var pts = new System.Collections.Generic.List<Vector2>();
            for (var i = 0; i < ctrl.Length - 1; i++)
                for (var s = 0; s < subdiv; s++)
                    pts.Add(Vector2.Lerp(ctrl[i], ctrl[i + 1], s / (float)subdiv));
            pts.Add(ctrl[ctrl.Length - 1]);

            const float bankHalf = 2.4f, yBot = 0.1f, yTop = 3.0f;
            // Opening only as wide as the bridge DECK itself (deck is 3 wide centred on z=-1 → z −2.5…0.5;
            // a hair narrower so there is no walkable sliver beside the deck to slip into the channel).
            const float bridgeZMin = -2.4f, bridgeZMax = 0.4f;
            var verts = new System.Collections.Generic.List<Vector3>();
            var tris = new System.Collections.Generic.List<int>();

            void Wall(Vector2 a, Vector2 b)
            {
                var o = verts.Count;
                verts.Add(new Vector3(a.x, yBot, a.y)); verts.Add(new Vector3(b.x, yBot, b.y));
                verts.Add(new Vector3(b.x, yTop, b.y)); verts.Add(new Vector3(a.x, yTop, a.y));
                // both windings → the MeshCollider blocks from either side
                tris.AddRange(new[] { o, o + 2, o + 1, o, o + 3, o + 2, o, o + 1, o + 2, o, o + 2, o + 3 });
            }

            // The deck opening must be judged on each OFFSET wall segment, not the centre line: offsetting
            // ±bankHalf on this diagonal river shifts a wall's z by ~1 unit, so a centre-line test leaves a
            // walkable diagonal sliver beside the deck on one bank.
            bool InDeckGap(Vector2 a, Vector2 b)
            {
                var mz = (a.y + b.y) * 0.5f;
                return mz > bridgeZMin && mz < bridgeZMax;
            }
            var hasPrevNrm = false;
            var prevNrm = Vector2.zero;
            for (var i = 0; i < pts.Count - 1; i++)
            {
                var tan = (pts[i + 1] - pts[i]);
                tan = tan.sqrMagnitude > 1e-6f ? tan.normalized : Vector2.up;
                var nrm = new Vector2(-tan.y, tan.x) * bankHalf;
                // STITCH the bends: at a control-point corner the tangent turns, so adjacent offset walls
                // don't meet on the outside of the bend — a V-shaped walk-through gap. Bridge the endpoints.
                if (hasPrevNrm && (prevNrm - nrm).sqrMagnitude > 1e-4f)
                {
                    Wall(pts[i] + prevNrm, pts[i] + nrm);
                    Wall(pts[i] - prevNrm, pts[i] - nrm);
                }
                var l0 = pts[i] + nrm; var l1 = pts[i + 1] + nrm;
                var r0 = pts[i] - nrm; var r1 = pts[i + 1] - nrm;
                if (!InDeckGap(l0, l1)) Wall(l0, l1);   // left bank
                if (!InDeckGap(r0, r1)) Wall(r0, r1);   // right bank
                prevNrm = nrm; hasPrevNrm = true;
            }

            // CAP the channel at both ends — the bank walls stop at the control-line ends, which left the
            // channel mouths walkable (you could step around the last wall and drop into the water there).
            void Cap(Vector2 end, Vector2 tanDir)
            {
                var nrm = new Vector2(-tanDir.y, tanDir.x) * bankHalf;
                Wall(end + nrm, end - nrm);
            }
            Cap(ctrl[0], (ctrl[1] - ctrl[0]).normalized);
            Cap(ctrl[ctrl.Length - 1], (ctrl[ctrl.Length - 1] - ctrl[ctrl.Length - 2]).normalized);

            var mesh = new Mesh { name = "MESH_YW_RiverBarrier" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            var go = new GameObject("RiverBarrier");
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshCollider>().sharedMesh = mesh;   // no MeshRenderer → invisible
        }

        // Invisible walls following the island's REAL coast outlines (the authored polygons, softened the
        // same way the meshes are), so the player can never step/fly off the walkable land and drop onto the
        // sea floor between the coast and the outer WaterBarrier ring (the "walking among the mountains" bug).
        // Plaza ring: walled in full — nothing walkable lies outside it (the east crossing to the next section
        // is curtained; open a gap here when that crossing becomes playable). Bluff ring: only its sea-facing
        // edges are walled, so flying up onto the bluff from the plaza side stays possible.
        private static void BuildCoastGuard(Transform parent)
        {
            var verts = new System.Collections.Generic.List<Vector3>();
            var tris = new System.Collections.Generic.List<int>();
            void Wall(Vector2 a, Vector2 b, float yBot, float yTop)
            {
                var o = verts.Count;
                verts.Add(new Vector3(a.x, yBot, a.y)); verts.Add(new Vector3(b.x, yBot, b.y));
                verts.Add(new Vector3(b.x, yTop, b.y)); verts.Add(new Vector3(a.x, yTop, a.y));
                tris.AddRange(new[] { o, o + 2, o + 1, o, o + 3, o + 2, o, o + 1, o + 2, o, o + 2, o + 3 });
            }

            Physics.SyncTransforms();
            // Wall a ring segment only when one of its sides is open water. This matters twice over: the
            // PLAZA's north coast runs UNDER the bluff (walling it in full would slice the bluff in half and
            // block flying up onto it), and the BLUFF's south edges face the plaza and must stay open.
            void WallCoastEdges(Vector2[] ring, float yBot)
            {
                for (var i = 0; i < ring.Length; i++)
                {
                    var a = ring[i]; var b = ring[(i + 1) % ring.Length];
                    var mid = (a + b) * 0.5f;
                    var tan = (b - a).normalized;
                    var nrm = new Vector2(-tan.y, tan.x);
                    // A side counts as land only if BOTH a near and a far sample land — a single far sample
                    // can overshoot a narrow sea sliver (e.g. between the plaza's NE coast and the bluff's
                    // east edge) and wrongly leave that edge open.
                    bool Solid(float side) =>
                        LandAt(mid.x + nrm.x * 0.9f * side, mid.y + nrm.y * 0.9f * side, out _) &&
                        LandAt(mid.x + nrm.x * 1.8f * side, mid.y + nrm.y * 1.8f * side, out _);
                    if (!Solid(1f) || !Solid(-1f)) Wall(a, b, yBot, 60f);
                }
            }
            WallCoastEdges(ProductionGroundingWorldBuilder.RoundedRing(ProductionGroundingWorldBuilder.ArrivalPlazaOuter), -1f);
            WallCoastEdges(ProductionGroundingWorldBuilder.RoundedRing(ProductionGroundingWorldBuilder.ArrivalBluffOuter), 1.6f);

            var mesh = new Mesh { name = "MESH_YW_CoastGuard" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            var go = new GameObject("CoastGuard");
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshCollider>().sharedMesh = mesh;   // no MeshRenderer → invisible
        }

        private static Vector3 V(float x, float y, float z) => new(x, y, z);
        private static float Jit(int i) { var v = Mathf.Sin(i * 12.9898f) * 43758.5453f; return (v - Mathf.Floor(v)) * 2f - 1f; }

        /// <summary>
        /// True when this column has walkable, above-water terrain, reporting its height in
        /// <paramref name="groundY"/>. Callers place against the island's real shape instead of hand-guessed
        /// coordinates, so reshaping the authored polygon moves the dressing with it.
        ///
        /// Two things must NOT read as land: landmark no-fly columns (they would extend the shore out to a
        /// building's collider) and the continuous mainland stratum, which is a band like any other but sits
        /// at/below the -1.5 waterline and runs unbroken to the far sections.
        ///
        /// This must consider EVERY hit in the column, not just the nearest. The plaza sits under a section
        /// CoverageVolume box at y≈8 and under 160-unit no-fly columns, so a plain Physics.Raycast returns one
        /// of those and the terrain below is never seen — which is what silently shrank the water barrier to
        /// the bluff and left the mountain range stranded inland on its fallback z.
        /// </summary>
        private static bool LandAt(float x, float z, out float groundY)
        {
            groundY = float.NegativeInfinity;
            foreach (var hit in Physics.RaycastAll(new Vector3(x, 300f, z), Vector3.down, 400f))
            {
                if (!hit.collider.gameObject.name.StartsWith("Band-")) continue;
                if (hit.point.y < -1.2f) continue; // submerged foundation shelf, not shore
                if (hit.point.y > groundY) groundY = hit.point.y;
            }
            if (float.IsNegativeInfinity(groundY)) { groundY = 0f; return false; }
            return true;
        }

        /// <summary>Northernmost z at this x that still has dry land under it, or NaN where the column misses
        /// the island entirely.</summary>
        private static float NorthShoreZ(float x)
        {
            var shore = float.NaN;
            for (var z = -24f; z <= 34f; z += 0.5f)
                if (LandAt(x, z, out _)) shore = z;
            return shore;
        }

        // Replaces the flat theme-green grass on the walkable island tops with the painterly ground material
        // (see GroundColorTexture): grass in several tones plus dry ochre and bare-earth patches, sampled by
        // world-XZ so it reads as one continuous painted field. Only the plaza and the bluff (the grass the
        // player sees) are swapped; the sunken basin keeps its own bed colour.
        private static readonly string[] GrassBands =
        {
            "Band-broad-valley-plaza-Top", "Band-broad-valley-plaza-Lip",
            "Band-rear-overlook-bluff-Top", "Band-rear-overlook-bluff-Lip",
        };
        // The island rim + bluff cliffs — recoloured to a dark-brown timber embankment (the "ramp"/edge the
        // player asked to be wood, not flat tan). The mesh's built-in horizontal AO strata read as stacked boards.
        private static readonly string[] CliffBands =
        {
            "Band-broad-valley-plaza-Boundary", "Band-rear-overlook-bluff-Boundary",
        };

        private static void RetextureArrivalGround(GameObject world)
        {
            // Grass is left as the grounding theme's flat green (grayscale blade detail tinted green) — the
            // original look, no painterly world-XZ repaint (which is what caused the colour "split"). Only the
            // island rim/bluff cliffs are re-skinned to dark timber.
            var wood = GetArrivalCliffMaterial();
            int c = 0;
            foreach (var mr in world.GetComponentsInChildren<MeshRenderer>(true))
            {
                var n = mr.gameObject.name;
                if (System.Array.IndexOf(CliffBands, n) >= 0) { mr.sharedMaterial = wood; c++; }
            }
            Debug.Log($"Arrival ground: grass kept flat theme-green; {c} cliffs → dark timber.");
        }

        // Dark-brown timber via the vendored TRIPLANAR shader: planks project onto the vertical cliff faces
        // correctly instead of the world-XZ smear, so the island rim reads as a solid wooden embankment.
        private static Material GetArrivalCliffMaterial() => GroundingTextureFactory.WoodTriplanar(new Color(0.42f, 0.29f, 0.17f));

        private static Material GetArrivalGroundMaterial()
        {
            var path = $"{GroundingAssetWriter.MaterialFolder}/MAT_YW_Arrival_Ground.mat";
            var shader = Shader.Find("Yuvi/StylizedGround") ?? Shader.Find("Standard");
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                GroundingAssetWriter.EnsureOutputFolders();
                mat = new Material(shader) { name = "MAT_YW_Arrival_Ground" };
                AssetDatabase.CreateAsset(mat, path);
            }
            if (mat.shader != shader) mat.shader = shader;
            // _Color white so the baked colour in the texture shows through; keep vertex-AO shading.
            mat.color = Color.white;
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", Color.white);
            mat.SetTexture("_MainTex", GroundingTextureFactory.GroundColorTexture());
            // 0.015 → ~66 world units per copy, so the ~56-unit island samples under a single copy: painterly
            // regions, no visible tiling.
            if (mat.HasProperty("_MainTexScale")) mat.SetFloat("_MainTexScale", 0.015f);
            if (mat.HasProperty("_WrapAmount")) mat.SetFloat("_WrapAmount", 0.58f);
            if (mat.HasProperty("_AmbientBoost")) mat.SetFloat("_AmbientBoost", 0.12f);
            if (mat.HasProperty("_VColorStrength")) mat.SetFloat("_VColorStrength", 1f);
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", 0.08f);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        // Adds MeshColliders to the grounding terrain (tops + cliffs) so the player has solid ground to
        // walk on and cliff walls that block him — reaching the raised bluff then requires flying.
        private static void AddTerrainColliders(GameObject world)
        {
            foreach (var mf in world.GetComponentsInChildren<MeshFilter>(true))
            {
                if (!mf.gameObject.activeInHierarchy || mf.sharedMesh == null) continue;
                if (mf.name.Contains("Water") || mf.GetComponent<Collider>() != null) continue;
                mf.gameObject.AddComponent<MeshCollider>().sharedMesh = mf.sharedMesh;
            }
        }

        // Replace the river bridge's climbable rail collider with flat vertical walls at the deck edges, so the
        // player is stopped clean at the sides (like an invisible wall) instead of clambering up the posts.
        private static void FixBridgeRailings(GameObject world)
        {
            Transform body = null, trim = null;
            foreach (var t in world.GetComponentsInChildren<Transform>(true))
            {
                if (t.parent == null || t.parent.name != "Transition-river-crossing") continue;
                if (t.name == "Bridge-Body") body = t;
                else if (t.name == "Bridge-Trim") trim = t;
            }
            if (body == null) return;

            // Drop the rail mesh's collider — visual only from here on.
            if (trim != null)
            {
                var mc = trim.GetComponent<MeshCollider>();
                if (mc != null) Object.DestroyImmediate(mc);
            }

            // Deck footprint (arch included) → thin vertical wall along each long edge, tall enough that the
            // controller can never step over, deep enough below the deck that there is no ledge to climb.
            var rends = body.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return;
            var b = rends[0].bounds;
            for (var i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            var yBot = b.min.y - 0.4f;
            var yTop = b.max.y + 1.6f;
            var walls = new GameObject("BridgeRailWalls").transform;
            walls.SetParent(world.transform, false);
            void Rail(float z)
            {
                var go = new GameObject("Rail");
                go.transform.SetParent(walls, false);
                var bc = go.AddComponent<BoxCollider>();
                bc.center = new Vector3((b.min.x + b.max.x) * 0.5f, (yBot + yTop) * 0.5f, z);
                bc.size = new Vector3(b.size.x, yTop - yBot, 0.12f);
            }
            Rail(b.min.z);
            Rail(b.max.z);
        }

        private static bool LocalBounds(Transform obj, out Bounds b)
        {
            b = default; var has = false;
            foreach (var mf in obj.GetComponentsInChildren<MeshFilter>())
            {
                if (mf.sharedMesh == null) continue;
                if (!has) { b = mf.sharedMesh.bounds; has = true; } else b.Encapsulate(mf.sharedMesh.bounds);
            }
            return has;
        }

        // Landmarks block their whole footprint as a full-height column, not just a building-height box —
        // otherwise Yuvi simply flies over a house/the fountain and stands on the roof. The column is
        // invisible (collider only) and reaches far above any reachable fly height.
        private const float NoFlyColumnHeight = 160f;

        private static void AddHitbox(Transform obj, float xzShrink)
        {
            if (!LocalBounds(obj, out var b)) return;
            var bc = obj.gameObject.AddComponent<BoxCollider>();
            var baseY = b.center.y - b.size.y * 0.5f;
            bc.center = new Vector3(b.center.x, baseY + NoFlyColumnHeight * 0.5f, b.center.z);
            bc.size = new Vector3(Mathf.Max(0.1f, b.size.x * xzShrink), NoFlyColumnHeight, Mathf.Max(0.1f, b.size.z * xzShrink));
        }

        private static void AddCapsuleHitbox(Transform obj, float radius)
        {
            if (!LocalBounds(obj, out var b)) return;
            var cap = obj.gameObject.AddComponent<CapsuleCollider>();
            cap.direction = 1; // Y
            cap.center = new Vector3(0f, b.center.y, 0f);
            cap.radius = radius;
            cap.height = b.size.y;
        }

        private static void Place(Transform obj, Transform parent, Vector3 pos, float yRot, float scale, bool cloud = false, int collide = 0)
        {
            if (obj == null) return;
            obj.SetParent(parent, false);
            obj.SetPositionAndRotation(pos, Quaternion.Euler(0f, yRot, 0f));
            obj.localScale = Vector3.one * scale;
            if (collide == 1) AddHitbox(obj, 0.85f);
            else if (collide == 2) AddCapsuleHitbox(obj, 0.45f);   // trees — slim trunk column
            if (cloud)
            {
                foreach (var mr in obj.GetComponentsInChildren<MeshRenderer>())
                {
                    mr.sharedMaterial = GroundingAssetWriter.GetConnectorMaterial("MAT_YW_Dressing_Cloud", new Color(0.93f, 0.95f, 0.97f));
                    mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                }
                obj.localScale = new Vector3(scale * 1.7f, scale * 0.6f, scale * 1.2f);
            }
        }

        private static Camera BuildLighting()
        {
            var camObj = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camObj.AddComponent<Camera>();
            camObj.AddComponent<AudioListener>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.55f, 0.69f, 0.79f); // clean cool sky
            cam.nearClipPlane = .1f; cam.farClipPlane = 320f; cam.allowMSAA = true;
            // Zoomed isometric view that FOLLOWS Yuvi (see IsometricCameraRig, wired by the caller): only a
            // slice of the island is ever on screen, so the world reads as much larger than its footprint.
            cam.orthographic = true; cam.orthographicSize = 11f;
            camObj.transform.SetPositionAndRotation(new Vector3(-6f, 16f, -24f), Quaternion.Euler(30f, 45f, 0f));

            var keyObj = new GameObject("Directional Light");
            var key = keyObj.AddComponent<Light>();
            key.type = LightType.Directional; key.color = new Color(1f, 0.97f, 0.9f); key.intensity = 1.28f;
            key.shadows = LightShadows.Soft; key.shadowStrength = 0.78f; key.shadowBias = 0.05f; key.shadowNormalBias = 0.9f;
            keyObj.transform.rotation = Quaternion.Euler(46f, -34f, 0f);
            // Dynamic sun: animates this key light along a smooth day arc at runtime so shadows sweep the
            // map (edit-time keeps the static rotation above for deterministic captures).
            keyObj.AddComponent<Yuvi720.LearningWorld.World.SunCycle>();

            var fillObj = new GameObject("Fill Light");
            var fill = fillObj.AddComponent<Light>();
            fill.type = LightType.Directional; fill.color = new Color(0.62f, 0.74f, 0.86f); fill.intensity = 0.4f; fill.shadows = LightShadows.None;
            fillObj.transform.rotation = Quaternion.Euler(58f, 150f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.72f, 0.8f, 0.88f);
            RenderSettings.ambientEquatorColor = new Color(0.56f, 0.59f, 0.62f);
            RenderSettings.ambientGroundColor = new Color(0.3f, 0.32f, 0.35f);
            RenderSettings.ambientIntensity = 1f;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.62f, 0.73f, 0.82f);
            RenderSettings.fogStartDistance = 55f;
            RenderSettings.fogEndDistance = 200f;
            return cam;
        }

        private static void Capture(Camera camera, string assetPath, int width, int height)
        {
            var absolute = Path.Combine(Path.GetDirectoryName(Application.dataPath), assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolute));
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var prev = RenderTexture.active;
            var tex = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                Shader.WarmupAllShaders();
                camera.targetTexture = rt; camera.Render(); camera.Render();
                RenderTexture.active = rt;
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0, false); tex.Apply(false, false);
                File.WriteAllBytes(absolute, tex.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = null; RenderTexture.active = prev;
                RenderTexture.ReleaseTemporary(rt); Object.DestroyImmediate(tex);
            }
        }
    }
}
