using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Makes a river creature surface on a repeating cycle: it rises from below the water, holds while
    /// bobbing and swaying a "look-around", then sinks back and waits submerged before the next appearance.
    /// Drives the object's local position/rotation, so place the creature at its SURFACED pose (base at the
    /// water line) and this component hides it below until its turn.
    /// </summary>
    public sealed class RiverSerpent : MonoBehaviour
    {
        [Tooltip("How far below the surfaced pose the creature hides.")]
        public float submergedDepth = 2.6f;
        public float riseTime = 2.2f;
        public float holdTime = 3.5f;
        public float sinkTime = 2.0f;
        [Tooltip("Seconds spent fully hidden between appearances.")]
        public float hiddenTime = 6f;
        [Tooltip("Head-start into the cycle so multiple creatures don't surface in unison.")]
        public float phaseOffset = 0f;

        public float bobAmplitude = 0.12f;
        public float bobSpeed = 1.6f;
        public float swayDegrees = 14f;
        public float swaySpeed = 0.8f;

        private Vector3 _surfacedPos;
        private Quaternion _baseRot;
        private float _t;

        private void Awake()
        {
            _surfacedPos = transform.localPosition;
            _baseRot = transform.localRotation;
            _t = phaseOffset;
            transform.localPosition = _surfacedPos - Vector3.up * submergedDepth; // start hidden
        }

        private void Update()
        {
            _t += Time.deltaTime;
            var cycle = riseTime + holdTime + sinkTime + hiddenTime;
            var p = Mathf.Repeat(_t, cycle);

            float emerge;
            if (p < riseTime) emerge = Mathf.SmoothStep(0f, 1f, p / riseTime);
            else if (p < riseTime + holdTime) emerge = 1f;
            else if (p < riseTime + holdTime + sinkTime) emerge = Mathf.SmoothStep(1f, 0f, (p - riseTime - holdTime) / sinkTime);
            else emerge = 0f;

            var bob = emerge > 0.98f ? Mathf.Sin(_t * bobSpeed) * bobAmplitude : 0f;
            transform.localPosition = _surfacedPos - Vector3.up * (submergedDepth * (1f - emerge) - bob);

            var sway = Mathf.Sin(_t * swaySpeed) * swayDegrees * emerge; // gentle look-around while up
            transform.localRotation = _baseRot * Quaternion.Euler(0f, sway, 0f);
        }
    }
}
