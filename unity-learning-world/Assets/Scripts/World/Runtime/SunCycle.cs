using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Animates a directional light as a moving sun so the world's shadows sweep across the map in
    /// real time. The sun traces a smooth, seamless loop (an ellipse in azimuth/elevation) that keeps
    /// it above the horizon the whole cycle — it rises, swings overhead, and descends without ever
    /// snapping or going dark. Light colour and intensity ease warm-and-low → bright-and-high with the
    /// sun's elevation, so dawn/dusk read golden and noon reads clean and bright.
    ///
    /// Runtime only (Update); at edit time the light keeps whatever static rotation the builder set,
    /// so editor captures stay deterministic.
    /// </summary>
    [RequireComponent(typeof(Light))]
    public sealed class SunCycle : MonoBehaviour
    {
        [Tooltip("Seconds for one full sun loop (dawn → noon → dusk → back).")]
        public float dayLength = 100f;
        [Tooltip("Phase to start at, 0..1 (0 = low dawn, 0.5 = high noon).")]
        [Range(0f, 1f)] public float startPhase = 0.18f;

        [Header("Arc (degrees)")]
        [Tooltip("Compass centre the sun swings around.")]
        public float azimuthCentre = -34f;
        [Tooltip("How far east/west the sun swings from centre.")]
        public float azimuthSwing = 62f;
        [Tooltip("Elevation at dawn/dusk (low) and noon (high).")]
        public float minElevation = 12f;
        public float maxElevation = 64f;

        [Header("Light look")]
        public Color dawnColor = new Color(1.00f, 0.83f, 0.64f);
        public Color noonColor = new Color(1.00f, 0.98f, 0.93f);
        public float dawnIntensity = 0.85f;
        public float noonIntensity = 1.35f;

        [Header("Shadows")]
        [Tooltip("How far shadows render (metres). Set once on Awake so the moving sun casts across the island.")]
        public float shadowDistance = 95f;

        /// <summary>0 = sun at its lowest (dawn/dusk), 1 = high noon. Lamps and other night-reactive props
        /// read this to fade in as the world darkens. Defaults to full daylight when no sun is running.</summary>
        public static float Daylight01 { get; private set; } = 1f;

        private Light _light;
        private float _phase;

        private void Awake()
        {
            _light = GetComponent<Light>();
            _phase = startPhase;
            if (shadowDistance > 0f) QualitySettings.shadowDistance = shadowDistance;
            Apply(_phase);
        }

        private void Update()
        {
            _phase += Time.deltaTime / Mathf.Max(1f, dayLength);
            if (_phase >= 1f) _phase -= 1f;
            Apply(_phase);
        }

        private void Apply(float phase)
        {
            var a = phase * Mathf.PI * 2f;
            // Elevation: low at the ends (cos = +1 → min at phase 0/1), high at noon (cos = -1 → max at 0.5).
            var midE = (minElevation + maxElevation) * 0.5f;
            var ampE = (maxElevation - minElevation) * 0.5f;
            var elevation = midE - ampE * Mathf.Cos(a);
            // Azimuth swings sideways, 90° out of phase, so the pair traces a smooth arc (no wrap snap).
            var yaw = azimuthCentre + azimuthSwing * Mathf.Sin(a);
            transform.rotation = Quaternion.Euler(elevation, yaw, 0f);

            var e = Mathf.InverseLerp(minElevation, maxElevation, elevation); // 0 at horizon → 1 at noon
            Daylight01 = e;
            if (_light != null)
            {
                _light.color = Color.Lerp(dawnColor, noonColor, e);
                _light.intensity = Mathf.Lerp(dawnIntensity, noonIntensity, e);
            }
        }
    }
}
