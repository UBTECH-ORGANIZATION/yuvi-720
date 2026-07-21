using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Yuvi720.LearningWorld.Grounding;

namespace Yuvi720.LearningWorld.Tests
{
    public sealed class GroundingGeometryTests
    {
        [Test]
        public void TriangulatesConvexPolygonWithUpwardWinding()
        {
            var result = GroundPolygonTriangulator.Triangulate(Polygon(
                new Vector2(0f, 0f), new Vector2(5f, 0f),
                new Vector2(5f, 4f), new Vector2(0f, 4f)));

            Assert.That(result.Succeeded, Is.True, result.Message);
            Assert.That(result.Triangles.Count, Is.EqualTo(6));
            Assert.That(TriangleArea(result), Is.EqualTo(20f).Within(.001f));
            AssertUpwardWinding(result);
        }

        [Test]
        public void TriangulatesConcaveHookWithoutCenterFanArtifacts()
        {
            var definition = Polygon(
                new Vector2(0f, 0f), new Vector2(7f, 0f), new Vector2(7f, 2f),
                new Vector2(3f, 2f), new Vector2(3f, 6f), new Vector2(0f, 6f));
            var result = GroundPolygonTriangulator.Triangulate(definition);

            Assert.That(result.Succeeded, Is.True, result.Message);
            Assert.That(TriangleArea(result), Is.EqualTo(26f).Within(.001f));
            AssertUpwardWinding(result);
        }

        [Test]
        public void TriangulatesPolygonWithLowerCourtHole()
        {
            var definition = PolygonWithHoles(
                new[]
                {
                    new Vector2(0f, 0f), new Vector2(12f, 0f),
                    new Vector2(12f, 10f), new Vector2(0f, 10f)
                },
                new[]
                {
                    new Vector2(4f, 3f), new Vector2(4f, 7f),
                    new Vector2(8f, 7f), new Vector2(8f, 3f)
                });
            var result = GroundPolygonTriangulator.Triangulate(definition);

            Assert.That(result.Succeeded, Is.True, result.Message);
            Assert.That(TriangleArea(result), Is.EqualTo(104f).Within(.01f));
            AssertUpwardWinding(result);
        }

        [Test]
        public void TriangulatesMultipleHolesDeterministically()
        {
            var definition = PolygonWithHoles(
                new[]
                {
                    new Vector2(0f, 0f), new Vector2(18f, 0f),
                    new Vector2(18f, 12f), new Vector2(0f, 12f)
                },
                new[]
                {
                    new Vector2(3f, 3f), new Vector2(3f, 6f),
                    new Vector2(6f, 6f), new Vector2(6f, 3f)
                },
                new[]
                {
                    new Vector2(11f, 5f), new Vector2(11f, 9f),
                    new Vector2(15f, 9f), new Vector2(15f, 5f)
                });
            var first = GroundPolygonTriangulator.Triangulate(definition);
            var second = GroundPolygonTriangulator.Triangulate(definition);

            Assert.That(first.Succeeded, Is.True, first.Message);
            Assert.That(second.Succeeded, Is.True, second.Message);
            Assert.That(TriangleArea(first), Is.EqualTo(191f).Within(.01f));
            Assert.That(second.Vertices, Is.EqualTo(first.Vertices));
            Assert.That(second.Triangles, Is.EqualTo(first.Triangles));
        }

        [Test]
        public void NormalizesReversedWindingAndProducesSameArea()
        {
            var clockwise = Polygon(
                new Vector2(0f, 4f), new Vector2(5f, 4f),
                new Vector2(5f, 0f), new Vector2(0f, 0f));
            var result = GroundPolygonTriangulator.Triangulate(clockwise);

            Assert.That(result.Succeeded, Is.True, result.Message);
            Assert.That(TriangleArea(result), Is.EqualTo(20f).Within(.001f));
            AssertUpwardWinding(result);
        }

        [Test]
        public void CleansDuplicateClosingPointsAndNearCollinearPoints()
        {
            var definition = Polygon(
                new Vector2(0f, 0f), new Vector2(2f, .000001f), new Vector2(4f, 0f),
                new Vector2(4f, 3f), new Vector2(4f, 3f), new Vector2(0f, 3f),
                new Vector2(0f, 0f));
            var result = GroundPolygonTriangulator.Triangulate(definition);

            Assert.That(result.Succeeded, Is.True, result.Message);
            Assert.That(result.Vertices.Count, Is.EqualTo(4));
            Assert.That(TriangleArea(result), Is.EqualTo(12f).Within(.001f));
        }

