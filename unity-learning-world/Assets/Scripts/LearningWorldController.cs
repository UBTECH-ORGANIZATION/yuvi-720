using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    public sealed class LearningWorldController : MonoBehaviour
    {
        private const float PlayerSpeed = 7.2f;
        private const float DefaultCameraSize = 7.5f;
        private const float SectionCameraSize = 10.8f;
        private const float DistrictHorizontalSpacing = 10.5f;
        private const float DistrictRise = 5.5f;
        private const float PlayerColliderRadius = 1.2f;
        private const string CentralLearningTreeAssetId = "landmark.central-learning-tree";
        private const string YubiAssetId = "character.yubi";
        private static readonly Vector3 CameraOffset = new(0f, 11.5f, -8.5f);
        private static readonly Vector3 PlayerColliderCenter = new(0f, 1.8f, 0f);
        private static readonly Vector3 WorldEntranceOffset = new(-7f, .85f, -1.5f);
        private static readonly string[] LandmarkAssetIds =
        {
            "landmark.welcome-harbor",
            "landmark.maker-meadow",
            "landmark.story-grove",
            "landmark.archive-hill",
            "landmark.observation-ridge",
            "landmark.reflection-gardens",
            "landmark.mentor-lodge",
            "landmark.challenge-crossing"
        };
        private static readonly string[] DecorationAssetIds =
        {
            "vegetation.tree.round",
            "vegetation.tree.coastal",
            "vegetation.tree.story",
            "vegetation.tree.willow",
            "vegetation.tree.pine",
            "vegetation.tree.orchard",
            "vegetation.bush.flowers",
            "vegetation.grass.reeds",
            "geology.rock-cluster",
            "prop.bench",
            "prop.lantern",
            "prop.crates"
        };
        private static readonly string[] BridgeAssetIds =
        {
            "bridge.rope",
            "bridge.timber",
            "bridge.stone",
            "bridge.garden",
            "bridge.drawbridge",
            "bridge.stepping-stones",
            "bridge.boardwalk"
        };

        private readonly Dictionary<string, LandmarkView> landmarks = new();
        private readonly List<Collider> obstacleFootprints = new();
        private readonly Queue<Vector3> route = new();

        private Camera worldCamera;
        [SerializeField] private WorldAssetCatalog assetCatalog;
        private Transform worldRoot;
        private WorldTraversalSurface traversalSurface;
        private WorldMotionController motionController;
        private WorldSectionCameraController sectionCameraController;
        private Transform player;
        private Transform playerBody;
        private WorldConfig config;
        private string selectedId;
        private string travellingId;
        private float statsTimer;
        private float avatarProjectionTimer;
        private int frames;
        private Vector3 lastAvatarProjectionPosition;
        private string avatarHeading = "down";
        private bool configured;
        private bool pointerWasDown;
        private Vector3 pointerStart;

        private static readonly Color MathWater = new(0.10f, 0.24f, 0.52f);
        private static readonly Color ScienceWater = new(0.06f, 0.31f, 0.31f);

        private sealed class LandmarkView
        {
            public LandmarkConfig data;
            public Transform root;
            public Renderer[] renderers;
            public Vector3 approach;
        }

        private void Awake()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 0;
            BuildCamera();
            YuviBrowserBridge.Emit(WorldBrowserEvents.RuntimeReady);
        }

        public void Configure(string json)
        {
            WorldConfig parsed;
            try
            {
                parsed = JsonUtility.FromJson<WorldConfig>(json);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                YuviBrowserBridge.Emit(WorldBrowserEvents.Error, "invalid-config");
                return;
            }

            if (parsed == null || parsed.units == null || parsed.landmarks == null)
            {
                YuviBrowserBridge.Emit(WorldBrowserEvents.Error, "missing-config");
                return;
            }

            config = parsed;
            ClearWorld();
            BuildWorld();
            if (player == null) return;
            configured = true;
            selectedId = config.selectedLandmarkId;
            UpdateSelection();
            YuviBrowserBridge.Emit(WorldBrowserEvents.Ready);
        }

        public void SetSelected(string landmarkId)
        {
            selectedId = landmarkId;
            UpdateSelection();
        }

        public void Focus(string landmarkId)
        {
            if (!landmarks.TryGetValue(landmarkId, out var landmark)) return;
            selectedId = landmarkId;
            UpdateSelection();
        }

        public void TravelTo(string landmarkId)
        {
            if (!landmarks.TryGetValue(landmarkId, out var destination)) return;
            if (destination.data.state == "locked")
            {
                ShowBlocked(landmarkId);
                return;
            }

            route.Clear();
            travellingId = landmarkId;
            selectedId = landmarkId;
            BuildRoute(player.position, destination.approach, destination.data.unitIndex);
            UpdateSelection();
        }

        public void ShowBlocked(string landmarkId)
        {
            if (landmarks.TryGetValue(landmarkId, out var landmark))
            {
                StartCoroutine(PulseBlocked(landmark));
            }
            YuviBrowserBridge.Emit(WorldBrowserEvents.Blocked, landmarkId);
        }

        public void ResetCamera(string unused = "")
        {
            if (player != null && sectionCameraController != null)
                sectionCameraController.ResetToPosition(player.position, false);
        }

        public void SetPaused(string paused)
        {
            var isPaused = paused == "1";
            Time.timeScale = isPaused ? 0f : 1f;
            if (motionController != null) motionController.SetPaused(isPaused);
        }

        private void Update()
        {
            if (!configured || player == null) return;
            HandleKeyboard();
            HandlePointer();
            FollowRoute();
            AnimatePlayer();
            UpdateCamera();
            UpdateAvatarProjection();
            UpdateStats();
        }

        private void BuildCamera()
        {
            worldCamera = Camera.main;
            if (worldCamera == null)
            {
                var cameraObject = new GameObject("WorldCamera");
                worldCamera = cameraObject.AddComponent<Camera>();
                cameraObject.tag = "MainCamera";
            }
            worldCamera.orthographic = true;
            worldCamera.orthographicSize = SectionCameraSize;
            worldCamera.transform.rotation = Quaternion.Euler(54f, 0f, 0f);
            worldCamera.clearFlags = CameraClearFlags.SolidColor;
            worldCamera.backgroundColor = MathWater;
            worldCamera.nearClipPlane = .1f;
            worldCamera.farClipPlane = 120f;
            var light = FindObjectsByType<Light>(FindObjectsSortMode.None)
                .FirstOrDefault(candidate => candidate.type == LightType.Directional);
            if (light == null)
            {
                var lightObject = new GameObject("Sun");
                light = lightObject.AddComponent<Light>();
            }
            light.type = LightType.Directional;
            light.color = new Color(1f, .91f, .72f);
            light.intensity = 1.25f;
            light.shadows = LightShadows.Soft;
            light.transform.rotation = Quaternion.Euler(46f, -32f, 0f);

            RenderSettings.ambientLight = new Color(.52f, .60f, .74f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = .006f;
            RenderSettings.fogColor = new Color(.48f, .72f, .84f);
        }

        private void ClearWorld()
        {
            configured = false;
            landmarks.Clear();
            obstacleFootprints.Clear();
            route.Clear();
            traversalSurface = null;
            motionController = null;
            sectionCameraController = null;
            if (worldRoot != null) Destroy(worldRoot.gameObject);
        }

        private void BuildWorld()
        {
            worldRoot = new GameObject("GeneratedLearningWorld").transform;
            if (assetCatalog == null)
            {
                Debug.LogError("WorldAssetCatalog is not assigned. Authored visuals are required.");
                YuviBrowserBridge.Emit(WorldBrowserEvents.Error, "missing-visual-catalog");
                return;
            }
            worldCamera.backgroundColor = config.subject == "science" ? ScienceWater : MathWater;

            var centers = BuildDistrictCenters(config.units.Length);
            var terrainRoot = InstantiateVisual("terrain.template", Vector3.zero, "ContinuousWorldTerrain");
            var terrainVisual = terrainRoot.GetComponent<TerrainVisual>();
            if (terrainVisual == null || terrainVisual.MovementZonesRoot == null)
                throw new InvalidOperationException("The terrain prefab requires an authored MovementZones root.");
            traversalSurface = terrainRoot.GetComponent<WorldTraversalSurface>()
                ?? terrainRoot.gameObject.AddComponent<WorldTraversalSurface>();
            BuildContinuousMovementSurface(terrainVisual.MovementZonesRoot, centers);
            traversalSurface.AssignMovementRoot(terrainVisual.MovementZonesRoot);

            for (var index = 0; index < config.units.Length; index++)
            {
                BuildDistrict(config.units[index], index, centers[index]);
            }

            BuildPlayer();
            var systems = new GameObject("WorldSystems");
            systems.transform.SetParent(worldRoot, false);
            motionController = systems.AddComponent<WorldMotionController>();
            motionController.Configure(worldRoot, config.reducedMotion, config.lowPower);
            var spawn = CalculateWorldEntrance(centers);
            player.position = ProjectToSurface(spawn);
            lastAvatarProjectionPosition = player.position;
            var sectionViews = BuildSectionViews(centers);
            sectionCameraController = systems.AddComponent<WorldSectionCameraController>();
            sectionCameraController.Configure(worldCamera, sectionViews, player.position, config.reducedMotion);
        }

        private WorldSectionView[] BuildSectionViews(IReadOnlyList<Vector3> centers)
        {
            var root = new GameObject("SectionViews").transform;
            root.SetParent(worldRoot, false);
            var views = new WorldSectionView[centers.Count];
            for (var index = 0; index < centers.Count; index++)
            {
                var section = new GameObject($"SectionView-{index + 1:00}");
                section.transform.SetParent(root, false);
                section.transform.localPosition = centers[index];

                var anchor = new GameObject("CameraAnchor").transform;
                anchor.SetParent(section.transform, false);
                anchor.localPosition = CameraOffset;
                anchor.localRotation = Quaternion.Euler(54f, 0f, 0f);

                var volumeObject = new GameObject("CoverageVolume");
                volumeObject.transform.SetParent(section.transform, false);
                var volume = volumeObject.AddComponent<BoxCollider>();
                volume.isTrigger = true;
                volume.center = new Vector3(0f, 2f, 0f);
                volume.size = new Vector3(DistrictHorizontalSpacing + .8f, 8f, 14f);

                var view = section.AddComponent<WorldSectionView>();
                var sectionId = config.units != null && index < config.units.Length
                    ? config.units[index].id
                    : $"section-{index + 1}";
                view.Configure(sectionId, anchor, volume, null, SectionCameraSize);
                views[index] = view;
            }
            return views;
        }

        private static Vector3[] BuildDistrictCenters(int count)
        {
            if (count <= 0) return Array.Empty<Vector3>();
            var centers = new Vector3[count];
            for (var index = 0; index < count; index++)
            {
                centers[index] = new Vector3(
                    index * DistrictHorizontalSpacing,
                    0f,
                    index / 2 * DistrictRise);
            }
            return centers;
        }

        private static Vector3 CalculateWorldEntrance(IReadOnlyList<Vector3> centers)
        {
            var firstCenter = centers.Count > 0 ? centers[0] : Vector3.zero;
            return firstCenter + WorldEntranceOffset;
        }

        private void BuildContinuousMovementSurface(Transform movementRoot, IReadOnlyList<Vector3> centers)
        {
            for (var index = movementRoot.childCount - 1; index >= 0; index--)
            {
                var obsoleteArea = movementRoot.GetChild(index).gameObject;
                obsoleteArea.SetActive(false);
                Destroy(obsoleteArea);
            }

            var minimumX = centers.Count > 0 ? centers.Min(center => center.x) - 8f : -10f;
            var maximumX = centers.Count > 0 ? centers.Max(center => center.x) + 8f : 10f;
            var minimumZ = centers.Count > 0 ? centers.Min(center => center.z) - 7f : -8f;
            var maximumZ = centers.Count > 0 ? centers.Max(center => center.z) + 7f : 8f;

            CreateWalkableBox(
                movementRoot,
                "MainlandWalkableArea",
                new Vector3((minimumX + maximumX) * .5f, -.1f, (minimumZ + maximumZ) * .5f),
                new Vector3(maximumX - minimumX, .2f, maximumZ - minimumZ),
                Quaternion.identity);

            if (centers.Count < 2) return;
            var terraceCenter = centers[centers.Count - 1];
            const float terraceHeight = 1.2f;
            const float rampLength = 6f;
            var terraceSize = new Vector3(7.5f, terraceHeight, 5.5f);
            CreateWalkableBox(
                movementRoot,
                "RaisedTerraceWalkableArea",
                terraceCenter + new Vector3(0f, terraceHeight * .5f, 0f),
                terraceSize,
                Quaternion.identity);

            var rampAngle = Mathf.Atan2(terraceHeight, rampLength) * Mathf.Rad2Deg;
            CreateWalkableBox(
                movementRoot,
                "TerraceRampWalkableArea",
                terraceCenter + new Vector3(0f, terraceHeight * .5f, -terraceSize.z * .5f - rampLength * .5f),
                new Vector3(2.8f, .2f, Mathf.Sqrt(rampLength * rampLength + terraceHeight * terraceHeight)),
                Quaternion.Euler(-rampAngle, 0f, 0f));
        }

        private static void CreateWalkableBox(
            Transform movementRoot,
            string name,
            Vector3 localPosition,
            Vector3 size,
            Quaternion localRotation)
        {
            var area = new GameObject(name);
            area.transform.SetParent(movementRoot, false);
            area.transform.SetLocalPositionAndRotation(localPosition, localRotation);
            area.AddComponent<BoxCollider>().size = size;
        }

        private void BuildDistrict(UnitConfig unit, int index, Vector3 center)
        {
            var unitLandmarks = config.landmarks.Where(item => item.unitIndex == index).OrderBy(item => item.displayIndex).ToArray();
            var radiusX = Mathf.Clamp(7.2f + unitLandmarks.Length * .38f, 7.8f, 10.8f);
            var radiusZ = Mathf.Clamp(5.8f + unitLandmarks.Length * .25f, 6.2f, 8f);

            var revealed = index == 0 || unit.reachable;
            if (!revealed) BuildCloudCover(center, radiusX, radiusZ, index);

            for (var landmarkIndex = 0; landmarkIndex < unitLandmarks.Length; landmarkIndex++)
            {
                var data = unitLandmarks[landmarkIndex];
                var t = unitLandmarks.Length == 1 ? .5f : landmarkIndex / (float)(unitLandmarks.Length - 1);
                var x = center.x + Mathf.Lerp(-radiusX * .58f, radiusX * .58f, t);
                var z = center.z + Mathf.Sin(t * Mathf.PI * 2.1f + index * .7f) * radiusZ * .35f;
                BuildLandmark(data, ProjectToSurface(new Vector3(x, .85f, z)), revealed);
            }

            BuildDecorations(center, radiusX, radiusZ, index, unitLandmarks.Length);
            BuildBridgeFeature(center, index, revealed);
        }

        private void BuildLandmark(LandmarkConfig data, Vector3 position, bool revealed)
        {
            var useCentralLearningTree = landmarks.Count == 0
                && assetCatalog.TryResolve(CentralLearningTreeAssetId, config.lowPower, out var heroPrefab)
                && heroPrefab != null;
            var familyIndex = Mathf.Abs(data.unitIndex + data.displayIndex) % LandmarkAssetIds.Length;
            var assetId = useCentralLearningTree ? CentralLearningTreeAssetId : LandmarkAssetIds[familyIndex];
            if (!assetCatalog.TryResolve(assetId, config.lowPower, out _)) assetId = "landmark.template";
            var root = InstantiateVisual(assetId, position, $"Landmark-{data.id}");
            var hit = root.GetComponent<BoxCollider>() ?? root.gameObject.AddComponent<BoxCollider>();
            if (!useCentralLearningTree)
            {
                hit.size = new Vector3(3.3f, 5f, 3.3f);
                hit.center = new Vector3(0f, 1.9f, 0f);
            }
            var target = root.GetComponent<LandmarkTarget>() ?? root.gameObject.AddComponent<LandmarkTarget>();
            target.Id = data.id;
            var obstacleFootprint = root.Find("ObstacleFootprint")?.GetComponent<Collider>();
            if (obstacleFootprint != null && !obstacleFootprint.isTrigger)
                obstacleFootprints.Add(obstacleFootprint);
            var motionEnabled = !config.reducedMotion && !config.lowPower;
            foreach (var paperLayer in root.GetComponentsInChildren<WorldPaperLayer>(true))
                paperLayer.SetMotionEnabled(motionEnabled);
            var landmarkVisual = root.GetComponent<LandmarkVisual>();
            if (landmarkVisual != null)
            {
                landmarkVisual.SetMotionEnabled(motionEnabled);
                landmarkVisual.SetState(ParseLandmarkState(data.state, revealed));
            }
            var renderers = root.GetComponentsInChildren<Renderer>();
            foreach (var renderer in renderers)
            {
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
            landmarks[data.id] = new LandmarkView
            {
                data = data,
                root = root,
                renderers = renderers,
                approach = ProjectToSurface(position + new Vector3(0f, 0f, -2.2f))
            };
        }

        private void BuildDecorations(Vector3 center, float rx, float rz, int islandIndex, int landmarkCount)
        {
            _ = landmarkCount;
            var count = config.lowPower ? 9 : 18;
            for (var index = 0; index < count; index++)
            {
                var angle = (index * 2.399f + islandIndex * .71f) % (Mathf.PI * 2f);
                var radial = .58f + ((index * 37 + islandIndex * 11) % 30) / 100f;
                var position = ProjectToSurface(center + new Vector3(
                    Mathf.Cos(angle) * rx * radial,
                    .85f,
                    Mathf.Sin(angle) * rz * radial));
                var assetId = DecorationAssetIds[(index + islandIndex * 3) % DecorationAssetIds.Length];
                if (!assetCatalog.TryResolve(assetId, config.lowPower, out _)) assetId = "decoration.template";
                var decoration = InstantiateVisual(assetId, position, $"Decoration-{islandIndex}-{index}");
                decoration.localScale = Vector3.one * (.7f + index % 3 * .12f);
            }
        }

        private void BuildBridgeFeature(Vector3 center, int districtIndex, bool revealed)
        {
            var assetId = BridgeAssetIds[districtIndex % BridgeAssetIds.Length];
            if (!assetCatalog.TryResolve(assetId, config.lowPower, out _)) return;
            var position = ProjectToSurface(center + new Vector3(2.8f, .08f, 4.6f));
            var bridge = InstantiateVisual(assetId, position, $"Bridge-{districtIndex}");
            bridge.localRotation = Quaternion.Euler(0f, districtIndex % 2 == 0 ? 88f : 102f, 0f);
            var target = bridge.GetComponent<BridgeTarget>() ?? bridge.gameObject.AddComponent<BridgeTarget>();
            target.Index = districtIndex;
            var visual = bridge.GetComponent<BridgeVisual>();
            if (visual != null)
            {
                visual.SetUnlocked(revealed);
                visual.SetMotionEnabled(!config.reducedMotion && !config.lowPower);
            }
        }

        private void BuildCloudCover(Vector3 center, float rx, float rz, int seed)
        {
            var count = config.lowPower ? 8 : 15;
            for (var index = 0; index < count; index++)
            {
                var angle = index * 2.4f + seed;
                var assetId = assetCatalog.TryResolve("atmosphere.cloud", config.lowPower, out _)
                    ? "atmosphere.cloud"
                    : "decoration.template";
                InstantiateVisual(assetId,
                    center + new Vector3(Mathf.Cos(angle) * rx * .55f, 4.5f + index % 3 * .35f, Mathf.Sin(angle) * rz * .55f),
                    $"CloudCover-{seed}-{index}");
            }
        }

        private Transform InstantiateVisual(string assetId, Vector3 position, string instanceName)
        {
            if (!assetCatalog.TryResolve(assetId, config.lowPower, out var prefab) || prefab == null)
                throw new InvalidOperationException($"The authored visual prefab for {instanceName} is missing.");
            var instance = Instantiate(prefab, position, Quaternion.identity, worldRoot).transform;
            instance.name = instanceName;
            var decoration = instance.GetComponent<WorldDecorationVisual>();
            if (decoration != null) decoration.SetLowPower(config.lowPower);
            return instance;
        }

        private void BuildPlayer()
        {
            player = InstantiateVisual(YubiAssetId, Vector3.zero, "YuviPlayer");
            playerBody = player.Find("VisualRoot") ?? player;

            if (config.externalAvatar)
            {
                foreach (var renderer in player.GetComponentsInChildren<Renderer>(true))
                    renderer.enabled = false;
            }

            var collider = player.GetComponent<SphereCollider>() ?? player.gameObject.AddComponent<SphereCollider>();
            collider.radius = PlayerColliderRadius;
            collider.center = PlayerColliderCenter;
            var yubiTarget = player.GetComponent<YubiTarget>() ?? player.gameObject.AddComponent<YubiTarget>();
            yubiTarget.enabled = true;
        }

        private static WorldLandmarkVisualState ParseLandmarkState(string state, bool revealed)
        {
            if (!revealed || string.Equals(state, "locked", StringComparison.OrdinalIgnoreCase))
                return WorldLandmarkVisualState.Locked;
            if (string.Equals(state, "current", StringComparison.OrdinalIgnoreCase))
                return WorldLandmarkVisualState.Current;
            if (string.Equals(state, "completed", StringComparison.OrdinalIgnoreCase))
                return WorldLandmarkVisualState.Completed;
            return WorldLandmarkVisualState.Available;
        }

        private void HandleKeyboard()
        {
            if (route.Count > 0) return;
            var input = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));
            if (input.sqrMagnitude < .01f) return;
            input.Normalize();
            TryMove(player.position + input * PlayerSpeed * Time.deltaTime);
        }

        private void HandlePointer()
        {
            if (Input.GetMouseButtonDown(0))
            {
                pointerWasDown = true;
                pointerStart = Input.mousePosition;
            }
            if (!pointerWasDown || !Input.GetMouseButtonUp(0)) return;
            pointerWasDown = false;
            if (Vector3.Distance(pointerStart, Input.mousePosition) > 16f) return;

            var ray = worldCamera.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out var hit, 150f))
            {
                var landmarkTarget = hit.collider.GetComponentInParent<LandmarkTarget>();
                if (landmarkTarget != null)
                {
                    OnLandmarkClicked(landmarkTarget.Id);
                    return;
                }
                if (hit.collider.GetComponentInParent<YubiTarget>() != null)
                {
                    YuviBrowserBridge.Emit(WorldBrowserEvents.YubiInteract);
                    return;
                }
                var bridgeTarget = hit.collider.GetComponentInParent<BridgeTarget>();
                if (bridgeTarget != null)
                {
                    YuviBrowserBridge.Emit(WorldBrowserEvents.BridgeBlocked, bridgeTarget.Index.ToString());
                    return;
                }
                var candidate = hit.point;
                candidate.y = player.position.y;
                if (IsApproved(candidate))
                {
                    route.Clear();
                    route.Enqueue(candidate);
                    travellingId = null;
                }
            }
        }

        private void OnLandmarkClicked(string id)
        {
            if (!landmarks.TryGetValue(id, out var landmark)) return;
            selectedId = id;
            UpdateSelection();
            if (landmark.data.state == "locked")
            {
                ShowBlocked(id);
                return;
            }
            YuviBrowserBridge.Emit(WorldBrowserEvents.LandmarkSelect, id);
        }

        private void BuildRoute(Vector3 start, Vector3 destination, int destinationDistrict)
        {
            _ = start;
            _ = destinationDistrict;
            route.Enqueue(ProjectToSurface(destination));
        }

        private void FollowRoute()
        {
            if (route.Count == 0) return;
            var target = route.Peek();
            var delta = target - player.position;
            delta.y = 0;
            if (delta.magnitude < .12f)
            {
                player.position = new Vector3(target.x, player.position.y, target.z);
                route.Dequeue();
                if (route.Count == 0 && !string.IsNullOrEmpty(travellingId))
                {
                    var completedId = travellingId;
                    travellingId = null;
                    YuviBrowserBridge.Emit(WorldBrowserEvents.TravelComplete, completedId);
                }
                return;
            }
            var next = player.position + delta.normalized * Mathf.Min(delta.magnitude, PlayerSpeed * Time.deltaTime);
            TryMove(next, true);
        }

        private void TryMove(Vector3 candidate, bool routeMovement = false)
        {
            if (!TryProjectToSurface(candidate, out var projected)) return;
            if (IsBlockedByObstacle(projected))
            {
                if (routeMovement)
                {
                    route.Clear();
                    travellingId = null;
                }
                return;
            }
            var direction = projected - player.position;
            if (direction.sqrMagnitude > .001f)
            {
                player.rotation = Quaternion.Slerp(player.rotation, Quaternion.LookRotation(direction.normalized, Vector3.up), Time.deltaTime * 10f);
            }
            player.position = projected;
        }

        private bool IsBlockedByObstacle(Vector3 projected)
        {
            var sphereCenter = projected + PlayerColliderCenter;
            for (var index = obstacleFootprints.Count - 1; index >= 0; index--)
            {
                var obstacle = obstacleFootprints[index];
                if (obstacle == null)
                {
                    obstacleFootprints.RemoveAt(index);
                    continue;
                }
                if (!obstacle.enabled || obstacle.isTrigger || !obstacle.gameObject.activeInHierarchy) continue;
                var closestPoint = obstacle.ClosestPoint(sphereCenter);
                if ((closestPoint - sphereCenter).sqrMagnitude < PlayerColliderRadius * PlayerColliderRadius)
                    return true;
            }
            return false;
        }

        private bool IsApproved(Vector3 candidate)
        {
            return TryProjectToSurface(candidate, out _);
        }

        private bool TryProjectToSurface(Vector3 candidate, out Vector3 projected)
        {
            projected = candidate;
            if (traversalSurface == null || player == null) return false;
            return traversalSurface.TryProjectStep(candidate, player.position.y - traversalSurface.GroundOffset, out projected);
        }

        private Vector3 ProjectToSurface(Vector3 candidate)
        {
            if (traversalSurface != null && traversalSurface.TryProjectInitial(candidate, out var projected))
                return projected;
            return candidate;
        }

        private void AnimatePlayer()
        {
            var moving = route.Count > 0 || Mathf.Abs(Input.GetAxisRaw("Horizontal")) + Mathf.Abs(Input.GetAxisRaw("Vertical")) > .01f;
            var time = Time.unscaledTime;
            playerBody.localPosition = new Vector3(0, Mathf.Sin(time * (moving ? 7f : 2.2f)) * (moving ? .13f : .06f), 0);
            var targetPitch = moving ? 18f : 0f;
            playerBody.localRotation = Quaternion.Slerp(playerBody.localRotation, Quaternion.Euler(targetPitch, 0, 0), Time.deltaTime * 7f);
        }

        private void UpdateCamera()
        {
            sectionCameraController?.Tick(player.position, Time.unscaledDeltaTime);
        }

        private void UpdateSelection()
        {
            foreach (var pair in landmarks)
            {
                var selected = pair.Key == selectedId;
                pair.Value.root.localScale = selected ? Vector3.one * 1.1f : Vector3.one;
            }
        }

        private System.Collections.IEnumerator PulseBlocked(LandmarkView landmark)
        {
            var initial = landmark.root.localScale;
            for (var index = 0; index < 4; index++)
            {
                landmark.root.localScale = initial * (index % 2 == 0 ? 1.16f : .96f);
                yield return new WaitForSecondsRealtime(.1f);
            }
            landmark.root.localScale = landmark.data.id == selectedId ? Vector3.one * 1.1f : Vector3.one;
        }

        private void UpdateStats()
        {
            frames++;
            statsTimer += Time.unscaledDeltaTime;
            if (statsTimer < 1f) return;
            var stats = new WorldStats
            {
                fps = Mathf.RoundToInt(frames / Mathf.Max(.001f, statsTimer)),
                drawCalls = 0,
                triangles = 0,
                positionX = Mathf.RoundToInt(player.position.x * 100f),
                positionY = Mathf.RoundToInt(player.position.z * 100f),
                zoom = Mathf.RoundToInt(worldCamera.orthographicSize * 100f)
            };
            YuviBrowserBridge.Emit(WorldBrowserEvents.Stats, JsonUtility.ToJson(stats));
            statsTimer = 0f;
            frames = 0;
        }

        private void UpdateAvatarProjection()
        {
            avatarProjectionTimer += Time.unscaledDeltaTime;
            if (avatarProjectionTimer < 1f / 24f) return;

            var delta = player.position - lastAvatarProjectionPosition;
            var moving = delta.sqrMagnitude > .0004f;
            if (moving)
            {
                if (Mathf.Abs(delta.x) >= Mathf.Abs(delta.z))
                    avatarHeading = delta.x >= 0f ? "right" : "left";
                else
                    avatarHeading = delta.z >= 0f ? "up" : "down";
            }

            var viewport = worldCamera.WorldToViewportPoint(player.position);
            var projection = new AvatarProjection
            {
                x = Mathf.RoundToInt(viewport.x * 10000f),
                y = Mathf.RoundToInt((1f - viewport.y) * 10000f),
                scale = Mathf.RoundToInt(DefaultCameraSize / Mathf.Max(.01f, worldCamera.orthographicSize) * 1000f),
                heading = avatarHeading,
                moving = moving,
                visible = viewport.z > 0f && viewport.x > -.08f && viewport.x < 1.08f && viewport.y > -.12f && viewport.y < 1.12f
            };
            YuviBrowserBridge.Emit(WorldBrowserEvents.AvatarProjection, JsonUtility.ToJson(projection));
            lastAvatarProjectionPosition = player.position;
            avatarProjectionTimer = 0f;
        }

    }

}
