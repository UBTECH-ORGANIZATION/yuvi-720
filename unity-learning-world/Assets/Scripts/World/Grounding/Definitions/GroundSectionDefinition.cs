using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    [CreateAssetMenu(fileName = "GroundSectionDefinition", menuName = "Yuvi/World/Ground Section Definition")]
    public sealed class GroundSectionDefinition : ScriptableObject
    {
        [SerializeField] private string sectionId = "section";
        [SerializeField] private string displayName = "Section";
        [SerializeField] private GroundThemeProfile theme;
        [SerializeField] private GroundElevationBandDefinition[] elevationBands = Array.Empty<GroundElevationBandDefinition>();
        [SerializeField] private GroundTransitionDefinition[] transitions = Array.Empty<GroundTransitionDefinition>();
        [SerializeField] private GroundPortalDefinition[] portals = Array.Empty<GroundPortalDefinition>();
        [SerializeField] private GroundReservedZoneDefinition[] reservedZones = Array.Empty<GroundReservedZoneDefinition>();
        [SerializeField] private GroundCameraDefinition cameraDefinition;

        public string SectionId => sectionId;
        public string DisplayName => displayName;
        public GroundThemeProfile Theme => theme;
        public IReadOnlyList<GroundElevationBandDefinition> ElevationBands => elevationBands ?? Array.Empty<GroundElevationBandDefinition>();
        public IReadOnlyList<GroundTransitionDefinition> Transitions => transitions ?? Array.Empty<GroundTransitionDefinition>();
        public IReadOnlyList<GroundPortalDefinition> Portals => portals ?? Array.Empty<GroundPortalDefinition>();
        public IReadOnlyList<GroundReservedZoneDefinition> ReservedZones => reservedZones ?? Array.Empty<GroundReservedZoneDefinition>();
        public GroundCameraDefinition CameraDefinition => cameraDefinition;

        public void Configure(
            string id,
            string label,
            GroundThemeProfile profile,
            GroundElevationBandDefinition[] bands,
            GroundTransitionDefinition[] authoredTransitions,
            GroundPortalDefinition[] authoredPortals,
            GroundReservedZoneDefinition[] reservations,
            GroundCameraDefinition sectionCamera)
        {
            sectionId = id;
            displayName = label;
            theme = profile;
            elevationBands = bands ?? Array.Empty<GroundElevationBandDefinition>();
            transitions = authoredTransitions ?? Array.Empty<GroundTransitionDefinition>();
            portals = authoredPortals ?? Array.Empty<GroundPortalDefinition>();
            reservedZones = reservations ?? Array.Empty<GroundReservedZoneDefinition>();
            cameraDefinition = sectionCamera;
        }
    }
}