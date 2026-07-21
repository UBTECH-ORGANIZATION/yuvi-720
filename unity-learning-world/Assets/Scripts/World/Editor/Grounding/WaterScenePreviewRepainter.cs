using UnityEditor;
using UnityEngine;
using Yuvi720.LearningWorld.World;

namespace Yuvi720.LearningWorld.Editor.Grounding
{
    /// <summary>
    /// Forces ~30fps Scene-view repaints while a <see cref="WaterTimeDriver"/> is present and the
    /// editor is not playing, so the animated water is visibly "always ongoing" in the editor too.
    /// Cheap and self-gating: does nothing unless a driver exists in the open scene.
    /// </summary>
    [InitializeOnLoad]
    internal static class WaterScenePreviewRepainter
    {
        static double _next;

        static WaterScenePreviewRepainter()
        {
            EditorApplication.update += Tick;
        }

        static void Tick()
        {
            if (Application.isPlaying) return;
            if (EditorApplication.timeSinceStartup < _next) return;
            _next = EditorApplication.timeSinceStartup + 0.033;
            if (Object.FindFirstObjectByType<WaterTimeDriver>() != null)
                SceneView.RepaintAll();
        }
    }
}
