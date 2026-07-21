using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Isometric camera that FOLLOWS Yuvi instead of sitting static over the plaza. An orthographic camera at
    /// a fixed isometric yaw/pitch trails the player with smoothing, so a modest island reads as a large world:
    /// you only ever see a zoomed-in slice of it and must travel to reveal the rest.
    ///
    /// Pair with a slow walk speed — the size illusion comes from (zoom × travel time), not from the terrain's
    /// actual footprint. <see cref="orthoSize"/> is the zoom (smaller = closer/bigger-feeling world).
    ///
    /// NOTE: because the camera tracks the player, his on-screen position barely moves, so screen-delta based
    /// facing does NOT work — <see cref="ArrivalWorldBridge"/> derives facing from world velocity projected
    /// through this camera instead.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Camera))]
    public sealed class IsometricCameraRig : MonoBehaviour
    {
        [Tooltip("Who to follow (the Yuvi player rig).")]
        public Transform target;
        // yaw 0 = look straight along +Z so the island faces the camera head-on (its long X axis runs
        // left-right across the screen). 45 read as "from the side" — the world sat corner-on. Pitch stays
        // ~30 so it's still a pitched isometric view, not a flat front elevation.
        [Tooltip("Isometric framing: yaw around the world, pitch down toward the ground.")]
        public float yaw = 0f;
        public float pitch = 30f;
        [Tooltip("How far back along the view direction the camera sits (orthographic → only affects clipping).")]
        public float distance = 40f;
        [Tooltip("Zoom. Smaller = closer in = the world feels larger.")]
        public float orthoSize = 11f;
        [Tooltip("Follow smoothing (higher = snappier). 0 = rigid.")]
        public float smooth = 6f;
        [Tooltip("Look slightly above Yuvi's feet so he sits a touch below centre.")]
        public float targetHeight = 1.1f;

        public enum CameraViewMode { Isometric, FirstPerson }

        [Header("View mode")]
        [Tooltip("First-person from Yuvi's eyes (default) or the isometric follow view. Toggled from React " +
                 "via ArrivalWorldBridge.SetViewMode(\"iso\"|\"fps\"). Edit mode always renders isometric.")]
        public CameraViewMode viewMode = CameraViewMode.FirstPerson;
        [Tooltip("First person: eye height above the player's origin.")]
        public float eyeHeight = 1.5f;
        [Tooltip("First person: slight downward pitch so the paths read.")]
        public float firstPersonPitch = 6f;
        public float firstPersonFov = 72f;
        [Tooltip("First person: look degrees per unit of mouse-drag (hold LMB and drag to turn).")]
        public float lookSensitivity = 3.2f;
        public float minLookPitch = -35f;
        public float maxLookPitch = 60f;

        /// <summary>True while a rig is rendering first person (play mode). DemoPlayerController reads this to
        /// make the arrow keys move relative to the view instead of world axes.</summary>
        public static bool FirstPersonActive { get; private set; }
        /// <summary>The current first-person view yaw, valid while <see cref="FirstPersonActive"/>.</summary>
        public static float FirstPersonYaw { get; private set; }

        private Camera _cam;
        private Vector3 _focus;
        private bool _primed;
        private float _fpYaw;
        private float _fpPitch;
        private bool _fpYawPrimed;
        private readonly List<Renderer> _hiddenBody = new();
        private bool _bodyHidden;

        // In first person the player's own body must never appear in frame (turning used to catch the proxy
        // box). Hide the target's renderers while first person is active, remembering exactly which ones WE
        // disabled — renderers already hidden by others (e.g. the external three.js avatar mode) are left
        // alone and stay hidden when we restore.
        private void SetBodyHidden(bool hidden)
        {
            if (hidden == _bodyHidden || target == null) return;
            _bodyHidden = hidden;
            if (hidden)
            {
                _hiddenBody.Clear();
                foreach (var r in target.GetComponentsInChildren<Renderer>())
                    if (r.enabled) { r.enabled = false; _hiddenBody.Add(r); }
            }
            else
            {
                foreach (var r in _hiddenBody) if (r != null) r.enabled = true;
                _hiddenBody.Clear();
            }
        }

        /// <summary>"fps"/"first-person" → first person; anything else → isometric.</summary>
        public void SetViewMode(string mode)
        {
            var m = (mode ?? "").Trim().ToLowerInvariant();
            viewMode = (m == "fps" || m == "first-person" || m == "firstperson")
                ? CameraViewMode.FirstPerson
                : CameraViewMode.Isometric;
            _primed = false;      // snap the iso focus fresh when switching back
            _fpYawPrimed = false; // and pick up the current facing when entering first person
        }

        private void OnEnable()
        {
            _cam = GetComponent<Camera>();
            Apply();
            if (target != null) { _focus = FocusPoint(); _primed = true; Place(); }
        }

        private Vector3 FocusPoint() => target.position + Vector3.up * targetHeight;

        private void Apply()
        {
            if (_cam == null) _cam = GetComponent<Camera>();
            _cam.orthographic = true;
            _cam.orthographicSize = orthoSize;
            _cam.nearClipPlane = 0.1f;
            _cam.farClipPlane = distance * 2f + 220f;
        }

        private void Place()
        {
            var rot = Quaternion.Euler(pitch, yaw, 0f);
            transform.SetPositionAndRotation(_focus - rot * Vector3.forward * distance, rot);
        }

        private void LateUpdate()
        {
            if (target == null) return;
            if (viewMode == CameraViewMode.FirstPerson && Application.isPlaying)
            {
                PlaceFirstPerson();
                return;
            }
            FirstPersonActive = false;
            SetBodyHidden(false);
            Apply();
            var wanted = FocusPoint();
            if (!_primed) { _focus = wanted; _primed = true; }
            else
            {
                var dt = Application.isPlaying ? Time.deltaTime : 0.016f;
                _focus = smooth <= 0f ? wanted : Vector3.Lerp(_focus, wanted, 1f - Mathf.Exp(-smooth * dt));
            }
            Place();
        }

        // First person: perspective camera at Yuvi's eyes. TURNING IS MOUSE-DRAG ONLY — hold the left button
        // and drag to look around (arrows/WASD never turn the view; DemoPlayerController moves relative to
        // this yaw instead, reading the FirstPersonYaw static). A small forward offset keeps the (hidden)
        // proxy body behind the near plane.
        private void PlaceFirstPerson()
        {
            if (_cam == null) _cam = GetComponent<Camera>();
            _cam.orthographic = false;
            _cam.fieldOfView = firstPersonFov;
            _cam.nearClipPlane = 0.05f;
            _cam.farClipPlane = 320f;

            if (!_fpYawPrimed)
            {
                _fpYaw = target.eulerAngles.y;   // start looking where Yuvi faces
                _fpPitch = firstPersonPitch;
                _fpYawPrimed = true;
            }
            if (Input.GetMouseButton(0))
            {
                _fpYaw += Input.GetAxis("Mouse X") * lookSensitivity;
                _fpPitch = Mathf.Clamp(_fpPitch - Input.GetAxis("Mouse Y") * lookSensitivity, minLookPitch, maxLookPitch);
            }
            FirstPersonActive = true;
            FirstPersonYaw = _fpYaw;
            SetBodyHidden(true);

            var rot = Quaternion.Euler(_fpPitch, _fpYaw, 0f);
            var forward = Quaternion.Euler(0f, _fpYaw, 0f) * Vector3.forward;
            transform.SetPositionAndRotation(target.position + Vector3.up * eyeHeight + forward * 0.3f, rot);
        }

        private void OnDisable()
        {
            FirstPersonActive = false;
            SetBodyHidden(false);
        }
    }
}
