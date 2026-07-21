using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    /// <summary>
    /// Authored presentation contract for one connected map section. The
    /// volume selects the section; the camera anchor is its only viewpoint.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WorldSectionView : MonoBehaviour
    {
        [SerializeField] private string sectionId = "section";
        [SerializeField] private Transform cameraAnchor;
        [SerializeField] private Collider coverageVolume;
        [SerializeField] private Transform atmosphereRoot;
        [SerializeField, Min(1f)] private float orthographicSize = 10.8f;

        public string SectionId => sectionId;
        public Transform CameraAnchor => cameraAnchor;
        public Collider CoverageVolume => coverageVolume;
        public Transform AtmosphereRoot => atmosphereRoot;
        public float OrthographicSize => orthographicSize;
        public Vector3 SectionCenter => coverageVolume is BoxCollider box
            ? box.transform.TransformPoint(box.center)
            : coverageVolume != null ? coverageVolume.bounds.center : transform.position;

        public void Configure(
            string id,
            Transform anchor,
            Collider volume,
            Transform atmosphere,
            float size)
        {
            sectionId = string.IsNullOrWhiteSpace(id) ? name : id;
            cameraAnchor = anchor;
            coverageVolume = volume;
            atmosphereRoot = atmosphere;
            orthographicSize = Mathf.Max(1f, size);
        }

        public bool Contains(Vector3 worldPosition)
        {
            if (coverageVolume == null || !coverageVolume.enabled) return false;
            if (coverageVolume is BoxCollider box)
            {
                var local = box.transform.InverseTransformPoint(worldPosition);
                local.y = box.center.y;
                return new Bounds(box.center, box.size).Contains(local);
            }

            var bounds = coverageVolume.bounds;
            worldPosition.y = bounds.center.y;
            return bounds.Contains(worldPosition);
        }

        public float DistanceSquaredXZ(Vector3 worldPosition)
        {
            var delta = SectionCenter - worldPosition;
            return delta.x * delta.x + delta.z * delta.z;
        }

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            if (string.IsNullOrWhiteSpace(sectionId)) issues.Add($"{name}: SectionId is required.");
            if (cameraAnchor == null) issues.Add($"{name}: CameraAnchor is required.");
            if (coverageVolume == null) issues.Add($"{name}: CoverageVolume is required.");
            if (coverageVolume != null && !coverageVolume.isTrigger)
                issues.Add($"{name}: CoverageVolume must be a trigger and must not own traversal.");
            if (coverageVolume != null && coverageVolume.GetComponent<Renderer>() != null)
                issues.Add($"{name}: CoverageVolume must remain invisible.");
            if (orthographicSize < 1f) issues.Add($"{name}: OrthographicSize must be positive.");
        }
    }
}