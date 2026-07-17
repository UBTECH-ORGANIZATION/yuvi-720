using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Yuvi720.LearningWorld.Grounding;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    public static class GroundingWorldAssembler
    {
        public static GameObject BuildPrefabContents(WorldGroundingDefinition definition, string rootName)
        {
            var report = GroundingValidationService.Validate(definition);
            if (!report.IsValid)
                throw new InvalidOperationException(string.Join(
                    Environment.NewLine,
                    report.Issues.Where(issue => issue.Severity == GroundingIssueSeverity.Error)));

            GroundingAssetWriter.EnsureOutputFolders();
            var root = new GameObject(rootName);
            var visualRoot = Child(root.transform, "VisualRoot");
            var movementRoot = Child(root.transform, "MovementZones");
            var landmarkRoot = Child(root.transform, "LandmarkAnchors");
            var bridgeAnchorRoot = Child(root.transform, "BridgeAnchors");
            var sectionViewsRoot = Child(root.transform, "SectionViews");
            var connectorRoot = Child(visualRoot, "StructuralConnectors");
            var routeRoot = Child(root.transform, "GroundingRouteAnchors");

            root.AddComponent<TerrainVisual>().EditorAssignContract(
                visualRoot, movementRoot, landmarkRoot, bridgeAnchorRoot);
            root.AddComponent<WorldTraversalSurface>().EditorAssignContract(movementRoot);

            if (definition.FoundationBands.Count > 0)
            {
                BuildElevationBands(
                    "mainland",
                    definition.FoundationBands,
                    definition.FoundationTheme,
                    Child(visualRoot, "SharedMainlandFoundation"),
                    Child(movementRoot, "SharedMainlandFoundation"),
                    0);
            }

            var portals = new Dictionary<string, GroundPortalDefinition>(StringComparer.Ordinal);
            foreach (var section in definition.Sections)
            {
                var sectionVisual = Child(visualRoot, $"Section-{section.SectionId}");
                var sectionMovement = Child(movementRoot, $"Section-{section.SectionId}");
                BuildSection(section, sectionVisual, sectionMovement);
                BuildSectionView(section, sectionViewsRoot);
                foreach (var portal in section.Portals)
                {
                    portals.Add(PortalKey(section.SectionId, portal.Id), portal);
                    var anchor = Child(routeRoot, $"Portal-{section.SectionId}-{portal.Id}");
                    anchor.position = portal.Position;
                    anchor.rotation = Quaternion.LookRotation(portal.Forward.normalized, Vector3.up);
                }
            }

            foreach (var connector in definition.Connectors)
            {
                var start = portals[PortalKey(connector.FromSectionId, connector.FromPortalId)].Position;
                var end = portals[PortalKey(connector.ToSectionId, connector.ToPortalId)].Position;
                BuildTransition(
                    connectorRoot,
                    movementRoot,
                    connector.Id,
                    connector.Kind,
                    start,
                    end,
                    connector.Width,
                    connector.Kind == GroundTransitionKind.Stairs ? 6 : 1,
                    GroundingAssetWriter.GetMaterial(
                        definition.Sections.First(section => section.SectionId == connector.FromSectionId).Theme,
                        "route"));
            }

            BuildWater(Child(visualRoot, "WaterPlane"));

            root.GetComponent<WorldTraversalSurface>().RefreshSurfaceCache();
            return root;
        }

        // Large calm water plane the mainland sits in, reading as an island campus rather than floating discs.
        private static void BuildWater(Transform parent)
        {
            const float y = -1.55f;
            var min = new Vector2(-30f, -24f);
            var max = new Vector2(74f, 42f);
            var mesh = new Mesh { name = "MESH_YW_Production_WaterPlane" };
            mesh.vertices = new[]
            {
                new Vector3(min.x, y, min.y), new Vector3(min.x, y, max.y),
                new Vector3(max.x, y, max.y), new Vector3(max.x, y, min.y)
            };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.colors = Enumerable.Repeat(Grey(1f), 4).ToArray();
            mesh.uv = new[] { Vector2.zero, Vector2.up, Vector2.one, Vector2.right };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            var saved = GroundingAssetWriter.SaveMesh(mesh, "MESH_YW_Production_WaterPlane");
            var water = AddVisibleMesh(parent, "Water", saved, GroundingAssetWriter.GetSolidMaterial("MAT_YW_Grounding_Water", new Color(0.19f, 0.35f, 0.41f)));
            water.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
        }

        private static void BuildSection(
            GroundSectionDefinition section,
            Transform visualRoot,
            Transform movementRoot)
        {
            BuildElevationBands(section.SectionId, section.ElevationBands, section.Theme, visualRoot, movementRoot);

            foreach (var transition in section.Transitions)
            {
                BuildTransition(
                    visualRoot,
                    movementRoot,
                    transition.Id,
                    transition.Kind,
                    transition.Start,
                    transition.End,
                    transition.Width,
                    transition.StepCount,
                    GroundingAssetWriter.GetMaterial(section.Theme, transition.SurfaceFamily));
            }
        }

        private static void BuildElevationBands(
            string ownerId,
            IReadOnlyList<GroundElevationBandDefinition> bands,
            GroundThemeProfile theme,
            Transform visualRoot,
            Transform movementRoot,
            int topSubdivisions = 0)
        {
            foreach (var band in bands)
            {
                var triangulation = GroundPolygonTriangulator.Triangulate(band.Surface);
                if (!triangulation.Succeeded)
                    throw new InvalidOperationException($"{ownerId}/{band.Id}: {triangulation.Message}");
                if (!GroundPolygon.TryCreate(band.Surface, out var polygon, out var error))
                    throw new InvalidOperationException($"{ownerId}/{band.Id}: {error}");

                var meshPrefix = $"MESH_YW_Production_{ownerId}_{band.Id}";
                // Depressions (basins/ravine beds) keep shallow pit walls; land rises from one shared waterline base
                // so higher bands read as tall bluffs on a single mass, not thin plates stacked on plates.
                var cliffBottom = band.SurfaceFamily == "lower"
                    ? band.BottomHeight
                    : Mathf.Min(band.BottomHeight, SharedBaseHeight);
                var topMesh = GroundingAssetWriter.SaveMesh(
                    CreateTopMesh(meshPrefix + "_Top", triangulation, band.TopHeight, polygon, topSubdivisions),
                    meshPrefix + "_Top");
                var sideMesh = GroundingAssetWriter.SaveMesh(
                    CreateStratifiedCliffMesh(meshPrefix + "_Boundary", polygon, band.TopHeight, cliffBottom),
                    meshPrefix + "_Boundary");
                var lipMesh = GroundingAssetWriter.SaveMesh(
                    CreateRimLipMesh(meshPrefix + "_Lip", polygon, band.TopHeight),
                    meshPrefix + "_Lip");
                var topMaterial = GroundingAssetWriter.GetMaterial(theme, band.SurfaceFamily);
                // Flat tessellated tops must not receive shadows: the fan topology self-shadows into radial acne.
                var topObject = AddVisibleMesh(visualRoot, $"Band-{band.Id}-Top", topMesh, topMaterial);
                topObject.GetComponent<MeshRenderer>().receiveShadows = false;
                AddVisibleMesh(
                    visualRoot,
                    $"Band-{band.Id}-Boundary",
                    sideMesh,
                    GroundingAssetWriter.GetMaterial(theme, "cliff"));
                var lipObject = AddVisibleMesh(visualRoot, $"Band-{band.Id}-Lip", lipMesh, topMaterial);
                lipObject.GetComponent<MeshRenderer>().receiveShadows = false;

                if (!band.Traversable) continue;
                var traversalObject = Child(movementRoot, $"Traversal-{band.Id}");
                var collisionMesh = GroundingAssetWriter.SaveMesh(
                    CreateFlatColliderMesh(meshPrefix + "_Walk", triangulation, band.TopHeight),
                    meshPrefix + "_Walk");
                traversalObject.gameObject.AddComponent<MeshCollider>().sharedMesh = collisionMesh;
            }
        }

        private static void BuildTransition(
            Transform visualRoot,
            Transform movementRoot,
            string id,
            GroundTransitionKind kind,
            Vector3 start,
            Vector3 end,
            float width,
            int stepCount,
            Material material)
        {
            var visual = Child(visualRoot, $"Transition-{id}");
            var rise = Mathf.Abs(end.y - start.y);

            GroundingConnectorBuilder.ConnectorMesh cm;
            Material body, accent;
            string kindTag;
            if (kind == GroundTransitionKind.Bridge)
            {
                cm = GroundingConnectorBuilder.CreatePlankBridge($"MESH_YW_Conn_{id}", start, end, width);
                body = ConnectorMaterial("Timber", 0x8A6A46); accent = ConnectorMaterial("TimberTrim", 0x6E5334);
                kindTag = "Bridge";
            }
            else if (kind == GroundTransitionKind.Stairs || rise > 0.6f)
            {
                // Stairs, or a ramp steep enough to warrant a proper stone staircase.
                cm = GroundingConnectorBuilder.CreateStoneStair($"MESH_YW_Conn_{id}", start, end, width);
                body = ConnectorMaterial("Stone", 0xB8AC8E); accent = ConnectorMaterial("StoneTrim", 0xCFC6AC);
                kindTag = "Stair";
            }
            else
            {
                // Nearly-level link: a paved stone path connecting the two grounds.
                cm = GroundingConnectorBuilder.CreatePavedPath($"MESH_YW_Conn_{id}", start, end, width);
                body = ConnectorMaterial("Cobble", 0xAAA290); accent = ConnectorMaterial("StoneTrim", 0xD6CFBD);
                kindTag = "Path";
            }

            AddVisibleMesh(visual, $"{kindTag}-Body", GroundingAssetWriter.SaveMesh(cm.Structure, cm.Structure.name), body);
            if (cm.Accent != null && cm.Accent.vertexCount > 0)
                AddVisibleMesh(visual, $"{kindTag}-Trim", GroundingAssetWriter.SaveMesh(cm.Accent, cm.Accent.name), accent);

            // Walkable surface kept separate/invisible under MovementZones so a future Yuvi-asset gate can toggle it.
            var traversalObject = Child(movementRoot, $"Traversal-{id}");
            traversalObject.gameObject.AddComponent<MeshCollider>().sharedMesh =
                GroundingAssetWriter.SaveMesh(cm.Walk, cm.Walk.name);
        }

        private static Material ConnectorMaterial(string name, int hex)
        {
            var color = new Color(((hex >> 16) & 0xFF) / 255f, ((hex >> 8) & 0xFF) / 255f, (hex & 0xFF) / 255f);
            return GroundingAssetWriter.GetConnectorMaterial($"MAT_YW_Connector_{name}", color);
        }

        private static void BuildSectionView(GroundSectionDefinition section, Transform parent)
        {
            var definition = section.CameraDefinition;
            var root = Child(parent, $"SectionView-{section.SectionId}");
            var anchor = Child(root, "CameraAnchor");
            anchor.position = definition.AnchorPosition;
            anchor.rotation = Quaternion.Euler(definition.AnchorEuler);
            var coverageObject = Child(root, "CoverageVolume");
            var coverage = coverageObject.gameObject.AddComponent<BoxCollider>();
            coverage.isTrigger = true;
            coverage.center = definition.Coverage.center;
            coverage.size = definition.Coverage.size;
            var atmosphere = Child(root, "AtmosphereRoot");
            root.gameObject.AddComponent<WorldSectionView>().Configure(
                section.SectionId,
                anchor,
                coverage,
                atmosphere,
                definition.OrthographicSize);
        }

        // Stylized-ground tuning constants. Kept here (not Inspector magic) so the baked look is reproducible.
        private const int CliffSegments = 4;          // vertical strata per cliff edge (shading + silhouette)
        private const float CliffBatter = 0.9f;       // how far the base flares outward from the top edge
        private const float CliffJitter = 0.18f;      // deterministic horizontal wobble for faceted rock
        private const float CliffTopInset = 0.18f;    // rock tucked under the grass cap so turf overhangs stone
        private const float LipOutset = 0.04f;        // grass fringe barely oversails the exact top edge
        private const float LipDrop = 0.09f;          // depth of the grassy overhang fringe (small: no floating tabs)
        private const float TopEdgeAoRange = 1.3f;    // thin rim contact-shadow band only (avoids a radial AO gradient)
        private const float SharedBaseHeight = -1.7f; // waterline base every land cliff drops to (unifies the mass)

        private static Mesh CreateTopMesh(
            string name,
            GroundTriangulationResult triangulation,
            float height,
            GroundPolygon polygon,
            int subdivisions)
        {
            var vertices = triangulation.Vertices
                .Select(point => new Vector3(point.x, height, point.y))
                .ToList();
            var triangles = triangulation.Triangles.ToList();
            // Subdivide the ear-clipped fan into small triangles so baked AO reads as a smooth wash, not radiating rays.
            SubdivideTriangles(vertices, triangles, subdivisions);

            var colors = new Color[vertices.Count];
            for (var index = 0; index < vertices.Count; index++)
            {
                var p = new Vector2(vertices[index].x, vertices[index].z);
                // Only soft low-frequency meadow patches: a rim-AO term would interpolate into radial wedges across the
                // large fan triangles. Edge grounding instead comes from the grass lip underside and the cliff top-AO.
                var patch = 1f + 0.05f * Hash(p * 0.16f) + 0.025f * Hash(p * 0.85f);
                colors[index] = Grey(0.97f * patch);
            }

            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.colors = colors;
            mesh.uv = vertices.Select(v => new Vector2(v.x, v.z) * .08f).ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        // Loop-style midpoint subdivision: each triangle becomes four, shared edges deduplicated via a midpoint cache.
        private static void SubdivideTriangles(List<Vector3> vertices, List<int> triangles, int iterations)
        {
            for (var pass = 0; pass < iterations; pass++)
            {
                var midCache = new Dictionary<long, int>();
                var next = new List<int>(triangles.Count * 4);
                for (var i = 0; i < triangles.Count; i += 3)
                {
                    int a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
                    int ab = EdgeMidpoint(vertices, midCache, a, b);
                    int bc = EdgeMidpoint(vertices, midCache, b, c);
                    int ca = EdgeMidpoint(vertices, midCache, c, a);
                    next.AddRange(new[] { a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca });
                }
                triangles.Clear();
                triangles.AddRange(next);
            }
        }

        private static int EdgeMidpoint(List<Vector3> vertices, Dictionary<long, int> cache, int a, int b)
        {
            var key = a < b ? (long)a << 32 | (uint)b : (long)b << 32 | (uint)a;
            if (cache.TryGetValue(key, out var existing)) return existing;
            var index = vertices.Count;
            vertices.Add((vertices[a] + vertices[b]) * 0.5f);
            cache[key] = index;
            return index;
        }

        // Flat, simplified surface used only for the invisible traversal collider (no lip, no AO, no noise).
        private static Mesh CreateFlatColliderMesh(
            string name,
            GroundTriangulationResult triangulation,
            float height)
        {
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.vertices = triangulation.Vertices.Select(point => new Vector3(point.x, height, point.y)).ToArray();
            mesh.triangles = triangulation.Triangles.ToArray();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateStratifiedCliffMesh(
            string name,
            GroundPolygon polygon,
            float topHeight,
            float bottomHeight)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var colors = new List<Color>();
            // Chunkier facets than the finely-rounded top edge read as bold stylized rock; the grass cap hides the seam.
            AddCliffRing(DecimateRing(polygon.Outer, 34), topHeight, bottomHeight, 1f, vertices, triangles, colors, false);
            foreach (var hole in polygon.Holes)
                AddCliffRing(DecimateRing(hole, 16), topHeight, bottomHeight, -1f, vertices, triangles, colors, true);
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetColors(colors);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddCliffRing(
            IReadOnlyList<Vector2> ring,
            float topHeight,
            float bottomHeight,
            float outwardSign,
            List<Vector3> vertices,
            List<int> triangles,
            List<Color> colors,
            bool reverse)
        {
            // Per-VERTEX outward normals (averaged from the two adjacent edges) so neighbouring wall quads
            // share the exact same corner and the ring stays watertight. Per-edge normals flared each quad
            // along a different direction at every bend, leaving a vertical slit (the visible wall holes).
            var vertexOutward = new Vector2[ring.Count];
            for (var i = 0; i < ring.Count; i++)
            {
                var prev = ring[(i - 1 + ring.Count) % ring.Count];
                var cur = ring[i];
                var nxt = ring[(i + 1) % ring.Count];
                var sum = OutwardNormal(prev, cur) + OutwardNormal(cur, nxt);
                var n = sum.sqrMagnitude > 1e-6f ? sum.normalized : OutwardNormal(cur, nxt);
                vertexOutward[i] = n * outwardSign;
            }

            for (var index = 0; index < ring.Count; index++)
            {
                var current = ring[index];
                var next = ring[(index + 1) % ring.Count];
                var outC = vertexOutward[index];
                var outN = vertexOutward[(index + 1) % ring.Count];
                var jitterA = CliffJitter * Hash(current * 1.3f);
                var jitterB = CliffJitter * Hash(next * 1.3f);

                for (var s = 0; s < CliffSegments; s++)
                {
                    var tTop = s / (float)CliffSegments;
                    var tBot = (s + 1) / (float)CliffSegments;
                    // Start tucked under the grass cap (inset), then flare outward toward the base.
                    var offTop = -CliffTopInset + CliffBatter * Mathf.SmoothStep(0f, 1f, tTop);
                    var offBot = -CliffTopInset + CliffBatter * Mathf.SmoothStep(0f, 1f, tBot);
                    // NOTE: the alternating outward ledge step was removed — it made adjacent strata sit at
                    // different outward offsets, opening a horizontal gap (the "two transparent lines") between
                    // segments where the overhang undersides faced away and culled. A smooth continuous batter
                    // keeps the rim solid top-to-bottom. Per-stratum shading is still applied via vertex AO below.

                    var cTop = Plane(current, outC, offTop + jitterA, Mathf.Lerp(topHeight, bottomHeight, tTop));
                    var nTop = Plane(next, outN, offTop + jitterB, Mathf.Lerp(topHeight, bottomHeight, tTop));
                    var nBot = Plane(next, outN, offBot + jitterB, Mathf.Lerp(topHeight, bottomHeight, tBot));
                    var cBot = Plane(current, outC, offBot + jitterA, Mathf.Lerp(topHeight, bottomHeight, tBot));

                    var offset = vertices.Count;
                    vertices.Add(cTop);
                    vertices.Add(nTop);
                    vertices.Add(nBot);
                    vertices.Add(cBot);

                    // AO: darker toward the base (deep 'wet' contact at the waterline), subtle per-stratum banding.
                    var aoTop = Mathf.Lerp(0.95f, 0.34f, tTop) * (s % 2 == 0 ? 1f : 0.88f);
                    var aoBot = Mathf.Lerp(0.95f, 0.34f, tBot) * (s % 2 == 0 ? 1f : 0.88f);
                    colors.Add(Grey(aoTop));
                    colors.Add(Grey(aoTop));
                    colors.Add(Grey(aoBot));
                    colors.Add(Grey(aoBot));

                    if (reverse)
                        triangles.AddRange(new[] { offset, offset + 2, offset + 1, offset, offset + 3, offset + 2 });
                    else
                        triangles.AddRange(new[] { offset, offset + 1, offset + 2, offset, offset + 2, offset + 3 });
                }
            }
        }

        // Rounded grassy lip that oversails the cliff top, hiding the hard seam and catching light like real turf.
        private static Mesh CreateRimLipMesh(string name, GroundPolygon polygon, float topHeight)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var colors = new List<Color>();
            var ring = polygon.Outer;
            for (var index = 0; index < ring.Count; index++)
            {
                var current = ring[index];
                var next = ring[(index + 1) % ring.Count];
                var outward = OutwardNormal(current, next);
                var jitterA = 0.05f * Hash(current * 2.1f);
                var jitterB = 0.05f * Hash(next * 2.1f);

                var cInner = new Vector3(current.x, topHeight + 0.03f, current.y);
                var nInner = new Vector3(next.x, topHeight + 0.03f, next.y);
                var cOuter = Plane(current, outward, LipOutset + jitterA, topHeight - LipDrop);
                var nOuter = Plane(next, outward, LipOutset + jitterB, topHeight - LipDrop);

                var offset = vertices.Count;
                vertices.Add(cInner);
                vertices.Add(nInner);
                vertices.Add(nOuter);
                vertices.Add(cOuter);
                colors.Add(Grey(1f));
                colors.Add(Grey(1f));
                colors.Add(Grey(0.68f));
                colors.Add(Grey(0.68f));
                triangles.AddRange(new[] { offset, offset + 1, offset + 2, offset, offset + 2, offset + 3 });
            }

            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetColors(colors);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Vector3 Plane(Vector2 basePoint, Vector2 outward, float offset, float height)
        {
            var p = basePoint + outward * offset;
            return new Vector3(p.x, height, p.y);
        }

        private static IReadOnlyList<Vector2> DecimateRing(IReadOnlyList<Vector2> ring, int target)
        {
            if (ring.Count <= target) return ring;
            var result = new List<Vector2>(target);
            for (var i = 0; i < target; i++)
                result.Add(ring[Mathf.RoundToInt(i * ring.Count / (float)target) % ring.Count]);
            return result;
        }

        private static Vector2 OutwardNormal(Vector2 current, Vector2 next)
        {
            var edge = next - current;
            // For a CCW outer ring in the XZ plane, (edge.y, -edge.x) points away from the interior.
            var normal = new Vector2(edge.y, -edge.x);
            return normal.sqrMagnitude < 1e-6f ? Vector2.right : normal.normalized;
        }

        private static float DistanceToRings(Vector2 point, GroundPolygon polygon)
        {
            var best = DistanceToRing(point, polygon.Outer);
            foreach (var hole in polygon.Holes)
                best = Mathf.Min(best, DistanceToRing(point, hole));
            return best;
        }

        private static float DistanceToRing(Vector2 point, IReadOnlyList<Vector2> ring)
        {
            var best = float.MaxValue;
            for (var index = 0; index < ring.Count; index++)
            {
                var a = ring[index];
                var b = ring[(index + 1) % ring.Count];
                var ab = b - a;
                var t = ab.sqrMagnitude < 1e-6f ? 0f : Mathf.Clamp01(Vector2.Dot(point - a, ab) / ab.sqrMagnitude);
                best = Mathf.Min(best, Vector2.Distance(point, a + ab * t));
            }
            return best;
        }

        // Deterministic value noise in [-1, 1] so bakes are reproducible without System.Random.
        private static float Hash(Vector2 p)
        {
            var v = Mathf.Sin(Vector2.Dot(p, new Vector2(12.9898f, 78.233f))) * 43758.5453f;
            return (v - Mathf.Floor(v)) * 2f - 1f;
        }

        private static Color Grey(float value)
        {
            var v = Mathf.Clamp01(value);
            return new Color(v, v, v, 1f);
        }

        private static Mesh CreateTransitionTopMesh(string name, Vector3 start, Vector3 end, float width)
        {
            GetTransitionCorners(start, end, width, out var startLeft, out var startRight, out var endLeft, out var endRight);
            var mesh = new Mesh { name = name };
            mesh.vertices = new[] { startLeft, endLeft, endRight, startRight };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.uv = new[] { Vector2.zero, Vector2.up, Vector2.one, Vector2.right };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateSlabMesh(string name, Vector3 start, Vector3 end, float width, float thickness)
        {
            GetTransitionCorners(start, end, width, out var startLeft, out var startRight, out var endLeft, out var endRight);
            var down = Vector3.down * thickness;
            var vertices = new[]
            {
                startLeft, endLeft, endRight, startRight,
                startLeft + down, endLeft + down, endRight + down, startRight + down
            };
            var triangles = new[]
            {
                0, 1, 2, 0, 2, 3,
                4, 6, 5, 4, 7, 6,
                0, 4, 5, 0, 5, 1,
                3, 2, 6, 3, 6, 7,
                0, 3, 7, 0, 7, 4,
                1, 5, 6, 1, 6, 2
            };
            var mesh = new Mesh { name = name };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.colors = vertices.Select(v => Grey(v.y < (start.y + end.y) * .5f - .05f ? 0.72f : 1f)).ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateBoxMesh(string name, Vector3 center, Vector3 size, Quaternion rotation)
        {
            var half = size * .5f;
            var local = new[]
            {
                new Vector3(-half.x, -half.y, -half.z), new Vector3(half.x, -half.y, -half.z),
                new Vector3(half.x, -half.y, half.z), new Vector3(-half.x, -half.y, half.z),
                new Vector3(-half.x, half.y, -half.z), new Vector3(half.x, half.y, -half.z),
                new Vector3(half.x, half.y, half.z), new Vector3(-half.x, half.y, half.z)
            };
            var vertices = local.Select(point => center + rotation * point).ToArray();
            var triangles = new[]
            {
                4, 7, 6, 4, 6, 5,
                0, 1, 2, 0, 2, 3,
                0, 4, 5, 0, 5, 1,
                1, 5, 6, 1, 6, 2,
                2, 6, 7, 2, 7, 3,
                3, 7, 4, 3, 4, 0
            };
            var mesh = new Mesh { name = name };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.colors = Enumerable.Repeat(Grey(0.96f), vertices.Length).ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void GetTransitionCorners(
            Vector3 start,
            Vector3 end,
            float width,
            out Vector3 startLeft,
            out Vector3 startRight,
            out Vector3 endLeft,
            out Vector3 endRight)
        {
            var horizontal = new Vector3(end.x - start.x, 0f, end.z - start.z);
            if (horizontal.sqrMagnitude < .001f)
                throw new InvalidOperationException("Ground transition requires horizontal length.");
            var right = Vector3.Cross(Vector3.up, horizontal.normalized) * width * .5f;
            startLeft = start - right;
            startRight = start + right;
            endLeft = end - right;
            endRight = end + right;
        }

        private static Transform AddVisibleMesh(Transform parent, string name, Mesh mesh, Material material)
        {
            var transform = Child(parent, name);
            transform.gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
            transform.gameObject.AddComponent<MeshRenderer>().sharedMaterial = material;
            return transform;
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static string PortalKey(string sectionId, string portalId)
        {
            return sectionId + "/" + portalId;
        }
    }
}