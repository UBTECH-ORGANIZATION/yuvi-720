using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Yuvi720.LearningWorld.Editor;

namespace Yuvi720.LearningWorld.Tests
{
    public sealed class WorldAssetFoundationTests
    {
        [Test]
        public void BrowserFacade_PublicMethodsRemainStable()
        {
            var expected = new[]
            {
                "Configure", "SetSelected", "Focus", "TravelTo",
                "ShowBlocked", "ResetCamera", "SetPaused"
            };
            var type = typeof(LearningWorldController);
            foreach (var methodName in expected)
            {
                var method = type.GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public, null, new[] { typeof(string) }, null);
                Assert.That(method, Is.Not.Null, $"Missing browser method: {methodName}(string).");
                Assert.That(method.ReturnType, Is.EqualTo(typeof(void)), $"{methodName} must return void.");
            }
        }

        [Test]
        public void BrowserEvents_MatchReactContract()
        {
            var actual = typeof(WorldBrowserEvents)
                .GetFields(BindingFlags.Public | BindingFlags.Static)
                .Where(field => field.IsLiteral && field.FieldType == typeof(string))
                .Select(field => (string)field.GetRawConstantValue())
                .OrderBy(value => value)
                .ToArray();
            var expected = new[]
            {
                "avatar-projection", "blocked", "bridge-blocked", "error", "landmark-select", "ready",
                "runtime-ready", "stats", "travel-complete", "yubi-interact"
            };
            Assert.That(actual, Is.EqualTo(expected));
        }

