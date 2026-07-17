using UnityEditor;
using UnitySkills;

namespace Yuvi720.Editor
{
    /// <summary>
    /// Keeps the project-scoped UnitySkills REST bridge available to the
    /// GitHub Copilot 720 Content Builder while this project is open.
    /// </summary>
    [InitializeOnLoad]
    public static class UnitySkillsAutoStart
    {
        private const int PreferredPort = 8090;

        static UnitySkillsAutoStart()
        {
            EditorApplication.delayCall += EnsureStarted;
        }

        [MenuItem("Yuvi/Tools/Start Unity Skills")]
        public static void EnsureStarted()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                EditorApplication.delayCall += EnsureStarted;
                return;
            }

            SkillsHttpServer.AutoStart = true;
            SkillsHttpServer.PreferredPort = PreferredPort;
            if (!SkillsHttpServer.IsRunning)
                SkillsHttpServer.Start(PreferredPort, fallbackToAuto: true);
        }
    }
}