        [Test]
        public void RejectsSelfIntersectingBoundaryWithoutPartialTriangles()
        {
            var result = GroundPolygonTriangulator.Triangulate(Polygon(
                new Vector2(0f, 0f), new Vector2(5f, 5f),
                new Vector2(0f, 5f), new Vector2(5f, 0f)));

            Assert.That(result.Succeeded, Is.False);
            Assert.That(result.Failure, Is.EqualTo(GroundTriangulationFailure.InvalidPolygon));
            Assert.That(result.Triangles, Is.Empty);
            StringAssert.Contains("self-intersects", result.Message);
        }

        [Test]
        public void RejectsHoleTouchingOuterBoundary()
        {
            var result = GroundPolygonTriangulator.Triangulate(PolygonWithHoles(
                new[]
                {
                    new Vector2(0f, 0f), new Vector2(10f, 0f),
                    new Vector2(10f, 10f), new Vector2(0f, 10f)
                },
                new[]
                {
                    new Vector2(7f, 3f), new Vector2(7f, 7f),
                    new Vector2(10f, 7f), new Vector2(10f, 3f)
                }));

            Assert.That(result.Succeeded, Is.False);
            Assert.That(result.Triangles, Is.Empty);
            StringAssert.Contains("Hole", result.Message);
        }

        [Test]
        public void RejectsHoleOutsideOuterBoundary()
        {
            var result = GroundPolygonTriangulator.Triangulate(PolygonWithHoles(
                new[]
                {
                    new Vector2(0f, 0f), new Vector2(10f, 0f),
                    new Vector2(10f, 10f), new Vector2(0f, 10f)
                },
                new[]
                {
                    new Vector2(12f, 2f), new Vector2(12f, 4f),
                    new Vector2(14f, 4f), new Vector2(14f, 2f)
                }));

            Assert.That(result.Succeeded, Is.False);
            Assert.That(result.Triangles, Is.Empty);
            StringAssert.Contains("strictly inside", result.Message);
        }

        [Test]
        public void ValidationRejectsDuplicateSectionIdsAndBrokenConnectorReferences()
        {
            var theme = ScriptableObject.CreateInstance<GroundThemeProfile>();
            var first = CreateSection("duplicate", theme, new Bounds(Vector3.zero, new Vector3(10f, 6f, 10f)));
            var second = CreateSection("duplicate", theme, new Bounds(new Vector3(20f, 0f, 0f), new Vector3(10f, 6f, 10f)));
            var world = ScriptableObject.CreateInstance<WorldGroundingDefinition>();
            try
            {
                world.Configure(
                    "test",
                    new[] { first, second },
                    new[]
                    {
                        new GroundConnectorDefinition(
                            "broken", "duplicate", "missing", "other", "missing",
                            GroundTransitionKind.Ramp, 2f)
                    },
                    10f,
                    2000);
                var report = GroundingValidationService.Validate(world);

                Assert.That(report.IsValid, Is.False);
                Assert.That(report.Issues.Any(issue => issue.Code == "SECTION_DUPLICATE"), Is.True);
                Assert.That(report.Issues.Any(issue => issue.Code == "CONNECTOR_SECTION"), Is.True);
                Assert.That(report.Issues.Any(issue => issue.Code == "CONNECTOR_PORTAL"), Is.True);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(world);
                UnityEngine.Object.DestroyImmediate(first);
                UnityEngine.Object.DestroyImmediate(second);
                UnityEngine.Object.DestroyImmediate(theme);
            }
        }

