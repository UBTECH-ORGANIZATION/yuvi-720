using UnityEngine;

namespace Yuvi720.LearningWorld.World
{
    /// <summary>
    /// Demo Yuvi controller driving a <see cref="CharacterController"/> so world colliders actually stop
    /// him: arrow keys / WASD move (world axes — up = north), and <b>Space flies upward</b> (gravity eases
    /// him back down). Walls/cliffs block him; to reach the raised bluff he must fly up and over its edge.
    /// Assign this transform as the `player` on every <see cref="ProximityPopAnimator"/>. Play-mode only.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class DemoPlayerController : MonoBehaviour
    {
        // Deliberately slow: with the zoomed isometric follow-camera, travel time is what sells the world as
        // large. Raising these shrinks the world's perceived size.
        public float moveSpeed = 3.2f;
        public float flySpeed = 4.5f;
        public float gravity = 16f;
        [Tooltip("Fly ceiling (world Y) — matched to the top of the pavilion's cone roof (~8.98).")]
        public float maxFlyHeight = 9f;

        CharacterController _cc;
        float _vy;

        void Awake() => _cc = GetComponent<CharacterController>();

        void Update()
        {
            var h = Axis(KeyCode.RightArrow, KeyCode.D) - Axis(KeyCode.LeftArrow, KeyCode.A);
            var v = Axis(KeyCode.UpArrow, KeyCode.W) - Axis(KeyCode.DownArrow, KeyCode.S);
            var move = new Vector3(h, 0f, v);
            if (move.sqrMagnitude > 1f) move.Normalize();
            // First person: the view turns by MOUSE DRAG only (see IsometricCameraRig); arrows move relative
            // to that view — up walks the way you're looking. Isometric keeps world axes (up = north).
            if (IsometricCameraRig.FirstPersonActive)
                move = Quaternion.Euler(0f, IsometricCameraRig.FirstPersonYaw, 0f) * move;

            if (Input.GetKey(KeyCode.Space)) _vy = flySpeed;
            else if (_cc.isGrounded && _vy < 0f) _vy = -2f;   // stick to ground
            else _vy -= gravity * Time.deltaTime;
            if (transform.position.y >= maxFlyHeight && _vy > 0f) _vy = 0f;   // fly ceiling

            var velocity = move * moveSpeed + Vector3.up * _vy;
            _cc.Move(velocity * Time.deltaTime);

            if (move.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(move), 12f * Time.deltaTime);
        }

        static float Axis(KeyCode a, KeyCode b) => (Input.GetKey(a) || Input.GetKey(b)) ? 1f : 0f;
    }
}
