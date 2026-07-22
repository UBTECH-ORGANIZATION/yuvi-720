using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Yuvi720.LearningWorld.Grounding;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    public static class ProductionGroundingWorldBuilder
    {
        public const string WorldDefinitionPath = "Assets/Data/World/Grounding/Worlds/SO_YW_ProductionGrounding.asset";
        public const string PrefabPath = "Assets/Prefabs/World/Grounding/PF_YW_Grounding_Production_ThreeRegionMainland.prefab";
        public const string ReviewScenePath = "Assets/Scenes/ArtReview/Grounding/SCN_YW_Grounding_Production_MacroBlockout.unity";
        public const string CaptureFolder = "Assets/Art/World/HighFidelity/ReviewCaptures/ProductionGrounding";

        private const string ThemeFolder = "Assets/Data/World/Grounding/Themes";
        private const string SectionFolder = "Assets/Data/World/Grounding/Sections";

        [MenuItem("Yuvi/World Art/Grounding/01 Build Authored Production Macro Blockout")]
        public static void BuildProductionGroundingWorld()
        {
            EnsureFolders();
            var definition = BuildDefinitionAssets();
            var report = GroundingValidationService.Validate(definition);
            if (!report.IsValid)
                throw new InvalidOperationException(string.Join(Environment.NewLine, report.Issues));

            var root = GroundingWorldAssembler.BuildPrefabContents(
                definition,
                "PF_YW_Grounding_Production_ThreeRegionMainland");
            try
            {
                if (PrefabUtility.SaveAsPrefabAsset(root, PrefabPath) == null)
                    throw new InvalidOperationException($"Could not save production grounding prefab: {PrefabPath}.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            BuildReviewScene();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            var issues = ValidateProductionGrounding();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join(Environment.NewLine, issues));
            Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            Debug.Log(
                $"✅ Authored production grounding built: valley bowl + side shelf, split-level hooked court, and deep hooked ravine. " +
                $"Estimated triangles: {report.EstimatedTriangleCount}. No landmarks, props, atmosphere, React, or WebGL output added.");
        }

        [MenuItem("Yuvi/World Art/Grounding/02 Capture Production Macro Blockout")]
        public static void CaptureProductionGrounding()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ReviewScenePath) == null)
                BuildProductionGroundingWorld();
            var scene = EditorSceneManager.OpenScene(ReviewScenePath, OpenSceneMode.Single);
            var camera = Camera.main ?? throw new InvalidOperationException("Grounding review scene requires a Main Camera.");
            var views = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<WorldSectionView>(true))
                .ToDictionary(view => view.SectionId, StringComparer.Ordinal);

            CaptureView(camera, views["arrival-valley"], $"{CaptureFolder}/01-Arrival-Valley-Static-Camera.png", 1600, 1000);
            CaptureView(camera, views["archive-court"], $"{CaptureFolder}/02-Archive-Court-Static-Camera.png", 1600, 1000);
            CaptureView(camera, views["hooked-ravine"], $"{CaptureFolder}/03-Hooked-Ravine-Static-Camera.png", 1600, 1000);
            SetOverviewCamera(camera);
            Capture(camera, $"{CaptureFolder}/00-Connected-Mainland-Overview.png", 1900, 1050);
            CaptureGrayscaleSilhouette(scene, camera);
            CaptureTraversalOverlay(scene, camera);
            AssetDatabase.Refresh();
            Debug.Log("✅ Production grounding captures saved: connected overview, three static section frames, grayscale silhouette, and traversal overlay.");
        }

        [MenuItem("Yuvi/World Art/Grounding/03 Rebuild Validate and Capture")]
        public static void RebuildValidateAndCapture()
        {
            BuildProductionGroundingWorld();
            CaptureProductionGrounding();
        }

        [MenuItem("Yuvi/World Art/Grounding/04 Validate Production Macro Blockout")]
        public static void ValidateProductionGroundingMenu()
        {
            var issues = ValidateProductionGrounding();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join(Environment.NewLine, issues));
            Debug.Log("✅ Production grounding macro blockout validation passed.");
        }

        public static List<string> ValidateProductionGrounding()
        {
            var issues = new List<string>();
            var definition = AssetDatabase.LoadAssetAtPath<WorldGroundingDefinition>(WorldDefinitionPath);
            if (definition == null)
            {
                issues.Add($"Missing grounding definition: {WorldDefinitionPath}.");
                return issues;
            }
            var report = GroundingValidationService.Validate(definition);
            issues.AddRange(report.Issues
                .Where(issue => issue.Severity == GroundingIssueSeverity.Error)
                .Select(issue => issue.ToString()));

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing production grounding prefab: {PrefabPath}.");
                return issues;
            }
            var terrains = prefab.GetComponentsInChildren<TerrainVisual>(true);
            var traversalSurfaces = prefab.GetComponentsInChildren<WorldTraversalSurface>(true);
            var views = prefab.GetComponentsInChildren<WorldSectionView>(true);
            if (terrains.Length != 1) issues.Add($"Expected one TerrainVisual; found {terrains.Length}.");
            if (traversalSurfaces.Length != 1) issues.Add($"Expected one WorldTraversalSurface; found {traversalSurfaces.Length}.");
            if (views.Length != 3) issues.Add($"Expected three static section views; found {views.Length}.");
            if (prefab.GetComponentsInChildren<LandmarkVisual>(true).Length > 0)
                issues.Add("Macro grounding approval must not include landmarks or buildings.");
            if (prefab.GetComponentsInChildren<WorldWindElement>(true).Length > 0)
                issues.Add("Macro grounding approval must not include vegetation or atmosphere.");
            if (prefab.GetComponentsInChildren<YuviTarget>(true).Length > 0)
                issues.Add("React/Three.js must remain the only visible Yuvi owner.");
            if (prefab.GetComponentsInChildren<SpriteRenderer>(true).Length > 0)
                issues.Add("Macro grounding must prove dimensional geometry without SVG-derived sprites.");
            if (prefab.GetComponentsInChildren<BridgeVisual>(true).Length > 0)
                issues.Add("The review bridge is structural-only and must not invent progression state.");

            if (terrains.Length == 1)
            {
                terrains[0].CollectValidationIssues(issues);
                if (terrains[0].MovementZonesRoot.GetComponentsInChildren<Renderer>(true).Length > 0)
                    issues.Add("Traversal hierarchy must remain renderer-free.");
                if (terrains[0].LandmarkAnchorsRoot.childCount != 0)
                    issues.Add("Landmark anchors must remain empty during grounding approval.");
            }
            if (traversalSurfaces.Length == 1)
            {
                traversalSurfaces[0].CollectValidationIssues(issues);
                if (traversalSurfaces[0].MovementRoot.GetComponentsInChildren<Collider>(true).Any(collider => collider.isTrigger))
                    issues.Add("Traversal colliders must be non-trigger surfaces.");
            }
            var sectionIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var view in views)
            {
                view.CollectValidationIssues(issues);
                if (!sectionIds.Add(view.SectionId)) issues.Add($"Duplicate static section view: {view.SectionId}.");
                if (view.AtmosphereRoot == null || view.AtmosphereRoot.childCount != 0)
                    issues.Add($"{view.SectionId}: atmosphere root must remain empty for macro grounding review.");
            }

            var meshRenderers = prefab.GetComponentsInChildren<MeshRenderer>(true);
            if (meshRenderers.Length < 20)
                issues.Add($"Macro blockout lacks enough dimensional surfaces to communicate elevation; found {meshRenderers.Length} renderers.");
            var bounds = CalculateBounds(meshRenderers);
            if (bounds.size.x < 65f || bounds.size.z < 30f || bounds.size.y < 4f)
                issues.Add($"Macro blockout does not read as a long, deep mainland. Bounds: {bounds.size}.");
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ReviewScenePath) == null)
                issues.Add($"Missing grounding review scene: {ReviewScenePath}.");
            return issues;
        }

        private static WorldGroundingDefinition BuildDefinitionAssets()
        {
            var foundationTheme = LoadOrCreate<GroundThemeProfile>($"{ThemeFolder}/SO_YW_GroundTheme_MainlandFoundation.asset");
            foundationTheme.Configure(
                "mainland-slate-earth",
                Hex("59615D"), Hex("6B7169"), Hex("6E6455"), Hex("8A795D"), Hex("3D4548"));
            var arrivalTheme = LoadOrCreate<GroundThemeProfile>($"{ThemeFolder}/SO_YW_GroundTheme_Arrival.asset");
            arrivalTheme.Configure(
                "arrival-ochre-olive",
                Hex("8C9A57"), Hex("A9B573"), Hex("A2916F"), Hex("BCA87D"), Hex("47635F"));
            var courtTheme = LoadOrCreate<GroundThemeProfile>($"{ThemeFolder}/SO_YW_GroundTheme_Archive.asset");
            courtTheme.Configure(
                "archive-terracotta-stone",
                Hex("A67E62"), Hex("C3B08C"), Hex("AC9A85"), Hex("C7B183"), Hex("6B6070"));
            var ravineTheme = LoadOrCreate<GroundThemeProfile>($"{ThemeFolder}/SO_YW_GroundTheme_Ravine.asset");
            ravineTheme.Configure(
                "ravine-teal-indigo",
                Hex("4E7E74"), Hex("6F9A82"), Hex("6E7A80"), Hex("9F9576"), Hex("2C4653"));

            var arrival = BuildArrivalSection(arrivalTheme);
            var court = Placed(EastwardSections, () => BuildCourtSection(courtTheme));
            var ravine = Placed(EastwardSections, () => BuildRavineSection(ravineTheme));
            var world = LoadOrCreate<WorldGroundingDefinition>(WorldDefinitionPath);
            world.Configure(
                "yuvi-learning-mainland-production-v1",
                new[] { arrival, court, ravine },
                new[]
                {
                    new GroundConnectorDefinition(
                        "arrival-to-archive-neck",
                        "arrival-valley", "out-archive",
                        "archive-court", "in-arrival",
                        GroundTransitionKind.Ramp, 3.4f),
                    new GroundConnectorDefinition(
                        "archive-to-ravine-rise",
                        "archive-court", "out-ravine",
                        "hooked-ravine", "in-archive",
                        GroundTransitionKind.Stairs, 3f)
                },
                90f,
                12000,
                foundationTheme,
                new[]
                {
                    // Submerged shelf (entirely at/below the -1.5 waterline) proving the sections are one
                    // mainland rather than three islands. Re-spanned for the enlarged Arrival and the
                    // eastward-placed court/ravine; two rounding passes, since it is never seen up close.
                    new GroundElevationBandDefinition(
                        "continuous-mainland-stratum",
                        -1.5f,
                        -3.25f,
                        Poly(2, new[]
                        {
                            new Vector2(-38f, -6f), new Vector2(-33f, -14f), new Vector2(-22f, -19f),
                            new Vector2(-8f, -18.5f), new Vector2(4f, -16f), new Vector2(13f, -10f),
                            new Vector2(22f, -4f), new Vector2(34f, -1f), new Vector2(46f, 1f),
                            new Vector2(56f, 3f), new Vector2(68f, 7f), new Vector2(82f, 10f),
                            new Vector2(96f, 15f), new Vector2(103f, 22f), new Vector2(101f, 31f),
                            new Vector2(92f, 36f), new Vector2(80f, 35f), new Vector2(68f, 31f),
                            new Vector2(58f, 28f), new Vector2(48f, 27f), new Vector2(38f, 24f),
                            new Vector2(28f, 20f), new Vector2(16f, 16f), new Vector2(4f, 13f),
                            new Vector2(-10f, 14f), new Vector2(-24f, 12f), new Vector2(-35f, 8f)
                        }),
                        false,
                        "primary")
                });

            foreach (var asset in new UnityEngine.Object[] { foundationTheme, arrivalTheme, courtTheme, ravineTheme, arrival, court, ravine, world })
                EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            return world;
        }

        private static GroundSectionDefinition BuildArrivalSection(GroundThemeProfile theme)
        {
            var section = LoadOrCreate<GroundSectionDefinition>($"{SectionFolder}/SO_YW_GroundSection_ArrivalValley.asset");
            section.Configure(
                "arrival-valley",
                "Asymmetric Arrival Valley",
                theme,
                new[]
                {
                    // A broad rectangular headland (~56 × 34) rather than a rounded bowl: long straight runs of
                    // coast with real corners and a couple of bitten-in bays. Authored with dense points along
                    // the straights so the single rounding pass softens the corners without eating the shape.
                    // The player only ever sees a slice of this through the zoomed follow-camera — the size is
                    // what sells the world as a place rather than a diorama.
                    Band(
                        "broad-valley-plaza", .2f, -1.55f, "primary",
                        PolyAngularHole(
                            ArrivalPlazaOuter,
                            // Carved winding stream through the east-central plaza (banks come free from the hole).
                            RiverRibbon(ArrivalRiverCenter, ArrivalRiverHalfWidth))),
                    // Sunken reflection pond in the western quarter — authored negative space, not a hole in a ring.
                    Band(
                        "sunken-reflection-basin", -.7f, -2.0f, "lower",
                        PolyAngular(
                            new Vector2(-34f, -10f), new Vector2(-25f, -11f),
                            new Vector2(-24f, -2f), new Vector2(-33f, -1f))),
                    // Rear overlook bluff rising tall from the water behind the plaza (hosts the welcome pavilion).
                    Band(
                        "rear-overlook-bluff", 2.4f, .1f, "secondary",
                        PolyAngular(ArrivalBluffOuter))
                },
                new[]
                {
                    Transition("overlook-rise", GroundTransitionKind.Ramp, new Vector3(-5f, .23f, 12f), new Vector3(-5f, 2.42f, 15f), 3.6f),
                    Transition("pond-descent", GroundTransitionKind.Ramp, new Vector3(-27f, .23f, -2.5f), new Vector3(-27.5f, -.67f, -4.5f), 2.6f),
                    // Visible plank bridge over the stream, linking the central plaza (west bank) to the market
                    // district (east bank). NOT hidden in dressing — it is the river crossing.
                    Transition("river-crossing", GroundTransitionKind.Bridge, new Vector3(-1f, .2f, -1f), new Vector3(7f, .2f, -1f), 3f)
                },
                new[]
                {
                    Portal("in-start", new Vector3(-39.5f, .23f, 0f), Vector3.left, 3.5f),
                    Portal("out-archive", new Vector3(15.5f, .23f, 1f), Vector3.right, 3.4f)
                },
                new[]
                {
                    Reservation("arrival-landmark-future", new Bounds(new Vector3(-4f, 2.5f, 18f), new Vector3(12f, 3f, 7f))),
                    Reservation("arrival-secondary-kiosk", new Bounds(new Vector3(10f, .4f, -6f), new Vector3(6f, 2f, 5f))),
                    Reservation("arrival-quiet-plaza", new Bounds(new Vector3(-30f, .4f, 2f), new Vector3(9f, 2f, 7f)))
                },
                Cam(
                    new Vector3(-12f, 40f, -40f), new Vector3(46f, 0f, 0f), 32f,
                    new Bounds(new Vector3(-12f, 2f, -3f), new Vector3(60f, 12f, 40f))));
            EditorUtility.SetDirty(section);
            return section;
        }

        private static GroundSectionDefinition BuildCourtSection(GroundThemeProfile theme)
        {
            var section = LoadOrCreate<GroundSectionDefinition>($"{SectionFolder}/SO_YW_GroundSection_ArchiveCourt.asset");
            section.Configure(
                "archive-court",
                "Split-Level Archive Court",
                theme,
                new[]
                {
                    Band(
                        "hooked-court-deck", 1.15f, -.75f, "primary",
                        Poly(
                            new Vector2(10f, 2f), new Vector2(15f, 4f), new Vector2(15f, 11f),
                            new Vector2(23f, 11f), new Vector2(23f, 4f), new Vector2(25f, 1f),
                            new Vector2(29f, 5f), new Vector2(28f, 10f), new Vector2(25f, 12f),
                            new Vector2(26f, 17f), new Vector2(22f, 20f), new Vector2(15f, 19f),
                            new Vector2(11f, 15f), new Vector2(13f, 11f), new Vector2(10f, 8f))),
                    Band(
                        "lower-archive-court", -.42f, -2f, "lower",
                        Poly(
                            new Vector2(15.45f, 4.3f), new Vector2(22.55f, 4.3f),
                            new Vector2(22.55f, 10.6f), new Vector2(15.45f, 10.6f))),
                    Band(
                        "partial-upper-gallery", 2.92f, 1.12f, "secondary",
                        Poly(
                            new Vector2(17.8f, 12.1f), new Vector2(23f, 11.4f), new Vector2(25f, 15.2f),
                            new Vector2(22f, 18.6f), new Vector2(16f, 18f), new Vector2(13.9f, 15f),
                            new Vector2(16f, 12.8f)))
                },
                new[]
                {
                    Transition("court-stairs-down", GroundTransitionKind.Stairs, new Vector3(14.8f, 1.18f, 7.2f), new Vector3(16.6f, -.39f, 6.7f), 2.3f, 6),
                    Transition("gallery-long-rise", GroundTransitionKind.Ramp, new Vector3(13.7f, 1.18f, 11.8f), new Vector3(16.2f, 2.95f, 15.8f), 2.2f),
                    Transition("gallery-return-slope", GroundTransitionKind.Ramp, new Vector3(24.4f, 2.95f, 15f), new Vector3(26.7f, 1.18f, 11f), 2f)
                },
                new[]
                {
                    Portal("in-arrival", new Vector3(10.6f, 1.18f, 3.3f), Vector3.left, 3.4f),
                    Portal("out-ravine", new Vector3(28.2f, 1.18f, 8.7f), Vector3.right, 3f)
                },
                new[]
                {
                    Reservation("archive-building-future", new Bounds(new Vector3(19f, 3f, 16f), new Vector3(7f, 5f, 4f))),
                    Reservation("court-open-space", new Bounds(new Vector3(19f, -.2f, 8f), new Vector3(5f, 2f, 5f)))
                },
                Cam(
                    new Vector3(19.5f, 22f, -8.5f), new Vector3(50f, 0f, 0f), 15f,
                    new Bounds(new Vector3(19.5f, 2f, 10f), new Vector3(19f, 10f, 20f))));
            EditorUtility.SetDirty(section);
            return section;
        }

        private static GroundSectionDefinition BuildRavineSection(GroundThemeProfile theme)
        {
            var section = LoadOrCreate<GroundSectionDefinition>($"{SectionFolder}/SO_YW_GroundSection_HookedRavine.asset");
            section.Configure(
                "hooked-ravine",
                "Winding Ravine and Hooked Ridge",
                theme,
                new[]
                {
                    Band(
                        "western-ravine-bank", 2.02f, -1.48f, "primary",
                        Poly(
                            new Vector2(29f, 8f), new Vector2(38f, 6f), new Vector2(44f, 9f),
                            new Vector2(42f, 13f), new Vector2(39f, 16f), new Vector2(42f, 19f),
                            new Vector2(38f, 24f), new Vector2(33f, 21f), new Vector2(35f, 18f),
                            new Vector2(30f, 14f))),
                    Band(
                        "eastern-hooked-ridge", 2.02f, -1.48f, "primary",
                        Poly(
                            new Vector2(46f, 9f), new Vector2(54f, 11f), new Vector2(59f, 17f),
                            new Vector2(57f, 24f), new Vector2(51f, 28f), new Vector2(44f, 27f),
                            new Vector2(46f, 23f), new Vector2(52f, 21f), new Vector2(54f, 16f),
                            new Vector2(50f, 13f))),
                    Band(
                        "deep-ravine-floor", -.92f, -2.8f, "lower",
                        Poly(
                            new Vector2(41.8f, 9.5f), new Vector2(46f, 10f), new Vector2(51.8f, 13.5f),
                            new Vector2(52.5f, 17f), new Vector2(48.5f, 21f), new Vector2(43f, 22f),
                            new Vector2(40.5f, 19f), new Vector2(42.5f, 16f), new Vector2(39.8f, 13f))),
                    Band(
                        "crooked-upper-shelf", 3.92f, 1.99f, "secondary",
                        Poly(
                            new Vector2(44.5f, 21.5f), new Vector2(50.5f, 20.4f), new Vector2(56f, 22f),
                            new Vector2(53f, 26f), new Vector2(47f, 27f), new Vector2(41.8f, 24.2f),
                            new Vector2(43.5f, 22f)))
                },
                new[]
                {
                    Transition("ravine-embedded-crossing", GroundTransitionKind.Bridge, new Vector3(38.5f, 2.05f, 11.8f), new Vector3(49.8f, 2.05f, 14.2f), 2.5f),
                    Transition("switchback-lower-leg", GroundTransitionKind.Ramp, new Vector3(48.5f, -.89f, 20.4f), new Vector3(55.2f, .55f, 21.1f), 2.1f),
                    Transition("switchback-upper-leg", GroundTransitionKind.Ramp, new Vector3(55.2f, .55f, 21.1f), new Vector3(56.3f, 2.05f, 17.8f), 2.1f),
                    Transition("behind-ridge-return", GroundTransitionKind.Ramp, new Vector3(42.8f, -.89f, 19.2f), new Vector3(35.2f, 2.05f, 18.2f), 1.9f),
                    Transition("upper-shelf-stairs", GroundTransitionKind.Stairs, new Vector3(50.7f, 2.05f, 19.9f), new Vector3(49.4f, 3.95f, 23f), 2.2f, 6)
                },
                new[]
                {
                    Portal("in-archive", new Vector3(29.7f, 2.05f, 9.3f), Vector3.left, 3f),
                    Portal("out-future", new Vector3(54.2f, 3.95f, 25.5f), new Vector3(1f, 0f, 1f), 3f)
                },
                new[]
                {
                    Reservation("ridge-landmark-future", new Bounds(new Vector3(48f, 4f, 24f), new Vector3(7f, 5f, 4f))),
                    Reservation("ravine-lower-branch", new Bounds(new Vector3(46f, -.6f, 17f), new Vector3(8f, 2f, 7f)))
                },
                Cam(
                    new Vector3(44f, 27f, -4f), new Vector3(50f, 0f, 0f), 17.2f,
                    new Bounds(new Vector3(44f, 2f, 17.5f), new Vector3(30f, 12f, 23f))));
            EditorUtility.SetDirty(section);
            return section;
        }

        private static void BuildReviewScene()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath)
                ?? throw new InvalidOperationException($"Missing production grounding prefab: {PrefabPath}.");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            PrefabUtility.InstantiatePrefab(prefab, scene);

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            cameraObject.AddComponent<AudioListener>();
            camera.orthographic = true;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("D8D2C2");
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 140f;
            camera.allowHDR = false;
            camera.allowMSAA = true;
            SetOverviewCamera(camera);

            var keyObject = new GameObject("Directional Light");
            var key = keyObject.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = Hex("FFF1D2");
            key.intensity = 1.15f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = .5f;
            // Raise bias so the highly-tessellated flat tops don't self-shadow into radial acne 'sunbursts'.
            key.shadowBias = .12f;
            key.shadowNormalBias = 1.4f;
            keyObject.transform.rotation = Quaternion.Euler(48f, -36f, 0f);

            var fillObject = new GameObject("Grounding Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = Hex("ABC4D3");
            fill.intensity = .42f;
            fill.shadows = LightShadows.None;
            fillObject.transform.rotation = Quaternion.Euler(62f, 142f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("D6CDBA");
            RenderSettings.ambientEquatorColor = Hex("8A8B82");
            RenderSettings.ambientGroundColor = Hex("51535A");
            RenderSettings.ambientIntensity = .85f;
            EditorSceneManager.SaveScene(scene, ReviewScenePath);
        }

        private static void CaptureView(Camera camera, WorldSectionView view, string path, int width, int height)
        {
            camera.transform.SetPositionAndRotation(view.CameraAnchor.position, view.CameraAnchor.rotation);
            camera.orthographicSize = view.OrthographicSize;
            Capture(camera, path, width, height);
        }

        private static void SetOverviewCamera(Camera camera)
        {
            camera.transform.SetPositionAndRotation(new Vector3(22f, 42f, -35f), Quaternion.Euler(50f, 0f, 0f));
            camera.orthographicSize = 29.5f;
        }

        private static void CaptureGrayscaleSilhouette(Scene scene, Camera camera)
        {
            var renderers = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<MeshRenderer>(true)).ToArray();
            var originals = renderers.Select(renderer => renderer.sharedMaterials).ToArray();
            var shader = Shader.Find("Standard") ?? throw new InvalidOperationException("Standard shader is required.");
            var grayscale = new Material(shader) { color = new Color(.58f, .58f, .56f) };
            if (grayscale.HasProperty("_Glossiness")) grayscale.SetFloat("_Glossiness", 0f);
            try
            {
                foreach (var renderer in renderers)
                    renderer.sharedMaterials = Enumerable.Repeat(grayscale, renderer.sharedMaterials.Length).ToArray();
                SetOverviewCamera(camera);
                Capture(camera, $"{CaptureFolder}/04-Grayscale-Silhouette.png", 1900, 1050);
            }
            finally
            {
                for (var index = 0; index < renderers.Length; index++) renderers[index].sharedMaterials = originals[index];
                UnityEngine.Object.DestroyImmediate(grayscale);
            }
        }

        private static void CaptureTraversalOverlay(Scene scene, Camera camera)
        {
            var traversal = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<WorldTraversalSurface>(true))
                .Single();
            var overlayRoot = new GameObject("TraversalReviewOverlay");
            SceneManager.MoveGameObjectToScene(overlayRoot, scene);
            var shader = Shader.Find("Standard") ?? throw new InvalidOperationException("Standard shader is required.");
            var overlayMaterial = new Material(shader) { color = Hex("E64C86") };
            if (overlayMaterial.HasProperty("_EmissionColor"))
            {
                overlayMaterial.EnableKeyword("_EMISSION");
                overlayMaterial.SetColor("_EmissionColor", Hex("7D173F"));
            }
            try
            {
                foreach (var collider in traversal.MovementRoot.GetComponentsInChildren<MeshCollider>(true))
                {
                    if (collider.sharedMesh == null) continue;
                    var overlay = new GameObject("Traversal-" + collider.name);
                    overlay.transform.SetParent(overlayRoot.transform, false);
                    overlay.transform.position = collider.transform.position + Vector3.up * .08f;
                    overlay.transform.rotation = collider.transform.rotation;
                    overlay.transform.localScale = collider.transform.lossyScale;
                    overlay.AddComponent<MeshFilter>().sharedMesh = collider.sharedMesh;
                    overlay.AddComponent<MeshRenderer>().sharedMaterial = overlayMaterial;
                }
                SetOverviewCamera(camera);
                Capture(camera, $"{CaptureFolder}/05-Traversal-Overlay.png", 1900, 1050);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(overlayRoot);
                UnityEngine.Object.DestroyImmediate(overlayMaterial);
            }
        }

        private static void Capture(Camera camera, string assetPath, int width, int height)
        {
            var absolutePath = Path.Combine(
                Path.GetDirectoryName(Application.dataPath) ?? throw new InvalidOperationException("Project root unavailable."),
                assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)
                ?? throw new InvalidOperationException($"Invalid capture path: {assetPath}."));
            var renderTexture = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                Shader.WarmupAllShaders();
                camera.targetTexture = renderTexture;
                // Render twice: the first frame after a scene open can be incomplete/stale.
                camera.Render();
                camera.Render();
                RenderTexture.active = renderTexture;
                texture.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                texture.Apply(false, false);
                ValidateCapture(texture, assetPath);
                File.WriteAllBytes(absolutePath, texture.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(renderTexture);
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static void ValidateCapture(Texture2D texture, string path)
        {
            var samples = new HashSet<Color32>();
            const int grid = 18;
            for (var y = 0; y < grid; y++)
            for (var x = 0; x < grid; x++)
                samples.Add(texture.GetPixel(
                    Mathf.RoundToInt(x / (float)(grid - 1) * (texture.width - 1)),
                    Mathf.RoundToInt(y / (float)(grid - 1) * (texture.height - 1))));
            if (samples.Count < 5)
                throw new InvalidOperationException($"Capture {path} appears blank ({samples.Count} sampled colors).");
        }

        private static Bounds CalculateBounds(IReadOnlyList<MeshRenderer> renderers)
        {
            if (renderers.Count == 0) return new Bounds();
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Count; index++) bounds.Encapsulate(renderers[index].bounds);
            return bounds;
        }

        private static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (asset != null) return asset;
            if (AssetDatabase.LoadMainAssetAtPath(path) != null && !AssetDatabase.DeleteAsset(path))
                throw new InvalidOperationException($"Could not replace invalid generated asset: {path}.");
            asset = ScriptableObject.CreateInstance<T>();
            AssetDatabase.CreateAsset(asset, path);
            return asset;
        }

        private static GroundElevationBandDefinition Band(
            string id,
            float top,
            float bottom,
            string family,
            GroundPolygonDefinition polygon)
        {
            return new GroundElevationBandDefinition(id, top, bottom, polygon, true, family);
        }

        // Sections are authored around their own origin and then placed. Arrival grew to fill the frame, so
        // the court and ravine are pushed far east of it; rather than restating ~60 literals, each section
        // builder sets this shift while it runs (editor-only, single-threaded) and every authoring helper
        // below applies it. Always restore it in a finally — a leaked shift silently moves the next section.
        private static Vector2 _shift = Vector2.zero;

        /// <summary>Arrival now fills the playable frame, so the remaining sections sit far to its east —
        /// off-camera behind the cloud curtain until the player finishes here and they stream in.</summary>
        private static readonly Vector2 EastwardSections = new(42f, 0f);

        /// <summary>
        /// Centreline of the winding stream carved through the east-central plaza (a hole in the plaza polygon
        /// → automatic cliff banks and automatic prop-avoidance). The dressing builder lays an animated water
        /// ribbon along this same centreline so the water fills the carved channel exactly. Kept interior
        /// (never touches the coast) because polygon holes must sit strictly inside the outer boundary.
        /// </summary>
        public static readonly Vector2[] ArrivalRiverCenter =
        {
            new(2f, 10f), new(5f, 3f), new(1f, -5f), new(4f, -13f),
        };
        public const float ArrivalRiverHalfWidth = 2.3f;

        /// <summary>
        /// The arrival island's authored coast rings, exposed so the dressing step can raise precise
        /// invisible fall-guards along the REAL walkable edges (the outer water barrier alone leaves a
        /// walkable sea-floor moat you could drop into). Arrival's section shift is zero, so these are
        /// world coordinates. Pass through <see cref="RoundedRing"/> to match the built mesh outline.
        /// </summary>
        public static readonly Vector2[] ArrivalPlazaOuter =
        {
            // west coast, north → south
            new(-40f, 7f), new(-40.5f, -1f), new(-38f, -9f),
            // south-west shoulder
            new(-34f, -15f), new(-27f, -18.5f),
            // south beach, west → east
            new(-18f, -20f), new(-8f, -19.5f), new(1f, -18f),
            // south-east shoulder
            new(8f, -14.5f), new(13f, -9f),
            // east coast, south → north (faces the path to the archive)
            new(15.5f, -2f), new(16f, 4f), new(13.5f, 9.5f),
            // north coast, east → west
            new(7f, 13f), new(-2f, 14f), new(-12f, 13.5f),
            new(-22f, 12.5f), new(-32f, 11f), new(-37.5f, 9f),
        };
        public static readonly Vector2[] ArrivalBluffOuter =
        {
            new(-14f, 12.5f), new(4f, 12.5f), new(7f, 16f),
            new(4.5f, 21.5f), new(-4f, 23f), new(-12f, 21f),
            new(-16f, 16.5f),
        };

        /// <summary>The same single softening pass the band meshes get, so guards line up with the coast.</summary>
        public static Vector2[] RoundedRing(Vector2[] ring) => Round(ring, 1);

        private static GroundSectionDefinition Placed(Vector2 shift, Func<GroundSectionDefinition> build)
        {
            _shift = shift;
            try { return build(); }
            finally { _shift = Vector2.zero; }
        }

        private static Vector3 S(Vector3 v) => new(v.x + _shift.x, v.y, v.z + _shift.y);

        private static GroundTransitionDefinition Transition(
            string id,
            GroundTransitionKind kind,
            Vector3 start,
            Vector3 end,
            float width,
            int steps = 5)
        {
            return new GroundTransitionDefinition(id, kind, S(start), S(end), width, steps, "route");
        }

        private static GroundPortalDefinition Portal(string id, Vector3 position, Vector3 forward, float width)
        {
            return new GroundPortalDefinition(id, S(position), forward, width);
        }

        private static GroundReservedZoneDefinition Reservation(string id, Bounds bounds)
        {
            return new GroundReservedZoneDefinition(id, new Bounds(S(bounds.center), bounds.size));
        }

        private static GroundCameraDefinition Cam(Vector3 position, Vector3 rotation, float orthographicSize, Bounds coverage)
        {
            return new GroundCameraDefinition(S(position), rotation, orthographicSize, new Bounds(S(coverage.center), coverage.size));
        }

        private static GroundPolygonRingDefinition Ring(params Vector2[] points)
        {
            return new GroundPolygonRingDefinition(points);
        }

        private static GroundPolygonDefinition Poly(params Vector2[] points) => Poly(4, points);

        /// <summary>
        /// Arrival is authored as an angular headland with real corners. Four rounding passes expand each
        /// point 16× and cut every corner four times over, which is what melted the old outline into a
        /// circular blob no matter how it was authored — one pass keeps the silhouette and costs 8× fewer
        /// triangles.
        /// </summary>
        private static GroundPolygonDefinition PolyAngular(params Vector2[] points) => Poly(1, points);

        private static GroundPolygonDefinition Poly(int rounding, Vector2[] points)
        {
            var placed = _shift == Vector2.zero
                ? points
                : points.Select(point => point + _shift).ToArray();
            return new GroundPolygonDefinition(Round(placed, rounding));
        }

        /// <summary>Angular outer boundary with one carved hole (e.g. a river), both softened by one pass.</summary>
        private static GroundPolygonDefinition PolyAngularHole(Vector2[] outer, Vector2[] hole)
        {
            Vector2[] Place(Vector2[] pts) => _shift == Vector2.zero ? pts : pts.Select(p => p + _shift).ToArray();
            return new GroundPolygonDefinition(
                Round(Place(outer), 1),
                new[] { new GroundPolygonRingDefinition(Round(Place(hole), 1)) });
        }

        /// <summary>Closed ribbon outline around a centreline (offset ±half to each side), for a river hole.</summary>
        private static Vector2[] RiverRibbon(Vector2[] center, float half)
        {
            var m = center.Length;
            var left = new Vector2[m];
            var right = new Vector2[m];
            for (var i = 0; i < m; i++)
            {
                var tan = i == 0 ? center[1] - center[0]
                        : i == m - 1 ? center[m - 1] - center[m - 2]
                        : center[i + 1] - center[i - 1];
                tan = tan.sqrMagnitude > 1e-6f ? tan.normalized : Vector2.up;
                var nrm = new Vector2(-tan.y, tan.x);
                left[i] = center[i] + nrm * half;
                right[i] = center[i] - nrm * half;
            }
            var loop = new List<Vector2>(m * 2);
            for (var i = 0; i < m; i++) loop.Add(right[i]);
            for (var i = m - 1; i >= 0; i--) loop.Add(left[i]);
            return loop.ToArray();
        }

        // Chaikin corner-cutting rounds coarse authored outlines into organic coastlines.
        // Applied once at the source so tops, cliffs, lips, and traversal all stay consistent.
        private static Vector2[] Round(IReadOnlyList<Vector2> ring, int iterations = 4)
        {
            var points = ring.ToList();
            for (var pass = 0; pass < iterations; pass++)
            {
                var next = new List<Vector2>(points.Count * 2);
                for (var index = 0; index < points.Count; index++)
                {
                    var p = points[index];
                    var q = points[(index + 1) % points.Count];
                    next.Add(p * 0.75f + q * 0.25f);
                    next.Add(p * 0.25f + q * 0.75f);
                }
                points = next;
            }
            return points.ToArray();
        }

        private static GroundPolygonDefinition Poly(
            IReadOnlyList<Vector2> outer,
            params GroundPolygonRingDefinition[] holes)
        {
            return new GroundPolygonDefinition(outer, holes);
        }

        private static Color Hex(string value)
        {
            if (!ColorUtility.TryParseHtmlString("#" + value, out var color))
                throw new InvalidOperationException($"Invalid color: {value}.");
            return color;
        }

        private static void EnsureFolders()
        {
            foreach (var folder in new[]
            {
                "Assets/Data/World/Grounding/Worlds",
                ThemeFolder,
                SectionFolder,
                "Assets/Prefabs/World/Grounding",
                "Assets/Scenes/ArtReview/Grounding",
                CaptureFolder
            }) GroundingAssetWriter.EnsureFolder(folder);
            GroundingAssetWriter.EnsureOutputFolders();
        }
    }
}