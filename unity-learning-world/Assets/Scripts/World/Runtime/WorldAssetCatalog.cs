using System;
using System.Collections.Generic;
using UnityEngine;

namespace Yuvi720.LearningWorld
{
    public enum WorldAssetKind
    {
        Terrain,
        Landmark,
        Bridge,
        Character,
        Effect,
        Prop,
        Vegetation,
        Water
    }

    public enum WorldAssetReviewStatus
    {
        Draft,
        GrayscaleApproved,
        ColorApproved,
        IntegrationApproved
    }

    [Serializable]
    public sealed class WorldPrefabEntry
    {
        [SerializeField] private string assetId;
        [SerializeField] private WorldAssetKind kind;
        [SerializeField] private GameObject prefab;
        [SerializeField] private GameObject lowPowerSubstitute;
        [SerializeField] private string[] allowedTintMaskIds = Array.Empty<string>();
        [SerializeField, Min(0f)] private float density;
        [SerializeField, Min(0f)] private float exclusionRadius;
        [SerializeField, Min(1)] private int version = 1;
        [SerializeField] private WorldAssetReviewStatus reviewStatus;

        public string AssetId => assetId;
        public WorldAssetKind Kind => kind;
        public GameObject Prefab => prefab;
        public GameObject LowPowerSubstitute => lowPowerSubstitute;
        public IReadOnlyList<string> AllowedTintMaskIds => allowedTintMaskIds;
        public float Density => density;
        public float ExclusionRadius => exclusionRadius;
        public int Version => version;
        public WorldAssetReviewStatus ReviewStatus => reviewStatus;

        public WorldPrefabEntry(string assetId, WorldAssetKind kind, GameObject prefab)
        {
            this.assetId = assetId;
            this.kind = kind;
            this.prefab = prefab;
        }

        public GameObject Resolve(bool lowPower)
        {
            return lowPower && lowPowerSubstitute != null ? lowPowerSubstitute : prefab;
        }

#if UNITY_EDITOR
        public void EditorSetFoundation(WorldAssetKind assetKind, GameObject assetPrefab)
        {
            kind = assetKind;
            prefab = assetPrefab;
        }
#endif
    }

    [CreateAssetMenu(fileName = "SO_YW_WorldAssetCatalog", menuName = "Yuvi/World/Asset Catalog")]
    public sealed class WorldAssetCatalog : ScriptableObject
    {
        public const int CurrentSchemaVersion = 1;

        [SerializeField, Min(1)] private int schemaVersion = CurrentSchemaVersion;
        [SerializeField] private string catalogId = "production";
        [SerializeField] private GameObject missingAssetFallback;
        [SerializeField] private GameObject availableStateOverlay;
        [SerializeField] private GameObject currentStateOverlay;
        [SerializeField] private GameObject lockedStateOverlay;
        [SerializeField] private GameObject completedStateOverlay;
        [SerializeField] private List<WorldPrefabEntry> prefabs = new();

        public int SchemaVersion => schemaVersion;
        public string CatalogId => catalogId;
        public GameObject MissingAssetFallback => missingAssetFallback;
        public IReadOnlyList<WorldPrefabEntry> Prefabs => prefabs;

        public bool TryResolve(string assetId, bool lowPower, out GameObject prefab)
        {
            foreach (var entry in prefabs)
            {
                if (entry == null || !string.Equals(entry.AssetId, assetId, StringComparison.Ordinal)) continue;
                prefab = entry.Resolve(lowPower);
                return prefab != null;
            }

            prefab = missingAssetFallback;
            return prefab != null;
        }

        public GameObject GetStateOverlay(string state)
        {
            return state switch
            {
                "available" => availableStateOverlay,
                "current" => currentStateOverlay,
                "locked" => lockedStateOverlay,
                "completed" => completedStateOverlay,
                _ => null
            };
        }

        public void CollectValidationIssues(List<string> issues)
        {
            if (issues == null) throw new ArgumentNullException(nameof(issues));
            if (schemaVersion != CurrentSchemaVersion)
                issues.Add($"Catalog schema {schemaVersion} does not match {CurrentSchemaVersion}.");
            if (string.IsNullOrWhiteSpace(catalogId)) issues.Add("Catalog ID is required.");

            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in prefabs)
            {
                if (entry == null)
                {
                    issues.Add("Catalog contains a null prefab entry.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(entry.AssetId))
                    issues.Add("Every prefab entry requires an asset ID.");
                else if (!ids.Add(entry.AssetId))
                    issues.Add($"Duplicate asset ID: {entry.AssetId}.");
                if (entry.Prefab == null) issues.Add($"{entry.AssetId}: primary prefab is required.");
                if (entry.Version < 1) issues.Add($"{entry.AssetId}: version must be at least 1.");
                if (entry.Density < 0f) issues.Add($"{entry.AssetId}: density cannot be negative.");
                if (entry.ExclusionRadius < 0f) issues.Add($"{entry.AssetId}: exclusion radius cannot be negative.");
            }
        }

#if UNITY_EDITOR
        public void EditorEnsureFoundationEntry(string assetId, WorldAssetKind kind, GameObject prefab)
        {
            foreach (var entry in prefabs)
            {
                if (entry == null || !string.Equals(entry.AssetId, assetId, StringComparison.Ordinal)) continue;
                entry.EditorSetFoundation(kind, prefab);
                return;
            }
            prefabs.Add(new WorldPrefabEntry(assetId, kind, prefab));
        }
#endif
    }
}