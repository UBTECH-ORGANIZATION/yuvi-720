using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Drives a lamp's point light from the day cycle: dim warm fill in daylight, ramping up smoothly as the
    /// sun drops (reads <see cref="SunCycle.Daylight01"/>) so the ground below and around the lamp visibly
    /// catches its pool of light at dusk. Range widens with darkness too, and the light is promoted from the
    /// cheap vertex path to a real pixel light while it matters.
    /// </summary>
    [RequireComponent(typeof(Light))]
    public sealed class LampNightLight : MonoBehaviour
    {
        public float dayIntensity = 0.45f;
        public float nightIntensity = 2.4f;
        public float dayRange = 4.5f;
        public float nightRange = 7.5f;
        [Tooltip("Daylight level below which the lamp starts coming on (1 = noon, 0 = darkest).")]
        [Range(0f, 1f)] public float lightUpBelow = 0.65f;

        private Light _light;

        private void Awake() => _light = GetComponent<Light>();

        private void Update()
        {
            // 0 in full day → 1 at the darkest part of the cycle, easing in below the threshold.
            var darkness = Mathf.Clamp01((lightUpBelow - SunCycle.Daylight01) / Mathf.Max(0.01f, lightUpBelow));
            var k = darkness * darkness; // ease — lamps swell as it gets darker and darker
            _light.intensity = Mathf.Lerp(dayIntensity, nightIntensity, k);
            _light.range = Mathf.Lerp(dayRange, nightRange, k);
            _light.renderMode = k > 0.2f ? LightRenderMode.Auto : LightRenderMode.ForceVertex;
        }
    }
}
