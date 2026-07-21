using System;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    /// <summary>
    /// Owns all decorative mesh motion. Progression and learning state never
    /// enter this component; reduced-motion, low-power, and pause are global.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WorldMotionController : MonoBehaviour
    {
        [SerializeField] private Transform contentRoot;

        private WorldWindElement[] elements = Array.Empty<WorldWindElement>();
        private bool reducedMotion;
        private bool lowPower;
        private bool paused;

        public int ElementCount => elements.Length;

        public void Configure(Transform root, bool useReducedMotion, bool useLowPower)
        {
            contentRoot = root;
            reducedMotion = useReducedMotion;
            lowPower = useLowPower;
            RefreshElements();
            if (reducedMotion) ResetElements();
        }

        public void RefreshElements()
        {
            elements = contentRoot != null
                ? contentRoot.GetComponentsInChildren<WorldWindElement>(true)
                : Array.Empty<WorldWindElement>();
            foreach (var element in elements) element.CaptureRestPose();
        }

        public void SetPaused(bool value)
        {
            paused = value;
        }

        private void Update()
        {
            if (paused || reducedMotion || elements.Length == 0) return;
            var time = Time.unscaledTime;
            for (var index = 0; index < elements.Length; index++)
            {
                var element = elements[index];
                if (element == null) continue;
                var intensity = lowPower && element.DisableInLowPower ? 0f : 1f;
                element.Apply(time, intensity);
            }
        }

        private void ResetElements()
        {
            for (var index = 0; index < elements.Length; index++)
                if (elements[index] != null) elements[index].ResetPose();
        }
    }
}