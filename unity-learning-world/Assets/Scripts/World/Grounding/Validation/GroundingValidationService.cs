using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Yuvi720.LearningWorld.Grounding
{
    public enum GroundingIssueSeverity
    {
        Warning,
        Error
    }

    public readonly struct GroundingValidationIssue
    {
        public GroundingIssueSeverity Severity { get; }
        public string Code { get; }
        public string Message { get; }

        public GroundingValidationIssue(GroundingIssueSeverity severity, string code, string message)
        {
            Severity = severity;
            Code = code;
            Message = message;
        }

        public override string ToString()
        {
            return $"{Severity} [{Code}] {Message}";
        }
    }

    public sealed class GroundingValidationReport
    {
        private readonly List<GroundingValidationIssue> issues = new();

        public IReadOnlyList<GroundingValidationIssue> Issues => issues;
        public int ErrorCount => issues.Count(issue => issue.Severity == GroundingIssueSeverity.Error);
        public int WarningCount => issues.Count(issue => issue.Severity == GroundingIssueSeverity.Warning);
        public int EstimatedTriangleCount { get; internal set; }
        public bool IsValid => ErrorCount == 0;

        internal void Error(string code, string message)
        {
            issues.Add(new GroundingValidationIssue(GroundingIssueSeverity.Error, code, message));
        }

        internal void Warning(string code, string message)
        {
            issues.Add(new GroundingValidationIssue(GroundingIssueSeverity.Warning, code, message));
        }
    }

    public static class GroundingValidationService
    {
        public static GroundingValidationReport Validate(WorldGroundingDefinition world)
        {
            var report = new GroundingValidationReport();
            if (world == null)
            {
                report.Error("WORLD_MISSING", "World grounding definition is required.");
                return report;
            }
            if (string.IsNullOrWhiteSpace(world.WorldId))
                report.Error("WORLD_ID", "World ID is required.");
            if (world.Sections.Count == 0)
                report.Error("SECTIONS_EMPTY", "At least one authored ground section is required.");
            ValidateFoundation(world, report);

            var sectionsById = new Dictionary<string, GroundSectionDefinition>(StringComparer.Ordinal);
            foreach (var section in world.Sections)
            {
                if (section == null)
                {
                    report.Error("SECTION_MISSING", "World contains a missing section reference.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(section.SectionId))
                {
                    report.Error("SECTION_ID", $"{section.name}: section ID is required.");
                }
                else if (!sectionsById.TryAdd(section.SectionId, section))
                {
                    report.Error("SECTION_DUPLICATE", $"Duplicate section ID: {section.SectionId}.");
                }
                ValidateSection(section, world.MinimumSectionArea, report);
            }

            ValidateConnectors(world, sectionsById, report);
            ValidateCameraCoverage(world.Sections.Where(section => section != null).ToArray(), report);
            ValidateStructuralVariety(world.Sections.Where(section => section != null).ToArray(), report);
            if (report.EstimatedTriangleCount > world.MaximumTriangleBudget)
                report.Error(
                    "TRIANGLE_BUDGET",
                    $"Estimated {report.EstimatedTriangleCount} triangles exceeds the authored budget of {world.MaximumTriangleBudget}.");
            return report;
        }

        private static void ValidateFoundation(
            WorldGroundingDefinition world,
            GroundingValidationReport report)
        {
            if (world.FoundationBands.Count == 0)
            {
                report.Warning(
                    "FOUNDATION_EMPTY",
                    "No shared mainland foundation is authored; verify that sections cannot read as separate islands.");
                return;
            }
            if (world.FoundationTheme == null)
                report.Error("FOUNDATION_THEME", "Shared mainland foundation requires a theme profile.");

            var identifiers = new HashSet<string>(StringComparer.Ordinal);
            foreach (var band in world.FoundationBands)
            {
                if (band == null)
                {
                    report.Error("FOUNDATION_BAND_MISSING", "Shared mainland contains a missing elevation band.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(band.Id) || !identifiers.Add(band.Id))
                    report.Error("FOUNDATION_BAND_ID", $"Foundation band ID is missing or duplicated: {band.Id}.");
                if (band.BottomHeight >= band.TopHeight - GroundPolygon.Epsilon)
                    report.Error("FOUNDATION_HEIGHT", $"Foundation band {band.Id} requires bottom below top.");
                if (!GroundPolygon.TryCreate(band.Surface, out var polygon, out var error))
                {
                    report.Error("FOUNDATION_POLYGON", $"{band.Id}: {error}");
                    continue;
                }
                var triangulation = GroundPolygonTriangulator.Triangulate(polygon);
                if (!triangulation.Succeeded)
                {
                    report.Error("FOUNDATION_TRIANGULATION", $"{band.Id}: {triangulation.Message}");
                    continue;
                }
                report.EstimatedTriangleCount += triangulation.Triangles.Count / 3;
                report.EstimatedTriangleCount += polygon.Outer.Count * 2;
            }
        }

        private static void ValidateSection(
            GroundSectionDefinition section,
            float minimumSectionArea,
            GroundingValidationReport report)
        {
            if (section.Theme == null)
                report.Error("SECTION_THEME", $"{section.SectionId}: theme profile is required.");
            if (section.ElevationBands.Count == 0)
            {
                report.Error("SECTION_BANDS", $"{section.SectionId}: at least one elevation band is required.");
                return;
            }
            if (section.CameraDefinition == null)
                report.Error("SECTION_CAMERA", $"{section.SectionId}: one static section camera definition is required.");
            else
            {
                if (section.CameraDefinition.OrthographicSize < 1f)
                    report.Error("CAMERA_SIZE", $"{section.SectionId}: orthographic size must be positive.");
                if (section.CameraDefinition.Coverage.size.x <= 0f || section.CameraDefinition.Coverage.size.z <= 0f)
                    report.Error("CAMERA_COVERAGE", $"{section.SectionId}: camera coverage requires positive XZ dimensions.");
            }

            var bandIds = new HashSet<string>(StringComparer.Ordinal);
            var totalArea = 0f;
            foreach (var band in section.ElevationBands)
            {
                if (band == null)
                {
                    report.Error("BAND_MISSING", $"{section.SectionId}: contains a missing elevation band.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(band.Id))
                    report.Error("BAND_ID", $"{section.SectionId}: elevation band ID is required.");
                else if (!bandIds.Add(band.Id))
                    report.Error("BAND_DUPLICATE", $"{section.SectionId}: duplicate band ID {band.Id}.");
                if (band.BottomHeight >= band.TopHeight - GroundPolygon.Epsilon)
                    report.Error("BAND_HEIGHT", $"{section.SectionId}/{band.Id}: bottom height must be lower than top height.");

                if (!GroundPolygon.TryCreate(band.Surface, out var polygon, out var error))
                {
                    report.Error("BAND_POLYGON", $"{section.SectionId}/{band.Id}: {error}");
                    continue;
                }
                totalArea += polygon.Area;
                var triangulation = GroundPolygonTriangulator.Triangulate(polygon);
                if (!triangulation.Succeeded)
                {
                    report.Error(
                        "BAND_TRIANGULATION",
                        $"{section.SectionId}/{band.Id}: {triangulation.Message}");
                    continue;
                }
                report.EstimatedTriangleCount += triangulation.Triangles.Count / 3;
                report.EstimatedTriangleCount += polygon.Outer.Count * 2;
                report.EstimatedTriangleCount += polygon.Holes.Sum(hole => hole.Count * 2);
            }
            if (totalArea < minimumSectionArea)
                report.Error(
                    "SECTION_CAPACITY",
                    $"{section.SectionId}: authored area {totalArea:0.##} is below the minimum {minimumSectionArea:0.##}.");

            ValidateUniqueIds(section.SectionId, "portal", section.Portals.Select(item => item?.Id), report);
            ValidateUniqueIds(section.SectionId, "transition", section.Transitions.Select(item => item?.Id), report);
            ValidateUniqueIds(section.SectionId, "reservation", section.ReservedZones.Select(item => item?.Id), report);

            foreach (var portal in section.Portals.Where(item => item != null))
            {
                if (portal.Width < .5f)
                    report.Error("PORTAL_WIDTH", $"{section.SectionId}/{portal.Id}: portal width is too small.");
                if (portal.Forward.sqrMagnitude < .01f)
                    report.Error("PORTAL_DIRECTION", $"{section.SectionId}/{portal.Id}: portal direction is required.");
            }
            foreach (var transition in section.Transitions.Where(item => item != null))
            {
                if (transition.Width < .5f)
                    report.Error("TRANSITION_WIDTH", $"{section.SectionId}/{transition.Id}: transition width is too small.");
                if ((transition.End - transition.Start).sqrMagnitude < .01f)
                    report.Error("TRANSITION_LENGTH", $"{section.SectionId}/{transition.Id}: transition start and end must differ.");
                if (transition.Kind == GroundTransitionKind.Stairs && transition.StepCount < 1)
                    report.Error("TRANSITION_STEPS", $"{section.SectionId}/{transition.Id}: stairs require at least one step.");
            }
        }

        private static void ValidateUniqueIds(
            string sectionId,
            string label,
            IEnumerable<string> identifiers,
            GroundingValidationReport report)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var identifier in identifiers)
            {
                if (string.IsNullOrWhiteSpace(identifier))
                {
                    report.Error($"{label.ToUpperInvariant()}_ID", $"{sectionId}: {label} ID is required.");
                    continue;
                }
                if (!seen.Add(identifier))
                    report.Error(
                        $"{label.ToUpperInvariant()}_DUPLICATE",
                        $"{sectionId}: duplicate {label} ID {identifier}.");
            }
        }

        private static void ValidateConnectors(
            WorldGroundingDefinition world,
            IReadOnlyDictionary<string, GroundSectionDefinition> sectionsById,
            GroundingValidationReport report)
        {
            var connectorIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var connector in world.Connectors)
            {
                if (connector == null)
                {
                    report.Error("CONNECTOR_MISSING", "World contains a missing connector.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(connector.Id) || !connectorIds.Add(connector.Id))
                    report.Error("CONNECTOR_ID", $"Connector ID is missing or duplicated: {connector.Id}.");
                ValidateConnectorEnd(connector.Id, connector.FromSectionId, connector.FromPortalId, "from", sectionsById, report);
                ValidateConnectorEnd(connector.Id, connector.ToSectionId, connector.ToPortalId, "to", sectionsById, report);
                if (string.Equals(connector.FromSectionId, connector.ToSectionId, StringComparison.Ordinal))
                    report.Error("CONNECTOR_SELF", $"{connector.Id}: connector must link different sections.");
            }
        }

        private static void ValidateConnectorEnd(
            string connectorId,
            string sectionId,
            string portalId,
            string endLabel,
            IReadOnlyDictionary<string, GroundSectionDefinition> sectionsById,
            GroundingValidationReport report)
        {
            if (!sectionsById.TryGetValue(sectionId ?? string.Empty, out var section))
            {
                report.Error("CONNECTOR_SECTION", $"{connectorId}: {endLabel} section {sectionId} does not exist.");
                return;
            }
            if (!section.Portals.Any(portal => portal != null && string.Equals(portal.Id, portalId, StringComparison.Ordinal)))
                report.Error("CONNECTOR_PORTAL", $"{connectorId}: {endLabel} portal {sectionId}/{portalId} does not exist.");
        }

        private static void ValidateCameraCoverage(
            IReadOnlyList<GroundSectionDefinition> sections,
            GroundingValidationReport report)
        {
            for (var first = 0; first < sections.Count; first++)
            for (var second = first + 1; second < sections.Count; second++)
            {
                var firstCamera = sections[first].CameraDefinition;
                var secondCamera = sections[second].CameraDefinition;
                if (firstCamera == null || secondCamera == null) continue;
                var intersection = IntersectXZ(firstCamera.Coverage, secondCamera.Coverage);
                if (intersection.x <= 0f || intersection.y <= 0f) continue;
                var overlapArea = intersection.x * intersection.y;
                var smallerArea = Mathf.Min(
                    firstCamera.Coverage.size.x * firstCamera.Coverage.size.z,
                    secondCamera.Coverage.size.x * secondCamera.Coverage.size.z);
                if (smallerArea > 0f && overlapArea / smallerArea > .08f)
                    report.Error(
                        "CAMERA_AMBIGUITY",
                        $"{sections[first].SectionId} and {sections[second].SectionId} camera coverage overlaps beyond the handoff strip.");
            }
        }

        private static void ValidateStructuralVariety(
            IReadOnlyList<GroundSectionDefinition> sections,
            GroundingValidationReport report)
        {
            var ratios = new List<(string id, float ratio, int bands, int holes)>();
            foreach (var section in sections)
            {
                var points = section.ElevationBands
                    .Where(band => band?.Surface != null)
                    .SelectMany(band => band.Surface.Outer)
                    .ToArray();
                if (points.Length == 0) continue;
                var width = points.Max(point => point.x) - points.Min(point => point.x);
                var depth = points.Max(point => point.y) - points.Min(point => point.y);
                var ratio = Mathf.Max(width, depth) / Mathf.Max(.01f, Mathf.Min(width, depth));
                ratios.Add((
                    section.SectionId,
                    ratio,
                    section.ElevationBands.Count,
                    section.ElevationBands.Sum(band => band?.Surface?.Holes.Count ?? 0)));
            }

            for (var first = 0; first < ratios.Count; first++)
            for (var second = first + 1; second < ratios.Count; second++)
            {
                var ratioDifference = Mathf.Abs(ratios[first].ratio - ratios[second].ratio);
                if (ratioDifference < .12f
                    && ratios[first].bands == ratios[second].bands
                    && ratios[first].holes == ratios[second].holes)
                    report.Warning(
                        "SECTION_SIMILARITY",
                        $"{ratios[first].id} and {ratios[second].id} have similar footprint/elevation signatures; review their silhouettes in camera.");
            }
        }

        private static Vector2 IntersectXZ(Bounds first, Bounds second)
        {
            var width = Mathf.Min(first.max.x, second.max.x) - Mathf.Max(first.min.x, second.min.x);
            var depth = Mathf.Min(first.max.z, second.max.z) - Mathf.Max(first.min.z, second.min.z);
            return new Vector2(width, depth);
        }
    }
}