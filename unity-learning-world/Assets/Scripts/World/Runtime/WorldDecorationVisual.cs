using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    [DisallowMultipleComponent]
    public sealed class WorldDecorationVisual : MonoBehaviour
    {
        [SerializeField] private Transform visualRoot;
        [SerializeField] private Transform lowPowerRoot;
        [SerializeField, Min(0f)] private float exclusionRadius;
        [SerializeField] private bool collisionRequired;

        public Transform VisualRoot => visualRoot;
        public Transform LowPowerRoot => lowPowerRoot;
        public float ExclusionRadius => exclusionRadius;
        public bool CollisionRequired => collisionRequired;

        public void SetLowPower(bool lowPower)
        {
            if (visualRoot != null) visualRoot.gameObject.SetActive(!lowPower || lowPowerRoot == null);
            if (lowPowerRoot != null) lowPowerRoot.gameObject.SetActive(lowPower);
        }

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            if (visualRoot == null) issues.Add($"{name}: VisualRoot is required.");
            if (exclusionRadius < 0f) issues.Add($"{name}: exclusion radius cannot be negative.");
            if (!collisionRequired && GetComponentInChildren<Collider>(true) != null)
                issues.Add($"{name}: visual-only decorations must not contain colliders.");
        }

#if UNITY_EDITOR
        public void EditorAssignContract(Transform visual, Transform lowPower, float radius, bool requiresCollision)
        {
            visualRoot = visual;
            lowPowerRoot = lowPower;
            exclusionRadius = Mathf.Max(0f, radius);
            collisionRequired = requiresCollision;
        }
#endif
    }
}