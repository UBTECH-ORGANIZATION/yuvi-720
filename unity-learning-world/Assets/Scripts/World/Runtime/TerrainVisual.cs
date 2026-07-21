using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    [DisallowMultipleComponent]
    public sealed class TerrainVisual : MonoBehaviour
    {
        [SerializeField] private Transform visualRoot;
        [SerializeField] private Transform movementZonesRoot;
        [SerializeField] private Transform landmarkAnchorsRoot;
        [SerializeField] private Transform bridgeAnchorsRoot;

        public Transform VisualRoot => visualRoot;
        public Transform MovementZonesRoot => movementZonesRoot;
        public Transform LandmarkAnchorsRoot => landmarkAnchorsRoot;
        public Transform BridgeAnchorsRoot => bridgeAnchorsRoot;

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            Require(issues, visualRoot, "VisualRoot");
            Require(issues, movementZonesRoot, "MovementZones");
            Require(issues, landmarkAnchorsRoot, "LandmarkAnchors");
            Require(issues, bridgeAnchorsRoot, "BridgeAnchors");
        }

        private void Require(List<string> issues, Transform value, string childName)
        {
            if (value == null) issues.Add($"{name}: {childName} is required.");
        }

#if UNITY_EDITOR
        public void EditorAssignContract(Transform visual, Transform movement, Transform landmarks, Transform bridges)
        {
            visualRoot = visual;
            movementZonesRoot = movement;
            landmarkAnchorsRoot = landmarks;
            bridgeAnchorsRoot = bridges;
        }
#endif
    }
}