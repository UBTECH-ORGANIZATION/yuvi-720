using System;
using UnityEditor;
using UnityEditor.AddressableAssets;
using UnityEditor.AddressableAssets.Build;
using UnityEditor.AddressableAssets.Settings;
using UnityEditor.AddressableAssets.Settings.GroupSchemas;
using UnityEngine;

namespace Yuvi720.Editor
{
    /// <summary>
    /// Configures Addressables so each world section ships as its own REMOTE bundle (downloaded on demand)
    /// rather than being packed into the WebGL <c>.data</c> blob. Bundles + the remote catalog build to a
    /// ServerData folder; their load path is a sentinel (<see cref="Sentinel"/>) that the runtime
    /// <c>AddressablesUrlRewrite</c> swaps for the real hosting URL, so one build works on the dev server and
    /// in production. See <c>SectionStreamer</c> / [[yuvi-section-streaming]].
    /// </summary>
    public static class StreamedWorldAddressables
    {
        public const string Sentinel = "http://__yuvi_serverdata__";
        public const string GroupName = "Sections";
        private const string RemoteBuild = "RemoteBuildPath";
        private const string RemoteLoad = "RemoteLoadPath";

        // Section scenes → Addressable address. Extend this as sections are added.
        private static readonly (string path, string address)[] Sections =
        {
            ("Assets/Scenes/ArtReview/Grounding/SCN_YW_Section_Arrival.unity", "section.arrival"),
        };

        /// <summary>Point the remote profile at <paramref name="remoteBuildPath"/>, ensure the Sections group
        /// exists with remote build/load paths, and register every section scene as an Addressable.</summary>
        public static void Configure(string remoteBuildPath)
        {
            var settings = AddressableAssetSettingsDefaultObject.GetSettings(true);
            var profileId = settings.activeProfileId;

            // ServerData build dir (per platform) + sentinel load path resolved at runtime by the URL rewrite.
            settings.profileSettings.SetValue(profileId, RemoteBuild, remoteBuildPath + "/[BuildTarget]");
            settings.profileSettings.SetValue(profileId, RemoteLoad, Sentinel + "/[BuildTarget]");

            settings.BuildRemoteCatalog = true;
            settings.RemoteCatalogBuildPath.SetVariableByName(settings, RemoteBuild);
            settings.RemoteCatalogLoadPath.SetVariableByName(settings, RemoteLoad);

            var group = settings.FindGroup(GroupName) ?? settings.CreateGroup(
                GroupName, false, false, true, null,
                typeof(BundledAssetGroupSchema), typeof(ContentUpdateGroupSchema));

            var schema = group.GetSchema<BundledAssetGroupSchema>();
            schema.BuildPath.SetVariableByName(settings, RemoteBuild);
            schema.LoadPath.SetVariableByName(settings, RemoteLoad);
            schema.Compression = BundledAssetGroupSchema.BundleCompressionMode.LZ4;       // WebGL-loadable
            schema.BundleMode = BundledAssetGroupSchema.BundlePackingMode.PackSeparately;  // one bundle per section
            schema.BundleNaming = BundledAssetGroupSchema.BundleNamingStyle.NoHash;
            schema.IncludeInBuild = true;
            EditorUtility.SetDirty(schema);

            foreach (var (path, address) in Sections)
            {
                var guid = AssetDatabase.AssetPathToGUID(path);
                if (string.IsNullOrEmpty(guid))
                    throw new Exception($"[StreamedWorldAddressables] section scene missing: {path} (build it first).");
                var entry = settings.CreateOrMoveEntry(guid, group);
                entry.address = address;
            }

            EditorUtility.SetDirty(settings);
            AssetDatabase.SaveAssets();
        }

        /// <summary>Build the remote content (bundles + catalog) to the configured ServerData path.</summary>
        public static void BuildContent()
        {
            AddressableAssetSettings.BuildPlayerContent(out AddressablesPlayerBuildResult result);
            if (!string.IsNullOrEmpty(result.Error))
                throw new Exception("Addressables content build failed: " + result.Error);
            Debug.Log($"✅ Addressables section content built in {result.Duration:F1}s.");
        }
    }
}
