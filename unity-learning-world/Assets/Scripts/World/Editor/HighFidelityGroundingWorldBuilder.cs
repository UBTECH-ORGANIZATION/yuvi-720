using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.Editor
{
    /// <summary>
    /// Builds the grounding approval pass as three irregular elevated sections
    /// joined by authored structural connectors. It intentionally excludes
    /// landmarks, vegetation, props, and character renderers.
    /// </summary>
    public static class HighFidelityGroundingWorldBuilder
    {
        public const string PrefabPath = "Assets/Prefabs/World/Terrain/PF_YW_Grounding_ThreeSectionNetwork.prefab";
        public const string ReviewScenePath = "Assets/Scenes/ArtReview/SCN_YW_Grounding_ThreeSectionNetwork.unity";
        public const string OverviewCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/Grounding-Connected-Overview.png";
        public const string ArrivalCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/Grounding-Section-01-Arrival.png";
        public const string TerraceCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/Grounding-Section-02-Terrace.png";
        public const string RidgeCapturePath = "Assets/Art/World/HighFidelity/ReviewCaptures/Grounding-Section-03-Ridge.png";
        public const string RouteRootName = "GroundingRouteAnchors";

        private static readonly Vector3 ArrivalConnector = new(6.2f, .42f, 2f);
        private static readonly Vector3 TerraceEntry = new(8.7f, 1.12f, 3.3f);
        private static readonly Vector3 TerraceConnector = new(22.2f, 1.12f, 8f);
        private static readonly Vector3 RidgeEntry = new(26f, 1.92f, 9.7f);

        [MenuItem("Yuvi/World Art/High Fidelity/06 Build Grounding Approval World")]
        public static void BuildGroundingApprovalWorld()
        {
            EnsureFolders();
            var root = new GameObject("PF_YW_Grounding_ThreeSectionNetwork");
            try
            {
                var visualRoot = Child(root.transform, "VisualRoot");
                var movementRoot = Child(root.transform, "MovementZones");
                var landmarkRoot = Child(root.transform, "LandmarkAnchors");
                var bridgeAnchorRoot = Child(root.transform, "BridgeAnchors");
                var sectionViewsRoot = Child(root.transform, "SectionViews");
                var connectorRoot = Child(root.transform, "GroundConnectors");
                var materials = LoadMaterials();

                var terrain = root.AddComponent<TerrainVisual>();
                terrain.EditorAssignContract(visualRoot, movementRoot, landmarkRoot, bridgeAnchorRoot);
                var traversal = root.AddComponent<WorldTraversalSurface>();
                traversal.EditorAssignContract(movementRoot);

                BuildRecessedGround(visualRoot, materials);
                BuildSections(visualRoot, movementRoot, materials);
                BuildGroundingTerraces(visualRoot, movementRoot, materials);
                BuildGroundRoutes(visualRoot, materials);
                BuildConnectors(connectorRoot, movementRoot, bridgeAnchorRoot, materials);
                BuildRoute(root.transform);
                BuildSectionViews(sectionViewsRoot);

                if (PrefabUtility.SaveAsPrefabAsset(root, PrefabPath) == null)
                    throw new InvalidOperationException($"Could not save {PrefabPath}.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            BuildReviewScene();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            var issues = ValidateGroundingWorld();
            if (issues.Count > 0) throw new InvalidOperationException(string.Join("\n", issues));
            Debug.Log("✅ Grounding approval world built: three irregular elevated sections, two structural connectors, no landmarks or dressing.");
        }

        [MenuItem("Yuvi/World Art/High Fidelity/07 Capture Grounding Approval World")]
        public static void CaptureGroundingApprovalWorld()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ReviewScenePath) == null)
                BuildGroundingApprovalWorld();

            var scene = EditorSceneManager.OpenScene(ReviewScenePath, OpenSceneMode.Single);
            var camera = Camera.main ?? throw new InvalidOperationException("Grounding review scene requires a Main Camera.");
            var views = scene.GetRootGameObjects()
                .SelectMany(item => item.GetComponentsInChildren<WorldSectionView>(true))
                .ToDictionary(item => item.SectionId, StringComparer.Ordinal);

            CaptureView(camera, views["ground-arrival"], ArrivalCapturePath, 1600, 1000);
            CaptureView(camera, views["ground-terrace"], TerraceCapturePath, 1600, 1000);
            CaptureView(camera, views["ground-ridge"], RidgeCapturePath, 1600, 1000);

            camera.orthographicSize = 27f;
            camera.transform.SetPositionAndRotation(new Vector3(15f, 25f, -22f), Quaternion.Euler(43.2f, 0f, 0f));
            CaptureScene(camera, OverviewCapturePath, 1900, 1050);
            AssetDatabase.Refresh();
            Debug.Log("✅ Grounding section and connected-overview captures saved for strict visual approval.");
        }

        public static void RebuildAndCaptureGroundingApprovalWorld()
        {
            BuildGroundingApprovalWorld();
            CaptureGroundingApprovalWorld();
        }

        public static List<string> ValidateGroundingWorld()
        {
            var issues = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (prefab == null)
            {
                issues.Add($"Missing grounding prefab: {PrefabPath}.");
                return issues;
            }

            var terrain = prefab.GetComponentsInChildren<TerrainVisual>(true).SingleOrDefault();
            var traversal = prefab.GetComponentsInChildren<WorldTraversalSurface>(true).SingleOrDefault();
            var views = prefab.GetComponentsInChildren<WorldSectionView>(true);
            var bridges = prefab.GetComponentsInChildren<BridgeVisual>(true);
            if (terrain == null) issues.Add("Grounding world requires exactly one TerrainVisual.");
            if (traversal == null) issues.Add("Grounding world requires exactly one WorldTraversalSurface.");
            if (views.Length != 3) issues.Add($"Grounding world requires exactly three section views; found {views.Length}.");
            if (bridges.Length != 2) issues.Add($"Grounding world requires exactly two structural connectors; found {bridges.Length}.");
            if (prefab.GetComponentsInChildren<LandmarkVisual>(true).Length > 0)
                issues.Add("Grounding approval must not contain landmarks or buildings.");
            if (prefab.GetComponentsInChildren<WorldWindElement>(true).Length > 0)
                issues.Add("Grounding approval must not contain vegetation or atmospheric dressing.");
            if (prefab.GetComponentsInChildren<SpriteRenderer>(true).Length > 0)
                issues.Add("Grounding approval uses native dimensional meshes only.");
            if (prefab.GetComponentsInChildren<YubiTarget>(true).Length > 0)
                issues.Add("React/Three.js remains the only visible Yubi owner.");

            if (terrain != null)
            {
                terrain.CollectValidationIssues(issues);
                if (terrain.MovementZonesRoot.GetComponentsInChildren<Renderer>(true).Length > 0)
                    issues.Add("Ground traversal must remain renderer-free.");
                var plateauRenderers = terrain.VisualRoot.GetComponentsInChildren<MeshRenderer>(true)
                    .Where(item => item.name.StartsWith("GroundSection-", StringComparison.Ordinal))
                    .ToArray();
                if (plateauRenderers.Length != 3)
                    issues.Add($"Expected three authored irregular ground sections; found {plateauRenderers.Length}.");
                if (terrain.VisualRoot.GetComponentsInChildren<Renderer>(true)
                    .Any(item => item.name.Contains("MeadowBase", StringComparison.OrdinalIgnoreCase)))
                    issues.Add("The rejected square meadow tile must not appear in grounding approval.");
            }
            if (traversal != null) traversal.CollectValidationIssues(issues);

            var sectionIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var view in views)
            {
                view.CollectValidationIssues(issues);
                if (!sectionIds.Add(view.SectionId)) issues.Add($"Duplicate section view ID: {view.SectionId}.");
                if (view.AtmosphereRoot == null || view.AtmosphereRoot.childCount != 0)
                    issues.Add($"{view.SectionId}: grounding review atmosphere root must remain empty.");
            }
            foreach (var bridge in bridges) bridge.CollectValidationIssues(issues);

            var route = prefab.transform.Find(RouteRootName);
            var routeNames = new[] { "Start", "StoneCausewayIn", "StoneCausewayOut", "TimberBridgeIn", "TimberBridgeOut", "Exit" };
            var routeAnchors = route == null ? Array.Empty<Transform>() : routeNames.Select(route.Find).ToArray();
            if (route == null || routeAnchors.Any(item => item == null))
            {
                issues.Add("Grounding route requires all connector and edge anchors.");
            }
            else
            {
                for (var index = 1; index < routeAnchors.Length; index++)
                {
                    if (routeAnchors[index].position.x <= routeAnchors[index - 1].position.x)
                        issues.Add("Grounding route must progress continuously toward the right.");
                    if (routeAnchors[index].position.z < routeAnchors[index - 1].position.z)
                        issues.Add("Grounding route must progress continuously up-right.");
                }
                if (Vector3.Distance(routeAnchors[1].position, ArrivalConnector) > .01f
                    || Vector3.Distance(routeAnchors[2].position, TerraceEntry) > .01f
                    || Vector3.Distance(routeAnchors[3].position, TerraceConnector) > .01f
                    || Vector3.Distance(routeAnchors[4].position, RidgeEntry) > .01f)
                    issues.Add("Grounding connector anchors do not match the authored section edges.");
            }

            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ReviewScenePath) == null)
                issues.Add($"Missing grounding review scene: {ReviewScenePath}.");
            return issues;
        }

        private static void BuildSections(
            Transform visualRoot,
            Transform movementRoot,
            IReadOnlyDictionary<string, Material> materials)
        {
            var arrival = new[]
            {
                new Vector2(-11f, -3f), new Vector2(-9f, -7f), new Vector2(-3f, -8f),
                new Vector2(2f, -6f), new Vector2(5f, -2f), new Vector2(6.2f, 2f),
                new Vector2(4f, 6f), new Vector2(-1f, 8f), new Vector2(-6f, 7f), new Vector2(-10f, 3f)
            };
            var terrace = new[]
            {
                new Vector2(8.7f, 3.3f), new Vector2(10f, 0f), new Vector2(15f, -1f),
                new Vector2(20f, 0f), new Vector2(22.5f, 3f), new Vector2(22.2f, 8f),
                new Vector2(19f, 11f), new Vector2(14f, 12f), new Vector2(10f, 9f), new Vector2(8f, 6f)
            };
            var ridge = new[]
            {
                new Vector2(26f, 9.7f), new Vector2(28f, 6f), new Vector2(34f, 5.5f),
                new Vector2(39f, 8f), new Vector2(41f, 13f), new Vector2(39f, 18f),
                new Vector2(34f, 21f), new Vector2(29f, 19f), new Vector2(25f, 15f)
            };

            BuildSection(visualRoot, movementRoot, "GroundSection-01-Arrival", arrival, .4f, -1.35f, materials, 11);
            BuildSection(visualRoot, movementRoot, "GroundSection-02-Terrace", terrace, 1.1f, -.75f, materials, 23);
            BuildSection(visualRoot, movementRoot, "GroundSection-03-Ridge", ridge, 1.9f, -.2f, materials, 37);
        }

        private static void BuildSection(
            Transform visualRoot,
            Transform movementRoot,
            string name,
            IReadOnlyList<Vector2> outline,
            float topHeight,
            float bottomHeight,
            IReadOnlyDictionary<string, Material> materials,
            int seed)
        {
            var smoothOutline = SmoothClosedOutline(outline, 2);
            var plateauMesh = CreatePlateauMesh($"MESH_YW_{name}", smoothOutline, topHeight, bottomHeight, seed);
            AddMesh(visualRoot, name, plateauMesh, new[] { materials["ground"], materials["cliff"] });
            AddMesh(
                visualRoot,
                name.Replace("Ground", "CliffSkirt", StringComparison.Ordinal),
                CreateCliffSkirtMesh($"MESH_YW_{name}_CliffSkirt", smoothOutline, topHeight - .015f, bottomHeight),
                new[] { materials["cliff"] });
            AddMesh(
                visualRoot,
                name.Replace("Ground", "TopSurface", StringComparison.Ordinal),
                CreateFlatPolygonMesh($"MESH_YW_{name}_TopSurface", smoothOutline, topHeight + .055f),
                new[] { materials["ground"] });
            AddMesh(
                visualRoot,
                name.Replace("GroundSection", "GroundEdgeLip", StringComparison.Ordinal),
                CreateRimMesh($"MESH_YW_{name}_Rim", smoothOutline, topHeight + .075f),
                new[] { materials["edge"] });

            var colliderObject = Child(movementRoot, name + "-Traversal");
            var collider = colliderObject.gameObject.AddComponent<MeshCollider>();
            collider.sharedMesh = plateauMesh;
        }

        private static void BuildRecessedGround(Transform visualRoot, IReadOnlyDictionary<string, Material> materials)
        {
            AddMesh(
                visualRoot,
                "RavineFloor-StoneCauseway",
                CreateFlatPolygonMesh(
                    "MESH_YW_RavineFloor_StoneCauseway",
                    new[]
                    {
                        new Vector2(4.3f, -.1f), new Vector2(7.1f, -.8f), new Vector2(10.5f, 1.2f),
                        new Vector2(11.2f, 4.5f), new Vector2(8.5f, 6.1f), new Vector2(5.2f, 4.8f)
                    },
                    -1.08f),
                new[] { materials["ravine"] });
            AddMesh(
                visualRoot,
                "RavineFloor-TimberBridge",
                CreateFlatPolygonMesh(
                    "MESH_YW_RavineFloor_TimberBridge",
                    new[]
                    {
                        new Vector2(20.1f, 5.1f), new Vector2(23.5f, 4.8f), new Vector2(27.8f, 7.2f),
                        new Vector2(28.2f, 11.4f), new Vector2(24.6f, 13f), new Vector2(21f, 10.8f)
                    },
                    -.68f),
                new[] { materials["ravineDark"] });
        }

        private static void BuildGroundingTerraces(
            Transform visualRoot,
            Transform movementRoot,
            IReadOnlyDictionary<string, Material> materials)
        {
            BuildSection(
                visualRoot,
                movementRoot,
                "GroundTerrace-02-UpperShelf",
                new[]
                {
                    new Vector2(10.9f, 8.2f), new Vector2(12.7f, 7.1f), new Vector2(16f, 7.4f),
                    new Vector2(19.2f, 8.1f), new Vector2(19.4f, 10.3f), new Vector2(16.8f, 11.2f),
                    new Vector2(13.1f, 10.8f), new Vector2(10.8f, 9.7f)
                },
                1.48f,
                1.04f,
                materials,
                53);
            BuildSection(
                visualRoot,
                movementRoot,
                "GroundTerrace-03-RidgeShelf",
                new[]
                {
                    new Vector2(28.6f, 15.2f), new Vector2(30.3f, 13.7f), new Vector2(34f, 13.9f),
                    new Vector2(38.4f, 15.1f), new Vector2(38.4f, 17.4f), new Vector2(35.2f, 19.2f),
                    new Vector2(31.4f, 18.7f), new Vector2(28.8f, 17.4f)
                },
                2.28f,
                1.84f,
                materials,
                71);

            BuildGroundSteps(
                visualRoot,
                movementRoot,
                "TerraceSteps-02",
                new Vector3(12.2f, 1.14f, 7.2f),
                new Vector3(12.2f, 1.5f, 8.55f),
                2.25f,
                materials["stoneLight"]);
            BuildGroundSteps(
                visualRoot,
                movementRoot,
                "TerraceSteps-03",
                new Vector3(30.2f, 1.94f, 13.9f),
                new Vector3(30.2f, 2.3f, 15.35f),
                2.35f,
                materials["stoneLight"]);

            BuildRetainingWall(
                visualRoot,
                "RetainingWall-02",
                new[] { new Vector3(12.7f, 1.23f, 7.35f), new Vector3(15.8f, 1.23f, 7.55f), new Vector3(18.8f, 1.23f, 8.25f) },
                materials["stoneDark"]);
            BuildRetainingWall(
                visualRoot,
                "RetainingWall-03",
                new[] { new Vector3(30.4f, 2.03f, 14.05f), new Vector3(34f, 2.03f, 14.15f), new Vector3(37.8f, 2.03f, 15.25f) },
                materials["stoneDark"]);
        }

        private static void BuildGroundSteps(
            Transform visualRoot,
            Transform movementRoot,
            string name,
            Vector3 start,
            Vector3 end,
            float width,
            Material material)
        {
            var visual = Child(visualRoot, name);
            const int count = 4;
            var direction = end - start;
            var horizontal = new Vector3(direction.x, 0f, direction.z);
            var rotation = Quaternion.LookRotation(horizontal.normalized, Vector3.up);
            for (var index = 0; index < count; index++)
            {
                var t = (index + .5f) / count;
                var position = Vector3.Lerp(start, end, t);
                AddBox(visual, $"GroundStep-{index + 1:00}", position, new Vector3(width, .13f, horizontal.magnitude / count + .09f), rotation, material);
            }
            CreateWalkSurface(movementRoot, name + "-Traversal", start, end, width - .2f, .13f);
        }

        private static void BuildRetainingWall(
            Transform visualRoot,
            string name,
            IReadOnlyList<Vector3> points,
            Material material)
        {
            var root = Child(visualRoot, name);
            for (var index = 0; index < points.Count - 1; index++)
            {
                var start = points[index];
                var end = points[index + 1];
                var direction = end - start;
                AddBox(
                    root,
                    $"RetainingSegment-{index + 1:00}",
                    Vector3.Lerp(start, end, .5f),
                    new Vector3(.26f, .58f, direction.magnitude + .08f),
                    Quaternion.LookRotation(direction.normalized, Vector3.up),
                    material);
            }
        }

        private static void BuildGroundRoutes(
            Transform visualRoot,
            IReadOnlyDictionary<string, Material> materials)
        {
            AddMesh(
                visualRoot,
                "GroundRoute-01-Arrival",
                CreateGroundRibbon(
                    "MESH_YW_GroundRoute_01_Arrival",
                    new[]
                    {
                        new Vector3(-10.2f, .48f, -2.4f), new Vector3(-7f, .48f, -1.6f),
                        new Vector3(-3.6f, .48f, -.4f), new Vector3(.2f, .48f, .5f),
                        new Vector3(3.2f, .48f, 1.4f), ArrivalConnector + Vector3.up * .06f
                    },
                    1.75f),
                new[] { materials["soil"] });
            AddMesh(
                visualRoot,
                "GroundRoute-02-Terrace",
                CreateGroundRibbon(
                    "MESH_YW_GroundRoute_02_Terrace",
                    new[]
                    {
                        TerraceEntry + Vector3.up * .06f, new Vector3(11.8f, 1.18f, 4.2f),
                        new Vector3(14.8f, 1.18f, 5.5f), new Vector3(18.2f, 1.18f, 6.3f),
                        new Vector3(20.5f, 1.18f, 7.3f), TerraceConnector + Vector3.up * .06f
                    },
                    1.75f),
                new[] { materials["soil"] });
            AddMesh(
                visualRoot,
                "GroundRoute-03-Ridge",
                CreateGroundRibbon(
                    "MESH_YW_GroundRoute_03_Ridge",
                    new[]
                    {
                        RidgeEntry + Vector3.up * .06f, new Vector3(29f, 1.98f, 11f),
                        new Vector3(32.5f, 1.98f, 12.2f), new Vector3(35.7f, 1.98f, 13f),
                        new Vector3(39.2f, 1.98f, 14.5f)
                    },
                    1.8f),
                new[] { materials["soil"] });
        }

        private static void BuildConnectors(
            Transform connectorRoot,
            Transform movementRoot,
            Transform bridgeAnchorRoot,
            IReadOnlyDictionary<string, Material> materials)
        {
            BuildStoneCauseway(connectorRoot, movementRoot, bridgeAnchorRoot, ArrivalConnector, TerraceEntry, materials);
            BuildTimberBridge(connectorRoot, movementRoot, bridgeAnchorRoot, TerraceConnector, RidgeEntry, materials);
        }

        private static void BuildStoneCauseway(
            Transform connectorRoot,
            Transform movementRoot,
            Transform bridgeAnchorRoot,
            Vector3 start,
            Vector3 end,
            IReadOnlyDictionary<string, Material> materials)
        {
            const float width = 3.35f;
            var bridgeRoot = Child(connectorRoot, "StoneCausewayConnector");
            var visual = Child(bridgeRoot, "VisualRoot");
            var open = Child(visual, "OpenState");
            var locked = Child(visual, "LockedState");
            locked.gameObject.SetActive(false);
            var startAnchor = Anchor(bridgeRoot, "StartAnchor", start);
            var endAnchor = Anchor(bridgeRoot, "EndAnchor", end);
            Anchor(bridgeAnchorRoot, "StoneCausewayIn", start);
            Anchor(bridgeAnchorRoot, "StoneCausewayOut", end);
            var blocked = Anchor(bridgeRoot, "BlockedInteractionAnchor", Vector3.Lerp(start, end, .5f));
            var contacts = new[]
            {
                Anchor(bridgeRoot, "RavineContactStart", start + Vector3.down * 1.15f),
                Anchor(bridgeRoot, "RavineContactEnd", end + Vector3.down * 1.15f)
            };

            const int stepCount = 7;
            var horizontal = end - start;
            horizontal.y = 0f;
            var rotation = Quaternion.LookRotation(horizontal.normalized, Vector3.up);
            var stepDepth = horizontal.magnitude / stepCount + .12f;
            for (var index = 0; index < stepCount; index++)
            {
                var t = (index + .5f) / stepCount;
                var position = Vector3.Lerp(start, end, t);
                position.y -= .12f;
                AddBox(open, $"StoneStep-{index + 1:00}", position, new Vector3(width, .28f, stepDepth), rotation,
                    index % 2 == 0 ? materials["stone"] : materials["stoneLight"]);
            }

            AddConnectorSide(open, "CausewayCurb-A", start, end, -width * .48f, .34f, .22f, materials["stoneDark"]);
            AddConnectorSide(open, "CausewayCurb-B", start, end, width * .48f, .34f, .22f, materials["stoneDark"]);
            var walkSurface = CreateWalkSurface(movementRoot, "StoneCausewayWalkSurface", start, end, width - .35f, .18f);
            bridgeRoot.gameObject.AddComponent<BridgeVisual>().EditorAssignContract(
                startAnchor, endAnchor, walkSurface, visual, open, locked, blocked, contacts);
        }

        private static void BuildTimberBridge(
            Transform connectorRoot,
            Transform movementRoot,
            Transform bridgeAnchorRoot,
            Vector3 start,
            Vector3 end,
            IReadOnlyDictionary<string, Material> materials)
        {
            const float width = 3.2f;
            var bridgeRoot = Child(connectorRoot, "TimberBridgeConnector");
            var visual = Child(bridgeRoot, "VisualRoot");
            var open = Child(visual, "OpenState");
            var locked = Child(visual, "LockedState");
            locked.gameObject.SetActive(false);
            var startAnchor = Anchor(bridgeRoot, "StartAnchor", start);
            var endAnchor = Anchor(bridgeRoot, "EndAnchor", end);
            Anchor(bridgeAnchorRoot, "TimberBridgeIn", start);
            Anchor(bridgeAnchorRoot, "TimberBridgeOut", end);
            var blocked = Anchor(bridgeRoot, "BlockedInteractionAnchor", Vector3.Lerp(start, end, .5f));
            var contacts = new[]
            {
                Anchor(bridgeRoot, "RavineContactStart", start + Vector3.down * 1.45f),
                Anchor(bridgeRoot, "RavineContactEnd", end + Vector3.down * 1.45f)
            };

            const int plankCount = 12;
            var horizontal = end - start;
            horizontal.y = 0f;
            var rotation = Quaternion.LookRotation(horizontal.normalized, Vector3.up);
            var plankDepth = horizontal.magnitude / (plankCount - 1) * .74f;
            var previousCenter = start;
            for (var index = 0; index < plankCount; index++)
            {
                var t = index / (float)(plankCount - 1);
                var center = Vector3.Lerp(start, end, t);
                center.y -= Mathf.Sin(t * Mathf.PI) * .11f;
                AddBox(open, $"TimberPlank-{index + 1:00}", center, new Vector3(width, .16f, plankDepth), rotation,
                    index % 3 == 0 ? materials["timberLight"] : materials["timber"]);
                if (index > 0)
                {
                    AddConnectorSide(open, $"TimberBeam-A-{index:00}", previousCenter, center, -width * .38f, .17f, .16f, materials["timberDark"]);
                    AddConnectorSide(open, $"TimberBeam-B-{index:00}", previousCenter, center, width * .38f, .17f, .16f, materials["timberDark"]);
                }
                previousCenter = center;
            }

            for (var index = 0; index < 4; index++)
            {
                var t = index / 3f;
                var center = Vector3.Lerp(start, end, t);
                center.y -= Mathf.Sin(t * Mathf.PI) * .11f;
                var side = Vector3.Cross(Vector3.up, horizontal.normalized);
                AddBox(open, $"BridgePost-A-{index:00}", center - side * width * .47f + Vector3.up * .55f,
                    new Vector3(.15f, 1.15f, .15f), Quaternion.identity, materials["timberDark"]);
                AddBox(open, $"BridgePost-B-{index:00}", center + side * width * .47f + Vector3.up * .55f,
                    new Vector3(.15f, 1.15f, .15f), Quaternion.identity, materials["timberDark"]);
            }

            var walkSurface = CreateWalkSurface(movementRoot, "TimberBridgeWalkSurface", start, end, width - .4f, .16f);
            bridgeRoot.gameObject.AddComponent<BridgeVisual>().EditorAssignContract(
                startAnchor, endAnchor, walkSurface, visual, open, locked, blocked, contacts);
        }

        private static void AddConnectorSide(
            Transform parent,
            string name,
            Vector3 start,
            Vector3 end,
            float sideOffset,
            float height,
            float thickness,
            Material material)
        {
            var direction = end - start;
            var horizontal = new Vector3(direction.x, 0f, direction.z).normalized;
            var side = Vector3.Cross(Vector3.up, horizontal);
            var center = Vector3.Lerp(start, end, .5f) + side * sideOffset + Vector3.up * height;
            AddBox(parent, name, center, new Vector3(thickness, thickness, direction.magnitude),
                Quaternion.LookRotation(direction.normalized, Vector3.up), material);
        }

        private static Collider CreateWalkSurface(
            Transform movementRoot,
            string name,
            Vector3 start,
            Vector3 end,
            float width,
            float thickness)
        {
            var surface = Child(movementRoot, name);
            var direction = end - start;
            surface.position = Vector3.Lerp(start, end, .5f) - Vector3.up * thickness * .5f;
            surface.rotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
            var collider = surface.gameObject.AddComponent<BoxCollider>();
            collider.size = new Vector3(width, thickness, direction.magnitude + .35f);
            return collider;
        }

        private static void BuildRoute(Transform root)
        {
            var route = Child(root, RouteRootName);
            Anchor(route, "Start", new Vector3(-10.3f, .42f, -2.5f));
            Anchor(route, "StoneCausewayIn", ArrivalConnector);
            Anchor(route, "StoneCausewayOut", TerraceEntry);
            Anchor(route, "TimberBridgeIn", TerraceConnector);
            Anchor(route, "TimberBridgeOut", RidgeEntry);
            Anchor(route, "Exit", new Vector3(39.2f, 1.92f, 14.5f));
        }

        private static void BuildSectionViews(Transform parent)
        {
            BuildSectionView(parent, "ground-arrival", new Vector3(-2f, 0f, 0f), new Vector3(20f, 9f, 17f), 11.8f);
            BuildSectionView(parent, "ground-terrace", new Vector3(15.5f, .7f, 5.5f), new Vector3(16f, 9f, 13f), 10.8f);
            BuildSectionView(parent, "ground-ridge", new Vector3(33f, 1.5f, 13f), new Vector3(18f, 9f, 17f), 11.8f);
        }

        private static void BuildSectionView(
            Transform parent,
            string id,
            Vector3 center,
            Vector3 size,
            float orthographicSize)
        {
            var root = Child(parent, id);
            var atmosphere = Child(root, "AtmosphereRoot");
            var anchor = Child(root, "CameraAnchor");
            anchor.position = center + new Vector3(0f, 12.6f, -13.4f);
            anchor.rotation = Quaternion.Euler(43.2f, 0f, 0f);
            var volumeObject = Child(root, "CoverageVolume");
            volumeObject.position = center;
            var volume = volumeObject.gameObject.AddComponent<BoxCollider>();
            volume.isTrigger = true;
            volume.center = new Vector3(0f, 2.5f, 0f);
            volume.size = size;
            root.gameObject.AddComponent<WorldSectionView>().Configure(id, anchor, volume, atmosphere, orthographicSize);
        }

        private static void BuildReviewScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            ConfigureEnvironment();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath)
                ?? throw new InvalidOperationException("Grounding prefab is unavailable after build.");
            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject
                ?? throw new InvalidOperationException("Could not instantiate grounding prefab.");
            instance.name = "Grounding_ThreeSectionNetwork_Review";
            CreateCamera();
            CreateLights();
            EditorSceneManager.SaveScene(scene, ReviewScenePath);
        }

        private static void CreateCamera()
        {
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 27f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Hex("B8C5BF");
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 220f;
            cameraObject.transform.SetPositionAndRotation(new Vector3(15f, 25f, -22f), Quaternion.Euler(43.2f, 0f, 0f));
            cameraObject.AddComponent<AudioListener>();
        }

        private static void ConfigureEnvironment()
        {
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("D7DFDA");
            RenderSettings.ambientEquatorColor = Hex("91A298");
            RenderSettings.ambientGroundColor = Hex("485247");
            RenderSettings.ambientIntensity = 1.05f;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Hex("B8C5BF");
            RenderSettings.fogStartDistance = 44f;
            RenderSettings.fogEndDistance = 105f;
        }

        private static void CreateLights()
        {
            var keyObject = new GameObject("Directional Key Light");
            var key = keyObject.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = Hex("FFE4B5");
            key.intensity = 1.22f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = .72f;
            keyObject.transform.rotation = Quaternion.Euler(48f, -38f, 0f);

            var fillObject = new GameObject("Cool Fill Light");
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = Hex("B6D3D0");
            fill.intensity = .38f;
            fill.shadows = LightShadows.None;
            fillObject.transform.rotation = Quaternion.Euler(34f, 142f, 0f);
        }

        private static void CaptureView(Camera camera, WorldSectionView view, string capturePath, int width, int height)
        {
            camera.orthographicSize = view.OrthographicSize;
            camera.transform.SetPositionAndRotation(view.CameraAnchor.position, view.CameraAnchor.rotation);
            CaptureScene(camera, capturePath, width, height);
        }

        private static void CaptureScene(Camera camera, string capturePath, int width, int height)
        {
            Shader.WarmupAllShaders();
            var projectRoot = Path.GetDirectoryName(Application.dataPath)
                ?? throw new InvalidOperationException("Unity project root could not be resolved.");
            var absolutePath = Path.Combine(projectRoot, capturePath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)
                ?? throw new InvalidOperationException($"Invalid capture path: {capturePath}."));
            var target = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                texture.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                texture.Apply(false, false);
                var colors = new HashSet<Color32>();
                for (var y = 0; y < 20; y++)
                for (var x = 0; x < 20; x++)
                    colors.Add(texture.GetPixel(x * (width - 1) / 19, y * (height - 1) / 19));
                if (colors.Count < 6) throw new InvalidOperationException($"Blank or visually empty capture rejected: {capturePath}.");
                File.WriteAllBytes(absolutePath, texture.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                RenderTexture.ReleaseTemporary(target);
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static Mesh CreatePlateauMesh(
            string name,
            IReadOnlyList<Vector2> outline,
            float topHeight,
            float bottomHeight,
            int seed)
        {
            var center = outline.Aggregate(Vector2.zero, (sum, point) => sum + point) / outline.Count;
            var vertices = new List<Vector3> { new(center.x, topHeight + .04f, center.y) };
            var uv = new List<Vector2> { new(.5f, .5f) };
            var topTriangles = new List<int>();
            var sideTriangles = new List<int>();
            var random = new System.Random(seed);

            for (var ring = 0; ring < 2; ring++)
            {
                var scale = ring == 0 ? .55f : 1f;
                for (var index = 0; index < outline.Count; index++)
                {
                    var point = Vector2.Lerp(center, outline[index], scale);
                    var variation = ring == 0 ? ((float)random.NextDouble() - .5f) * .12f : 0f;
                    vertices.Add(new Vector3(point.x, topHeight + variation, point.y));
                    uv.Add(new Vector2(point.x * .08f, point.y * .08f));
                }
            }

            var innerStart = 1;
            var outerStart = 1 + outline.Count;
            for (var index = 0; index < outline.Count; index++)
            {
                var next = (index + 1) % outline.Count;
                topTriangles.AddRange(new[] { 0, innerStart + next, innerStart + index });
                topTriangles.AddRange(new[]
                {
                    innerStart + index, outerStart + next, outerStart + index,
                    innerStart + index, innerStart + next, outerStart + next
                });
            }

            var mesh = new Mesh { name = name, subMeshCount = 2 };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(topTriangles, 0);
            mesh.SetTriangles(sideTriangles, 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return SaveMesh(mesh, name);
        }

        private static Mesh CreateRimMesh(string name, IReadOnlyList<Vector2> outline, float height)
        {
            var center = outline.Aggregate(Vector2.zero, (sum, point) => sum + point) / outline.Count;
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var uv = new List<Vector2>();
            for (var index = 0; index < outline.Count; index++)
            {
                var inner = Vector2.Lerp(center, outline[index], .91f);
                vertices.Add(new Vector3(inner.x, height, inner.y));
                vertices.Add(new Vector3(outline[index].x, height, outline[index].y));
                uv.Add(new Vector2(0f, index / (float)outline.Count));
                uv.Add(new Vector2(1f, index / (float)outline.Count));
            }
            for (var index = 0; index < outline.Count; index++)
            {
                var next = (index + 1) % outline.Count;
                var innerA = index * 2;
                var outerA = innerA + 1;
                var innerB = next * 2;
                var outerB = innerB + 1;
                triangles.AddRange(new[] { innerA, outerB, outerA, innerA, innerB, outerB });
            }
            return FinalizeMesh(name, vertices, triangles, uv);
        }

        private static Mesh CreateCliffSkirtMesh(
            string name,
            IReadOnlyList<Vector2> outline,
            float topHeight,
            float bottomHeight)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var uv = new List<Vector2>();
            for (var index = 0; index < outline.Count; index++)
            {
                var next = (index + 1) % outline.Count;
                var topA = new Vector3(outline[index].x, topHeight, outline[index].y);
                var topB = new Vector3(outline[next].x, topHeight, outline[next].y);
                var lowerA2 = Vector2.Lerp(outline[index], outline[next], .06f);
                var lowerB2 = Vector2.Lerp(outline[next], outline[index], .06f);
                var lowerA = new Vector3(lowerA2.x, bottomHeight + (index % 3) * .07f, lowerA2.y);
                var lowerB = new Vector3(lowerB2.x, bottomHeight + (next % 3) * .07f, lowerB2.y);
                var offset = vertices.Count;
                vertices.AddRange(new[] { topA, topB, lowerB, lowerA });
                uv.AddRange(new[] { new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(1f, 0f), new Vector2(0f, 0f) });
                triangles.AddRange(new[]
                {
                    offset, offset + 1, offset + 2,
                    offset, offset + 2, offset + 3
                });
            }
            return FinalizeMesh(name, vertices, triangles, uv);
        }

        private static Mesh CreateFlatPolygonMesh(
            string name,
            IReadOnlyList<Vector2> outline,
            float height)
        {
            var center = outline.Aggregate(Vector2.zero, (sum, point) => sum + point) / outline.Count;
            var vertices = new List<Vector3> { new(center.x, height, center.y) };
            var triangles = new List<int>();
            var uv = new List<Vector2> { new(.5f, .5f) };
            foreach (var point in outline)
            {
                vertices.Add(new Vector3(point.x, height, point.y));
                uv.Add(new Vector2(point.x * .08f, point.y * .08f));
            }
            for (var index = 0; index < outline.Count; index++)
            {
                var next = (index + 1) % outline.Count;
                triangles.AddRange(new[] { 0, next + 1, index + 1 });
            }
            return FinalizeMesh(name, vertices, triangles, uv);
        }

        private static Mesh CreateGroundRibbon(
            string name,
            IReadOnlyList<Vector3> points,
            float width)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var uv = new List<Vector2>();
            for (var index = 0; index < points.Count; index++)
            {
                var previous = points[Mathf.Max(0, index - 1)];
                var next = points[Mathf.Min(points.Count - 1, index + 1)];
                var tangent = (next - previous).normalized;
                var side = Vector3.Cross(Vector3.up, tangent).normalized;
                var taper = Mathf.Lerp(.76f, 1f, Mathf.Sin(index / (float)(points.Count - 1) * Mathf.PI));
                vertices.Add(points[index] - side * width * .5f * taper);
                vertices.Add(points[index] + side * width * .5f * taper);
                uv.Add(new Vector2(0f, index));
                uv.Add(new Vector2(1f, index));
            }
            for (var index = 0; index < points.Count - 1; index++)
            {
                var a = index * 2;
                var b = a + 1;
                var c = a + 2;
                var d = c + 1;
                triangles.AddRange(new[] { a, d, b, a, c, d });
            }
            return FinalizeMesh(name, vertices, triangles, uv);
        }

        private static Vector2[] SmoothClosedOutline(IReadOnlyList<Vector2> source, int iterations)
        {
            var points = source.ToArray();
            for (var iteration = 0; iteration < iterations; iteration++)
            {
                var smoothed = new List<Vector2>(points.Length * 2);
                for (var index = 0; index < points.Length; index++)
                {
                    var current = points[index];
                    var next = points[(index + 1) % points.Length];
                    smoothed.Add(Vector2.Lerp(current, next, .25f));
                    smoothed.Add(Vector2.Lerp(current, next, .75f));
                }
                points = smoothed.ToArray();
            }
            return points;
        }

        private static Mesh CreateBoxMesh(string name)
        {
            var vertices = new List<Vector3>
            {
                new(-.5f, -.5f, -.5f), new(.5f, -.5f, -.5f), new(.5f, .5f, -.5f), new(-.5f, .5f, -.5f),
                new(-.5f, -.5f, .5f), new(.5f, -.5f, .5f), new(.5f, .5f, .5f), new(-.5f, .5f, .5f)
            };
            var triangles = new List<int>
            {
                0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
                0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
                3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4
            };
            var uv = Enumerable.Repeat(Vector2.zero, vertices.Count).ToList();
            return FinalizeMesh(name, vertices, triangles, uv);
        }

        private static Mesh FinalizeMesh(string name, List<Vector3> vertices, List<int> triangles, List<Vector2> uv)
        {
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return SaveMesh(mesh, name);
        }

        private static Mesh SaveMesh(Mesh mesh, string name)
        {
            var path = $"Assets/Art/World/HighFidelity/Meshes/{name}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing != null)
            {
                EditorUtility.CopySerialized(mesh, existing);
                UnityEngine.Object.DestroyImmediate(mesh);
                EditorUtility.SetDirty(existing);
                return existing;
            }
            AssetDatabase.CreateAsset(mesh, path);
            return mesh;
        }

        private static void AddMesh(Transform parent, string name, Mesh mesh, Material[] materials)
        {
            var item = new GameObject(name);
            item.transform.SetParent(parent, false);
            item.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = item.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = materials;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        private static void AddBox(
            Transform parent,
            string name,
            Vector3 position,
            Vector3 scale,
            Quaternion rotation,
            Material material)
        {
            var item = new GameObject(name);
            item.transform.SetParent(parent, false);
            item.transform.position = position;
            item.transform.rotation = rotation;
            item.transform.localScale = scale;
            item.AddComponent<MeshFilter>().sharedMesh = GetBoxMesh();
            var renderer = item.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        private static Mesh GetBoxMesh()
        {
            const string path = "Assets/Art/World/HighFidelity/Meshes/MESH_YW_GroundingStructuralBox.asset";
            return AssetDatabase.LoadAssetAtPath<Mesh>(path) ?? CreateBoxMesh("MESH_YW_GroundingStructuralBox");
        }

        private static Dictionary<string, Material> LoadMaterials()
        {
            return new Dictionary<string, Material>
            {
                ["ground"] = LoadMaterial("GroundingTop", Hex("788D63")),
                ["edge"] = LoadMaterial("GroundingEdge", Hex("71835B")),
                ["cliff"] = LoadMaterial("GroundingCliff", Hex("625748")),
                ["soil"] = LoadMaterial("GroundingSoil", Hex("927A58")),
                ["ravine"] = LoadMaterial("GroundingRavine", Hex("46514B")),
                ["ravineDark"] = LoadMaterial("GroundingRavineDark", Hex("303A38")),
                ["stone"] = LoadMaterial("GroundingStone", Hex("8E8577")),
                ["stoneLight"] = LoadMaterial("GroundingStoneLight", Hex("AAA18F")),
                ["stoneDark"] = LoadMaterial("GroundingStoneDark", Hex("5D5850")),
                ["timber"] = LoadMaterial("GroundingTimber", Hex("74523C")),
                ["timberLight"] = LoadMaterial("GroundingTimberLight", Hex("936B4A")),
                ["timberDark"] = LoadMaterial("GroundingTimberDark", Hex("44342C"))
            };
        }

        private static Material LoadMaterial(string name, Color color)
        {
            var path = $"Assets/Art/World/HighFidelity/Materials/MAT_YW_HF_{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Standard")
                    ?? throw new InvalidOperationException("Standard shader is unavailable."));
                material.name = $"MAT_YW_HF_{name}";
                AssetDatabase.CreateAsset(material, path);
            }
            material.color = color;
            material.SetFloat("_Glossiness", .04f);
            material.SetFloat("_Metallic", 0f);
            material.SetInt("_Cull", (int)CullMode.Off);
            material.mainTexture = null;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Transform Anchor(Transform parent, string name, Vector3 position)
        {
            var anchor = Child(parent, name);
            anchor.position = position;
            return anchor;
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static void EnsureFolders()
        {
            EnsureFolder("Assets/Prefabs/World/Terrain");
            EnsureFolder("Assets/Scenes/ArtReview");
            EnsureFolder("Assets/Art/World/HighFidelity/Meshes");
            EnsureFolder("Assets/Art/World/HighFidelity/Materials");
            EnsureFolder("Assets/Art/World/HighFidelity/ReviewCaptures");
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            var name = Path.GetFileName(path);
            if (string.IsNullOrWhiteSpace(parent) || string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException($"Invalid asset folder: {path}.");
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        private static Color Hex(string value)
        {
            return ColorUtility.TryParseHtmlString("#" + value, out var color)
                ? color
                : throw new InvalidOperationException($"Invalid color: {value}.");
        }
    }
}