        [Test]
        public void ValidAuthoredDefinitionPassesWithoutErrors()
        {
            var theme = ScriptableObject.CreateInstance<GroundThemeProfile>();
            var first = CreateSection("arrival", theme, new Bounds(Vector3.zero, new Vector3(11f, 6f, 10f)));
            var second = CreateSection("court", theme, new Bounds(new Vector3(11f, 0f, 0f), new Vector3(11f, 6f, 10f)));
            var world = ScriptableObject.CreateInstance<WorldGroundingDefinition>();
            try
            {
                first.Configure(
                    first.SectionId,
                    first.DisplayName,
                    theme,
                    first.ElevationBands.ToArray(),
                    Array.Empty<GroundTransitionDefinition>(),
                    new[] { new GroundPortalDefinition("out", new Vector3(5f, 0f, 0f), Vector3.right, 2f) },
                    Array.Empty<GroundReservedZoneDefinition>(),
                    first.CameraDefinition);
                second.Configure(
                    second.SectionId,
                    second.DisplayName,
                    theme,
                    second.ElevationBands.ToArray(),
                    Array.Empty<GroundTransitionDefinition>(),
                    new[] { new GroundPortalDefinition("in", new Vector3(6f, 0f, 0f), Vector3.left, 2f) },
                    Array.Empty<GroundReservedZoneDefinition>(),
                    second.CameraDefinition);
                world.Configure(
                    "valid",
                    new[] { first, second },
                    new[]
                    {
                        new GroundConnectorDefinition(
                            "arrival-court", "arrival", "out", "court", "in",
                            GroundTransitionKind.Ramp, 2f)
                    },
                    10f,
                    2000);
                var report = GroundingValidationService.Validate(world);

                Assert.That(report.IsValid, Is.True, string.Join(Environment.NewLine, report.Issues));
                Assert.That(report.EstimatedTriangleCount, Is.GreaterThan(0));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(world);
                UnityEngine.Object.DestroyImmediate(first);
                UnityEngine.Object.DestroyImmediate(second);
                UnityEngine.Object.DestroyImmediate(theme);
            }
        }

        private static GroundSectionDefinition CreateSection(string id, GroundThemeProfile theme, Bounds coverage)
        {
            var section = ScriptableObject.CreateInstance<GroundSectionDefinition>();
            section.Configure(
                id,
                id,
                theme,
                new[]
                {
                    new GroundElevationBandDefinition(
                        "base",
                        0f,
                        -1f,
                        Polygon(
                            new Vector2(coverage.min.x, coverage.min.z),
                            new Vector2(coverage.max.x, coverage.min.z),
                            new Vector2(coverage.max.x, coverage.max.z),
                            new Vector2(coverage.min.x, coverage.max.z)),
                        true,
                        "primary")
                },
                Array.Empty<GroundTransitionDefinition>(),
                Array.Empty<GroundPortalDefinition>(),
                Array.Empty<GroundReservedZoneDefinition>(),
                new GroundCameraDefinition(
                    coverage.center + new Vector3(0f, 15f, -10f),
                    new Vector3(52f, 0f, 0f),
                    10f,
                    coverage));
            return section;
        }

        private static GroundPolygonDefinition Polygon(params Vector2[] outer)
        {
            return new GroundPolygonDefinition(outer);
        }

        private static GroundPolygonDefinition PolygonWithHoles(
            IReadOnlyList<Vector2> outer,
            params Vector2[][] holes)
        {
            return new GroundPolygonDefinition(
                outer,
                holes.Select(hole => new GroundPolygonRingDefinition(hole)));
        }

        private static float TriangleArea(GroundTriangulationResult result)
        {
            var area = 0f;
            for (var index = 0; index < result.Triangles.Count; index += 3)
            {
                var a = result.Vertices[result.Triangles[index]];
                var b = result.Vertices[result.Triangles[index + 1]];
                var c = result.Vertices[result.Triangles[index + 2]];
                area += Mathf.Abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * .5f;
            }
            return area;
        }

        private static void AssertUpwardWinding(GroundTriangulationResult result)
        {
            for (var index = 0; index < result.Triangles.Count; index += 3)
            {
                var a2 = result.Vertices[result.Triangles[index]];
                var b2 = result.Vertices[result.Triangles[index + 1]];
                var c2 = result.Vertices[result.Triangles[index + 2]];
                var a = new Vector3(a2.x, 0f, a2.y);
                var b = new Vector3(b2.x, 0f, b2.y);
                var c = new Vector3(c2.x, 0f, c2.y);
                Assert.That(Vector3.Cross(b - a, c - a).y, Is.GreaterThan(0f));
            }
        }
    }
}