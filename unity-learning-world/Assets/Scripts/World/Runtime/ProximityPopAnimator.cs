using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Makes a clickable task building react when Yuvi (the player) comes near: it pops up in scale,
    /// bobs gently, its accent glows, and an optional floating marker rises into view. Away from the
    /// building everything eases back to rest. Assign <see cref="player"/> to Yuvi's transform; with
    /// <see cref="demoMode"/> on it self-animates on a timer so the effect is visible without a player.
    /// Runtime component (Built-in RP friendly) — attach to the building root (origin at its base so it
    /// grows upward).
    /// </summary>
    [DisallowMultipleComponent]
    public class ProximityPopAnimator : MonoBehaviour
    {
        [Tooltip("Yuvi's transform. When within triggerRadius the building activates.")]
        public Transform player;

        [Tooltip("Distance at which the building begins to react.")]
        public float triggerRadius = 7f;

        [Tooltip("Peak scale multiplier when fully active.")]
        public float popScale = 1.1f;

        [Tooltip("Vertical bob height when active (metres).")]
        public float bobHeight = 0.2f;

        public float bobSpeed = 2.4f;

        [Tooltip("Optional floating marker (icon/pin) shown only while active.")]
        public Transform marker;

        [Tooltip("Optional renderer whose emission pulses while active (e.g. a sign or window).")]
        public Renderer glowRenderer;

        public Color glowColor = new Color(1f, 0.76f, 0.42f);

        [Tooltip("Self-animate on a timer when no player is assigned (for review/demo).")]
        public bool demoMode;

        Vector3 _baseScale;
        Vector3 _basePos;
        float _markerBaseY;
        float _t;
        MaterialPropertyBlock _mpb;
        static readonly int EmissionId = Shader.PropertyToID("_EmissionColor");

        void Awake()
        {
            _baseScale = transform.localScale;
            _basePos = transform.localPosition;
            if (marker)
            {
                _markerBaseY = marker.localPosition.y;
                marker.gameObject.SetActive(false);
            }
            if (glowRenderer) _mpb = new MaterialPropertyBlock();
        }

        void Update()
        {
            float target;
            if (demoMode)
            {
                target = Mathf.SmoothStep(0f, 1f, 0.5f + 0.5f * Mathf.Sin(Time.time * 1.1f));
            }
            else if (player)
            {
                var d = Vector3.Distance(player.position, transform.position);
                var inner = triggerRadius * 0.5f;
                target = 1f - Mathf.Clamp01((d - inner) / Mathf.Max(inner, 0.01f));
            }
            else
            {
                target = 0f;
            }

            _t = Mathf.Lerp(_t, target, 1f - Mathf.Exp(-6f * Time.deltaTime));

            transform.localScale = Vector3.Lerp(_baseScale, _baseScale * popScale, _t);
            var bob = Mathf.Sin(Time.time * bobSpeed) * bobHeight * _t;
            transform.localPosition = _basePos + Vector3.up * bob;

            if (marker)
            {
                var active = _t > 0.12f;
                if (marker.gameObject.activeSelf != active) marker.gameObject.SetActive(active);
                if (active)
                {
                    // Gentle vertical bob only — no spin (elements stay world-fixed, never turn).
                    var rise = Mathf.Lerp(0.2f, 0.55f, 0.5f + 0.5f * Mathf.Sin(Time.time * 3f));
                    var lp = marker.localPosition;
                    marker.localPosition = new Vector3(lp.x, _markerBaseY + rise, lp.z);
                }
            }

            if (glowRenderer)
            {
                _mpb ??= new MaterialPropertyBlock();
                var pulse = _t * (0.55f + 0.45f * Mathf.Sin(Time.time * 4f));
                glowRenderer.GetPropertyBlock(_mpb);
                _mpb.SetColor(EmissionId, glowColor * pulse * 2f);
                glowRenderer.SetPropertyBlock(_mpb);
            }
        }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 0.8f, 0.3f, 0.4f);
            Gizmos.DrawWireSphere(transform.position, triggerRadius);
        }
    }
}