        [Test]
        public void WorldLayout_StartsAtLeftEntranceThenRevealsDistrictsRightAndUpRight()
        {
            var controllerType = typeof(LearningWorldController);
            var buildCenters = controllerType.GetMethod("BuildDistrictCenters", BindingFlags.NonPublic | BindingFlags.Static);
            var calculateEntrance = controllerType.GetMethod("CalculateWorldEntrance", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(buildCenters, Is.Not.Null);
            Assert.That(calculateEntrance, Is.Not.Null);

            var centers = (Vector3[])buildCenters.Invoke(null, new object[] { 5 });
            var entrance = (Vector3)calculateEntrance.Invoke(null, new object[] { centers });

            Assert.That(entrance.x, Is.LessThan(centers.Min(center => center.x) - 5f));
            Assert.That(entrance.z, Is.LessThan(centers[0].z));

            var rightSteps = 0;
            var upRightSteps = 0;
            for (var index = 1; index < centers.Length; index++)
            {
                Assert.That(centers[index].x, Is.GreaterThan(centers[index - 1].x));
                Assert.That(centers[index].z, Is.GreaterThanOrEqualTo(centers[index - 1].z));
                if (Mathf.Approximately(centers[index].z, centers[index - 1].z)) rightSteps++;
                else upRightSteps++;
            }

            Assert.That(rightSteps, Is.GreaterThan(0));
            Assert.That(upRightSteps, Is.GreaterThan(0));
        }

        [Test]
        public void WorldConfig_RoundTripsStableFields()
        {
            var source = new WorldConfig
            {
                subject = "science",
                currentLandmarkId = "landmark-1",
                reducedMotion = true,
                lowPower = true,
                units = new[] { new UnitConfig { id = "unit-1", order = 1, reachable = true } },
                landmarks = new[]
                {
                    new LandmarkConfig { id = "landmark-1", unitId = "unit-1", state = "current", displayIndex = 1 }
                }
            };
            var restored = JsonUtility.FromJson<WorldConfig>(JsonUtility.ToJson(source));
            Assert.That(restored.subject, Is.EqualTo("science"));
            Assert.That(restored.currentLandmarkId, Is.EqualTo("landmark-1"));
            Assert.That(restored.reducedMotion, Is.True);
            Assert.That(restored.lowPower, Is.True);
            Assert.That(restored.units.Single().id, Is.EqualTo("unit-1"));
            Assert.That(restored.landmarks.Single().state, Is.EqualTo("current"));
        }

        [Test]
        public void Catalog_ContainsNoRuntimeLearnerStateFields()
        {
            var forbiddenTokens = new[] { "learner", "progress", "selected", "currentlandmark", "mastery" };
            var serializedFields = typeof(WorldAssetCatalog)
                .GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .Where(field => field.IsPublic || field.GetCustomAttribute<SerializeField>() != null)
                .Select(field => field.Name.ToLowerInvariant())
                .ToArray();
            foreach (var token in forbiddenTokens)
                Assert.That(serializedFields.Any(field => field.Contains(token)), Is.False, $"Catalog must not serialize {token} state.");
        }

        [Test]
        public void FoundationAssets_SatisfyContracts()
        {
            var issues = WorldAssetFoundationBuilder.ValidateFoundation();
            Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues));
        }

        [Test]
        public void DecorationTemplate_IsVisualOnly()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.DecorationPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(prefab.GetComponentsInChildren<Collider>(true), Is.Empty);
        }

        [Test]
        public void TerrainTemplate_WalkabilityIsInvisibleAndAreaBased()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.TerrainPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var traversal = prefab.GetComponent<WorldTraversalSurface>();
            Assert.That(traversal, Is.Not.Null);
            Assert.That(traversal.MovementRoot, Is.Not.Null);
            Assert.That(traversal.MovementRoot.GetComponentsInChildren<Collider>(true), Is.Not.Empty);
            Assert.That(traversal.MovementRoot.GetComponentsInChildren<Renderer>(true), Is.Empty,
                "Visible terrain and roads must not define Yubi's movement area.");
        }

        [Test]
        public void LandmarkTemplate_ProvidesLayeredPaperArtContract()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(WorldAssetFoundationBuilder.LandmarkPrefabPath);
            Assert.That(prefab, Is.Not.Null);

            var landmark = prefab.GetComponent<LandmarkVisual>();
            Assert.That(landmark, Is.Not.Null);
            Assert.That(landmark.VisualRoot, Is.Not.Null);

            var layers = landmark.VisualRoot.GetComponentsInChildren<WorldPaperLayer>(true);
            Assert.That(layers, Has.Length.EqualTo(3));
            Assert.That(layers.Count(layer => layer.ParallaxStrength > 0f), Is.EqualTo(2));
        }

        [Test]
        public void CentralLearningTree_ProvidesAnimationReadyMeshContract()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(CentralLearningTreeBuilder.PrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var landmark = prefab.GetComponent<LandmarkVisual>();
            Assert.That(landmark, Is.Not.Null);
            Assert.That(landmark.VisualRoot.GetComponentsInChildren<MeshRenderer>(true).Length, Is.GreaterThanOrEqualTo(6));
            Assert.That(landmark.GetComponentsInChildren<WorldWindElement>(true).Length, Is.GreaterThanOrEqualTo(2));
            Assert.That(landmark.GetComponentsInChildren<SpriteRenderer>(true), Is.Empty,
                "Production runtime visuals must not depend on SVG-derived sprites.");
            Assert.That(prefab.transform.Find("ObstacleFootprint").GetComponent<BoxCollider>(), Is.Not.Null);
            Assert.That(landmark.InteractionCollider.isTrigger, Is.True);
        }

        [Test]
        public void HighFidelityAssetFamilies_PassProductionValidation()
        {
            Assert.DoesNotThrow(HighFidelityTerrainAssetBuilder.ValidateMeadowPathFamily);
            var treeIssues = HighFidelityWorldAssetBuilder.ValidateCentralLearningTree();
            Assert.That(treeIssues, Is.Empty, string.Join(Environment.NewLine, treeIssues));
        }

        [Test]
        public void FirstConnectedSection_PreservesInvisibleTraversalAndExternalAvatarOwnership()
        {
            var issues = HighFidelityFirstSectionBuilder.ValidateFirstConnectedSection();
            Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues));

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityFirstSectionBuilder.SectionPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var terrain = prefab.GetComponentInChildren<TerrainVisual>(true);
            Assert.That(terrain, Is.Not.Null);
            Assert.That(terrain.MovementZonesRoot.GetComponentsInChildren<Collider>(true), Is.Not.Empty);
            Assert.That(terrain.MovementZonesRoot.GetComponentsInChildren<Renderer>(true), Is.Empty);
            Assert.That(prefab.GetComponentsInChildren<YubiTarget>(true), Is.Empty,
                "The section must not add a visible or interactive Unity Yubi; React/Three.js owns the avatar presentation.");
        }

        [Test]
        public void FirstConnectedSection_RouteProgressesFromLeftTowardRightAndUpRight()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityFirstSectionBuilder.SectionPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var route = prefab.transform.Find(HighFidelityFirstSectionBuilder.RouteAnchorsName);
            Assert.That(route, Is.Not.Null);
            var start = route.Find("Start");
            var approach = route.Find("TreeApproach");
            var exit = route.Find("Exit");
            Assert.That(start, Is.Not.Null);
            Assert.That(approach, Is.Not.Null);
            Assert.That(exit, Is.Not.Null);
            Assert.That(start.position.x, Is.LessThan(approach.position.x));
            Assert.That(approach.position.x, Is.LessThan(exit.position.x));
            Assert.That(start.position.z, Is.LessThanOrEqualTo(approach.position.z));
            Assert.That(approach.position.z, Is.LessThanOrEqualTo(exit.position.z));
        }

        [Test]
        public void FirstConnectedSection_HasOneStaticWholeSectionView()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityFirstSectionBuilder.SectionPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var view = prefab.GetComponentsInChildren<WorldSectionView>(true).SingleOrDefault();
            Assert.That(view, Is.Not.Null, "Each section must author exactly one viewpoint.");
            var issues = new List<string>();
            view.CollectValidationIssues(issues);
            Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues));
            Assert.That(view.CoverageVolume.isTrigger, Is.True);
            Assert.That(view.CoverageVolume.GetComponent<Renderer>(), Is.Null);
            Assert.That(view.AtmosphereRoot, Is.Not.Null);
            Assert.That(view.AtmosphereRoot.GetComponentsInChildren<Collider>(true), Is.Empty);
        }

        [Test]
        public void SectionCamera_RemainsStaticUntilSectionChangesThenTransitions()
        {
            var cameraObject = new GameObject("SectionCameraTest");
            var sectionA = new GameObject("SectionA");
            var sectionB = new GameObject("SectionB");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                var first = CreateTestSectionView(sectionA.transform, "first", Vector3.zero, new Vector3(0f, 10f, -8f), 8f);
                var second = CreateTestSectionView(sectionB.transform, "second", new Vector3(12f, 0f, 3f), new Vector3(12f, 12f, -6f), 10f);
                var director = cameraObject.AddComponent<WorldSectionCameraController>();
                director.Configure(camera, new[] { first, second }, Vector3.zero, false);

                var heldPosition = camera.transform.position;
                var heldSize = camera.orthographicSize;
                director.Tick(new Vector3(2f, 0f, 1f), .5f);
                Assert.That(camera.transform.position, Is.EqualTo(heldPosition));
                Assert.That(camera.orthographicSize, Is.EqualTo(heldSize));

                director.Tick(new Vector3(12f, 0f, 3f), .2f);
                Assert.That(director.TargetSectionId, Is.EqualTo("second"));
                Assert.That(director.IsTransitioning, Is.True);
                Assert.That(camera.transform.position, Is.Not.EqualTo(second.CameraAnchor.position));
                director.Tick(new Vector3(12f, 0f, 3f), 2f);
                Assert.That(director.CurrentSectionId, Is.EqualTo("second"));
                Assert.That(camera.transform.position, Is.EqualTo(second.CameraAnchor.position));
                Assert.That(camera.orthographicSize, Is.EqualTo(second.OrthographicSize));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(sectionA);
                UnityEngine.Object.DestroyImmediate(sectionB);
            }
        }

        private static WorldSectionView CreateTestSectionView(
            Transform root,
            string id,
            Vector3 center,
            Vector3 cameraPosition,
            float size)
        {
            root.position = center;
            var anchor = new GameObject("CameraAnchor").transform;
            anchor.SetParent(root, false);
            anchor.position = cameraPosition;
            anchor.rotation = Quaternion.Euler(54f, 0f, 0f);
            var volume = new GameObject("CoverageVolume");
            volume.transform.SetParent(root, false);
            var box = volume.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.center = new Vector3(0f, 2f, 0f);
            box.size = new Vector3(10f, 8f, 10f);
            var atmosphere = new GameObject("AtmosphereRoot").transform;
            atmosphere.SetParent(root, false);
            var view = root.gameObject.AddComponent<WorldSectionView>();
            view.Configure(id, anchor, box, atmosphere, size);
            return view;
        }

        [Test]
        public void FirstConnectedSection_SharedMotionControllerDiscoversTerrainAndTreeWind()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityFirstSectionBuilder.SectionPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var instance = UnityEngine.Object.Instantiate(prefab);
            var systems = new GameObject("MotionTestSystems");
            try
            {
                var terrain = instance.transform.Find(HighFidelityFirstSectionBuilder.TerrainInstanceName);
                var tree = instance.transform.Find(HighFidelityFirstSectionBuilder.TreeInstanceName);
                Assert.That(terrain, Is.Not.Null);
                Assert.That(tree, Is.Not.Null);
                Assert.That(terrain.GetComponentsInChildren<WorldWindElement>(true), Is.Not.Empty);
                Assert.That(tree.GetComponentsInChildren<WorldWindElement>(true), Is.Not.Empty);

                var controller = systems.AddComponent<WorldMotionController>();
                controller.Configure(instance.transform, false, false);
                Assert.That(controller.ElementCount,
                    Is.EqualTo(instance.GetComponentsInChildren<WorldWindElement>(true).Length));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(systems);
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void FirstConnectedSection_ReviewSceneProvidesExplicitPresentationContract()
        {
            Assert.That(AssetDatabase.LoadAssetAtPath<SceneAsset>(HighFidelityFirstSectionBuilder.SectionReviewScenePath),
                Is.Not.Null);
            var scene = EditorSceneManager.OpenScene(
                HighFidelityFirstSectionBuilder.SectionReviewScenePath,
                OpenSceneMode.Additive);
            try
            {
                var roots = scene.GetRootGameObjects();
                var camera = roots.SelectMany(root => root.GetComponentsInChildren<Camera>(true)).SingleOrDefault();
                Assert.That(camera, Is.Not.Null);
                Assert.That(camera.CompareTag("MainCamera"), Is.True);
                Assert.That(camera.GetComponent<AudioListener>(), Is.Not.Null);
                Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<Light>(true)), Is.Not.Empty);

                var section = roots.SingleOrDefault(root => root.name == "MeadowTree_FirstConnectionReview");
                Assert.That(section, Is.Not.Null);
                Assert.That(section.GetComponentInChildren<TerrainVisual>(true), Is.Not.Null);
                Assert.That(section.GetComponentInChildren<LandmarkVisual>(true), Is.Not.Null);

                var controller = roots.SelectMany(root => root.GetComponentsInChildren<WorldMotionController>(true))
                    .SingleOrDefault();
                Assert.That(controller, Is.Not.Null);
                controller.RefreshElements();
                Assert.That(controller.ElementCount, Is.GreaterThan(0));
            }
            finally
            {
                EditorSceneManager.CloseScene(scene, true);
            }
        }

        [Test]
        public void WoodlandArchitecture_ProvidesTwoDistinctDimensionalBuildingTypes()
        {
            Assert.That(HighFidelityWorldAssetBuilder.ValidateArchiveHall(), Is.Empty);
            Assert.That(HighFidelityWorldAssetBuilder.ValidateStoryPavilion(), Is.Empty);
            var archive = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityWorldAssetBuilder.ArchiveHallPrefabPath);
            var pavilion = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityWorldAssetBuilder.StoryPavilionPrefabPath);
            Assert.That(archive, Is.Not.Null);
            Assert.That(pavilion, Is.Not.Null);
            Assert.That(archive.GetComponentsInChildren<MeshRenderer>(true).Length, Is.GreaterThan(40));
            Assert.That(pavilion.GetComponentsInChildren<MeshRenderer>(true).Length, Is.GreaterThan(25));
            Assert.That(archive.GetComponentsInChildren<SpriteRenderer>(true), Is.Empty);
            Assert.That(pavilion.GetComponentsInChildren<SpriteRenderer>(true), Is.Empty);
        }

        [Test]
        public void WoodlandAtmosphere_IsVisualOnlyAndMotionReady()
        {
            Assert.That(HighFidelityWorldAssetBuilder.ValidateWoodlandAtmosphere(), Is.Empty);
            var atmosphere = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityWorldAssetBuilder.WoodlandAtmospherePrefabPath);
            Assert.That(atmosphere, Is.Not.Null);
            Assert.That(atmosphere.GetComponentsInChildren<Collider>(true), Is.Empty);
            Assert.That(atmosphere.GetComponentsInChildren<WorldWindElement>(true).Length, Is.GreaterThanOrEqualTo(4));
        }

        [Test]
        public void SecondConnectedSection_PreservesRouteCameraAndAvatarContracts()
        {
            var issues = HighFidelitySecondSectionBuilder.ValidateSecondConnectedSection();
            Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues));
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelitySecondSectionBuilder.SectionPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(prefab.GetComponentsInChildren<WorldSectionView>(true), Has.Length.EqualTo(1));
            Assert.That(prefab.GetComponentsInChildren<LandmarkVisual>(true), Has.Length.EqualTo(2));
            Assert.That(prefab.GetComponentsInChildren<YubiTarget>(true), Is.Empty);

            var first = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityFirstSectionBuilder.SectionPrefabPath);
            var firstExit = first.transform.Find(HighFidelityFirstSectionBuilder.RouteAnchorsName + "/Exit");
            var secondStart = prefab.transform.Find(HighFidelitySecondSectionBuilder.RouteAnchorsName + "/Start");
            var connectedStart = secondStart.position + HighFidelitySecondSectionBuilder.CombinedSectionOffset;
            Assert.That(Vector3.Distance(firstExit.position, connectedStart), Is.LessThan(.01f));
            Assert.That(connectedStart.x, Is.GreaterThan(0f));
            Assert.That(connectedStart.z, Is.GreaterThan(0f));
        }

        [Test]
        public void SecondConnectedSection_SharedMotionDiscoversBuildingsAndAtmosphere()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelitySecondSectionBuilder.SectionPrefabPath);
            var instance = UnityEngine.Object.Instantiate(prefab);
            try
            {
                var controller = instance.AddComponent<WorldMotionController>();
                controller.Configure(instance.transform, false, false);
                Assert.That(controller.ElementCount,
                    Is.EqualTo(instance.GetComponentsInChildren<WorldWindElement>(true).Length));
                Assert.That(controller.ElementCount, Is.GreaterThanOrEqualTo(9));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void GroundingApprovalWorld_IsGroundOnlyAndUsesIrregularDimensionalSections()
        {
            var issues = HighFidelityGroundingWorldBuilder.ValidateGroundingWorld();
            Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues));
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityGroundingWorldBuilder.PrefabPath);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(prefab.GetComponentsInChildren<LandmarkVisual>(true), Is.Empty);
            Assert.That(prefab.GetComponentsInChildren<WorldWindElement>(true), Is.Empty);
            Assert.That(prefab.GetComponentsInChildren<SpriteRenderer>(true), Is.Empty);
            Assert.That(prefab.GetComponentsInChildren<YubiTarget>(true), Is.Empty);

            var terrain = prefab.GetComponent<TerrainVisual>();
            Assert.That(terrain, Is.Not.Null);
            Assert.That(terrain.VisualRoot.GetComponentsInChildren<MeshRenderer>(true)
                .Count(renderer => renderer.name.StartsWith("GroundSection-", StringComparison.Ordinal)),
                Is.EqualTo(3));
            Assert.That(terrain.VisualRoot.GetComponentsInChildren<Renderer>(true)
                .Any(renderer => renderer.name.Contains("MeadowBase", StringComparison.OrdinalIgnoreCase)), Is.False);
        }

        [Test]
        public void GroundingApprovalWorld_SeparatesInvisibleTraversalAndStructuralConnectors()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityGroundingWorldBuilder.PrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var terrain = prefab.GetComponent<TerrainVisual>();
            var traversal = prefab.GetComponent<WorldTraversalSurface>();
            Assert.That(terrain, Is.Not.Null);
            Assert.That(traversal, Is.Not.Null);
            Assert.That(terrain.MovementZonesRoot.GetComponentsInChildren<Collider>(true).Length,
                Is.GreaterThanOrEqualTo(5));
            Assert.That(terrain.MovementZonesRoot.GetComponentsInChildren<Renderer>(true), Is.Empty);

            var bridges = prefab.GetComponentsInChildren<BridgeVisual>(true);
            Assert.That(bridges, Has.Length.EqualTo(2));
            foreach (var bridge in bridges)
            {
                var bridgeIssues = new List<string>();
                bridge.CollectValidationIssues(bridgeIssues);
                Assert.That(bridgeIssues, Is.Empty, string.Join(Environment.NewLine, bridgeIssues));
                Assert.That(bridge.WalkSurface.GetComponent<Renderer>(), Is.Null);
                Assert.That(Vector3.Distance(bridge.StartAnchor.position, bridge.EndAnchor.position), Is.GreaterThan(2f));
            }
        }

        [Test]
        public void GroundingApprovalWorld_AuthorsOneStaticWholeViewPerSection()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HighFidelityGroundingWorldBuilder.PrefabPath);
            Assert.That(prefab, Is.Not.Null);
            var views = prefab.GetComponentsInChildren<WorldSectionView>(true);
            Assert.That(views, Has.Length.EqualTo(3));
            Assert.That(views.Select(view => view.SectionId).Distinct().Count(), Is.EqualTo(3));
            foreach (var view in views)
            {
                var viewIssues = new List<string>();
                view.CollectValidationIssues(viewIssues);
                Assert.That(viewIssues, Is.Empty, string.Join(Environment.NewLine, viewIssues));
                Assert.That(view.CoverageVolume.isTrigger, Is.True);
                Assert.That(view.CoverageVolume.GetComponent<Renderer>(), Is.Null);
                Assert.That(view.AtmosphereRoot.childCount, Is.EqualTo(0));
            }
        }

        [Test]
        public void BulkWorldCatalog_ResolvesCompleteAnimationReadyManifest()
        {
            var issues = BulkWorldAssetBuilder.ValidateEntireWorld();
            Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues));

            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath);
            foreach (var id in BulkWorldAssetBuilder.ProductionAssetIds)
            {
                Assert.That(catalog.TryResolve(id, false, out var prefab), Is.True, id);
                Assert.That(prefab, Is.Not.Null, id);
            }
        }

        [Test]
        public void MotionController_CentralizesWindAndHonorsReducedMotion()
        {
            var root = new GameObject("MotionTest");
            try
            {
                var pivot = new GameObject("WindPivot").transform;
                pivot.SetParent(root.transform, false);
                pivot.gameObject.AddComponent<WorldWindElement>();
                var controller = root.AddComponent<WorldMotionController>();
                controller.Configure(root.transform, true, false);
                Assert.That(controller.ElementCount, Is.EqualTo(1));
                Assert.That(pivot.gameObject.GetComponents<MonoBehaviour>().Count(component => component is WorldWindElement), Is.EqualTo(1));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void TraversalSurface_ProjectsOntoRaisedWalkableArea()
        {
            var root = new GameObject("TraversalTest");
            try
            {
                var movement = new GameObject("MovementZones").transform;
                movement.SetParent(root.transform, false);
                var terrace = new GameObject("Terrace");
                terrace.transform.SetParent(movement, false);
                terrace.transform.localPosition = new Vector3(0f, .25f, 0f);
                terrace.AddComponent<BoxCollider>().size = new Vector3(6f, .5f, 6f);
                var surface = root.AddComponent<WorldTraversalSurface>();
                surface.AssignMovementRoot(movement);

                Assert.That(surface.TryProjectInitial(new Vector3(0f, .85f, 0f), out var projected), Is.True);
                Assert.That(projected.y, Is.EqualTo(1.35f).Within(.01f));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void TraversalSurface_AllowsSlopeButRejectsAbruptRise()
        {
            var root = new GameObject("TraversalTestRoot");
            try
            {
                var movement = new GameObject("MovementZones").transform;
                movement.SetParent(root.transform, false);
                var ramp = new GameObject("Ramp");
                ramp.transform.SetParent(movement, false);
                ramp.transform.SetLocalPositionAndRotation(new Vector3(0f, .5f, 0f), Quaternion.Euler(-14f, 0f, 0f));
                ramp.AddComponent<BoxCollider>().size = new Vector3(2f, .2f, 2f);

                var traversal = root.AddComponent<WorldTraversalSurface>();
                traversal.EditorAssignContract(movement);
                Assert.That(traversal.TryProjectStep(Vector3.zero, 0f, out var slopeProjection), Is.True);
                Assert.That(slopeProjection.y, Is.GreaterThan(1.3f));

                ramp.transform.SetLocalPositionAndRotation(new Vector3(0f, .6f, 0f), Quaternion.identity);
                ramp.GetComponent<BoxCollider>().size = new Vector3(2f, 1.2f, 2f);
                traversal.RefreshSurfaceCache();
                Assert.That(traversal.TryProjectStep(Vector3.zero, 0f, out _), Is.False);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void TraversalSurface_PrunesDestroyedCachedCollidersBeforeMovement()
        {
            var root = new GameObject("TraversalCacheTestRoot");
            try
            {
                var movement = new GameObject("MovementZones").transform;
                movement.SetParent(root.transform, false);
                var walkable = new GameObject("Walkable");
                walkable.transform.SetParent(movement, false);
                walkable.AddComponent<BoxCollider>().size = new Vector3(4f, .2f, 4f);
                var stale = new GameObject("StaleWalkable");
                stale.transform.SetParent(movement, false);
                var staleCollider = stale.AddComponent<BoxCollider>();

                var traversal = root.AddComponent<WorldTraversalSurface>();
                traversal.EditorAssignContract(movement);
                UnityEngine.Object.DestroyImmediate(stale);

                var surfacesField = typeof(WorldTraversalSurface).GetField("surfaces", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(surfacesField, Is.Not.Null);
                var cachedSurfaces = (List<Collider>)surfacesField.GetValue(traversal);
                cachedSurfaces.Insert(0, staleCollider);

                Assert.DoesNotThrow(() => traversal.TryProjectStep(Vector3.zero, 0f, out _));
                Assert.That(traversal.TryProjectStep(Vector3.zero, 0f, out var projected), Is.True);
                Assert.That(projected.y, Is.EqualTo(.95f).Within(.01f));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void ObstacleFootprints_BlockPlayerMovementButInteractionTriggersDoNot()
        {
            var controllerObject = new GameObject("ObstacleMovementTestController");
            var obstacleObject = new GameObject("ObstacleFootprint");
            var triggerObject = new GameObject("InteractionTrigger");
            try
            {
                var controller = controllerObject.AddComponent<LearningWorldController>();
                var obstacle = obstacleObject.AddComponent<BoxCollider>();
                obstacle.center = new Vector3(0f, 1.25f, 0f);
                obstacle.size = new Vector3(2.15f, 2.5f, 1.5f);
                var trigger = triggerObject.AddComponent<BoxCollider>();
                triggerObject.transform.position = new Vector3(0f, 0f, -3f);
                trigger.center = new Vector3(0f, 1.25f, 0f);
                trigger.size = new Vector3(2.15f, 2.5f, 1.5f);
                trigger.isTrigger = true;

                var footprintsField = typeof(LearningWorldController).GetField("obstacleFootprints", BindingFlags.Instance | BindingFlags.NonPublic);
                var blockedMethod = typeof(LearningWorldController).GetMethod("IsBlockedByObstacle", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(footprintsField, Is.Not.Null);
                Assert.That(blockedMethod, Is.Not.Null);
                var footprints = (List<Collider>)footprintsField.GetValue(controller);
                footprints.Add(obstacle);
                footprints.Add(trigger);
                Physics.SyncTransforms();

                Assert.That((bool)blockedMethod.Invoke(controller, new object[] { new Vector3(0f, .85f, 0f) }), Is.True);
                Assert.That((bool)blockedMethod.Invoke(controller, new object[] { new Vector3(0f, .85f, -3f) }), Is.False);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(triggerObject);
                UnityEngine.Object.DestroyImmediate(obstacleObject);
                UnityEngine.Object.DestroyImmediate(controllerObject);
            }
        }

        [Test]
        public void Catalog_ResolvesEveryFoundationPrefab()
        {
            var catalog = AssetDatabase.LoadAssetAtPath<WorldAssetCatalog>(WorldAssetFoundationBuilder.CatalogPath);
            Assert.That(catalog, Is.Not.Null);
            var expectedIds = new[]
            {
                "terrain.template", "landmark.template", "bridge.template", "decoration.template",
                CentralLearningTreeBuilder.AssetId
            };
            foreach (var id in expectedIds)
            {
                Assert.That(catalog.TryResolve(id, false, out var prefab), Is.True, id);
                Assert.That(prefab, Is.Not.Null, id);
            }
        }
    }
}