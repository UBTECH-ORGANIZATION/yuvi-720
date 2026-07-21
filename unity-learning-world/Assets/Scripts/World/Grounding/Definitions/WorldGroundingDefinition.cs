using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    [CreateAssetMenu(fileName = "WorldGroundingDefinition", menuName = "Yuvi/World/World Grounding Definition")]
    public sealed class WorldGroundingDefinition : ScriptableObject
    {
        [SerializeField] private string worldId = "learning-world-grounding";
        [SerializeField] private GroundThemeProfile foundationTheme;
        [SerializeField] private GroundElevationBandDefinition[] foundationBands = Array.Empty<GroundElevationBandDefinition>();
        [SerializeField] private GroundSectionDefinition[] sections = Array.Empty<GroundSectionDefinition>();
        [SerializeField] private GroundConnectorDefinition[] connectors = Array.Empty<GroundConnectorDefinition>();
        [SerializeField, Min(1f)] private float minimumSectionArea = 70f;
        [SerializeField, Min(100)] private int maximumTriangleBudget = 12000;

        public string WorldId => worldId;
        public GroundThemeProfile FoundationTheme => foundationTheme;
        public IReadOnlyList<GroundElevationBandDefinition> FoundationBands => foundationBands ?? Array.Empty<GroundElevationBandDefinition>();
        public IReadOnlyList<GroundSectionDefinition> Sections => sections ?? Array.Empty<GroundSectionDefinition>();
        public IReadOnlyList<GroundConnectorDefinition> Connectors => connectors ?? Array.Empty<GroundConnectorDefinition>();
        public float MinimumSectionArea => minimumSectionArea;
        public int MaximumTriangleBudget => maximumTriangleBudget;

        public void Configure(
            string id,
            GroundSectionDefinition[] authoredSections,
            GroundConnectorDefinition[] authoredConnectors,
            float minimumArea,
            int triangleBudget,
            GroundThemeProfile authoredFoundationTheme = null,
            GroundElevationBandDefinition[] authoredFoundationBands = null)
        {
            worldId = id;
            foundationTheme = authoredFoundationTheme;
            foundationBands = authoredFoundationBands ?? Array.Empty<GroundElevationBandDefinition>();
            sections = authoredSections ?? Array.Empty<GroundSectionDefinition>();
            connectors = authoredConnectors ?? Array.Empty<GroundConnectorDefinition>();
            minimumSectionArea = minimumArea;
            maximumTriangleBudget = triangleBudget;
        }
    }
}