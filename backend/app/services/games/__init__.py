"""Learning Game Lab — AI-created learning games owned by one learner.

The learner picks a learning objective and one of its components, describes a
game, and a worker (``workers/game_gen``) builds one self-contained HTML file
around that component's questions. This package is the Yuvi side of that:

    store       the three collections (games, jobs, graded answers)
    html_store  where the HTML lives — never Mongo
    jobs        the job envelope the worker consumes, and how it is queued
    grading     server-side answer checking; correct answers never leave here
    notify      bell + realtime frames for the learner

See ``docs/design/learning-game-lab.md``.
"""
