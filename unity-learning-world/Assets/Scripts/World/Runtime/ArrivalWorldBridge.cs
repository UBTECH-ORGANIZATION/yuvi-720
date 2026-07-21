using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Production bridge for the hand-composed Arrival island (the dressed world shipped to the learning
    /// page). React SendMessages the "LearningWorld" GameObject — Configure / SetSelected / Focus /
    /// TravelTo / ShowBlocked / ResetCamera / SetPaused — and receives browser events (runtime-ready,
    /// ready, landmark-select, avatar-projection, travel-complete, blocked, stats, error) via
    /// <see cref="YuviBrowserBridge"/>.
    ///
    /// Movement + collision stay with the Unity <see cref="CharacterController"/> (<see cref="DemoPlayerController"/>
    /// for keyboard/fly; this bridge routes the same controller for TravelTo). When <c>externalAvatar</c>
    /// is set the Unity Yuvi proxy is hidden and its screen position is streamed as <c>avatar-projection</c>
    /// so React overlays the real three.js robot on top. Camera = the scene's Play-mode perspective camera.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ArrivalWorldBridge : MonoBehaviour
    {
        [Tooltip("Perspective gameplay camera used to project the avatar to screen (defaults to Camera.main).")]
        public Camera worldCamera;
        [Tooltip("The Yuvi player transform (CharacterController).")]
        public Transform player;
        [Tooltip("Free-movement controller; disabled while the bridge is routing a TravelTo.")]
        public DemoPlayerController playerController;
        [Tooltip("Hand-placed clickable buildings, mapped to the config's landmarks in order. In the streamed " +
                 "build these are discovered as each section loads rather than wired at build time.")]
        public List<Transform> landmarkSlots = new();
        [Tooltip("Optional: drives per-section streaming. When set, landmark slots + cloud curtains are bound " +
                 "as sections stream in; null = single-scene build (slots wired at build time).")]
        public SectionStreamer streamer;

        private readonly Dictionary<string, Transform> landmarkById = new();
        private readonly List<CloudCurtain> curtains = new();
        private WorldConfig config;
        private string selectedId;
        private string travellingId;
        private Vector3 travelTarget;
        private bool travelling;
        private float projTimer;
        private float statsTimer;
        private int frames;
        private Vector3 lastProjPos;
        private string heading = "down";
        private bool configured;
        private bool paused;
        private bool firstSectionBound;
        private CharacterController cc;
        private float lastGroundedY;
        private float facingRad;
        private bool hasFacing;

        private const float ProjHz = 24f;
        private const float MoveSpeed = 7f;
        private const float ArriveDist = 1.3f;
        private const float ProjScaleBase = 22f;   // camera-to-player distance that maps to scale ≈ 1.0

        private void Awake()
        {
            if (worldCamera == null) worldCamera = Camera.main;
            if (player != null)
            {
                cc = player.GetComponent<CharacterController>();
                lastGroundedY = player.position.y;
            }
            YuviBrowserBridge.Emit(WorldBrowserEvents.RuntimeReady);
        }

        // ── React → Unity ────────────────────────────────────────────────────────────────────
        public void Configure(string json)
        {
            WorldConfig parsed;
            try { parsed = JsonUtility.FromJson<WorldConfig>(json); }
            catch { YuviBrowserBridge.Emit(WorldBrowserEvents.Error, "invalid-config"); return; }
            if (parsed == null || parsed.landmarks == null)
            {
                YuviBrowserBridge.Emit(WorldBrowserEvents.Error, "missing-config");
                return;
            }
            config = parsed;

            // The real Yuvi is a three.js overlay → hide the Unity proxy's renderers (keep the collider).
            if (config.externalAvatar && player != null)
                foreach (var r in player.GetComponentsInChildren<Renderer>(true)) r.enabled = false;

            selectedId = config.selectedLandmarkId;
            lastProjPos = player != null ? player.position : Vector3.zero;

            if (streamer != null)
            {
                // Streamed build: buildings + curtains live in section scenes fetched on demand; bind them as
                // each section loads. SetServerDataBase points Addressables at the hosted bundles + kicks off
                // the resident (arrival) section.
                streamer.SectionLoaded -= OnSectionLoaded;
                streamer.SectionLoaded += OnSectionLoaded;
                // The terrain arrives with the first section — freeze the player so he doesn't fall through
                // empty space until there's ground to stand on (re-enabled in OnSectionLoaded).
                if (playerController != null) playerController.enabled = false;
                streamer.SetServerDataBase(config.serverDataUrl);
            }
            else
            {
                // Single-scene build: the slots are already wired at build time — just map them in order.
                RebuildLandmarkMapping();
            }

            configured = true;
            YuviBrowserBridge.Emit(WorldBrowserEvents.Ready);
        }

        // Bind a freshly-streamed section: wire its proximity-pop buildings to the player, register them as
        // landmark slots, collect its cloud curtains, then re-map landmarks→slots in config order.
        private void OnSectionLoaded(string sectionId, Scene scene)
        {
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var pop in root.GetComponentsInChildren<ProximityPopAnimator>(true))
                {
                    pop.player = player;
                    if (!landmarkSlots.Contains(pop.transform)) landmarkSlots.Add(pop.transform);
                }
                curtains.AddRange(root.GetComponentsInChildren<CloudCurtain>(true));
            }
            RebuildLandmarkMapping();

            // First section carries the terrain → the player now has ground; release the freeze.
            if (!firstSectionBound)
            {
                firstSectionBound = true;
                if (!travelling && playerController != null) playerController.enabled = true;
            }
        }

        private void RebuildLandmarkMapping()
        {
            landmarkById.Clear();
            if (config?.landmarks == null) return;
            for (var i = 0; i < config.landmarks.Length && i < landmarkSlots.Count; i++)
                if (landmarkSlots[i] != null) landmarkById[config.landmarks[i].id] = landmarkSlots[i];
        }

        /// <summary>Learning page reports a section complete → unlock + stream the next section and fade the
        /// cloud curtain that was hiding it.</summary>
        public void RevealSection(string sectionId)
        {
            if (streamer != null) streamer.Reveal(sectionId);
            foreach (var c in curtains)
                if (c != null && c.revealsSectionId == sectionId) c.Fade();
        }

        public void SetSelected(string landmarkId) => selectedId = landmarkId;
        public void Focus(string landmarkId) => selectedId = landmarkId;
        public void ShowBlocked(string landmarkId) => YuviBrowserBridge.Emit(WorldBrowserEvents.Blocked, landmarkId);
        public void ResetCamera(string _ = "") { }

        /// <summary>Switch the gameplay camera: "iso" (default isometric follow) or "fps" (first person from
        /// Yuvi's eyes). In first person the avatar projection naturally reports not-visible (the ground point
        /// sits behind the camera), so the React three.js overlay hides itself.</summary>
        public void SetViewMode(string mode)
        {
            var cam = worldCamera != null ? worldCamera : Camera.main;
            var rig = cam != null ? cam.GetComponent<IsometricCameraRig>() : null;
            if (rig != null) rig.SetViewMode(mode);
        }

        public void SetPaused(string paused1)
        {
            paused = paused1 == "1";
            Time.timeScale = paused ? 0f : 1f;
        }

        public void TravelTo(string landmarkId)
        {
            if (!landmarkById.TryGetValue(landmarkId, out var slot) || slot == null) return;
            selectedId = landmarkId;
            travellingId = landmarkId;
            travelTarget = slot.position;
            travelling = true;
            if (playerController != null) playerController.enabled = false; // bridge drives movement while routing
        }

        // ── loop ────────────────────────────────────────────────────────────────────────────
        private void Update()
        {
            if (!configured || player == null || paused) return;
            HandlePointer();
            if (travelling) FollowTravel();
            EmitProjection();
        }

        private void FollowTravel()
        {
            var to = travelTarget; to.y = player.position.y;
            var delta = to - player.position; delta.y = 0f;
            if (delta.magnitude < ArriveDist)
            {
                travelling = false;
                if (playerController != null) playerController.enabled = true;
                var done = travellingId; travellingId = null;
                if (!string.IsNullOrEmpty(done)) YuviBrowserBridge.Emit(WorldBrowserEvents.TravelComplete, done);
                return;
            }
            var step = delta.normalized * (MoveSpeed * Time.deltaTime);
            var cc = player.GetComponent<CharacterController>();
            if (cc != null) cc.Move(step + Vector3.down * (2f * Time.deltaTime)); // stay grounded
            else player.position += step;
        }

        private void HandlePointer()
        {
            if (!Input.GetMouseButtonDown(0) || worldCamera == null) return;
            var ray = worldCamera.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out var hit, 300f)) return;
            foreach (var pair in landmarkById)
            {
                var slot = pair.Value;
                if (slot != null && (hit.transform == slot || hit.transform.IsChildOf(slot)))
                {
                    selectedId = pair.Key;
                    YuviBrowserBridge.Emit(WorldBrowserEvents.LandmarkSelect, pair.Key);
                    return;
                }
            }
        }

        private void EmitProjection()
        {
            projTimer += Time.unscaledDeltaTime;
            if (projTimer < 1f / ProjHz || worldCamera == null) return;
            projTimer = 0f;

            // Track the ground beneath Yuvi so altitude is measured from it and the overlay anchors there.
            if (cc != null && cc.isGrounded) lastGroundedY = player.position.y;

            var delta = player.position - lastProjPos;
            var moving = delta.sqrMagnitude > 0.0004f;
            if (moving)
            {
                if (Mathf.Abs(delta.x) >= Mathf.Abs(delta.z)) heading = delta.x >= 0f ? "right" : "left";
                else heading = delta.z >= 0f ? "up" : "down";
            }

            // Anchor the overlay (and the shadow) to Yuvi's GROUND point; send his height above it separately
            // so React lifts him off the ground — flying then reads as rising, not sliding up the map.
            var groundPos = new Vector3(player.position.x, lastGroundedY, player.position.z);
            var vpGround = worldCamera.WorldToViewportPoint(groundPos);
            var vpHead = worldCamera.WorldToViewportPoint(player.position);
            var altitude = Mathf.Max(0f, vpHead.y - vpGround.y) * 10000f; // screen-space rise above the ground

            // Facing: project the horizontal world movement through the camera to get the SCREEN direction he
            // is travelling, so the overlay turns him to match the isometric view. The camera follows Yuvi, so
            // his screen position barely changes — the overlay can't work this out from screen deltas itself.
            var flat = new Vector3(delta.x, 0f, delta.z);
            if (flat.sqrMagnitude > 0.000004f)
            {
                var ahead = worldCamera.WorldToViewportPoint(groundPos + flat.normalized);
                var sdx = ahead.x - vpGround.x;
                var sdy = -(ahead.y - vpGround.y); // viewport y is up; screen/overlay y grows downward
                if (sdx * sdx + sdy * sdy > 1e-10f)
                {
                    facingRad = Mathf.Atan2(sdx, sdy);
                    hasFacing = true;
                }
            }

            var projection = new AvatarProjection
            {
                x = Mathf.RoundToInt(vpGround.x * 10000f),
                y = Mathf.RoundToInt((1f - vpGround.y) * 10000f),
                scale = Mathf.RoundToInt(Mathf.Clamp(ProjScaleBase / Mathf.Max(0.01f, vpGround.z), 0.72f, 1.35f) * 1000f),
                heading = heading,
                moving = moving,
                visible = vpGround.z > 0f && vpGround.x > -0.08f && vpGround.x < 1.08f && vpGround.y > -0.4f && vpGround.y < 1.4f,
                altitude = Mathf.RoundToInt(altitude),
                facing = Mathf.RoundToInt(facingRad * 1000f),
                hasFacing = hasFacing
            };
            YuviBrowserBridge.Emit(WorldBrowserEvents.AvatarProjection, JsonUtility.ToJson(projection));
            lastProjPos = player.position;
        }
    }
}
